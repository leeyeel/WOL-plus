package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/mux"
)

type Config struct {
	MacAddress    string `json:"mac_address"`
	Interface     string `json:"interface"`
	ExtraData     string `json:"extra_data"`
	ShutdownDelay string `json:"shutdown_delay"`
	Username      string `json:"username"`
	Password      string `json:"password"`
}

type ConfigPatch struct {
	MacAddress    *string `json:"mac_address"`
	Interface     *string `json:"interface"`
	ExtraData     *string `json:"extra_data"`
	ShutdownDelay *string `json:"shutdown_delay"`
	Username      *string `json:"username"`
	Password      *string `json:"password"`
}

var (
	config         Config
	configFilePath string
	webuiPath      string

	// Used to stop the raw Ethernet capture goroutine.
	listenerCancel context.CancelFunc
	listenerWg     sync.WaitGroup
	listenerMutex  sync.Mutex

	// HTTP 服务器
	server   *http.Server
	serverWg sync.WaitGroup

	// 用于控制关机的互斥锁和定时器
	shutdownMutex    sync.Mutex
	shutdownTimer    *time.Timer
	startTime        time.Time
	shutdownDuration time.Duration

	configMutex sync.RWMutex
)

type runtimeOptions struct {
	BackendOnly bool
}

func getConfigPath() (string, string) {
	if configPath := os.Getenv("CONFIG_FILE"); configPath != "" {
		webuiPath := os.Getenv("WEBUI_DIR")
		if webuiPath == "" {
			webuiPath = "/usr/share/wolp/webui/"
		}
		return configPath, webuiPath
	}

	if runtime.GOOS == "windows" {
		return `C:\ProgramData\wolp\wolp.json`, `C:\Program Files\wolp\webui\`
	}
	return `/usr/local/etc/wolp/wolp.json`, `/usr/share/wolp/webui/`
}

func parseRuntimeOptions() runtimeOptions {
	backendOnly := flag.Bool("backend-only", false, "run the Ethernet frame listener without starting the Web UI or HTTP server")
	flag.Parse()

	return runtimeOptions{
		BackendOnly: *backendOnly,
	}
}

func validateWebUIPath(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("not a directory")
	}

	indexPath := filepath.Join(path, "index.html")
	info, err = os.Stat(indexPath)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("%s is a directory", indexPath)
	}

	return nil
}

func loadConfig(path string) {
	create_and_init := func() {
		log.Println("Config file not found, creating a new one...")
		var err error
		config.Interface, config.MacAddress, err = getNetworkDevice()
		if err != nil {
			log.Fatalf("Error: %v", err)
		}
		config.ExtraData = "FF:FF:FF:FF:FF:FF"
		config.ShutdownDelay = "60"
		config.Username = "admin"
		config.Password = "admin123"
		log.Printf("Initial config: interface=%s mac=%s extra_data=%s", config.Interface, config.MacAddress, config.ExtraData)
		if err := saveConfig(path, config); err != nil {
			log.Fatalf("Failed to save config: %v", err)
		}
	}

	file, err := os.ReadFile(path)
	if err != nil {
		create_and_init()
		return
	}
	err = json.Unmarshal(file, &config)
	if err != nil {
		log.Fatalf("Failed to parse config: %v", err)
	}
	if config.Interface == "" || config.MacAddress == "" {
		create_and_init()
	}
	config.MacAddress, err = normalizeMACAddress(config.MacAddress)
	if err != nil {
		log.Fatalf("Failed to validate mac_address: %v", err)
	}
	config.ExtraData, err = normalizeExtraData(config.ExtraData)
	if err != nil {
		log.Fatalf("Failed to validate extra_data: %v", err)
	}
	config.ShutdownDelay, err = normalizeShutdownDelay(config.ShutdownDelay)
	if err != nil {
		log.Fatalf("Failed to validate shutdown_delay: %v", err)
	}
	if err := saveConfig(path, config); err != nil {
		log.Fatalf("Failed to migrate Ethernet frame configuration: %v", err)
	}
}

func saveConfig(path string, cfg Config) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	// 确保目录存在
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create the config file: %v", err)
	}
	return os.WriteFile(path, data, 0600)
}

type listenerConfig struct {
	Interface  string
	MacAddress string
	ExtraData  string
}

func normalizeMACAddress(value string) (string, error) {
	hardwareAddr, err := net.ParseMAC(strings.TrimSpace(value))
	if err != nil {
		return "", err
	}
	if len(hardwareAddr) != 6 {
		return "", fmt.Errorf("must be a 6-byte MAC address")
	}
	return strings.ToLower(hardwareAddr.String()), nil
}

func normalizeExtraData(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "FF:FF:FF:FF:FF:FF", nil
	}

	compact := strings.NewReplacer(":", "", "-", "").Replace(value)
	address, err := hex.DecodeString(compact)
	if err != nil || len(address) != 6 {
		return "", fmt.Errorf("must be a 6-byte MAC-style hexadecimal value")
	}

	return strings.ToUpper(net.HardwareAddr(address).String()), nil
}

func normalizeShutdownDelay(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "60", nil
	}

	delay, err := strconv.Atoi(value)
	if err != nil || delay < 0 {
		return "", fmt.Errorf("must be a non-negative number")
	}

	return strconv.Itoa(delay), nil
}

func applyConfigPatch(current Config, patch ConfigPatch) (Config, error) {
	next := current

	if patch.MacAddress != nil {
		next.MacAddress = strings.TrimSpace(*patch.MacAddress)
	}
	if patch.Interface != nil {
		next.Interface = strings.TrimSpace(*patch.Interface)
	}
	if patch.ExtraData != nil {
		next.ExtraData = strings.TrimSpace(*patch.ExtraData)
	}
	if patch.ShutdownDelay != nil {
		next.ShutdownDelay = strings.TrimSpace(*patch.ShutdownDelay)
	}
	if patch.Username != nil {
		next.Username = strings.TrimSpace(*patch.Username)
	}
	if patch.Password != nil {
		next.Password = *patch.Password
	}

	if next.Interface == "" {
		return Config{}, fmt.Errorf("interface cannot be empty")
	}
	if next.Username == "" {
		return Config{}, fmt.Errorf("username cannot be empty")
	}
	if next.Password == "" {
		return Config{}, fmt.Errorf("password cannot be empty")
	}

	var err error
	next.MacAddress, err = normalizeMACAddress(next.MacAddress)
	if err != nil {
		return Config{}, fmt.Errorf("invalid mac_address: %w", err)
	}
	next.ExtraData, err = normalizeExtraData(next.ExtraData)
	if err != nil {
		return Config{}, fmt.Errorf("invalid extra_data: %w", err)
	}
	next.ShutdownDelay, err = normalizeShutdownDelay(next.ShutdownDelay)
	if err != nil {
		return Config{}, fmt.Errorf("invalid shutdown_delay: %w", err)
	}

	return next, nil
}

func currentListenerConfig() listenerConfig {
	configMutex.RLock()
	defer configMutex.RUnlock()

	return listenerConfig{
		Interface:  config.Interface,
		MacAddress: config.MacAddress,
		ExtraData:  config.ExtraData,
	}
}

func restartListeners() {
	cfg := currentListenerConfig()

	listenerMutex.Lock()
	defer listenerMutex.Unlock()

	if listenerCancel != nil {
		listenerCancel()
		listenerWg.Wait()
		listenerCancel = nil
	}

	listenerCtx, cancel := context.WithCancel(context.Background())
	listenerCancel = cancel

	listenerWg.Add(1)
	go startPacketCapture(listenerCtx, cfg)
}

func stopListeners() {
	listenerMutex.Lock()
	defer listenerMutex.Unlock()

	if listenerCancel != nil {
		listenerCancel()
		listenerWg.Wait()
		listenerCancel = nil
	}
}

func initiateShutdown() {
	configMutex.RLock()
	shutdownDelay := config.ShutdownDelay
	configMutex.RUnlock()

	shutdownSystem := func() error {
		if runtime.GOOS == "windows" {
			return exec.Command("shutdown", "/s", "/t", "0").Run()
		}
		return exec.Command("shutdown", "-h", "now").Run()
	}

	executeShutdown := func() {
		log.Println("Executing shutdown...")
		if err := shutdownSystem(); err != nil {
			log.Printf("Shutdown failed: %v", err)
		}
	}

	shutdownMutex.Lock()
	defer shutdownMutex.Unlock()

	if shutdownTimer != nil {
		log.Println("Shutdown already scheduled.")
		return
	}

	num, err := strconv.Atoi(shutdownDelay)
	if err != nil {
		fmt.Println("Failed to convert string to int, use default value 60.")
		shutdownDelay = "60"
		num = 60
	}

	startTime = time.Now()
	shutdownDuration = time.Duration(num) * time.Second
	shutdownTimer = time.NewTimer(shutdownDuration)
	timer := shutdownTimer
	log.Printf("Shutdown scheduled in %s seconds. Use web UI to cancel.", shutdownDelay)
	go func() {
		<-timer.C
		shutdownMutex.Lock()
		if shutdownTimer != timer {
			shutdownMutex.Unlock()
			return
		}
		shutdownTimer = nil
		shutdownMutex.Unlock()
		executeShutdown()
	}()

}

// 取消关机任务
func cancelShutdownTimer(w http.ResponseWriter, r *http.Request) {
	shutdownMutex.Lock()
	defer shutdownMutex.Unlock()
	if shutdownTimer != nil {
		shutdownTimer.Stop()
		log.Println("shutdown task was canceled.")
		shutdownTimer = nil
	} else {
		log.Println("There are no tasks to be cancelled.")
	}
}

// 获取剩余时间
func getRemainingTime(w http.ResponseWriter, r *http.Request) {
	shutdownMutex.Lock()
	defer shutdownMutex.Unlock()

	if shutdownTimer == nil {
		fmt.Fprintln(w, "0") // 没有任务，返回 0
		return
	}

	elapsed := time.Since(startTime)        // 计算已经过去的时间
	remaining := shutdownDuration - elapsed // 计算剩余时间

	if remaining < 0 {
		fmt.Fprintln(w, "0") // 任务已经执行，剩余时间为 0
		return
	}
	fmt.Fprintln(w, int(remaining.Seconds())) // 返回剩余秒数
}

// basicAuthMiddleware Basic Auth 认证中间件 - 仅保护 index.html
// 登录页面本身不保护，登录后的操作通过 API 认证保护
func basicAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 跳过 API 路径的认证检查（在具体处理函数中处理）
		if strings.HasPrefix(r.URL.Path, "/api") {
			next.ServeHTTP(w, r)
			return
		}
		// 静态资源（CSS, JS）不需要认证
		if strings.HasSuffix(r.URL.Path, ".css") ||
			strings.HasSuffix(r.URL.Path, ".js") ||
			strings.HasSuffix(r.URL.Path, ".svg") ||
			strings.HasSuffix(r.URL.Path, ".ico") {
			next.ServeHTTP(w, r)
			return
		}
		// index.html 不做认证保护（允许显示登录表单）
		next.ServeHTTP(w, r)
	})
}

// apiAuthMiddleware API 认证中间件（所有请求都需要认证）
func apiAuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		configMutex.RLock()
		usernameConfig := config.Username
		passwordConfig := config.Password
		configMutex.RUnlock()

		username, password, ok := r.BasicAuth()
		if !ok || username != usernameConfig || password != passwordConfig {
			w.Header().Set("WWW-Authenticate", `Basic realm="WOL Plus API"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func handleConfigUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}

	var patch ConfigPatch
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&patch); err != nil {
		http.Error(w, "Failed to parse config", http.StatusBadRequest)
		return
	}

	configMutex.Lock()
	nextConfig, err := applyConfigPatch(config, patch)
	if err != nil {
		configMutex.Unlock()
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := saveConfig(configFilePath, nextConfig); err != nil {
		configMutex.Unlock()
		http.Error(w, "Failed to save config", http.StatusInternalServerError)
		return
	}
	config = nextConfig
	configMutex.Unlock()

	go restartListeners()
	w.WriteHeader(http.StatusOK)
}

// shutdown 用于优雅关闭服务和抓包 goroutine
func terminate() {
	if server != nil {
		if err := server.Close(); err != nil && err != http.ErrServerClosed {
			log.Printf("HTTP server close error: %v", err)
		}
	}

	listenerMutex.Lock()
	if listenerCancel != nil {
		listenerCancel()
		listenerCancel = nil
	}
	listenerMutex.Unlock()
}

func startHTTPServer() {
	r := mux.NewRouter()

	api := r.PathPrefix("/api").Subrouter()

	api.HandleFunc("/config", apiAuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		configMutex.RLock()
		safeConfig := struct {
			MacAddress    string `json:"mac_address"`
			Interface     string `json:"interface"`
			ExtraData     string `json:"extra_data"`
			ShutdownDelay string `json:"shutdown_delay"`
			Username      string `json:"username"`
		}{
			MacAddress:    config.MacAddress,
			Interface:     config.Interface,
			ExtraData:     config.ExtraData,
			ShutdownDelay: config.ShutdownDelay,
			Username:      config.Username,
		}
		configMutex.RUnlock()
		json.NewEncoder(w).Encode(safeConfig)
	})).Methods("GET")

	api.HandleFunc("/config", apiAuthMiddleware(handleConfigUpdate)).Methods("POST")
	api.HandleFunc("/cancel", apiAuthMiddleware(cancelShutdownTimer)).Methods("POST")
	api.HandleFunc("/remaining", apiAuthMiddleware(getRemainingTime)).Methods("GET")

	r.PathPrefix("/").Handler(basicAuthMiddleware(http.FileServer(http.Dir(webuiPath))))

	server = &http.Server{Addr: ":2025", Handler: r}

	serverWg.Add(1)
	go func() {
		defer serverWg.Done()
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("ListenAndServe error: %v", err)
		}
	}()
}

func main() {
	runtimeOpts := parseRuntimeOptions()

	// 1. 读取/初始化配置
	configFilePath, webuiPath = getConfigPath()
	log.Printf("Config file: %s\n", configFilePath)
	loadConfig(configFilePath)

	if runtimeOpts.BackendOnly {
		log.Println("Backend-only mode enabled, skip Web UI and HTTP server startup.")
	} else {
		if err := validateWebUIPath(webuiPath); err != nil {
			log.Fatalf("Web UI assets unavailable at %s: %v. Install the Web UI assets or start wolp with --backend-only.", webuiPath, err)
		}
		log.Printf("Web UI path: %s\n", webuiPath)
	}

	// 2. 启动监听 goroutine
	restartListeners()

	if !runtimeOpts.BackendOnly {
		// 3. 启动 HTTP 服务器
		startHTTPServer()
	}

	// 4. 监听系统信号，用于优雅退出
	signalChan := make(chan os.Signal, 1)
	signal.Notify(signalChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		s := <-signalChan
		log.Printf("received message: %v, start terminating...", s)
		terminate()
		// Do not wait on a pcap read while systemd is stopping the service.
		os.Exit(0)
	}()

	// 5. Block until the HTTP server and Ethernet capture goroutine stop.
	serverWg.Wait()
	listenerWg.Wait()
	log.Println("goroutine terminated.")
}

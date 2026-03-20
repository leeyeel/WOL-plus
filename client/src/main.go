package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
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
	UDPPort       string `json:"udp_port"`
	ShutdownDelay string `json:"shutdown_delay"`
	Username      string `json:"username"`
	Password      string `json:"password"`
}

type ConfigPatch struct {
	MacAddress    *string `json:"mac_address"`
	Interface     *string `json:"interface"`
	ExtraData     *string `json:"extra_data"`
	UDPPort       *string `json:"udp_port"`
	ShutdownDelay *string `json:"shutdown_delay"`
	Username      *string `json:"username"`
	Password      *string `json:"password"`
}

var (
	config         Config
	configFilePath string
	webuiPath      string

	// 用于控制 UDP 监听 goroutine 的退出
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
	backendOnly := flag.Bool("backend-only", false, "run the UDP listener without starting the Web UI or HTTP server")
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
		config.UDPPort = "9"
		config.ShutdownDelay = "60"
		config.Username = "admin"
		config.Password = "admin123"
		log.Printf("Initial config: %+v", config)
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
	config.ExtraData = normalizeExtraData(config.ExtraData)
	config.MacAddress, err = normalizeMACAddress(config.MacAddress)
	if err != nil {
		log.Fatalf("Failed to validate mac_address: %v", err)
	}
	config.UDPPort, err = normalizeUDPPort(config.UDPPort)
	if err != nil {
		log.Fatalf("Failed to validate udp_port: %v", err)
	}
	config.ShutdownDelay, err = normalizeShutdownDelay(config.ShutdownDelay)
	if err != nil {
		log.Fatalf("Failed to validate shutdown_delay: %v", err)
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
	return os.WriteFile(path, data, 0644)
}

type listenerConfig struct {
	Interface  string
	MacAddress string
	ExtraData  string
	UDPPort    string
}

func normalizeExtraData(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value == "" {
		return "FF:FF:FF:FF:FF:FF"
	}

	clean := strings.ReplaceAll(value, ":", "")
	if len(clean) != 12 {
		log.Printf("Invalid Extra Data length %q, fallback to FF:FF:FF:FF:FF:FF", value)
		return "FF:FF:FF:FF:FF:FF"
	}

	if _, err := hex.DecodeString(clean); err != nil {
		log.Printf("Invalid Extra Data format %q, fallback to FF:FF:FF:FF:FF:FF", value)
		return "FF:FF:FF:FF:FF:FF"
	}

	parts := make([]string, 0, 6)
	for i := 0; i < len(clean); i += 2 {
		parts = append(parts, clean[i:i+2])
	}

	return strings.Join(parts, ":")
}

func decodeMAC(macAddress string) ([]byte, error) {
	return hex.DecodeString(strings.ReplaceAll(macAddress, ":", ""))
}

func decodeExtraData(extraData string) ([]byte, error) {
	return hex.DecodeString(strings.ReplaceAll(normalizeExtraData(extraData), ":", ""))
}

func normalizeMACAddress(value string) (string, error) {
	hardwareAddr, err := net.ParseMAC(strings.TrimSpace(value))
	if err != nil {
		return "", err
	}
	return strings.ToLower(hardwareAddr.String()), nil
}

func normalizeUDPPort(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "9", nil
	}

	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("must be a number between 1 and 65535")
	}

	return strconv.Itoa(port), nil
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
		next.ExtraData = normalizeExtraData(*patch.ExtraData)
	}
	if patch.UDPPort != nil {
		next.UDPPort = strings.TrimSpace(*patch.UDPPort)
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
	next.ExtraData = normalizeExtraData(next.ExtraData)
	next.UDPPort, err = normalizeUDPPort(next.UDPPort)
	if err != nil {
		return Config{}, fmt.Errorf("invalid udp_port: %w", err)
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
		ExtraData:  normalizeExtraData(config.ExtraData),
		UDPPort:    config.UDPPort,
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
	go startUDPListener(listenerCtx, cfg)
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

// getNetworkDevice 获取当前正在使用的网卡，并返回其名称和 MAC 地址
func getNetworkDevice() (string, string, error) {
	netIfaces, err := net.Interfaces()
	if err != nil {
		return "", "", fmt.Errorf("could not get network interface: %v", err)
	}

	for _, iface := range netIfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if len(iface.HardwareAddr) == 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		var validIPs []net.IP
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP == nil || ipNet.IP.IsLoopback() {
				continue
			}

			ip4 := ipNet.IP.To4()
			if ip4 == nil {
				continue
			}

			validIPs = append(validIPs, ip4)
		}

		if len(validIPs) > 0 {
			log.Printf("Select network device: %s - MAC: %s - IPs: %v", iface.Name, iface.HardwareAddr.String(), validIPs)
			return iface.Name, iface.HardwareAddr.String(), nil
		}
	}

	return "", "", fmt.Errorf("could not select network interface")
}

func startUDPListener(ctx context.Context, cfg listenerConfig) {
	defer listenerWg.Done()

	conn, err := net.ListenPacket("udp4", ":"+cfg.UDPPort)
	if err != nil {
		log.Printf("Failed to listen on UDP port %s: %v", cfg.UDPPort, err)
		return
	}
	defer conn.Close()

	buf := make([]byte, 2048)

	for {
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		n, addr, err := conn.ReadFrom(buf)
		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				select {
				case <-ctx.Done():
					log.Println("Stop UDP listener goroutine")
					return
				default:
					continue
				}
			}

			if errors.Is(err, net.ErrClosed) || errors.Is(err, io.EOF) {
				return
			}

			log.Printf("UDP read error: %v", err)
			continue
		}

		if isShutdownPayload(buf[:n], cfg) {
			log.Printf("Received valid shutdown UDP packet from %s, initiating shutdown!", addr.String())
			initiateShutdown()
		}
	}
}

func isMagicPacketPayload(data []byte, cfg listenerConfig) bool {
	// 比较两个字节数组是否相等
	equal := func(a, b []byte) bool {
		if len(a) != len(b) {
			return false
		}
		for i := range a {
			if a[i] != b[i] {
				return false
			}
		}
		return true
	}

	if len(data) != 108 {
		return false
	}

	mac, err := decodeMAC(cfg.MacAddress)
	if err != nil {
		log.Printf("Invalid MAC address: %v", err)
		return false
	}

	// 检查同步字节部分是否是 0xFF
	if !equal(data[0:6], []byte{0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}) {
		return false
	}

	// 检查目标 MAC 地址是否匹配
	for i := 6; i < 102; i += 6 {
		if !equal(data[i:i+6], mac) {
			return false
		}
	}

	extraData := data[102:108]
	extraDataConfig, err := decodeExtraData(cfg.ExtraData)
	if err != nil || len(extraDataConfig) != 6 {
		log.Printf("Invalid Extra Data format (expected 6 bytes): %s", cfg.ExtraData)
		return false
	}

	return equal(extraData, extraDataConfig)
}

func isShutdownPayload(data []byte, cfg listenerConfig) bool {
	return isMagicPacketPayload(data, cfg)
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

	if shutdownTimer != nil {
		shutdownTimer.Stop()
		log.Println("The previous shutdown task was canceled.")
	}
	startTime = time.Now()
	shutdownDuration = time.Duration(num) * time.Second
	shutdownTimer = time.NewTimer(shutdownDuration)
	log.Printf("Shutdown scheduled in %s seconds. Use web UI to cancel.", shutdownDelay)
	go func() {
		<-shutdownTimer.C
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
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("HTTP server shutdown error: %v", err)
		}
	}

	stopListeners()
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
			UDPPort       string `json:"udp_port"`
			ShutdownDelay string `json:"shutdown_delay"`
			Username      string `json:"username"`
		}{
			MacAddress:    config.MacAddress,
			Interface:     config.Interface,
			ExtraData:     config.ExtraData,
			UDPPort:       config.UDPPort,
			ShutdownDelay: config.ShutdownDelay,
			Username:      config.Username,
		}
		configMutex.RUnlock()
		json.NewEncoder(w).Encode(safeConfig)
	})).Methods("GET")

	api.HandleFunc("/config", apiAuthMiddleware(handleConfigUpdate)).Methods("POST")
	api.HandleFunc("/cancel", apiAuthMiddleware(cancelShutdownTimer)).Methods("POST")
	api.HandleFunc("/remaining", getRemainingTime).Methods("GET")

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
	}()

	// 5. 阻塞等待 goroutine 结束 (HTTP + PacketCapture)
	serverWg.Wait()
	listenerWg.Wait()
	log.Println("goroutine terminated.")
}

package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
    "strconv"

	"github.com/google/gopacket"
	"github.com/google/gopacket/pcap"
	"github.com/gorilla/mux"
)

type Config struct {
	MacAddress string `json:"mac_address"`
	Interface  string `json:"interface"`
	ExtraData  string `json:"extra_data"`
    Shutdown_delay string `json:"shudown_delay"`
}

var (
	config         Config
	configFilePath string
	webuiPath      string

	// 用于控制抓包 goroutine 的退出
	captureCancel context.CancelFunc
	captureWg     sync.WaitGroup

	// HTTP 服务器
	server   *http.Server
	serverWg sync.WaitGroup

	// 用于控制关机的互斥锁和定时器
	shutdownMutex sync.Mutex
	shutdownTimer *time.Timer
    startTime   time.Time
    shutdownDuration time.Duration
)

func getConfigPath() (string, string) {
	if runtime.GOOS == "windows" {
		return `C:\ProgramData\wolp\wolp.json`, `C:\Program Files\wolp\webui\`
	}
	return `/usr/local/etc/wolp/wolp.json`, `/usr/share/wolp/webui/`
}

func loadConfig(path string) {
    create_and_init := func() {
        log.Println("Config file not found, creating a new one...");
        var err error;
        config.Interface, config.MacAddress, err = getNetworkDevice();
        if err != nil {
            log.Fatalf("Error: %v", err)
        }
        config.ExtraData = ""
        log.Printf("Initial config: %+v", config)
        config.Shutdown_delay = "60"
        if err := saveConfig(path); err != nil {
            log.Fatalf("Failed to save config: %v", err)
        }
    }

	file, err := os.ReadFile(path)
	if err != nil {
        create_and_init();
	    return
	}
    err = json.Unmarshal(file, &config); 
	if err != nil {
		log.Fatalf("Failed to parse config: %v", err)
    }
    if config.Interface == "" || config.MacAddress == ""{
        create_and_init();
    }
}

func saveConfig(path string) error {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	// 确保目录存在
	dir := path[:len(path)-len("/wolp.json")]
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建配置目录失败: %v", err)
	}
	return os.WriteFile(path, data, 0644)
}

// getNetworkDevice 获取当前正在使用的网卡，并返回其名称和 MAC 地址
func getNetworkDevice() (string, string, error) {
	// 获取所有 pcap 设备
	devices, err := pcap.FindAllDevs()
	if err != nil {
		return "", "", fmt.Errorf("无法获取网卡信息: %v", err)
	}

	// 获取系统网卡信息
	netIfaces, err := net.Interfaces()
	if err != nil {
		return "", "", fmt.Errorf("无法获取网络接口信息: %v", err)
	}

	// 记录匹配的设备
	var selectedDevice pcap.Interface
	var selectedMAC net.HardwareAddr
	var validIPs []net.IP

	isVirtualAdapter := func(description string) bool {
		virtualKeywords := []string{
			"Virtual", "VMware", "Hyper-V", "vEthernet", "VPN", "TAP", "Loopback",
		}
		for _, keyword := range virtualKeywords {
			if strings.Contains(description, keyword) {
				return true
			}
		}
		return false
	}

	// 遍历所有 pcap 设备，筛选合适的网卡
	for _, device := range devices {
		if isVirtualAdapter(device.Description) {
			continue // 跳过虚拟网卡
		}
		for _, devAddr := range device.Addresses {
			if devAddr.IP == nil {
				continue
			}
			// 过滤 IPv6 和回环地址
			if devAddr.IP.IsLoopback() || strings.Contains(devAddr.IP.String(), ":") {
				continue
			}
			// 遍历系统网卡，匹配具有相同 IP 地址的网卡
			for _, iface := range netIfaces {
				addrs, _ := iface.Addrs()
				for _, addr := range addrs {
					ipNet, ok := addr.(*net.IPNet)
					if !ok || ipNet.IP == nil {
						continue
					}

					if ipNet.IP.Equal(devAddr.IP) {
						validIPs = append(validIPs, devAddr.IP)
						selectedDevice = device
						selectedMAC = iface.HardwareAddr
					}
				}
			}
		}
	}

	// 如果找到合适的网卡，返回设备名称和 MAC 地址
	if len(validIPs) > 0 {
		fmt.Printf("已选择网卡: %s (%s) - MAC: %s - IPs: %v\n",
			selectedDevice.Name, selectedDevice.Description, selectedMAC, validIPs)
		return selectedDevice.Name, selectedMAC.String(), nil
	}

	return "", "", fmt.Errorf("没有找到合适的网卡")
}

// startPacketCapture 在单独 goroutine 中监听指定网卡，捕获数据包并检测 Magic Packet
func startPacketCapture(ctx context.Context, devName string, shutdown_delay string) {
	defer captureWg.Done()
	handle, err := pcap.OpenLive(devName, 1600, true, pcap.BlockForever)
	if err != nil {
		log.Printf("打开网卡 %s 失败: %v\n", devName, err)
		return
	}
	defer handle.Close()

	packetSource := gopacket.NewPacketSource(handle, handle.LinkType())
	packets := packetSource.Packets()

	for {
		select {
		case <-ctx.Done():
			log.Println("停止抓包 goroutine")
			return
		case packet, ok := <-packets:
			if !ok {
				log.Println("抓包通道已关闭")
				return
			}
			data := packet.Data()
			if isWOLFrame(data) {
				log.Println("检测到 Wake-on-LAN Magic Packet!")
				initiateShutdown(shutdown_delay);
			}
		}
	}
}

func isWOLFrame(data []byte) bool {
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

	if len(data) < 102 {
		return false
	}
	mac, err := hex.DecodeString(strings.ReplaceAll(config.MacAddress, ":", ""))
	if err != nil {
		log.Fatalf("Invalid MAC address: %v", err)
	}

	ethernetType := data[12:14]
	if !(ethernetType[0] == 0x08 && ethernetType[1] == 0x42) {
		return false
	}

	if !equal(data[14:20], []byte{0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}) {
		return false
	}

	for i := 20; i < 102; i += 6 {
		if !equal(data[i:i+6], mac) {
			return false
		}
	}

	extraData := data[116:122]

	if config.ExtraData != "" {
		extraDataConfig, err := hex.DecodeString(strings.ReplaceAll(config.ExtraData, ":", ""))
		if err != nil || len(extraDataConfig) != 6 {
			log.Printf("Invalid Extra Data: %v", err)
			return false
		}
		if !equal(extraData, extraDataConfig) {
			return false
		}
	}

	return true
}

func initiateShutdown(shutdown_delay string) {
	shutdownSystem := func() error {
		if os.Getenv("OS") == "Windows_NT" {
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

    num, err := strconv.Atoi(shutdown_delay);
    if err != nil {
        fmt.Println("Failed to convert string to int, use default value 60.");
        shutdown_delay = "60";
        num = 60;
    }
	if shutdownTimer != nil {
		shutdownTimer.Stop()
		log.Println("The previous shutdown task was canceled.")
	}
    startTime = time.Now()
    shutdownDuration = time.Duration(num) * time.Second
    shutdownTimer = time.NewTimer(shutdownDuration);
	log.Printf("Shutdown scheduled in %s seconds. Use web UI to cancel.", shutdown_delay);
	go func() {
		<-shutdownTimer.C
        executeShutdown();
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
func getRemainingTime(w http.ResponseWriter, r *http.Request){
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

func handleConfigUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&config); err != nil {
		http.Error(w, "Failed to parse config", http.StatusBadRequest)
		return
	}
	if err := saveConfig(configFilePath); err != nil {
		http.Error(w, "Failed to save config", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// shutdown 用于优雅关闭服务和抓包 goroutine
func terminate() {
	// 关闭 HTTP 服务
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	// 停止抓包 goroutine
	if captureCancel != nil {
		captureCancel()
	}
}

func main() {
	// 1. 读取/初始化配置
	configFilePath, webuiPath = getConfigPath()
	log.Printf("Config file: %s\n", configFilePath)
	loadConfig(configFilePath)

	// 2. 启动抓包 goroutine
	captureCtx, cancel := context.WithCancel(context.Background())
	captureCancel = cancel
	captureWg.Add(1)
	go startPacketCapture(captureCtx, config.Interface, config.Shutdown_delay)

	// 3. 启动 HTTP 服务器
	r := mux.NewRouter()
	// 3.1 为 API 配置路由
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/config", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(config)
	}).Methods("GET")
	api.HandleFunc("/config", handleConfigUpdate).Methods("POST")
    api.HandleFunc("/cancel", cancelShutdownTimer)
	api.HandleFunc("/remaining", getRemainingTime)
	r.PathPrefix("/").Handler(http.FileServer(http.Dir(webuiPath)))
	// 3.2 静态文件: 将 webuiPath 作为静态资源目录
	server = &http.Server{Addr: ":2025", Handler: r}

	serverWg.Add(1)
	go func() {
		defer serverWg.Done()
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("ListenAndServe error: %v", err)
		}
	}()

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
	captureWg.Wait()
	log.Println("goroutine terminated.")
}

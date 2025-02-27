package main

import (
	"encoding/hex"
    "encoding/json"
	"log"
    "fmt"
	"net"
    "net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

    "github.com/gorilla/mux"
	"github.com/google/gopacket"
	"github.com/google/gopacket/pcap"
)

const configFilePath = "/usr/local/etc/wolp/wolp.json"
const webuiPath = "/usr/share/wolp/webui/"

type Config struct {
	MacAddress string `json:"mac_address"`
	Interface  string `json:"interface"`
	ExtraData  string `json:"extra_data"`
}

var (
	config        Config
	shutdownTimer *time.Timer
	shutdownMutex sync.Mutex
)

func loadConfig(path string) {
	file, err := os.ReadFile(path)
	if err != nil {
		log.Println("Config file not found, creating a new one...")
		config.MacAddress, config.Interface = getLocalMacInfo()
		config.ExtraData = "" // 默认不填附加数据
		saveConfig(path)
		return
	}

	if err := json.Unmarshal(file, &config); err != nil {
		log.Fatalf("Failed to parse config: %v", err)
	}

	// 如果 MAC 地址为空，获取设备 MAC 地址
    if config.MacAddress == "" || config.Interface == "" {
		config.MacAddress, config.Interface = getLocalMacInfo()
		saveConfig(path)
	}
}

func saveConfig(path string) error {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func getLocalMacInfo() (string, string) {
    interfaces, err := net.Interfaces()
    if err != nil {
        log.Fatalf("Failed to get network interfaces: %v", err)
    }

    for _, iface := range interfaces {
        // 过滤无效网卡：必须是 "up" 状态，且不是 Loopback（回环地址）
        if (iface.Flags&net.FlagUp) != 0 && (iface.Flags&net.FlagLoopback) == 0 {
            mac := iface.HardwareAddr.String()
            if mac != "" {
                // Windows 设备名不同，如 "Ethernet", "Wi-Fi"
                fmt.Printf("Detected MAC: %s on interface %s\n", mac, iface.Name)
                return mac, iface.Name
            }
        }
    }

    log.Println("No valid network interface found.")
    return "UNKNOWN", "UNKNOWN"
}

func listenForWOL() {
	handle, err := pcap.OpenLive(config.Interface, 1600, true, pcap.BlockForever)
	if err != nil {
		log.Fatalf("Failed to open network interface: %v", err)
	}
	defer handle.Close()

	packetSource := gopacket.NewPacketSource(handle, handle.LinkType())
	for packet := range packetSource.Packets() {
		if isWOLFrame(packet.Data()) {
			log.Println("Valid WOL frame detected. Initiating shutdown sequence.")
			initiateShutdown()
        }
	}
}

func isWOLFrame(data []byte) bool {
	if len(data) < 102 {
		return false
	}
	mac, err := hex.DecodeString(strings.ReplaceAll(config.MacAddress, ":", ""))
	if err != nil {
		log.Fatalf("Invalid MAC address: %v", err)
	}

    ethernetType := data[12:14]
    if !(ethernetType[0] == 0x08 && ethernetType[1] == 0x42 ) {
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

func equal(a, b []byte) bool {
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

func initiateShutdown() {
	shutdownMutex.Lock()
	defer shutdownMutex.Unlock()

	if shutdownTimer != nil {
		log.Println("Shutdown already scheduled.")
		return
	}

	log.Println("Shutdown scheduled in 5 minutes. Use web UI to cancel.")
	shutdownTimer = time.AfterFunc(5*time.Minute, executeShutdown)
}

func executeShutdown() {
	log.Println("Executing shutdown...")
	if err := shutdownSystem(); err != nil {
		log.Printf("Shutdown failed: %v", err)
	}
}

func shutdownSystem() error {
	if os.Getenv("OS") == "Windows_NT" {
		return exec.Command("shutdown", "/s", "/t", "0").Run()
	}
	return exec.Command("shutdown", "-h", "now").Run()
}

func startServer() {
	r := mux.NewRouter()
	r.HandleFunc("/config", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(config)
	}).Methods("GET")
	r.HandleFunc("/config", handleConfigUpdate).Methods("POST")
	r.PathPrefix("/").Handler(http.FileServer(http.Dir(webuiPath)))

    log.Println("Starting web server on http://localhost:9980")
	http.ListenAndServe(":9980", r)
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

func main() {
    loadConfig(configFilePath);
	config.MacAddress, config.Interface = getLocalMacInfo()
	go listenForWOL()
    go startServer()
	log.Println("WOL Listener started.")
	select {}
}


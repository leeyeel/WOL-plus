package main

import (
	"encoding/hex"
    "encoding/json"
	"log"
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

func loadConfig() {
	file, err := os.ReadFile("config.json")
	if err != nil {
		log.Println("Config file not found, creating a new one...")
		config.MacAddress, config.Interface = getLocalMacInfo()
		config.ExtraData = "" // 默认不填附加数据
		saveConfig()
		return
	}

	if err := json.Unmarshal(file, &config); err != nil {
		log.Fatalf("Failed to parse config: %v", err)
	}

	// 如果 MAC 地址为空，获取设备 MAC 地址
    if config.MacAddress == "" || config.Interface == "" {
		config.MacAddress, config.Interface = getLocalMacInfo()
		saveConfig()
	}
}

func saveConfig() error {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile("config.json", data, 0644)
}

func getLocalMacInfo() (string, string) {
	interfaces, err := net.Interfaces()
	if err != nil {
		log.Fatalf("Failed to get network interfaces: %v", err)
	}

	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp != 0 && !strings.Contains(iface.Name, "lo") {
			mac := iface.HardwareAddr.String()
			if mac != "" {
				log.Printf("Detected MAC Address: %s on interface %s", mac, iface.Name)
				return mac, iface.Name
			}
		}
	}

	log.Println("No valid MAC address found.")
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
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./webui")))

	log.Println("Starting web server on :9980")
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
	if err := saveConfig(); err != nil {
		http.Error(w, "Failed to save config", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func main() {
	config.MacAddress, config.Interface = getLocalMacInfo()
	go listenForWOL()
    go startServer()
	log.Println("WOL Listener started.")
	select {}
}


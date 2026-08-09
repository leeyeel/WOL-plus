package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"strings"

	"github.com/google/gopacket"
	"github.com/google/gopacket/pcap"
)

const (
	ethernetHeaderLength = 14
	wolEthertype         = 0x0842
	wolPayloadLength     = 102
	shutdownPayloadSize  = wolPayloadLength + 6
)

var wolSyncBytes = bytes.Repeat([]byte{0xff}, 6)

// startPacketCapture accepts only WOL Ethernet frames whose Magic Packet and
// trailing six-byte discriminator both match this Client's configuration.
func startPacketCapture(ctx context.Context, cfg listenerConfig) {
	defer listenerWg.Done()

	handle, err := pcap.OpenLive(cfg.Interface, 1600, true, pcap.BlockForever)
	if err != nil {
		log.Printf("Failed to open capture device %s: %v", cfg.Interface, err)
		return
	}
	defer handle.Close()

	if err := handle.SetBPFFilter("ether proto 0x0842"); err != nil {
		log.Printf("Failed to apply WOL capture filter on %s: %v", cfg.Interface, err)
		return
	}

	packets := gopacket.NewPacketSource(handle, handle.LinkType()).Packets()
	for {
		select {
		case <-ctx.Done():
			log.Println("Stop Ethernet capture goroutine")
			return
		case packet, ok := <-packets:
			if !ok {
				log.Println("Ethernet capture channel closed")
				return
			}
			if isShutdownFrame(packet.Data(), cfg) {
				log.Println("Received matching WOL Ethernet frame, initiating shutdown")
				initiateShutdown()
			}
		}
	}
}

func isShutdownFrame(frame []byte, cfg listenerConfig) bool {
	if len(frame) < ethernetHeaderLength+shutdownPayloadSize {
		return false
	}
	if frame[12] != byte(wolEthertype>>8) || frame[13] != byte(wolEthertype&0xff) {
		return false
	}

	targetMAC, err := decodeConfiguredMAC(cfg.MacAddress)
	if err != nil {
		return false
	}
	extraData, err := decodeConfiguredMAC(cfg.ExtraData)
	if err != nil {
		return false
	}

	payload := frame[ethernetHeaderLength:]
	if !bytes.Equal(payload[:6], wolSyncBytes) {
		return false
	}
	for offset := 6; offset < wolPayloadLength; offset += len(targetMAC) {
		if !bytes.Equal(payload[offset:offset+len(targetMAC)], targetMAC) {
			return false
		}
	}

	return bytes.Equal(payload[wolPayloadLength:shutdownPayloadSize], extraData)
}

func decodeConfiguredMAC(value string) ([]byte, error) {
	decoded, err := hex.DecodeString(strings.ReplaceAll(value, ":", ""))
	if err != nil || len(decoded) != 6 {
		return nil, fmt.Errorf("invalid six-byte value")
	}
	return decoded, nil
}

// getNetworkDevice returns the capture-device name rather than the operating
// system interface name, which is required by libpcap on Windows.
func getNetworkDevice() (string, string, error) {
	devices, err := pcap.FindAllDevs()
	if err != nil {
		return "", "", fmt.Errorf("could not list capture devices: %w", err)
	}
	interfaces, err := net.Interfaces()
	if err != nil {
		return "", "", fmt.Errorf("could not list network interfaces: %w", err)
	}

	for _, device := range devices {
		for _, deviceAddress := range device.Addresses {
			ip := deviceAddress.IP.To4()
			if ip == nil || ip.IsLoopback() {
				continue
			}
			for _, iface := range interfaces {
				if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 || len(iface.HardwareAddr) != 6 {
					continue
				}
				addresses, err := iface.Addrs()
				if err != nil {
					continue
				}
				for _, address := range addresses {
					ipNet, ok := address.(*net.IPNet)
					if ok && ipNet.IP.Equal(ip) {
						log.Printf("Selected capture device: %s - MAC: %s - IPv4: %s", device.Name, iface.HardwareAddr, ip)
						return device.Name, strings.ToLower(iface.HardwareAddr.String()), nil
					}
				}
			}
		}
	}

	return "", "", fmt.Errorf("could not select an active capture device")
}

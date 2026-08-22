package main

import (
	"bytes"
	"testing"
)

func makeShutdownFrame(mac, extra string) []byte {
	target, _ := decodeConfiguredMAC(mac)
	trailer, _ := decodeConfiguredMAC(extra)
	payload := append([]byte{}, wolSyncBytes...)
	for i := 0; i < 16; i++ {
		payload = append(payload, target...)
	}
	payload = append(payload, trailer...)
	return append(append(bytes.Repeat([]byte{0xff}, 6), []byte{0, 1, 2, 3, 4, 5, 0x08, 0x42}...), payload...)
}

func TestIsShutdownFrameAcceptsMatchingRawEthernetFrame(t *testing.T) {
	cfg := listenerConfig{MacAddress: "aa:bb:cc:dd:ee:ff", ExtraData: "11:22:33:44:55:66"}
	if !isShutdownFrame(makeShutdownFrame(cfg.MacAddress, cfg.ExtraData), cfg) {
		t.Fatal("expected matching raw Ethernet frame to be accepted")
	}
}

func TestIsShutdownFrameRejectsWakeFrameAndWrongDiscriminator(t *testing.T) {
	cfg := listenerConfig{MacAddress: "aa:bb:cc:dd:ee:ff", ExtraData: "11:22:33:44:55:66"}
	wakeFrame := makeShutdownFrame(cfg.MacAddress, cfg.ExtraData)[:ethernetHeaderLength+wolPayloadLength]
	if isShutdownFrame(wakeFrame, cfg) {
		t.Fatal("accepted a standard wake frame without shutdown data")
	}
	if isShutdownFrame(makeShutdownFrame(cfg.MacAddress, "66:55:44:33:22:11"), cfg) {
		t.Fatal("accepted a frame with a mismatched shutdown discriminator")
	}
}

func TestNormalizeExtraData(t *testing.T) {
	if value, err := normalizeExtraData(""); err != nil || value != "FF:FF:FF:FF:FF:FF" {
		t.Fatalf("unexpected default extra data: %q, %v", value, err)
	}
	if value, err := normalizeExtraData("1234aabbccdd"); err != nil || value != "12:34:AA:BB:CC:DD" {
		t.Fatalf("unexpected compact extra data normalization: %q, %v", value, err)
	}
	if _, err := normalizeExtraData("11:22:33:44:55"); err == nil {
		t.Fatal("accepted an invalid shutdown discriminator")
	}
}

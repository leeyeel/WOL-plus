package main

import (
	"encoding/hex"
	"strconv"
	"strings"
	"testing"
	"time"
)

func makeSignedControlRequest(command, mac, secret, nonce string, timestamp int64) []byte {
	signature := controlHMAC(secret, controlRequestCanonical(command, mac, timestamp, nonce))
	return []byte(strings.Join([]string{
		controlProtocol,
		command,
		mac,
		strconv.FormatInt(timestamp, 10),
		nonce,
		signature,
	}, " "))
}

func TestControlStatusReturnsSignedRunningAck(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	secret := strings.Repeat("ab", 32)
	cfg := listenerConfig{
		MacAddress:    "aa:bb:cc:dd:ee:ff",
		ControlPort:   "20250",
		ControlSecret: secret,
	}
	nonce := "00112233445566778899aabbccddeeff"
	request := makeSignedControlRequest(controlStatus, cfg.MacAddress, secret, nonce, now.Unix())

	response, accepted := handleControlPacket(request, cfg, now)
	if !accepted {
		t.Fatal("expected authenticated status request to be accepted")
	}

	fields := strings.Fields(string(response))
	if len(fields) != 9 {
		t.Fatalf("unexpected response fields: %q", response)
	}
	if fields[0] != controlProtocol || fields[1] != "ACK" || fields[2] != controlStatus || fields[6] != "RUNNING" || fields[7] != "0" {
		t.Fatalf("unexpected status response: %q", response)
	}

	responseRequest := controlRequest{
		command:   fields[2],
		mac:       fields[3],
		timestamp: now.Unix(),
		nonce:     fields[5],
	}
	expected := controlHMAC(secret, controlResponseCanonical(responseRequest, fields[6], 0))
	if fields[8] != expected {
		t.Fatalf("response HMAC mismatch: got %s want %s", fields[8], expected)
	}
}

func TestControlPacketRejectsBadSignatureAndExpiredTimestamp(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	secret := strings.Repeat("cd", 32)
	cfg := listenerConfig{MacAddress: "aa:bb:cc:dd:ee:ff", ControlSecret: secret}
	nonce := "00112233445566778899aabbccddeeff"

	badSignature := []byte(strings.Join([]string{
		controlProtocol,
		controlStatus,
		cfg.MacAddress,
		"1700000000",
		nonce,
		hex.EncodeToString(make([]byte, 32)),
	}, " "))
	if _, accepted := handleControlPacket(badSignature, cfg, now); accepted {
		t.Fatal("accepted a request with an invalid signature")
	}

	expired := makeSignedControlRequest(controlStatus, cfg.MacAddress, secret, nonce, now.Add(-controlMaxClockSkew-time.Second).Unix())
	if _, accepted := handleControlPacket(expired, cfg, now); accepted {
		t.Fatal("accepted an expired request")
	}
}

func TestControlValidation(t *testing.T) {
	if _, err := normalizeControlPort("1023"); err == nil {
		t.Fatal("accepted privileged control port")
	}
	if port, err := normalizeControlPort(""); err != nil || port != "20250" {
		t.Fatalf("unexpected default control port: %q, %v", port, err)
	}
	if _, err := normalizeControlSecret("invalid"); err == nil {
		t.Fatal("accepted invalid control secret")
	}
}

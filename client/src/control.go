package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	controlProtocol     = "WOLP/1"
	controlStatus       = "STATUS"
	controlShutdown     = "SHUTDOWN"
	controlMaxClockSkew = time.Minute
	controlReplayWindow = 5 * time.Minute
)

type controlRequest struct {
	command   string
	mac       string
	timestamp int64
	nonce     string
}

type controlReplay struct {
	payload   []byte
	expiresAt time.Time
}

var (
	controlReplayMutex sync.Mutex
	controlReplays     = make(map[string]controlReplay)
)

func controlRequestCanonical(command, mac string, timestamp int64, nonce string) string {
	return strings.Join([]string{
		controlProtocol,
		command,
		mac,
		strconv.FormatInt(timestamp, 10),
		nonce,
	}, "|")
}

func controlResponseCanonical(request controlRequest, state string, delay int) string {
	return strings.Join([]string{
		controlProtocol,
		"ACK",
		request.command,
		request.mac,
		strconv.FormatInt(request.timestamp, 10),
		request.nonce,
		state,
		strconv.Itoa(delay),
	}, "|")
}

func controlHMAC(secret, canonical string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	return hex.EncodeToString(mac.Sum(nil))
}

func parseControlRequest(payload []byte, cfg listenerConfig, now time.Time) (controlRequest, error) {
	fields := strings.Fields(string(payload))
	if len(fields) != 6 || fields[0] != controlProtocol {
		return controlRequest{}, fmt.Errorf("invalid control packet")
	}

	command := fields[1]
	if command != controlStatus && command != controlShutdown {
		return controlRequest{}, fmt.Errorf("unsupported control command")
	}

	mac, err := normalizeMACAddress(fields[2])
	if err != nil || !strings.EqualFold(mac, cfg.MacAddress) {
		return controlRequest{}, fmt.Errorf("unexpected target mac")
	}

	timestamp, err := strconv.ParseInt(fields[3], 10, 64)
	if err != nil || timestamp < now.Add(-controlMaxClockSkew).Unix() || timestamp > now.Add(controlMaxClockSkew).Unix() {
		return controlRequest{}, fmt.Errorf("expired control request")
	}

	nonce := strings.ToLower(fields[4])
	if len(nonce) != 32 {
		return controlRequest{}, fmt.Errorf("invalid control nonce")
	}
	if _, err := hex.DecodeString(nonce); err != nil {
		return controlRequest{}, fmt.Errorf("invalid control nonce")
	}

	expected := controlHMAC(cfg.ControlSecret, controlRequestCanonical(command, mac, timestamp, nonce))
	provided, err := hex.DecodeString(fields[5])
	expectedBytes, expectedErr := hex.DecodeString(expected)
	if err != nil || expectedErr != nil || !hmac.Equal(provided, expectedBytes) {
		return controlRequest{}, fmt.Errorf("invalid control signature")
	}

	return controlRequest{
		command:   command,
		mac:       mac,
		timestamp: timestamp,
		nonce:     nonce,
	}, nil
}

func makeControlResponse(request controlRequest, secret, state string, delay int) []byte {
	canonical := controlResponseCanonical(request, state, delay)
	signature := controlHMAC(secret, canonical)

	return []byte(fmt.Sprintf(
		"%s ACK %s %s %d %s %s %d %s\n",
		controlProtocol,
		request.command,
		request.mac,
		request.timestamp,
		request.nonce,
		state,
		delay,
		signature,
	))
}

func controlReplayKey(request controlRequest) string {
	return request.command + "|" + request.mac + "|" + request.nonce
}

func cachedControlResponse(request controlRequest, now time.Time) ([]byte, bool) {
	controlReplayMutex.Lock()
	defer controlReplayMutex.Unlock()

	for key, entry := range controlReplays {
		if !entry.expiresAt.After(now) {
			delete(controlReplays, key)
		}
	}

	entry, ok := controlReplays[controlReplayKey(request)]
	if !ok {
		return nil, false
	}

	return append([]byte(nil), entry.payload...), true
}

func cacheControlResponse(request controlRequest, payload []byte, now time.Time) {
	controlReplayMutex.Lock()
	defer controlReplayMutex.Unlock()

	controlReplays[controlReplayKey(request)] = controlReplay{
		payload:   append([]byte(nil), payload...),
		expiresAt: now.Add(controlReplayWindow),
	}
}

func handleControlPacket(payload []byte, cfg listenerConfig, now time.Time) ([]byte, bool) {
	request, err := parseControlRequest(payload, cfg, now)
	if err != nil {
		log.Printf("Rejected UDP control packet: %v", err)
		return nil, false
	}

	if request.command == controlShutdown {
		if cached, ok := cachedControlResponse(request, now); ok {
			return cached, true
		}
	}

	state := "RUNNING"
	delay := 0
	if request.command == controlShutdown {
		state, delay = initiateShutdown()
	}

	response := makeControlResponse(request, cfg.ControlSecret, state, delay)
	if request.command == controlShutdown {
		cacheControlResponse(request, response, now)
	}

	return response, true
}

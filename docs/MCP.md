# KKTerm Built-in MCP Server (`kkterm-cli`)

## Overview

KKTerm includes a Rust-native stdio MCP server binary, `kkterm-cli`, that
exposes a curated set of in-app capabilities to external MCP-capable tools
(Claude Desktop, Claude Code, Codex, GitHub Copilot, Antigravity, etc.).

The binary is a thin forwarder. The actual tool handlers live inside the
running KKTerm app and are reached over a Windows named pipe established
by `src-tauri/src/mcp_bridge.rs`.

Tool names are organised by **Module** (activity-rail destinations such as
Workspace and Dashboard). Each Module owns a top-level namespace, and any
sensitive tool lives under that Module's `dangerous` sub-namespace so the
safety gate applies uniformly:

- `kkterm.<module>.*` — curated allowlist tools for the named Module.
- `kkterm.<module>.dangerous.*` — sensitive tools (mutate UI, run script
  widget code, click into remote desktops); gated by
  `built_in_mcp_allow_all_dangerous`.

Namespaces in this build:

- `kkterm.workspace.*` — Workspace Module: saved Connections, live
  Sessions, remote-desktop capture/interaction, and the SFTP/FTP file
  browser.
- `kkterm.dashboard.*` — Dashboard Module: views, widget instances,
  AI-Created Widgets.
- `kkterm.network.*` — Network capability: read-only diagnostics (ping,
  DNS, TCP check, port scan, interfaces, Wake-on-LAN, WHOIS).
- `kkterm.watchdog.*` — Watchdog capability: background monitors that poll
  a target and fire when a predicate is met.
- `kkterm.app.*` — App capability: enumerate KKTerm's own UI windows and
  capture any of them (main window plus owned overlays) as an image.

`network`, `watchdog`, and `app` are assistant *capabilities*, not Activity-Rail
Modules (see `CONTEXT.md`); they get their own top-level namespace so the
same `kkterm.<group>.*` + optional `dangerous` convention applies uniformly.

## Architecture

```
+--------------------+   stdio JSON-RPC   +--------------+   named pipe    +-------------+
|  external MCP      | <----------------> |  kkterm-cli  | <-------------> |  kkterm.exe |
|  client (Claude…)  |                    |  (forwarder) |    JSON-RPC     |  (bridge)   |
+--------------------+                    +--------------+                 +-------------+
                                                                                  |
                                                                                  v
                                                                          SessionManager,
                                                                          Storage, frontend
                                                                          event bus
```

- `initialize`, `tools/list`, `ping`, and `notifications/initialized` are
  answered locally by `kkterm-cli` so MCP clients can introspect the
  surface even when KKTerm.exe is not running. The `tools/list` descriptors
  come from one shared catalog (`src-tauri/src/mcp_tool_catalog.rs`) used by
  both `kkterm-cli` and the in-app bridge, so offline discovery always
  matches the live surface.
- `tools/call` always forwards to the live app over the named pipe. When
  KKTerm.exe is not running (or the user has disabled the built-in MCP
  server), the binary returns a structured JSON-RPC error with
  `code: -32002` and `data.reason: "app_not_running"`.

## Transport

- **External transport:** stdio (one JSON-RPC message per line over
  stdin/stdout). The MCP client launches `kkterm-cli` as a child process.
- **Bridge transport:** Windows named pipe at
  `\\.\pipe\kkterm-mcp-<token-prefix>`; or, on macOS/Linux, a Unix domain socket
  at `<app_data_dir>/mcp-bridge.sock`. The endpoint is published in the bridge
  descriptor file (see below) under `pipeName` along with a per-launch bearer
  token.
- **Bridge descriptor file:** `<app_data_dir>/mcp-bridge.json`, where
  `app_data_dir` is `%APPDATA%\com.kkterm.app` (Windows),
  `~/Library/Application Support/com.kkterm.app` (macOS), or
  `$XDG_DATA_HOME/com.kkterm.app` ⇒ `~/.local/share/com.kkterm.app` (Linux).
  Written when KKTerm starts with the bridge enabled and removed on the next
  start before a new descriptor is written. Stale files cause clients to fail
  with `app_not_running`. The descriptor is restricted to the current user:
  `0600` on macOS/Linux, and on Windows KKTerm uses hidden `whoami` and `icacls`
  child processes to resolve the current user SID, remove inherited ACLs, and
  grant only that SID full control before publishing the descriptor; if that
  hardening fails, the bridge does not start. The macOS/Linux socket itself is
  likewise `0600`.
- **Auth:** the first framed line `kkterm-cli` sends on the pipe is the
  bearer token from the descriptor file. KKTerm.exe responds with
  `{"ok":true}` on success and closes the connection on mismatch.

### Windows descriptor ACL implementation note

The current implementation intentionally uses Windows command-line tools for
the descriptor ACL step: `whoami /user /fo csv /nh` provides the current
process user SID, and `icacls <path> /inheritance:r /grant:r *<SID>:(F)`
replaces inherited grants with full control for that SID only. `icacls.exe`
and `whoami.exe` are present on supported Windows installations, this keeps
the Rust code small, and the hardening runs once in a background bridge startup
thread rather than blocking the app startup path or a hot path. Both child
processes are launched with `CREATE_NO_WINDOW` so they do not flash console
windows. The bridge fails closed and deletes the descriptor if these tools
cannot be run or return an error.

A direct Win32 API implementation was considered for this hardening. It would
avoid spawning `whoami` and `icacls`, but it requires enabling additional
Windows security bindings such as `Win32_Security` and
`Win32_Security_Authorization` and writing careful `unsafe` code around APIs
such as `OpenProcessToken`, `GetTokenInformation`, `ConvertSidToStringSidW`,
`ConvertStringSecurityDescriptorToSecurityDescriptorW`, `SetFileSecurityW`,
`CloseHandle`, and `LocalFree`. If the command-line approach proves unreliable
in a supported Windows environment, revisit the direct Win32 path with focused
Windows runtime testing for handle cleanup, DACL protection, non-ASCII paths,
and domain/local account SID behavior.

## Tool safety model

Two settings live in `AiProviderSettings` and are surfaced under
**Settings → AI Assistant → Built-in MCP Server**:

| Setting key | Default | Effect |
|---|---|---|
| `built_in_mcp_server_enabled` | `true` | KKTerm starts the bridge on launch (named pipe on Windows, Unix domain socket on macOS/Linux). When `false`, the descriptor file is deleted and no bridge is created. |
| `built_in_mcp_allow_all_dangerous` | `false` | When `true`, tools in any `kkterm.<module>.dangerous.*` namespace execute through the bridge. When `false`, the bridge returns a `permissionRequired` tool error for any dangerous call. The gate matches the literal segment `dangerous` anywhere in the dotted tool name, so new Modules can adopt the same convention without touching the gate. |

Remote MCP HTTP servers use HTTPS by default. Plain `http://` is accepted for
loopback hosts (`localhost`, `127.0.0.1`, and `::1`); other local/network HTTP
servers require the separate Settings → AI Assistant insecure Remote MCP HTTP
toggle.

The bridge reads both settings at startup. Toggling either takes effect on
the next KKTerm.exe launch.

## Tool list

### Workspace Module (`kkterm.workspace.*`)

The Workspace Module owns saved Connections and live Sessions
(terminals, SFTP browsers, RDP/VNC surfaces, WebView2 panes).

| Name | Description |
|---|---|
| `kkterm.workspace.connections.list` | List saved Connections (folders + connections) from KKTerm storage. |
| `kkterm.workspace.connections.create` | Create a saved Connection in KKTerm storage. This is a safe tool: it does not accept passwords or other secrets, and saved credentials still go through KKTerm's normal keychain-backed secret flows. |
| `kkterm.workspace.connections.update` | Update one saved Connection by `connectionId`. Submit the full updated Connection fields. This tool does not accept passwords or other secrets. |
| `kkterm.workspace.connections.rename` | Rename one saved Connection by `connectionId`. |
| `kkterm.workspace.connections.delete` | Delete one saved Connection by `connectionId`. |
| `kkterm.workspace.connections.move` | Move one saved Connection by `connectionId` to a `folderId` and `targetIndex`; use `folderId: null` for the root list. |
| `kkterm.workspace.connection_folders.create` | Create a Connection folder with `name` and `parentFolderId`; use `parentFolderId: null` for a root folder. |
| `kkterm.workspace.connection_folders.rename` | Rename one Connection folder by `folderId`. |
| `kkterm.workspace.connection_folders.delete` | Delete one Connection folder by `folderId`, including contained saved Connections and nested folders. |
| `kkterm.workspace.connection_folders.move` | Move one Connection folder by `folderId` to `parentFolderId` and `targetIndex`; use `parentFolderId: null` for the root list. |
| `kkterm.workspace.connections.open` | Open a saved Connection by `connectionId`. Routes through the existing AI assistant `connection_open` path and emits `assistant-open-connection` for the frontend to start the appropriate session (terminal, SSH, URL, RDP, VNC). |
| `kkterm.workspace.connections.screenshot` | Capture the visible Workspace Canvas for an open Connection by `connectionId`. The app activates the matching Tab before capture and returns a JPEG data URL plus dimensions. |
| `kkterm.workspace.sessions.list` | List live Sessions (terminal Panes, remote desktop targets, file browsers). Backed by `session_state`. |
| `kkterm.workspace.sessions.send_input` | Send text/keystrokes to a live terminal Pane. `submit: true` appends a terminal Enter key as carriage return (`\r`) after the text. Backed by `session_terminal_send_text`. |
| `kkterm.workspace.sessions.read_buffer` | Read a snapshot of the visible terminal buffer for a live Pane. Backed by `session_terminal_read_buffer`. |
| `kkterm.workspace.quick_commands.list` | List saved Quick Commands for a Connection's Quick Command Bar. Backed by `quick_command_list` through the frontend live-tool bridge because Quick Commands live in workspace storage. |
| `kkterm.workspace.quick_commands.read` | Read one saved Quick Command for a Connection by Quick Command id. Backed by `quick_command_read`. |

For `kkterm.workspace.connections.create` and `kkterm.workspace.connections.update`, `localStartupDirectory` is a non-secret startup path slot. For SSH Connections it is a remote directory that the terminal changes into after login; for local terminal and File Explorer Connections it remains a local directory, and for Document Connections it stores the local file path.

### Workspace Module — dangerous (`kkterm.workspace.dangerous.*`)

| Name | Description |
|---|---|
| `kkterm.workspace.dangerous.pointer_click` | Send a mouse click to a live RDP/VNC remote desktop surface. Requires `built_in_mcp_allow_all_dangerous = true`. Backed by `session_remote_desktop_mouse_click`. |

### Workspace Module — Quick Commands dangerous (`kkterm.workspace.quick_commands.dangerous.*`)

| Name | Description |
|---|---|
| `kkterm.workspace.quick_commands.dangerous.create` | Create a saved Quick Command for a Connection's Quick Command Bar. Requires `built_in_mcp_allow_all_dangerous = true`. Backed by `quick_command_create`; it saves a runnable shortcut but does not execute the command. |
| `kkterm.workspace.quick_commands.dangerous.edit` | Edit one saved Quick Command for a Connection's Quick Command Bar. Requires `built_in_mcp_allow_all_dangerous = true`. Backed by `quick_command_edit`; it updates a runnable shortcut but does not execute the command. |

### Workspace Module — SFTP/FTP file browser (`kkterm.workspace.file_browser.*`)

Backed by the frontend live-tool bridge (`session_file_browser_*`), so MCP and
the in-app assistant drive the same active file browser Session.

| Name | Description |
|---|---|
| `kkterm.workspace.file_browser.list` | List entries in an active SFTP/FTP file browser Session. Defaults to the browser's current remote path. Safe (read-only). Backed by `session_file_browser_list`. |
| `kkterm.workspace.file_browser.dangerous.create_folder` | Create a folder in an active file browser Session. Requires `built_in_mcp_allow_all_dangerous = true`. Backed by `session_file_browser_create_folder`. |
| `kkterm.workspace.file_browser.dangerous.rename` | Rename a path in an active file browser Session. Requires Allow-all. Backed by `session_file_browser_rename`. |
| `kkterm.workspace.file_browser.dangerous.delete` | Delete a path in an active file browser Session. Requires Allow-all. Backed by `session_file_browser_delete`. |

### Workspace Module — remote desktop capture/input

The safe screenshot tool lives under `kkterm.workspace.sessions.*`; the
input tools join `pointer_click` under `kkterm.workspace.dangerous.*`.

| Name | Description |
|---|---|
| `kkterm.workspace.sessions.remote_desktop_screenshot` | Capture the active RDP/VNC remote desktop surface as a PNG data URL. Safe (read-only); the image may include sensitive remote screen content. Backed by `session_remote_desktop_screenshot`. |
| `kkterm.workspace.dangerous.remote_desktop_send_text` | Type text into a live RDP/VNC remote desktop Session (`pressEnter` submits). Requires Allow-all. Backed by `session_remote_desktop_send_text`. |
| `kkterm.workspace.dangerous.remote_desktop_keypress` | Send a named key press to a live RDP/VNC remote desktop Session. Requires Allow-all. Backed by `session_remote_desktop_keypress`. |

### Dashboard Module (`kkterm.dashboard.*`)

Safe view/instance/layout operations. Backed by the same `dashboard_*` AI
tools in `src-tauri/src/ai.rs`, so MCP and the in-app assistant share one
storage and event path (`dashboard-changed` is emitted on mutations).

| Name | Description |
|---|---|
| `kkterm.dashboard.load_state` | Read the redacted Dashboard state (views + instances + AI widget metadata). |
| `kkterm.dashboard.screenshot_view` | Capture an entire Dashboard View by optional `viewId` (defaults to the active View). The app activates the Dashboard View before capture and returns a JPEG data URL plus dimensions. |
| `kkterm.dashboard.screenshot_widget` | Capture a single Dashboard Widget Instance region by `instanceId`. The app activates the owning Dashboard View before capture and returns a JPEG data URL plus dimensions. |
| `kkterm.dashboard.read_widget_source` | Fetch the script body of a single AI-Created Widget by id. |
| `kkterm.dashboard.create_view` | Add a new Dashboard view. |
| `kkterm.dashboard.update_view` | Edit a view (title, gridDensity). |
| `kkterm.dashboard.remove_view` | Delete a view and its instances. |
| `kkterm.dashboard.reorder_views` | Reorder views by id list. |
| `kkterm.dashboard.add_instance` | Place a widget instance on a view (built-in widget or AI widget by `sourceId`). |
| `kkterm.dashboard.update_instance` | Change a widget instance's size, position, preset, accent, or icon. |
| `kkterm.dashboard.remove_instance` | Remove a widget instance. |
| `kkterm.dashboard.apply_layout` | Bulk-update many instance positions on a single view. |

### Dashboard Module — dangerous (`kkterm.dashboard.dangerous.*`)

These tools touch executable widget code or wipe Dashboard data, so they
go through the `built_in_mcp_allow_all_dangerous` gate. The bridge looks
for the literal segment `dangerous` anywhere in the dotted tool name when
applying the gate, so every Module's `dangerous` sub-namespace gets the
same protection without any per-Module gate code.

| Name | Description |
|---|---|
| `kkterm.dashboard.dangerous.create_widget` | Create an AI-Created (script) Widget AND place it on a view. Requires `widgetArchetype` (`dataMonitor`, `metricChart`, `utilityInstrument`, `desktopObject`, `canvasToyGame`, or last-resort `generalWorkbench`) so callers choose the scaffold before providing script source. |
| `kkterm.dashboard.dangerous.create_custom_widget` | Create a reusable AI-Created Widget definition without placement. |
| `kkterm.dashboard.dangerous.update_custom_widget` | Edit an existing AI-Created Widget body/title/etc. |
| `kkterm.dashboard.dangerous.remove_custom_widget` | Delete an AI-Created Widget definition (use `forceDeleteInstances` to also remove placements). |
| `kkterm.dashboard.dangerous.reset` | Wipe the entire Dashboard. Irreversible. |

### Network capability (`kkterm.network.*`)

Read-only network diagnostics. Backed by `crate::ai::network_tool`, the same
implementation the in-app assistant uses. A failed probe (host down, port
closed) is returned as a normal result payload (`ok: false` with a `netError`),
not an MCP tool error, so callers can read the diagnostic outcome. All safe.

| Name | Description |
|---|---|
| `kkterm.network.ping` | Ping a host (ICMP with TCP fallback). Returns per-packet RTT replies and availability. |
| `kkterm.network.dns` | Resolve a hostname via DNS. Returns records and resolver RTT. |
| `kkterm.network.tcp_check` | Check whether a TCP port is open on a host. Returns open/closed status and RTT. |
| `kkterm.network.port_scan` | Scan a list of TCP ports on a host. Returns open/closed status per port. |
| `kkterm.network.interfaces` | List local network interfaces with their IP and MAC addresses. |
| `kkterm.network.wol` | Send a Wake-on-LAN magic packet to a MAC address. |
| `kkterm.network.whois` | Run a WHOIS lookup for a domain name or IP address. |

### Watchdog capability (`kkterm.watchdog.*`)

Background monitors that poll a target and fire when a predicate is met.
Backed by `crate::ai::watchdog_tool`. Creating a watchdog is gated because a
watchdog can carry an `aiIntervene` action that grants standing permission to
run other tools; that path additionally prompts for in-app approval at the
KKTerm window before the watchdog is created.

| Name | Description |
|---|---|
| `kkterm.watchdog.list` | List all background watchdogs known to this app session (id, name, state, lastValue, triggerCount, pollCount). |
| `kkterm.watchdog.get_report` | Fetch the full report for one watchdog by id: config, current state, recent tick history, and the trigger event log. |
| `kkterm.watchdog.cancel` | Cancel a running watchdog by id; stops polling and marks it canceled. |
| `kkterm.watchdog.dangerous.create` | Create a background watchdog from a structured `config`. Requires `built_in_mcp_allow_all_dangerous = true`; an `aiIntervene` action also prompts for in-app approval. Backed by `watchdog_create`. |

### App capability (`kkterm.app.*`)

Universal in-app window enumeration and capture. Unlike the curated
element-level screenshots (`workspace.connections.screenshot`,
`dashboard.screenshot_*`), these address KKTerm's own OS windows directly and run
in-process (no frontend bridge), so they work regardless of the webview's current
state. Capture is implemented natively per platform: Windows reuses the GDI
screen-rect path (so WebView2 / remote-desktop content is preserved); macOS and
Linux use the `xcap` crate. On macOS the app needs the **Screen Recording**
permission, or capture fails with a clear error.

| Name | Description |
|---|---|
| `kkterm.app.list_windows` | List KKTerm's own UI windows (main window plus owned overlays such as the URL WebView2, RDP, and VNC surfaces). Returns each window's `id` (stable Tauri label), `title`, `kind`, bounds, and visibility. Safe (read-only). |
| `kkterm.app.dangerous.capture_window` | DANGEROUS: capture any KKTerm UI window by `windowId` as a JPEG data URL plus dimensions. The image may include sensitive terminal, remote-desktop, URL, or file content. Requires `built_in_mcp_allow_all_dangerous = true`; on macOS requires the Screen Recording permission. |

All tool inputs use JSON schemas published in `tools/list`. The handler in
the bridge translates the curated `kkterm.<module>.*` names into the
existing AI assistant tool functions in `src-tauri/src/ai.rs`, so MCP and
the in-app assistant share one implementation. Screenshot tools are safe
tools because they only read the currently rendered KKTerm UI, but they do
return image data that may include visible terminal, remote desktop, URL,
file, or widget content. They do not bypass the normal desktop rendering
path and cannot capture hidden/unmounted content.

### Adding a new Module

When a new activity-rail Module is added, give
it its own `kkterm.<module>.*` namespace and, if any of its tools touch
executable code or wipe data, a `kkterm.<module>.dangerous.*` sibling.
The gate, the `tools/list` discovery path, and the bridge dispatcher do
not need per-Module changes — only schema and dispatch arms.

## Feature growth contract (required for new MCP functions)

When adding a new built-in MCP function/tool, update all of the following
in the same PR:

1. `src-tauri/src/mcp_tool_catalog.rs`
   - add the tool's descriptor (name, description, schema) to
     `tool_descriptors()`. This is the single source of truth for the
     published `tools/list` surface: the in-app bridge
     (`mcp_bridge.rs`) and the offline `kkterm-cli` forwarder both read it
     (the binary includes the same file with `#[path]`), so their surfaces
     stay identical without a second hand-maintained list.
2. `src-tauri/src/mcp_bridge.rs`
   - add a match arm in `dispatch_tool()` translating to the appropriate
     `crate::ai::connection_tool` / `crate::ai::live_session_tool` /
     `crate::ai::dashboard_tool` call, or a direct capability call such as
     `crate::ai::network_tool` / `crate::ai::watchdog_tool` /
     `crate::screenshot::*` for capabilities that have no in-app assistant tool
   - if the tool is sensitive, put it in a `*.dangerous.*` namespace so
     the existing `dangerous_tool()` gate catches it without changes
3. `docs/MCP.md`
   - add the tool to the namespace list above
   - document risk level and confirmation behavior
4. `docs/manual/15-settings.md`
   - update Built-in MCP Server setting behavior if safety toggles change
5. `AGENTS.md`
   - the update rule there references MCP docs; do not remove it

## Client setup examples

Use the `kkterm-cli` binary path in your MCP client settings. The release build
lives next to the KKTerm executable: `kkterm-cli.exe` beside `kkterm.exe` on
Windows, and `kkterm-cli` beside the app binary on macOS/Linux.

- **Claude Code / Claude Desktop style config**
```json
{
  "mcpServers": {
    "kkterm": {
      "command": "<path-to-kkterm-cli>",
      "args": []
    }
  }
}
```

- **Codex-style local MCP command**
  - config location: `~/.codex/config.toml`
  - CLI command for user/global config: `codex mcp add kkterm -- <path-to-kkterm-cli>`
  - project-scoped config: manually add the same TOML shape to `.codex/config.toml`

```toml
[mcp_servers.kkterm]
command = "<path-to-kkterm-cli>"
args = []
```

- **GitHub Copilot agent/tooling that supports MCP stdio**
  - config location: `.vscode/mcp.json` in the workspace or the user MCP config
  - use the VS Code `MCP: Add Server` command or manually register `kkterm-cli`
    as an MCP stdio server command in the `servers` map

- **Antigravity / other MCP-capable clients**
  - config location: `~/.gemini/antigravity/mcp_config.json`
  - MCP settings use the common `mcpServers` JSON object
  - add a stdio server command pointing to `kkterm-cli`

- **OpenCode**
  - config location: `opencode.json`, commonly `~/.config/opencode/opencode.json`
  - manually add `kkterm` under the `mcp` object with local transport

After configuration, start KKTerm.exe (so the bridge is available),
reconnect the client, and run `tools/list` to verify connectivity. The
client should see the published tool list; `tools/call` requires KKTerm.exe
to be running.

On Windows, macOS, and Linux, Settings → AI Assistant → Built-in MCP Server
includes a "Show config" action. The config dialog opens only from that action;
changing either MCP toggle never opens it. It contains JSON and TOML snippets
whose `command` is the resolved `kkterm-cli` path beside the running KKTerm
executable. Its setup table shows
copyable command examples for clients that support CLI MCP registration and
config paths for clients that require manual editing.
Debug builds write built-in and remote MCP request/response records to
`mcp.debug.log` beside `kkterm.log`. Release builds write the same log only
when Settings → General → Debug → Advanced Debugging is enabled; enabling the
setting writes an `advanced_debugging.enabled` marker so the release logging
path is visible before the next MCP request. Built-in MCP debug records redact
terminal and remote-desktop send-text input, terminal buffer reads, Dashboard
widget source/body JSON, and secret-looking argument fields before writing.

## Platform support

The bridge is cross-platform. The transport differs by OS but the descriptor
file, bearer-token auth, tool surface, and safety gate are identical:

- **Windows:** named pipe `\\.\pipe\kkterm-mcp-<token-prefix>`.
- **macOS / Linux:** a Unix domain socket at `<app_data_dir>/mcp-bridge.sock`,
  created with `0600` permissions so only the current user can connect. Its path
  is published in the descriptor's `pipeName` field (the field name is kept for
  format compatibility). The socket is bound *before* the descriptor is written,
  so a client that reads the descriptor can always connect.

On every supported OS, `kkterm-cli` answers `initialize` / `tools/list` locally
(so clients can introspect even when KKTerm is not running) and forwards
`tools/call` to the live app. When the app is not running or the built-in MCP
server is disabled, `tools/call` returns `app_not_running` (`code: -32002`). The
Settings → AI Assistant built-in MCP controls are shown on Windows, macOS, and
Linux.

`kkterm-cli` uses MCP protocol version `2025-03-26`. It rejects a different
requested initialize version with `-32602` and never sends JSON-RPC responses
for notifications.

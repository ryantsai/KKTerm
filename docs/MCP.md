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

- `kkterm.workspace.*` — Workspace Module: durable Workspaces, saved
  Connections, live Sessions, remote-desktop capture/interaction, and the
  SFTP/FTP file browser.
- `kkterm.dashboard.*` — Dashboard Module: views, widget instances,
  AI-Created Widgets.
- `kkterm.screenshots.*` — Screenshots Module: captures, library reads,
  transforms, file actions, and destructive library management.
- `kkterm.itops.*` — IT Ops Module: Sites, Server Rooms, Racks, Rack
  Devices, Room Objects, presentation metadata, Hosts, Tasks, Automations,
  and Batch Runs.
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

The Workspace Module owns durable Workspaces, saved Connections, and live
Sessions (terminals, SFTP browsers, RDP/VNC surfaces, WebView2 panes).

#### Workspaces

| Name | Description |
|---|---|
| `kkterm.workspace.workspaces.list` | List durable Workspaces and their ids, names, icon metadata, default flag, and order. |
| `kkterm.workspace.workspaces.create` | Create a Workspace. Optional `importConnectionIds` copy saved Connections from existing Workspaces into it as independent durable Connections. |
| `kkterm.workspace.workspaces.rename` | Rename or restyle one Workspace by id with full-value icon fields. |
| `kkterm.workspace.workspaces.reorder` | Reorder Workspaces by an ordered id list. |
| `kkterm.workspace.workspaces.dangerous.delete` | Delete a non-default Workspace and all saved Connections and folders it owns. Requires Allow-all. The `workspaces-changed` reload closes Tabs and live Sessions owned by the removed Workspace. |

Workspace mutations use the same storage functions as the Activity Rail and
emit `workspaces-changed`; the rail reloads without an app restart. Use a
Workspace id as `workspaceId` when creating a Connection or Connection folder.

| Name | Description |
|---|---|
| `kkterm.workspace.connections.list` | List saved Connections (folders + connections) from KKTerm storage. |
| `kkterm.workspace.connections.create` | Create a saved Connection in KKTerm storage, optionally in `workspaceId`. Supported kinds match the app: local terminal, SSH, Telnet, Serial, URL, RDP, VNC, FTP/FTPS/SFTP, File Explorer (`localFiles`), and Document (`fileView`). This is a safe tool: it does not accept passwords or other secrets, and saved credentials still go through KKTerm's normal keychain-backed secret flows. |
| `kkterm.workspace.connections.update` | Update one saved Connection by `connectionId`. Submit the full updated Connection fields. This tool does not accept passwords or other secrets. |
| `kkterm.workspace.connections.rename` | Rename one saved Connection by `connectionId`. |
| `kkterm.workspace.connections.delete` | Delete one saved Connection by `connectionId`. |
| `kkterm.workspace.connections.move` | Move one saved Connection by `connectionId` to a `folderId` and `targetIndex`; use `folderId: null` for the root list. |
| `kkterm.workspace.connection_folders.create` | Create a Connection folder with `name` and `parentFolderId`; use `parentFolderId: null` for a root folder. |
| `kkterm.workspace.connection_folders.rename` | Rename one Connection folder by `folderId`. |
| `kkterm.workspace.connection_folders.delete` | Delete one Connection folder by `folderId`, including contained saved Connections and nested folders. |
| `kkterm.workspace.connection_folders.move` | Move one Connection folder by `folderId` to `parentFolderId` and `targetIndex`; use `parentFolderId: null` for the root list. |
| `kkterm.workspace.connections.open` | Open a saved Connection by `connectionId`. Routes through the existing AI assistant `connection_open` path and emits `assistant-open-connection` for the frontend to start the appropriate Session or local surface for every supported Connection kind. |
| `kkterm.workspace.connections.screenshot` | Capture the visible Workspace Canvas for an open Connection by `connectionId`. The app activates the matching Tab before capture and returns a JPEG data URL plus dimensions. |
| `kkterm.workspace.sessions.list` | List live Sessions (terminal Panes, remote desktop targets, file browsers). Backed by `session_state`. |
| `kkterm.workspace.sessions.read_buffer` | Read a snapshot of the visible terminal buffer for a live Pane. Backed by `session_terminal_read_buffer`. |
| `kkterm.workspace.quick_commands.list` | List saved Quick Commands for a Connection's Quick Command Bar. Backed by `quick_command_list` through the frontend live-tool bridge because Quick Commands live in workspace storage. |
| `kkterm.workspace.quick_commands.read` | Read one saved Quick Command for a Connection by Quick Command id. Backed by `quick_command_read`. |

### Workspace Module — dangerous (`kkterm.workspace.dangerous.*`)

| Name | Description |
|---|---|
| `kkterm.workspace.dangerous.pointer_click` | Send a mouse click to a live RDP/VNC remote desktop surface. Requires `built_in_mcp_allow_all_dangerous = true`. Backed by `session_remote_desktop_mouse_click`. |
| `kkterm.workspace.sessions.dangerous.send_input` | Send text/keystrokes to a live terminal Pane. `submit: true` appends a terminal Enter key as carriage return (`\r`). Requires Allow-all because submitted text can execute commands. Backed by `session_terminal_send_text`. |

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
| `kkterm.dashboard.check_widget_health` | Read one Widget Instance's live runtime health, waiting briefly for the frontend smoke test. Returns `ready`, `error`, `timeout`, `stalled`, or `pending`; read-only and safe. |
| `kkterm.dashboard.create_view` | Add a new Dashboard view. |
| `kkterm.dashboard.update_view` | Edit a view (title, gridDensity, sortOrder, background, tabColor). |
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

### Screenshots Module (`kkterm.screenshots.*`)

The Screenshots Module tools use the configured library folder, format,
quality, Capture Mode, border, cursor, and acceleration settings. Listing,
copying, non-destructive transforms, rename, and explicit operating-system file
actions are available normally. Full-image reads and captures can expose
sensitive screen content; edited-image overwrite and deletion can replace or
destroy files. Those operations use the `dangerous` namespace and require
`built_in_mcp_allow_all_dangerous = true`.

| Name | Description |
|---|---|
| `kkterm.screenshots.list` | List paginated library thumbnails and metadata with date/name/type sorting. |
| `kkterm.screenshots.rename` | Rename one screenshot while preserving its extension. |
| `kkterm.screenshots.copy_to_clipboard` | Copy one screenshot to the operating-system clipboard. |
| `kkterm.screenshots.resize` | Create resized copies by exact dimensions or percentage; originals remain unchanged. |
| `kkterm.screenshots.convert` | Create converted PNG/JPEG/WebP/GIF copies; originals remain unchanged. |
| `kkterm.screenshots.open_folder` | Open the configured library folder in the file manager. |
| `kkterm.screenshots.reveal` | Reveal one screenshot in the file manager. |
| `kkterm.screenshots.open_file` | Open one screenshot in the default image application. |

### Screenshots Module — dangerous (`kkterm.screenshots.dangerous.*`)

| Name | Description |
|---|---|
| `kkterm.screenshots.dangerous.read` | Read one full-size screenshot as a base64 data URL. |
| `kkterm.screenshots.dangerous.save_edited` | Save edited image data as a copy or overwrite the original. |
| `kkterm.screenshots.dangerous.delete` | Permanently delete one screenshot. |
| `kkterm.screenshots.dangerous.delete_batch` | Permanently delete multiple screenshots. |
| `kkterm.screenshots.dangerous.clear` | Permanently clear the complete configured library. |
| `kkterm.screenshots.dangerous.capture_rect` | Capture an exact screen rectangle in monitor coordinates. |
| `kkterm.screenshots.dangerous.capture_region` | Open the interactive region selector and capture the chosen screen area. |
| `kkterm.screenshots.dangerous.capture_window` | Interactively choose and capture a window. |
| `kkterm.screenshots.dangerous.capture_fullscreen` | Capture the full virtual screen across all monitors. |

### IT Ops Module (`kkterm.itops.*`)

The full IT Ops Module surface (docs/ITOPS.md): Site topology and Rack Device
placement, the Host inventory, the global Task Library, durable Automations,
and Batch Runs. Backed by `crate::ai::itops_tool`, the same implementation the
in-app assistant's `itops_*` tools use, so MCP and the assistant share one
storage path. Mutations emit `itops-changed` so the IT Ops UI reloads.

Safe tools are durable data reads/writes with no executable code and no
secrets; in the in-app assistant every mutating tool still goes through the
per-call approval prompt unless the tool permission mode is Allow-all. Tools
that author or execute runnable material — Task definitions, Automations
(their `runBatch` actions later execute scripts unattended), and starting a
Batch Run (remote code execution on every resolved host) — live in
`kkterm.itops.*.dangerous.*` namespaces behind the
`built_in_mcp_allow_all_dangerous` gate. Assistant-authored Tasks, Automation
`runBatch` payloads, and playbooks may never introduce sudo steps or
secret-vault references; those are configured only in the Task Library editor.
The topology invariant is Site → Server Room → Rack → Rack Device: create the
parent first.

| Name | Description |
|---|---|
| `kkterm.itops.sites.list` | List IT Ops Sites (id, name, memberIds, filter, transport). Presentation-heavy fields (backgrounds, icon images) are omitted. |
| `kkterm.itops.sites.create` | Create a Site. Optional `memberIds` reference saved Connection ids; `transport` defaults to `auto`. |
| `kkterm.itops.sites.update` | Update one Site by id. Omitted fields keep their current values; presentation fields (icons, backgrounds) are always preserved. |
| `kkterm.itops.sites.remove` | Delete one Site by id including its Server Rooms, Racks, Rack Devices, and Hosts. Saved Connections and Run History survive; the Default Site cannot be deleted. |
| `kkterm.itops.sites.reorder` | Reorder all Sites by an ordered id list. |
| `kkterm.itops.sites.resolve` | Resolve one Site to its runnable Connection-backed hosts. |
| `kkterm.itops.sites.set_background` | Set or clear the Site-view presentation background. |
| `kkterm.itops.server_rooms.list` | List one Site's Server Rooms by `siteId`. |
| `kkterm.itops.server_rooms.create` | Create a Server Room in a Site. `floorColor` defaults to `default`. |
| `kkterm.itops.server_rooms.update` | Update one Server Room by id. Full-value semantics: read the room first and resend `name` and `floorColor`. |
| `kkterm.itops.server_rooms.remove` | Delete one Server Room by id, including its Racks and placements. |
| `kkterm.itops.server_rooms.duplicate` | Duplicate a Server Room with its Racks, Rack Device placements, and Room Objects. |
| `kkterm.itops.server_rooms.set_background` | Set or clear a Server Room presentation background. |
| `kkterm.itops.server_rooms.set_icon` | Set or clear a Server Room icon. |
| `kkterm.itops.racks.list` | List one Site's Racks by `siteId`, each with its placed Rack Devices in U order. |
| `kkterm.itops.racks.create` | Create a Rack in a Site. `serverRoom` names an existing Server Room in the same Site; `heightU` defaults to 42, `depthMm` to 1000. |
| `kkterm.itops.racks.update` | Update one Rack by id. Full-value semantics; shrinking `heightU` is rejected while placed devices would no longer fit. |
| `kkterm.itops.racks.remove` | Delete one Rack by id, including its Rack Device placements. |
| `kkterm.itops.racks.duplicate` | Duplicate a Rack and its Rack Device placements with optional grid placement/facing. |
| `kkterm.itops.racks.reorder` | Reorder all Racks in one Site by an ordered id list. |
| `kkterm.itops.racks.set_placements` | Batch-set floor-plan or 2.5D-grid Rack placements. |
| `kkterm.itops.racks.set_facings` | Batch-set Rack quarter-turn facings. |
| `kkterm.itops.racks.set_background` | Set or clear one Rack's presentation background. |
| `kkterm.itops.rack_items.place` | Place one Rack Device. `mountFace` is `front` or `rear` (default `front`); in-cabinet spans use the lowest occupied `startU` (1 = bottom) and are validated against bounds/overlaps on that face. A rack-top package uses kind `kuaiguai`, `startU = rack.heightU + 1`, height 4 with `metadata.kuaiguaiStyle = "full"` (or height 1 with `"laidDown"`), and optional ISO `metadata.expiry`; only one may occupy a Rack top regardless of face. Kind `connection` requires `connectionId`. |
| `kkterm.itops.rack_items.update` | Update one Rack Device's kind, label, Connection binding, `mountFace`, or metadata by id. Moving to another face re-validates the occupied span there. The kind enum includes `kuaiguai`, with typed expiry/style/size/rotation metadata. Full-value semantics: omitted metadata clears stored metadata. |
| `kkterm.itops.rack_items.move` | Move and/or resize one Rack Device by id, possibly into a different Rack or onto its `front`/`rear` `mountFace`; the new face and span are re-validated. |
| `kkterm.itops.rack_items.remove` | Remove one Rack Device placement by id. Bound saved Connections are untouched. |
| `kkterm.itops.rack_items.refresh_snmp` | Refresh one Rack Device's SNMP telemetry using its existing Connection and metadata. |
| `kkterm.itops.room_objects.list` | List all non-Rack Room Objects in one Server Room. |
| `kkterm.itops.room_objects.set` | Replace one Server Room's complete Room Object set. |
| `kkterm.itops.connections.get` | Read one saved Connection used by an IT Ops binding; secrets are omitted. |
| `kkterm.itops.hosts.list` | List one Site's Hosts by `siteId`: hostname, kind, parent Host, bound Connection ids, and last connectivity-scan snapshot. |
| `kkterm.itops.hosts.create` | Create one Host in a Site's inventory. `parentHostId` nests it as a VM/container guest. |
| `kkterm.itops.hosts.update` | Update one Host by id. Full-value semantics; `connectionIds` are ordered saved Connection references, and the first bound SSH Connection makes the Host runnable. |
| `kkterm.itops.hosts.remove` | Delete one Host by id. Child Hosts re-parent one level up. |
| `kkterm.itops.hosts.import` | Bulk-import a hostname list into a Site. Blanks and case-insensitive duplicates are skipped, not errors. |
| `kkterm.itops.hosts.scan` | Probe a Site's Hosts (all or by `hostIds`) for SSH (22), WinRM (5985/5986), and HTTPS (443) with bounded TCP probes; waits for completion, persists each snapshot, and returns the updated list. |
| `kkterm.itops.tasks.list` | List the global Task Library: metadata plus a redacted one-line summary per Task, never full script bodies. |
| `kkterm.itops.tasks.get` | Read one Task's full definition by id (script body or playbook steps). |
| `kkterm.itops.tasks.remove` | Delete one user Task by id (built-ins are protected). Run History keeps its redacted summaries; orphaned task credentials are removed from the vault. |
| `kkterm.itops.automations.list` | List durable Automations: name, enabled, trigger/condition config, ordered actions, optional Site binding. |
| `kkterm.itops.automations.remove` | Delete one Automation by id, disarming its live Watchdog first. |
| `kkterm.itops.automations.test` | Dry-run an Automation trigger: sample the target once and report the value plus whether the condition would fire. No actions execute; nothing is stored. |
| `kkterm.itops.runs.cancel` | Cancel a live Batch Run by `runId`; finished hosts keep their results and the partial report is persisted. |
| `kkterm.itops.runs.list` | List completed Batch Run reports with per-host outcome rows (ok, exitCode, durationMs, error) but no output text. |
| `kkterm.itops.runs.get_report` | Read one run's consolidated report by `runId` including per-host output, tail-capped by `maxOutputChars` (default 4000). The output may include sensitive remote command results. |

### IT Ops Module — dangerous (`kkterm.itops.*.dangerous.*`)

These tools author or execute runnable material, so they require
`built_in_mcp_allow_all_dangerous = true` (the gate matches the literal
`dangerous` segment anywhere in the dotted name).

| Name | Description |
|---|---|
| `kkterm.itops.tasks.dangerous.create` | Create a reusable Task definition (script or interactive playbook). Saves only; nothing executes. Sudo steps and secret references are rejected — the Task Library editor owns those. |
| `kkterm.itops.tasks.dangerous.update` | Update one user Task by id with full-value semantics. Built-ins are read-only; new sudo steps or secret references are rejected. |
| `kkterm.itops.automations.dangerous.create` | Create a durable Automation (trigger + condition config with a `notify` watchdog action, plus the ordered IT Ops action list). `enabled` defaults to true and arms the rule immediately; `runBatch` actions later execute scripts on site hosts unattended. |
| `kkterm.itops.automations.dangerous.update` | Update one Automation by id with full-value semantics; an enabled rule is re-armed with the new definition. |
| `kkterm.itops.automations.dangerous.set_enabled` | Arm or disarm one Automation by id. An armed rule polls its trigger and runs its actions unattended. |
| `kkterm.itops.runs.dangerous.start` | Start a Batch Run against a Site — remote code execution on every resolved host over SSH. Pass exactly one of `taskId` or `script`; optional `scope` narrows to one `serverRoom`, `rackId`, or `hostIds`. Returns the `runId` immediately. |

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
| `kkterm.app.dangerous.tutorial_highlight` | DANGEROUS: navigate the KKTerm UI and show the one-step Tutorial overlay on a registered target (dim + help balloon). Navigation can switch the active Module, a Settings section, or an IT Ops Site destination (`navigation.itopsSiteId` / `navigation.itopsDestination`), so it visibly moves the user's UI. Backed by the frontend live-tool bridge (`tutorial_highlight`), the same implementation the in-app assistant uses. Requires `built_in_mcp_allow_all_dangerous = true`. |

All tool inputs use JSON schemas published in `tools/list`. The handler in
the bridge translates the curated `kkterm.<module>.*` names into the
existing AI assistant tool functions in `src-tauri/src/ai.rs`, so MCP and
the in-app assistant share one implementation. The element-scoped Workspace
and Dashboard screenshot tools are safe read tools, but they may return
sensitive visible content. Universal `kkterm.app.dangerous.capture_window` is
separately gated because it can target any KKTerm-owned OS window. None of
these tools bypasses the normal desktop rendering path or captures
hidden/unmounted content.

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
Windows, and `kkterm-cli` beside the app binary on macOS/Linux. MCP clients may
continue launching it with no arguments because their piped stdin starts stdio
server mode. Interactive no-argument use displays English command-line help;
`mcp` and `serve` explicitly start server mode, and `help`, `-h`, `--help`,
`-help`, `-?`, `/?`, `/h`, and `/help` display help.

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
widget source/body JSON, IT Ops task/script bodies and automation action
payloads, Batch Run report output, and secret-looking argument fields before
writing.

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

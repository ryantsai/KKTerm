# KKTerm Context

KKTerm is a local-first desktop administration workspace for terminal, SSH, SFTP, and approval-based command assistance workflows. This context captures the product language used to keep storage, runtime session handling, and UI workspace concepts distinct.

## Language

**i18n / Localization**:
KKTerm supports 14 UI languages through i18next. The English locale (`src/i18n/locales/en.json`) is the source-of-truth key structure. All user-visible strings must be routed through `t()` or `useTranslation()`; bare English text in JSX is a bug.

**Locale**:
A language-region bundle stored as a JSON file under `src/i18n/locales/`. English is bundled with the app; 13 additional locales load on demand via dynamic `import()`. The active locale is persisted in `localStorage` (`kkterm.language`) and survives app restarts.

**Translation key**:
A dot-notation path into the locale JSON (e.g. `settings.general.language`, `ai.waitingPhrases`). Keys are organized by namespace matching the frontend source layout. New UI strings require a new key in all 14 locale files.

**Namespace**:
A top-level section of the locale JSON mapping to a feature area in the frontend source: `app`, `dashboard`, `appLauncher`, `screenshots`, `installer`, `itops`, `settings`, `connections`, `terminal`, `sftp`, `webview`, `remoteDesktop`, `git`, `ai`, `watchdog`, `workspace`, `common`, `languages`, `manual`. The namespaces are not 1:1 with rail Modules (some Modules use several namespaces; some namespaces cover sub-features inside a single Module). Keep new keys in the namespace closest to the owning component.


**Connection**:
A durable openable resource stored in SQLite. The supported kinds are local terminal, SSH terminal, Telnet terminal, Serial terminal, URL (an embedded http(s) WebView2 target), RDP, VNC, FTP/FTPS, File Explorer (a local filesystem browser, kind `localFiles`), and Document (a single-file universal viewer/light editor, kind `fileView`). SFTP is opened from an SSH Connection and is not stored as a standalone Connection. Every Connection belongs to exactly one **Workspace**.
_Avoid_: Profile, saved session, host entry

**File Explorer Connection**:
A Connection of kind `localFiles`. It browses the local filesystem (no remote host or network Session) by reusing the SFTP file-browser shell as a single-pane local browser driven by local filesystem commands. It stores an optional starting directory and does not surface remote-connection status or transfer activity.
_Avoid_: SFTP, FTP, local SFTP, remote browser

**Document Connection**:
A Connection of kind `fileView`. It opens a single local file in a universal viewer / light editor (no remote host or network Session). The target file path is stored in the Connection's `local_startup_directory` slot (reused as the file path, not a directory). A viewer registry routes the file to a mode — text/code (CodeMirror), Markdown, table (CSV/TSV), JSON, image, dedicated Log mode (level coloring, filter, ANSI, follow/tail), or a Hex fallback — detected by extension plus a backend magic-byte/text probe, and the user can switch modes from the viewer toolbar. Some modes render through an external dependency installed on demand via the Install Helper rather than bundled (PDF via the `poppler` recipe); the viewer shows an install gate when the dependency is missing. The text/code mode is a light editor with an atomic safe-save (`write_file_view`: temp-file + rename with an mtime conflict guard); editing is limited to whole, cleanly-decoded UTF-8 text, so truncated or non-UTF-8 loads stay read-only. It reuses no SFTP/browser session state.
_Avoid_: File Explorer, editor tab, document session

**Workspace**:
A named, isolated container of Connections, surfaced as a switcher in the Activity Rail. The first Workspace ("Default") is seeded on first run and is permanent (non-deletable, non-movable); additional Workspaces are created through the New Workspace wizard (name, icon, and optional copy-import of Connections from other Workspaces). Switching the active Workspace re-scopes the Connection Tree and the rail's connected/pinned list only; open Sessions/Tabs, the Dashboard Module, the Install Helper Module, and Settings remain global. The Workspace Module and Workspace Canvas render the *active* Workspace.
_Avoid_: Space, vault, environment, project, tab

SSH Connections may persist non-secret startup preferences: a remote startup directory and tmux launch preferences, including whether KKTerm should start terminal Panes inside named tmux sessions. The remote tmux process itself remains live Session/runtime state and is not the durable Connection.

Local PowerShell Connections may persist a non-secret **psmux** launch preference (`usePsmuxSessions`, default off). psmux is the native Windows tmux clone; it is the local-shell counterpart to SSH tmux, offered only for PowerShell / PowerShell 7 shells and giving the Pane the same session-list toolbar and name pool. The flag is local-only and mutually exclusive with SSH tmux by Connection type; the live psmux process is runtime state, not the durable Connection.

**URL Connection**:
A Connection of kind `url`. It stores an http(s) URL, an optional `dataPartition` label, and a proxy routing choice. Proxy routing has three durable states: inherit the global URL Settings default, force a direct connection, or use a Connection-specific HTTP CONNECT/SOCKS5 endpoint. The address bar accepts hosts without a scheme; the backend assumes `https://` when no scheme is present. The embedded browser runs in a stable, owned, borderless overlay `WebviewWindow` positioned over the Pane instead of Tauri's `unstable` child-webview API. The `dataPartition` field is persisted but currently a no-op until embedded browser isolation is revisited.
_Avoid_: Web tab, browser bookmark, URL profile

**RDP/VNC Connection**:
A Connection of kind `rdp` or `vnc`. It stores host, optional port, and non-secret account metadata in SQLite; passwords stay in the OS keychain. RDP Connections start Windows-native remote desktop Sessions through the Microsoft RDP ActiveX control in `mstscax.dll`. VNC Connections start RFB/VNC Sessions through the Rust `vnc-rs` client and render the remote framebuffer in the workspace canvas.
_Avoid_: Remote desktop session, screen profile, saved desktop

**Quick Connect**:
A fast path to start a Session that persists a saved Connection. Quick Connect reuses an identical existing SSH Connection (matched by host/user/port) or creates one, then opens it — so every Quick Connect target becomes a durable Connection. The sole non-persisted case is an elevated admin shell launched while KKTerm itself is not elevated: that opens an external UAC process with no in-app Session.
_Avoid_: Temporary profile, ad hoc host, one-off session

**Quick Command**:
A reusable terminal command shortcut the user can send to the focused terminal Pane from the **Quick Command Bar**. Quick Commands are per-Connection workspace UI shortcuts; they do not create Connections and do not own Session lifecycle.
_Avoid_: Connection command, Session command, profile command

**Quick Command Bar**:
The optional bottom bar in a terminal Tab that displays the active Connection's Quick Commands. The Quick Command Bar is off by default, can be toggled from the terminal Pane toolbar, and remembers visibility per Connection.
_Avoid_: Command bar, shortcut bar, Session command bar

**Session**:
A live runtime instance for a process, SSH channel, file-browser, webview, or remote-desktop state.
_Avoid_: Connection, profile, tab

**Tab**:
A frontend workspace container that presents one session or a set of related panes.
_Avoid_: Session, connection, backend tab

**Child Connection Tab**:
A saved frontend Tab instance shown as an italic child row under its parent terminal-type Connection in the Connection Tree when Workspace Settings enables the hidden top Tab Strip mode. A Child Connection Tab may remember a display name, icon/background, tmux session id, and last terminal directory so it can be reopened lazily after app launch. It is not the durable backend Connection itself and it is not a live Session until the user opens it.
_Avoid_: child connection, saved session, sub-connection, backend tab

**Dashboard Module**:
A built-in Activity Rail Module that provides a dynamic widget playground. Users select from built-in widgets (currently App Launcher) or AI Created Widgets. The built-in AI Assistant and coding agents create new widgets through atomic Tauri commands; users customize each widget's visual preset, accent, icon, and title and arrange them on a 12-column drag-and-drop grid. See `docs/DASHBOARD.md` for the durable architecture.
_Avoid_: landing page, overview

**Install Helper Module**:
A built-in Activity Rail Module that manages a curated catalog of Windows developer tools (e.g. nvm, Node, uv, Python, VS Code, Docker, WSL, n8n, Claude Code CLI, Codex CLI, Antigravity CLI, OpenCode CLI, Notepad++, NSSM, OpenClaw, Hermes agent). For each catalog entry the Module detects local install state, fetches the latest available version, presents a per-tool install panel with tool-specific options, and supports check-for-update and apply-update actions. Lives above Settings on the Activity Rail. Not a Connection, not a Session, not a Dashboard Widget.
_Avoid_: AI Installer, App Installer, package manager, store

**Dashboard View**:
A durable SQLite-backed tab in the Dashboard Module, stored in `dashboard_views`. Each View carries its own ordered set of Widget Instances and a `grid_density` (`compact` / `default` / `roomy`). The first View is named "Default" and is seeded on first run with one App Launcher Widget Instance. Views are not Sessions and not Connections.
_Avoid_: dashboard page, tab, board

**Dashboard Widget Instance**:
A placed widget on a Dashboard View, stored in `dashboard_widget_instances`. Carries a `kind` (`builtIn` / `script`), a `source_id` resolving to a built-in registry entry or a Dashboard AI Created Widget, presentation fields (`preset`, `accent_name`, `icon_name`, `custom_title`), and layout coordinates (`grid_x`, `grid_y`, `grid_w`, `grid_h`). Multiple Instances of the same source may coexist with different presets, accents, and sizes.
_Avoid_: widget, tile, card

**Dashboard AI Created Widget**:
An AI Created Widget definition stored in `dashboard_custom_widgets`. AI Created Widgets are script-only: JavaScript hosted inside an isolated `iframe srcdoc` with declared `network` and `pollSeconds` permissions. Authoring is AI-only in v1; users customize and remove AI Created Widgets but do not create them through the UI.
_Avoid_: plugin, extension, custom tile

**Widget Preset**:
One of three visual chrome styles applied per Widget Instance: `panel`, `ambient`, `hero`. Presets are CSS wrappers that read the Instance's `--w-accent` / `--w-accent-soft` variables; presets do not encode their own palette. Ambient hides the title bar by default.
_Avoid_: theme, style, layout

**Widget Archetype**:
An AI-facing scaffold family selected before creating a Dashboard AI Created Widget. It guides chrome, layout, state handling, lifecycle, library choice, and first-pass grid size, but is not persisted as durable Dashboard data. Current archetypes are **Data Monitor**, **Metric/Chart**, **Utility Instrument**, **Desktop Object**, **Canvas Toy/Game**, and last-resort **General Workbench**.
_Avoid_: widget type, widget kind, preset

**Widget Kind**:
One of `builtIn`, `script`. Determines the body rendering path: `builtIn` resolves to a TypeScript component in `src/modules/dashboard/widgets/`; `script` mounts a JavaScript body inside an isolated `iframe srcdoc` host.
_Avoid_: widget type, widget variant

**App Launcher Widget**:
A Dashboard widget where users add local desktop apps, shortcuts, scripts, or files for quick launch. The widget presents each launcher entry as an icon with text; add/edit/remove actions, launch mode choices, and other entry management controls belong in an app-owned right-click context menu instead of the default widget surface.
_Avoid_: dock, taskbar

**Pane**:
A subdivision of a tab that presents one terminal surface or workspace view.
_Avoid_: Session, split

A Pane's **kind** (terminal, sftp, ftp, localFiles, webview, remoteDesktop) is what decides the surface it renders, and it is distinct from the durable Connection's **type**. The two are not interchangeable: an **SFTP browser Pane is not an SSH terminal**, yet it intentionally carries an ssh-typed Connection because SFTP is launched from an SSH Connection (and an sftp-protocol FTP Connection is normalized to an ssh shape for the same browser code path). Because one ssh-typed Connection can back either an SSH terminal Pane or an SFTP browser Pane, any code that recreates a Pane — especially restoring a saved or docked layout — must use the stored Pane kind, never re-derive the surface from the Connection's type, or an SFTP Pane will reopen as an SSH terminal. See the SFTP vs SSH invariant in `docs/ARCHITECTURE.md`.

Terminal Panes for tmux-enabled SSH Connections may carry a generated friendly tmux session id, such as `kkterm-cockpit001`, used to resume that Pane's remote tmux session when the Pane is recreated. Current Pane tmux ids use the `kkterm-<sci-fi-name><number>` shape and are remembered in frontend workspace storage. That id belongs to the frontend workspace/Pane layer, not the backend Connection model.

**Automation**:
A durable IT Ops rule stored in SQLite (`itops_automations`): one trigger, an optional condition predicate, and a typed action (notify, popup, email, webhook, run a Batch Run, or AI intervention). Automations persist across app restart and re-arm on launch. An Automation is the durable definition; the live **Watchdog** runtime is what executes it, the same way a **Connection** is durable and a **Session** is its live runtime. Created and managed in the **IT Ops Module**. See `docs/ITOPS.md` and `src-tauri/src/itops/`.
_Avoid_: watchdog (for the durable rule), workflow, job, saved alert

**Watchdog**:
The live runtime that executes an armed **Automation** (or an ad-hoc live monitor): it samples a target (performance counter, SSH Session output silence, ping, or TCP reachability) against a predicate and, on trigger, runs the Automation's actions. The running Watchdog state — ticks, trigger log, state machine, suppression window — is **in-memory only and does not persist across app restart**; its durable definition lives in the **Automation**. Surfaced through the **Watchdog Status Bar** indicator and a detail panel, not as a Connection or Session. See `src-tauri/src/watchdog/` and `src/watchdog/`.
_Avoid_: monitor profile, durable watcher (the Automation is the durable part)

**IT Ops Module**:
A built-in Activity Rail Module for fleet operations: **Host Groups**, **Batch Runs**, and **Automations**. Lives with Dashboard and Install Helper above Settings. Not a Connection, Session, or Dashboard widget. See `docs/ITOPS.md` and `docs/ADR/0011-it-ops-module.md`.
_Avoid_: operations center, fleet manager, orchestrator

**Host Group**:
A durable, named selection of existing Connections (plus an optional dynamic filter by type/folder) used as the fleet target for Batch Runs and Automation `runBatch` actions. Stored in `itops_host_groups`; it references Connection ids and owns no Session and no secret. It is not a Connection type.
_Avoid_: inventory, host list, connection group (as a Connection type)

**Batch Run**:
One execution of a Batch Task (a one-shot script or an interactive, expect-style playbook) across a resolved Host Group, fanned out with bounded concurrency over a per-host transport (SSH, WinRM, or PsExec). Live per-host progress streams to the run grid as it happens; on completion a consolidated report — including each host's captured output — is written to `itops_run_history`, where it can be reopened as a read-only Run Report. The run is live runtime, not a durable definition.
_Avoid_: broadcast, job, deployment

**Playbook**:
A Batch Task kind: a user-authored, ordered sequence of interactive steps run over a single PTY shell per host. Each step **sends** a command or input and optionally **waits for** a literal output substring (a prompt) before the next step runs; a step that times out waiting for its `expect` stops the playbook on that host while other hosts continue. Distinct from a one-shot **script** Batch Task because steps can answer prompts (`[sudo] password:`, `Continue? [Y/n]`) and build on each other's shell state. See `docs/ITOPS.md` and `src-tauri/src/ssh.rs` (`run_playbook_capture_streaming`).
_Avoid_: workflow (that reads as Automation), recipe (that is an Install Helper term), curated update sequence

## UI Layout

**Activity Rail (Left Rail)**:
The vertical icon bar on the far left of the app. Its top section is the **Workspace switcher** — the Default Workspace, any additional Workspaces, and a `+` button that opens the New Workspace wizard; selecting a Workspace activates it and navigates to the Workspace Module. Below that it shows the other top-level built-in Modules (Dashboard, IT Ops, Install Helper), connected Connection shortcuts when enabled, and Settings at the bottom. Icons use app-owned delayed hover labels via `RailTooltip`, not native `title` tooltips. App Launcher is intentionally not a Module; it lives inside Dashboard as a widget.
_Avoid_: sidebar, left sidebar, nav bar

**Connection Tree (Connections Panel)**:
The left-side tree view of saved Connections, folders, subfolders, and optional Child Connection Tabs. Visible inside the Workspace Module. Supports search, filtering, drag/drop ordering, rename, delete, duplicate, Quick Connect, and open-Session status badges. Collapsed/expanded state is persisted.
_Avoid_: connection sidebar, host list

**AI Assistant Panel**:
The right-side resizable panel for AI chat interactions. Collapsed/expanded state is workspace-wide.
_Avoid_: AI sidebar, chat panel

**Assistant Memory**:
Short durable notes the AI Assistant saves about the user's environment, stored in the SQLite `assistant_memories` table and scoped to `global` or a specific `connection:<id>`. The global notes plus the active Connection's notes are recalled into the assistant's context at the start of each turn. Plain operator facts only — never secrets, which remain in the OS keychain. Distinct from chat history (the saved transcript of a conversation) and from RAM/working-set "memory" reported in the Status Bar.
_Avoid_: RAM, chat history, context window

**Dashboard Widget Playground**:
The content area of the Dashboard Module. Hosts dynamic, user-selectable widgets and reports, including the App Launcher Widget. The AI Assistant can create new widgets on request.
_Avoid_: landing page, overview

**Default Launch State**:
The fallback view shown when no Sessions are open, displaying recent Connections and a brief workspace overview. Not a Module; it is reached by closing all Tabs inside the Workspace Module.
_Avoid_: dashboard page, home screen

**Workspace Canvas**:
The central content area for the active Module. Each Module (Workspace, Dashboard) owns its own content layout within this area. For the Workspace Module, this includes the Tab Strip, active Tab content (terminals, URL launch placeholders, RDP/VNC surfaces, SFTP/FTP browsers), and optional pane splits.
_Avoid_: main area, content area

**Tab Strip**:
The horizontal row of workspace tabs above the Canvas. Each Tab represents a workspace container presenting a Session or set of related Panes.
_Avoid_: tab bar, tab row

**Pane**:
A subdivision within a Tab that presents one terminal surface or view. Pane toolbars carry terminal/connection controls.

**Status Bar**:
The bottom workspace bar showing left-aligned host usage metrics and the universal popup surface for every transient information, success, warning, and error notification. Transient outcomes are published through `showStatusBarNotice`; determinate work uses `showStatusBarProgress`. Its right side carries app-wide status indicators: the **Watchdog Status Bar** indicator, an AI Assistant working indicator, a managed X server setting indicator, and the Don't Sleep (coffee) indicator.
_Avoid_: footer bar, bottom bar

**Settings Sidebar**:
The left-side navigation within the Settings page, routing between General, AI, Connections, Terminal, and other settings sections.
_Avoid_: settings nav, settings menu

## Relationships

- A **Connection** may start zero or more **Sessions** over time.
- An SSH **Connection** may start terminal **Sessions** and related SFTP browser **Sessions**.
- A **URL Connection** starts a URL **Session** that owns a stable overlay WebView2 window positioned over the active Pane.
- An **RDP Connection** starts a Windows-native remote-desktop **Session** hosted as a native child control over its **Tab**.
- A **VNC Connection** starts a Rust-managed remote framebuffer **Session** rendered into its **Tab**.
- A **Quick Connect** persists a **Connection** (reusing an identical existing SSH Connection when present) and starts a **Session** on it; the only non-persisted case is the external elevated admin shell launched when KKTerm is not elevated.
- A **Quick Command** writes input from the **Quick Command Bar** to a terminal **Pane** in an existing **Session**.
- A **Session** may be presented by one **Tab**.
- A terminal **Tab** may contain one or more **Panes**.
- A **Child Connection Tab** is a named, saved frontend Tab instance under a parent **Connection**; opening it creates or activates the corresponding **Tab** and then the live **Session**.
- A **Child Connection Tab** may remember a tmux session id or last terminal directory, but those values remain workspace presentation/reopen hints rather than durable backend **Connection** fields.
- A tmux-enabled SSH terminal **Pane** may start or attach to a named remote tmux session. If `tmux` is unavailable on the remote host, the Pane falls back to the normal remote shell.
- A psmux-enabled local PowerShell **Pane** may start or attach to a named local psmux session via the same toolbar session list. If `psmux` is not installed, the Pane falls back to the normal PowerShell shell.
- A **Tab** is UI state only and is not the durable backend model.
- Switching the active **Tab** does not end, disconnect, or recreate its **Session**.
- A native SSH **Session** must not use an app-side idle timeout. Quiet, unfocused SSH Sessions are expected to remain connected unless the remote server, network, or an explicit user close ends them.
- A tmux-enabled native SSH **Session** may silently attempt a small bounded reattach to the same Pane tmux id if the SSH channel unexpectedly closes.
- A **Session** is intentionally ended only by an explicit close action on the presenting **Tab** or by the remote/process ending itself.

## Example Dialogue

> **Dev:** "When the user opens the Bastion East **Connection**, should we mutate that row to mark it active?"
> **Domain expert:** "No — opening the **Connection** creates a **Session**. The **Connection** stays durable resource data; live state belongs to the **Session** and its **Tab**."

## Flagged Ambiguities

- "Profile" and "saved connection" were both used for durable openable resources. Resolved: use **Connection** as the canonical term.
- "Session" was previously easy to confuse with a saved connection or visible tab. Resolved: a **Session** is live runtime state, while a **Tab** is only the frontend container.
- "Child connection" can sound like a nested durable Connection. Resolved: use **Child Connection Tab** for the saved child row that reopens a Tab under a parent Connection.
- "Workspace" was previously an implicit singleton — the term named both the rail Module and the single Connection Tree. Resolved: **Workspace** is now an instanceable container of Connections; the seeded **Default Workspace** is permanent. The Workspace Module / Workspace Canvas keep their names and render the active Workspace. **Tab** remains the frontend container for a Session, distinct from the capital-W Workspace instance.

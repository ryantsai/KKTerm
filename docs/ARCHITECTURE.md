# KKTerm Architecture

## Overview

KKTerm is a Windows-first, cross-platform desktop workspace for local terminals, SSH sessions, SFTP/FTP file browsing, URL workspaces, and remote desktop. The architecture prioritizes startup speed, local-first privacy, testable Rust source files, and a UI that can evolve toward GPU-accelerated terminal rendering without blocking the first usable prototype.

## Platform Shape

- Desktop shell: Tauri v2.
- Core runtime: Rust.
- Frontend: React, TypeScript, Vite.
- Styling: Tailwind with strict CSS variable tokens.
- UI primitives: Radix UI or Ariakit.
- Icons: lucide-react.
- State: Zustand or TanStack Store.
- Storage: SQLite for non-secret local data.
- Secrets: OS keychain.

Windows is the first acceptance platform. macOS and Linux should remain first-class architectural targets, but Windows behavior wins v0.1 acceptance decisions.

## Major Source Areas

### App Shell

Owns Tauri setup, window lifecycle, command registration, menus, native dialogs, logging setup, and platform-specific capabilities.

The main app window close path stays native and free of frontend hooks. Do not add `onCloseRequested`, `tauri://close-requested`, JS-side close listeners, or app-owned close-confirmation flows on the title-bar close button — those have repeatedly broken the Windows native close button under Tauri v2. Window and layout state should be persisted during ordinary resize/move/settings flows, not during app close.

The single sanctioned exception is the minimize-to-tray diversion in `app_tray.rs`: a native, synchronous Rust-side `WindowEvent::CloseRequested` arm inside the existing `on_window_event` handler. It calls `api.prevent_close()` and hides the window **only when minimize-to-tray is enabled**; when disabled the close request is untouched and quits natively. The handler does no async work, and the tray "Exit" item (`app.exit(0)`) bypasses `CloseRequested` so a guaranteed quit path always exists.

Automatic database backups follow the same rule: they run during startup or explicit Settings actions, never during app-window close. Backup files are KKTerm settings ZIPs with the same structure as manual exports, so Import Settings can restore them directly.

### Command Boundary

Provides a typed command wrapper between React and Rust. The frontend should not manually string-build backend calls. Commands should return structured results and structured errors.

Debug-only observability should use local debug logs, console output, or the diagnostics bundle path rather than visible in-app status indicators. Visible diagnostic UI belongs only in deliberate product features or explicit user-requested debugging surfaces, not as ad hoc instrumentation for a temporary debugging build.

AI Assistant context is also a command-boundary concern. Any frontend page context, backend tool output, or debug-only assistant payload must be designed as a compact projection, not a raw dump of local app state. Passive context sent on every request should contain only labels, ids, summaries, counts, small metadata, and current UI state needed for the assistant to decide what to do next. Full source code, large schemas, terminal/file contents, screenshots, data URLs, and other high-token or sensitive payloads must be attached only through explicit user actions or specific read tools with clear scope. When adding a new assistant context surface, add a test or manual check that the serialized prompt/tool result does not contain raw source fields, secret values, or avoidable bulky catalogs.

### Frontend Settings

`src/modules/settings/SettingsPage.tsx` owns the Settings shell — the header, sidebar nav, and section routing. Each settings section is a separate page component under `src/modules/settings/`, owning its own draft state, save/reset handlers, and helper controls:

- `src/modules/settings/GeneralSettings.tsx` — Language (i18n) selector, Auto Backup toggle and last-backup status, connected Connection rail shortcut toggle, minimize-to-tray toggle, DirectX screen capture toggle, settings export/import actions, database folder opener.
- `src/modules/settings/AppearanceSettings.tsx` — App UI font family, layout reset, Color Scheme selection and preview, including tutorial target `settings.appearance.colorScheme`.
- `src/modules/settings/DashboardSettings.tsx` — Dashboard-wide preferences: default landing view, widget network-tools permission, and the active script widget cap. Per-view grid density is owned by the view row and edited from the Dashboard topbar in edit mode only.
- `src/modules/settings/WorkspaceSettings.tsx` — Workspace display preferences, including whether the top Tab Strip is hidden in favor of Child Connection Tabs under parent Connections in the Connection Tree.
- `src/modules/settings/AiSettings.tsx` — AI provider kind, dynamic provider fields, provider-specific model selector, custom model ID input, API key, output language, and insecure TLS provider toggle. Provider addition rules live in `docs/AI_PROVIDERS.md`.
- `src/modules/settings/SshSettings.tsx` — SSH defaults, SSH terminal buffer behavior, SSH port redirect visibility, SSH OSC 52 clipboard policy, and SFTP transfer defaults summary.
- `src/modules/settings/TerminalSettings.tsx` — Local terminal font, size, line height, scrollback, cursor, default shell, and local terminal toggles. Do not put SSH-only terminal behavior here; SSH terminal behavior belongs in `SshSettings.tsx`.
- `src/modules/settings/UrlSettings.tsx` — URL Connection security defaults, saved website password metadata, and URL data shard management.
- `src/modules/settings/RdpSettings.tsx` — Planned RDP quality defaults summary.
- `src/modules/settings/VncSettings.tsx` — Planned VNC quality defaults summary.
- `src/modules/settings/AboutSettings.tsx` — Product info, version, open-source component tables.
- `src/modules/settings/shared.tsx` — Reusable `SettingsSummary` and `PlannedSettingsGrid` components.
- `src/modules/settings/aboutData.ts` — Static product metadata and open-source component groups.

`src/App.tsx` only routes to Settings; the persisted-settings bootstrap into the workspace store lives in `src/lib/settings.ts` as a single `useBootstrapSettings()` hook so new persisted settings can be added in one place. The OS keychain owner id for the AI API key (`AI_PROVIDER_SECRET_OWNER_ID`) is also defined in `src/lib/settings.ts` so SettingsPage and bootstrap share one constant. New Settings sections should stay in the settings source area unless they become large enough to justify a sub-directory under `src/modules/settings/`.

Settings sections use one shared visual grammar. A top-level page is a single `settings-card settings-section`; related controls inside that page are grouped with `fieldset` elements using `settings-subsection settings-fieldset`, with a translated `legend` that sits in the border. This fieldset treatment is the canonical group-box style for General, Appearance, AI Assistant, SSH, Terminal, URL, RDP, VNC, and future Settings sections. Avoid one-off nested cards, heading-only group boxes, or custom bordered panels inside Settings.

Controls should communicate state consistently. Editable Settings text boxes and selects should use the editable surface styling in the default color scheme; disabled and readonly controls stay muted so they read as unavailable. Keep provider model choice as a real `<select>` and custom model/deployment IDs in a separate input. Toggle rows inside Settings groups should use the existing `settings-toggle-list` and `settings-toggle-row` structure. Delete buttons inside Settings pages should be icon-only red trash can buttons, centered in their row, with translated accessible labels and no visible "Delete" text.

Global Settings data actions live in General → Settings data. Backup, Import, database folder opening, and Reset All Settings belong there; feature pages should not grow their own global reset buttons. Destructive Settings actions must use app-owned translated dialogs, never browser-native `window.alert`, `window.confirm`, or `window.prompt`. Reset All Settings resets persisted Settings pages to defaults, closes open Sessions, resets saved layouts, and removes the saved AI API key, but it must not delete saved Connections.

### Internationalization

The i18n layer lives in `src/i18n/` and uses **i18next** with **react-i18next**.

- **`src/i18n/config.ts`** owns the i18next instance, language detection (`localStorage` key `kkterm.language`), dynamic locale chunk loading, the `switchLanguage()` API, and the `ensureI18nReady()` startup guard.
- **`src/i18n/useT.ts`** provides a typed `useT()` hook with full key autocompletion from the English locale shape.
- **`src/i18n/locales/en.json`** is the source-of-truth translation file (16 namespaces, ~2,200 keys). English is bundled with the app; the 13 other locales (`fr`, `it`, `de`, `es`, `es-MX`, `pt-BR`, `zh-TW`, `zh-CN`, `ja`, `ko`, `th`, `id`, `vi`) load on demand via dynamic `import()` and are automatically code-split by Vite.
- **Settings → General → Language** exposes a dropdown that calls `switchLanguage()`, which hot-swaps the locale bundle and persists the choice.
- **All user-visible strings must go through `t()` or `useTranslation()`**. Hardcoded English text in JSX is forbidden. New keys go into `en.json` first, then are propagated to all 13 other locale files or tracked under `docs/localization_todo/`. Renamed or removed keys must be updated in every file. Pure helper functions that cannot use React hooks import `i18next` from `src/i18n/config` and call `i18next.t(key)`.

### Storage

Owns current SQLite schema initialization and repositories for:

- connection tree nodes
- saved connections
- settings
- UI layout
- recent sessions
- non-secret AI provider metadata
- non-secret SSH tmux launch preferences
- dashboard views, widget instances, and AI Created Widget definitions (see `docs/DASHBOARD.md`)

Secrets are never stored in SQLite.

### Secrets

Owns OS keychain integration:

- Windows Credential Manager / DPAPI path
- macOS Keychain later
- Linux Secret Service / KWallet/libsecret later

Secrets include passwords, SSH passphrases, and AI API keys.

### Connection Model

Represents all openable resources as saved connections. Current connection types:

- Local Terminal
- SSH Terminal
- Telnet Terminal
- Serial Terminal
- URL
- RDP
- VNC
- FTP/FTPS

SFTP is a related workspace surface opened from an SSH Connection, not a standalone saved Connection type. FTP/FTPS is a standalone Connection type that routes through the same file-browser workspace with FTP command adapters.

SSH Connections may store a non-secret `useTmuxSessions` preference. This value describes how future terminal Sessions should launch; it does not represent a live remote process.

RDP Sessions are Windows-native child controls hosted through the Microsoft RDP ActiveX COM control in `mstscax.dll`. The Rust backend creates and drives the control from Tauri commands while the frontend owns Tab/workspace placement. VNC Sessions use the Rust `vnc-rs` client for RFB handshakes, password auth, framebuffer updates, CopyRect handling, and pointer/key input; the frontend renders RGBA framebuffer rectangles into a canvas in `src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx`.

RDP ActiveX is a native child HWND, not a DOM element. It can draw above React dialogs and overlays regardless of CSS `z-index`; this is the Win32/WPF "airspace" limitation, not a stacking-context bug. Simple command menus avoid this problem by using Tauri native context menus through `src/lib/nativeContextMenu.ts`, so Quick Connect, Add Connection, Connection Tree context menus, Activity Rail Connection context menus, Tab context menus, and screenshot toolbar menus do not participate in DOM overlay parking. When a real DOM overlay must appear above an active RDP view, `src/modules/workspace/nativeOverlay.ts` detects whether a registered overlay actually intersects the RDP host rectangle. Only then does `src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx` capture the current RDP host rectangle through the screenshot command, render that transient bitmap inside the workspace, and hide/park the ActiveX HWND until the overlay is gone. This preserves the user's visual context for dialogs and Region selection without blanking the active workspace for ordinary menus.

Do not turn overlay detection back into a document-wide boolean. RDP is the only workspace family that uses the screenshot-backed parking workaround. WebView2 visibility is for URL Session lifecycle, Tab activation, Dashboard View/Module activation, and narrow app-owned blocking overlays that are proven to be covered by the native WebView2 child surface in the real Tauri runtime. The known WebView2 overlay cases are the Connection dialog backdrop, which uses `documentHasWebviewBlockingOverlay`, and the Dashboard background popover, which directly marks embedded URL Connection widgets inactive while the popover is open. The WebView2 backend tracks whether a session is visible so late bounds updates cannot re-show a hidden URL surface after the user switches Views, Modules, or tabs. Hidden child WebView2 surfaces are parked with `HIDDEN_WEBVIEW_POSITION` and a 1x1 size in `src-tauri/src/webview.rs`; do not replace that with Tauri `Webview::hide()` / `show()` unless a real Windows Tauri runtime test proves normal URL Connections still stop drawing across Workspace, Dashboard, Settings, inactive Tabs, and inactive Dashboard Views. Ordinary menus should rely on native menu popups or the app's normal stacking/layout. If another WebView2 overlay bug is proven in the real Tauri runtime, document the exact failure mode and add a narrow WebView2-specific selector or an explicit owning-component suppression path rather than reusing RDP parking.

Native context menu icons are not SVGs passed directly to Tauri. Menu builders pass existing image assets, such as Connection PNGs or URL favicon data URLs, as `iconSrc`; command-only glyphs use app-owned lucide-style SVG strings from `src/lib/nativeMenuIcons.ts` as `iconSvg`. `src/lib/nativeContextMenu.ts` rasterizes either source to 16px PNG bytes with an offscreen canvas, creates Tauri `Image`s through `Image.fromBytes`, caches the result, and creates explicit Tauri `IconMenuItem`s for icon-bearing entries. Keep Tauri's `image-png` Cargo feature enabled; without the image feature, Windows native menu icons may render as text-only even though the menu itself opens. This keeps native menus visually aligned with the existing DOM tree/rail icons without adding one-off PNG assets or reintroducing DOM overlays.

If a future design truly needs a live overlay over RDP without parking the ActiveX host, the practical options are outside normal React layering: render that overlay as a native popup/owned HWND, clip or reshape the RDP child HWND around the overlay region, or replace the ActiveX path with a renderer that draws into KKTerm's own canvas/texture stack. Native popup HWNDs match how many Win32 desktop apps keep menus above embedded controls, but they add DPI, focus, accessibility, styling, and coordinate-sync complexity. Replacing the RDP renderer would avoid the airspace issue but moves KKTerm into owning RDP protocol/rendering concerns such as authentication, clipboard, display resize, and device redirection.

RDP sizing has an important diagnostic trap: gray left/right gutters or a visible resize after switching Tabs can be caused by frontend workspace layout changes, not by the RDP transport itself. In particular, global chrome such as the right AI Assistant panel must keep one workspace-wide width/collapsed state; it must not load per-Connection panel layout on Tab activation. Per-Connection assistant panel state changes the workspace width during Tab switching, which then forces the native RDP ActiveX HWND to resize and can look like an RDP display-sync bug. When investigating RDP gutters, first verify that `remote-desktop-workspace` bounds and app chrome widths stay identical before and after Tab activation.

### Connection Tree

Owns root-level saved Connections, optional folders, subfolders, search/filter, drag/drop ordering, rename/delete/duplicate, quick connect, optional Child Connection Tabs, and open-session status badges.

Current implementation note: a Connection may have no folder and live directly in the root of the tree. Folders may contain Connections and subfolders. Status badges are derived from active frontend workspace Sessions. Durable Connections load as idle and do not persist live session state in SQLite.

Child Connection Tabs are frontend workspace state, not nested durable Connections. They are shown as italic rows under a parent Connection when `settings.hideTopTabButtons` is enabled. A Child Connection Tab stores the child row id, parent Connection id, user-facing child name, optional icon/background override, optional tmux session id, and optional last terminal working directory in local workspace storage (`kkterm.workspace.childConnections.v1`). Startup does not connect these children: selecting a child row creates the live Session lazily, and selecting the parent Connection opens all of its Child Connection Tabs together in a generated split layout.

For tmux-enabled SSH Connections, per-Pane tmux session names are generated and remembered in the frontend workspace layer so split Panes can resume independently. New Pane names are drawn directly from the active locale's `ai.tmuxSessionLabels` pool, so the actual remote tmux session name is localized rather than an English slug with a translated display label. The locale pools do not need to map one-to-one with English. The frontend stores these Pane names under `kkterm.tmuxSessions.<connectionId>` so the same Connection can reopen its previous Pane-to-tmux mapping. Stored Pane ids are reused as literal remote tmux names when they are tmux-safe (no whitespace, colon, semicolon, or control characters). The durable Connection stores only the launch preference and non-user-facing namespace fields; those fields are not the active Pane tmux session id.

### Backend Command Runtime Boundaries

Tauri commands that need synchronous native integrations, OS process calls, network control loops, or helper functions that internally create and `block_on` a Tokio runtime must cross that boundary with `run_blocking_command`/`tauri::async_runtime::spawn_blocking` before calling the helper. Async command handlers must not directly call code that starts a nested runtime or blocks the current Tokio worker; doing so can panic with "Cannot start a runtime from within a runtime" and can also starve unrelated Connection types. This invariant applies across all live Session families: local terminal helpers, SSH/tmux/AI context inspection, SFTP transfers, URL/WebView2 lifecycle calls, RDP ActiveX operations, and VNC RFB operations. When adding a command for any Connection or Session type, choose one of these shapes explicitly: pure async all the way down, synchronous command with no nested async runtime, or async command that immediately moves the blocking/nested-runtime work into `run_blocking_command`.

### Terminal Session

Owns local PTY lifecycle, SSH terminal channel lifecycle, Telnet TCP lifecycle, Serial port lifecycle, input/output streams, resize events, tab integration, split pane integration, and terminal compatibility behavior.

Lifecycle invariant: switching the active workspace Tab must not disconnect, close, or recreate a local terminal Session, SSH terminal Session, or SFTP Session. Open Tab surfaces stay mounted while inactive so their live Sessions remain attached. Explicit tab close from the tab strip is the user-owned teardown action for the Session or Sessions presented by that Tab.

When an SSH Connection has tmux enabled, each terminal Pane starts by attaching to or creating its generated tmux session with `tmux new-session -A -s <name>`. Native `russh` sessions and system `ssh` fallback sessions use the same remote startup behavior. If `tmux` is not installed on the remote host, KKTerm starts a normal interactive shell instead. The Pane toolbar shows the tmux session id and can list or close remote tmux sessions without logging terminal contents.

Native SSH terminal Sessions do not set an app-side inactivity timeout; quiet and unfocused Sessions should remain connected. If a tmux-enabled native SSH terminal channel unexpectedly closes after startup, the SSH runtime attempts a small bounded silent reattach to the same Pane tmux session id. This is recovery for a broken transport, not a replacement for normal Session ownership: explicit Tab close still tears down the frontend Session, and non-tmux shells are not auto-restarted because that would create a fresh remote shell rather than resume existing live state.

### Terminal Engine

Owns terminal parsing/state and exposes a renderer-neutral model. Evaluate `alacritty_terminal` first.

The engine boundary should make rendering swappable by separating:

- terminal state/input
- glyph atlas/shaping
- scrollback
- selection/copy
- cursor rendering
- dirty-region updates

### Terminal Renderer

Milestone A may use the fastest reliable terminal view that can prove session lifecycle and product UX. Milestone B introduces or replaces it with WGPU rendering. The renderer must be behind an internal interface from the start.

The current Milestone A renderer is `xterm.js` with the `@xterm/addon-webgl` GPU glyph renderer attached opportunistically inside `XtermTerminalRenderer.open` (`src/modules/workspace/connections/terminal/renderer.ts`). The addon is loaded after `Terminal.open(element)` because it needs the host element to mount its WebGL2 canvas. If the `WebglAddon` constructor throws (no WebGL2, blocklisted driver, headless RDP) or `loadAddon` rejects it, the renderer silently stays on the xterm DOM renderer. When the GPU context is later evicted (sleep/wake, GPU reset, driver crash), `WebglAddon.onContextLoss` fires; the renderer disposes the addon and xterm transparently falls back to the DOM renderer for subsequent frames. The renderer is not recreated and the Session is not torn down. This keeps the renderer abstraction unchanged while removing CPU pressure on heavy output (build logs, `journalctl -f`, multi-pane Tabs).

### SSH Transport

Owns in-process SSH connections, host key verification, authentication, terminal channels, resize propagation, idle behavior, bounded tmux reattach behavior, optional system ssh fallback/debug, and noninteractive remote tmux management commands.

Evaluate `russh` first. Evaluate `ssh2` if `russh` does not meet v0.1 needs.

### SFTP

Owns SFTP sessions launched from SSH Connections, local/remote listing, multi-select upload/download by button or drag/drop, create folder, inline rename, delete, refresh, scoped context menu actions, remote properties, chmod/chown updates, transfer queue, progress, cancellation, finished-history clearing, overwrite conflict prompts, overwrite-all queue handling, and "open terminal here."

### Screenshot Capture

Owns explicit user-triggered screenshot capture for active workspace surfaces. Terminal Panes expose the screenshot action in the Pane toolbar; URL, SFTP, RDP, and VNC workspaces expose it in the top workspace toolbar. The frontend owns the native command menu and Region selection overlay, then calls the typed Tauri command with a client-area rectangle.

The standalone screenshot gallery page has been removed. Screenshot capture (Region and Entire Window/Panel to clipboard or AI Assistant context) remains available through terminal Pane toolbars and workspace top toolbars. The Rust backend screenshot capture code in `src-tauri/src/screenshot.rs` and `src-tauri/src/storage.rs` is retained for the in-context capture path.

On Windows, the Rust backend translates the requested rectangle into physical screen coordinates and uses DXGI Desktop Duplication when `settings.useDirectxScreenCapture` is enabled. The DXGI path is used only when the requested rectangle fits a single physical output; unsupported cases fall back to the existing GDI capture path so native child surfaces such as WebView2 and the RDP ActiveX host remain capturable. Captures can be written directly to the system clipboard as image data, or encoded as a transient PNG data URL and attached to the AI Assistant context through an explicit Send to AI Assistant action. Screenshot capture does not persist image files and does not log terminal contents.

The same screenshot path is also used internally for RDP overlay suppression. Before hiding the ActiveX HWND for a registered DOM overlay such as a dialog or Region overlay, the frontend captures the RDP host rectangle and displays the resulting transient bitmap under the DOM overlay. That internal capture is not persisted and is distinct from user-requested clipboard or AI Assistant captures.

### SSH Config Importer

Parses SSH config and creates draft connections. It should preserve supported directives and visibly report unsupported directives.

Current implementation note: the importer supports `Host`, `HostName`, `User`, `Port`, `IdentityFile`, and `ProxyJump`. It skips wildcard-only host patterns and reports unsupported global or host-scoped directives with line numbers through the typed Tauri command. The previous top chrome import button has been removed; a future visible entry point should live in the connection tree or Settings rather than a standalone global button bar.

### Connection Batch Importer

Owns the cross-format Connection import flow surfaced as the **Import** tile in the New Connection wizard (`src/modules/workspace/connections/ConnectionSidebar.tsx`) and rendered as the two-mode dialog `src/modules/workspace/connections/ImportDialog.tsx`. The dialog has a single source-picker step that branches to either a file-import step or a network-scan step, then funnels both into the same editable preview table before persisting.

Backend lives in `src-tauri/src/import.rs` and is exposed through two typed Tauri commands:

- `parseImportFile` — reads a user-picked file from disk, dispatches by extension or content sniff, and returns a list of `ImportedConnectionDraft` rows plus parser warnings. Supported formats: CSV/TSV/text (column-aware via header row when present), RDCMan `.rdg` (XML, preserves folder hierarchy as `folderPath`), MobaXterm `.mxtsessions` (INI bookmarks with protocol id mapping), and PuTTY `.reg` (Windows Registry export of `Software\SimonTatham\PuTTY\Sessions`). Each draft carries `name`, `host`, `user`, optional `port`, `connectionType`, and optional `folderPath` for nested folder reconstruction.
- `scanNetworkForConnections` — performs a light TCP port probe over a single host, hyphen range, or CIDR, capped at `MAX_SCAN_HOSTS = 1024` per call with `SCAN_CONCURRENCY = 64` and a 500 ms per-port timeout. Each open port becomes a draft whose `connectionType` is mapped from the well-known port (22 → SSH, 23 → Telnet, 3389 → RDP). Progress events are emitted on the app handle so the dialog can render an in-flight status without blocking the UI thread.

The frontend preview table lets the user toggle individual rows, edit `name`/`host`/`port`/`type`/`user`, bulk-fill or overwrite usernames across the current selection, optionally bulk-set passwords for the current selection (stored only after import via the keychain path), and choose a destination — a new ConnectionFolder, the connection tree root, or any existing folder. RDCMan and MobaXterm imports preserve nested folder paths as `folderPath`, which the frontend reconstructs as ConnectionFolders under the chosen destination.

Secrets boundary: imported passwords are not persisted into SQLite alongside the draft. They are routed through the existing keychain owner used by Connection secrets, mirroring the rest of the connection storage model. Drafts without a typed password store no secret and behave like any other Connection without saved credentials. Bulk-clearing a password leaves no keychain entry for that imported Connection.

Out-of-scope vs. SSH config import: this importer does **not** parse `~/.ssh/config`. SSH config remains the responsibility of the SSH Config Importer described above; the two flows share no parser state.

### Dashboard

The Dashboard Module is a built-in Activity Rail destination that presents a 12-column drag-and-drop widget grid. Users select widgets from a catalog, customize their visual preset/accent/icon/title per instance, and arrange them freely; the AI Assistant can read the active dashboard and create, modify, or remove widgets through atomic Tauri commands.

The full architecture lives in `docs/DASHBOARD.md`. Summary of the durable shape:

- **Two widget kinds.** `builtIn` (TypeScript components in `src/modules/dashboard/widgets/`, registered in `src/modules/dashboard/registry/builtInRegistry.ts`) and `script` (JavaScript executed inside an isolated `iframe srcdoc` host with declared `network` / `pollSeconds` permissions). Built-in widgets ship with the app; `script` widgets are AI Created Widgets in v1 and stored in `dashboard_custom_widgets`.
- **Three visual presets.** `panel`, `ambient`, `hero`. Each preset is a CSS chrome wrapper that reads the widget's `--w-accent` / `--w-accent-soft` variables; presets do not encode their own palette. Ambient supports optional frosted-glass background and hides its title bar by default.
- **Per-instance customization.** Each widget instance carries `preset`, `accent_name` (palette key, not hex), `icon_name` (curated lucide whitelist), and optional `custom_title`.
- **Layout** uses `react-grid-layout` with `WidthProvider`, 12 columns, `compactType: 'vertical'`, drag handles restricted to preset headers, debounced batched layout writes through `dashboard_apply_layout`. Per-view `grid_density` (`compact` / `default` / `roomy`) is edited from the topbar in edit mode only.
- **Persistence** uses three SQLite tables: `dashboard_views`, `dashboard_widget_instances`, `dashboard_custom_widgets`. View delete cascades to instances; AI Created Widget delete cascades through Rust (conditional FK enforced manually). Fresh installs seed a Default view containing one App Launcher widget.
- **AI Assistant integration** exposes every `dashboard_*` Tauri command as a registered assistant tool with a JSON schema gated by the existing approval flow. For visible widget creation, the assistant should use `dashboard_create_widget`, which validates a structured body, creates the AI Created Widget, and places an instance on the active view in one step; successful mutating dashboard tools emit a backend `dashboard-changed` event that reloads the Dashboard store so the newly mounted widget appears without app restart. The Dashboard page-context payload sent through `onAssistantContextChange` includes a compact snapshot of the active view, its instances, and known AI Created Widgets so the AI can detect duplicates and offer edit/place/create-new choices without reading full widget source. This payload must stay metadata-only: no `bodyJson`, no `settingsSchemaJson`, no per-instance settings values, no full widget library catalog, and no generated source. Full AI Created Widget source is exposed only through the scoped `dashboard_read_widget_source` tool after the assistant has selected one widget id from metadata for checking or editing. Widget source and schema payloads are UTF-8 JSON strings; assistant tool descriptions explicitly require preserving non-English text as Unicode when creating or updating widgets. Successful Dashboard create/update tool results return redacted metadata for the affected widget/instance rather than echoing source back into the model context. The assistant must choose preset, accent, icon, and grid size deliberately from widget purpose and KKTerm's quiet desktop UI style; these presentation fields are not decorative random choices.
- **Theming.** Dashboard chrome consumes existing app CSS variables only; per-widget accent is independent of the active color scheme so a purple widget stays purple across schemes.
- **Script widget host** is a fault-isolation boundary, not a security boundary. KKTerm is MIT and single-user; the iframe exists so a typo in one widget cannot crash the dashboard and so future Tauri-command exposure is a deliberate per-handler postMessage decision.
- **Settings → Dashboard** carries cross-widget app preferences (confirm-before-remove, default landing view).

App Launcher is rendered as a `builtIn` widget hosted by Dashboard; its data model and management UI remain in `src/modules/dashboard/widgets/builtin/app-launcher/`. App Launcher is intentionally not a peer Activity Rail entry.

Current built-in widgets are App Launcher, Connection, Notes, and AI Coding Usage; each ships as a TypeScript Body component registered in `src/modules/dashboard/registry/builtInRegistry.ts`. Dashboard AI Created Widgets remain the extension point for user-specific script widgets.

When `docs/ARCHITECTURE.md` and `docs/DASHBOARD.md` conflict on Dashboard-internal concerns, `docs/DASHBOARD.md` wins.

### Installer Helper

The Installer Helper Module is a built-in Activity Rail destination (rail icon `Package`, grouped with the other built-in Module buttons near the top of the rail) that manages a curated catalog of Windows developer tools — git, node, python, docker, AI coding CLIs, and so on. Users see Installed / Updates available / Available sections; per-row actions are Install / Update / Uninstall, plus a Pin checkbox that excludes the tool from "Update all".

The catalog itself is a **JSON file embedded into the KKTerm binary at compile time** via `include_str!("../../../installer/catalog.v1.json")`. Updates to the catalog ship with each KKTerm release. There is no network fetch, no on-disk cache, and no signature verification — the trust anchor is the app binary itself (eventually backed by Windows code-signing of the KKTerm installer). The design rationale and what it supersedes from the earlier remote-signed approach lives in `docs/ADR/0008-installer-helper-bundled-catalog.md` (see also the superseded `docs/ADR/0007-installer-helper-remote-catalog.md`).

Summary of the durable shape:

- **Five recipe providers, all pure data.** `winget`, `npm`, `githubRelease`, `windowsFeature`, `bundle`. No `custom`, no script strings — a tool that does not fit one of these five shapes does not ship in the catalog.
- **Bundles** are composite recipes whose detection is the AND of their steps' detections. Dependency edges (`needs`) point to bundle ids, never to steps inside.
- **Dependency resolution** is frontend-side and lazy: when the user clicks Install, the transitive `needs` graph is walked, already-installed prerequisites are skipped, and a confirm dialog lists what will actually run. Cycle detection runs at catalog load in the Rust loader.
- **Reverse-DAG check on uninstall** lists installed dependents that would be left without a prerequisite before proceeding.
- **WSL reboot gating** sets a session-only flag when the WSL Windows feature is enabled this session; Docker Desktop (and any recipe transitively needing WSL) is disabled with an explanatory hint until KKTerm restarts.
- **UAC handling is honest** — "Update all" warns up front with the estimated prompt count. We do not try to suppress or batch UAC.
- **Cancellation** kills the child process for an in-flight install via a shared `AtomicBool` flag. For "Update all", cancel stops the queue but not the in-flight tool. Partial installs are not rolled back.
- **Persistence** is split: SQLite table `installer_tool_state(tool_id PK, pinned, latest_version_seen, last_check_at)` (schema version 17) holds per-tool prefs and the latest-version cache; the catalog itself is compile-time-embedded and needs no on-disk cache; `%LOCALAPPDATA%\KKTerm\installer\bin\<tool_id>\` holds installed `githubRelease`-provider tools; detection results and the in-flight queue are **in-memory only** so detection is always re-derived from the OS on demand.
- **Progress streaming** is via the Tauri event channel `installer://progress` carrying a discriminated `ProgressEvent` union (`step`, `stdout`, `stderr`, `progress`, `completed`, `failed`, `cancelled`). The frontend reduces these into per-tool log + current-step + ratio state in a Zustand store.
- **AI Assistant integration is deferred.** No installer Tauri command is exposed to the assistant in v1.
- **Tutorial-capable.** Targets: `app.activityRailInstaller` (rail), `installer.updateAll` (header button), `installer.toolOptions` (per-row options form).

Source layout:

- `src-tauri/src/installer/` — Rust backend: `schema.rs` (Recipe / Provider / Catalog with validate + cycle check), `catalog.rs` (compile-time `include_str!` loader), `detect.rs`, `install.rs`, `uninstall.rs`, `latest_version.rs`, `state.rs` (SQLite), `events.rs`, `commands.rs` (Tauri commands + `InstallerRuntime` state).
- `src/modules/installer/` — frontend: `InstallerPage.tsx`, `ToolRow.tsx`, `InstallerConfirmDialog.tsx`, `state.ts` (Zustand), `dag.ts` (pure DAG helpers), `types.ts`, `installer.css`.
- `installer/catalog.v1.json` — the catalog source, embedded into the Rust binary at compile time.

When `docs/ARCHITECTURE.md` and `docs/ADR/0008-installer-helper-bundled-catalog.md` conflict on installer concerns, the ADR wins.

### AI Assistant

Owns provider adapters, prompt construction, command proposal, approval flow, assistant tool registration, command execution handoff, and output capture.

Assistant input construction follows a minimum-context rule:

- **Passive page context**: metadata only. Settings exposes active section/control keys/tutorial targets. Dashboard exposes active View metadata, Widget Instance placement, AI Created Widget title/summary/category/body metadata/settings metadata, unhealthy instance ids/errors, compact visual context, and compact library key/global hints. Do not include source code, full schemas, settings values, or full catalogs in passive context.
- **Explicit user attachments**: selected terminal output, terminal buffers, screenshots, pasted images, and files are sent only after the user attaches or sends them. Keep caps/truncation at the request boundary and label every source.
- **Read tools**: full or sensitive payloads are available through narrow tools only when the task requires them. `dashboard_read_widget_source` is the pattern: first identify a widget from compact metadata, then read exactly that widget's source before updating/checking it.
- **Tool results**: avoid replaying large tool arguments or full source in successful results. Return ids, summaries, metadata, validation status, and next-action hints. Error results may include enough detail for self-correction but should still avoid unrelated state.
- **Debug logs**: raw assistant debug logging is local and sensitive. Release builds write full `aiassistant.debug.log` only when Settings → General → Debug → Advanced Debugging is enabled. Treat that file as user-private diagnostic data.

v0.1 providers:

- OpenAI-compatible endpoint with BYO API key.
- Claude Code CLI path.
- Codex CLI path.

The AI source area must enforce permission-bounded execution. Prompt mode is the default tool permission mode; mutating tools return a structured `permissionRequired` result instead of running. Allow All is an explicit user setting that lets enabled tools run automatically. CLI integrations should be constrained to suggest-only/ask-before-execute where possible.

Assistant tools are registered in `src-tauri/src/ai.rs` with JSON schemas and are filtered by persisted `assistantTools` settings. Long Dashboard widget prompt contracts live in `src-tauri/src/ai/prompt_contracts.rs`; keep prompt-contract wording there so provider streaming, tool execution, and schema plumbing stay easier to navigate. Tool families currently include general utility tools, Dashboard tools, saved Connection tools, live Session tools, and the app-owned Tutorial overlay tool. Saved Connection tools operate on durable SQLite Connection data and may list, create, open, update, or delete saved Connections. Live Session tools operate on currently mounted workspace surfaces only: terminal Panes expose visible buffer reads and input writes; RDP/VNC Sessions expose screenshots, text injection, named keypresses, and mouse clicks; SFTP/FTP browser Sessions expose listing plus create-folder, rename, and delete operations. For UI help, the assistant should answer first and offer to navigate; it should call the Tutorial tool only after the user asks to be shown or accepts the offer. The Tutorial tool may only target frontend-owned `data-tutorial-id` anchors listed in current page context or known targets documented in its schema; it may navigate to known app pages/Settings sections before highlighting, but it does not accept arbitrary CSS selectors. Every tutorial-capable target needs the anchor, a navigation entry in `src/app/tutorialNavigationModel.ts`, matching `tutorial_highlight` metadata in `src-tauri/src/ai.rs`, and manual grep hints. `npm run check` enforces this mapping so future UI additions do not strand the AI Assistant without a navigable target. Do not put live Session state into the durable Connection model to make an assistant tool easier to call.

Live Session tools cross the Rust/frontend boundary through `AssistantLiveToolBridge`. Rust emits an `assistant-live-tool-request` event and waits briefly for the frontend to complete it through `complete_assistant_live_tool_request`. The frontend handles the request in `src/ai/AssistantPanel.tsx` and resolves concrete targets through `src/modules/workspace/paneRegistry.ts`. This bridge is intentional because terminal renderers, RDP/VNC host geometry, and SFTP/FTP browser state are frontend-mounted Session surfaces. Backend Tauri commands remain the authority for native operations such as RDP key/mouse injection, VNC input events, screenshots, and SFTP/FTP filesystem actions.

RDP and VNC interactions use different transport paths behind one assistant tool family. RDP text/key/mouse operations go through native Tauri commands that target the RDP ActiveX Session; VNC text/key/mouse operations go through the existing VNC key and pointer event commands. RDP/VNC screenshots use the same transient screenshot capture path as explicit Send to AI Assistant actions. Screenshot results and terminal buffer reads are returned to the model as tool results for the active request; they are not logged by default.

OpenAI-compatible providers do not all use the same backend adapter. DeepSeek and other Chat Completions-style providers run through `run_chat_streaming`, while OpenAI/Azure/LiteLLM-style Responses providers run through `run_responses_streaming`. When changing tool-calling or streaming behavior, update and test both paths. A final streamed assistant turn must contain visible assistant content before emitting `Done`; otherwise the UI can show completed tool work with an empty assistant message. The streaming Tauri command must also return the final `AgentRunResponse` as the authoritative completed assistant message, and the frontend must reconcile the in-flight bubble from that return value after `run_ai_agent_streaming` resolves. Channel deltas are for live progress, not the only source of truth for the final text. The backend regression tests in `src-tauri/src/ai.rs` cover this with `streamed_final_answer_requires_visible_content` for the Chat Completions path, `deepseek_tool_turn_serializes_reasoning_content_and_tool_result` for DeepSeek-style thinking/tool context, and `responses_stream_parser_uses_done_text_and_function_call_id` for the Responses path. On the frontend, stream deltas must update the in-flight assistant message snapshot synchronously before React state scheduling; do not hide snapshot mutation inside a `setMessages` updater. `tests/assistant-stream-message.test.mjs` covers preserving tool status and recovering final content from the returned response. Assistant stream console diagnostics use the `[kkterm-ai]` prefix, must compile/run only in debug builds, and should stay metadata-only: provider/model, subturn, finish reason, event type, tool id/name, and content/reasoning/tool-result lengths, not raw prompt text or tool output.

Assistant stream events are a typed Rust-to-React contract. `AiStreamEvent` must serialize both variant tags and struct fields in frontend camelCase (`toolId`, `toolName`), not Rust snake_case (`tool_id`, `tool_name`). A mismatch here records malformed tool calls and can crash the Assistant work panel while rendering active tool labels, blanking the app even though Dashboard widgets are not involved. Fix this at the stream serialization/normalization boundary and keep `tests/assistant-stream-message.test.mjs` plus the Rust `ai_stream_tool_events_use_frontend_field_names` regression in place. Do not respond to this symptom by adding a Dashboard widget error boundary: Assistant panel crashes sit outside the Dashboard widget tree and that boundary cannot catch them.

Debug builds write raw AI Assistant interaction records to `aiassistant.debug.log` in the same directory as `kkterm.log`. Release builds write the same full log only when the user enables Settings → General → Debug → Advanced Debugging. This JSONL log is for local troubleshooting only and is intentionally more verbose than `[kkterm-ai]` console diagnostics: it records assistant run start/end, raw provider request/response bodies, raw SSE stream chunks, emitted stream events, tool calls/results, permission-required blocks, live Session bridge requests/completions/results, GitHub Copilot SDK prompt/response/error, and Dashboard widget creation checkpoints. Debug builds also write raw built-in and remote MCP request/response records to `mcp.debug.log` beside `kkterm.log`. Use these logs to distinguish model decisions from KKTerm harness, permission, Dashboard validation, MCP transport, and widget persistence failures. Do not add ad hoc visible in-app indicators for them, and treat the files as sensitive because raw prompts, screenshots/data URLs, file attachment text, terminal buffer reads, MCP arguments/results, tool outputs, and generated widget source can appear in them. API keys and keychain secret values should not be logged deliberately, but users must still review the files before sharing them. When diagnosing normal production issues, prefer compact logs and explicit error surfacing before asking users to enable Advanced Debugging.

Screenshot context is user-attached and transient. The Assistant sends it through OpenAI-compatible multimodal chat content only when the user submits a prompt with that screenshot context still attached.

Extension creation is currently an Assistant draft mode, not a general extension runtime. The frontend can mark a chat request as `extensionCreation`, and the backend prompt builder adds guardrails requiring reviewable designs, manifests, permission requests, and source files only. KKTerm must not claim that generated extension code was installed, enabled, executed, loaded, written to disk, or verified unless a future explicit approval flow and extension platform provide that behavior. The platform shape is defined in `docs/ADR/0005-extension-platform-architecture.md`.

### Extensions

Owns user-installed extension manifests, permissions, install/update lifecycle, isolated storage, and runtime boundaries. Extension execution is deferred until this platform exists in code. The accepted direction is manifest-first, permissioned, user-mediated, and isolated from secrets and raw live session contents by default.

### Diagnostics

Owns structured local logs, diagnostics bundle creation, and redaction rules. No telemetry or automatic crash upload in v0.1.

### Updates

Owns update discovery and installation for packaged desktop builds. The update mechanism is currently disabled while release signing is deferred. When restored, it should target the installed Windows app only, use signed Tauri updater artifacts and GitHub Releases static updater metadata for a single stable channel, and remain user-mediated.

Update checks are disabled for now. When restored, update checks may contact the configured GitHub Releases/update metadata endpoint. This network request is part of the updater flow and must be described clearly in Settings as distinct from telemetry. KKTerm must not add analytics or crash upload as part of update checking.

Installation is user-mediated. Settings owns manual update checks and update preferences, while app chrome may show a lightweight update-available notification after a successful check. The first v0.2 updater supports normal forward updates only. Rollback, downgrade, preview channels, managed update servers, silent installs, and cross-platform updater support are deferred.

## Data Boundaries

SQLite contains local, non-secret data only. OS keychain contains secrets. Terminal contents should not be logged by default. Diagnostics bundles must avoid secrets and terminal output unless the user explicitly includes selected content. Any future encrypted SQLite vault must be treated as a separate secret backend, not as ordinary settings storage.

## Frontend Layout

The primary UI is a dense desktop workspace:

- left activity rail with Workspace, Dashboard, Installer Helper, and Settings entries
- left connection tree with root Connections and optional nested folders (inside the Workspace Module)
- main Module content area (each Module owns its layout: Workspace has tabs/panes, Dashboard has widget grid, etc.)
- terminal split panes inside terminal tabs
- tmux session tags and management popovers inside SSH terminal Pane toolbars
- screenshot Region and Entire Window/Panel actions, shown in terminal Pane toolbars for terminal Sessions and top workspace toolbars for non-terminal surfaces
- SFTP dual-pane view
- right AI Assistant panel
- settings

Default visual direction: quiet productivity light chrome with dark terminal panes.

Dashboard motion is centralized in `src/modules/dashboard/motion.tsx` using `motion/react`. Dashboard surfaces should use those wrappers for entry, exit, hover, and layout transitions instead of local one-off animation props. Motion may animate opacity, transforms, scale, and layout only; colors, borders, shadows, and backgrounds must remain owned by CSS classes and the color-scheme variables in `src/styles/colorSchemes.css`. The Dashboard motion root uses user reduced-motion preferences, so new Dashboard animation should stay inside that root unless there is a product reason to opt out.

The Dashboard Module supports multiple views, each a durable SQLite-backed row in `dashboard_views` carrying its own widget instances and `grid_density`. The first view is named "Default" and is seeded on first run with one App Launcher widget. Views do not create backend Sessions or saved Connections. Dashboard supplies the shared right AI Assistant panel with an active page-context summary for the current view, including widget instances and known AI Created Widgets as compact metadata only; Settings supplies the same shared Assistant panel with the active Settings section and visible control keys from `src/modules/settings/settingsAssistantContext.ts`. Keep page context separate from terminal selected-output context in the assistant request model. App Launcher belongs to Dashboard as a widget: users add the widget to a view, then add local app, shortcut, script, or file entries inside it. Each launcher entry should render as only an icon and text label in the widget surface; editing, removal, administrator launch, alternate-user launch, and other management actions must stay in an app-owned right-click context menu. See `docs/DASHBOARD.md` for the durable Dashboard architecture, including the two widget kinds, the three visual presets, drag-and-drop layout, and the AI-Assistant tool surface.

The Activity Rail uses icons with delayed app-owned hover labels for built-in Modules and connected Connection shortcuts. Rail labels are rendered through the shared `RailTooltip` helper in `src/app/RailTooltip.tsx`; do not add native `title` tooltips because they can appear beside the app tooltip in Tauri/WebView2. Rail tooltips use the same light native-style bordered popup treatment, and connected Connection shortcuts show an insertion separator while being reordered with pointer drag. Non-Workspace Module pages must stay inset from the 48px rail and below the rail stacking layer so rail hover/focus tooltips keep working when those pages are active. The built-in rail entries are Workspace and Dashboard, followed by connected Connection shortcuts when enabled; Settings remains the bottom destination. App Launcher must not be reintroduced as a peer rail entry.

KKTerm does not include a global command palette in the current product scope; navigation and workflow entry points should stay visible in the Dashboard/connection tree, tab workspace, SFTP toolbar/context actions, assistant panel, and Settings.

The main workspace treats Tabs as frontend containers over live Sessions. Selecting another Tab changes visibility and focus only; it must not run backend Session close commands. Closing a Tab via the tab-strip close control removes that container and tears down the live Session resources it owns.

Workspace chrome layout is global state. Connection-specific live context may change assistant copy, selected terminal context, or prompt construction, but should not change the left/right panel widths or collapsed state when the active Tab changes. Native HWND-backed surfaces such as WebView2 and RDP depend on stable host bounds; changing chrome dimensions as a side effect of Tab activation creates visible native resize artifacts.

## Frontend Source Map

`src/App.tsx` is intentionally a small shell now. It composes page routing, Settings routing, global Workspace chrome, the app-wide Status Bar, and startup/bootstrap hooks. Workspace surfaces, Connection UI, Activity Rail internals, and app-shell effects live in feature or app-shell source areas so terminal, SFTP, URL, RDP/VNC, assistant, connection-tree, and Activity Rail work can proceed independently without repeatedly touching the root shell.

- `src/App.tsx` — root `App` composition, Workspace/Settings routing, Workspace chrome assembly, app-wide Status Bar placement, settings reset handoff, and startup hook wiring.
- `src/App.css` — global CSS entrypoint and cascade-order manifest. Keep `@import "tailwindcss"` first, then import shared token/base CSS, then per-feature CSS.
- `src/styles/colorSchemes.css` — global font faces, `:root` design tokens, and `[data-color-scheme="..."]` CSS custom property blocks consumed by feature CSS files.
- `src/styles/base.css` — resets and shared CSS primitives used across feature areas: icon/text buttons, dialog backdrops, command menus, form basics, and shared context-menu surfaces.
- `src/app/app.css` — app shell, Activity Rail, rail tooltips, panel resize chrome, and Tutorial overlay styling.
- `src/app/ActivityRail.tsx` — Activity Rail rendering, connected Connection shortcuts, pinned Connection actions, native rail Connection context menu, connected Connection drag ordering, and Don't Sleep control.
- `src/app/RailTooltip.tsx` — shared app-owned Activity Rail tooltip surface; use this instead of browser-native `title` tooltips for rail icon labels.
- `src/app/workspaceChromeLayout.tsx` — global Workspace chrome panel widths/collapse state, panel resize handles, layout reset, and localStorage persistence for the Connection panel and AI Assistant Panel.
- `src/app/appShellEffects.ts` — app-shell effects for frontend launch timing, host usage polling, global context-menu suppression, and app-shell CSS variables/color scheme.
- `src/modules/workspace/connections/ConnectionSidebar.tsx` — connection tree orchestration: search, drag/drop, CRUD command handlers, folder rows, native Quick Connect/Add Connection/tree/Tab context menus, and modal wiring.
- `src/modules/workspace/connections/ConnectionMenus.tsx` — browser-preview fallback Quick Connect and Add Connection menu surfaces.
- `src/modules/workspace/connections/ConnectionGlyph.tsx` — shared Connection glyph, type glyph, and Connection subtitle helpers used by rows, menus, and dialogs.
- `src/modules/workspace/connections/connectionSidebarState.ts` — sidebar-local persistence/event helpers for recent Connections, stored-secret masking, and connection-tree invalidation.
- `src/modules/workspace/connections/treeUtils.ts` — pure connection tree transforms, filtering, flattening, folder counts, and live status projection.
- `src/modules/workspace/connections/utils.tsx` — connection labels/icons, default ports, Quick Connect runtime ids, local shell options, and SSH host-key confirmation helpers shared by terminal/SFTP.
- `src/modules/workspace/connections/connections.css` — Connection sidebar, Quick Connect/Add Connection browser-preview menus, Connection dialog, import dialog, and connection-tree CSS.
- `src/modules/workspace/WorkspaceCanvas.tsx` — `TabStrip` and `WorkspaceCanvas`, including active Tab dispatch to terminal, SFTP, URL, and remote desktop surfaces.
- `src/modules/workspace/paneRegistry.ts` — in-memory registry for mounted Pane/Session affordances that must stay frontend-owned, including terminal renderers, input writers, RDP text senders, remote desktop assistant controllers, and SFTP/FTP file-browser assistant controllers.
- `src/modules/workspace/ScreenshotMenu.tsx` — native screenshot command menu, Region overlay, screenshot-to-clipboard, and screenshot-to-AI handoff.
- `src/modules/workspace/StatusBar.tsx` — bottom app-wide **Status Bar**. It remains visible across current and future Modules and pages. The left segment always renders low-frequency host usage metrics as plain icon-plus-value items with fixed-width numeric columns so the row does not shift as values change. The center segment is the universal notifications text area driven by `statusBarNotice`/`showStatusBarNotice`; all Modules should use it for transient status and error notices. CPU, RAM, downstream transfer rate, and upstream transfer rate come from low-overhead direct Windows APIs. It should not grow back into a debug timing strip; detailed performance measurements belong in diagnostics, scripts, or explicit release-measurement workflows.
- `src/modules/workspace/nativeOverlay.ts` — geometry-based overlay suppression detection for RDP ActiveX and the narrow URL WebView2 dialog-backdrop case only; update this only when a new DOM dialog or non-menu overlay is proven in the real Tauri runtime to intersect a native child surface. Keep the detector surface-aware, not document-wide. Simple command menus should use `src/lib/nativeContextMenu.ts` instead of joining this selector list. Dashboard-owned popovers should prefer an owning-component suppression prop over adding global WebView2 overlay selectors.
- `src/modules/workspace/workspace.css` — tab strip, workspace canvas, screenshot menu/Region overlay, and bottom Status Bar CSS.
- `src/app/TutorialOverlay.tsx` — app-owned guided-help overlay used by the AI Assistant Tutorial tool. It resolves constrained `data-tutorial-id` anchors, scrolls the target into view, dims the rest of the app, places a short balloon, and dismisses on the next user interaction. Because it can intersect RDP, it participates in `src/modules/workspace/nativeOverlay.ts` for RDP ActiveX parking only.
- `src/modules/dashboard/DashboardPage.tsx` — Dashboard shell: topbar, view pills, edit-mode toggle, per-view grid density control. Hosts `DashboardCanvas`.
- `src/modules/dashboard/dashboard.css` — Dashboard page, widget-grid, widget chrome, and Dashboard-specific widget CSS. It is imported through `src/App.css`, not from `DashboardPage.tsx`, so global CSS order stays centralized.
- `src/modules/dashboard/schema.ts` — TypeScript validator for AI Created script widget body JSON before browser-preview persistence and render.
- `src/modules/dashboard/state/dashboardStore.ts` — Zustand store: views, widget instances, AI Created Widgets, `activeViewId`, `editMode`, AI-Assistant read projection. The single source of truth for in-memory Dashboard state.
- `src/modules/dashboard/state/persistence.ts` — typed Tauri command wrappers for every `dashboard_*` command.
- `src/modules/dashboard/registry/builtInRegistry.ts` — built-in widget registry; the one place to add a new built-in widget along with its default preset/accent/icon/size and Body component.
- `src/modules/dashboard/registry/presetRegistry.ts` — three preset chrome components (Panel, Ambient, Hero). Presets read `--w-accent` / `--w-accent-soft` set by `WidgetFrame`.
- `src/modules/dashboard/registry/palette.ts` — accent palette table and curated ~50-icon lucide whitelist used by the customize popover and the catalog.
- `src/modules/dashboard/view/DashboardCanvas.tsx` — `react-grid-layout` host. Owns drag/resize wiring and the debounced batched layout-save pipeline.
- `src/modules/dashboard/view/WidgetFrame.tsx` — preset chrome wrapper plus edit-mode controls (remove, customize). Sets inline accent CSS variables.
- `src/modules/dashboard/view/WidgetBody.tsx` — dispatcher: `builtIn` → registry lookup; `script` → `ScriptWidgetHost`.
- `src/modules/dashboard/widgets/` — one body file per built-in widget (`AppLauncherBody.tsx`, `ConnectionWidgetBody.tsx`, `NotesBody.tsx`, `AiCodingUsageBody.tsx`). Each delegates to its implementation folder under `src/modules/dashboard/widgets/builtin/`.
- `src/modules/dashboard/widgets/builtin/app-launcher/app-launcher.css` — App Launcher widget, list/details/tile layouts, and launcher dialogs/menus.
- `src/modules/dashboard/widgets/builtin/ai-coding-usage/ai-coding-usage.css` — AI Coding Usage Dashboard widget CSS; its compact Status Bar presentation stays with `src/modules/workspace/workspace.css`.
- `src/modules/dashboard/script/ScriptWidgetHost.tsx` — `iframe srcdoc` host for `script`-kind widgets. Wires the postMessage bridge and applies declared permissions through CSP.
- `src/modules/dashboard/script/permissions.ts` — script-kind capability validation shared with the Rust validator surface.
- `src/modules/dashboard/edit/CatalogOverlay.tsx` — "Add widget" modal with search, Built-in/AI Created source tabs, and thumbnail cards.
- `src/modules/dashboard/edit/CustomizePopover.tsx` — per-instance editor: preset row, accent palette, icon picker, title input, collapsible Advanced section per kind.
- `src/modules/dashboard/motion.tsx` — centralized motion wrappers for Dashboard surfaces; per the motion rule above.
- `src/modules/workspace/connections/terminal/TerminalWorkspace.tsx` — terminal workspace, split layout view, pane host, tmux session tag/popover, terminal context menu, SSH tmux inspection helpers.
- `src/modules/workspace/connections/terminal/renderer.ts` — renderer abstraction and xterm/WebGL renderer implementation.
- `src/modules/workspace/connections/terminal/terminal.css` — terminal workspace, split panes, xterm host, tmux controls, terminal toolbar, and terminal-local menu affordances.
- `src/modules/workspace/connections/sftp/SftpWorkspace.tsx` — SFTP dual-pane browser, file panes, transfers, overwrite conflicts, context menu, properties popup.
- `src/modules/workspace/connections/sftp/sftp.css` — SFTP/FTP workspace, file panes, transfer queue, conflict dialogs, properties popover, and SFTP-specific context menu CSS.
- `src/modules/workspace/connections/webview/WebViewWorkspace.tsx` — URL Connection WebView2 host, URL Session visibility for active/inactive Tabs, webview session lease management, toolbar navigation, credential fill.
- `src/modules/workspace/connections/webview/webview.css` — URL/WebView2 workspace toolbar, address input, status, and placeholder CSS.
- `src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx` — RDP/VNC workspace host, RDP ActiveX visibility/bounds synchronization, RDP-only snapshot/parking for intersecting DOM overlays, and VNC canvas framebuffer/input handling.
- `src/modules/workspace/connections/remote-desktop/remote-desktop.css` — RDP/VNC workspace shell, placeholder, VNC canvas, and RDP suppression snapshot CSS.
- `src/ai/AssistantPanel.tsx` — AI Assistant chat orchestration: chat history, prompt submission, attachment capture, extension/dashboard intent UI, terminal send handoff, tool permission mode UI, and frontend completion of live Session tool requests. Keep new long-lived rendering helpers out of this file unless they need direct access to Assistant Panel state.
- `src/ai/AssistantMarkdownContent.tsx` — assistant markdown rendering, code-block copy/send controls, and safe external-link handoff.
- `src/ai/AssistantWorkPanel.tsx` — assistant work/timeline disclosure for reasoning content, skill invocations, tool-call progress, and waiting phrases.
- `src/ai/AssistantToolApprovalCards.tsx` — prompt-mode tool approval cards and allow/allow-for-session/deny action UI.
- `src/ai/assistantToolLabels.ts` — assistant tool-name normalization plus running/completed tool label mapping.
- `src/ai/assistantScreenshotRegion.ts` — screenshot Region geometry helpers and capture-surface wait timing used by the Assistant Panel.
- `src/ai/assistantTypes.ts` — shared Assistant Panel data shapes, including `AssistantPageContext`, chat messages, attachment records, and pending tool approval records.
- `src/ai/providers.ts` — frontend provider registry barrel and provider validation.
- `src/ai/providerRegistry/` — one provider definition per file plus shared registry types. Provider model suggestions live here, not in Settings. The Settings model picker must render these suggestions as a real provider-specific select so users can see every known model; freeform model or deployment IDs belong in the separate custom model ID input. See `docs/AI_PROVIDERS.md` before adding or changing provider structure.
- `src/ai/assistant.css` — AI Assistant panel, markdown renderer, composer, attachment previews, permission menus, tool approval cards, and assistant work timeline CSS.
- `src/modules/settings/SettingsPage.tsx` — Settings shell with sidebar nav and section routing.
- `src/modules/settings/settingsAssistantContext.ts` — Settings-to-AI context projection: active section, visible i18n control keys, and allowed tutorial targets.
- `src/modules/settings/WorkspaceSettings.tsx` — Workspace display preferences, including the top Tab Strip / Child Connection Tab presentation toggle.
- `src/modules/settings/UrlSettings.tsx` — URL Connection security defaults, saved website password metadata, and URL data shard management.
- `src/modules/settings/shared.tsx` — Shared `SettingsSummary` and `PlannedSettingsGrid` for settings pages.
- `src/modules/settings/aboutData.ts` — Product metadata and open-source component groups.
- `src/modules/settings/settings.css` — Settings shell, section fieldsets, form grids, Settings dialogs, MCP server management, assistant-skill settings, and Settings-owned import/export surfaces.
- `src/manual/manual.css` — in-app manual viewer layout and markdown CSS.
- `src/lib/clipboard.ts` — shared clipboard read/write fallback helpers.
- `src/lib/nativeContextMenu.ts` — shared Tauri native context-menu adapter for simple text command menus, including SVG/PNG/data URL-to-PNG-byte icon rasterization, with `src/lib/nativeContextMenuModel.ts` containing testable menu normalization.
- `src/lib/nativeMenuIcons.ts` — app-owned lucide-style SVG strings used by native context menu `iconSvg` entries for command-only actions; Connection menus should prefer existing Connection image assets via `iconSrc`.
- `src/i18n/config.ts` — i18next instance, language detection, dynamic locale loading, `switchLanguage()`, `ensureI18nReady()`.
- `src/i18n/useT.ts` — typed translation hook with key autocompletion.
- `src/i18n/locales/en.json` — English source-of-truth; 13 additional locale files under the same directory.
- `src/modules/workspace/connections/terminal/QuickCommandBar.tsx` — terminal Quick Command Bar, per-Connection manager dialog, From Library add flow, and custom command editor.
- `src/modules/workspace/connections/terminal/quickCommandLibrary.ts` — curated Quick Command library entries and executable snippets.

New feature code should land in the owning source area above. New feature CSS should live beside that source area and be imported from `src/App.css` in a deliberate cascade order. Shared selectors such as `.status-bar`, `.terminal-menu`, `.dialog-backdrop`, `.icon-button`, form basics, and generic context-menu rules belong in `src/styles/base.css` unless they are truly area-specific. Keep `src/App.tsx` limited to app chrome and cross-cutting bootstrap. Workspace state, settings I/O, layout serialization, terminal rendering, pane input routing, and the Tauri command boundary remain separated under `src/store.ts`, `src/lib/`, `src/modules/workspace/`, `src/modules/workspace/connections/terminal/`, and `src/lib/tauri.ts`.

## Color Scheme CSS Variables

Color schemes are defined in `src/styles/colorSchemes.css` as CSS custom property blocks keyed by `[data-color-scheme="scheme-name"]`. The `:root` block defines the `"default"` scheme. `src/App.css` imports this file before shared selectors so all feature CSS files can consume the same design tokens. Each scheme must define every variable in the list below. When adding a new scheme, also update:

- `src/types.ts` — `ColorScheme` union type
- `src/modules/settings/AppearanceSettings.tsx` — `COLOR_SCHEME_OPTIONS` and `SCHEME_PREVIEW_COLORS`
- `src/i18n/locales/en.json` — display label under `settings.scheme*`
- `src-tauri/src/storage.rs` — `validate_appearance_settings()` whitelist
- `docs/localization_todo/` — add a per-key `<namespace>.<keyPath>.md` from `_TEMPLATE.md` for any new untranslated label

### Variable → UI Area Mapping

| Variable | CSS Property | UI Area |
|---|---|---|
| `--app-bg` | `background` of `:root` | Full app background (visible behind session pane, settings) |
| `--chrome` | `background` of `.connection-sidebar`, `.assistant-panel` | Connections tree sidebar, AI Assistant panel |
| `--chrome-strong` | `background` of `.workspace` | Main workspace / session pane |
| `--surface` | `background` of `.tree-folder-row:hover`, `.search-box`, various cards/dialogs | Hover highlights, search inputs, surface-level containers |
| `--surface-muted` | `background` of sub-surfaces | Muted surface variant (Settings fieldsets, inactive panels, readonly/disabled controls) |
| `--terminal` | Terminal pane background (xterm theme) | Terminal viewport background |
| `--terminal-2` | Secondary terminal background | Split pane alternate, terminal chrome |
| `--terminal-border` | `border-color` of terminal panes | Terminal pane borders |
| `--text` | `color` of primary text | Body text, headings, primary content |
| `--text-muted` | `color` of secondary text | Descriptions, secondary labels |
| `--text-faint` | `color` of tertiary text | Placeholders, disabled text |
| `--border` | `border-color` of containers | Container borders, separators |
| `--border-strong` | `border-color` of emphasized containers | Active borders, panel resize handles |
| `--accent` | `color` / `background` of primary actions | Buttons, links, active indicators |
| `--accent-soft` | `background` of accent tints | Accent-tinted backgrounds, selection highlights |
| `--green` | `color` of success states | Success badges, connection status |
| `--green-soft` | `background` of green tints | Success-tinted backgrounds |
| `--amber` | `color` of warning states | Warning badges, pending status |
| `--amber-soft` | `background` of amber tints | Warning-tinted backgrounds |
| `--red` | `color` of error states | Error badges, disconnected status |
| `--nav-toolbar-bg` | `background` of `.workspace-toolbar`, top nav bars | Session toolbar, SSH/SFTP/RDP nav bars |
| `--nav-toolbar-text` | `color` of toolbar text | Toolbar labels, toolbar button text |
| `--nav-toolbar-hover-bg` | `background` of toolbar button hover | Toolbar button hover state |
| `--nav-toolbar-accent` | `color` of toolbar accent | Toolbar active indicators, toolbar link color |
| `--nav-toolbar-warning` | `color` of toolbar warnings | Toolbar warning indicators |
| `--nav-toolbar-tooltip-bg` | `background` of toolbar tooltips | Toolbar popup tooltip background |
| `--nav-toolbar-tooltip-text` | `color` of toolbar tooltip text | Toolbar popup tooltip text |
| `--nav-toolbar-tooltip-border` | `border-color` of toolbar tooltips | Toolbar popup tooltip border |
| `--shadow` | `box-shadow` of elevated surfaces | Dropdowns, popovers, tooltips |
| `--app-ui-font-family` | `font-family` of `:root` | App-wide UI font stack |

## Performance and Release

Performance budgets, measurement runbook, terminal renderer notes, and the latest measured numbers live in `docs/PERFORMANCE.md`. The manual terminal compatibility checklist lives in `docs/TERMINAL_COMPATIBILITY_CHECKLIST.md`.

Distribution targets, packaging scripts, the no-telemetry posture, diagnostics bundle shape, and v0.2 updater scope live in `docs/RELEASE.md`.

Architectural principle: startup and session creation must avoid eager initialization and heavyweight dependencies; expensive subsystems initialize lazily. When a change risks regressing a budget in `docs/PERFORMANCE.md`, treat that doc as the authority.

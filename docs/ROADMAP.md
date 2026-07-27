# KKTerm Roadmap

## Current Status

Quick snapshot as of July 21, 2026:

All core connection types (SSH, Telnet, Serial, FTP/FTPS, RDP, VNC, URL/WebView2, local shells, and the local File/Document viewer), terminal features, SSH port forwarding, SFTP/FTP, RDP/VNC, AI Assistant tool calling with composer attachments, Dashboard Module redesign, Install Helper, the Site-first IT Ops Module (Sites, Server Room/Rack topology, Hosts inventory, Task Library, SSH Batch Runs, and playbooks), and UI customization are implemented and shipping. The app builds for Windows, macOS, and Linux. The app metadata is currently at v0.1.127 and releasing continuously.

Release validation gates are documented in `AGENTS.md` and `docs/RELEASE.md`; run the full suite before significant code changes or release publication. Previous packaging validation passed for `npm run package:installer` and `npm run smoke:installer`.

For operational measurement records see `docs/PERFORMANCE.md`. For packaging and release artifacts see `docs/RELEASE.md`.

## What's Implemented

### Infrastructure & Foundation

- [x] Confirm working product name: KKTerm.
- [x] Initialize repository structure with MIT license.
- [x] Rust/Tauri v2/React 19/Vite scaffold with Tailwind design tokens.
- [x] App shell with light chrome and dark terminal surface.
- [x] Local logging foundation.
- [x] CI skeleton for Windows builds.
- [x] Typed Tauri command wrapper.
- [x] SQLite schema initialization and repository layer.
- [x] OS keychain abstraction.

### Connections & Workspace

- [x] Connection tree with root Connections, optional nested folders, search/filter, drag/drop reorder, rename/delete/duplicate, quick connect, and live status badges.
- [x] Named Workspaces with Activity Rail switching, a permanent Default Workspace, per-Workspace Connection trees, copy-import during Workspace creation, and Workspace-scoped open Tab visibility that keeps other Workspace Sessions alive in the background.
- [x] Tab workspace with split panes inside terminal tabs.
- [x] Runtime-only per-Tab rename for multiple Tabs opened from the same Connection.
- [x] Child Connection Tabs in the Connection Tree for saved per-Connection Tab instances, lazy reopen, tmux/session-directory resume hints, and multi-child split layouts.
- [x] Left activity rail with Workspace, Dashboard, IT Ops, Install Helper, Screenshots, and Settings entries.
- [x] MobaXterm/RDCMan import.
- [x] Telnet Connection type.
- [x] Serial (COM port / baud) Connection type.
- [x] Local File/Document viewer Connection type with log-parser selection, encoding/font menus, soft wrap, TXT fallback, and "open in external editor" for unsupported files.

### Terminal

- [x] Local terminal session lifecycle.
- [x] Windows local terminal creation options for PowerShell, Command Prompt, and WSL.
- [x] xterm.js renderer with opportunistic WebGL glyph rendering.
- [x] Terminal font, line height, cursor, scrollback, copy-on-select, multiline paste confirmation, and default shell controls.
- [x] Terminal bracketed paste, mouse support, and alternate screen behavior.
- [x] Renderer-level terminal scrollback search with pane controls.
- [x] Fixed xterm fit/pixel geometry for maximized Windows terminal panes.
- [x] Terminal renderer interface defined in code so xterm can be swapped for a future renderer.
- [x] Custom shell presets/profiles for local terminals with command-line validation.
- [x] WSL distribution selection for local terminal connections.
- [x] Shared font catalog with system-font refresh, custom font support with metadata, monospace detection/normalization, and font-atlas refresh/diagnostics across renderers.
- [x] OSC 133 shell integration: failed-command gutter marks; the renderer also tracks command-output zones. The prompt-to-prompt navigation and copy-last-command-output menu surfaces were removed/hidden — too few shells emit the marks unaided; see the backlog item on injecting shell integration.
- [x] Quick Select mode: hint-labeled keyboard copying of visible URLs, paths, IPs, hashes, and UUIDs (Ctrl+Shift+Space).
- [x] Inline images via Sixel and the iTerm2 image protocol (toggle in Terminal Settings).
- [x] OSC 9 / OSC 777 terminal notifications surfaced through the Status Bar (toggle in Terminal Settings).
- [x] User-defined hyperlink rules turning matching terminal text into Ctrl+click links.
- [x] Bundled 117-scheme terminal catalog (original KKTerm set plus the deduplicated TerminalColors catalog): palette-preview listbox in Terminal Settings with per-Connection override and hover preview in the Pane actions menu.

### SSH

- [x] In-process SSH connection lifecycle via `russh`. See `docs/ADR/0004-ssh-transport-library.md`.
- [x] Host key verification, password auth, key-file auth by path, and SSH agent support.
- [x] Terminal channel allocation and resize events.
- [x] Keep native SSH terminal Sessions connected while idle and unfocused by avoiding app-side inactivity timeouts.
- [x] Optional system SSH fallback/debug path.
- [x] SSH defaults persistence for new Connections.
- [x] Optional tmux session resume per Pane with remote session list, rename, and close actions.
- [x] Bounded silent reattach for tmux-backed channels after unexpected transport closure.
- [x] SSH config import command with unsupported directive reporting.
- [x] SSH port forwarding: saved local/remote/dynamic mappings that start on connect, editable port-name dropdowns, GatewayPorts reminder, local TCP listener discovery, remote network address discovery, and Status Bar-only transient notifications.
- [x] Native SOCKS5 proxy dialer (RFC 1928/1929) for SSH terminal, tmux, SFTP, port-forward, and key-transfer transports — no external `nc`/`ProxyCommand` helper required.
- [x] Managed X11 server (VcXsrv) launch/detection for X forwarding on Windows.

### SFTP & FTP

- [x] SFTP session reuse from SSH connection credentials.
- [x] SFTP launched from SSH terminal tabs (no standalone SFTP Connection required).
- [x] Dual-pane local/remote file manager with create folder, rename, delete, and refresh.
- [x] Upload and download for files and folders; multi-select drag/drop between panes.
- [x] Context menu with transfer, inline rename, delete, and properties.
- [x] Remote file properties with chmod and chown editing.
- [x] Transfer queue with progress, cancellation, and clearable finished history.
- [x] Overwrite behavior setting; conflict prompts with overwrite-all.
- [x] "Open terminal here" action.
- [x] FTP/FTPS Connection type.

### Diff & Compare

- [x] Compare Module surfaces (`src/modules/compare/`): side-by-side text diff, folder compare, hex compare, and image compare via a background compare worker, reachable from SFTP and the workspace.

### Git Browser

Deep dive: `docs/manual/19-git-browser.md`.

- [x] Git Browser workspace surface (`src/modules/git/`) with working tree, staging, commit menu, diff viewer (including an advanced diff view), commit graph/lanes, repo detection, an install gate, and a command palette.

### Remote Desktop

- [x] Durable RDP connection type via Windows ActiveX COM hosting.
- [x] Geometry-scoped RDP ActiveX snapshot/parking for app-owned DOM overlays so dialogs, screenshot menus, Region selection, and menus that intersect the RDP host are not covered by the native child HWND.
- [x] Configurable RDP session options (display quality/performance tuning, clipboard mapping, redirect/security controls).
- [x] Durable VNC connection type via `vnc-rs` framebuffer rendering and pointer/key input.

### Screenshots

Deep dive: `docs/SCREENSHOTS.md`, `docs/manual/14-screenshots.md`.

- [x] Screenshots Module (Activity Rail destination) with a capture library, a screenshot editor, batch dialogs, and configurable editor keyboard shortcuts.
- [x] Capture bridge shared with the AI Assistant (full surface, partial area, and region); optional DirectX capture path.

### AI Assistant

- [x] AI Assistant panel with streaming chat and OpenAI-compatible runtime.
- [x] Provider registry: OpenAI, Anthropic, OpenRouter, DeepSeek, Gemini, Grok, Azure OpenAI, LiteLLM, GitHub Copilot, Ollama, NVIDIA, OpenCode, and generic endpoints. Anthropic/Claude is served through the local Claude CLI rather than the native OpenAI-compatible runtime.
- [x] API keys stored in OS keychain; provider-specific model selector with custom model ID field.
- [x] Command proposal flow with explicit approval before execution.
- [x] Screenshot capture to clipboard and transient AI context (full surface, partial area, and region).
- [x] AI Assistant tool calling: local tools (rg, curl, filesystem search), web fetch/search, Dashboard, Connections, live Sessions, network admin, and watchdogs.
- [x] AI Assistant tool permission mode: Prompt (default, blocks mutating tools) and Allow All (explicit automatic execution). Stop cancels the in-flight run end to end, including local CLI (ACP) backends, before any further provider call or tool execution.
- [x] Risk-aware approvals: command-bearing tool calls flagged by a keyword heuristic show their risk reasons on the approval card and re-prompt even under "Allow for session".
- [x] Model-driven work plans: the assistant publishes a live step plan (`update_plan`) shown in the work panel and saved with the chat.
- [x] Persistent assistant memory: short durable notes scoped per Connection or global, recalled automatically when that Connection is active; secrets are never stored.
- [x] `mcp_list_tools` so widget authoring can ground `KK.callMcpTool` code in the real cached tool schemas of configured MCP servers.
- [x] Saved Connection tools: list/create/open/update/delete.
- [x] Live Session tools: terminal buffer reads, terminal input, RDP/VNC screenshots and input, SFTP/FTP browser list/create-folder/rename/delete actions.
- [x] Review-only extension draft mode.
- [x] MCP client: connect to external MCP servers for assistant tool calling, with cached tool-schema introspection (`mcp_list_tools`). All platforms.
- [x] Built-in MCP server bridge so external clients (Claude Desktop/Codex) can drive live KKTerm sessions. All platforms (named-pipe transport on Windows, Unix domain socket on macOS/Linux). Includes a universal `kkterm.app.dangerous.capture_window` tool that screenshots any in-app window.
- [x] Language output setting: follow UI language or a specific language.
- [x] Claude Code CLI and Codex CLI path configuration (constrained to suggest-only/ask-before-execute where possible).
- [x] Command planning safety tests.
- [x] Composer context attachments: file/photo, image, and text/terminal-buffer snippets captured into the run manifest from the composer.
- [x] Context budgeting per provider with automatic compaction of conversation history.
- [x] Local Assistant Skills: bundled `SKILL.md` workflow guides copied into app-data, listed and toggled in Settings → AI, and loaded on demand via model-driven `assistant_use_skill` invocation (see `docs/ASSISTANT_SKILLS.md`).

### Dashboard & Widgets

- [x] Dashboard Module: SQLite-backed views/instances/AI Created Widgets, three visual presets (`panel`, `ambient`, `hero`), per-widget accent/icon/title customization, drag-and-drop layout via `react-grid-layout`, dynamic backgrounds.
- [x] Two-kind widget model: `builtIn` and `script` with `iframe srcdoc` script hosting.
- [x] Built-in widgets: App Launcher (local app/shortcut/script/file entries), Connection (embedded SSH/RDP/VNC/SFTP surfaces), Notes (sticky note), AI Coding Usage (Codex / Claude Code quota), PC Info (CPU/memory/system info), and a family of individual tool widgets — Subnet Calculator, DNS Lookup, Speedtest, Ping, Whois, QR Code, Cron Builder, Password Generator, Hash Workbench, Time Converter, and Converters — that can be combined with the Tool Group widget.
- [x] AI Created script widgets.

### Install Helper

- [x] Install Helper Module with a bundled curated Windows developer-tool catalog.
- [x] Local detection, latest-version checks, install, update, uninstall, pin, and "Update all" flows.
- [x] Structured provider recipes for winget, Chocolatey, npm, uv pip, downloaded installers, GitHub releases, Windows features, WSL distros, and bundled tools.
- [x] Managed app support for app-local tools, launch actions, workspace add actions, service helpers, and streaming command logs.

### IT Ops

Design and deep dive: `docs/ADR/0011-it-ops-module.md`, `docs/ITOPS.md`, `docs/SITE.md`, and `docs/manual/12-it-ops.md`.

- [x] Site-first IT Ops Module on the Activity Rail: durable Sites (named Connection selections with optional dynamic filters) plus a global reusable Task Library.
- [x] Site topology: Server Rooms, Racks with independent Front/Rear mounting faces, and Rack Devices (Connection-backed or passive) with floor-plan and 2.5D spatial editing, PDF/Excel export.
- [x] Per-Site Hosts inventory: hostname import, child Hosts for VMs/containers, multi-Connection bindings, and bounded-concurrency TCP scans for SSH/WinRM/HTTPS endpoints.
- [x] Task Library with a synced built-in per-OS diagnostic catalog (Linux, macOS, Windows, Cisco IOS/NX-OS, FortiOS, Junos, Arista EOS); reusable script and expect-style Playbook Tasks with Applicable OS metadata.
- [x] SSH Batch Runs: fan-out task execution across selected Hosts with live per-host streamed output and a consolidated, saved Run History report.
- [x] Retired the former durable Monitor feature without deleting user data; legacy definitions are disabled, stamped obsolete, and retained in full backups and selective IT Ops exports.
- [x] Action catalog: notify, popup, email (SMTP), webhook, runBatch, and approval-gated AI intervention.
- [x] AI Assistant + built-in MCP integration for Site/Host/Task/Batch Run management under approval-gated `itops_*` / `kkterm.itops.*` tools.

### UI, Settings & i18n

- [x] Color Scheme settings for app chrome and workspace surfaces.
- [x] Language (i18n) settings with i18next; 14 locales: en, zh-TW, zh-CN, ja, ko, fr, de, es, es-MX, it, pt-BR, th, id, vi.
- [x] Settings sections: General, Appearance, Credentials, AI (with Assistant Skills and MCP Servers), SSH, Proxy, Terminal, URL, RDP, VNC, Dashboard, Install Helper, Screenshots, File Explorer, Shortcuts, and About.
- [x] Editable keyboard shortcuts: workspace shortcut overrides with conflict detection and configurable screenshot editor shortcuts (Shortcuts settings section).
- [x] Custom UI fonts; minimize-to-tray; Don't Sleep (prevents Windows sleep/suspend/hibernate/shutdown).
- [x] Backup/import via settings ZIPs; startup and manual backups in the same importable format; selective export/import of chosen items (see `docs/ADR/0010-selective-export-import.md`).
- [x] Encrypted credential secret store with unlock flow gating connection credential access.
- [x] Dashboard widget export/import with JSON preview and "imported custom widget" badges.
- [x] URL (WebView2) Connections with navigation toolbar, favicon capture, and credential metadata.
- [x] Extension platform architecture decided. See `docs/ADR/0005-extension-platform-architecture.md`.

### Performance & Quality

- [x] Local-only performance instrumentation for frontend ready time, terminal Session start time, and Windows process working set.
- [x] Budget-aware Status Bar for cold launch, local terminal readiness, SSH terminal readiness, and idle memory.
- [x] Backend tests for local-only performance snapshots.
- [x] Manual compatibility checklist: vim, tmux, htop/btop, git, npm, cargo, and pane scrollback search.

### Distribution & Packaging

- [x] Windows NSIS installer (current-user mode, creates Start Menu entries, bootstraps WebView2).
- [x] Portable Mode (Windows portable v1): a no-installer ZIP that keeps KKTerm-owned durable state next to the executable and can coexist with an installed copy; created via the in-app Portable Creator (see `docs/PORTABLE.md`).
- [x] Installer smoke test (checksum verify, silent install/uninstall into temp directory).
- [x] GitHub Release script: version bump across npm/Tauri/Cargo, build, smoke test, commit, tag, push, and create release.
- [x] macOS DMG release helper: build on macOS, upload DMG/checksum to an existing GitHub Release, and patch release notes.
- [x] Linux AppImage packaging and release helper (`scripts/package-linux.sh`, `scripts/release-github-linux.sh`; see `docs/LINUX_PORT.md`). deb/rpm remain out of scope for now.
- [x] Cloudflare release mirroring for download assets.
- [x] In-app update flow with cancellable downloads, progress indication, update-asset URL handling, and checksum validation.
- [x] No-telemetry posture: no analytics, no crash upload, diagnostics are local files.

## Planned

### AI & Automation Expansion

- [ ] Expanded AI orchestration: import Connection entries from multiple formats, monitor Connections, rename/reorganize layouts, optionally relay interactions through Telegram/WhatsApp/LINE integrations.
- [ ] AI reference to previous session text buffers via RAG/agentic search.
- [ ] Voice input for AI Assistant with local model support.

### Dashboard & Modules

- [ ] Redesign legacy widget bodies (hash, subnet, quick tools, maintenance report) to take full advantage of the new preset chrome.
- [ ] Native data widgets: Clock, Weather, Recent Hosts, Session Activity, Today's Brief (CPU/Memory/system info already ship via the PC Info widget).
- [ ] Built-in Connections widget and URL widget with configurable auto-reload intervals.

### Extension Platform

- [ ] General user-installable extension support (permissions, install/update lifecycle, and trust boundaries defined in ADR-0005).

### Workflow Simplification

- [ ] Evaluate whether broader durable Tab persistence is still needed beyond the implemented Child Connection Tab model, including per-Tab order, close semantics, and Pane/tmux metadata that must stay separate from durable Connection records.
- [ ] If broader durable Tab persistence is pursued, keep it in Workspace-owned Tab state rather than Connection-owned presets so Connection data remains separate from workspace containers.
- [ ] Simplify common workflows and reduce unnecessary visual or interaction complexity.

### Cross-Platform & Distribution

- [ ] Linux deb/rpm packaging (AppImage already ships).
- [ ] Windows Authenticode signing for installer.
- [ ] Tauri updater artifact signing and `latest.json` generation (currently stubbed with TODOs in `scripts/release-github.ps1`).
- [ ] Update checks enabled by default with clear local-first wording; install remains user-mediated.
- [ ] Optional crash reporting after explicit opt-in design.
- [ ] WGPU terminal renderer replacement (deferred; xterm WebGL is current fast path).

### Terminal Power Features (WezTerm-inspired backlog)

Second-tier follow-ups to the shipped OSC 133 / Quick Select / inline images / notifications / hyperlink rules / color schemes batch:

- [ ] KKTerm-injected shell integration (Warp/Kitty-style): opt-in per Connection, reuse the existing startup-script plumbing to emit OSC 133 (+ OSC 7) marks in bash/zsh/fish/PowerShell without user dotfile edits; this is the prerequisite for reinstating prompt-to-prompt scrollback navigation and the copy-last-command-output menu surface.
- [ ] Copy Mode: keyboard-driven (vim-style) scrollback navigation and selection.
- [ ] Global command palette spanning app actions (open Connection, split Pane, switch Workspace); generalize the existing Git Browser palette.
- [ ] Pane zoom (temporarily maximize one Pane in a split) and directional keyboard Pane focus/resize.
- [ ] Extend the shipped editable-keybinding system with terminal-scope bindings and an optional tmux-style leader key.
- [ ] `kkterm` CLI for scripting the app from a shell (spawn/split/send-text over the existing MCP/tool backend).
- [ ] Kitty keyboard protocol (progressive keyboard enhancement); xterm.js gap noted on the terminal compatibility checklist — modern TUIs increasingly probe for it.
- [ ] Font ligatures need a shaping renderer; fold into the WGPU renderer evaluation above (WezTerm's MIT `termwiz`/`wezterm-term` crates are candidate foundations).

### Session Logging & Universal Search

- [ ] Autosave all terminal/SSH/Telnet/Serial text buffers to plain-text logs organized by Connection name and serial.
- [ ] Session log browser per Connection.
- [ ] Universal search across all session logs and Connection items.

### SFTP Enhancements

- [ ] SFTP folder sync/diff/resume.
- [ ] Extend the shipped Compare Module with SFTP sync/merge actions (side-by-side diff, folder, hex, and image compare already ship; see the Diff & Compare section).

### Recording

- [ ] RDP/VNC screen recording using ffmpeg

### Additional Protocols

- [ ] Apple Remote Desktop support (low priority).
- [ ] Hyper-V client support (low priority).
- [ ] VMware vSphere support (low priority).

### IT Ops Center

Design accepted: see `docs/ADR/0011-it-ops-module.md`, `docs/ADR/0012-winrm-transport-library.md` (WinRM transport for Windows Update playbooks), `docs/ITOPS.md`, and `docs/manual/12-it-ops.md`. The Site-first module now ships Sites, Server Room/Rack topology, Hosts inventory, the global Task Library (script and Playbook Tasks), and SSH Batch Runs with Run History. Batch Runs currently reach hosts over SSH only; the items below extend transports and operational depth.

- [ ] Windows remote management (WinRM/WS-Man) Batch Run transport per ADR-0012, so Batch Runs and playbooks reach Windows hosts without OpenSSH. The runner and UI already target a common `Transport` trait; today non-SSH hosts are skipped and the WinRM/PsExec adapters remain stubbed (Phase 6).
- [ ] PsExec (SMB/named-pipe) Batch Run transport for Windows hosts, shipped as an Install Helper recipe behind the same `Transport` trait.
- [ ] Network device SNMP status polling: promote the scaffolded SNMP path (`SnmpRefreshRequest`/`SnmpPortSample` model, port-speed parser, and Rack Device `snmp` metadata) from its current no-op transport to real SNMP GET/WALK polling, surfacing live port speed/state on Rack Devices and Hosts with scheduled refresh.
- [ ] Automated server-update playbooks (apt, dnf, yum, Windows Update via WinRM) with dry-run preview and rollback-aware sequencing.
- [ ] AI-enabled triggers watching terminal output, SFTP changes, or scheduled probes.
- [ ] Richer cross-transport Batch Runs beyond the current implemented paths.

### Future Scope Evaluations

- [ ] Team sharing/sync (major product-scope decision before implementation).
- [ ] Mobile apps (major platform-scope decision after desktop architecture proves itself).

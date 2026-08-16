# KKTerm — AI Agent Instructions

> **To the AI assistant reading this:**
> Read this entire document before taking any action or asking the user questions.
> Once you have read it fully, go directly to the **[Choose Your Path](#choose-your-path)** section at the bottom and ask the user which path they want, translate to user's language. Do not install anything, clone anything, or open any browser until the user has chosen.

---

## What is KKTerm

KKTerm is a cross-platform, local-first desktop workspace for people who live in terminals, SSH sessions, file transfers, and remote desktop all day. It combines saved Connections, live Sessions, split terminal panes, SFTP/FTP dual-pane file management, embedded URL WebViews, RDP and VNC workspaces, a widget Dashboard, an Install Helper, a Screenshots library, an IT Ops site-operations Module, user-installed Custom Modules, and an AI Assistant with approval-based tool execution — all in one native app.

**Tech stack:** Rust + Tauri v2 backend, React 19 + TypeScript + Vite frontend, SQLite for non-secret local data, OS keychain for secrets (Windows Credential Manager / macOS Keychain; Linux uses an encrypted SQLite store), xterm.js for terminal rendering, WebView2 overlay windows for URL surfaces, the Microsoft RDP ActiveX control for RDP on Windows (IronRDP on macOS/Linux), and `vnc-rs` for VNC.

**Key values:**

- **Local-first** — no telemetry, no cloud account. Durable data is in SQLite on the user's machine, secrets are in the OS keychain.
- **License** — MIT with Commons Clause: you can use, modify, and self-host freely, but not repackage and sell it. Some vendored crates, bundled fonts/icons, and Custom Modules carry their own licenses; see `LICENSE` and `README.md`.
- **Cross-platform desktop** — release builds target Windows (x64 and ARM64, installer and portable ZIP), macOS (universal), and Linux (AppImage), preserving native OS behavior where features differ.
- **Current version:** see `package.json` `version` field or the About section in Settings.

**GitHub repository:** <https://github.com/ryantsai/KKTerm>

---

## Prerequisites

Check for each tool before installing. Install only what is missing.

### Git

```powershell
git --version
```

If missing: download from <https://git-scm.com/download/win> and install with default options.

### GitHub CLI (`gh`)

```powershell
gh --version
```

If missing:

```powershell
winget install --id GitHub.cli
```

Or download from <https://cli.github.com>. After installing, authenticate:

```powershell
gh auth login
```

Choose **GitHub.com → HTTPS → Login with a web browser** and follow the prompts.

### Rust (stable toolchain)

```powershell
rustup --version
```

If missing, install `rustup` from <https://rustup.rs> — run the downloaded `rustup-init.exe` and accept the defaults (stable toolchain).

After installing, verify:

```powershell
rustc --version
cargo --version
```

### Node.js 20+ and npm

```powershell
node --version
npm --version
```

If missing: download the LTS installer from <https://nodejs.org> and install with defaults.

### WebView2 Runtime

WebView2 is required by Tauri on Windows. It is pre-installed on Windows 11 and most up-to-date Windows 10 machines. To verify:

```powershell
Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue | Select-Object pv
```

If the command returns nothing, download and run the WebView2 Evergreen bootstrapper from <https://developer.microsoft.com/en-us/microsoft-edge/webview2/>.

### Tauri CLI

```powershell
cargo tauri --version
```

If missing:

```powershell
cargo install tauri-cli --version "^2"
```

This step takes a few minutes on first install.

---

## Fork and Clone the Repository

> **AI note:** Do this only if the user wants to contribute code or set up a dev environment. Skip to [Downloading a Release](#downloading-and-installing-a-release) if the user just wants to install the app.

### Fork on GitHub

1. Go to <https://github.com/ryantsai/KKTerm>
2. Click **Fork** (top right) and fork to your own GitHub account.

Or with `gh`:

```powershell
gh repo fork ryantsai/KKTerm --clone=false
```

### Clone your fork

```powershell
git clone https://github.com/<your-username>/KKTerm.git
cd KKTerm
```

Add the upstream remote so you can pull future changes:

```powershell
git remote add upstream https://github.com/ryantsai/KKTerm.git
```

---

## Dev Environment Setup

Inside the cloned repo:

```powershell
npm install
```

Verify the dev build runs:

```powershell
npm run tauri dev
```

This compiles the Rust backend and starts the Vite dev server. First compile takes a few minutes. The KKTerm window should open when ready.

**Common checks before submitting a PR:**

```powershell
npm run check                                    # ESLint + frontend test suite + tsc --noEmit
npm run build                                    # Frontend production build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

All four must pass cleanly before opening a PR. Under `AGENTS.md` the full check suite is only required after a significant code change (more than 500 changed lines); cosmetic UI or documentation-only changes can skip it. When adding or changing locale keys, also run `npm run i18n:check` (and `npm run i18n:normalize` after broad locale edits).

---

## Downloading and Installing a Release

> **AI note:** Use this path if the user just wants to try KKTerm without building from source.

1. Go to <https://github.com/ryantsai/KKTerm/releases>
2. Download the latest `kkterm-<version>-windows-x64-setup.exe` (an ARM64 installer and portable ZIP builds for both architectures are also published).
3. Run the installer.

**Windows SmartScreen warning:** The installer is currently unsigned (code signing is deferred). Windows may show a "Windows protected your PC" dialog. Click **More info → Run anyway** to proceed. This is expected for unsigned open-source apps.

The installer uses current-user install mode — no admin rights required. It creates Start Menu entries and does not require WebView2 to be installed separately (the installer downloads the WebView2 bootstrapper if needed).

---

## Codebase Navigation

### Directory layout

```
KKTerm/
├── src/                        # React/TypeScript frontend
│   ├── app/                    # App shell: App.tsx, Activity Rail, ModuleHeader, DialogPortal, rail tooltips, workspace chrome
│   ├── modules/                # Feature Modules
│   │   ├── workspace/          # Workspace Module: Connection tree, Tabs/Panes, terminal, SFTP/FTP/File Explorer, URL WebView, RDP/VNC
│   │   ├── dashboard/          # Dashboard Module: views, widget grid, widget registry, App Launcher, script iframe host
│   │   ├── installer/          # Install Helper Module (curated Windows dev-tool catalog)
│   │   ├── itops/              # IT Ops Module (Sites, Hosts, Tasks, Batch Runs, IPAM, Network Maps)
│   │   ├── screenshots/        # Screenshots Module (library, capture, viewer/editor)
│   │   ├── custom-modules/     # Custom Module (.kkmod) frontend host
│   │   ├── system-cleaner/     # Windows-only System Cleaner Module
│   │   ├── settings/           # Settings sections (General, Appearance, AI, SSH, Terminal, MCP, Proxy, …)
│   │   ├── compare/            # File Compare overlay (File Explorer + SFTP/FTP)
│   │   └── git/                # Git Browser overlay
│   ├── ai/                     # AI Assistant panel, provider registry, streaming, live tool bridge
│   ├── watchdog/               # Watchdog Status Bar indicator and detail panel
│   ├── manual/                 # In-app operation manual viewer (ManualPage.tsx)
│   ├── i18n/                   # i18next config, locale files (en.json is source of truth)
│   ├── styles/                 # colorSchemes.css design tokens, base.css
│   └── lib/                    # Tauri command wrappers, native context menus, shared utilities
├── src-tauri/                  # Rust backend (Tauri v2)
│   ├── src/
│   │   ├── lib.rs              # App setup, window lifecycle, command registration, tray
│   │   ├── storage.rs / storage/  # SQLite schema, migrations, repositories
│   │   ├── secrets.rs / secrets/  # OS keychain wrappers, encrypted SQLite secret store
│   │   ├── ssh.rs / ssh_config.rs / ssh_keys.rs / socks.rs  # russh SSH client, config importer, SOCKS5
│   │   ├── sftp.rs / ftp.rs / file_viewer.rs / launch_paths.rs
│   │   ├── windows_local_pty.rs / telnet.rs / serial.rs  # Local PTY / Telnet / Serial transports
│   │   ├── rdp.rs / rdp_client.rs / remote_fullscreen*.rs  # RDP ActiveX + IronRDP sessions
│   │   ├── vnc.rs              # VNC framebuffer session (vnc-rs)
│   │   ├── webview.rs          # WebView2 URL session commands
│   │   ├── ai.rs / ai/         # AI provider adapters, streaming, tool execution
│   │   ├── mcp.rs / mcp_bridge.rs / mcp_protocol.rs / mcp_tool_catalog.rs  # MCP server management + built-in MCP bridge
│   │   ├── dashboard_*.rs      # Dashboard commands, storage, validation, id generation
│   │   ├── app_launcher.rs     # App Launcher widget commands
│   │   ├── ai_coding_usage.rs  # AI coding usage tracking commands
│   │   ├── installer/          # Install Helper catalog, detection, install/uninstall, latest version
│   │   ├── itops/              # IT Ops storage + commands (IPAM import, etc.)
│   │   ├── watchdog/           # Watchdog registry, polling, event emission
│   │   ├── custom_modules.rs   # Custom Module (.kkmod) install, validation, v2 host bridge
│   │   ├── system_cleaner.rs / system_cleaner_recipes.rs  # Windows System Cleaner
│   │   ├── git.rs              # Git Browser commands
│   │   ├── screenshot.rs / video_recording.rs / media.rs
│   │   ├── manual.rs           # In-app manual search commands
│   │   ├── diagnostics.rs      # Diagnostics bundle collection
│   │   ├── import.rs / selective_export.rs  # Connection import, settings export/import
│   │   ├── github_copilot.rs   # GitHub Copilot OAuth token flow
│   │   ├── app_updates.rs / portable_*.rs / window_state.rs
│   │   ├── net/                # Proxy resolution, network helpers
│   │   └── ...
│   └── Cargo.toml
├── docs/                       # Architecture, PRD, ADRs, release notes, shipped manual
│   ├── ARCHITECTURE.md         # Frontend source map, engineering defaults
│   ├── PRD.md                  # Product requirements
│   ├── ROADMAP.md              # Planned features
│   ├── DASHBOARD.md            # Dashboard Module durable architecture
│   ├── ITOPS.md / SITE.md      # IT Ops Module architecture / Site terminology
│   ├── DESIGN_LANGUAGE.md      # UI tokens, dialog primitives, ConfirmSheet pattern
│   ├── AI_PROVIDERS.md         # Rules for adding/changing AI provider entries
│   ├── MCP.md                  # Built-in MCP tool catalog
│   ├── CUSTOM_MODULE_CATALOG.md / KKMOD_HOST_API_V2.md / CUSTOM_MODULE_PACKAGING.md
│   ├── PORTABLE.md / RELEASE.md / RDP_ACTIVEX_GOTCHAS.md / PERFORMANCE.md
│   ├── manual/                 # Operation manual shipped with the app (see below)
│   └── ADR/                    # Architecture decision records
├── custom-modules/             # Bundled third-party Custom Module sources + catalog.v2.json
├── installer/catalog.v1.json   # Install Helper catalog, embedded into the binary at compile time
├── AGENTS.md                   # Engineering rules for AI agents and contributors
├── CONTEXT.md                  # Domain vocabulary
└── package.json
```

### Domain vocabulary

Before touching code, read these definitions — they matter for naming, storage decisions, and where to put things. The full vocabulary with "avoid" terms lives in `CONTEXT.md`.

| Term | Meaning |
|---|---|
| **Connection** | A durable saved resource stored in SQLite. Kinds: local terminal, SSH, Telnet, Serial, URL, RDP, VNC, FTP/FTPS, File Explorer (`localFiles`), Document (`fileView`). |
| **Workspace** | A named, isolated container of Connections, switched from the Activity Rail. The Default Workspace is seeded and permanent. |
| **Quick Connect** | A fast path that persists a saved Connection (reuse-or-create) and starts a Session on it. Only the external elevated admin shell (when KKTerm is not elevated) is not saved. |
| **Session** | A live runtime instance — a PTY, SSH channel, SFTP browser, WebView2 host, RDP control, or VNC framebuffer. |
| **Tab** | Frontend workspace container. Tabs hold Sessions (or split Panes). Closing a Tab ends the Session. |
| **Module** | A top-level Activity Rail destination. Built-ins: **Workspace**, **Dashboard**, **Install Helper**, **Screenshots**, and **IT Ops** (plus the Windows-only System Cleaner); **Settings** is the bottom rail destination. **Custom Modules** are user-installed `.kkmod` packages that add rail destinations. |
| **Dashboard** | Built-in Activity Rail Module hosting a 12-column drag-and-resize widget grid with multiple Views. |
| **Dashboard AI Created Widget** | A script-only widget defined in `dashboard_custom_widgets`, hosted in an isolated `iframe srcdoc`. Authored by the AI assistant. |
| **Widget Preset** | One of three chrome styles per Widget Instance: `panel`, `ambient`, `hero`. |
| **Saved Credential** | A durable, reusable login (label + username + password) shared across SSH/Telnet/RDP/VNC/FTP Connections. Password bytes live only in the secret backend; managed in Settings → Credentials. |
| **Watchdog** | An ad-hoc in-memory monitor (ping, TCP reachability, performance counter, SSH output silence) surfaced via the Watchdog Status Bar indicator. Not durable data. |

**SFTP** is opened from an SSH Connection — it is not a standalone Connection type. **FTP/FTPS** is a standalone Connection type routed through the same file-browser workspace, and **File Explorer** (`localFiles`) is a single-pane local browser using the same shell.

### Key reference docs

- `AGENTS.md` — engineering rules every contributor must follow before writing code
- `CONTEXT.md` — full domain vocabulary with "avoid" terms
- `docs/ARCHITECTURE.md` — frontend source map, where to place new code, UI/settings conventions
- `docs/PRD.md` — full product requirements and user stories
- `docs/ROADMAP.md` — what is planned vs. deferred (don't build deferred features)
- `docs/AI_PROVIDERS.md` — rules for adding or changing AI provider entries
- `docs/DASHBOARD.md` — Dashboard Module durable architecture (views, widget instances, script widget security)
- `docs/ITOPS.md` / `docs/SITE.md` — IT Ops Module architecture and Site/Server Room/Rack terminology
- `docs/DESIGN_LANGUAGE.md` — UI design language: color tokens, dialog primitives, `ConfirmSheet`, button order
- `docs/MCP.md` — built-in MCP tool catalog (must be updated when built-in MCP tools change)
- `docs/CUSTOM_MODULE_CATALOG.md` / `docs/KKMOD_HOST_API_V2.md` — Custom Module catalog and host API
- `docs/PERFORMANCE.md` — performance notes and targets
- `docs/manual/INDEX.md` — **operation manual** shipped with the app, 20 chapters. Chapters cover rail Modules and their sub-features; each chapter starts with an `## AI grep hints` block listing i18n keys and synonyms. When a user asks "how do I…" inside the app, the built-in AI Assistant searches this folder. **When a PR changes UI behavior, update the matching chapter in `docs/manual/` in the same PR**, and prefer referencing i18n keys (e.g. `connections.quickConnect`) over English label text so locale changes don't invalidate the manual. If the assistant can offer to show the user a UI element, add a stable `data-tutorial-id`, route it in `src/app/tutorialNavigationModel.ts`, document it in the `tutorial_highlight` tool metadata, and keep `npm run check` green.

---

## Reporting an Issue

Before filing, search existing issues at <https://github.com/ryantsai/KKTerm/issues> to avoid duplicates.

### Required for all bug reports

- **KKTerm version** — found in Settings → About, or `package.json` `version`
- **Windows version** — run `winver` in PowerShell and copy the result
- **Exact steps to reproduce** — numbered, step by step, starting from app launch
- **What you expected to happen**
- **What actually happened**

### Required for UI or visual bugs

- **Screenshot or screen recording** — no screenshot means the issue will be low priority. Use Windows + Shift + S for a quick snip, or the built-in Xbox Game Bar (Windows + G) for screen recording.

### Good to include (not required)

- Relevant section of `kkterm.log` if the app logged an error (find the log via Settings → About → Open app data folder)
- Whether the issue is reproducible every time or intermittent
- Any relevant SSH host OS, shell, or terminal tool (for terminal/SSH issues)

File issues at: <https://github.com/ryantsai/KKTerm/issues/new>

---

## Opening a Pull Request

### Before writing any code

1. **Read `AGENTS.md` fully.** Every rule there applies to your PR. Key rules:
   - Surgical changes only — touch the minimum code needed
   - No speculative features or abstractions beyond what was asked
   - All user-visible strings must use `t()` / `useTranslation()` — no hardcoded English in JSX. New keys go into `src/i18n/locales/en.json` first, with one pending file per key under `docs/localization_todo/`, even when an AI session adds best-effort translations to the 13 other locale files
   - zh-TW must use Taiwan computing terminology, never Mainland Chinese terms (連線 not 連接, 儲存 not 保存, 資料 not 數據, …); never copy from `zh-CN.json`
   - One full sentence per key with named `{{…}}` placeholders; a separate key per meaning, not per spelling
   - Read `docs/DESIGN_LANGUAGE.md` before adding any dialog, sheet, settings surface, or file-browser UI; build dialogs from `src/app/ui/dialog` primitives and read color tokens from `src/styles/colorSchemes.css`
   - Follow existing code patterns — don't introduce new abstractions for single-use code
   - Run the full check suite only when required by `AGENTS.md` (more than 500 changed lines)

2. **Check `docs/ROADMAP.md`** — if the feature you want to build is listed as deferred, open an issue first to discuss before building it.

3. **Check `docs/ARCHITECTURE.md`** — before placing new UI or Rust code, verify you're putting it in the right source area.

4. **Respect native-surface layering** — CSS `z-index` cannot place React UI
   above URL Connection `WebviewWindow`s, Custom Module overlay WebViews, or
   Windows RDP ActiveX HWNDs. A right-click menu that can overlap either
   surface must use `src/lib/nativeContextMenu.ts`. A dialog or advanced DOM
   popover that may overlap one must portal at the app-window level when
   full-window and add its narrow visible selector to
   `src/modules/workspace/nativeOverlay.ts`, which drives URL snapshot/hide
   and RDP-only snapshot/park. Do not solve this by strategic menu placement
   or by extending RDP parking to WebView2.

### Branch naming

```
fix/short-description-of-bug
feat/short-description-of-feature
```

### Creating the PR

```powershell
git checkout -b fix/your-branch-name
# ... make changes ...
git add <specific files>
git commit -m "fix: short description of what changed"
git push origin fix/your-branch-name
gh pr create --web
```

### PR body — what Ryan needs to review

Your PR description must include:

```
## What changed
[1-3 bullet points describing the change]

## Why
[Link to the issue this fixes, or a 1-sentence explanation if no issue]

## How to test
[Step-by-step repro or test instructions]

## Checklist
- [ ] Read AGENTS.md and followed all rules
- [ ] Required checks pass, or this change does not require the full check suite under `AGENTS.md`
- [ ] All user-visible strings go through i18n: keys added to `en.json`, pending localization TODOs created under `docs/localization_todo/` (one per key), no hardcoded English in JSX
- [ ] zh-TW uses Taiwan terminology (never Mainland Chinese terms)
- [ ] Manual chapter updated in the same PR if UI behavior changed (`docs/manual/`)
- [ ] Screenshot included if UI changed
```

---

## UI Walkthrough

### Activity Rail

The narrow left rail is the app's navigation spine. Sections, top to bottom:

- **Workspace switcher** — the Default Workspace, any additional Workspaces, and the New Workspace action
- **Module destinations** — Dashboard, IT Ops, Install Helper, and Screenshots (each can be hidden or reordered in Settings → General)
- **Custom Modules** — enabled `.kkmod` package contributions render in their own divider group after the built-ins
- **Connection Rail** — connected Connection shortcuts (when the Workspace setting enables them)
- **Don't Sleep** (coffee icon) — keep-awake control and scheduled-shutdown countdown
- **Settings** (gear icon, bottom) — app configuration

Hover any rail icon for a tooltip label. Right-click connection shortcut icons in the rail for quick actions. On Windows, the System Cleaner Module appears as an additional rail entry when enabled in Settings → General.

### Connections Panel

Inside Workspace, the left panel shows the Connection tree of the active Workspace. Connections are organized into optional folders. Actions:

- **Click a Connection** to open a Session in a Tab
- **Right-click** for rename, duplicate, delete, open SFTP, pin to rail
- **Drag** to reorder or move into folders
- **Search bar** at top filters the tree
- **Quick Connect button** (+ icon) saves a Connection (reusing an identical existing one when present) and opens a Session on it

### Sessions and Tabs

Each open workspace container appears as a Tab in the workspace area. Tabs are managed from the Tab Strip:

- Click a Tab to switch to it — live Sessions stay mounted
- Right-click a Tab for close, rename, duplicate pane options
- **Split panes**: use the split button in a terminal pane toolbar to add a second pane inside the same Tab
- When Settings → Workspace hides the top Tab Strip, Child Connection Tabs appear as italic rows under their parent Connections in the Connection Tree

### Terminal Panes

Each terminal pane in a Tab runs an independent shell (local, SSH, Telnet, or Serial). Key behaviors:

- Copy-on-select is a configurable toggle in Settings → Terminal
- Multiline paste shows a confirmation dialog
- Scrollback search: Ctrl+Shift+F inside a pane
- Screenshot button in the pane toolbar captures the terminal to clipboard or AI context
- SSH Connections can launch Panes inside named tmux sessions, with a session toolbar in the Pane

### File Browser Workspace

Open SFTP from a saved SSH Connection (right-click → Open SFTP, or from the Session toolbar). The dual-pane browser shows local files on the left, remote files on the right. Drag files between panes to transfer. The transfer queue at the bottom shows progress and history. FTP/FTPS Connections and File Explorer Connections (`localFiles`) use the same browser shell — File Explorer shows a single local pane with no remote host.

### Dashboard

The Dashboard hosts drag-and-resize widgets on a 12-column grid across multiple Views. Click the pencil (edit) icon in the topbar to enter edit mode and add, move, or resize widgets. Built-in widgets include App Launcher, Connection, Notes, AI Coding Usage, PC Info, Network Tools, Generators, and Converters. The AI Assistant can create AI Created Widgets (script-only, sandboxed `iframe srcdoc`).

### IT Ops

The IT Ops Module is a site-operations surface: Sites with Server Rooms and Hosts, a global Task Library, Batch Runs over Sites via SSH/WinRM/PsExec transports, VLANs, IPAM, and Network Maps. Run History persists per Site. Live run state stays in memory — KKTerm installs no background service.

### Install Helper

The Install Helper manages a curated catalog of Windows developer tools (git, node, python, docker, AI coding tools, and more) with install/update/uninstall flows, dependency resolution, and bundled catalog data embedded in the app binary. Tools that are managed server apps (n8n, Flowise, Open WebUI, …) expose Run/Stop/Open web UI and Register-as-service actions.

### Screenshots

The Screenshots Module captures screenshots into a user-configurable library folder with thumbnail/details views. Capture modes — interactive region, window, and full screen — are reachable from the Module header, the tray icon menu, configurable global hotkeys, and the per-Pane Workspace screenshot menu. The library supports batch resize/conversion, multi-select delete, and a unified viewer/editor with crop, annotations, and mosaic regions.

### Custom Modules

Custom Modules are optional, user-installed `.kkmod` packages (static HTML/CSS/JS/WASM running in an isolated native WebView through the `kkmodule` protocol). Settings → Custom Modules owns install review, permissions, enable/disable, rollback, and uninstall. Enabled rail-visible contributions appear in the Activity Rail after the built-in Modules.

### AI Assistant Panel

Open the AI Assistant from the chat icon in the workspace toolbar or from a terminal pane. Key concepts:

- **Tool permission mode** — shown in the chat composer. **Prompt** (default) blocks mutating tool calls and asks you to approve each one. **Allow All** lets enabled tools run automatically.
- **Tool families** — enabled in Settings → AI Assistant → Assistant tools: Dashboard tools, Connection management tools, Live Session tools (interact with open terminal/SFTP/RDP/VNC panes), IT Ops, Install Helper, Screenshots, Watchdog, and more.
- **MCP Servers** — custom Model Context Protocol servers can be added in Settings → AI Assistant → MCP Servers and become available as additional tool families.
- **CLI backends** — OpenAI and Anthropic can optionally delegate assistant turns to local Claude Code / Codex CLIs; Cursor is a CLI-only provider using the local Cursor Agent CLI. These use the vendor CLI's own cached authentication.
- **Context attachments** — use the screenshot button to attach terminal content or a workspace capture to the AI message.
- **AI Created Widgets** — the assistant can author Dashboard widgets (script-only, sandboxed `iframe srcdoc`) on request. Users customize and remove them; creation is AI-only in v1.
- The AI can propose commands, manage saved Connections, read/write Dashboard widgets, and interact with live Sessions — within the permission boundary you set.

### Settings

Open Settings from the gear icon at the bottom of the Activity Rail. Sections:

- **General** — language, Activity Rail visibility/reorder, auto backup, Windows auto-start and update checks, minimize-to-tray (Windows), Status Bar controls, debug group, settings data export/import, database/log folder openers, reset all
- **Appearance** — app UI font, color scheme
- **Workspace** — Tab Strip/Child Connection Tabs, double-click-to-open, rail Connection shortcuts
- **File Explorer** — local file open behavior and shell preferences
- **Dashboard** — confirm-before-remove widget, default landing view, widget network-tools permission
- **Install Helper** (Windows) — update-check interval, default package provider
- **Custom Modules** — install, permissions, enable/disable, rollback, uninstall of `.kkmod` packages
- **Credentials** — credential backend selection, Saved Credential manager (rename, password rotation, usage, merge), legacy password conversion, app-secret delete actions
- **AI Assistant** — provider, model, API key, CLI backends, tool permissions, MCP Servers, output language, insecure TLS toggle
- **SSH** — SSH defaults, tmux behavior, port forwarding visibility, clipboard policy, SFTP transfer defaults
- **Terminal** — font, size, cursor, scrollback, default shell, custom shell profiles, Quick Command bundles
- **URL** — URL Connection security defaults, saved website data, data shard management
- **RDP** (Windows) — RDP quality defaults
- **VNC** — VNC performance presets and defaults
- **Screenshots** — capture folder, mode, format, accelerators, DirectX toggle
- **IT Ops** — IT Ops Module preferences
- **Don't Sleep** — keep-awake behavior
- **Shortcuts** — Workspace keyboard shortcuts plus shared screenshot accelerators
- **Proxy** — global app proxy (system / none / manual HTTP/HTTPS/SOCKS5), the single source of truth for app and web network routing
- **About** — version, open-source component list, app data folder

#### Setting up an AI provider

1. Go to Settings → AI Assistant
2. Choose a **Provider** from the dropdown (OpenAI, Anthropic, Ollama, OpenRouter, etc.)
3. Enter your **API Key** (stored in the OS keychain, never in SQLite)
4. Choose a **Model** from the picker or enter a custom model ID
5. Click **Save**
6. Open the AI Assistant panel and send a test message to verify the connection

For **Ollama** (local models): set the provider to Ollama, leave the API key blank, and set the base URL to `http://localhost:11434`. Make sure Ollama is running locally before testing.

Alternatively, enable the **Claude Code CLI** or **Codex CLI** toggle (or select the **Cursor** provider) to route assistant turns through a local coding CLI instead of an HTTP API key.

---

## Choose Your Path

> **AI assistant:** Translate and read the following aloud (or display it) to the user in user's  language, then wait for their choice before doing anything:

---

**KKTerm is all set. What would you like to do?**

1. **Report a bug or issue** — I'll help you describe the problem with all the details Ryan needs and file it on GitHub.

2. **Make a bugfix or feature PR** — I'll help you set up your fork, write the code following the project rules, and open a pull request.

3. **Download and install the app** — I'll walk you through the GitHub Releases page and the installer, including the unsigned-installer warning.

4. **Learn how to use KKTerm + set up an AI provider** — I'll give you a guided walkthrough of the UI: Connections, terminal Sessions, SFTP, the Dashboard, and how to configure an AI provider in Settings.

Just tell me which number (or describe what you want) and we'll get started.

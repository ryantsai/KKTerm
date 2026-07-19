# KKTerm Operation Manual — Index

This manual describes how to operate every user-facing aspect of KKTerm. It is shipped with the app and updated alongside each release. It is also the canonical reference the built-in AI Assistant searches when answering "how do I…" questions.

## Conventions

UI labels are referenced by their i18n key, not English text. A reference like **`connections.quickConnect`** points to the string at that path in `src/i18n/locales/en.json` (and its translated siblings under `src/i18n/locales/`). When the visible label changes, only the locale JSON changes — this document stays valid as long as the key stays.

Domain terms used here — **Connection**, **Quick Connect**, **Session**, **Tab**, **Child Connection Tab**, **Pane**, **Dashboard View**, **Widget Instance** — are defined in `CONTEXT.md`. Do not substitute "profile", "host entry", "browser tab", etc.

When a doc says "right-click on X", the implementation is a Tauri native context menu via `src/lib/nativeContextMenu.ts`. When it says "popover" or "dialog", it is an app-owned DOM surface.

## Audience tracks

- **End user**: read in the order listed; each chapter is self-contained.
- **AI Assistant (search/grep flow)**: each chapter starts with a `## AI grep hints` block listing the i18n keys, file paths, and synonyms that map to that surface. Match user questions against those hints, then quote the chapter back.

## Chapters

| # | File | Covers | Primary i18n namespaces |
|---|------|--------|-------------------------|
| 01 | [01-getting-started.md](01-getting-started.md) | First launch, app shell, primary navigation | `app`, `common` |
| 02 | [02-app-layout.md](02-app-layout.md) | Activity Rail, Connections panel, AI panel, Status Bar, resize handles | `app`, `workspace` |
| 03 | [03-connections.md](03-connections.md) | Saved Connections, folders, search, Quick Connect, Child Connection Tabs, pin to rail | `connections` |
| 04 | [04-workspace-tabs-panes.md](04-workspace-tabs-panes.md) | Tab Strip, Child Connection Tabs, opening Sessions, Pane splits, closing | `workspace`, `terminal` |
| 05 | [05-terminal.md](05-terminal.md) | Local terminal, Telnet, Serial, find, copy/paste, font, buffer save | `terminal` |
| 06 | [06-ssh-and-tmux.md](06-ssh-and-tmux.md) | SSH host-key trust, tmux sessions, SSH port forwarding | `terminal` |
| 07 | [07-sftp.md](07-sftp.md) | SFTP browser, transfers, conflicts, properties, chmod/chown | `sftp` |
| 08 | [08-url-webview.md](08-url-webview.md) | URL Connections, address bar, auto-refresh, credential fill | `webview` |
| 09 | [09-remote-desktop.md](09-remote-desktop.md) | RDP and VNC Sessions, Ctrl+Alt+Del, reconnect | `remoteDesktop` |
| 10 | [10-dashboard.md](10-dashboard.md) | Dashboard Module, Views, Widgets, presets, accents, backgrounds, widget export/import (`.kkwidget`) | `dashboard` |
| 11 | [11-app-launcher.md](11-app-launcher.md) | App Launcher widget — adding apps/files/folders, run modes | `appLauncher` |
| 12 | [12-it-ops.md](12-it-ops.md) | IT Ops Module — Sites, topology, Task Library, Batch Runs, Automations, run reports | `itops`, `watchdog` |
| 13 | [13-ai-assistant.md](13-ai-assistant.md) | AI Assistant panel, chats, tools, intents (Watchdog / Create Widget / Extension Draft), MCP | `ai` |
| 14 | [14-screenshots.md](14-screenshots.md) | Screenshots Module — library, capture region / window / full screen, tray captures, global shortcuts; Pane capture to clipboard or AI Assistant | `screenshots`, `workspace` |
| 15 | [15-settings.md](15-settings.md) | Every Settings section: General, Appearance, Dashboard, Workspace, File Explorer, Install Helper, Credentials, AI, SSH, Terminal, RDP, VNC, URL, Screenshots, Don't Sleep, Proxy, About | `settings` |
| 16 | [16-localization.md](16-localization.md) | Switching language, supported locales | `settings`, `languages` |
| 17 | [17-data-backup-secrets.md](17-data-backup-secrets.md) | SQLite store, OS keychain, settings Import/Export `.kkbackup`, startup backup ZIP snapshots, sharing connections without passwords | `settings`, `common` |
| 18 | [18-installer.md](18-installer.md) | Install Helper Module — Windows dev-tool catalog, install/update/uninstall, bundled catalog, UAC and WSL behaviour | `installer` |
| 19 | [19-git-browser.md](19-git-browser.md) | Git Browser overlay — commit graph, inspector, diff, staging/commit, branches/tags/stashes, fetch/pull/push | `git` |

## How this manual is maintained

- **Surgical updates only.** Touch the one chapter that changed. Do not "improve" adjacent chapters in the same change.
- **Localization keys instead of English UI text.** When you rename a button label, you change `en.json` — not this manual. When you rename or remove a **key**, you must update every chapter that references it. `git grep "connections.quickConnect" docs/manual` shows the affected chapters.
- **Ship-with-release.** This directory is bundled with the installer via `src-tauri/tauri.conf.json` → `bundle.resources` (each chapter mapped under `manual/`). The same files are available to the built-in AI Assistant's help/search flow. See `docs/RELEASE.md`.
- **Update triggers.** Any PR that changes UI behavior in a chapter's scope must update that chapter in the same PR. `AGENTS.md` lists this requirement; the AI assistant is reminded of it via `docs/AIINSTRUCTIONS.md`.

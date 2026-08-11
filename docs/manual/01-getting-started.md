# 01 — Getting Started

## AI grep hints

- Keys: `app.connections`, `app.settings`, `app.aiAssistant`, `app.dontSleep`, `app.dontSleepEnabledTooltip`, `app.dontSleepDisabledTooltip`, `app.trayExit`, `settings.dontSleepForegroundOnly`, `settings.portableOnboardingTitle`, `settings.portableOnboardingImport`, `settings.portableOnboardingSetup`
- Topics: first launch, command-line path launch, what KKTerm is, system tray, "Don't Sleep" mode, primary navigation, restoring the last Module
- Synonyms users may type: "open the app", "launch with file", "launch with folder", "left bar icons", "tray icon", "keep awake", "prevent sleep", "why did it open dashboard", "last page", "remember module"

## What KKTerm is

KKTerm is a local-first Windows desktop workspace for terminal, SSH, SFTP, embedded URL Connections, RDP, and VNC work, with a built-in Dashboard and AI Assistant. Durable data lives in SQLite on the user's machine; secrets live in the Windows Credential Manager. There is no cloud account.

See `CONTEXT.md` for the canonical domain terms — **Connection**, **Quick Connect**, **Session**, **Tab**, **Pane**, **Dashboard View**, **Widget Instance**.

## First launch

Windows portable releases are ZIP archives. Extract the complete archive to a writable local folder or removable drive and launch `KKTerm.exe`; network shares and running from inside the ZIP are unsupported. The shipped `kkterm-portable.marker` selects portable mode and must stay beside the executable. KKTerm creates a sibling `data` folder on first launch. If Evergreen WebView2 is missing, startup offers the Microsoft runtime download because a ZIP cannot install that prerequisite.

An installed Windows copy can also create a launch-ready portable folder from **Settings → General → Portable Install** using `settings.portableCreatorAction`. The wizard copies the current executable and bundled resources, then creates a portable database from the selected non-secret categories. The destination must be an empty writable local/removable folder; saved passwords are not copied.

Portable first launch shows the skippable dialog `settings.portableOnboardingTitle`. `settings.portableOnboardingSetup` configures the encrypted SQLite secret store; `settings.portableOnboardingImport` opens the existing backup import flow. Skipping credential setup is safe: KKTerm asks for a master password only when a feature first needs an encrypted secret. See chapters 15 and 17 for mode-specific Settings and data rules.

On first launch KKTerm seeds:

- An empty Connection Tree (see [03-connections.md](03-connections.md)); when enabled, this same tree also hosts Child Connection Tabs under parent Connections.
- A single Dashboard View named `dashboard.defaultView` ("Default") with one App Launcher Widget Instance.
- Default Settings, persisted to SQLite.
- Locale defaulting to the user's OS language if a matching JSON exists under `src/i18n/locales/`, falling back to English.

No Sessions are open. The Workspace Canvas shows the **Default Launch State** — recent Connections and a brief overview. It is not a Module; it appears inside the Workspace Module whenever all Tabs are closed.

## Opening files and folders from the command line

Pass one or more existing file or folder paths to the KKTerm executable. PNG, JPEG, GIF, and WebP images open as ephemeral sources in the Screenshots editor; other files open in the Document viewer selected by extension and content probe, and folders open in File Explorer.

On Windows, an installed copy registers KKTerm in **Open with** for the file extensions that have a dedicated viewer mapping, including Markdown, common text/code and log formats, JSON, CSV/TSV, supported images, and PDF. Installation does not make KKTerm the default for any extension and does not replace an existing default app. Use File Explorer's **Open with → KKTerm** to choose it for one file; Windows changes a default only if the user explicitly chooses an always-use option. Uninstall removes KKTerm from those choices.

The macOS app bundle declares the same formats as secondary document handlers. Finder therefore offers KKTerm under **Open With** without replacing the current default application. Files opened from Finder, the Dock, or the `open -a KKTerm <path>` command enter the same ephemeral image/Document flow described above, including when KKTerm is already running. Linux packages do not register these associations. Portable Windows copies, unknown-extension fallback files, extension-less names such as `Dockerfile`, folders, and unsupported office containers are not registered.

If KKTerm is already running, the existing window is restored and receives the paths. Otherwise KKTerm starts normally and opens them after the app shell is ready. These are ephemeral Sessions/Tabs: they do not create saved Connections, Child Connection Tabs, Screenshots library items, or saved layouts. Image editor layers remain in memory; Save updates the launched image, Save As writes only to the chosen destination, and closing the editor discards unsaved edits. Closing any other ephemeral Tab removes it, and none of these Sessions/Tabs is restored after restarting KKTerm.

## App shell

The window is divided into four regions:

1. **Activity Rail** (48 px, left edge) — primary navigation. See [02-app-layout.md](02-app-layout.md).
2. **Connections Panel** (resizable, left) — visible inside the Workspace Module only. See [03-connections.md](03-connections.md).
3. **Workspace Canvas** (centre) — Tab Strip plus active Tab content for the current Module, or Child Connection Tabs in the Connection Tree when the top Tab Strip is hidden.
4. **AI Assistant Panel** (resizable, right) — `app.aiAssistant`. Collapsible. See [13-ai-assistant.md](13-ai-assistant.md).
5. **Status Bar** (bottom, full width) — host usage metrics and transient notifications that appear as popups just above the bar.

Resize handles use the labels `app.resizeConnections` and `app.resizeAiAssistant`.

## Primary navigation (Activity Rail)

Top to bottom:

- Workspace (label `workspace.workspace`)
- Dashboard (label `dashboard.moduleLabel`)
- Connection Rail shortcuts (label `app.connectionRail`, group `app.connectedConnectionsRail`) — pinned and currently-connected Connections appear here as direct shortcuts.
- Settings (label `app.settings`, anchored to the bottom)

Hover tooltips on rail icons are rendered by the shared `RailTooltip` (`src/app/RailTooltip.tsx`), never the browser's native `title` tooltip. On Windows desktop builds, `RailTooltip` mirrors labels through a native topmost tooltip so they can show above RDP ActiveX surfaces.

## System tray

KKTerm registers a Windows tray icon with recent Connections plus app controls:

- Recent Connections — selecting a Connection restores the window, switches to the Workspace Module, and opens or focuses that Connection's Tab.
- `app.trayDontSleep` — toggles the same state as the in-app "Don't Sleep" mode (see below).
- `app.trayExit` — exits the app unconditionally. This path bypasses the close-to-tray diversion.

## Closing the window

The title-bar close button is the standard close path. KKTerm always uses its custom title bar. When "minimize to tray" is enabled in Settings, the close button hides the window to the tray instead of exiting; when disabled, it exits normally. There are no in-app close-confirmation dialogs.

## "Don't Sleep" mode

`app.dontSleep` keeps the OS awake while KKTerm is running. Toggled either from the Activity Rail menu or the tray (`app.trayDontSleep`). Rail hover text uses `app.dontSleepEnabledTooltip` or `app.dontSleepDisabledTooltip` depending on state. Status popups use `app.dontSleepEnabled` and `app.dontSleepDisabled`. Errors surface as `app.dontSleepError`.

Settings - Don't Sleep (`settings.sectionDontSleep`) controls whether the keep-awake effect applies only while KKTerm is foregrounded. When `settings.dontSleepForegroundOnly` is on, enabling `app.dontSleep` stores the mode as enabled but the OS power assertion is active only while the main KKTerm window is focused and not minimized. When it is off, Don't Sleep keeps the OS awake globally while KKTerm is running.

## Where to go next

- To open a saved Connection: [03-connections.md](03-connections.md).
- To start a session fast: Quick Connect saves the Connection (reusing an identical existing SSH Connection when present) and opens it — see [03-connections.md](03-connections.md) §Quick Connect.
- To set up the AI Assistant: [13-ai-assistant.md](13-ai-assistant.md) plus [15-settings.md](15-settings.md) §AI.

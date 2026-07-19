# 02 — App Layout

## AI grep hints

- Keys: `app.primaryNav`, `app.connectionRail`, `app.connectedConnectionsRail`, `app.connections`, `app.aiAssistant`, `app.resizeConnections`, `app.resizeAiAssistant`, `app.openConnectedConnection`, `app.openPinnedConnection`, `app.dontSleepEnabledTooltip`, `app.dontSleepDisabledTooltip`, `app.dontSleepStatusEnabled`, `app.credentialStoreLocked`, `app.credentialStoreUnlocked`, `app.credentialStoreLockAction`, `app.credentialStoreUnlockAction`, `settings.dontSleepForegroundOnly`, `workspace.workspaceSwitcher`, `workspace.newWorkspace`, `workspace.workspaceDetails`, `workspace.workspaceIconColor`, `workspace.importConnections`, `workspace.importFromWorkspace`, `workspace.searchConnections`, `workspace.filterConnectionTypes`, `workspace.selectAllConnections`, `workspace.deselectAllConnections`, `workspace.workspaceSurface`, `workspace.hostUsage`, `watchdog.statusBarLabel`, `watchdog.detail.*`
- Topics: Activity Rail, Workspace switcher, new Workspace dialog, custom title-bar panel toggles, panel resize, pinned Connections on the rail, Connections panel collapse, Child Connection Tabs, universal AI Assistant panel, universal host usage status bar, encrypted credential database Status Bar indicator, Don't Sleep Status Bar indicator, Watchdog Status Bar indicator and detail panel, restored last Module on launch, tutorial targets `app.activityRailWorkspace`, `app.activityRailNewWorkspace`, `app.activityRailDashboard`, `app.activityRailItOps`, `app.connectionRail`, `app.activityRailDontSleep`, `app.activityRailInstaller`, `app.activityRailSettings`, `app.connectionsResize`, `app.aiAssistantResize`, `workspace.statusBar`, `workspace.hostUsage`
- Synonyms: "left bar", "sidebar", "right panel", "AI sidebar", "make panel wider", "hide the AI panel", "bottom bar", "lock icon", "unlock icon", "encrypted database locked", "coffee icon", "don't sleep indicator", "watchdog icon", "running watchdogs", "watchdog status", "connection tree tabs", "child tabs", "remember dashboard", "remember installer", "restore last page", "last module"

## Activity Rail (48 px, left edge)

Vertical icon bar. Owned by `src/app/`. Always visible. Settings → General provides one `settings.activityRail` group (tutorial target `settings.activityRail`) that can hide or drag-to-reorder the Workspace, Dashboard, Install Helper, Screenshots, and IT Ops Modules, and can separately hide Don't Sleep. At least one Module must remain enabled. Workspace, Dashboard, Install Helper, Screenshots, IT Ops, and Don't Sleep all default on. Sections, top to bottom:

1. **Workspace switcher** (`workspace.workspaceSwitcher`) — the Default Workspace, user-created Workspaces, and `workspace.newWorkspace`. The New Workspace dialog uses `workspace.workspaceDetails` for the required name, icon, and `workspace.workspaceIconColor` setup; its icon picker search placeholder is `common.searchForMore` because the initial grid shows only a bounded subset of the bundled icon catalog. The `connections.iconForeground` palette is shown inside the icon picker only for recolorable Reicon/Lucide fallback glyphs and the letter-avatar fallback, while the `connections.iconBackground` palette stays beside the picker; together they customize icon strokes and the icon chip. Clearing the foreground restores automatic light/dark contrast against the selected background, including the visibly bounded white choice. Its footer follows the host platform: macOS places Cancel before the outer-right primary action, while Windows and Linux place the primary action before Cancel. If existing Workspaces contain Connections, `workspace.importConnections` can copy selected Connections from the source chosen by `workspace.importFromWorkspace`; the import list can be narrowed with `workspace.searchConnections`, the `workspace.filterConnectionTypes` dropdown, `workspace.selectAllConnections`, and `workspace.deselectAllConnections`. The AI Assistant and built-in MCP server expose the same Workspace list/create/rename/reorder/delete storage path; out-of-band mutations reload the Activity Rail through `workspaces-changed`, and deletion remains approval-gated because it removes that Workspace's durable Connections and folders.
2. **Built-in Modules** — Dashboard, IT Ops, Install Helper, and Screenshots (`screenshots.railLabel`, tutorial target `app.activityRailScreenshots`) when enabled.
3. **Connection Rail** (`app.connectionRail`) — a divider group `app.connectedConnectionsRail` that shows:
   - Pinned Connections (kept across launches; pin from the Connection Tree right-click menu, `connections.pinToRail`).
   - Connections that currently have at least one live Session.
   Each icon's tooltip uses `app.openPinnedConnection` or `app.openConnectedConnection` with the Connection name interpolated as `{{name}}`.
4. **Don't Sleep** (`app.activityRailDontSleep`) — the keep-awake control. The tooltip changes between `app.dontSleepEnabledTooltip` and `app.dontSleepDisabledTooltip`; toggling shows the shared status popup above the Status Bar.
5. **Settings** — anchored to the bottom of the rail.

The whole rail uses `app.primaryNav` as its accessible label. Tooltips come from `RailTooltip` (delayed hover/focus). In the Windows Tauri runtime, the same helper uses a native topmost tooltip so rail labels can appear above RDP ActiveX surfaces. Native browser `title` tooltips are forbidden here.

Tutorial targets: `app.activityRailWorkspace`, `app.activityRailNewWorkspace`, `app.activityRailDashboard`, `app.activityRailItOps`, `app.activityRailScreenshots`, `app.connectionRail`, `app.activityRailDontSleep`, `app.activityRailInstaller`, `app.activityRailSettings`. IT Ops targets are documented in [12-it-ops.md](12-it-ops.md). Inside the Install Helper Module the targets are `installer.updateAll` and `installer.toolOptions` — see [18-installer.md](18-installer.md). Screenshots Module targets are documented in [14-screenshots.md](14-screenshots.md).

Non-Workspace pages (Dashboard and Settings) stay inset from the 48 px rail so its hover tooltips keep working while those pages are active. Workspace-native child surfaces may overlap the rail tooltip layer, so the native tooltip bridge is the supported rail-label path in the desktop runtime.

## Connections Panel (left, inside Workspace Module)

Resizable. Collapsed/expanded state persists across launches. See [03-connections.md](03-connections.md) for the tree itself. When `settings.hideTopTabButtons` is enabled, this panel also becomes the primary Tab navigator by showing Child Connection Tabs under parent Connections.

- Toggle: custom title-bar `app.connections` icon while Workspace is active, or Workspace icon on the Activity Rail. Double-clicking the panel title row, including the blank space beside `connections.title`, performs the same hide/show action.
- Resize handle: `app.resizeConnections`

Tutorial target: `app.connectionsResize`.

The panel only appears inside the Workspace Module. Switching to Dashboard or Settings replaces this region with that destination's own content.

## Workspace Canvas (centre)

The active Module owns this area. Each Module renders its own layout inside it. For the Workspace Module specifically, the Canvas contains the Tab Strip and active Tab content (terminal, SFTP, WebView, RDP, VNC, Pane splits). If Child Connection Tabs are enabled, the top Tab Strip is hidden and Tab navigation moves into the Connections Panel. See [04-workspace-tabs-panes.md](04-workspace-tabs-panes.md).

Accessibility label: `workspace.workspaceSurface`. Per-Connection-kind labels use `workspace.connectionKind` with the kind interpolated.

KKTerm persists the last active base Module (`workspace`, `dashboard`, or `installer`) in local storage and restores it on the next launch. Opening Settings does not replace that remembered base Module; if the user opens Settings from Dashboard, the remembered base Module remains Dashboard. On launch, the Connections Panel auto-expands only when the restored Module is Workspace.

## AI Assistant Panel (right)

Resizable, collapsible. State is app-wide — the same width and collapsed state apply across Workspace, Dashboard, Settings, and all Tabs.

- Title: `ai.title`
- Toggle: custom title-bar `app.aiAssistant` robot icon. Double-clicking the panel title row, including the blank space beside `ai.title`, performs the same hide/show action.
- Resize handle: `app.resizeAiAssistant`

Tutorial target: `app.aiAssistantResize`.

The panel remains available on Settings and receives a Settings page context so how-to answers can refer to the active Settings section. Panel internals are covered in [13-ai-assistant.md](13-ai-assistant.md).

## Status Bar (bottom)

Owned by `src/modules/workspace/StatusBar.tsx`. Three roles:

1. **Host usage metrics** (left side, visible in every Module and page):
   - `workspace.cpu` / `workspace.cpuUsage`
   - `workspace.ram` / `workspace.ramUsage` / `workspace.memory`
   - `workspace.network` / `workspace.networkUsage`, broken into `workspace.networkDownstream` and `workspace.networkUpstream`
   Clicking the metrics opens the system activity monitor (Task Manager on Windows, Activity Monitor on macOS, and the first installed desktop system monitor on Linux — GNOME System Monitor, plasma-systemmonitor, and other common desktop monitors are tried in order). General Settings → `settings.statusBar` can disable this monitor completely with `settings.statusBarMonitor`; when disabled, host usage polling stops instead of only hiding the metrics. `settings.statusBarMonitorInterval` controls the polling interval while enabled.
2. **Transient notifications** — driven by the shared `showStatusBarNotice` store action. Messages render as Pulse-style popups above the Status Bar, with direct tone icons for success, info, warning, and error. Every transient informational outcome, success confirmation, warning, and error from a Module, page, dialog, or background operation routes through this popup surface instead of inline result text, one-off toast surfaces, banners, snackbars, or local status systems. Long popup messages can wrap to three lines before truncation. Success messages default to 2 seconds; info and warning messages default to 5 seconds; errors stay until dismissed. These auto-dismiss popups do not show a countdown bar. Determinate work uses the shared `showStatusBarProgress` variant with a `CircleGauge` icon, a real 0–100% bar, and fixed endpoint labels. App update downloads use this variant; Windows downloads can be cancelled with `settings.updateDownloadCancel`, while completed downloads remain at 100% for three seconds before installation.
3. **Watchdog state** — when one or more watchdogs exist, the right side shows an animated watchdog icon with `watchdog.statusBarLabel`. Activating it opens a list of running or terminal-undismissed watchdogs. Selecting a watchdog opens its detail panel with state, elapsed time, watch summary, next check, exit condition, notification method, action mode, recent values, trigger events, AI interventions, and report actions.
4. **Encrypted credential database state** — when Settings → Credentials uses encrypted database storage, the right side shows a lock or unlock icon. `app.credentialStoreLocked` means saved secrets cannot be read until the master password is entered; activating `app.credentialStoreUnlockAction` opens only the encrypted database unlock dialog. `app.credentialStoreUnlocked` means the store is available for saved-password reads; activating `app.credentialStoreLockAction` locks it again for the current app run.
5. **Don't Sleep state** — when Don't Sleep mode is enabled, the right side shows a coffee icon with tooltip `app.dontSleepStatusEnabled`. If `settings.dontSleepForegroundOnly` is on, this indicates the user-facing mode is enabled; the OS power assertion is active only while KKTerm is focused and not minimized.

Tutorial targets: `workspace.statusBar`, `workspace.hostUsage`.

Right-side status icons use the shared `RailTooltip`, which prefers a native OS tooltip and clamps it into the monitor work area so a maximized window's bottom-right icons are not truncated at the screen edge.

## Workspace chrome resize behaviour

Both side panels can be dragged to any width within their minimum/maximum. The drag divider shows a thin blue full-height indicator after the pointer rests on it briefly, using resize handles `app.resizeConnections` and `app.resizeAiAssistant`. Widths persist immediately to settings. There is no "reset layout" affordance inside the chrome itself; resetting layout is a Settings action (`settings.resetLayout`, see [15-settings.md](15-settings.md) §Appearance).

The custom title bar is always enabled. Panel-toggle icons appear immediately before the window minimize/maximize/close controls. The Connections panel icon (`app.connections`) appears only while Workspace is active. The AI Assistant robot icon (`app.aiAssistant`) appears in every Module and page; when the panel is collapsed, the robot icon becomes muted instead of showing a right-edge collapsed strip.

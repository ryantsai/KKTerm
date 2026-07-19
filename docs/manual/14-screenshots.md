# 14 — Screenshots

## AI grep hints

- Keys: `screenshots.title`, `screenshots.railLabel`, `screenshots.captureRegion`, `screenshots.captureWindow`, `screenshots.captureFullscreen`, `screenshots.view.thumbnails`, `screenshots.view.list`, `screenshots.view.details`, `screenshots.openFolder`, `screenshots.clearAll`, `screenshots.menu.openExternal`, `screenshots.menu.copy`, `screenshots.menu.reveal`, `screenshots.menu.rename`, `screenshots.captureSaved`, `screenshots.emptyTitle`, `settings.sectionScreenshots`, `settings.screenshotsFolder`, `settings.screenshotsFormat`, `settings.screenshotsShortcuts`, `workspace.takeScreenshot`, `workspace.copyRegion`, `workspace.copyEntirePanel`, `workspace.sendRegionToAi`, `workspace.sendEntirePanelToAi`, `workspace.sentToAi`, `workspace.copied`, `workspace.selectRegion`, `workspace.screenshot`, `workspace.screenshotsRequireRuntime`, `workspace.screenshotCaptureError`, `sftp.screenshotTarget`, `webview.screenshotTarget`
- Topics: Screenshots Module, screenshot library, capture region / window / fullscreen, thumbnails / list / details views, tray capture menu, global capture shortcuts, hotkeys, PNG / JPEG format, screenshots folder, rename / delete / copy screenshot, send to AI, copy to clipboard
- Tutorial targets: `app.activityRailScreenshots`, `screenshots.captureRegion`, `screenshots.captureWindow`, `screenshots.captureFullscreen`, `screenshots.viewSwitch`, `screenshots.library`, `settings.screenshotsFolder`, `settings.screenshotsFormat`, `settings.screenshotsShortcuts`, `workspace.screenshotMenu`
- Synonyms: "snip", "grab", "screen capture", "screenshot gallery", "print screen", "snipping tool", "ShareX", "send to AI"

## The Screenshots Module

The **Screenshots Module** is an Activity Rail destination (`screenshots.railLabel`, tutorial target `app.activityRailScreenshots`) that captures screenshots into a library folder and lists them newest-first. Settings → General → `settings.activityRail` controls whether the Module appears; it is visible by default.

Capture actions live in the Module header and save into the configured library folder (Windows captures; other platforms currently show the library read-only):

- `screenshots.captureRegion` (tutorial target `screenshots.captureRegion`) — native full-desktop overlay; drag to select a rectangle, Esc cancels.
- `screenshots.captureWindow` (tutorial target `screenshots.captureWindow`) — native overlay that highlights the window under the pointer; click to capture, Esc cancels.
- `screenshots.captureFullscreen` (tutorial target `screenshots.captureFullscreen`) — captures the entire virtual desktop across all monitors.

The KKTerm window minimizes out of the way during a capture and restores afterwards. Every successful capture shows `screenshots.captureSaved` in the Status Bar and prepends the new item to the library.

### Library views

The header view switch (tutorial target `screenshots.viewSwitch`) offers three layouts, remembered across launches: `screenshots.view.thumbnails` (card grid, default), `screenshots.view.list` (compact rows), and `screenshots.view.details` (table with `screenshots.details.kind`, `screenshots.details.dimensions`, `screenshots.details.size`, and `screenshots.details.date` columns). Listing is paginated; `screenshots.loadMore` fetches the next page. The library (tutorial target `screenshots.library`) re-reads the folder on every Module activation, so files added or removed outside KKTerm show up on return.

Clicking an item opens the full-size viewer with previous/next navigation, copy, open-external, reveal, and delete actions. Right-clicking an item opens a native context menu: `common.open`, `screenshots.menu.openExternal`, `screenshots.menu.copy`, `screenshots.menu.reveal`, `screenshots.menu.rename`, and `common.delete`. Delete and `screenshots.clearAll` confirm through the standard confirmation sheet; deletion removes files from disk permanently. `screenshots.openFolder` opens the library folder in the OS file manager.

### Tray captures and global shortcuts

The tray icon menu carries the same three capture items (`screenshots.captureRegion`, `screenshots.captureWindow`, `screenshots.captureFullscreen`). They work while the main window is hidden in the tray, and the window stays hidden after the capture.

Settings → `settings.sectionScreenshots` → `settings.screenshotsShortcuts` defines three system-wide capture hotkeys (defaults `Ctrl+Alt+R` region, `Ctrl+Alt+W` window, `Ctrl+Alt+F` fullscreen), each with its own enable toggle. Registration conflicts with other applications are reported when saving.

### Screenshots settings

Settings → `settings.sectionScreenshots` owns the library folder (`settings.screenshotsFolder`, default: the Windows Pictures → Screenshots known folder), the save format (`settings.screenshotsFormat`: PNG by default, or JPEG with `settings.screenshotsJpegQuality`), and the global shortcuts. The DirectX capture acceleration toggle stays in Settings → General (`settings.useDirectxScreenCapture`); `settings.screenshotsDirectxNote` points there.

## Capture from a Pane

Each workspace surface exposes a screenshot toolbar menu (native Tauri context menu). The menu label is `workspace.takeScreenshot`. Variants:

- `workspace.copyRegion` — region capture → clipboard. Status `workspace.copied`.
- `workspace.copyEntirePanel` — whole window/Pane → clipboard.
- `workspace.sendRegionToAi` — region capture → AI Assistant input. Status `workspace.sentToAi`.
- `workspace.sendEntirePanelToAi` — whole Pane → AI Assistant input.

Tutorial target: `workspace.screenshotMenu`.

Region selection overlay accessible label: `workspace.selectRegion`. Generic noun: `workspace.screenshot`.

Per-surface "screenshot target" labels used in dialog headings:

- SFTP: `sftp.screenshotTarget`
- WebView (URL Connections): `webview.screenshotTarget`; direct toolbar send uses tutorial target `webview.sendToAi`.

Failure: `workspace.screenshotCaptureError`. Outside the Tauri runtime: `workspace.screenshotsRequireRuntime`.

## Capture targets

Pane captures are transient by design: a capture is either copied to the clipboard or attached to the AI Assistant context; they do not enter the Screenshots Module library. Library captures are the Module's region/window/fullscreen actions above, saved as files in the screenshots folder.

## RDP screenshots

RDP captures use a dedicated typed Tauri command that asks the OS for the visible RDP host bitmap, because the native HWND behind RDP cannot be composited into a normal DOM screenshot. URL Connections use the standard capture path; while `workspace.selectRegion` is active, the URL overlay WebView2 is hidden behind a captured placeholder so the Region controls stay above it. Do not generalise the RDP screenshot code path to other surfaces — see [09-remote-desktop.md](09-remote-desktop.md).

On macOS, RDP renders through the IronRDP canvas path, so RDP and VNC screenshots are cropped from the mounted remote-desktop canvas instead of using the Windows-only OS capture command.

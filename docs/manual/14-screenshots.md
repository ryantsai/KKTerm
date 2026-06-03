# 14 — Screenshots

## AI grep hints

- Keys: `screenshots.*` (full namespace), `workspace.takeScreenshot`, `workspace.copyRegion`, `workspace.copyEntirePanel`, `workspace.sendRegionToAi`, `workspace.sendEntirePanelToAi`, `workspace.sentToAi`, `workspace.copied`, `workspace.selectRegion`, `workspace.screenshot`, `workspace.screenshotsRequireRuntime`, `workspace.screenshotCaptureError`, `sftp.screenshotTarget`, `webview.screenshotTarget`
- Topics: capture region / window / fullscreen, send to AI, copy to clipboard, screenshots library, tutorial target `workspace.screenshotMenu`
- Synonyms: "snip", "grab", "screen capture", "send to AI"

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
- WebView (URL Connections): `webview.screenshotTarget`

Failure: `workspace.screenshotCaptureError`. Outside the Tauri runtime: `workspace.screenshotsRequireRuntime`.

## Capture targets

Screenshots are transient by design: a capture is either copied to the clipboard or attached to the AI Assistant context. KKTerm does not maintain a screenshot gallery surface; the standalone gallery page was removed. The Rust backend retains the capture path so the in-context flow keeps working across terminal Panes, URL/WebView, SFTP, and RDP/VNC surfaces.

## RDP screenshots

RDP captures use a dedicated typed Tauri command that asks the OS for the visible RDP host bitmap, because the native HWND behind RDP cannot be composited into a normal DOM screenshot. URL Connections still use the standard capture path, but while `workspace.selectRegion` is active the live WebView2 child surface is temporarily replaced by a captured placeholder so the Region controls stay above it. Do not generalise the RDP screenshot code path to other surfaces — see [09-remote-desktop.md](09-remote-desktop.md).

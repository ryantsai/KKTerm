# 09 — Remote Desktop (RDP and VNC)

## AI grep hints

- Keys: `remoteDesktop.*` (full namespace, including `remoteDesktop.fullscreen.*`), `connections.windowsRdp`, `connections.screenControl`, `settings.rdpRemoteResolution*`, `settings.remoteDesktopViewMode*`, `settings.vncPerformancePreset`, `settings.vncCompressionLevel`, `settings.vncJpegQuality`, `settings.vncJpegEnabled`, `settings.rdpAdministrativeSession`, `settings.rdpShareLocalFolders`, `settings.rdpAddFolder`, `settings.rdpAllLocalDrives`, `settings.rdpChooseDrives`, `settings.submitAiAttachmentsDirectly`, `workspace.sendEntirePanelToAi`, `ai.directAttachmentPrompt`
- Topics: RDP via mstscax ActiveX, RDP via IronRDP, Windows drive redirection, macOS/Linux shared local folder, VNC via vnc-rs, Ctrl+Alt+Del, Ctrl+Alt+End hotkey hint, remote resolution (Automatic / fixed `WxH`), view mode scaling, reconnect, framebuffer waiting, Windows ActiveX native full screen and connection bar, detached VNC/canvas full-screen window (span all monitors, monitor picker, platform full-screen shortcut, `open_remote_fullscreen_window`, `list_display_monitors`), tutorial targets `remoteDesktop.toolbar`, `remoteDesktop.viewMode`, `remoteDesktop.sendCtrlAltDel`, `remoteDesktop.reconnect`, `remoteDesktop.sendToAi`, `remoteDesktop.surface`, `settings.rdpRemoteResolution`
- Synonyms: "remote desktop", "screen sharing", "mstsc", "IronRDP", "drive mapping", "redirect drives", "share local folder", "VNC viewer", "send three-finger salute", "high DPI scaling", "remote screen size", "full screen", "fullscreen", "second monitor", "multi-monitor", "span monitors", "connection bar"

## Connection kinds

- **RDP** (`connections.windowsRdp`) — remote desktop Session. On Windows it uses the Microsoft RDP ActiveX control in `mstscax.dll`, rendered to a native child HWND positioned over its Tab. On macOS and Linux it uses the in-app IronRDP client, rendered into the workspace canvas like VNC.
- **VNC** (`connections.screenControl`) — RFB / VNC Session via the Rust `vnc-rs` client. Renders the remote framebuffer into the workspace canvas.

Both store host, optional port, and non-secret account metadata in SQLite; passwords are in the Windows Credential Manager.

Type label: `remoteDesktop.typeLabel`. Generic Session label: `remoteDesktop.session`. Display accessible label: `remoteDesktop.displayAria`.

Tutorial target: `remoteDesktop.surface`.

## Connection lifecycle

- `remoteDesktop.connecting` → `remoteDesktop.preparingDisplay` → `remoteDesktop.connected`.
- For VNC: while the first framebuffer is awaited, `remoteDesktop.waitingFramebuffer`.
- `remoteDesktop.disconnected` after the session ends.
- `remoteDesktop.reconnect` / `remoteDesktop.reconnecting` reissue the connect with the same Connection settings. On Windows, the current live Session and its ActiveX control finish teardown before the replacement starts, and a delayed hide or close from another RDP Tab cannot take focus ownership from the visible Session.
- RDP command and startup failures surface as Status Bar errors through `remoteDesktop.rdpErrorStatus` even when Advanced Debugging is off.
- If Windows policy disables saved Remote Desktop passwords, the Microsoft RDP ActiveX control may show its own credential prompt. KKTerm lets that prompt complete and keeps reapplying the RDP display-size sync for a short post-connect window so the remote desktop size is corrected after login.

Runtime checks:

- `remoteDesktop.rdpDesktopRequired` — RDP cannot start outside the Tauri desktop runtime.
- `remoteDesktop.vncDesktopRequired` — same for VNC.
- `remoteDesktop.transportUnavailable` — the relevant transport (mstscax / vnc-rs) is missing.

Transport labels for status messages: `remoteDesktop.rdpActiveX`, `remoteDesktop.vncFramebuffer`.

## Toolbar actions

- `remoteDesktop.actionsMenu` — hamburger button at the right end of the toolbar, immediately left of the Pane close button when that button is present. Opens a native menu with `remoteDesktop.fullscreen.enter` followed by the common viewer modes: `settings.remoteDesktopViewModeFit`, `settings.remoteDesktopViewModeStretch`, `settings.remoteDesktopViewModeActualSize`, `settings.remoteDesktopViewModeFitWidth`, and `settings.remoteDesktopViewModeFitHeight`. The Full screen item shows the current platform shortcut. The selected view mode is saved as a per-Connection override and uses the Settings default until changed from the toolbar or Connection options. For VNC, `settings.remoteDesktopViewModeActualSize` keeps the remote framebuffer at 1:1 size and enables workspace scrollbars, which is useful for dual-monitor servers that would otherwise be squeezed into one Pane. For RDP, changing the mode saves the Connection and reconnects so the native ActiveX display settings are re-created cleanly.

- `remoteDesktop.sendCtrlAltDel` — keyboard icon in the toolbar.
  - **RDP**: clicking opens a native context menu with the hint `remoteDesktop.sendCtrlAltDelHint` ("Press CTRL+ALT+END to Send CTRL+ALT+DEL"). The embedded Microsoft RDP ActiveX control cannot reliably synthesize the Secure Attention Sequence from outside its own keyboard hook, so the local Ctrl+Alt+End hotkey (set via `HotKeyCtrlAltDel = VK_END`) is the supported path.
  - **macOS/Linux RDP**: clicking sends Ctrl+Alt+Delete directly through the IronRDP canvas session.
  - **VNC**: the same button still calls `send_vnc_ctrl_alt_delete` directly.
- `remoteDesktop.reconnect` — explicit reconnect button.
- `workspace.sendEntirePanelToAi` — captures the visible remote desktop Pane for AI Assistant. By default `settings.submitAiAttachmentsDirectly` submits the screenshot with `ai.directAttachmentPrompt`; when disabled, the button only attaches the screenshot to the composer.

Tutorial targets: `remoteDesktop.toolbar`, `remoteDesktop.viewMode`, `remoteDesktop.sendCtrlAltDel`, `remoteDesktop.reconnect`, `remoteDesktop.sendToAi`.

## Full screen

`remoteDesktop.fullscreen.enter` in the RDP/VNC hamburger menu presents the current live Session full screen without reconnecting. VNC and macOS/Linux IronRDP open a separate borderless window that attaches to the Session by id; a VNC attach temporarily makes that window the sole framebuffer consumer and forces a full framebuffer (`refresh_vnc_session`) so it repaints immediately. VNC framebuffers larger than the selected display shrink to fit, while smaller framebuffers stay at their native 1:1 size and remain centered instead of being enlarged. Closing the window returns framebuffer ownership to the Pane and requests another full repaint. Windows RDP expands its retained Microsoft ActiveX host to the monitor containing the Pane and keeps the control's native connection bar.

The same `remoteDesktop.fullscreen.toggle` shortcut enters full screen from the focused RDP/VNC Pane and exits it again. On Windows it is fixed to Ctrl+Alt+Break (stored canonically as `Ctrl+Alt+Pause`) and appears read-only in Shortcuts Settings because it matches the ActiveX control's fixed chord. A dedicated native keyboard-hook thread recognizes the physical Control-Break event (`VK_CANCEL`), with `VK_PAUSE` as a compatibility fallback. For VNC, it posts the toggle to KKTerm and consumes the chord only when that post succeeds. When the presented RDP ActiveX host or one of its children has keyboard focus, the hook passes the chord through and the control requests KKTerm's prepared enter/leave path; it does not invoke mstscax's secondary built-in host. An RDP host parked off-screen for another Tab cannot retain the shortcut merely because Windows left stale focus on one of its children. Every RDP show or park update refreshes the hook mode immediately after that native update finishes, so switching from an RDP Tab to VNC changes from ActiveX pass-through to VNC handling without waiting for an application activation change. A delayed focus recheck still covers startup and native-window handoffs, and returning to KKTerm refreshes the hook mode immediately. macOS defaults to Control+Command+F and Linux defaults to F11; those platforms remain configurable.

On Windows, a delayed full-screen entry request is ignored if KKTerm has already lost foreground. If foreground changes while RDP display preparation is running, KKTerm reverses that preparation without invoking the background ActiveX full-screen transition; the Pane remains usable with SmartSizing when the server rejects the reverse display update.

For shortcut diagnosis, a debug build records the hook's captured activation generation, dispatch token, and whether posting was not attempted, succeeded, failed, or became stale. The same log distinguishes a completed focus refresh from one deferred because the RDP Session, shortcut registration, or z-order state was busy.

VNC and macOS/Linux RDP full-screen windows carry a **connection bar** (`remoteDesktop.fullscreen.barAria`) docked top-center. The revealed bar keeps its natural control height while a thin top-edge activation strip remains when hidden. It auto-hides and reveals on hover; `remoteDesktop.fullscreen.pin` / `remoteDesktop.fullscreen.unpin` keep it shown. Its controls:

- **Display** (`remoteDesktop.fullscreen.display`) — a monitor picker. `remoteDesktop.fullscreen.spanAll` stretches the window across the whole virtual desktop (borderless); an individual monitor entry (named, or `remoteDesktop.fullscreen.displayIndex` when the OS gives no name) moves the window to that display in true OS full screen. A single monitor uses real full screen rather than maximize, so the taskbar/menu bar is covered (this avoids the documented RDCMan "maximized leaves a taskbar gutter" behaviour).
- **Ctrl+Alt+Del** (`remoteDesktop.sendCtrlAltDel`) — routed per surface (`send_vnc_ctrl_alt_delete`, `send_rdp_client_ctrl_alt_delete`, or `send_rdp_ctrl_alt_delete`).
- **Exit** (`remoteDesktop.fullscreen.exit`) — closes the window; the Session keeps running in its Pane.

Windows ActiveX RDP uses the Microsoft control's native connection bar because WebView2 content cannot render above its HWND. KKTerm enables `DisplayConnectionBar`, leaves it unpinned for the standard top-edge auto-hide behavior, and enables the restore button. Use the restore button or `remoteDesktop.fullscreen.toggle` to return to the Pane; closing the Session from the connection bar disconnects it and returns the disconnected surface to its KKTerm Pane. Ctrl+Alt+End remains the supported Windows RDP secure-attention shortcut.

Detached-surface backend: `list_display_monitors`, `open_remote_fullscreen_window`, and `close_remote_fullscreen_window` (`src-tauri/src/remote_fullscreen.rs`). The VNC/canvas window loads the app bundle at `#/remote-fullscreen/<kind>/<sessionId>/<connectionId>`; `main.tsx` mounts only `RemoteFullscreenApp` for that route.

Coverage by surface:

- **VNC** and **macOS/Linux RDP** render inside the full-screen window (a second render host attached by Session id). On attach, VNC calls `refresh_vnc_session`; this non-incremental refresh bypasses an unchanged incremental request so the server sends the current screen immediately rather than waiting for new screen damage. Each VNC frame notification also carries the retained framebuffer dimensions so the new canvas is sized correctly even when the original resolution event occurred before it attached. macOS/Linux RDP calls `refresh_rdp_client_session` (which replays IronRDP's decoded framebuffer as one full RawImage) so the current screen appears immediately rather than waiting for server deltas.
- **Windows RDP** never creates a detached WebView. Before `Connect`, setup configures `DisplayConnectionBar`, `PinConnectionBar`, the restore button, integer `ContainerHandledFullScreen = 1`, and the ActiveX request-event subscription. Entry saves the current Pane host rectangle and remote display settings, derives full-screen display settings from the monitor's physical dimensions (while a fixed-resolution Connection keeps its configured remote desktop size), enables SmartSizing as a fallback when the server rejects late display updates, sets `ConnectionBarText` to the durable Connection name, sets `FullScreen`, and expands the retained host to the exact monitor rectangle. The host stays topmost only while KKTerm is the active application, so Alt+Tab reveals the newly selected app; returning to KKTerm restores its full-screen z-order. Bounds and visibility changes received while full screen are retained without moving that host. Exit clears `FullScreen`, removes topmost state, and applies the latest Pane rectangle, visibility, display settings, and normal SmartSizing value; if the server rejects the reverse display update, SmartSizing stays enabled as a local fit fallback. Full-screen entry does not use the RDP overlay park/reveal workaround or cross-window focus transfer; exit can still honor a newer hidden Pane request by returning its host to the normal off-screen staged position. Windows `/multimon` still needs pre-connect configuration and is not covered by this toggle.

## macOS/Linux RDP keyboard and clipboard

The IronRDP canvas routes printable and IME-composed text through Unicode keyboard events, while navigation keys, modifiers, and shortcuts use RDP scancodes. Clicking the remote surface focuses an in-viewport hidden input and keeps the canvas pointer action from taking focus back, so typing starts immediately after the click in macOS WKWebView and Linux WebKitGTK.

On macOS, Command+V reads plain text from the native general pasteboard, advertises it through the IronRDP CLIPRDR channel, then sends the remote Ctrl+V chord as one ordered backend operation. Ctrl+V uses the focused canvas input's trusted paste event to provide the same behavior on Linux. Remote plain-text clipboard updates are written back to the local clipboard. Right-click remains a remote mouse action: the canvas suppresses WKWebView selection and its local DOM edit menu so the click reaches the remote Session instead. macOS Control-click is translated to the same remote right-button action.

## RDP overlay parking (implementation note)

The native HWND backing an RDP Session does not obey DOM z-index. When an app-owned DOM overlay intersects the RDP host rectangle, KKTerm:

1. Captures the visible RDP host via a typed screenshot Tauri command.
2. Shows that bitmap underneath the DOM overlay.
3. Hides ("parks") the ActiveX HWND until the overlay closes.

This behaviour is **RDP-only**. WebView2, VNC, terminal, and SFTP surfaces never use overlay parking. Geometry-scoped detection lives in `src/modules/workspace/nativeOverlay.ts`; app dialog backdrops (`.kk-dlg-backdrop`) participate so a confirmation such as the large-Panorama warning cannot sit underneath an ActiveX surface. Do not extend this workaround to other surfaces.

In dense Panorama layouts, KKTerm intersects the RDP surface with its owning embedded Pane before sending bounds to the native ATL host. This prevents an overflowing descendant DOM box from expanding the native RDP window over adjacent Connection Panes.

## RDP debug logging

Debug builds write RDP startup, ActiveX control creation, display-size sync, clipboard handshake stages, and main-thread command timing records to `rdp.debug.log` beside `kkterm.log`. Clipboard records contain format IDs and byte/character counts, never clipboard text. Release builds write the same JSONL log only when Settings → General → Debug → `settings.advancedDebugging` is enabled. Records include non-secret Connection details such as host, username, port, RDP options, bounds, selected ActiveX ProgID, display size, scale factors, and command errors. Correlated `rdp.geometry.frontend` and `rdp.geometry.native` records in `ui.debug.log` compare DOM/viewport sizing with the owning embedded Pane clip, requested physical rectangle, actual ATL host and hosted ActiveX object window/client rectangles, SmartSizing, and remote desktop dimensions. Password-like, secret-like, token-like, and credential-like fields are redacted defensively; users should still review the files before sharing because hostnames and usernames may be sensitive.

## RDP / VNC settings

Per-kind defaults (resolution, view mode, colour depth, etc.) live in Settings → RDP (`settings.sectionRdp`) and Settings → VNC (`settings.sectionVnc`). See [15-settings.md](15-settings.md).

### VNC performance presets

`settings.vncPerformancePreset` is available globally and per Connection. `settings.vncPresetAuto` is the default and lets the Tight-capable server choose its compression and JPEG trade-off. `settings.vncPresetLan`, `settings.vncPresetBalanced`, and `settings.vncPresetLowBandwidth` apply progressively stronger bandwidth reduction. `settings.vncPresetLossless` selects ZRLE and disables lossy JPEG rectangles. Both Settings and per-Connection options always show preferred encoding, color level, compression, JPEG quality, and JPEG enablement. A fixed preset updates those controls to its effective values and locks them; `settings.vncPresetCustom` unlocks them and restores the user's Custom values. Custom exposes `settings.vncCompressionLevel` (0 fastest, 9 smallest), `settings.vncJpegQuality` (0 smallest, 9 most detail), and `settings.vncJpegEnabled` alongside the encoding and color controls.

Preset negotiation and framebuffer decoding use the same Rust VNC transport when KKTerm runs on Windows, macOS, or Linux, including macOS Screen Sharing Connections authenticated with an Apple account username. Apple's separate High Performance Screen Sharing mode is not standard RFB/VNC and is not enabled by JPEG or compression-level presets.

Framebuffer updates are requested one at a time and acknowledged only after the canvas paints them. One update crosses the app boundary as one bounded binary batch containing raw pixels, compressed JPEG rectangles, and CopyRect operations; pointer motion is coalesced to its latest position while clicks and wheel transitions stay ordered. With Advanced Debugging enabled, `vnc.frame` entries in `ui.debug.log` report non-secret frame size, encoding counts, wire bytes, backend decode/bridge timing, frontend binary fetch/JPEG decode/paint timing, and end-to-end notice-to-paint time.

When the VNC server disconnects, the Pane and detached full-screen surface immediately hide and clear the last framebuffer, discard any pending paint, and show the disconnected state. A stale shutdown or lock-screen frame is not retained as though the Session were still live.

### RDP administrative sessions and local resources

`settings.rdpAdministrativeSession` is off by default and is available globally and per Connection. Enabling it requests the server administration session equivalent to `mstsc /admin`. It does not elevate the supplied account and does not enable Restricted Admin authentication.

`settings.rdpRedirectDrives` remains disabled by default and is available both as a global RDP default and as a per-Connection override.

- On Windows, enabling it defaults to `settings.rdpAllLocalDrives`. `settings.rdpChooseDrives` opens an app-owned Sheet where the user can retain all drives or choose individual drive roots such as C: and D:. Saved selections are applied through the ActiveX drive collection. A selected drive that is currently disconnected remains in the saved selection and is labelled with `settings.rdpUnavailableDrive`.
- On macOS and Linux, the same setting is presented as `settings.rdpShareLocalFolders`. Use `settings.rdpAddFolder` repeatedly to add folders; each appears inside the remote desktop as a separate redirected drive. KKTerm maps every RDPDR device ID to its own canonical selected root and validates remote paths against that root before file operations. Enabling the option without any selected folder is rejected with `settings.rdpSharedFoldersRequired`.

`settings.rdpRedirectPrinters` is off by default and appears only on Windows, both as a global RDP default and as a per-Connection override. Enabling it maps the local printers into the Session through the RDP ActiveX host, so they appear in the remote print dialog alongside the server's own printers. The remote server must supply the driver: it needs Remote Desktop Easy Print or a printer driver matching the local device, otherwise the redirected queue is created but cannot print. The macOS and Linux IronRDP Session path has no printer backend, so the setting is not shown there.

When a Connection inherits RDP defaults, its administrative-session toggle, printer toggle, and local-resource selector are disabled and show the inherited values. Choosing Connection-specific settings enables its own administrative-session choice, printer redirection, drive subset, or shared-folder list without changing the global defaults. A Windows-only printer override is preserved when the same Connection is edited on macOS or Linux.

### View mode (`settings.remoteDesktopViewMode`)

Controls how the remote screen is fitted into a workspace Pane. Available both as a global default (Settings → RDP / VNC) and as a per-Connection override. Toolbar changes save the selected Connection-specific mode. VNC supports visible scrollbars in `settings.remoteDesktopViewModeActualSize`; this is the recommended mode when a remote dual-monitor framebuffer is too wide to read after being scaled down.

### Remote resolution (`settings.rdpRemoteResolution`)

Controls the desktop size and scaling KKTerm asks the RDP ActiveX control to apply. Available both as a global default (Settings → RDP) and as a per-connection override.

- `settings.rdpRemoteResolutionAutomatic` (default) — push the Pane's physical pixel size as `DesktopWidth`/`DesktopHeight`, forward the host display scale factor as the RDP `DesktopScaleFactor` (so the remote OS renders UI at the host DPI), and keep the remote desktop matched to the visible Pane while `SmartSizing` normally stays off. If either physical Pane dimension is below the ActiveX desktop minimum of 200 pixels, KKTerm requests the 200-pixel minimum and temporarily enables `SmartSizing` to fit the native surface within the smaller Pane. On a 4K monitor at 150% scaling the remote desktop looks the same size as native host apps and pointer coordinates stay 1:1.
- Fixed resolutions (`1440x900` through `3840x2400`) — push the chosen size as `DesktopWidth`/`DesktopHeight` on connect and enable `SmartSizing` so the framebuffer scales to fill the Pane. Subsequent Pane resizes do not change the remote desktop size.

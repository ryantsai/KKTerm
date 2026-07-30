# RDP ActiveX Gotchas

This note collects the RDP ActiveX lessons learned while debugging KKTerm RDP
Sessions against Windows and Ubuntu 24.04/GNOME Remote Desktop targets.

## Grounded References

- Ubuntu Desktop docs: [Share your desktop remotely](https://documentation.ubuntu.com/desktop/en/latest/how-to/share-your-desktop-remotely/).
  Ubuntu distinguishes **Desktop Sharing** from **Remote Login**. Desktop
  Sharing mirrors the logged-in server user session, so the shared-screen
  resolution is determined by the server session. Remote Login creates a remote
  login session whose resolution is determined by the client window.
- Ubuntu Desktop docs: [Access a remote desktop](https://documentation.ubuntu.com/desktop/en/26.04/how-to/access-a-remote-desktop/).
  Ubuntu's client-side guidance warns that if the shared screen is larger than
  the client display, the user may see only part of the remote screen.
- Microsoft Learn: [IMsRdpClientAdvancedSettings::SmartSizing](https://learn.microsoft.com/en-us/windows/win32/termserv/imsrdpclientadvancedsettings-smartsizing).
  SmartSizing scales the remote desktop to fit the ActiveX control client area;
  scroll bars do not appear when SmartSizing is enabled. The property is unusual
  because it can be changed while connected.
- Microsoft Learn: [IMsRdpClient9 methods](https://learn.microsoft.com/en-us/windows/win32/termserv/imsrdpclient9-methods)
  documents `UpdateSessionDisplaySettings` as the dynamic display update method
  exposed by newer RDP ActiveX controls.

## Vocabulary

- **Connection**: durable saved resource in KKTerm.
- **Session**: live RDP runtime state.
- **Tab**: frontend workspace container.
- **Pane**: visible workspace area that owns the RDP host rectangle.
- **ActiveX HWND**: native window hosting `mstscax.dll`; it is not a DOM
  element and does not obey CSS clipping or z-index.

## Two Different Size Models

RDP has two distinct size strategies:

- **Remote display renegotiation**: ask the server to change the remote desktop
  size through `DesktopWidth`, `DesktopHeight`, and
  `UpdateSessionDisplaySettings`. This is best for Windows servers and Ubuntu
  Remote Login because the remote OS can render at the Pane size.
- **Presentation fit**: keep the remote desktop size fixed and scale the bitmap
  locally with ActiveX `SmartSizing`. This is required when the server exposes a
  fixed framebuffer, such as Ubuntu/GNOME Desktop Sharing mirroring an already
  logged-in user's physical display.

Do not confuse these. A Windows target can be correct with SmartSizing off and
dynamic display updates on. An Ubuntu Desktop Sharing target can still show a
horizontal scrollbar in the same mode because it is exposing the server's
physical monitor resolution.

## Ubuntu 24.04/GNOME Remote Desktop

Ubuntu's built-in RDP server is GNOME Remote Desktop, not xrdp. Online xrdp
configuration advice often does not apply.

Ubuntu has two important modes:

- **Desktop Sharing**: requires the server user to be logged in. It mirrors that
  user's current desktop. The resolution comes from the server session, so a
  client-sized `DesktopWidth` may not become the effective remote monitor size.
  If the server display is `3838x1919`, the client may receive exactly that even
  when KKTerm's Pane is smaller.
- **Remote Login**: used while logged out or by terminating the existing local
  session. The remote session follows the client window size and is the mode
  that behaves most like Windows RDP dynamic sizing.

If Microsoft `mstsc.exe` shows the same oversized/shared-screen result against
the same Ubuntu host, treat it as Ubuntu Desktop Sharing behavior first, not a
KKTerm-only rendering bug.

## ActiveX Lifecycle Rules

- Create and configure the control before `Connect`.
- Set initial `DesktopWidth` and `DesktopHeight` before `Connect`.
- For visible Sessions, use `update_rdp_bounds`. It keeps the ActiveX HWND
  on-screen and can call `UpdateSessionDisplaySettings` when the selected
  resolution mode tracks the Pane.
- `sync_rdp_display_size` and `stage_rdp` are staging primitives. They park the
  ActiveX HWND off-screen and only make sense when the normal reveal path follows
  immediately.
- Do not call `sync_rdp_display_size` on a visible connected Pane by itself. It
  can leave a "Connected" Tab blank because the native HWND is parked.
- Do not silently fall back from `UpdateSessionDisplaySettings` to
  `Reconnect(width, height)` in the default lifecycle. RDCMan treats reconnect
  as a separate strategy. During this debugging run, invoking `Reconnect` while
  Ubuntu/GNOME was establishing caused a quick disconnect after connect.

## SmartSizing Rules

SmartSizing is useful, but only in the right lane:

- Enable it for fixed-resolution and explicit presentation-fit modes.
- Enable it when either physical ActiveX host dimension is below Microsoft's
  200-pixel `DesktopWidth`/`DesktopHeight` minimum; request the 200-pixel
  remote desktop minimum and scale it into the smaller Pane.
- Consider enabling it as a fallback when a server keeps a larger fixed
  framebuffer and the ActiveX control reports or visibly shows scrollbars.
- Keep it disabled for true Pane-tracking dynamic resize modes when the server
  accepts `UpdateSessionDisplaySettings`; that preserves 1:1 pointer coordinates
  and avoids a scaled-down Windows desktop.
- Microsoft documents SmartSizing as suppressing scrollbars, so it is the
  grounded escape hatch for Ubuntu Desktop Sharing's fixed framebuffer case.

## DPI And Cursor Traps

The pointer offset bug and squeezed UI bug were both symptoms of mixing these
coordinate systems:

- React reports Pane bounds in WebView CSS pixels.
- The native ActiveX HWND must be positioned in physical screen pixels.
- The RDP server may receive a desktop pixel size plus separate DPI hints
  (`DesktopScaleFactor`, `DeviceScaleFactor`).
- GNOME Desktop Sharing may ignore the requested dynamic desktop size because it
  is mirroring the server session.

When the cursor is correct but the UI is squeezed, suspect local presentation
scaling. When the UI scale is correct but the cursor is offset, suspect a
coordinate transform mismatch between the native HWND size, SmartSizing, and the
remote desktop size.

## Debug Log Fields That Matter

When asking a user for another RDP log, make sure the following events are
present:

- `session.start.request`: host, port, selected options, and requested Pane
  bounds.
- `session.start.geometry`: frontend bounds converted to native pixels,
  including scale factor.
- `session.start.display_settings`: initial `DesktopWidth`, `DesktopHeight`,
  `DesktopScaleFactor`, and `DeviceScaleFactor`.
- `display.sync.state`: connection state, whether the mode tracks Pane size,
  requested bounds, native rect, display settings, and stored desktop size.
- `display.resize.ok`: whether `UpdateSessionDisplaySettings` was accepted.
- `display.resize.error`: method failure, HRESULT text, force flag, failure
  count, and requested display settings.
- `display.resize.skipped`: confirms the cached-size gate skipped because
  dimensions and scale factors were unchanged.
- `visibility.set`: visible/hidden state, request bounds, native rect, and
  parked Session count.
- `main_thread.operation.*`: proves whether an RDP command stalled the main UI
  thread.

For future hard cases, also useful to log:

- WebView `window.devicePixelRatio` alongside Tauri window `scale_factor()`.
- DOM `getBoundingClientRect`, `clientWidth/clientHeight`, and current RDP view
  mode.
- Actual ActiveX HWND `GetWindowRect` and `GetClientRect` after `SetWindowPos`.
- Optional ActiveX scrollbar visibility properties if available on the installed
  `mstscax.dll`.

`ui.debug.log` records these sizing comparisons as correlated
`rdp.geometry.frontend` and `rdp.geometry.native` events. The frontend event
contains the raw DOM rectangle, owning embedded Pane clip, rounded logical
request, element dimensions, device pixel ratio, and visual viewport. The native event contains the Tauri
scale factor, requested physical rectangle, actual ATL host window/client
rectangles, actual hosted ActiveX object window/client rectangles, SmartSizing
state, and current remote desktop dimensions. Compare events by `sessionId`; no host, username, or secret
is included.

## Practical Decision Tree

1. If Windows RDP is scaled down, confirm Automatic mode is not using
   SmartSizing and is sending Pane physical pixels as `DesktopWidth` and
   `DesktopHeight`.
2. If Windows RDP disappears after switching Tabs, inspect whether a staging
   command parked the HWND without a following reveal. Visible Sessions should
   go through `update_rdp_bounds`.
3. If Ubuntu connects then disconnects within about one second, check for an
   automatic `Reconnect(width, height)` fallback during establishing/login.
4. If Ubuntu shows the server's exact physical resolution and `mstsc.exe` shows
   the same result, treat it as Ubuntu Desktop Sharing fixed-framebuffer
   behavior.
5. If Ubuntu fixed-framebuffer mode shows scrollbars in "fit workspace", prefer
   ActiveX SmartSizing/presentation-fit over more dynamic resize retries.
6. If cursor offset returns, compare native HWND size, remote desktop size,
   SmartSizing state, and WebView/native scale factors before changing another
   sizing heuristic.

## Keyboard Focus And `WS_EX_NOACTIVATE`

The ActiveX overlay is a separate top-level `WS_POPUP` window created
`WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` and only ever shown/moved with
`SWP_NOACTIVATE` / `SW_SHOWNOACTIVATE`. This is deliberate: the overlay must
never steal activation from the main KKTerm frame (custom title bar, WebView2
focus model). The tradeoff is that clicking the remote desktop does **not**
bring KKTerm to the foreground or hand keyboard focus to the control:

- Mouse works regardless of foreground state, because Windows delivers mouse
  messages to the window under the cursor. The remote cursor moves and text can
  even be selected.
- Keyboard does not follow. Keystrokes keep going to whatever window held OS
  focus (e.g. another app on a second monitor, or any other foreground window).

Symptom: "mouse moved into the RDP session from another program works, but
typing goes to the other program until I click the connection tab." On a single
monitor this usually hides itself because switching to KKTerm tends to displace
the previously focused app; it is most visible on multi-monitor setups where
both windows stay visible.

### Why `WM_MOUSEACTIVATE` does not work here

`WM_MOUSEACTIVATE` is the obvious hook, but it is **not** delivered for a plain
click into a `WS_EX_NOACTIVATE` top-level window: Windows sees the window is
non-activatable, short-circuits the activation decision entirely, and just
routes the mouse message to the child under the cursor (which is why the remote
cursor already moves). The only known path that still sends `WM_MOUSEACTIVATE` to
a `WS_EX_NOACTIVATE` window is the "activate a window by hovering over it"
accessibility feature ("active window tracking"), which Microsoft itself
describes as an oversight in the feature's code. A previous attempt installed a
`WM_MOUSEACTIVATE` subclass on the overlay; because the message never fires on a
real click it fixed nothing, and on systems with hover-to-activate enabled it
actively stole focus to KKTerm on mere *hover* (inverting the whole point of the
no-activate overlay). That subclass was reverted. See Raymond Chen, "My window
has the `WS_EX_NOACTIVATE` extended style, but it got activated anyway"
(https://devblogs.microsoft.com/oldnewthing/20240919-00/?p=110283), and the
`WM_MOUSEACTIVATE` reference
(https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-mouseactivate).

### Fix: low-level button-down hook plus child HWND focus

A thread-local `WH_MOUSE` hook was also too narrow. It assumed the first click
would always be removed from the Tauri main thread queue, but the real target
can be an mstscax-owned child HWND. It also focused the outer `AtlAxWin` overlay
instead of the window that should receive keyboard input.

The reliable trigger is a **low-level `WH_MOUSE_LL` hook**
(`SetWindowsHookExW(WH_MOUSE_LL, …, None, 0)`), installed lazily the first time
an RDP overlay becomes visible and torn down when no sessions remain. Low-level
mouse hooks are called before the mouse message is posted, so the callback does
not depend on which thread owns the ActiveX child window. On button-down only,
KKTerm resolves the screen point with `WindowFromPoint`, confirms the target is
inside the visible overlay subtree (`IsChild(overlay, target)`), foregrounds the
main owner, foregrounds the no-activate overlay programmatically, and focuses
the clicked child HWND (falling back to `IOleInPlaceObject`
`GetWindow`). It always `CallNextHookEx` so the click still reaches the remote
session - mouse behavior is unchanged.

The hook must never react to hover or movement; that would recreate the
hover-to-activate focus steal from the reverted `WM_MOUSEACTIVATE` subclass.
SSH/TELNET do not need this because they render inside the activatable WebView2
window and `TerminalWorkspace` already restores focus on activation.

The hook's active overlay target is owned by a Session id. Tab visibility
effects and explicit reconnect teardown are asynchronous, so a stale hide or
close for Session A may arrive after Session B has already become visible.
Such a stale request must not clear Session B's focus target. Reconnect also
awaits teardown of the old ActiveX Session before starting its replacement.
Do not "fix" this by blurring the Reconnect button, auto-focusing a newly
connected control, or synthesizing a second click: those approaches hide the
ownership bug and can steal focus when a background reconnect completes.

## Current Architectural Constraint

KKTerm embeds Microsoft's RDP ActiveX control. That keeps Windows RDP auth,
clipboard, keyboard hooks, and rendering delegated to `mstscax.dll`, but it also
means KKTerm has limited visibility into server-specific behavior. The client
can choose between dynamic remote display updates and local SmartSizing; it
cannot force GNOME Desktop Sharing to behave like Ubuntu Remote Login.

If a future implementation needs perfect behavior across fixed-framebuffer and
dynamic-resize servers without ActiveX airspace limitations, the architecture
would need a non-ActiveX RDP renderer owned by KKTerm. That is a major protocol
and rendering responsibility, not a surgical fix.

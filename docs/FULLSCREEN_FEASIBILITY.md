# Full-Screen Mode Feasibility — Connection Tab & Child Window

Status: **feasibility analysis only** (no implementation). Scope: adding a
full-screen presentation mode for a Connection surface, driven from the
Connection Tab, and/or in a detached child window. Emphasis on **RDP** and
**VNC**, with notes on the URL and terminal surfaces that share the same
machinery.

This is an analysis of what already exists, what each option costs, and which
invariants constrain the design. It does not change behavior. Terms follow
`CONTEXT.md` (Connection / Session / Tab / Pane).

## 1. What "full screen" can mean here

Two independent axes; the request ("connectiontab / childwindow") spans both:

- **Placement**
  - **A. In-app full screen** — the active Connection surface expands to fill
    the whole KKTerm frame (hide Activity Rail, Connection Tree, AI Assistant
    Panel, Tab Strip, Pane toolbar, Status Bar). Optionally push the OS window
    itself to true full screen (borderless, over the taskbar/menu bar).
  - **B. Child-window full screen** — the surface pops into its own top-level
    OS window that can be full-screened independently (e.g. RDP maximized on a
    second monitor while KKTerm stays on the first).
- **Surface**
  - **VNC** — a DOM `<canvas>` in the main WebView, painted from RGBA
    framebuffer events (`RemoteDesktopWorkspace.tsx`).
  - **RDP, Windows** — the Microsoft `mstscax.dll` ActiveX control hosted in a
    **separate top-level owned `WS_POPUP` window** (`WS_EX_NOACTIVATE |
    WS_EX_TOOLWINDOW`), positioned over the Pane and driven from Rust
    (`update_rdp_bounds` / `set_rdp_visibility`).
  - **RDP, macOS/Linux** — IronRDP renders into a DOM `<canvas>`
    (`RdpCanvasView.tsx`), architecturally identical to VNC.
  - **URL** — a borderless, owned `WebviewWindow` positioned over the Pane
    (`webview.rs`), bounds re-pushed on resize/scroll/move.

The decisive architectural fact: **two of these surfaces (Windows RDP and URL)
are already separate top-level windows that merely track the Pane rectangle**;
the other two (VNC, macOS/Linux RDP) are DOM canvases inside the main WebView.
Full screen is therefore "change the rectangle they track" for the former and
"change CSS layout" for the latter — the hard part is not the pixels, it's
chrome hiding, exit affordances over native airspace, and (for child windows)
window lifecycle.

## 2. Current state

- **No full-screen concept exists for any Connection surface today.** The only
  "fullscreen" in the tree is *screenshot capture* (all-monitors), unrelated to
  this feature.
- Window controls are limited to minimize / toggle-maximize / close via the
  custom React title bar (`src/app/TitleBar.tsx`). Capabilities granted in
  `src-tauri/capabilities/default.json` are `minimize`, `show`, `unminimize`,
  `set-focus`, `toggle-maximize`, `close`, `is-maximized`,
  `start-dragging`. **`set-fullscreen` is not granted and no command wraps it.**
- Remote-desktop surfaces already have a `RemoteDesktopViewMode`
  (`fit | stretch | actualSize | fitWidth | fitHeight`, `src/types.ts`) that
  governs *scaling within the Pane* — but no mode that changes the Pane's own
  extent.
- Pane geometry for the native surfaces is computed in the frontend and pushed
  to Rust:
  - RDP: `computeBounds()` in `RemoteDesktopWorkspace.tsx` intersects the host
    rect with the owning `.embedded-workspace-pane`, then calls
    `update_rdp_bounds` / `set_rdp_visibility`. A `ResizeObserver` and native
    `tauri://move` / `tauri://resize` listeners keep it synced.
  - URL: the same pattern in `webview.rs` + its frontend workspace.
- `window_state.rs` persists only the **non-maximized** inner size as "normal
  size"; maximized is a boolean. There is no full-screen bit.

## 3. Feasibility by option

Effort labels are relative: **LOW** ≈ contained UI/CSS + one small command,
**MEDIUM** ≈ new command + geometry/lifecycle wiring + tests, **HIGH** ≈ new
render host or reparenting of a delicate native surface.

### Option A — In-app full screen (recommended first)

Expand the active surface to fill the frame; hide app chrome. Two sub-levels:
**A1** fills the KKTerm client area only; **A2** also drives the OS window to
true full screen.

| Surface | Effort | Notes |
| --- | --- | --- |
| VNC | **LOW** | Pure DOM/CSS. A full-screen state collapses chrome and lets the canvas container fill the frame; existing `viewMode` handles scaling and the `ResizeObserver` already re-fits. |
| RDP (macOS/Linux canvas) | **LOW** | Same as VNC — DOM canvas. |
| RDP (Windows ActiveX) | **MEDIUM** | The popup already tracks a rect. Hiding React chrome enlarges the host `<div>`; the existing `ResizeObserver` → `update_rdp_bounds` pushes the bigger rectangle, and in `rdpRemoteResolutionAutomatic` mode the remote desktop renegotiates to the larger size (a feature, not a bug). Watch items below. |
| URL | **LOW–MEDIUM** | Reuses the same bounds-push path as RDP; the overlay window already resizes with the Pane. |
| Terminal / SFTP | **LOW** | DOM; only chrome-hiding + a re-fit. |

**A2 (true OS full screen)** adds, once, on top of A1:

- A `set_main_window_fullscreen(bool)` Tauri command wrapping
  `window.set_fullscreen()`, plus `core:window:allow-set-fullscreen` in
  `capabilities/default.json`.
- Hide the custom title bar while full-screen (it is always custom; see
  ARCHITECTURE "main window always uses the custom React title bar").
- Exclude the full-screen state from `window_state.rs` "normal size"
  persistence (mirror the existing maximized exclusion) so an app relaunch
  never restores a frameless full-screen as the normal window.
- The native minimize-to-tray close arm (`app_tray.rs`) is unaffected —
  full-screen is orthogonal to the close path. Do **not** add any frontend
  close hook (High-Risk Invariant).

**Windows-RDP watch items (the only non-trivial surface for A):**

1. `computeBounds()` intersects with `.embedded-workspace-pane`. The
   full-screen container must present a real, correctly-sized DOM rect (or the
   clip logic must treat full-screen as "no clip") or the pushed rectangle will
   be wrong.
2. Re-apply visible bounds only through `update_rdp_bounds` (pass
   `force: true` when the remote resize must run despite an unchanged cached
   size). **Never** use `sync_rdp_display_size` / `stage_rdp` on a visible pane
   — they park the HWND off-screen and blank a "Connected" pane
   (ARCHITECTURE; `RDP_ACTIVEX_GOTCHAS.md`; regressions in PRs #180/#181).
3. **Exit affordance over native airspace.** The RDP popup and URL overlay
   draw above DOM regardless of `z-index`. A full-screen exit button/bar drawn
   over them must be a Tauri **native context menu** (`nativeContextMenu.ts`)
   or a DOM overlay registered in `nativeOverlay.ts` (snapshot-then-park for
   RDP, snapshot-then-hide for URL). It cannot be a plain floating `<button>`.
4. **Keyboard exit.** Remote Desktop Panes are deliberately excluded from the
   workspace shortcut capture so keys reach the remote host, and the RDP popup
   is `WS_EX_NOACTIVATE` (keystrokes route to the OS-focused window). An
   in-surface `Esc`/`F11` will not reliably reach React. Exit therefore needs
   either a native accelerator/menu item, a persistent non-DOM affordance
   (e.g. a thin always-native top strip), or a titlebar/rail toggle that stays
   outside the native surface's airspace. This is the main UX design decision
   for A on Windows RDP.

### Option B — Child-window full screen (later, staged)

Detach the surface into its own OS window that can be full-screened
independently.

| Surface | Effort | Notes |
| --- | --- | --- |
| URL | **MEDIUM** | Already a `WebviewWindow`. "Detach" = stop tracking the Pane rect, give it decorations/its own bounds (or full screen), and manage return-to-Pane. Mostly lifecycle/ownership work; no new render host. |
| RDP (Windows ActiveX) | **MEDIUM–HIGH** | Already a top-level owned `WS_POPUP`. In principle it can be re-owned to a new frame or simply positioned over a second monitor / full-screened without a new render host. But it touches the most-regressed native subsystem (parking, airspace, geometry lifecycle, the `WH_MOUSE_LL` focus hook, `WS_EX_NOACTIVATE` activation model). Re-homing ownership and the geometry/visibility commands to a second frame is real risk; do not treat it as surgical. |
| VNC | **HIGH** | The canvas lives in the **main WebView's** DOM. A separate OS window is a separate WebView with its own React tree; it cannot access the main window's canvas or event stream. Delivering it means a second minimal render host that re-subscribes to the same Session events and forwards input — significant plumbing (session routing, input, teardown, focus). Reparenting a DOM canvas across WebViews is not possible. |
| RDP (macOS/Linux canvas) | **HIGH** | Same as VNC — second WebView render host required. |

So child-window full screen is cheap exactly where the surface is already its
own window (URL, then Windows RDP with care) and expensive wherever the surface
is a DOM canvas (VNC, macOS/Linux RDP).

## 4. Recommendation

1. **Ship Option A (in-app full screen) first.** It fits the existing
   architecture, reuses the geometry-sync and view-mode machinery, and covers
   every surface on every platform at LOW–MEDIUM cost. Suggested sequence:
   - A1 for DOM surfaces (VNC, macOS/Linux RDP, terminal) — trivial.
   - A1 for Windows RDP ActiveX + URL — geometry re-push + the exit affordance.
   - A2 (optional) — one `set_fullscreen` command + title-bar hide +
     persistence exclusion, shared by all surfaces.
2. **Defer Option B (child window)** to a separate effort. If pursued, start
   with **URL** (cheapest, reuses the existing `WebviewWindow`), then evaluate
   **Windows RDP** carefully. Explicitly scope **VNC / macOS-Linux RDP child
   windows** as a larger "second render host" project, or exclude them and let
   those surfaces use A (in-app full screen) only.
3. Do **not** attempt RDP-ActiveX reparenting or a VNC second-window host as a
   casual add-on — both intersect High-Risk Invariants and the RDP airspace
   lifecycle.

A defensible v1 that satisfies "full screen for RDP and VNC" is: **Option A1 +
A2, all surfaces**, with the exit affordance solved via a native menu item and
an optional always-native top strip. Child windows come later.

## 5. Invariants and required follow-through (from AGENTS.md / ARCHITECTURE.md)

- **Airspace**: any exit/toolbar UI over RDP or URL uses `nativeContextMenu.ts`
  or is registered in `nativeOverlay.ts`; extend
  `tests/native-surface-overlay-policy.test.mjs`. RDP parking is RDP-only —
  never reuse it for URL/VNC/terminal.
- **RDP commands**: visible re-apply via `update_rdp_bounds` (`force: true`
  when needed); never `sync_rdp_display_size`/`stage_rdp` on a visible pane.
- **Close path**: no frontend close hooks / close-confirmation; the tray
  diversion in `app_tray.rs` stays the only exception.
- **Window state**: full-screen must be excluded from "normal size"
  persistence in `window_state.rs`.
- **i18n**: every new string (menu items, tooltips, mode labels) goes into
  `en.json` first with a matching `docs/localization_todo/` file per key.
- **Tutorial/manual**: a new full-screen control needs a stable
  `data-tutorial-id`, an entry in `src/app/tutorialNavigationModel.ts`,
  matching `tutorial_highlight` metadata in `src-tauri/src/ai.rs`, and updates
  to `docs/manual/09-remote-desktop.md` (and `04-workspace-tabs-panes.md` /
  `08-url-webview.md` as scope dictates). `npm run check` validates the
  tutorial mappings.
- **Verification**: RDP/VNC/URL, focus/input, native menus, and title-bar
  behavior must be validated in the real Tauri desktop runtime, not
  Vite/browser preview.

## 6. Open questions for the requester

- Which placement is actually wanted first — **in-app** full screen (A),
  **child window** (B), or both?
- Is **true OS full screen** (A2, over taskbar/menu bar) required, or is
  filling the KKTerm frame (A1) enough?
- Platform priority for RDP: Windows ActiveX vs. macOS/Linux canvas (Windows
  first per the product tradeoff order)?
- Preferred exit affordance for the native surfaces: a native menu item, an
  always-native top strip, a title-bar toggle, or a global accelerator?

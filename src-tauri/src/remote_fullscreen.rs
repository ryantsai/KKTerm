//! Detached full-screen windows for RDP and VNC Sessions.
//!
//! A remote-desktop Session normally renders inside its Pane in the main
//! window. "Full screen" here means presenting that *same live Session* in a
//! separate, borderless top-level window that covers one monitor (true OS
//! full screen) or spans the whole virtual desktop — the model used by mstsc,
//! RDCMan, Remmina and TigerVNC.
//!
//! This module owns only the window/monitor plumbing. It does not start or own
//! the Session: VNC (`vnc-session-event`) and IronRDP (`rdp-canvas-event`)
//! already emit **app-wide**, and their input commands are keyed by
//! `session_id`, so the full-screen window attaches to the running Session by
//! id and renders it with the shared remote-desktop surface code. The Windows
//! RDP ActiveX popup is positioned over this window through the existing
//! `update_rdp_bounds` / `set_rdp_visibility` geometry path.
//!
//! NOTE: real RDP/VNC full-screen behavior and the Windows ActiveX multimon
//! path must be validated in the Tauri desktop runtime; this file only carries
//! the portable window lifecycle.

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl,
    WebviewWindowBuilder,
};

use crate::window_state::MAIN_WINDOW_LABEL;

const LABEL_PREFIX: &str = "remote-fullscreen-";
const TOGGLE_SHORTCUT_EVENT: &str = "kkterm://toggle-remote-fullscreen";

pub(crate) fn emit_toggle_shortcut(app: &AppHandle) {
    let target = app
        .webview_windows()
        .into_values()
        .find(|window| {
            window.label().starts_with(LABEL_PREFIX) && window.is_focused().unwrap_or(false)
        })
        .or_else(|| {
            app.get_webview_window(MAIN_WINDOW_LABEL)
                .filter(|window| window.is_focused().unwrap_or(false))
        });
    if let Some(window) = target {
        let _ = window.emit(TOGGLE_SHORTCUT_EVENT, ());
    }
}

/// One physical display, reported to the frontend monitor picker.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MonitorInfo {
    /// OS monitor name; may be empty when the platform does not expose one.
    pub(crate) name: String,
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) scale_factor: f64,
    pub(crate) is_primary: bool,
}

/// Which display(s) a full-screen window should cover.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MonitorMode {
    /// The monitor the main window currently sits on.
    Current,
    /// A specific monitor selected by name.
    Named,
    /// The whole virtual desktop across every monitor.
    Span,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRemoteFullscreenRequest {
    /// Live Session id to attach to (`rdp-…` / `vnc-…`).
    pub(crate) session_id: String,
    /// Durable Connection id, so the full-screen host can load its settings.
    pub(crate) connection_id: String,
    /// `"rdp"` or `"vnc"`; selects the surface the host renders.
    pub(crate) kind: String,
    pub(crate) monitor_mode: MonitorMode,
    /// Target monitor name when `monitor_mode` is `named`.
    #[serde(default)]
    pub(crate) monitor_name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn label_for(session_id: &str) -> String {
    format!("{LABEL_PREFIX}{session_id}")
}

pub(crate) fn session_id_from_label(label: &str) -> Option<&str> {
    label
        .strip_prefix(LABEL_PREFIX)
        .filter(|value| !value.is_empty())
}

fn collect_monitors(app: &AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window is not available".to_string())?;
    let primary_name = main
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|monitor| monitor.name().cloned());
    let monitors = main
        .available_monitors()
        .map_err(|error| format!("failed to enumerate monitors: {error}"))?;
    Ok(monitors
        .into_iter()
        .map(|monitor| {
            let name = monitor.name().cloned().unwrap_or_default();
            let position = monitor.position();
            let size = monitor.size();
            let is_primary = primary_name
                .as_ref()
                .is_some_and(|primary| primary == &name);
            MonitorInfo {
                name,
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                scale_factor: monitor.scale_factor(),
                is_primary,
            }
        })
        .collect())
}

/// Union rectangle covering every monitor (the virtual desktop bounds).
fn span_rect(monitors: &[MonitorInfo]) -> Option<Rect> {
    let first = monitors.first()?;
    let mut left = first.x;
    let mut top = first.y;
    let mut right = first.x + first.width as i32;
    let mut bottom = first.y + first.height as i32;
    for monitor in monitors.iter().skip(1) {
        left = left.min(monitor.x);
        top = top.min(monitor.y);
        right = right.max(monitor.x + monitor.width as i32);
        bottom = bottom.max(monitor.y + monitor.height as i32);
    }
    Some(Rect {
        x: left,
        y: top,
        width: (right - left).max(1) as u32,
        height: (bottom - top).max(1) as u32,
    })
}

fn rect_for_monitor(monitor: &MonitorInfo) -> Rect {
    Rect {
        x: monitor.x,
        y: monitor.y,
        width: monitor.width.max(1),
        height: monitor.height.max(1),
    }
}

/// Resolve the target rectangle and whether the OS `set_fullscreen` path is
/// usable (single monitor only — a spanned window must stay borderless because
/// native full screen covers just one display).
fn resolve_target(
    app: &AppHandle,
    request: &OpenRemoteFullscreenRequest,
    monitors: &[MonitorInfo],
) -> Result<(Rect, bool), String> {
    match request.monitor_mode {
        MonitorMode::Span => {
            let rect =
                span_rect(monitors).ok_or_else(|| "no monitors available to span".to_string())?;
            Ok((rect, false))
        }
        MonitorMode::Named => {
            let name = request
                .monitor_name
                .as_deref()
                .ok_or_else(|| "monitor name is required for named mode".to_string())?;
            let monitor = monitors
                .iter()
                .find(|monitor| monitor.name == name)
                .ok_or_else(|| format!("monitor '{name}' was not found"))?;
            Ok((rect_for_monitor(monitor), true))
        }
        MonitorMode::Current => {
            let main = app
                .get_webview_window(MAIN_WINDOW_LABEL)
                .ok_or_else(|| "main window is not available".to_string())?;
            if let Ok(Some(current)) = main.current_monitor() {
                let position = current.position();
                let size = current.size();
                return Ok((
                    Rect {
                        x: position.x,
                        y: position.y,
                        width: size.width.max(1),
                        height: size.height.max(1),
                    },
                    true,
                ));
            }
            // Fall back to the primary/first monitor when the current one is
            // unknown (e.g. main window hidden).
            let monitor = monitors
                .iter()
                .find(|monitor| monitor.is_primary)
                .or_else(|| monitors.first())
                .ok_or_else(|| "no monitors available".to_string())?;
            Ok((rect_for_monitor(monitor), true))
        }
    }
}

/// Enumerate displays for the full-screen monitor picker (span / choose).
#[tauri::command]
pub(crate) fn list_display_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    collect_monitors(&app)
}

/// Open (or focus) the detached full-screen window for a live Session.
#[tauri::command]
pub(crate) fn open_remote_fullscreen_window(
    app: AppHandle,
    request: OpenRemoteFullscreenRequest,
) -> Result<(), String> {
    if request.kind != "rdp" && request.kind != "vnc" {
        return Err(format!("unsupported full-screen kind: {}", request.kind));
    }
    let label = label_for(&request.session_id);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(());
    }

    let monitors = collect_monitors(&app)?;
    let (rect, allow_native_fullscreen) = resolve_target(&app, &request, &monitors)?;

    // Hash route consumed by the frontend full-screen host (see main.tsx).
    let route = format!(
        "index.html#/remote-fullscreen/{}/{}/{}",
        request.kind, request.session_id, request.connection_id
    );

    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(route.into()))
        .title("KKTerm")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(true)
        .skip_taskbar(false)
        .visible(false)
        .inner_size(rect.width.max(1) as f64, rect.height.max(1) as f64)
        .build()
        .map_err(|error| format!("failed to create full-screen window: {error}"))?;

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(rect.x, rect.y)));
    let _ = window.set_size(Size::Physical(PhysicalSize::new(
        rect.width.max(1),
        rect.height.max(1),
    )));
    if allow_native_fullscreen {
        // True OS full screen also covers the taskbar/menu bar. RDCMan's
        // documented bug is that a merely *maximized* host leaves a taskbar
        // gutter, so we always use real full screen for a single monitor.
        let _ = window.set_fullscreen(true);
    }
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// Close the detached full-screen window for a Session, if present. The live
/// Session keeps running in its Pane; only the extra window goes away.
#[tauri::command]
pub(crate) fn close_remote_fullscreen_window(
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label_for(&session_id)) {
        window
            .close()
            .map_err(|error| format!("failed to close full-screen window: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(name: &str, x: i32, y: i32, width: u32, height: u32, primary: bool) -> MonitorInfo {
        MonitorInfo {
            name: name.to_string(),
            x,
            y,
            width,
            height,
            scale_factor: 1.0,
            is_primary: primary,
        }
    }

    #[test]
    fn span_rect_covers_all_monitors() {
        let monitors = vec![
            monitor("A", 0, 0, 1920, 1080, true),
            monitor("B", 1920, -120, 2560, 1440, false),
        ];
        let rect = span_rect(&monitors).expect("monitors span a rect");
        assert_eq!(
            rect,
            Rect {
                x: 0,
                y: -120,
                width: 4480,
                height: 1440,
            }
        );
    }

    #[test]
    fn span_rect_is_none_without_monitors() {
        assert_eq!(span_rect(&[]), None);
    }

    #[test]
    fn rect_for_monitor_uses_monitor_bounds() {
        let rect = rect_for_monitor(&monitor("A", 100, 200, 1280, 720, false));
        assert_eq!(
            rect,
            Rect {
                x: 100,
                y: 200,
                width: 1280,
                height: 720,
            }
        );
    }

    #[test]
    fn session_id_is_recovered_from_fullscreen_window_label() {
        assert_eq!(
            session_id_from_label("remote-fullscreen-rdp-123"),
            Some("rdp-123")
        );
        assert_eq!(session_id_from_label("remote-fullscreen-"), None);
        assert_eq!(session_id_from_label("main"), None);
    }
}

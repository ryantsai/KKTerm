use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

#[cfg(target_os = "windows")]
use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::ShowOwnedPopups};

const TRAY_ID: &str = "kkterm-main";
const DONT_SLEEP_ITEM_ID: &str = "kkterm-tray-dont-sleep";
const EXIT_ITEM_ID: &str = "kkterm-tray-exit";
const RECENT_ITEM_PREFIX: &str = "kkterm-tray-recent:";
const CAPTURE_ITEM_PREFIX: &str = "kkterm-tray-capture:";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayRecentConnection {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuSnapshot {
    pub recent_connections: Vec<TrayRecentConnection>,
    pub dont_sleep_label: String,
    pub exit_label: String,
    // Localized capture item labels pushed by the frontend; empty strings (or
    // an older frontend omitting the fields) hide the capture section.
    #[serde(default)]
    pub capture_region_label: String,
    #[serde(default)]
    pub capture_window_label: String,
    #[serde(default)]
    pub capture_fullscreen_label: String,
}

pub struct TrayState {
    minimize_to_tray: AtomicBool,
    snapshot: Mutex<Option<TrayMenuSnapshot>>,
}

impl TrayState {
    pub fn new(minimize_to_tray: bool) -> Self {
        Self {
            minimize_to_tray: AtomicBool::new(minimize_to_tray && supports_minimize_to_tray()),
            snapshot: Mutex::new(None),
        }
    }

    pub fn minimize_to_tray(&self) -> bool {
        self.minimize_to_tray.load(Ordering::Relaxed)
    }

    pub fn set_minimize_to_tray(&self, enabled: bool) {
        self.minimize_to_tray
            .store(enabled && supports_minimize_to_tray(), Ordering::Relaxed);
    }

    pub fn set_snapshot(&self, snapshot: TrayMenuSnapshot) {
        if let Ok(mut guard) = self.snapshot.lock() {
            *guard = Some(snapshot);
        }
    }
}

pub fn install(app: &tauri::App, tooltip: &str) -> Result<(), String> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID).tooltip(tooltip);
    if let Some(icon) = tray_icon(app) {
        builder = builder.icon(icon);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    builder
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                crate::debug_heartbeat::record_tray_event("left-click");
                restore_main_window(tray.app_handle());
            }
            TrayIconEvent::Click {
                button: MouseButton::Right,
                ..
            } => crate::debug_heartbeat::record_tray_event("right-click"),
            TrayIconEvent::DoubleClick {
                button: MouseButton::Right,
                ..
            } => crate::debug_heartbeat::record_tray_event("right-double-click"),
            _ => crate::debug_heartbeat::record_tray_event("other"),
        })
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .build(app)
        .map_err(|error| format!("failed to install tray icon: {error}"))?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn supports_minimize_to_tray() -> bool {
    true
}

#[cfg(not(target_os = "windows"))]
fn supports_minimize_to_tray() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn tray_icon(_app: &tauri::App) -> Option<Image<'static>> {
    Some(tray_template_icon())
}

#[cfg(not(target_os = "macos"))]
fn tray_icon(app: &tauri::App) -> Option<Image<'static>> {
    app.default_window_icon().cloned().map(Image::to_owned)
}

#[cfg(target_os = "macos")]
fn tray_template_icon() -> Image<'static> {
    const SIZE: usize = 18;
    const MASK: [&str; SIZE] = [
        "000000000000000000",
        "000111111111111000",
        "001100000000001100",
        "011000000000000110",
        "011001100001100110",
        "011001100011000110",
        "011001100110000110",
        "011001101100000110",
        "011001111000000110",
        "011001101100000110",
        "011001100110000110",
        "011001100011000110",
        "011001100001100110",
        "011000000000000110",
        "001100000000001100",
        "000111111111111000",
        "000000000000000000",
        "000000000000000000",
    ];
    let mut rgba = Vec::with_capacity(SIZE * SIZE * 4);
    for row in MASK {
        for byte in row.bytes() {
            let alpha = if byte == b'1' { 255 } else { 0 };
            rgba.extend_from_slice(&[255, 255, 255, alpha]);
        }
    }
    Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

/// Rebuilds the tray menu from the snapshot the frontend last pushed. Does nothing until the
/// frontend has pushed a snapshot, since the menu labels are localized on the frontend. The
/// Don't Sleep check state is read live from [`crate::power::DontSleepManager`], which owns it.
pub fn rebuild_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    tray_state: &TrayState,
) -> Result<(), String> {
    let guard = tray_state
        .snapshot
        .lock()
        .map_err(|_| "tray menu snapshot is unavailable".to_string())?;
    let Some(snapshot) = guard.as_ref() else {
        return Ok(());
    };
    let dont_sleep_enabled = app
        .try_state::<crate::power::DontSleepManager>()
        .map(|power| power.is_enabled())
        .unwrap_or(false);
    let menu = build_menu(app, snapshot, dont_sleep_enabled)?;
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Err("tray icon is not installed".to_string());
    };
    tray.set_menu(Some(menu))
        .map_err(|error| format!("failed to update tray menu: {error}"))
}

fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    snapshot: &TrayMenuSnapshot,
    dont_sleep_enabled: bool,
) -> Result<Menu<R>, String> {
    let menu = Menu::new(app).map_err(|error| error.to_string())?;

    for connection in &snapshot.recent_connections {
        let item = MenuItem::with_id(
            app,
            format!("{RECENT_ITEM_PREFIX}{}", connection.id),
            &connection.label,
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        menu.append(&item).map_err(|error| error.to_string())?;
    }

    if !snapshot.recent_connections.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    }

    let capture_items = [
        ("region", &snapshot.capture_region_label),
        ("window", &snapshot.capture_window_label),
        ("fullscreen", &snapshot.capture_fullscreen_label),
    ];
    if capture_items.iter().all(|(_, label)| !label.is_empty()) {
        for (mode, label) in capture_items {
            let item = MenuItem::with_id(
                app,
                format!("{CAPTURE_ITEM_PREFIX}{mode}"),
                label,
                true,
                None::<&str>,
            )
            .map_err(|error| error.to_string())?;
            menu.append(&item).map_err(|error| error.to_string())?;
        }
        menu.append(&PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    }

    let dont_sleep = CheckMenuItem::with_id(
        app,
        DONT_SLEEP_ITEM_ID,
        &snapshot.dont_sleep_label,
        true,
        dont_sleep_enabled,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;
    menu.append(&dont_sleep)
        .map_err(|error| error.to_string())?;

    menu.append(&PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;

    let exit = MenuItem::with_id(app, EXIT_ITEM_ID, &snapshot.exit_label, true, None::<&str>)
        .map_err(|error| error.to_string())?;
    menu.append(&exit).map_err(|error| error.to_string())?;

    Ok(menu)
}

fn handle_menu_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    crate::debug_heartbeat::record_tray_event(format!("menu:{id}"));

    if id == EXIT_ITEM_ID {
        app.exit(0);
        return;
    }

    if id == DONT_SLEEP_ITEM_ID {
        toggle_dont_sleep(app);
        return;
    }

    if let Some(mode) = id.strip_prefix(CAPTURE_ITEM_PREFIX) {
        // The webview keeps running while hidden to the tray, so the frontend
        // capture bridge handles this event without restoring the window.
        let _ = app.emit(crate::screenshot_shortcuts::CAPTURE_EVENT, mode.to_string());
        return;
    }

    if let Some(connection_id) = id.strip_prefix(RECENT_ITEM_PREFIX) {
        restore_main_window(app);
        let _ = app.emit("kkterm://tray-open-connection", connection_id.to_string());
    }
}

fn toggle_dont_sleep<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(power) = app.try_state::<crate::power::DontSleepManager>() else {
        return;
    };
    let currently_enabled = power.is_enabled();

    match power.set_enabled(!currently_enabled) {
        Ok(enabled) => {
            if let Some(storage) = app.try_state::<crate::storage::Storage>() {
                if let Err(error) = storage.update_dont_sleep_enabled(enabled) {
                    eprintln!("failed to persist Don't Sleep tray toggle: {error}");
                }
            }
            if let Some(tray_state) = app.try_state::<TrayState>() {
                if let Err(error) = rebuild_menu(app, &tray_state) {
                    eprintln!("failed to refresh tray menu after Don't Sleep toggle: {error}");
                }
            }
            let _ = app.emit("kkterm://dont-sleep-changed", enabled);
        }
        Err(error) => {
            eprintln!("failed to toggle Don't Sleep from tray: {error}");
            let _ = app.emit("kkterm://dont-sleep-changed", currently_enabled);
        }
    }
}

pub fn restore_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(main_webview) = app.get_webview_window(crate::window_state::MAIN_WINDOW_LABEL) {
        let main_window = main_webview.as_ref().window();
        let was_minimized = main_window.is_minimized().unwrap_or(false);
        let unminimize_result = if was_minimized {
            main_window.unminimize().map(|_| "ok").unwrap_or("error")
        } else {
            "skipped"
        };
        let show_result = main_window.show().map(|_| "ok").unwrap_or("error");
        let recovery = crate::window_state::recover_if_offscreen(&main_window);
        set_owned_popups_visible(&main_window, true);
        let focus_result = main_window.set_focus().map(|_| "ok").unwrap_or("error");
        let recovery_result = recovery
            .map(|bounds| {
                format!(
                    "{}x{}@{},{}",
                    bounds.width, bounds.height, bounds.x, bounds.y
                )
            })
            .unwrap_or_else(|| "skipped".to_string());
        crate::debug_heartbeat::record_tray_event(format!(
            "restore:wasMinimized={was_minimized}:unminimize={unminimize_result}:show={show_result}:recover={recovery_result}:focus={focus_result}"
        ));
    } else {
        crate::debug_heartbeat::record_tray_event("restore:no-main-window");
    }
}

pub fn hide_minimized_window_if_enabled<R: tauri::Runtime>(window: &tauri::Window<R>) {
    let Some(tray_state) = window.try_state::<TrayState>() else {
        return;
    };

    if !tray_state.minimize_to_tray() || !window.is_minimized().unwrap_or(false) {
        return;
    }

    crate::debug_heartbeat::record_window_event("hide-minimized-to-tray");
    let _ = window.hide();
    set_owned_popups_visible(window, false);
}

/// Diverts the native title-bar close button to a hide-to-tray when minimize-to-tray is enabled.
/// When disabled, the close request is left untouched so the window quits natively. The tray
/// "Exit" item calls `app.exit(0)`, which never routes through `CloseRequested`, so quitting
/// always remains possible.
///
/// In both branches we synchronously hide every owned popup HWND (e.g. the RDP ActiveX host
/// window). Owned popups are not auto-hidden when their owner is hidden via `ShowWindow(SW_HIDE)`
/// (only when the owner is minimized), so without this the RDP pane lingers on screen after the
/// main window goes away.
pub fn hide_window_on_close_if_enabled<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    api: &tauri::CloseRequestApi,
) {
    set_owned_popups_visible(window, false);

    let Some(tray_state) = window.try_state::<TrayState>() else {
        return;
    };

    if !tray_state.minimize_to_tray() {
        return;
    }

    api.prevent_close();
    crate::debug_heartbeat::record_window_event("hide-close-to-tray");
    let _ = window.hide();
}

#[cfg(target_os = "windows")]
fn set_owned_popups_visible<R: tauri::Runtime>(window: &tauri::Window<R>, visible: bool) {
    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0);
    // ShowOwnedPopups walks the owner's owned-window list and sets/clears WS_VISIBLE on each.
    // It is purely a flag flip plus a paint message, so it is safe to call from the close-event
    // handler on the main thread.
    let _ = unsafe { ShowOwnedPopups(hwnd, visible) };
}

#[cfg(not(target_os = "windows"))]
fn set_owned_popups_visible<R: tauri::Runtime>(_window: &tauri::Window<R>, _visible: bool) {}

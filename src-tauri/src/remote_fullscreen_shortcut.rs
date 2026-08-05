//! Configurable full-screen toggle for RDP/VNC Sessions.
//!
//! This shortcut is registered natively so focused WebView-backed Sessions do
//! not depend on DOM keyboard delivery. Windows RDP ActiveX delegates its own
//! Ctrl+Alt+Break handling through the event sink in `rdp.rs`.

use std::str::FromStr;
use std::sync::{Mutex, OnceLock};

use tauri::Manager;
use tauri_plugin_global_shortcut::Shortcut;
#[cfg(not(target_os = "windows"))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Input::KeyboardAndMouse::{
            MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, RegisterHotKey, UnregisterHotKey, VK_CANCEL,
        },
        Shell::{DefSubclassProc, SetWindowSubclass},
        WindowsAndMessaging::WM_HOTKEY,
    },
};

#[cfg(target_os = "windows")]
use crate::window_state::MAIN_WINDOW_LABEL;
use crate::{rdp::RdpSessionManager, remote_fullscreen, storage::GeneralSettings};

const ACTION_ID: &str = "remoteFullscreen";
#[cfg(target_os = "windows")]
const WINDOWS_FULLSCREEN_HOTKEY_ID: i32 = 0x4B46;
#[cfg(target_os = "windows")]
const WINDOWS_FULLSCREEN_SUBCLASS_ID: usize = 0x4B4B_4653;

#[derive(Default)]
struct ShortcutRegistration {
    desired: Option<Shortcut>,
    registered: Option<Shortcut>,
}

static REGISTRATION: OnceLock<Mutex<ShortcutRegistration>> = OnceLock::new();
#[cfg(target_os = "windows")]
static WINDOWS_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
#[cfg(target_os = "windows")]
static WINDOWS_HANDLER_INSTALLED: OnceLock<()> = OnceLock::new();

fn registration() -> &'static Mutex<ShortcutRegistration> {
    REGISTRATION.get_or_init(|| Mutex::new(ShortcutRegistration::default()))
}

#[cfg(target_os = "windows")]
const DEFAULT_BINDING: &str = "Ctrl+Alt+Pause";
#[cfg(target_os = "macos")]
const DEFAULT_BINDING: &str = "Ctrl+Cmd+F";
#[cfg(target_os = "linux")]
const DEFAULT_BINDING: &str = "F11";

#[cfg(target_os = "windows")]
fn binding(settings: &GeneralSettings) -> Option<String> {
    // The ActiveX control owns this chord while its native full-screen HWND has
    // focus. Keep any persisted override intact for cross-platform settings,
    // but register the same fixed chord for entering from KKTerm's WebView.
    let _ = settings.workspace_shortcut_override(ACTION_ID);
    Some(DEFAULT_BINDING.to_string())
}

#[cfg(not(target_os = "windows"))]
fn binding(settings: &GeneralSettings) -> Option<String> {
    match settings.workspace_shortcut_override(ACTION_ID) {
        Some(binding) => binding.map(str::to_string),
        None => Some(DEFAULT_BINDING.to_string()),
    }
}

fn parse(accelerator: &str) -> Result<Shortcut, String> {
    Shortcut::from_str(accelerator).map_err(|_| {
        format!("the remote desktop full-screen shortcut '{accelerator}' is not valid")
    })
}

pub(crate) fn validate(settings: &GeneralSettings) -> Result<(), String> {
    if let Some(accelerator) = binding(settings) {
        parse(&accelerator)?;
    }
    Ok(())
}

pub(crate) fn apply(app: &tauri::AppHandle, settings: &GeneralSettings) -> Result<(), String> {
    let desired = binding(settings)
        .map(|accelerator| parse(&accelerator))
        .transpose()?;
    registration()
        .lock()
        .map_err(|_| "remote desktop full-screen shortcut state is unavailable".to_string())?
        .desired = desired;
    sync_focus(app)
}

fn handle_shortcut(app: &tauri::AppHandle) {
    if let Some(rdp_sessions) = app.try_state::<RdpSessionManager>() {
        match rdp_sessions.exit_active_fullscreen() {
            Ok(true) => return,
            Ok(false) => {}
            Err(error) => {
                eprintln!("failed to exit native RDP full screen: {error}");
            }
        }
    }
    remote_fullscreen::emit_toggle_shortcut(app);
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn windows_shortcut_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_HOTKEY && wparam.0 == WINDOWS_FULLSCREEN_HOTKEY_ID as usize {
        if let Some(app) = WINDOWS_APP_HANDLE.get() {
            handle_shortcut(app);
        }
        return LRESULT(0);
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn main_window_hwnd(app: &tauri::AppHandle) -> Result<HWND, String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window is not available for the full-screen shortcut".to_string())?;
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to get the main window handle: {error}"))?;
    Ok(HWND(hwnd.0))
}

#[cfg(target_os = "windows")]
fn install_windows_shortcut_handler(app: &tauri::AppHandle) -> Result<HWND, String> {
    let hwnd = main_window_hwnd(app)?;
    if WINDOWS_HANDLER_INSTALLED.get().is_some() {
        return Ok(hwnd);
    }
    let _ = WINDOWS_APP_HANDLE.set(app.clone());
    let installed = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(windows_shortcut_proc),
            WINDOWS_FULLSCREEN_SUBCLASS_ID,
            0,
        )
    };
    if !installed.as_bool() {
        return Err(format!(
            "failed to install the Windows full-screen shortcut handler: {}",
            std::io::Error::last_os_error()
        ));
    }
    let _ = WINDOWS_HANDLER_INSTALLED.set(());
    Ok(hwnd)
}

#[cfg(not(target_os = "windows"))]
fn sync_platform_registration(
    app: &tauri::AppHandle,
    previous: Option<Shortcut>,
    next: Option<Shortcut>,
) -> Result<(), String> {
    let manager = app.global_shortcut();
    let register = |shortcut| {
        manager.on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                handle_shortcut(app);
            }
        })
    };

    match (previous, next) {
        (Some(previous), Some(next)) => {
            register(next).map_err(|error| {
                format!("failed to register the remote desktop full-screen shortcut: {error}")
            })?;
            if let Err(error) = manager.unregister(previous) {
                let _ = manager.unregister(next);
                return Err(format!(
                    "failed to replace the remote desktop full-screen shortcut: {error}"
                ));
            }
        }
        (None, Some(next)) => {
            register(next).map_err(|error| {
                format!("failed to register the remote desktop full-screen shortcut: {error}")
            })?;
        }
        (Some(previous), None) => {
            manager.unregister(previous).map_err(|error| {
                format!("failed to unregister the remote desktop full-screen shortcut: {error}")
            })?;
        }
        (None, None) => {}
    }
    Ok(())
}

/// Windows reports the Break chord as `VK_CANCEL`, while accelerator parsers
/// map the physical Pause/Break key to `VK_PAUSE`. Register the actual virtual
/// key on KKTerm's HWND so a focused VNC canvas cannot forward the chord to the
/// server. Focused mstscax controls use `ContainerHandledFullScreen` instead.
#[cfg(target_os = "windows")]
fn sync_platform_registration(
    app: &tauri::AppHandle,
    previous: Option<Shortcut>,
    next: Option<Shortcut>,
) -> Result<(), String> {
    let hwnd = install_windows_shortcut_handler(app)?;
    match (previous.is_some(), next.is_some()) {
        (false, true) => {
            let modifiers = MOD_CONTROL | MOD_ALT | MOD_NOREPEAT;
            unsafe {
                RegisterHotKey(
                    Some(hwnd),
                    WINDOWS_FULLSCREEN_HOTKEY_ID,
                    modifiers,
                    u32::from(VK_CANCEL.0),
                )
            }
            .map_err(|error| {
                format!("failed to register Ctrl+Alt+Break for remote desktop full screen: {error}")
            })?;
        }
        (true, false) => {
            unsafe { UnregisterHotKey(Some(hwnd), WINDOWS_FULLSCREEN_HOTKEY_ID) }.map_err(
                |error| {
                    format!(
                        "failed to unregister Ctrl+Alt+Break for remote desktop full screen: {error}"
                    )
                },
            )?;
        }
        _ => {}
    }
    Ok(())
}

/// Register only while one of KKTerm's windows is focused. The native
/// registration is needed above Windows ActiveX airspace, but must not reserve
/// the platform binding while the user works in another app.
pub(crate) fn sync_focus(app: &tauri::AppHandle) -> Result<(), String> {
    let window_is_focused = app
        .webview_windows()
        .into_values()
        .any(|window| window.is_focused().unwrap_or(false));
    let native_rdp_is_fullscreen = match app.try_state::<RdpSessionManager>() {
        Some(rdp_sessions) => rdp_sessions.has_active_fullscreen()?,
        None => false,
    };
    let app_is_focused = window_is_focused || native_rdp_is_fullscreen;
    let mut state = registration()
        .lock()
        .map_err(|_| "remote desktop full-screen shortcut state is unavailable".to_string())?;
    let target = if app_is_focused { state.desired } else { None };
    if state.registered == target {
        return Ok(());
    }
    sync_platform_registration(app, state.registered, target)?;
    state.registered = target;
    Ok(())
}

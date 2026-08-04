//! Configurable full-screen toggle for RDP/VNC Sessions.
//!
//! This shortcut is registered natively because the Windows RDP ActiveX
//! control owns keyboard focus while a Session is visible. A DOM key handler
//! cannot reliably intercept Ctrl+Alt+Break before the remote host receives it.

use std::{
    str::FromStr,
    sync::{Mutex, OnceLock},
};

use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::{rdp::RdpSessionManager, remote_fullscreen, storage::GeneralSettings};

#[cfg(target_os = "windows")]
mod windows_break_hook {
    use std::sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    };

    use tauri::{AppHandle, Manager};
    use windows::Win32::{
        Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM},
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_MENU},
            WindowsAndMessaging::{
                CallNextHookEx, HC_ACTION, HHOOK, KBDLLHOOKSTRUCT, SetWindowsHookExW,
                WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
            },
        },
    };
    use windows::core::PCWSTR;

    use crate::{rdp::RdpSessionManager, remote_fullscreen};

    const VK_CANCEL_CODE: u32 = 0x03;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static ENABLED: AtomicBool = AtomicBool::new(false);
    static BREAK_DOWN: AtomicBool = AtomicBool::new(false);
    static HOOK: OnceLock<usize> = OnceLock::new();

    pub(super) fn install(app: &AppHandle) -> Result<(), String> {
        let _ = APP.set(app.clone());
        if HOOK.get().is_some() {
            return Ok(());
        }
        let module = unsafe { GetModuleHandleW(PCWSTR::null()) }.map_err(|error| {
            format!("failed to resolve the full-screen shortcut module: {error}")
        })?;
        let hook = unsafe {
            SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(hook_proc),
                Some(HINSTANCE(module.0)),
                0,
            )
        }
        .map_err(|error| format!("failed to install the Ctrl+Alt+Break hook: {error}"))?;
        let _ = HOOK.set(hook.0 as usize);
        Ok(())
    }

    pub(super) fn set_enabled(enabled: bool) {
        ENABLED.store(enabled, Ordering::Relaxed);
        if !enabled {
            BREAK_DOWN.store(false, Ordering::Relaxed);
        }
    }

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && ENABLED.load(Ordering::Relaxed) {
            let keyboard = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let is_key_down = wparam.0 == WM_KEYDOWN as usize || wparam.0 == WM_SYSKEYDOWN as usize;
            if keyboard.vkCode == VK_CANCEL_CODE && is_key_down {
                let ctrl_down = unsafe { GetAsyncKeyState(VK_CONTROL.0 as i32) } < 0;
                let alt_down = unsafe { GetAsyncKeyState(VK_MENU.0 as i32) } < 0;
                if ctrl_down && alt_down && !BREAK_DOWN.swap(true, Ordering::Relaxed) {
                    if let Some(app) = APP.get() {
                        let active_x_owns_shortcut = app
                            .try_state::<RdpSessionManager>()
                            .and_then(|sessions| sessions.has_active_fullscreen().ok())
                            .unwrap_or(false);
                        if !active_x_owns_shortcut {
                            remote_fullscreen::emit_toggle_shortcut(app);
                        }
                    }
                }
            } else if keyboard.vkCode == VK_CANCEL_CODE {
                BREAK_DOWN.store(false, Ordering::Relaxed);
            }
        }
        unsafe { CallNextHookEx(HHOOK::default(), code, wparam, lparam) }
    }
}

const ACTION_ID: &str = "remoteFullscreen";

#[derive(Default)]
struct ShortcutRegistration {
    desired: Option<Shortcut>,
    registered: Option<Shortcut>,
}

static REGISTRATION: OnceLock<Mutex<ShortcutRegistration>> = OnceLock::new();

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
    #[cfg(target_os = "windows")]
    windows_break_hook::install(app)?;
    sync_focus(app)
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
    #[cfg(target_os = "windows")]
    {
        // Ctrl changes Pause into the Win32 VK_CANCEL (Break) event, so a
        // RegisterHotKey(VK_PAUSE) registration cannot reliably see ActiveX's
        // fixed chord. Observe it without consuming it: mstscax retains its
        // built-in behavior and VNC follows the same local toggle route.
        windows_break_hook::set_enabled(app_is_focused);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let manager = app.global_shortcut();
        let mut state = registration()
            .lock()
            .map_err(|_| "remote desktop full-screen shortcut state is unavailable".to_string())?;
        let target = if app_is_focused { state.desired } else { None };
        if state.registered == target {
            return Ok(());
        }

        let register = |shortcut| {
            manager.on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
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
            })
        };

        match (state.registered, target) {
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
                state.registered = Some(next);
            }
            (None, Some(next)) => {
                register(next).map_err(|error| {
                    format!("failed to register the remote desktop full-screen shortcut: {error}")
                })?;
                state.registered = Some(next);
            }
            (Some(previous), None) => {
                manager.unregister(previous).map_err(|error| {
                    format!("failed to unregister the remote desktop full-screen shortcut: {error}")
                })?;
                state.registered = None;
            }
            (None, None) => {}
        }
        Ok(())
    }
}

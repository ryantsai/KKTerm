//! Configurable full-screen toggle for RDP/VNC Sessions.
//!
//! This shortcut is registered natively so focused WebView-backed Sessions do
//! not depend on DOM keyboard delivery. A focused Windows RDP ActiveX control
//! receives Ctrl+Alt+Break directly and delegates the request through its event
//! sink; WebView-backed Sessions use KKTerm's native hook route.

use std::str::FromStr;
#[cfg(target_os = "windows")]
use std::sync::TryLockError;
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[cfg(target_os = "windows")]
use serde_json::json;
use tauri::Manager;
use tauri_plugin_global_shortcut::Shortcut;
#[cfg(not(target_os = "windows"))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Shell::{DefSubclassProc, SetWindowSubclass},
        WindowsAndMessaging::{GetForegroundWindow, KillTimer, SetTimer, WM_ACTIVATEAPP, WM_TIMER},
    },
};

#[cfg(target_os = "windows")]
use crate::logging::rdp_debug;
#[cfg(target_os = "windows")]
use crate::window_state::MAIN_WINDOW_LABEL;
use crate::{
    rdp::{RdpFullscreenShortcutDispatch, RdpSessionManager},
    remote_fullscreen,
    storage::GeneralSettings,
};

#[cfg(target_os = "windows")]
mod windows_break_hook {
    use std::{
        sync::{
            Mutex, OnceLock,
            atomic::{AtomicBool, AtomicIsize, AtomicU8, AtomicU32, AtomicUsize, Ordering},
            mpsc,
        },
        thread,
        time::Duration,
    };

    use windows::Win32::Foundation::HWND;

    const VK_CANCEL_CODE: u32 = 0x03;
    const VK_PAUSE_CODE: u32 = 0x13;
    const VK_CONTROL_CODE: u32 = 0x11;
    const VK_LCONTROL_CODE: u32 = 0xA2;
    const VK_RCONTROL_CODE: u32 = 0xA3;
    const VK_MENU_CODE: u32 = 0x12;
    const VK_LMENU_CODE: u32 = 0xA4;
    const VK_RMENU_CODE: u32 = 0xA5;
    const CTRL_MASK: u32 = 0b0000_0111;
    const ALT_MASK: u32 = 0b0011_1000;
    const MODE_DISABLED: u8 = 0;
    const MODE_WEBVIEW_CONSUME: u8 = 1;
    const MODE_ACTIVEX_PASSTHROUGH: u8 = 2;
    const HOOK_START_TIMEOUT: Duration = Duration::from_secs(3);
    const HC_ACTION_CODE: i32 = 0;
    const WH_KEYBOARD_LL_CODE: i32 = 13;
    const WM_KEYDOWN_CODE: usize = 0x0100;
    const WM_KEYUP_CODE: usize = 0x0101;
    const WM_SYSKEYDOWN_CODE: usize = 0x0104;
    const WM_SYSKEYUP_CODE: usize = 0x0105;

    static INSTALL_LOCK: Mutex<()> = Mutex::new(());
    static HOOK_STARTED: OnceLock<()> = OnceLock::new();
    static APP_ACTIVE: AtomicBool = AtomicBool::new(true);
    static MODE: AtomicU8 = AtomicU8::new(MODE_DISABLED);
    static MODIFIER_STATE: AtomicU32 = AtomicU32::new(0);
    static BREAK_DOWN: AtomicBool = AtomicBool::new(false);
    static TARGET_HWND: AtomicIsize = AtomicIsize::new(0);
    static DIAGNOSTIC_POST_FAILURES: AtomicUsize = AtomicUsize::new(0);

    #[repr(C)]
    struct RawKeyboardHook {
        vk_code: u32,
        _scan_code: u32,
        _flags: u32,
        _time: u32,
        _extra_info: usize,
    }

    #[repr(C)]
    #[derive(Default)]
    struct RawMessage {
        _hwnd: isize,
        _message: u32,
        _wparam: usize,
        _lparam: isize,
        _time: u32,
        _point_x: i32,
        _point_y: i32,
        _private: u32,
    }

    type RawHookProc = unsafe extern "system" fn(i32, usize, isize) -> isize;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowsHookExW(
            kind: i32,
            callback: Option<RawHookProc>,
            module: isize,
            thread_id: u32,
        ) -> isize;
        fn CallNextHookEx(hook: isize, code: i32, wparam: usize, lparam: isize) -> isize;
        fn GetMessageW(message: *mut RawMessage, hwnd: isize, min: u32, max: u32) -> i32;
        fn TranslateMessage(message: *const RawMessage) -> i32;
        fn DispatchMessageW(message: *const RawMessage) -> isize;
        fn PostMessageW(hwnd: isize, message: u32, wparam: usize, lparam: isize) -> i32;
        fn UnhookWindowsHookEx(hook: isize) -> i32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetModuleHandleW(module_name: *const u16) -> isize;
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum HookAction {
        PassThrough,
        Consume,
        PostToggle,
    }

    impl HookAction {
        fn diagnostic_code(self) -> u8 {
            match self {
                Self::PassThrough => 0,
                Self::Consume => 1,
                Self::PostToggle => 2,
            }
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum HookPostOutcome {
        NotAttempted,
        Posted,
        PostFailed,
        StaleActivation,
    }

    impl HookPostOutcome {
        fn diagnostic_code(self) -> u8 {
            match self {
                Self::NotAttempted => 0,
                Self::Posted => 1,
                Self::PostFailed => 2,
                Self::StaleActivation => 3,
            }
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(super) struct HookDiagnostic {
        pub(super) vk_code: u8,
        pub(super) mode: u8,
        pub(super) action: u8,
        pub(super) key_down: bool,
        pub(super) key_up: bool,
        pub(super) modifiers: u8,
        pub(super) post_outcome: u8,
        pub(super) captured_generation: u32,
        pub(super) token: usize,
    }

    fn pack_diagnostic(diagnostic: HookDiagnostic) -> usize {
        let low = usize::from(diagnostic.vk_code)
            | (usize::from(diagnostic.mode & 0b11) << 8)
            | (usize::from(diagnostic.action & 0b11) << 10)
            | (usize::from(diagnostic.key_down) << 12)
            | (usize::from(diagnostic.key_up) << 13)
            | (usize::from(diagnostic.modifiers) << 16)
            | (usize::from(diagnostic.post_outcome & 0b1111) << 24);
        #[cfg(target_pointer_width = "64")]
        {
            low | ((diagnostic.captured_generation as usize) << 32)
        }
        #[cfg(target_pointer_width = "32")]
        {
            low
        }
    }

    pub(super) fn unpack_diagnostic(token: usize, packed: usize) -> HookDiagnostic {
        HookDiagnostic {
            vk_code: (packed & 0xff) as u8,
            mode: ((packed >> 8) & 0b11) as u8,
            action: ((packed >> 10) & 0b11) as u8,
            key_down: packed & (1 << 12) != 0,
            key_up: packed & (1 << 13) != 0,
            modifiers: ((packed >> 16) & 0xff) as u8,
            post_outcome: ((packed >> 24) & 0b1111) as u8,
            captured_generation: {
                #[cfg(target_pointer_width = "64")]
                {
                    (packed >> 32) as u32
                }
                #[cfg(target_pointer_width = "32")]
                {
                    0
                }
            },
            token,
        }
    }

    fn post_diagnostic(diagnostic: HookDiagnostic) {
        let posted = unsafe {
            PostMessageW(
                TARGET_HWND.load(Ordering::Acquire),
                super::WINDOWS_FULLSCREEN_HOOK_DIAGNOSTIC_MESSAGE,
                diagnostic.token,
                pack_diagnostic(diagnostic) as isize,
            )
        } != 0;
        if !posted {
            DIAGNOSTIC_POST_FAILURES.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub(super) fn take_diagnostic_post_failures() -> usize {
        DIAGNOSTIC_POST_FAILURES.swap(0, Ordering::AcqRel)
    }

    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    struct HookState {
        modifiers: u32,
        break_down: bool,
    }

    pub(super) fn install(hwnd: HWND) -> Result<(), String> {
        TARGET_HWND.store(hwnd.0 as isize, Ordering::Release);
        if HOOK_STARTED.get().is_some() {
            return Ok(());
        }
        let _install_guard = INSTALL_LOCK
            .lock()
            .map_err(|_| "Ctrl+Alt+Break hook installation state is unavailable".to_string())?;
        if HOOK_STARTED.get().is_some() {
            return Ok(());
        }

        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        thread::Builder::new()
            .name("kkterm-remote-fullscreen-hook".to_string())
            .spawn(move || hook_thread(ready_sender))
            .map_err(|error| format!("failed to start the Ctrl+Alt+Break hook thread: {error}"))?;
        ready_receiver
            .recv_timeout(HOOK_START_TIMEOUT)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => {
                    "Ctrl+Alt+Break hook thread did not become ready".to_string()
                }
                mpsc::RecvTimeoutError::Disconnected => {
                    "Ctrl+Alt+Break hook thread stopped before becoming ready".to_string()
                }
            })??;
        let _ = HOOK_STARTED.set(());
        Ok(())
    }

    fn hook_thread(ready_sender: mpsc::SyncSender<Result<(), String>>) {
        let module = unsafe { GetModuleHandleW(std::ptr::null()) };
        if module == 0 {
            let _ = ready_sender.send(Err(format!(
                "failed to resolve the Ctrl+Alt+Break hook module: {}",
                std::io::Error::last_os_error()
            )));
            return;
        }
        let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL_CODE, Some(hook_proc), module, 0) };
        if hook == 0 {
            let _ = ready_sender.send(Err(format!(
                "failed to install the Ctrl+Alt+Break hook: {}",
                std::io::Error::last_os_error()
            )));
            return;
        }
        if ready_sender.send(Ok(())).is_err() {
            unsafe {
                UnhookWindowsHookEx(hook);
            }
            return;
        }

        let mut message = RawMessage::default();
        loop {
            let result = unsafe { GetMessageW(&mut message, 0, 0, 0) };
            if result > 0 {
                unsafe {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            } else if result == 0 {
                break;
            } else {
                eprintln!(
                    "Ctrl+Alt+Break hook message loop failed: {}",
                    std::io::Error::last_os_error()
                );
                break;
            }
        }
        unsafe {
            UnhookWindowsHookEx(hook);
        }
    }

    pub(super) fn set_state(enabled: bool, active_x_owns_shortcut: bool) {
        // WM_ACTIVATEAPP suspends delivery without discarding the focused
        // surface mode. This lets the callback stay lock-free and restores the
        // correct mode immediately when KKTerm becomes active again.
        if !APP_ACTIVE.load(Ordering::Acquire) {
            return;
        }
        let mode = if !enabled {
            MODE_DISABLED
        } else if active_x_owns_shortcut {
            MODE_ACTIVEX_PASSTHROUGH
        } else {
            MODE_WEBVIEW_CONSUME
        };
        let previous = MODE.swap(mode, Ordering::AcqRel);
        if mode == MODE_DISABLED || mode != previous {
            BREAK_DOWN.store(false, Ordering::Release);
        }
    }

    pub(super) fn set_app_active(active: bool) {
        APP_ACTIVE.store(active, Ordering::Release);
        MODIFIER_STATE.store(0, Ordering::Release);
        BREAK_DOWN.store(false, Ordering::Release);
    }

    fn modifier_bit(vk_code: u32) -> u32 {
        match vk_code {
            VK_CONTROL_CODE => 0b0000_0001,
            VK_LCONTROL_CODE => 0b0000_0010,
            VK_RCONTROL_CODE => 0b0000_0100,
            VK_MENU_CODE => 0b0000_1000,
            VK_LMENU_CODE => 0b0001_0000,
            VK_RMENU_CODE => 0b0010_0000,
            _ => 0,
        }
    }

    fn advance_hook_state(
        mode: u8,
        mut state: HookState,
        vk_code: u32,
        is_key_down: bool,
        is_key_up: bool,
    ) -> (HookState, HookAction) {
        let modifier = modifier_bit(vk_code);
        if modifier != 0 {
            if is_key_down {
                state.modifiers |= modifier;
            } else if is_key_up {
                state.modifiers &= !modifier;
                state.break_down = false;
            }
            return (state, HookAction::PassThrough);
        }
        if vk_code != VK_CANCEL_CODE && vk_code != VK_PAUSE_CODE {
            return (state, HookAction::PassThrough);
        }
        if mode != MODE_WEBVIEW_CONSUME {
            if is_key_up {
                state.break_down = false;
            }
            return (state, HookAction::PassThrough);
        }

        let chord_down = state.modifiers & CTRL_MASK != 0 && state.modifiers & ALT_MASK != 0;
        if is_key_down && chord_down {
            if state.break_down {
                return (state, HookAction::Consume);
            }
            state.break_down = true;
            return (state, HookAction::PostToggle);
        }
        if is_key_up && state.break_down {
            state.break_down = false;
            return (state, HookAction::Consume);
        }
        (state, HookAction::PassThrough)
    }

    unsafe extern "system" fn hook_proc(code: i32, wparam: usize, lparam: isize) -> isize {
        if code == HC_ACTION_CODE && lparam != 0 {
            // Capture the activation epoch before the first active-state read.
            // An old callback that spans false -> true must not stamp its input
            // with the new epoch after KKTerm is reactivated.
            let generation = super::WINDOWS_SHORTCUT_GENERATION.load(Ordering::Acquire);
            if !APP_ACTIVE.load(Ordering::Acquire) {
                return unsafe { CallNextHookEx(0, code, wparam, lparam) };
            }
            let keyboard = unsafe { &*(lparam as *const RawKeyboardHook) };
            let is_key_down = wparam == WM_KEYDOWN_CODE || wparam == WM_SYSKEYDOWN_CODE;
            let is_key_up = wparam == WM_KEYUP_CODE || wparam == WM_SYSKEYUP_CODE;
            let state = HookState {
                modifiers: MODIFIER_STATE.load(Ordering::Acquire),
                break_down: BREAK_DOWN.load(Ordering::Acquire),
            };
            let mode = MODE.load(Ordering::Acquire);
            let (next_state, action) =
                advance_hook_state(mode, state, keyboard.vk_code, is_key_down, is_key_up);
            MODIFIER_STATE.store(next_state.modifiers, Ordering::Release);
            BREAK_DOWN.store(next_state.break_down, Ordering::Release);
            let is_break_key =
                keyboard.vk_code == VK_CANCEL_CODE || keyboard.vk_code == VK_PAUSE_CODE;
            match action {
                HookAction::Consume => {
                    if is_break_key {
                        post_diagnostic(HookDiagnostic {
                            vk_code: keyboard.vk_code as u8,
                            mode,
                            action: action.diagnostic_code(),
                            key_down: is_key_down,
                            key_up: is_key_up,
                            modifiers: next_state.modifiers as u8,
                            post_outcome: HookPostOutcome::NotAttempted.diagnostic_code(),
                            captured_generation: generation as u32,
                            token: 0,
                        });
                    }
                    return 1;
                }
                HookAction::PostToggle => {
                    let hwnd = TARGET_HWND.load(Ordering::Acquire);
                    // Pair the epoch read with one last active-state read. If
                    // deactivation wins after this check, it advances the epoch
                    // and the subclass rejects the posted message as stale.
                    if !APP_ACTIVE.load(Ordering::Acquire)
                        || super::WINDOWS_SHORTCUT_GENERATION.load(Ordering::Acquire) != generation
                    {
                        BREAK_DOWN.store(false, Ordering::Release);
                        post_diagnostic(HookDiagnostic {
                            vk_code: keyboard.vk_code as u8,
                            mode,
                            action: action.diagnostic_code(),
                            key_down: is_key_down,
                            key_up: is_key_up,
                            modifiers: next_state.modifiers as u8,
                            post_outcome: HookPostOutcome::StaleActivation.diagnostic_code(),
                            captured_generation: generation as u32,
                            token: 0,
                        });
                        return unsafe { CallNextHookEx(0, code, wparam, lparam) };
                    }
                    let token = super::WINDOWS_SHORTCUT_SEQUENCE.fetch_add(1, Ordering::AcqRel);
                    let posted = unsafe {
                        PostMessageW(
                            hwnd,
                            super::WINDOWS_FULLSCREEN_HOOK_MESSAGE,
                            generation,
                            token as isize,
                        )
                    } != 0;
                    post_diagnostic(HookDiagnostic {
                        vk_code: keyboard.vk_code as u8,
                        mode,
                        action: action.diagnostic_code(),
                        key_down: is_key_down,
                        key_up: is_key_up,
                        modifiers: next_state.modifiers as u8,
                        post_outcome: if posted {
                            HookPostOutcome::Posted.diagnostic_code()
                        } else {
                            HookPostOutcome::PostFailed.diagnostic_code()
                        },
                        captured_generation: generation as u32,
                        token,
                    });
                    if posted {
                        return 1;
                    }
                    BREAK_DOWN.store(false, Ordering::Release);
                }
                HookAction::PassThrough => {
                    if is_break_key {
                        post_diagnostic(HookDiagnostic {
                            vk_code: keyboard.vk_code as u8,
                            mode,
                            action: action.diagnostic_code(),
                            key_down: is_key_down,
                            key_up: is_key_up,
                            modifiers: next_state.modifiers as u8,
                            post_outcome: HookPostOutcome::NotAttempted.diagnostic_code(),
                            captured_generation: generation as u32,
                            token: 0,
                        });
                    }
                }
            }
        }
        unsafe { CallNextHookEx(0, code, wparam, lparam) }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn key_down(mode: u8, state: HookState, vk_code: u32) -> (HookState, HookAction) {
            advance_hook_state(mode, state, vk_code, true, false)
        }

        fn key_up(mode: u8, state: HookState, vk_code: u32) -> (HookState, HookAction) {
            advance_hook_state(mode, state, vk_code, false, true)
        }

        fn ctrl_alt_state(mode: u8) -> HookState {
            let (state, _) = key_down(mode, HookState::default(), VK_LCONTROL_CODE);
            key_down(mode, state, VK_LMENU_CODE).0
        }

        #[test]
        fn webview_posts_physical_break_once_and_consumes_its_release() {
            let state = ctrl_alt_state(MODE_WEBVIEW_CONSUME);
            let (state, action) = key_down(MODE_WEBVIEW_CONSUME, state, VK_CANCEL_CODE);
            assert_eq!(action, HookAction::PostToggle);
            let (state, action) = key_down(MODE_WEBVIEW_CONSUME, state, VK_CANCEL_CODE);
            assert_eq!(action, HookAction::Consume);
            let (state, action) = key_up(MODE_WEBVIEW_CONSUME, state, VK_CANCEL_CODE);
            assert_eq!(action, HookAction::Consume);
            assert!(!state.break_down);
        }

        #[test]
        fn pause_is_a_compatibility_fallback_for_webview_sessions() {
            let state = ctrl_alt_state(MODE_WEBVIEW_CONSUME);
            let (_, action) = key_down(MODE_WEBVIEW_CONSUME, state, VK_PAUSE_CODE);
            assert_eq!(action, HookAction::PostToggle);
        }

        #[test]
        fn activex_and_disabled_modes_pass_the_chord_through() {
            for mode in [MODE_ACTIVEX_PASSTHROUGH, MODE_DISABLED] {
                let state = ctrl_alt_state(mode);
                let (_, action) = key_down(mode, state, VK_CANCEL_CODE);
                assert_eq!(action, HookAction::PassThrough);
            }
        }

        #[test]
        fn wrong_modifiers_pass_through_and_modifier_release_resets_latch() {
            let (_state, action) =
                key_down(MODE_WEBVIEW_CONSUME, HookState::default(), VK_CANCEL_CODE);
            assert_eq!(action, HookAction::PassThrough);
            let state = ctrl_alt_state(MODE_WEBVIEW_CONSUME);
            let (state, _) = key_down(MODE_WEBVIEW_CONSUME, state, VK_CANCEL_CODE);
            let (state, action) = key_up(MODE_WEBVIEW_CONSUME, state, VK_LCONTROL_CODE);
            assert_eq!(action, HookAction::PassThrough);
            assert!(!state.break_down);
        }

        #[test]
        fn hook_diagnostic_pack_round_trips_dispatch_evidence() {
            let diagnostic = HookDiagnostic {
                vk_code: VK_CANCEL_CODE as u8,
                mode: MODE_WEBVIEW_CONSUME,
                action: HookAction::PostToggle.diagnostic_code(),
                key_down: true,
                key_up: false,
                modifiers: (CTRL_MASK | ALT_MASK) as u8,
                post_outcome: HookPostOutcome::Posted.diagnostic_code(),
                captured_generation: 0x1234_5678,
                token: 42,
            };

            let unpacked = unpack_diagnostic(diagnostic.token, pack_diagnostic(diagnostic));
            #[cfg(target_pointer_width = "64")]
            assert_eq!(unpacked, diagnostic);
            #[cfg(target_pointer_width = "32")]
            assert_eq!(
                unpacked,
                HookDiagnostic {
                    captured_generation: 0,
                    ..diagnostic
                }
            );
        }
    }
}

const ACTION_ID: &str = "remoteFullscreen";
const STARTUP_FOCUS_RECHECK_DELAY: Duration = Duration::from_secs(2);
#[cfg(target_os = "windows")]
const WINDOWS_FULLSCREEN_HOOK_MESSAGE: u32 = 0x8000 + 0x4B;
#[cfg(target_os = "windows")]
const WINDOWS_FULLSCREEN_HOOK_DIAGNOSTIC_MESSAGE: u32 = 0x8000 + 0x4C;
#[cfg(target_os = "windows")]
const WINDOWS_FULLSCREEN_SUBCLASS_ID: usize = 0x4B4B_4653;
#[cfg(target_os = "windows")]
const WINDOWS_SHORTCUT_RETRY_TIMER_ID: usize = 0x4B4B_4654;
#[cfg(target_os = "windows")]
const WINDOWS_ACTIVATION_RETRY_TIMER_ID: usize = 0x4B4B_4655;
#[cfg(target_os = "windows")]
const WINDOWS_FOCUS_RETRY_TIMER_ID: usize = 0x4B4B_4656;
#[cfg(target_os = "windows")]
const WINDOWS_RETRY_INTERVAL_MS: u32 = 25;

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
#[cfg(target_os = "windows")]
static WINDOWS_APP_ACTIVE: AtomicBool = AtomicBool::new(true);
#[cfg(target_os = "windows")]
static WINDOWS_SHORTCUT_GENERATION: AtomicUsize = AtomicUsize::new(1);
#[cfg(target_os = "windows")]
static WINDOWS_SHORTCUT_SEQUENCE: AtomicUsize = AtomicUsize::new(1);
#[cfg(target_os = "windows")]
static WINDOWS_PENDING_SHORTCUT_GENERATION: AtomicUsize = AtomicUsize::new(0);
#[cfg(target_os = "windows")]
static WINDOWS_PENDING_SHORTCUT_TOKEN: AtomicUsize = AtomicUsize::new(0);
#[cfg(target_os = "windows")]
static WINDOWS_LATEST_SHORTCUT_TOKEN: AtomicUsize = AtomicUsize::new(0);

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
    // Match the ActiveX control's fixed native chord. Keep any persisted
    // override intact for cross-platform settings, but register the Windows
    // binding while a KKTerm remote surface owns focus.
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
    #[cfg(not(target_os = "windows"))]
    sync_focus(app)?;

    // The initial setup callback can finish before the main WebView reports
    // itself focused. Recheck once after startup so the shortcut does not wait
    // for the user to leave KKTerm and focus it again.
    schedule_focus_recheck(app);
    Ok(())
}

pub(crate) fn schedule_focus_recheck(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_FOCUS_RECHECK_DELAY).await;
        #[cfg(target_os = "windows")]
        {
            let main_thread_app = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                let result = (|| {
                    let hwnd = install_windows_shortcut_handler(&main_thread_app)?;
                    windows_break_hook::install(hwnd)?;
                    sync_focus(&main_thread_app)
                })();
                if let Err(error) = result {
                    eprintln!(
                        "failed to recheck remote desktop full-screen shortcut focus: {error}"
                    );
                }
            }) {
                eprintln!(
                    "failed to schedule remote desktop full-screen shortcut focus recheck: {error}"
                );
            }
        }
        #[cfg(not(target_os = "windows"))]
        if let Err(error) = sync_focus(&app) {
            eprintln!("failed to recheck remote desktop full-screen shortcut focus: {error}");
        }
    });
}

/// Queue an immediate focus-mode refresh after a native-surface transition.
/// Callers use a separate main-thread task so any RDP Session lock owned by the
/// preceding transition has already been released before focus is inspected.
#[cfg(target_os = "windows")]
pub(crate) fn schedule_focus_sync(app: &tauri::AppHandle) {
    let main_thread_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Err(error) = sync_focus(&main_thread_app) {
            eprintln!("failed to refresh remote desktop full-screen focus mode: {error}");
        }
    }) {
        eprintln!("failed to schedule remote desktop full-screen focus refresh: {error}");
    }
}

fn try_handle_shortcut(
    app: &tauri::AppHandle,
    generation: usize,
    token: usize,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    if !shortcut_dispatch_token_is_current(generation, token) {
        // A posted chord can remain queued after WM_ACTIVATEAPP(false). Never
        // run either ActiveX FullScreen setter while KKTerm is in background.
        return Ok(true);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (generation, token);
    if let Some(rdp_sessions) = app.try_state::<RdpSessionManager>() {
        #[cfg(target_os = "windows")]
        let dispatch = rdp_sessions.try_toggle_foreground_fullscreen(|| {
            shortcut_dispatch_token_is_current(generation, token)
        })?;
        #[cfg(not(target_os = "windows"))]
        let dispatch = rdp_sessions.try_toggle_foreground_fullscreen()?;
        match dispatch {
            RdpFullscreenShortcutDispatch::Handled => return Ok(true),
            RdpFullscreenShortcutDispatch::Busy => return Ok(false),
            RdpFullscreenShortcutDispatch::NotApplicable => {}
        }
    }
    #[cfg(target_os = "windows")]
    if !shortcut_dispatch_token_is_current(generation, token) {
        return Ok(true);
    }
    remote_fullscreen::emit_toggle_shortcut(app);
    Ok(true)
}

#[cfg(not(target_os = "windows"))]
fn handle_shortcut(app: &tauri::AppHandle) {
    if let Err(error) = try_handle_shortcut(app, 0, 0) {
        eprintln!("failed to toggle remote desktop full screen: {error}");
    }
}

#[cfg(target_os = "windows")]
fn set_retry_timer(hwnd: HWND, timer_id: usize) -> bool {
    let installed = unsafe { SetTimer(Some(hwnd), timer_id, WINDOWS_RETRY_INTERVAL_MS, None) };
    if installed == 0 {
        eprintln!(
            "failed to schedule remote desktop full-screen retry: {}",
            std::io::Error::last_os_error()
        );
    }
    installed != 0
}

#[cfg(target_os = "windows")]
fn clear_retry_timer(hwnd: HWND, timer_id: usize) {
    let _ = unsafe { KillTimer(Some(hwnd), timer_id) };
}

#[cfg(target_os = "windows")]
fn shortcut_dispatch_is_current(generation: usize) -> bool {
    generation != 0
        && WINDOWS_APP_ACTIVE.load(Ordering::Acquire)
        && WINDOWS_SHORTCUT_GENERATION.load(Ordering::Acquire) == generation
}

#[cfg(target_os = "windows")]
pub(crate) fn windows_activation_generation() -> usize {
    WINDOWS_SHORTCUT_GENERATION.load(Ordering::Acquire)
}

#[cfg(target_os = "windows")]
pub(crate) fn windows_activation_generation_is_current(generation: usize) -> bool {
    shortcut_dispatch_is_current(generation)
}

#[cfg(target_os = "windows")]
fn shortcut_dispatch_token_is_current(generation: usize, token: usize) -> bool {
    token != 0
        && shortcut_dispatch_is_current(generation)
        && WINDOWS_LATEST_SHORTCUT_TOKEN.load(Ordering::Acquire) == token
}

#[cfg(target_os = "windows")]
fn begin_shortcut_retry(generation: usize, token: usize) {
    WINDOWS_PENDING_SHORTCUT_GENERATION.store(generation, Ordering::Release);
    WINDOWS_PENDING_SHORTCUT_TOKEN.store(token, Ordering::Release);
}

#[cfg(target_os = "windows")]
fn finish_shortcut_retry(hwnd: HWND, token: usize) {
    if WINDOWS_PENDING_SHORTCUT_TOKEN
        .compare_exchange(token, 0, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        WINDOWS_PENDING_SHORTCUT_GENERATION.store(0, Ordering::Release);
        clear_retry_timer(hwnd, WINDOWS_SHORTCUT_RETRY_TIMER_ID);
    }
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
    if msg == WINDOWS_FULLSCREEN_HOOK_DIAGNOSTIC_MESSAGE {
        let diagnostic = windows_break_hook::unpack_diagnostic(wparam.0, lparam.0 as usize);
        let current_generation = WINDOWS_SHORTCUT_GENERATION.load(Ordering::Acquire);
        rdp_debug(
            "fullscreen.shortcut.hook_input",
            &json!({
                "vkCode": diagnostic.vk_code,
                "mode": match diagnostic.mode {
                    1 => "webviewConsume",
                    2 => "activeXPassThrough",
                    _ => "disabled",
                },
                "action": match diagnostic.action {
                    1 => "consume",
                    2 => "postToggle",
                    _ => "passThrough",
                },
                "keyDown": diagnostic.key_down,
                "keyUp": diagnostic.key_up,
                "modifierMask": diagnostic.modifiers,
                "postOutcome": match diagnostic.post_outcome {
                    1 => "posted",
                    2 => "postFailed",
                    3 => "staleActivation",
                    _ => "notAttempted",
                },
                "capturedGeneration": diagnostic.captured_generation,
                "dispatchSequence": diagnostic.token,
                "appActive": WINDOWS_APP_ACTIVE.load(Ordering::Acquire),
                "currentGeneration": current_generation,
                "generationMatchesCurrent": diagnostic.captured_generation as usize
                    == current_generation,
                "diagnosticPostFailures": windows_break_hook::take_diagnostic_post_failures(),
            }),
        );
        return LRESULT(0);
    }
    if msg == WINDOWS_FULLSCREEN_HOOK_MESSAGE {
        let generation = wparam.0;
        let token = lparam.0 as usize;
        rdp_debug(
            "fullscreen.shortcut.dispatch_received",
            &json!({
                "generation": generation,
                "dispatchSequence": token,
                "appActive": WINDOWS_APP_ACTIVE.load(Ordering::Acquire),
                "currentGeneration": WINDOWS_SHORTCUT_GENERATION.load(Ordering::Acquire),
            }),
        );
        if token == 0 || !shortcut_dispatch_is_current(generation) {
            return LRESULT(0);
        }
        // A new chord supersedes an older retry. Do not publish this token as
        // retryable until try_handle_shortcut actually reports Busy; otherwise
        // a stale queued WM_TIMER could dispatch the in-flight chord twice.
        WINDOWS_LATEST_SHORTCUT_TOKEN.store(token, Ordering::Release);
        WINDOWS_PENDING_SHORTCUT_TOKEN.store(0, Ordering::Release);
        WINDOWS_PENDING_SHORTCUT_GENERATION.store(0, Ordering::Release);
        clear_retry_timer(hwnd, WINDOWS_SHORTCUT_RETRY_TIMER_ID);
        if let Some(app) = WINDOWS_APP_HANDLE.get() {
            match try_handle_shortcut(app, generation, token) {
                Ok(true) => finish_shortcut_retry(hwnd, token),
                Ok(false) => {
                    if shortcut_dispatch_is_current(generation)
                        && WINDOWS_LATEST_SHORTCUT_TOKEN.load(Ordering::Acquire) == token
                    {
                        begin_shortcut_retry(generation, token);
                        if !set_retry_timer(hwnd, WINDOWS_SHORTCUT_RETRY_TIMER_ID) {
                            finish_shortcut_retry(hwnd, token);
                        }
                    }
                }
                Err(error) => {
                    finish_shortcut_retry(hwnd, token);
                    eprintln!("failed to toggle remote desktop full screen: {error}");
                }
            }
        } else {
            finish_shortcut_retry(hwnd, token);
        }
        return LRESULT(0);
    }
    if msg == WM_TIMER && wparam.0 == WINDOWS_SHORTCUT_RETRY_TIMER_ID {
        let generation = WINDOWS_PENDING_SHORTCUT_GENERATION.load(Ordering::Acquire);
        let token = WINDOWS_PENDING_SHORTCUT_TOKEN.load(Ordering::Acquire);
        if token == 0
            || WINDOWS_LATEST_SHORTCUT_TOKEN.load(Ordering::Acquire) != token
            || !shortcut_dispatch_is_current(generation)
        {
            WINDOWS_PENDING_SHORTCUT_TOKEN.store(0, Ordering::Release);
            WINDOWS_PENDING_SHORTCUT_GENERATION.store(0, Ordering::Release);
            clear_retry_timer(hwnd, WINDOWS_SHORTCUT_RETRY_TIMER_ID);
            return LRESULT(0);
        }
        if let Some(app) = WINDOWS_APP_HANDLE.get() {
            match try_handle_shortcut(app, generation, token) {
                Ok(true) => finish_shortcut_retry(hwnd, token),
                Ok(false) => {}
                Err(error) => {
                    finish_shortcut_retry(hwnd, token);
                    eprintln!("failed to retry remote desktop full-screen toggle: {error}");
                }
            }
        } else {
            finish_shortcut_retry(hwnd, token);
        }
        return LRESULT(0);
    }
    if msg == WM_TIMER && wparam.0 == WINDOWS_ACTIVATION_RETRY_TIMER_ID {
        let completed = match WINDOWS_APP_HANDLE
            .get()
            .and_then(|app| app.try_state::<RdpSessionManager>())
        {
            Some(rdp_sessions) => match rdp_sessions
                .try_sync_fullscreen_z_order(WINDOWS_APP_ACTIVE.load(Ordering::Acquire))
            {
                Ok(completed) => completed,
                Err(error) => {
                    eprintln!("failed to retry RDP full-screen activation: {error}");
                    true
                }
            },
            None => true,
        };
        if completed {
            clear_retry_timer(hwnd, WINDOWS_ACTIVATION_RETRY_TIMER_ID);
        }
        return LRESULT(0);
    }
    if msg == WM_TIMER && wparam.0 == WINDOWS_FOCUS_RETRY_TIMER_ID {
        let completed = match WINDOWS_APP_HANDLE.get() {
            Some(app) => match try_sync_focus(app) {
                Ok(completed) => completed,
                Err(error) => {
                    eprintln!("failed to retry remote desktop full-screen focus state: {error}");
                    true
                }
            },
            None => true,
        };
        if completed {
            clear_retry_timer(hwnd, WINDOWS_FOCUS_RETRY_TIMER_ID);
        }
        return LRESULT(0);
    }
    if msg == WM_ACTIVATEAPP {
        let app_is_active = wparam.0 != 0;
        if app_is_active {
            // Advance the epoch before publishing active=true. A hook callback
            // that began in the inactive interval must remain stale.
            WINDOWS_SHORTCUT_GENERATION.fetch_add(1, Ordering::AcqRel);
            WINDOWS_APP_ACTIVE.store(true, Ordering::Release);
            windows_break_hook::set_app_active(true);
        } else {
            // Publish inactive before advancing the epoch. A hook callback that
            // already captured the old epoch either observes inactive or posts
            // a message that the new epoch rejects.
            WINDOWS_APP_ACTIVE.store(false, Ordering::Release);
            windows_break_hook::set_app_active(false);
            WINDOWS_SHORTCUT_GENERATION.fetch_add(1, Ordering::AcqRel);
            WINDOWS_LATEST_SHORTCUT_TOKEN.store(0, Ordering::Release);
            WINDOWS_PENDING_SHORTCUT_TOKEN.store(0, Ordering::Release);
            WINDOWS_PENDING_SHORTCUT_GENERATION.store(0, Ordering::Release);
            clear_retry_timer(hwnd, WINDOWS_SHORTCUT_RETRY_TIMER_ID);
        }
        // ActiveX can pump this message while the UI thread already holds the
        // Session mutex. Keep the normal path nonblocking; errors are reported
        // only after the try-lock guard has been released. Reactivation routes
        // through focus sync because it also restores the hook mode and z-order.
        if app_is_active {
            clear_retry_timer(hwnd, WINDOWS_ACTIVATION_RETRY_TIMER_ID);
            if let Some(app) = WINDOWS_APP_HANDLE.get() {
                match try_sync_focus(app) {
                    Ok(true) => clear_retry_timer(hwnd, WINDOWS_FOCUS_RETRY_TIMER_ID),
                    Ok(false) => {
                        let _ = set_retry_timer(hwnd, WINDOWS_FOCUS_RETRY_TIMER_ID);
                    }
                    Err(error) => {
                        clear_retry_timer(hwnd, WINDOWS_FOCUS_RETRY_TIMER_ID);
                        eprintln!("failed to refresh remote desktop full-screen focus: {error}");
                    }
                }
            }
        } else {
            clear_retry_timer(hwnd, WINDOWS_FOCUS_RETRY_TIMER_ID);
            if let Some(app) = WINDOWS_APP_HANDLE.get()
                && let Some(rdp_sessions) = app.try_state::<RdpSessionManager>()
            {
                match rdp_sessions.try_sync_fullscreen_z_order(false) {
                    Ok(true) => clear_retry_timer(hwnd, WINDOWS_ACTIVATION_RETRY_TIMER_ID),
                    Ok(false) => {
                        let _ = set_retry_timer(hwnd, WINDOWS_ACTIVATION_RETRY_TIMER_ID);
                    }
                    Err(error) => {
                        clear_retry_timer(hwnd, WINDOWS_ACTIVATION_RETRY_TIMER_ID);
                        eprintln!("failed to update RDP full-screen activation: {error}");
                    }
                }
            }
        }
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
    rdp_debug(
        "fullscreen.shortcut.handler_installed",
        &json!({ "hwnd": format!("0x{:x}", hwnd.0 as usize) }),
    );
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

/// Keep one low-level hook on a dedicated Win32 message-pump thread for the
/// process lifetime. Focus changes only toggle its atomics. The startup recheck
/// owns initial installation so the main HWND's subclass is ready before hook
/// callbacks can post toggle requests to it.
#[cfg(target_os = "windows")]
fn sync_platform_registration(
    app: &tauri::AppHandle,
    _previous: Option<Shortcut>,
    _next: Option<Shortcut>,
) -> Result<(), String> {
    if WINDOWS_HANDLER_INSTALLED.get().is_none() {
        return Ok(());
    }
    let hwnd = install_windows_shortcut_handler(app)?;
    windows_break_hook::install(hwnd)
}

/// Keep shortcut delivery active only while a KKTerm WebView or native RDP
/// surface owns focus. Windows atomically gates its process-lifetime hook;
/// macOS and Linux register or unregister their shortcut as focus changes.
#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
fn log_focus_state(
    status: &str,
    reason: Option<&str>,
    foreground: HWND,
    window_is_focused: bool,
    native_rdp_owns_focus: Option<bool>,
    active_x_owns_shortcut: Option<bool>,
    app_active: bool,
    app_is_focused: Option<bool>,
    hook_enabled: Option<bool>,
    z_order_completed: Option<bool>,
) {
    rdp_debug(
        "fullscreen.shortcut.focus_state",
        &json!({
            "status": status,
            "reason": reason,
            "foregroundHwnd": format!("0x{:x}", foreground.0 as usize),
            "windowIsFocused": window_is_focused,
            "nativeRdpOwnsFocus": native_rdp_owns_focus,
            "activeXOwnsShortcut": active_x_owns_shortcut,
            "appActive": app_active,
            "appIsFocused": app_is_focused,
            "hookEnabled": hook_enabled,
            "zOrderCompleted": z_order_completed,
        }),
    );
}

#[cfg(target_os = "windows")]
fn try_sync_focus(app: &tauri::AppHandle) -> Result<bool, String> {
    let foreground = unsafe { GetForegroundWindow() };
    let window_is_focused = app
        .webview_windows()
        .into_values()
        .any(|window| window.hwnd().is_ok_and(|hwnd| HWND(hwnd.0) == foreground));
    let app_active = WINDOWS_APP_ACTIVE.load(Ordering::Acquire);
    let (native_rdp_owns_focus, active_x_owns_shortcut) = match app.try_state::<RdpSessionManager>()
    {
        Some(rdp_sessions) => match rdp_sessions.try_shortcut_focus_state()? {
            Some(state) => state,
            None => {
                log_focus_state(
                    "deferred",
                    Some("rdpSessionBusy"),
                    foreground,
                    window_is_focused,
                    None,
                    None,
                    app_active,
                    None,
                    None,
                    None,
                );
                return Ok(false);
            }
        },
        None => (false, false),
    };
    let app_is_focused = app_active && (window_is_focused || native_rdp_owns_focus);
    let mut state = match registration().try_lock() {
        Ok(state) => state,
        Err(TryLockError::WouldBlock) => {
            log_focus_state(
                "deferred",
                Some("registrationBusy"),
                foreground,
                window_is_focused,
                Some(native_rdp_owns_focus),
                Some(active_x_owns_shortcut),
                app_active,
                Some(app_is_focused),
                None,
                None,
            );
            return Ok(false);
        }
        Err(TryLockError::Poisoned(_)) => {
            return Err("remote desktop full-screen shortcut state is unavailable".to_string());
        }
    };
    let target = if app_is_focused { state.desired } else { None };
    let enabled = target.is_some();
    windows_break_hook::set_state(target.is_some(), active_x_owns_shortcut);
    if state.registered != target {
        sync_platform_registration(app, state.registered, target)?;
        state.registered = target;
    }
    drop(state);
    if let Some(rdp_sessions) = app.try_state::<RdpSessionManager>()
        && !rdp_sessions.try_sync_fullscreen_z_order(app_is_focused)?
    {
        log_focus_state(
            "deferred",
            Some("zOrderBusy"),
            foreground,
            window_is_focused,
            Some(native_rdp_owns_focus),
            Some(active_x_owns_shortcut),
            app_active,
            Some(app_is_focused),
            Some(enabled),
            Some(false),
        );
        return Ok(false);
    }
    log_focus_state(
        "complete",
        None,
        foreground,
        window_is_focused,
        Some(native_rdp_owns_focus),
        Some(active_x_owns_shortcut),
        app_active,
        Some(app_is_focused),
        Some(enabled),
        Some(true),
    );
    Ok(true)
}

#[cfg(target_os = "windows")]
pub(crate) fn sync_focus(app: &tauri::AppHandle) -> Result<(), String> {
    let completed = try_sync_focus(app)?;
    if WINDOWS_HANDLER_INSTALLED.get().is_some() {
        let hwnd = main_window_hwnd(app)?;
        if completed {
            clear_retry_timer(hwnd, WINDOWS_FOCUS_RETRY_TIMER_ID);
        } else {
            let _ = set_retry_timer(hwnd, WINDOWS_FOCUS_RETRY_TIMER_ID);
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn sync_focus(app: &tauri::AppHandle) -> Result<(), String> {
    let window_is_focused = app
        .webview_windows()
        .into_values()
        .any(|window| window.is_focused().unwrap_or(false));
    let native_rdp_is_fullscreen = match app.try_state::<RdpSessionManager>() {
        Some(rdp_sessions) => rdp_sessions.has_active_fullscreen()?,
        None => false,
    };
    let native_rdp_owns_focus = false;
    let app_is_focused = window_is_focused || native_rdp_is_fullscreen || native_rdp_owns_focus;
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

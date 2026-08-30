use std::sync::Mutex;

use tauri::State;

pub const STORE_TRIAL_STATUS_EVENT: &str = "kkterm://store-trial-status";

#[derive(Default)]
pub struct StoreLicenseState {
    trial_expired: Mutex<Option<bool>>,
}

#[tauri::command]
pub fn get_store_trial_expired(state: State<'_, StoreLicenseState>) -> Option<bool> {
    state.trial_expired.lock().ok().and_then(|status| *status)
}

#[cfg(target_os = "windows")]
pub fn start(app: tauri::AppHandle) {
    use tauri::Manager;

    if !crate::app_paths::updates_managed_by_platform_store() {
        return;
    }
    let Some(owner_hwnd) = app
        .get_webview_window(crate::window_state::MAIN_WINDOW_LABEL)
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as isize)
    else {
        eprintln!("failed to start Microsoft Store license check: main window is unavailable");
        return;
    };
    if let Err(error) = std::thread::Builder::new()
        .name("kkterm-store-license".into())
        .spawn(move || windows_license::run(app, owner_hwnd))
    {
        eprintln!("failed to start Microsoft Store license check: {error}");
    }
}

#[cfg(not(target_os = "windows"))]
pub fn start(_app: tauri::AppHandle) {}

#[cfg(target_os = "windows")]
mod windows_license {
    use std::time::{SystemTime, UNIX_EPOCH};

    use tauri::{Emitter, Manager};
    use windows::Services::Store::{StoreAppLicense, StoreContext};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
    use windows::Win32::UI::Shell::IInitializeWithWindow;
    use windows::core::Interface;

    use super::{STORE_TRIAL_STATUS_EVENT, StoreLicenseState};

    const WINDOWS_TO_UNIX_EPOCH_SECONDS: u64 = 11_644_473_600;
    const TICKS_PER_SECOND: u128 = 10_000_000;

    struct WinRtGuard(bool);

    impl Drop for WinRtGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { RoUninitialize() };
            }
        }
    }

    pub fn run(app: tauri::AppHandle, owner_hwnd: isize) {
        let _winrt = WinRtGuard(unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_ok());
        let context = match StoreContext::GetDefault() {
            Ok(context) => context,
            Err(error) => {
                eprintln!("failed to initialize Microsoft Store license context: {error}");
                return;
            }
        };
        let initialize_with_window = match context.cast::<IInitializeWithWindow>() {
            Ok(initialize_with_window) => initialize_with_window,
            Err(error) => {
                eprintln!("failed to configure Microsoft Store license window owner: {error}");
                return;
            }
        };
        if let Err(error) = unsafe { initialize_with_window.Initialize(HWND(owner_hwnd as *mut _)) }
        {
            eprintln!("failed to initialize Microsoft Store license window owner: {error}");
            return;
        }

        match query_trial_expired(&context) {
            Ok(expired) => publish_if_changed(&app, expired),
            Err(error) => eprintln!("Microsoft Store license check failed: {error}"),
        }
    }

    fn query_trial_expired(context: &StoreContext) -> windows::core::Result<bool> {
        let license = context.GetAppLicenseAsync()?.join()?;
        trial_expired_at(&license, windows_now_ticks())
    }

    fn trial_expired_at(license: &StoreAppLicense, now_ticks: i64) -> windows::core::Result<bool> {
        let is_trial = license.IsTrial()?;
        if !is_trial {
            return Ok(false);
        }
        Ok(trial_has_expired(
            license.IsActive()?,
            license.ExpirationDate()?.UniversalTime,
            now_ticks,
        ))
    }

    fn trial_has_expired(is_active: bool, expiration_ticks: i64, now_ticks: i64) -> bool {
        !is_active || now_ticks >= expiration_ticks
    }

    fn windows_now_ticks() -> i64 {
        let unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let seconds = u128::from(WINDOWS_TO_UNIX_EPOCH_SECONDS) + u128::from(unix.as_secs());
        let ticks = seconds
            .saturating_mul(TICKS_PER_SECOND)
            .saturating_add(u128::from(unix.subsec_nanos() / 100));
        i64::try_from(ticks).unwrap_or(i64::MAX)
    }

    fn publish_if_changed(app: &tauri::AppHandle, expired: bool) {
        let state = app.state::<StoreLicenseState>();
        let changed = match state.trial_expired.lock() {
            Ok(mut current) if *current != Some(expired) => {
                *current = Some(expired);
                true
            }
            _ => false,
        };
        if changed {
            let _ = app.emit(STORE_TRIAL_STATUS_EVENT, expired);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{TICKS_PER_SECOND, WINDOWS_TO_UNIX_EPOCH_SECONDS, trial_has_expired};

        #[test]
        fn windows_epoch_conversion_matches_unix_epoch() {
            assert_eq!(
                u128::from(WINDOWS_TO_UNIX_EPOCH_SECONDS) * TICKS_PER_SECOND,
                116_444_736_000_000_000
            );
        }

        #[test]
        fn trial_expires_at_utc_deadline_even_while_store_still_reports_active() {
            assert!(trial_has_expired(true, 20, 20));
            assert!(!trial_has_expired(true, 20, 19));
        }

        #[test]
        fn inactive_trial_is_expired_before_cached_deadline() {
            assert!(trial_has_expired(false, 20, 19));
        }
    }
}

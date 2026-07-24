use serde::Serialize;
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const WARNING_WINDOW_LABEL: &str = "shutdown-warning";
const WARNING_WINDOW_ROUTE: &str = "index.html#/shutdown-warning";
const FINAL_WARNING_SECONDS: u64 = 60;
const ALLOWED_DELAYS_MINUTES: [u64; 7] = [15, 30, 60, 120, 240, 480, 1_440];

pub const CHANGED_EVENT: &str = "kkterm://shutdown-timer-changed";
pub const SCHEDULED_EVENT: &str = "kkterm://shutdown-timer-scheduled";
pub const CANCELLED_EVENT: &str = "kkterm://shutdown-timer-cancelled";
pub const ERROR_EVENT: &str = "kkterm://shutdown-timer-error";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShutdownTimerPhase {
    Scheduled,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownTimerStatus {
    pub phase: ShutdownTimerPhase,
    pub scheduled_for_unix_ms: u64,
    pub shutdown_at_unix_ms: u64,
}

struct ShutdownTimerState {
    generation: u64,
    status: Option<ShutdownTimerStatus>,
    cancel_tx: Option<mpsc::Sender<()>>,
}

pub struct ShutdownTimerManager {
    app: AppHandle,
    state: Arc<Mutex<ShutdownTimerState>>,
}

impl ShutdownTimerManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            state: Arc::new(Mutex::new(ShutdownTimerState {
                generation: 0,
                status: None,
                cancel_tx: None,
            })),
        }
    }

    pub fn status(&self) -> Option<ShutdownTimerStatus> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.status.clone())
    }

    pub fn schedule(&self, delay_minutes: u64) -> Result<ShutdownTimerStatus, String> {
        validate_delay(delay_minutes)?;
        let now_ms = unix_time_ms()?;
        let scheduled_for_unix_ms = now_ms
            .checked_add(
                delay_minutes
                    .checked_mul(60_000)
                    .ok_or_else(|| "shutdown delay is too large".to_string())?,
            )
            .ok_or_else(|| "shutdown deadline is too large".to_string())?;
        let shutdown_at_unix_ms = scheduled_for_unix_ms
            .checked_add(FINAL_WARNING_SECONDS * 1_000)
            .ok_or_else(|| "shutdown deadline is too large".to_string())?;
        let status = ShutdownTimerStatus {
            phase: ShutdownTimerPhase::Scheduled,
            scheduled_for_unix_ms,
            shutdown_at_unix_ms,
        };
        let (cancel_tx, cancel_rx) = mpsc::channel();

        let generation = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "shutdown timer state is unavailable".to_string())?;
            if let Some(previous_cancel) = state.cancel_tx.take() {
                let _ = previous_cancel.send(());
            }
            state.generation = state.generation.wrapping_add(1);
            state.status = Some(status.clone());
            state.cancel_tx = Some(cancel_tx);
            state.generation
        };

        close_warning_window(&self.app);
        emit_status(&self.app, Some(status.clone()));
        let _ = self.app.emit(SCHEDULED_EVENT, status.clone());

        let app = self.app.clone();
        let state = Arc::clone(&self.state);
        thread::Builder::new()
            .name("KKTerm shutdown timer".to_string())
            .spawn(move || {
                run_timer_worker(app, state, generation, status, cancel_rx);
            })
            .map_err(|error| {
                clear_if_current(&self.app, &self.state, generation);
                format!("failed to start shutdown timer: {error}")
            })?;

        Ok(self.status().unwrap_or(ShutdownTimerStatus {
            phase: ShutdownTimerPhase::Scheduled,
            scheduled_for_unix_ms,
            shutdown_at_unix_ms,
        }))
    }

    pub fn cancel(&self) -> Result<bool, String> {
        let cancel_tx = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "shutdown timer state is unavailable".to_string())?;
            if state.status.is_none() {
                return Ok(false);
            }
            state.generation = state.generation.wrapping_add(1);
            state.status = None;
            state.cancel_tx.take()
        };

        if let Some(cancel_tx) = cancel_tx {
            let _ = cancel_tx.send(());
        }
        close_warning_window(&self.app);
        emit_status(&self.app, None);
        let _ = self.app.emit(CANCELLED_EVENT, ());
        Ok(true)
    }
}

fn validate_delay(delay_minutes: u64) -> Result<(), String> {
    if ALLOWED_DELAYS_MINUTES.contains(&delay_minutes) {
        Ok(())
    } else {
        Err("unsupported shutdown timer duration".to_string())
    }
}

fn run_timer_worker(
    app: AppHandle,
    state: Arc<Mutex<ShutdownTimerState>>,
    generation: u64,
    mut status: ShutdownTimerStatus,
    cancel_rx: mpsc::Receiver<()>,
) {
    if wait_until(status.scheduled_for_unix_ms, &cancel_rx) {
        return;
    }

    status.phase = ShutdownTimerPhase::Warning;
    if !update_if_current(&app, &state, generation, status.clone()) {
        return;
    }
    if let Err(error) = show_warning_window(&app) {
        fail_if_current(&app, &state, generation, error);
        return;
    }

    if wait_until(status.shutdown_at_unix_ms, &cancel_rx) {
        return;
    }
    if !take_if_current(&app, &state, generation) {
        return;
    }

    if let Err(error) = platform::force_shutdown() {
        close_warning_window(&app);
        let _ = app.emit(ERROR_EVENT, error);
    }
}

/// Returns true when the timer was cancelled. The wall-clock comparison makes
/// an expired timer advance immediately after the machine resumes from sleep.
fn wait_until(deadline_unix_ms: u64, cancel_rx: &mpsc::Receiver<()>) -> bool {
    loop {
        let now_ms = unix_time_ms().unwrap_or(deadline_unix_ms);
        if now_ms >= deadline_unix_ms {
            return false;
        }
        let remaining = Duration::from_millis(deadline_unix_ms - now_ms);
        let poll = remaining.min(Duration::from_secs(1));
        match cancel_rx.recv_timeout(poll) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => return true,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

fn unix_time_ms() -> Result<u64, String> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock is before the Unix epoch: {error}"))?;
    u64::try_from(elapsed.as_millis()).map_err(|_| "system clock value is too large".to_string())
}

fn update_if_current(
    app: &AppHandle,
    shared: &Arc<Mutex<ShutdownTimerState>>,
    generation: u64,
    status: ShutdownTimerStatus,
) -> bool {
    let updated = shared.lock().is_ok_and(|mut state| {
        if state.generation != generation || state.status.is_none() {
            return false;
        }
        state.status = Some(status.clone());
        true
    });
    if updated {
        emit_status(app, Some(status));
    }
    updated
}

fn take_if_current(
    app: &AppHandle,
    shared: &Arc<Mutex<ShutdownTimerState>>,
    generation: u64,
) -> bool {
    let taken = shared.lock().is_ok_and(|mut state| {
        if state.generation != generation || state.status.is_none() {
            return false;
        }
        state.status = None;
        state.cancel_tx = None;
        true
    });
    if taken {
        emit_status(app, None);
    }
    taken
}

fn clear_if_current(app: &AppHandle, shared: &Arc<Mutex<ShutdownTimerState>>, generation: u64) {
    if take_if_current(app, shared, generation) {
        close_warning_window(app);
    }
}

fn fail_if_current(
    app: &AppHandle,
    shared: &Arc<Mutex<ShutdownTimerState>>,
    generation: u64,
    error: String,
) {
    if take_if_current(app, shared, generation) {
        close_warning_window(app);
        let _ = app.emit(ERROR_EVENT, error);
    }
}

fn emit_status(app: &AppHandle, status: Option<ShutdownTimerStatus>) {
    let _ = app.emit(CHANGED_EVENT, status);
}

fn show_warning_window(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(WARNING_WINDOW_LABEL) {
        existing
            .show()
            .map_err(|error| format!("failed to show shutdown warning: {error}"))?;
        let _ = existing.set_focus();
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        WARNING_WINDOW_LABEL,
        WebviewUrl::App(WARNING_WINDOW_ROUTE.into()),
    )
    .title("KKTerm")
    .inner_size(420.0, 190.0)
    .min_inner_size(360.0, 170.0)
    .center()
    .always_on_top(true)
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .skip_taskbar(false)
    .visible(false)
    .build()
    .map_err(|error| format!("failed to create shutdown warning: {error}"))?;

    window
        .show()
        .map_err(|error| format!("failed to show shutdown warning: {error}"))?;
    let _ = window.set_focus();
    Ok(())
}

fn close_warning_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WARNING_WINDOW_LABEL) {
        let _ = window.close();
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    pub fn force_shutdown() -> Result<(), String> {
        let status = Command::new("shutdown.exe")
            .args(["/s", "/f", "/t", "0"])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|error| format!("failed to start Windows shutdown: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("Windows shutdown failed with status {status}"))
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::process::Command;

    pub fn force_shutdown() -> Result<(), String> {
        // System Events sends macOS's kAEShutDown Apple event. This follows the
        // logged-in user session and does not require a root shell.
        let status = Command::new("/usr/bin/osascript")
            .args(["-e", "tell application \"System Events\" to shut down"])
            .status()
            .map_err(|error| format!("failed to request macOS shutdown: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "macOS shutdown request failed with status {status}"
            ))
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use zbus::blocking::Connection;

    const LOGIN1_DESTINATION: &str = "org.freedesktop.login1";
    const LOGIN1_PATH: &str = "/org/freedesktop/login1";
    const LOGIN1_MANAGER: &str = "org.freedesktop.login1.Manager";
    const SD_LOGIND_SKIP_INHIBITORS: u64 = 1 << 4;

    pub fn force_shutdown() -> Result<(), String> {
        let connection = Connection::system()
            .map_err(|error| format!("failed to connect to the system D-Bus: {error}"))?;

        // systemd 257+ exposes the explicit force-style flag. Older supported
        // distributions fall back to PowerOff(true), which retains interactive
        // PolicyKit authorization instead of requiring a privileged shell.
        if connection
            .call_method(
                Some(LOGIN1_DESTINATION),
                LOGIN1_PATH,
                Some(LOGIN1_MANAGER),
                "PowerOffWithFlags",
                &(SD_LOGIND_SKIP_INHIBITORS,),
            )
            .is_ok()
        {
            return Ok(());
        }

        connection
            .call_method(
                Some(LOGIN1_DESTINATION),
                LOGIN1_PATH,
                Some(LOGIN1_MANAGER),
                "PowerOff",
                &(true,),
            )
            .map(|_| ())
            .map_err(|error| format!("failed to request Linux shutdown: {error}"))
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod platform {
    pub fn force_shutdown() -> Result<(), String> {
        Err("scheduled shutdown is not available on this platform".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_menu_exposed_delays() {
        for delay in ALLOWED_DELAYS_MINUTES {
            assert!(validate_delay(delay).is_ok(), "{delay} should be accepted");
        }
        for delay in [0, 14, 31, 59, 61, 1_441] {
            assert!(validate_delay(delay).is_err(), "{delay} should be rejected");
        }
    }

    #[test]
    fn wait_until_observes_cancellation() {
        let (tx, rx) = mpsc::channel();
        tx.send(()).expect("send cancellation");
        assert!(wait_until(u64::MAX, &rx));
    }

    #[test]
    fn wait_until_returns_immediately_for_elapsed_deadline() {
        assert!(!wait_until(0, &mpsc::channel().1));
    }
}

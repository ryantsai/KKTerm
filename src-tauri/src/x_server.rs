use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

const VCXSRV_EXE: &str = "vcxsrv.exe";
const DEFAULT_VCXSRV_ARGS: &str = "-multiwindow -clipboard -wgl";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
static MANAGED_VCXSRV_PID: AtomicU32 = AtomicU32::new(0);
static VCXSRV_KNOWN_RUNNING: AtomicBool = AtomicBool::new(false);
// Launch/stop are check-then-act over one shared OS process; callers run
// concurrently (async commands and session startup), so control must be
// serialized or two launches can each pass the running check and spawn.
static VCXSRV_CONTROL_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn control_lock() -> std::sync::MutexGuard<'static, ()> {
    VCXSRV_CONTROL_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XServerLaunchResult {
    pub started: bool,
    pub already_running: bool,
    pub executable_path: Option<String>,
    pub display: u16,
}

pub fn launch_vcxsrv_if_needed(
    path_override: Option<&str>,
    display: u16,
    extra_args: Option<&str>,
) -> Result<XServerLaunchResult, String> {
    let _guard = control_lock();
    let display = display.min(99);
    if VCXSRV_KNOWN_RUNNING.load(Ordering::Relaxed) {
        return Ok(XServerLaunchResult {
            started: false,
            already_running: true,
            executable_path: None,
            display,
        });
    }

    if is_vcxsrv_running() {
        VCXSRV_KNOWN_RUNNING.store(true, Ordering::Relaxed);
        return Ok(XServerLaunchResult {
            started: false,
            already_running: true,
            executable_path: None,
            display,
        });
    }

    let path_override = path_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let exe = resolve_vcxsrv_path(path_override)?;
    let args = vcxsrv_launch_args(display, extra_args);
    let mut command = Command::new(&exe);
    command.args(args);
    no_window(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("failed to launch VcXsrv: {error}"))?;
    MANAGED_VCXSRV_PID.store(child.id(), Ordering::Relaxed);
    VCXSRV_KNOWN_RUNNING.store(true, Ordering::Relaxed);

    Ok(XServerLaunchResult {
        started: true,
        already_running: false,
        executable_path: Some(exe.to_string_lossy().into_owned()),
        display,
    })
}

pub fn restart_vcxsrv(
    path_override: Option<&str>,
    display: u16,
    extra_args: Option<&str>,
) -> Result<XServerLaunchResult, String> {
    let _guard = control_lock();
    stop_vcxsrv_locked()?;
    launch_vcxsrv(path_override, display, extra_args)
}

pub fn stop_vcxsrv() -> Result<(), String> {
    let _guard = control_lock();
    stop_vcxsrv_locked()
}

fn stop_vcxsrv_locked() -> Result<(), String> {
    if !is_vcxsrv_running() {
        VCXSRV_KNOWN_RUNNING.store(false, Ordering::Relaxed);
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("taskkill");
        command.args(["/IM", VCXSRV_EXE, "/T"]);
        no_window(&mut command);
        let status = command
            .status()
            .map_err(|error| format!("failed to stop VcXsrv: {error}"))?;
        if status.success() {
            MANAGED_VCXSRV_PID.store(0, Ordering::Relaxed);
            VCXSRV_KNOWN_RUNNING.store(false, Ordering::Relaxed);
            Ok(())
        } else {
            Err(format!(
                "failed to stop VcXsrv: taskkill exited with status {status}"
            ))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

pub fn stop_managed_vcxsrv_on_exit() -> Result<(), String> {
    let _guard = control_lock();
    let pid = MANAGED_VCXSRV_PID.swap(0, Ordering::Relaxed);
    if pid == 0 {
        return Ok(());
    }

    stop_vcxsrv_pid(pid)
}

pub fn is_vcxsrv_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("tasklist");
        command.args(["/FI", "IMAGENAME eq vcxsrv.exe", "/NH"]);
        no_window(&mut command);
        let Ok(output) = command.output() else {
            return false;
        };
        if !output.status.success() {
            return false;
        }
        let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
        let running = stdout.contains(VCXSRV_EXE);
        if running {
            VCXSRV_KNOWN_RUNNING.store(true, Ordering::Relaxed);
        }
        running
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

fn launch_vcxsrv(
    path_override: Option<&str>,
    display: u16,
    extra_args: Option<&str>,
) -> Result<XServerLaunchResult, String> {
    let display = display.min(99);
    let path_override = path_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let exe = resolve_vcxsrv_path(path_override)?;
    let args = vcxsrv_launch_args(display, extra_args);
    let mut command = Command::new(&exe);
    command.args(args);
    no_window(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("failed to launch VcXsrv: {error}"))?;
    MANAGED_VCXSRV_PID.store(child.id(), Ordering::Relaxed);
    VCXSRV_KNOWN_RUNNING.store(true, Ordering::Relaxed);

    Ok(XServerLaunchResult {
        started: true,
        already_running: false,
        executable_path: Some(exe.to_string_lossy().into_owned()),
        display,
    })
}

fn resolve_vcxsrv_path(path_override: Option<PathBuf>) -> Result<PathBuf, String> {
    vcxsrv_candidate_paths(path_override)
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "VcXsrv was not found. Install it from Install Helper or set the VcXsrv path in SSH settings.".to_string())
}

fn vcxsrv_candidate_paths(path_override: Option<PathBuf>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(path) = path_override {
        paths.push(path);
    }
    paths.push(PathBuf::from(r"C:\Program Files\VcXsrv\vcxsrv.exe"));
    paths.push(PathBuf::from(r"C:\Program Files (x86)\VcXsrv\vcxsrv.exe"));
    if let Some(program_files) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
        paths.push(program_files.join("VcXsrv").join(VCXSRV_EXE));
    }
    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from) {
        paths.push(program_files_x86.join("VcXsrv").join(VCXSRV_EXE));
    }
    dedupe_paths(paths)
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for path in paths {
        if !out.iter().any(|existing| existing == &path) {
            out.push(path);
        }
    }
    out
}

fn vcxsrv_launch_args(display: u16, extra_args: Option<&str>) -> Vec<String> {
    let mut args = vec![format!(":{}", display.min(99))];
    let rest = extra_args
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_VCXSRV_ARGS);
    args.extend(rest.split_whitespace().map(str::to_string));
    args
}

fn no_window(_command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        _command.creation_flags(CREATE_NO_WINDOW);
    }
}

#[cfg(target_os = "windows")]
fn stop_vcxsrv_pid(pid: u32) -> Result<(), String> {
    let mut command = Command::new("taskkill");
    command.args(["/PID", &pid.to_string(), "/T"]);
    no_window(&mut command);
    let status = command
        .status()
        .map_err(|error| format!("failed to stop managed VcXsrv: {error}"))?;
    if status.success() {
        VCXSRV_KNOWN_RUNNING.store(false, Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!(
            "failed to stop managed VcXsrv: taskkill exited with status {status}"
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn stop_vcxsrv_pid(_pid: u32) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn managed_vcxsrv_cleanup_is_noop_when_kkterm_did_not_launch_it() {
        MANAGED_VCXSRV_PID.store(0, Ordering::Relaxed);

        stop_managed_vcxsrv_on_exit().expect("cleanup should be a no-op");

        assert_eq!(MANAGED_VCXSRV_PID.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn known_running_vcxsrv_skips_process_status_probe() {
        VCXSRV_KNOWN_RUNNING.store(true, Ordering::Relaxed);

        let result = launch_vcxsrv_if_needed(None, 4, None)
            .expect("known running server should not require resolving VcXsrv");

        assert!(!result.started);
        assert!(result.already_running);
        assert_eq!(result.display, 4);
        VCXSRV_KNOWN_RUNNING.store(false, Ordering::Relaxed);
    }

    #[test]
    fn vcxsrv_default_args_use_local_display_multiwindow_and_clipboard() {
        let args = vcxsrv_launch_args(0, None);

        assert_eq!(args, vec![":0", "-multiwindow", "-clipboard", "-wgl"]);
    }

    #[test]
    fn vcxsrv_custom_args_split_shell_words_after_display() {
        let args = vcxsrv_launch_args(2, Some("-multiwindow -clipboard -nowgl"));

        assert_eq!(args, vec![":2", "-multiwindow", "-clipboard", "-nowgl"]);
    }

    #[test]
    fn vcxsrv_candidates_prefer_user_path_then_standard_installs() {
        let user_path = PathBuf::from(r"C:\Tools\VcXsrv\vcxsrv.exe");
        let candidates = vcxsrv_candidate_paths(Some(user_path.clone()));

        assert_eq!(candidates.first(), Some(&user_path));
        assert!(candidates.contains(&PathBuf::from(r"C:\Program Files\VcXsrv\vcxsrv.exe")));
        assert!(candidates.contains(&PathBuf::from(r"C:\Program Files (x86)\VcXsrv\vcxsrv.exe")));
    }
}

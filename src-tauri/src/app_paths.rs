use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub use crate::portable_marker::PORTABLE_MARKER_FILENAME;
#[cfg(any(debug_assertions, test))]
const PORTABLE_ENVIRONMENT_VARIABLE: &str = "KKTERM_PORTABLE";
const PORTABLE_SMOKE_ENVIRONMENT_VARIABLE: &str = "KKTERM_PORTABLE_SMOKE_TEST";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppMode {
    Installed,
    Portable,
}

#[derive(Clone, Debug)]
pub struct LaunchContext {
    mode: AppMode,
    exe_dir: PathBuf,
    portable_data_dir: Option<PathBuf>,
}

impl LaunchContext {
    pub fn detect() -> Result<Self, String> {
        let exe_path = std::env::current_exe()
            .map_err(|error| format!("failed to resolve KKTerm executable path: {error}"))?;
        Self::detect_from_executable(&exe_path, development_mode_override()?)
    }

    fn detect_from_executable(
        exe_path: &Path,
        forced_mode: Option<AppMode>,
    ) -> Result<Self, String> {
        let exe_dir = exe_path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "failed to resolve KKTerm executable folder".to_string())?;

        #[cfg(not(target_os = "windows"))]
        if forced_mode == Some(AppMode::Portable) {
            return Err("portable mode is currently supported only on Windows".to_string());
        }

        #[cfg(target_os = "windows")]
        let marker_present = exe_dir.join(PORTABLE_MARKER_FILENAME).is_file();
        #[cfg(not(target_os = "windows"))]
        let marker_present = false;

        let mode = forced_mode.unwrap_or(if marker_present {
            AppMode::Portable
        } else {
            AppMode::Installed
        });

        if mode == AppMode::Portable {
            let data_dir = exe_dir.join("data");
            prepare_portable_data_dir(&exe_dir, &data_dir)?;
            return Ok(Self {
                mode,
                exe_dir,
                portable_data_dir: Some(data_dir),
            });
        }

        if forced_mode.is_none() && exe_dir.join("data").join("kkterm.sqlite3").is_file() {
            return Err(format!(
                "portable data exists beside KKTerm, but {} is missing; restore the marker or move the portable data before starting KKTerm",
                PORTABLE_MARKER_FILENAME
            ));
        }

        Ok(Self {
            mode,
            exe_dir,
            portable_data_dir: None,
        })
    }

    pub fn is_portable(&self) -> bool {
        self.mode == AppMode::Portable
    }

    pub fn portable_logs_dir(&self) -> Option<PathBuf> {
        self.portable_data_dir
            .as_ref()
            .map(|data_dir| data_dir.join("logs"))
    }

    pub fn portable_data_dir(&self) -> Option<&Path> {
        self.portable_data_dir.as_deref()
    }

    pub fn portable_webview_data_dir(&self) -> Option<PathBuf> {
        self.portable_data_dir
            .as_ref()
            .map(|data_dir| data_dir.join("webview"))
    }
}

#[derive(Clone, Debug)]
pub struct AppPaths {
    mode: AppMode,
    data_dir: PathBuf,
    cache_dir: PathBuf,
    media_dir: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppModeInfo {
    mode: AppMode,
    data_dir: String,
}

impl AppPaths {
    #[cfg(test)]
    pub(crate) fn for_test(data_dir: PathBuf) -> Self {
        Self {
            mode: AppMode::Installed,
            cache_dir: data_dir.join("cache"),
            media_dir: data_dir.clone(),
            data_dir,
        }
    }

    pub fn resolve(app: &AppHandle, launch: &LaunchContext) -> Result<Self, String> {
        if let Some(data_dir) = launch.portable_data_dir.as_ref() {
            return Ok(Self {
                mode: AppMode::Portable,
                data_dir: data_dir.clone(),
                cache_dir: data_dir.join("cache"),
                media_dir: data_dir.clone(),
            });
        }

        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("failed to resolve app cache directory: {error}"))?;
        #[cfg(target_os = "windows")]
        let media_dir = launch.exe_dir.clone();
        #[cfg(not(target_os = "windows"))]
        let media_dir = data_dir.clone();

        Ok(Self {
            mode: AppMode::Installed,
            data_dir,
            cache_dir,
            media_dir,
        })
    }

    pub fn is_portable(&self) -> bool {
        self.mode == AppMode::Portable
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn media_dir(&self) -> &Path {
        &self.media_dir
    }

    pub fn mode_info(&self) -> AppModeInfo {
        AppModeInfo {
            mode: self.mode,
            data_dir: self.data_dir.display().to_string(),
        }
    }
}

#[tauri::command]
pub fn get_app_mode(paths: tauri::State<'_, AppPaths>) -> AppModeInfo {
    paths.mode_info()
}

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(paths) = app.try_state::<AppPaths>() {
        return Ok(paths.data_dir().to_path_buf());
    }
    app.path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))
}

pub fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(paths) = app.try_state::<AppPaths>() {
        return Ok(paths.cache_dir().to_path_buf());
    }
    app.path()
        .app_cache_dir()
        .map_err(|error| format!("failed to resolve app cache directory: {error}"))
}

#[cfg(target_os = "windows")]
pub fn start_portable_smoke_test_if_requested(app: &AppHandle) -> Result<(), String> {
    let Some(paths) = app.try_state::<AppPaths>() else {
        return Ok(());
    };
    if !paths.is_portable()
        || std::env::var(PORTABLE_SMOKE_ENVIRONMENT_VARIABLE).as_deref() != Ok("1")
    {
        return Ok(());
    }

    for resource in [
        "manual/INDEX.md",
        "assistant-skills/terminal-command-planner/SKILL.md",
    ] {
        let resolved = app
            .path()
            .resolve(resource, tauri::path::BaseDirectory::Resource)
            .map_err(|error| format!("failed to resolve portable resource {resource}: {error}"))?;
        if !resolved.is_file() {
            return Err(format!(
                "portable resource is missing at {}",
                resolved.display()
            ));
        }
    }

    fs::write(
        paths.data_dir().join("portable-smoke-ready"),
        b"resources-ok\n",
    )
    .map_err(|error| format!("failed to write portable smoke readiness marker: {error}"))?;

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(12));
        app.exit(0);
    });
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn start_portable_smoke_test_if_requested(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

pub fn media_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(paths) = app.try_state::<AppPaths>() {
        return Ok(paths.media_dir().to_path_buf());
    }

    #[cfg(target_os = "windows")]
    {
        let exe_path = std::env::current_exe()
            .map_err(|error| format!("failed to resolve app executable path: {error}"))?;
        return exe_path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "failed to resolve app executable folder".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        data_dir(app)
    }
}

fn development_mode_override() -> Result<Option<AppMode>, String> {
    #[cfg(any(debug_assertions, test))]
    {
        let Some(value) = std::env::var_os(PORTABLE_ENVIRONMENT_VARIABLE) else {
            return Ok(None);
        };
        return match value.to_string_lossy().trim() {
            "1" => Ok(Some(AppMode::Portable)),
            "0" => Ok(Some(AppMode::Installed)),
            _ => Err(format!(
                "{} must be 0 or 1 in development builds",
                PORTABLE_ENVIRONMENT_VARIABLE
            )),
        };
    }

    #[cfg(not(any(debug_assertions, test)))]
    {
        Ok(None)
    }
}

pub(crate) fn prepare_portable_data_dir(exe_dir: &Path, data_dir: &Path) -> Result<(), String> {
    if portable_root_is_remote(exe_dir) {
        return Err(
            "portable mode does not support network shares or mapped network drives; move KKTerm to a writable local or removable drive"
                .to_string(),
        );
    }

    fs::create_dir_all(data_dir).map_err(|error| {
        format!(
            "failed to create portable data directory {}: {error}",
            data_dir.display()
        )
    })?;

    let probe_path = data_dir.join(format!(
        ".kkterm-write-probe-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let probe_result = (|| -> std::io::Result<()> {
        let mut probe = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&probe_path)?;
        probe.write_all(b"KKTerm portable write probe")?;
        probe.sync_all()?;
        drop(probe);
        fs::remove_file(&probe_path)
    })();
    if let Err(error) = probe_result {
        let _ = fs::remove_file(&probe_path);
        return Err(format!(
            "portable data directory {} is not writable: {error}; move KKTerm to a writable local or removable drive",
            data_dir.display()
        ));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn portable_root_is_remote(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Component, Prefix};
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;

    const DRIVE_REMOTE_TYPE: u32 = 4;

    let root = match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::UNC(_, _) | Prefix::VerbatimUNC(_, _) => return true,
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                format!("{}:\\", letter as char)
            }
            _ => return false,
        },
        _ => return false,
    };
    let wide = std::ffi::OsStr::new(&root)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    unsafe { GetDriveTypeW(wide.as_ptr()) == DRIVE_REMOTE_TYPE }
}

#[cfg(not(target_os = "windows"))]
fn portable_root_is_remote(_path: &Path) -> bool {
    false
}

pub fn show_startup_error(message: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};

        let title = std::ffi::OsStr::new("KKTerm portable startup error")
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let body = std::ffi::OsStr::new(message)
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                body.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    eprintln!("KKTerm startup error: {message}");
}

#[cfg(target_os = "windows")]
pub fn webview2_runtime_available() -> bool {
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    use windows_core::{PCWSTR, PWSTR};

    let mut version = PWSTR::null();
    let result =
        unsafe { GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut version) };
    if result.is_err() {
        return false;
    }
    !webview2_com::take_pwstr(version).trim().is_empty()
}

#[cfg(target_os = "windows")]
pub fn show_webview2_required_error() {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::{
        Shell::ShellExecuteW,
        WindowsAndMessaging::{IDYES, MB_ICONERROR, MB_YESNO, MessageBoxW, SW_SHOWNORMAL},
    };

    let encode = |value: &str| {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    let title = encode("Microsoft Edge WebView2 is required");
    let body = encode(
        "KKTerm Portable needs the Microsoft Edge WebView2 Runtime on this computer. Open the Microsoft download page now?",
    );
    let response = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            body.as_ptr(),
            title.as_ptr(),
            MB_YESNO | MB_ICONERROR,
        )
    };
    if response == IDYES {
        let operation = encode("open");
        let url = encode("https://developer.microsoft.com/microsoft-edge/webview2/");
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(1);

    fn temp_executable(name: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "kkterm-portable-{name}-{}-{}",
            std::process::id(),
            NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        (root.join("KKTerm.exe"), root)
    }

    #[test]
    fn installed_detection_does_not_create_a_data_directory() {
        let (exe, root) = temp_executable("installed-no-write");
        let launch = LaunchContext::detect_from_executable(&exe, Some(AppMode::Installed)).unwrap();
        assert!(!launch.is_portable());
        assert!(!root.join("data").exists());
        fs::remove_dir_all(root).unwrap();
    }

    // Forced portable mode is rejected on non-Windows targets, so this
    // Windows-only behavior can only be exercised there.
    #[cfg(target_os = "windows")]
    #[test]
    fn portable_detection_creates_and_probes_the_sibling_data_directory() {
        let (exe, root) = temp_executable("portable-write");
        let launch = LaunchContext::detect_from_executable(&exe, Some(AppMode::Portable)).unwrap();
        assert!(launch.is_portable());
        assert!(root.join("data").is_dir());
        assert!(fs::read_dir(root.join("data")).unwrap().next().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    // The marker only activates portable mode on Windows.
    #[cfg(target_os = "windows")]
    #[test]
    fn marker_enables_portable_mode() {
        let (exe, root) = temp_executable("marker");
        fs::write(root.join(PORTABLE_MARKER_FILENAME), []).unwrap();
        let launch = LaunchContext::detect_from_executable(&exe, None).unwrap();
        assert!(launch.is_portable());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn portable_database_without_marker_is_rejected() {
        let (exe, root) = temp_executable("missing-marker");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(root.join("data").join("kkterm.sqlite3"), []).unwrap();
        let error = LaunchContext::detect_from_executable(&exe, None).unwrap_err();
        assert!(error.contains(PORTABLE_MARKER_FILENAME));
        fs::remove_dir_all(root).unwrap();
    }
}

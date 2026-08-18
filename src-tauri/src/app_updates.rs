use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::process::Command;
use std::sync::{
    Arc, LazyLock, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use url::Url;
use zip::ZipArchive;

const APP_UPDATE_PROGRESS_EVENT: &str = "app-update-download-progress";
static DOWNLOAD_CANCELLATIONS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadAndInstallAppUpdateRequest {
    asset_kind: AppUpdateAssetKind,
    version: String,
    asset_name: String,
    download_url: String,
    checksum_url: String,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum AppUpdateAssetKind {
    WindowsInstaller,
    WindowsPortable,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateDownloadProgress {
    job_id: String,
    transferred_bytes: u64,
    total_bytes: u64,
    progress: u8,
}

#[tauri::command]
pub fn get_app_update_target_triple() -> String {
    app_update_target_triple().to_string()
}

#[tauri::command]
pub async fn download_app_update(
    app: tauri::AppHandle,
    job_id: String,
    request: DownloadAndInstallAppUpdateRequest,
) -> Result<(), String> {
    validate_update_mode(&app, request.asset_kind)?;
    validate_job_id(&job_id)?;
    let cancellation = DOWNLOAD_CANCELLATIONS
        .lock()
        .map_err(|_| "update cancellation registry is unavailable".to_string())?
        .entry(job_id.clone())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone();

    let task_job_id = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        download_app_update_sync(&app, &task_job_id, request, &cancellation)
    })
    .await
    .map_err(|error| format!("update download task failed: {error}"))?;
    if let Ok(mut downloads) = DOWNLOAD_CANCELLATIONS.lock() {
        downloads.remove(&job_id);
    }
    result
}

#[tauri::command]
pub fn cancel_app_update_download(job_id: String) -> Result<(), String> {
    validate_job_id(&job_id)?;
    let cancellation = DOWNLOAD_CANCELLATIONS
        .lock()
        .map_err(|_| "update cancellation registry is unavailable".to_string())?
        .entry(job_id)
        .or_insert_with(|| Arc::new(AtomicBool::new(true)))
        .clone();
    cancellation.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn install_downloaded_app_update(
    app: tauri::AppHandle,
    request: DownloadAndInstallAppUpdateRequest,
) -> Result<(), String> {
    validate_update_mode(&app, request.asset_kind)?;
    validate_update_request(&request)?;
    let downloaded_path = update_download_path(&app, &request.asset_name)?;
    let checksum_urls = update_asset_urls(
        &request.checksum_url,
        &request.version,
        &format!("{}.sha256", request.asset_name),
    )?;
    let checksum = download_text_from_any(&checksum_urls)?;
    let expected_sha256 = parse_sha256(&checksum)?;
    let actual_sha256 = sha256_file(&downloaded_path)?;
    if !actual_sha256.eq_ignore_ascii_case(&expected_sha256) {
        let _ = fs::remove_file(&downloaded_path);
        return Err("downloaded update checksum did not match release metadata".into());
    }

    match request.asset_kind {
        AppUpdateAssetKind::WindowsInstaller => {
            spawn_installer_after_exit(&downloaded_path, std::process::id())?;
        }
        AppUpdateAssetKind::WindowsPortable => {
            let handoff = prepare_portable_update(&app, &request, &downloaded_path)?;
            spawn_portable_update_after_exit(&handoff, std::process::id())?;
        }
    }
    app.exit(0);
    Ok(())
}

fn validate_update_mode(
    app: &tauri::AppHandle,
    asset_kind: AppUpdateAssetKind,
) -> Result<(), String> {
    let is_portable = app.state::<crate::app_paths::AppPaths>().is_portable();
    match (is_portable, asset_kind) {
        (false, AppUpdateAssetKind::WindowsInstaller)
        | (true, AppUpdateAssetKind::WindowsPortable) => Ok(()),
        (true, AppUpdateAssetKind::WindowsInstaller) => {
            Err("portable mode cannot install a Windows setup executable".into())
        }
        (false, AppUpdateAssetKind::WindowsPortable) => {
            Err("installed mode cannot apply a portable ZIP update".into())
        }
    }
}

fn download_app_update_sync(
    app: &tauri::AppHandle,
    job_id: &str,
    request: DownloadAndInstallAppUpdateRequest,
    cancellation: &AtomicBool,
) -> Result<(), String> {
    validate_update_request(&request)?;
    let download_path = update_download_path(app, &request.asset_name)?;
    let checksum_urls = update_asset_urls(
        &request.checksum_url,
        &request.version,
        &format!("{}.sha256", request.asset_name),
    )?;
    let checksum = download_text_from_any(&checksum_urls)?;
    let expected_sha256 = parse_sha256(&checksum)?;
    let download_urls =
        update_asset_urls(&request.download_url, &request.version, &request.asset_name)?;

    let result = download_file_from_any(app, job_id, &download_urls, &download_path, cancellation)
        .and_then(|_| {
            let actual_sha256 = sha256_file(&download_path)?;
            if actual_sha256.eq_ignore_ascii_case(&expected_sha256) {
                Ok(())
            } else {
                Err("downloaded update checksum did not match release metadata".into())
            }
        });

    if result.is_err() {
        let _ = fs::remove_file(&download_path);
    }
    result
}

fn update_download_path(app: &tauri::AppHandle, asset_name: &str) -> Result<PathBuf, String> {
    let update_dir = crate::app_paths::cache_dir(app)?.join("updates");
    fs::create_dir_all(&update_dir).map_err(|error| {
        format!(
            "failed to create update download directory {}: {error}",
            update_dir.display()
        )
    })?;
    Ok(update_dir.join(asset_name))
}

fn validate_job_id(job_id: &str) -> Result<(), String> {
    if job_id.is_empty()
        || job_id.len() > 64
        || !job_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    {
        return Err("update download job id is invalid".into());
    }
    Ok(())
}

fn app_update_target_triple() -> &'static str {
    #[cfg(target_arch = "aarch64")]
    {
        "windows-arm64"
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        "windows-x64"
    }
}

fn validate_update_request(request: &DownloadAndInstallAppUpdateRequest) -> Result<(), String> {
    if !request
        .version
        .chars()
        .all(|ch| ch.is_ascii_digit() || ch == '.')
    {
        return Err("update version must contain only digits and dots".into());
    }

    let expected_name = match request.asset_kind {
        AppUpdateAssetKind::WindowsInstaller => format!(
            "kkterm-{}-{}-setup.exe",
            request.version,
            app_update_target_triple()
        ),
        AppUpdateAssetKind::WindowsPortable => format!(
            "kkterm-{}-{}-portable.zip",
            request.version,
            app_update_target_triple()
        ),
    };
    if request.asset_name != expected_name {
        return Err(format!("update asset must be named {expected_name}"));
    }

    validate_update_asset_url(&request.download_url, &request.version, &request.asset_name)?;
    validate_update_asset_url(
        &request.checksum_url,
        &request.version,
        &format!("{}.sha256", request.asset_name),
    )?;
    Ok(())
}

fn update_asset_urls(
    primary_url: &str,
    version: &str,
    expected_file_name: &str,
) -> Result<Vec<String>, String> {
    validate_update_asset_url(primary_url, version, expected_file_name)?;
    let parsed = Url::parse(primary_url).map_err(|error| format!("invalid update URL: {error}"))?;
    let fallback_url = match parsed.host_str() {
        Some("github.com") => Some(format!(
            "https://kkterm.ryantsai.com/releases/v{version}/{expected_file_name}"
        )),
        Some("kkterm.ryantsai.com") => Some(format!(
            "https://github.com/ryantsai/KKTerm/releases/download/v{version}/{expected_file_name}"
        )),
        _ => None,
    };
    let mut urls = vec![primary_url.to_string()];
    if let Some(fallback_url) = fallback_url {
        if fallback_url != primary_url {
            urls.push(fallback_url);
        }
    }
    Ok(urls)
}

fn validate_update_asset_url(
    url: &str,
    version: &str,
    expected_file_name: &str,
) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|error| format!("invalid update URL: {error}"))?;
    if parsed.scheme() != "https" {
        return Err("update assets must be downloaded over HTTPS".into());
    }

    let path = parsed.path();
    let trusted_source = match parsed.host_str() {
        Some("github.com") => {
            path.starts_with(&format!("/ryantsai/KKTerm/releases/download/v{version}/"))
        }
        Some("kkterm.ryantsai.com") => path.starts_with(&format!("/releases/v{version}/")),
        _ => false,
    };
    if !trusted_source {
        return Err(
            "update assets must come from KKTerm Releases or the KKTerm release mirror".into(),
        );
    }
    if !path.ends_with(&format!("/{expected_file_name}")) {
        return Err(format!(
            "update asset URL must end with {expected_file_name}"
        ));
    }

    Ok(())
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    crate::net::proxy::apply_blocking(reqwest::blocking::Client::builder())
        .user_agent("KKTerm-Updater/1")
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("failed to build update HTTP client: {error}"))
}

fn download_text_from_any(urls: &[String]) -> Result<String, String> {
    let mut last_error = None;
    for url in urls {
        match download_text(url) {
            Ok(value) => return Ok(value),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| "no update checksum URL was available".into()))
}

fn download_text(url: &str) -> Result<String, String> {
    http_client()?
        .get(url)
        .send()
        .map_err(|error| format!("failed to download update checksum: {error}"))?
        .error_for_status()
        .map_err(|error| format!("failed to download update checksum: {error}"))?
        .text()
        .map_err(|error| format!("failed to read update checksum: {error}"))
}

fn download_file_from_any(
    app: &tauri::AppHandle,
    job_id: &str,
    urls: &[String],
    destination: &Path,
    cancellation: &AtomicBool,
) -> Result<(), String> {
    let mut last_error = None;
    for url in urls {
        match download_file(app, job_id, url, destination, cancellation) {
            Ok(()) => return Ok(()),
            Err(error) if error.contains("app update download cancelled") => return Err(error),
            Err(error) => {
                let _ = fs::remove_file(destination);
                last_error = Some(error);
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "no update installer URL was available".into()))
}

fn download_file(
    app: &tauri::AppHandle,
    job_id: &str,
    url: &str,
    destination: &Path,
    cancellation: &AtomicBool,
) -> Result<(), String> {
    if cancellation.load(Ordering::Relaxed) {
        return Err("app update download cancelled".into());
    }
    let mut response = http_client()?
        .get(url)
        .send()
        .map_err(|error| format!("failed to download update installer: {error}"))?
        .error_for_status()
        .map_err(|error| format!("failed to download update installer: {error}"))?;
    let total_bytes = response.content_length().unwrap_or(0);
    let mut file = fs::File::create(destination).map_err(|error| {
        format!(
            "failed to create update installer {}: {error}",
            destination.display()
        )
    })?;
    let mut transferred_bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        if cancellation.load(Ordering::Relaxed) {
            return Err("app update download cancelled".into());
        }
        let count = response
            .read(&mut buffer)
            .map_err(|error| format!("failed to read update installer: {error}"))?;
        if count == 0 {
            break;
        }
        file.write_all(&buffer[..count]).map_err(|error| {
            format!(
                "failed to write update installer {}: {error}",
                destination.display()
            )
        })?;
        transferred_bytes += count as u64;
        let progress = if total_bytes > 0 {
            ((transferred_bytes.saturating_mul(100) / total_bytes).min(100)) as u8
        } else {
            0
        };
        let _ = app.emit(
            APP_UPDATE_PROGRESS_EVENT,
            AppUpdateDownloadProgress {
                job_id: job_id.to_string(),
                transferred_bytes,
                total_bytes,
                progress,
            },
        );
    }
    Ok(())
}

fn parse_sha256(value: &str) -> Result<String, String> {
    let hash = value
        .split_whitespace()
        .find(|part| part.len() == 64 && part.chars().all(|ch| ch.is_ascii_hexdigit()))
        .ok_or_else(|| "release checksum file did not contain a SHA-256 hash".to_string())?;
    Ok(hash.to_ascii_lowercase())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "failed to read downloaded installer {}: {error}",
            path.display()
        )
    })?;
    let digest = Sha256::digest(&bytes);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut checksum = String::with_capacity(digest.len() * 2);
    for byte in digest {
        checksum.push(HEX[(byte >> 4) as usize] as char);
        checksum.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(checksum)
}

struct PortableUpdateHandoff {
    portable_root: PathBuf,
    work_dir: PathBuf,
    staging_dir: PathBuf,
    rollback_dir: PathBuf,
    archive_path: PathBuf,
    awaiting_ready_path: PathBuf,
    ready_path: PathBuf,
    error_result_path: PathBuf,
}

fn prepare_portable_update(
    app: &tauri::AppHandle,
    request: &DownloadAndInstallAppUpdateRequest,
    archive_path: &Path,
) -> Result<PortableUpdateHandoff, String> {
    let paths = app.state::<crate::app_paths::AppPaths>();
    if !paths.is_portable() {
        return Err("portable update staging requires portable mode".into());
    }
    let portable_root = paths
        .data_dir()
        .parent()
        .ok_or_else(|| "failed to resolve the portable program folder".to_string())?
        .to_path_buf();
    if portable_root.join("data") != paths.data_dir() {
        return Err("portable data folder is not directly below the program folder".into());
    }
    if !portable_root.join("kkterm-portable.marker").is_file() {
        return Err("portable update requires kkterm-portable.marker".into());
    }

    let work_dir = paths
        .cache_dir()
        .join("updates")
        .join(format!("portable-{}", request.version));
    let staging_dir = work_dir.join("staging");
    let rollback_dir = work_dir.join("rollback");
    remove_file_if_present(&work_dir.join("awaiting-ready"))?;
    remove_file_if_present(&work_dir.join("ready"))?;
    remove_dir_if_present(&staging_dir)?;
    remove_dir_if_present(&rollback_dir)?;
    fs::create_dir_all(&staging_dir).map_err(|error| {
        format!(
            "failed to create portable update staging directory {}: {error}",
            staging_dir.display()
        )
    })?;
    if let Err(error) = extract_portable_update(archive_path, &staging_dir) {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(error);
    }

    let awaiting_ready_path = work_dir.join("awaiting-ready");
    let ready_path = work_dir.join("ready");
    let error_result_path = paths
        .cache_dir()
        .join("updates")
        .join("portable-update-error.txt");
    Ok(PortableUpdateHandoff {
        portable_root,
        work_dir,
        staging_dir,
        rollback_dir,
        archive_path: archive_path.to_path_buf(),
        awaiting_ready_path,
        ready_path,
        error_result_path,
    })
}

#[tauri::command]
pub fn take_portable_update_error(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let paths = app.state::<crate::app_paths::AppPaths>();
    if !paths.is_portable() {
        return Ok(None);
    }
    let error_path = paths
        .cache_dir()
        .join("updates")
        .join("portable-update-error.txt");
    if !error_path.is_file() {
        return Ok(None);
    }
    let metadata = fs::metadata(&error_path).map_err(|error| {
        format!(
            "failed to inspect portable update result {}: {error}",
            error_path.display()
        )
    })?;
    if metadata.len() > 4096 {
        let _ = fs::remove_file(&error_path);
        return Err("portable update result was unexpectedly large".into());
    }
    let message = fs::read_to_string(&error_path).map_err(|error| {
        format!(
            "failed to read portable update result {}: {error}",
            error_path.display()
        )
    })?;
    fs::remove_file(&error_path).map_err(|error| {
        format!(
            "failed to clear portable update result {}: {error}",
            error_path.display()
        )
    })?;
    Ok(
        Some(message.trim().trim_start_matches('\u{feff}').to_string())
            .filter(|value| !value.is_empty()),
    )
}

pub fn mark_portable_update_ready(app: &tauri::AppHandle) -> Result<(), String> {
    let paths = app.state::<crate::app_paths::AppPaths>();
    if !paths.is_portable() {
        return Ok(());
    }
    let Some(work_dir) = pending_portable_update_work_dir(paths.cache_dir())? else {
        return Ok(());
    };
    let awaiting_ready_path = work_dir.join("awaiting-ready");
    if !awaiting_ready_path.is_file() {
        return Ok(());
    }
    fs::write(work_dir.join("ready"), b"ready").map_err(|error| {
        format!(
            "failed to confirm portable update startup in {}: {error}",
            work_dir.display()
        )
    })
}

fn pending_portable_update_work_dir(cache_dir: &Path) -> Result<Option<PathBuf>, String> {
    let updates_dir = cache_dir.join("updates");
    let entries = match fs::read_dir(&updates_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "failed to inspect portable update directory {}: {error}",
                updates_dir.display()
            ));
        }
    };

    let mut candidates = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "failed to inspect portable update entry in {}: {error}",
                updates_dir.display()
            )
        })?;
        if !entry
            .file_type()
            .map_err(|error| {
                format!(
                    "failed to inspect portable update entry {}: {error}",
                    entry.path().display()
                )
            })?
            .is_dir()
        {
            continue;
        }

        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(version) = name.strip_prefix("portable-") else {
            continue;
        };
        if version.is_empty()
            || !version
                .chars()
                .all(|character| character.is_ascii_digit() || character == '.')
        {
            continue;
        }

        let awaiting_ready_path = path.join("awaiting-ready");
        if !awaiting_ready_path.is_file() {
            continue;
        }
        let modified = fs::metadata(&awaiting_ready_path)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        candidates.push((modified, path));
    }

    candidates.sort_by_key(|(modified, _)| *modified);
    Ok(candidates.pop().map(|(_, path)| path))
}

fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to clear {}: {error}", path.display())),
    }
}

fn remove_dir_if_present(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("failed to clear {}: {error}", path.display()))?;
    }
    Ok(())
}

fn extract_portable_update(archive_path: &Path, staging_dir: &Path) -> Result<(), String> {
    const MAX_ARCHIVE_ENTRIES: usize = 10_000;
    const MAX_UNCOMPRESSED_BYTES: u64 = 1024 * 1024 * 1024;
    const ALLOWED_ROOTS: &[&str] = &[
        "KKTerm.exe",
        "kkterm-cli.exe",
        "kkterm-portable.marker",
        "manual",
        "assistant-skills",
    ];

    let file = fs::File::open(archive_path).map_err(|error| {
        format!(
            "failed to open portable update archive {}: {error}",
            archive_path.display()
        )
    })?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("portable update archive is invalid: {error}"))?;
    if archive.len() == 0 || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("portable update archive has an invalid number of entries".into());
    }

    let mut total_uncompressed = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("failed to read portable update entry: {error}"))?;
        total_uncompressed = total_uncompressed
            .checked_add(entry.size())
            .ok_or_else(|| "portable update archive size overflowed".to_string())?;
        if total_uncompressed > MAX_UNCOMPRESSED_BYTES {
            return Err("portable update archive is too large".into());
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("portable update archive cannot contain symbolic links".into());
        }
        let relative_path = entry
            .enclosed_name()
            .ok_or_else(|| "portable update archive contains an unsafe path".to_string())?;
        let root_name = relative_path
            .components()
            .next()
            .and_then(|component| component.as_os_str().to_str())
            .ok_or_else(|| "portable update archive contains an invalid path".to_string())?;
        if !ALLOWED_ROOTS.contains(&root_name) {
            return Err(format!(
                "portable update archive contains unexpected root entry {root_name}"
            ));
        }

        let destination = staging_dir.join(relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&destination).map_err(|error| {
                format!(
                    "failed to create staged directory {}: {error}",
                    destination.display()
                )
            })?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create staged directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        let mut output = fs::File::create(&destination).map_err(|error| {
            format!(
                "failed to create staged file {}: {error}",
                destination.display()
            )
        })?;
        std::io::copy(&mut entry, &mut output).map_err(|error| {
            format!(
                "failed to extract staged file {}: {error}",
                destination.display()
            )
        })?;
        output.sync_all().map_err(|error| {
            format!(
                "failed to flush staged file {}: {error}",
                destination.display()
            )
        })?;
    }

    for required in ALLOWED_ROOTS {
        if !staging_dir.join(required).exists() {
            return Err(format!(
                "portable update archive is missing required entry {required}"
            ));
        }
    }
    if !staging_dir.join("KKTerm.exe").is_file()
        || !staging_dir.join("kkterm-cli.exe").is_file()
        || !staging_dir.join("kkterm-portable.marker").is_file()
        || !staging_dir.join("manual").is_dir()
        || !staging_dir.join("assistant-skills").is_dir()
    {
        return Err("portable update archive has an invalid program layout".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn spawn_portable_update_after_exit(
    handoff: &PortableUpdateHandoff,
    parent_pid: u32,
) -> Result<(), String> {
    let command = portable_update_handoff_command(handoff, parent_pid);
    let mut powershell = Command::new("powershell");
    powershell.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-Command",
        &command,
    ]);
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    powershell.creation_flags(CREATE_NO_WINDOW);
    powershell
        .spawn()
        .map_err(|error| format!("failed to start portable update handoff: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn portable_update_handoff_command(handoff: &PortableUpdateHandoff, parent_pid: u32) -> String {
    let root = ps_single_quote(&handoff.portable_root.to_string_lossy());
    let work = ps_single_quote(&handoff.work_dir.to_string_lossy());
    let staging = ps_single_quote(&handoff.staging_dir.to_string_lossy());
    let rollback = ps_single_quote(&handoff.rollback_dir.to_string_lossy());
    let archive = ps_single_quote(&handoff.archive_path.to_string_lossy());
    let awaiting_ready = ps_single_quote(&handoff.awaiting_ready_path.to_string_lossy());
    let ready = ps_single_quote(&handoff.ready_path.to_string_lossy());
    let error_result = ps_single_quote(&handoff.error_result_path.to_string_lossy());
    format!(
        "$ErrorActionPreference = 'Stop'; \
         $root = {root}; $work = {work}; $stage = {staging}; $rollback = {rollback}; $archive = {archive}; \
         $awaitingReady = {awaiting_ready}; $ready = {ready}; \
         $errorResult = {error_result}; \
         $names = @('KKTerm.exe', 'kkterm-cli.exe', 'manual', 'assistant-skills'); \
         $deadline = (Get-Date).AddSeconds(30); \
         while (Get-Process -Id {parent_pid} -ErrorAction SilentlyContinue) {{ \
             if ((Get-Date) -ge $deadline) {{ exit 2 }}; Start-Sleep -Milliseconds 200 \
         }}; \
         New-Item -ItemType Directory -Path $rollback -Force | Out-Null; \
         $movedOld = @(); $movedNew = @(); \
         try {{ \
             foreach ($name in $names) {{ \
                 $target = Join-Path $root $name; \
                 if (Test-Path -LiteralPath $target) {{ \
                     Move-Item -LiteralPath $target -Destination (Join-Path $rollback $name); \
                     $movedOld += $name \
                 }} \
             }}; \
             foreach ($name in $names) {{ \
                 $source = Join-Path $stage $name; \
                 if (-not (Test-Path -LiteralPath $source)) {{ throw ('Missing staged entry: ' + $name) }}; \
                 Move-Item -LiteralPath $source -Destination (Join-Path $root $name); \
                 $movedNew += $name \
             }}; \
             New-Item -ItemType File -Path $awaitingReady -Force | Out-Null; \
             Remove-Item -LiteralPath $ready -Force -ErrorAction SilentlyContinue; \
             $newProcess = Start-Process -FilePath (Join-Path $root 'KKTerm.exe') -PassThru; \
             $readyDeadline = (Get-Date).AddSeconds(30); \
             while (-not (Test-Path -LiteralPath $ready)) {{ \
                 if ($newProcess.HasExited) {{ throw 'Updated KKTerm exited before startup completed' }}; \
                 if ((Get-Date) -ge $readyDeadline) {{ \
                     Stop-Process -Id $newProcess.Id -Force -ErrorAction SilentlyContinue; \
                     Wait-Process -Id $newProcess.Id -Timeout 5 -ErrorAction SilentlyContinue; \
                     throw 'Updated KKTerm did not complete startup in time' \
                 }}; \
                 Start-Sleep -Milliseconds 200 \
             }} \
         }} catch {{ \
             foreach ($name in $movedNew) {{ \
                 $target = Join-Path $root $name; \
                 if (Test-Path -LiteralPath $target) {{ Remove-Item -LiteralPath $target -Recurse -Force }} \
             }}; \
             foreach ($name in $movedOld) {{ \
                 $backup = Join-Path $rollback $name; \
                 if (Test-Path -LiteralPath $backup) {{ Move-Item -LiteralPath $backup -Destination (Join-Path $root $name) }} \
             }}; \
             $logDir = Join-Path $root 'data\\logs'; New-Item -ItemType Directory -Path $logDir -Force | Out-Null; \
             Add-Content -LiteralPath (Join-Path $logDir 'portable-update.log') -Value ((Get-Date).ToString('o') + ' ' + $_.Exception.Message); \
             Set-Content -LiteralPath $errorResult -Value $_.Exception.Message -Encoding UTF8; \
             $oldExe = Join-Path $root 'KKTerm.exe'; \
             if (Test-Path -LiteralPath $oldExe) {{ Start-Process -FilePath $oldExe | Out-Null }}; \
             exit 1 \
         }}; \
         Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue; \
         Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue"
    )
}

#[cfg(not(target_os = "windows"))]
fn spawn_portable_update_after_exit(
    _handoff: &PortableUpdateHandoff,
    _parent_pid: u32,
) -> Result<(), String> {
    Err("portable self-update is only available on Windows".into())
}

#[cfg(target_os = "windows")]
fn spawn_installer_after_exit(installer_path: &Path, parent_pid: u32) -> Result<(), String> {
    let command = installer_handoff_command(installer_path, parent_pid);
    let mut powershell = Command::new("powershell");
    powershell.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-Command",
        &command,
    ]);
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    powershell.creation_flags(CREATE_NO_WINDOW);
    powershell
        .spawn()
        .map_err(|error| format!("failed to start update installer handoff: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn installer_handoff_command(installer_path: &Path, parent_pid: u32) -> String {
    let installer = ps_single_quote(&installer_path.to_string_lossy());
    let update_dir = ps_single_quote(
        &installer_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_string_lossy(),
    );
    format!(
        "Wait-Process -Id {parent_pid} -Timeout 30 -ErrorAction SilentlyContinue; \
         $installerProcess = Start-Process -FilePath {installer} -PassThru; \
         Wait-Process -Id $installerProcess.Id; \
         if ($installerProcess.ExitCode -eq 0) {{ \
             Remove-Item -LiteralPath {installer} -Force; \
             Remove-Item -LiteralPath {update_dir} -Force -ErrorAction SilentlyContinue \
         }}"
    )
}

#[cfg(not(target_os = "windows"))]
fn spawn_installer_after_exit(_installer_path: &Path, _parent_pid: u32) -> Result<(), String> {
    Err("download and install is only available for Windows installers".into())
}

#[cfg(target_os = "windows")]
fn ps_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use zip::{ZipWriter, write::SimpleFileOptions};

    fn write_portable_test_archive(path: &Path, extra_entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, bytes) in [
            ("KKTerm.exe", b"new-app".as_slice()),
            ("kkterm-cli.exe", b"new-cli".as_slice()),
            ("kkterm-portable.marker", b"".as_slice()),
            ("manual/INDEX.md", b"manual".as_slice()),
            ("assistant-skills/example/SKILL.md", b"skill".as_slice()),
        ]
        .into_iter()
        .chain(extra_entries.iter().copied())
        {
            archive.start_file(name, options).unwrap();
            archive.write_all(bytes).unwrap();
        }
        archive.finish().unwrap();
    }

    #[test]
    fn parse_sha256_accepts_release_checksum_format() {
        let hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert_eq!(
            parse_sha256(&format!("{hash}  kkterm-0.1.54-windows-x64-setup.exe")).unwrap(),
            hash
        );
    }

    #[test]
    fn pending_portable_update_ignores_non_version_work_directories() {
        let temp = tempdir().unwrap();
        let updates_dir = temp.path().join("updates");
        let pending_dir = updates_dir.join("portable-3000.0.2");
        fs::create_dir_all(&pending_dir).unwrap();
        fs::write(pending_dir.join("awaiting-ready"), b"awaiting").unwrap();

        for name in [
            "portable-update-error.txt",
            "portable-3000.0.3-beta",
            "portable-3000.0.4-nope",
        ] {
            let path = updates_dir.join(name);
            fs::create_dir_all(&path).unwrap();
            fs::write(path.join("awaiting-ready"), b"ignore").unwrap();
        }

        assert_eq!(
            pending_portable_update_work_dir(temp.path()),
            Ok(Some(pending_dir)),
        );
    }

    #[test]
    fn validate_update_request_rejects_non_github_url() {
        let request = DownloadAndInstallAppUpdateRequest {
            asset_kind: AppUpdateAssetKind::WindowsInstaller,
            version: "0.1.54".into(),
            asset_name: format!("kkterm-0.1.54-{}-setup.exe", app_update_target_triple()),
            download_url: "https://example.com/installer.exe".into(),
            checksum_url: "https://example.com/installer.exe.sha256".into(),
        };
        assert!(validate_update_request(&request).is_err());
    }

    #[test]
    fn validate_update_request_accepts_release_mirror_url() {
        let target = app_update_target_triple();
        let asset_name = format!("kkterm-0.1.94-{target}-setup.exe");
        let request = DownloadAndInstallAppUpdateRequest {
            asset_kind: AppUpdateAssetKind::WindowsInstaller,
            version: "0.1.94".into(),
            asset_name: asset_name.clone(),
            download_url: format!("https://kkterm.ryantsai.com/releases/v0.1.94/{asset_name}"),
            checksum_url: format!(
                "https://kkterm.ryantsai.com/releases/v0.1.94/{asset_name}.sha256"
            ),
        };
        assert!(validate_update_request(&request).is_ok());
    }

    #[test]
    fn validate_update_request_accepts_portable_release_asset() {
        let target = app_update_target_triple();
        let asset_name = format!("kkterm-0.1.140-{target}-portable.zip");
        let request = DownloadAndInstallAppUpdateRequest {
            asset_kind: AppUpdateAssetKind::WindowsPortable,
            version: "0.1.140".into(),
            asset_name: asset_name.clone(),
            download_url: format!(
                "https://github.com/ryantsai/KKTerm/releases/download/v0.1.140/{asset_name}"
            ),
            checksum_url: format!(
                "https://github.com/ryantsai/KKTerm/releases/download/v0.1.140/{asset_name}.sha256"
            ),
        };
        assert!(validate_update_request(&request).is_ok());
    }

    #[test]
    fn portable_archive_extracts_only_the_program_payload() {
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("portable.zip");
        let staging_dir = temp.path().join("staging");
        write_portable_test_archive(&archive_path, &[]);
        fs::create_dir(&staging_dir).unwrap();

        extract_portable_update(&archive_path, &staging_dir).unwrap();

        assert_eq!(
            fs::read(staging_dir.join("KKTerm.exe")).unwrap(),
            b"new-app"
        );
        assert!(staging_dir.join("manual/INDEX.md").is_file());
        assert!(
            staging_dir
                .join("assistant-skills/example/SKILL.md")
                .is_file()
        );
        assert!(!staging_dir.join("data").exists());
    }

    #[test]
    fn portable_archive_rejects_data_and_unexpected_roots() {
        for forbidden in ["data/kkterm.sqlite3", "unexpected.txt"] {
            let temp = tempdir().unwrap();
            let archive_path = temp.path().join("portable.zip");
            let staging_dir = temp.path().join("staging");
            write_portable_test_archive(&archive_path, &[(forbidden, b"forbidden")]);
            fs::create_dir(&staging_dir).unwrap();

            let error = extract_portable_update(&archive_path, &staging_dir).unwrap_err();
            assert!(error.contains("unexpected root entry"), "{error}");
        }
    }

    #[test]
    fn portable_archive_rejects_parent_traversal() {
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("portable.zip");
        let staging_dir = temp.path().join("staging");
        write_portable_test_archive(&archive_path, &[("../data/kkterm.sqlite3", b"forbidden")]);
        fs::create_dir(&staging_dir).unwrap();

        let error = extract_portable_update(&archive_path, &staging_dir).unwrap_err();
        assert!(error.contains("unsafe path"), "{error}");
        assert!(!temp.path().join("data/kkterm.sqlite3").exists());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn installer_handoff_cleans_download_only_after_success() {
        let command = installer_handoff_command(
            Path::new("C:\\Users\\Tester's PC\\updates\\kkterm-0.1.96-windows-x64-setup.exe"),
            42,
        );

        assert!(command.contains("Wait-Process -Id 42"));
        assert!(command.contains("Start-Process -FilePath 'C:\\Users\\Tester''s PC\\updates\\kkterm-0.1.96-windows-x64-setup.exe' -PassThru"));
        assert!(command.contains("Wait-Process -Id $installerProcess.Id"));
        assert!(command.contains("if ($installerProcess.ExitCode -eq 0)"));
        assert!(command.contains("Remove-Item -LiteralPath 'C:\\Users\\Tester''s PC\\updates\\kkterm-0.1.96-windows-x64-setup.exe' -Force"));
        assert!(command.contains("Remove-Item -LiteralPath 'C:\\Users\\Tester''s PC\\updates' -Force -ErrorAction SilentlyContinue"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn portable_handoff_waits_for_startup_and_has_rollback_paths() {
        use std::io::Write as _;
        use std::process::Stdio;

        let handoff = PortableUpdateHandoff {
            portable_root: PathBuf::from("C:\\KKTerm Portable"),
            work_dir: PathBuf::from("C:\\KKTerm Portable\\data\\cache\\updates\\portable-0.1.140"),
            staging_dir: PathBuf::from(
                "C:\\KKTerm Portable\\data\\cache\\updates\\portable-0.1.140\\staging",
            ),
            rollback_dir: PathBuf::from(
                "C:\\KKTerm Portable\\data\\cache\\updates\\portable-0.1.140\\rollback",
            ),
            archive_path: PathBuf::from(
                "C:\\KKTerm Portable\\data\\cache\\updates\\kkterm-0.1.140-windows-x64-portable.zip",
            ),
            awaiting_ready_path: PathBuf::from(
                "C:\\KKTerm Portable\\data\\cache\\updates\\portable-0.1.140\\awaiting-ready",
            ),
            ready_path: PathBuf::from(
                "C:\\KKTerm Portable\\data\\cache\\updates\\portable-0.1.140\\ready",
            ),
            error_result_path: PathBuf::from(
                "C:\\KKTerm Portable\\data\\cache\\updates\\portable-update-error.txt",
            ),
        };

        let command = portable_update_handoff_command(&handoff, 42);

        assert!(command.contains("Get-Process -Id 42"));
        assert!(
            command.contains(
                "$names = @('KKTerm.exe', 'kkterm-cli.exe', 'manual', 'assistant-skills')"
            )
        );
        assert!(command.contains("Updated KKTerm did not complete startup in time"));
        assert!(command.contains("$movedOld"));
        assert!(command.contains("portable-update.log"));
        assert!(command.contains("portable-update-error.txt"));
        assert!(!command.contains("Join-Path $root 'data'"));

        let mut parser = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "[scriptblock]::Create([Console]::In.ReadToEnd()) | Out-Null",
            ])
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        parser
            .stdin
            .take()
            .unwrap()
            .write_all(command.as_bytes())
            .unwrap();
        assert!(parser.wait().unwrap().success());
    }

    #[test]
    fn update_asset_urls_try_mirror_then_github() {
        let urls = update_asset_urls(
            "https://kkterm.ryantsai.com/releases/v0.1.94/kkterm-0.1.94-windows-x64-setup.exe",
            "0.1.94",
            "kkterm-0.1.94-windows-x64-setup.exe",
        )
        .unwrap();
        assert_eq!(
            urls,
            vec![
                "https://kkterm.ryantsai.com/releases/v0.1.94/kkterm-0.1.94-windows-x64-setup.exe",
                "https://github.com/ryantsai/KKTerm/releases/download/v0.1.94/kkterm-0.1.94-windows-x64-setup.exe",
            ]
        );
    }

    #[test]
    fn update_asset_urls_try_github_then_mirror() {
        let urls = update_asset_urls(
            "https://github.com/ryantsai/KKTerm/releases/download/v0.1.94/kkterm-0.1.94-windows-x64-setup.exe.sha256",
            "0.1.94",
            "kkterm-0.1.94-windows-x64-setup.exe.sha256",
        )
        .unwrap();
        assert_eq!(
            urls,
            vec![
                "https://github.com/ryantsai/KKTerm/releases/download/v0.1.94/kkterm-0.1.94-windows-x64-setup.exe.sha256",
                "https://kkterm.ryantsai.com/releases/v0.1.94/kkterm-0.1.94-windows-x64-setup.exe.sha256",
            ]
        );
    }
}

mod ai;
mod ai_coding_usage;
mod app_launcher;
mod app_tray;
mod assistant_skills;
mod auto_start;
mod dashboard_commands;
mod dashboard_ids;
mod dashboard_storage;
mod dashboard_validation;
mod debug_heartbeat;
mod diagnostics;
mod favicon;
mod ftp;
mod github_copilot;
mod import;
mod logging;
mod manual;
mod mcp;
mod net;
mod performance;
mod power;
mod rdp;
mod screenshot;
mod secrets;
mod serial;
mod sessions;
mod sftp;
mod ssh;
mod ssh_config;
mod ssh_keys;
mod storage;
mod telnet;
mod vnc;
mod watchdog;
mod webview;
mod wiki;
mod window_state;
#[cfg(target_os = "windows")]
mod windows_local_pty;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppBootstrap {
    product_name: &'static str,
    version: &'static str,
    log_status: String,
    storage_status: String,
    keychain_status: secrets::KeychainStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomFontEntry {
    name: String,
    path: String,
    extension: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomFontData {
    data_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardBackgroundImageData {
    data_url: Option<String>,
    path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredCredentialSummary {
    id: String,
    kind: String,
    secret_kind: String,
    owner_id: String,
    label: String,
    detail: Option<String>,
    username: Option<String>,
    updated_at: Option<String>,
    metadata_source: String,
    exists: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteStoredCredentialRequest {
    kind: String,
    owner_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FillWebviewCredentialRequest {
    session_id: String,
    secret_owner_id: String,
    automatic: Option<bool>,
}

#[tauri::command]
fn app_bootstrap(
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
) -> AppBootstrap {
    AppBootstrap {
        product_name: "KKTerm",
        version: env!("CARGO_PKG_VERSION"),
        log_status: logging::status(),
        storage_status: storage.status(),
        keychain_status: secrets.status(),
    }
}

#[tauri::command]
fn is_debug_build() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
fn debug_frontend_heartbeat() {
    debug_heartbeat::record_frontend_heartbeat();
}

#[tauri::command]
fn get_custom_fonts_folder() -> Result<String, String> {
    let folder = custom_fonts_folder()?;
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "failed to create custom fonts folder {}: {error}",
            folder.display()
        )
    })?;
    Ok(folder.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_custom_fonts_folder(app: tauri::AppHandle) -> Result<(), String> {
    let folder = custom_fonts_folder()?;
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "failed to create custom fonts folder {}: {error}",
            folder.display()
        )
    })?;
    app.opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|error| {
            format!(
                "failed to open custom fonts folder {}: {error}",
                folder.display()
            )
        })
}

#[tauri::command]
async fn list_custom_fonts() -> Result<Vec<CustomFontEntry>, String> {
    tauri::async_runtime::spawn_blocking(list_custom_fonts_sync)
        .await
        .map_err(|error| format!("failed to list custom fonts: {error}"))?
}

#[tauri::command]
async fn load_custom_font_data(path: String) -> Result<CustomFontData, String> {
    tauri::async_runtime::spawn_blocking(move || load_custom_font_data_sync(path))
        .await
        .map_err(|error| format!("failed to load custom font: {error}"))?
}

#[tauri::command]
async fn dashboard_import_background_image(source_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        dashboard_import_background_image_sync(source_path)
    })
    .await
    .map_err(|error| format!("failed to import background image: {error}"))?
}

fn dashboard_import_background_image_sync(source_path: String) -> Result<String, String> {
    use std::hash::{Hash, Hasher};

    let source = PathBuf::from(&source_path);
    let extension = background_media_extension(&source)
        .ok_or_else(|| background_media_extension_error().to_string())?;

    let bytes = fs::read(&source)
        .map_err(|error| format!("failed to read background image {source_path}: {error}"))?;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    let file_name = format!("bg-{:016x}.{extension}", hasher.finish());

    let folder = backgrounds_folder()?;
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "failed to create backgrounds folder {}: {error}",
            folder.display()
        )
    })?;
    let destination = folder.join(&file_name);
    if !destination.exists() {
        fs::write(&destination, &bytes).map_err(|error| {
            format!(
                "failed to write background image {}: {error}",
                destination.display()
            )
        })?;
    }
    Ok(file_name)
}

#[tauri::command]
async fn dashboard_load_background_image(
    file: String,
) -> Result<DashboardBackgroundImageData, String> {
    tauri::async_runtime::spawn_blocking(move || dashboard_load_background_image_sync(file))
        .await
        .map_err(|error| format!("failed to load background image: {error}"))?
}

fn dashboard_load_background_image_sync(
    file: String,
) -> Result<DashboardBackgroundImageData, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    if file.is_empty() || file.contains('/') || file.contains('\\') || file.contains("..") {
        return Err("invalid background image file name".to_string());
    }

    let folder = backgrounds_folder()?;
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "failed to create backgrounds folder {}: {error}",
            folder.display()
        )
    })?;
    let folder = folder
        .canonicalize()
        .map_err(|error| format!("failed to resolve backgrounds folder: {error}"))?;

    let path = folder.join(&file);
    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve background image path: {error}"))?;
    if !canonical_path.starts_with(&folder) {
        return Err("background image path must stay inside the backgrounds folder".to_string());
    }

    let extension = background_media_extension(&canonical_path)
        .ok_or_else(|| background_media_extension_error().to_string())?;

    let bytes = fs::read(&canonical_path).map_err(|error| {
        format!(
            "failed to read background media {}: {error}",
            canonical_path.display()
        )
    })?;

    let data_url = format!(
        "data:{};base64,{}",
        background_media_mime(&extension),
        STANDARD.encode(bytes),
    );
    Ok(DashboardBackgroundImageData {
        data_url: Some(data_url),
        path: None,
    })
}

fn list_custom_fonts_sync() -> Result<Vec<CustomFontEntry>, String> {
    let folder = custom_fonts_folder()?;
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "failed to create custom fonts folder {}: {error}",
            folder.display()
        )
    })?;

    let mut fonts = fs::read_dir(&folder)
        .map_err(|error| {
            format!(
                "failed to read custom fonts folder {}: {error}",
                folder.display()
            )
        })?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| custom_font_entry(entry.path()))
        .collect::<Vec<_>>();

    fonts.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(fonts)
}

fn load_custom_font_data_sync(path: String) -> Result<CustomFontData, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let folder = custom_fonts_folder()?;
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "failed to create custom fonts folder {}: {error}",
            folder.display()
        )
    })?;

    let folder = folder
        .canonicalize()
        .map_err(|error| format!("failed to resolve custom fonts folder: {error}"))?;
    let path = PathBuf::from(path);
    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve custom font path: {error}"))?;

    if !canonical_path.starts_with(&folder) {
        return Err("custom font path must stay inside the fonts folder".to_string());
    }

    if custom_font_entry(canonical_path.clone()).is_none() {
        return Err("custom font file must be .ttf, .otf, .woff, or .woff2".to_string());
    }

    let bytes = fs::read(&canonical_path).map_err(|error| {
        format!(
            "failed to read custom font {}: {error}",
            canonical_path.display()
        )
    })?;

    Ok(CustomFontData {
        data_base64: STANDARD.encode(bytes),
    })
}

fn custom_fonts_folder() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe()
        .map_err(|error| format!("failed to resolve app executable path: {error}"))?;
    let exe_folder = exe_path
        .parent()
        .ok_or_else(|| "failed to resolve app executable folder".to_string())?;
    Ok(exe_folder.join("fonts"))
}

pub(crate) fn backgrounds_folder() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe()
        .map_err(|error| format!("failed to resolve app executable path: {error}"))?;
    let exe_folder = exe_path
        .parent()
        .ok_or_else(|| "failed to resolve app executable folder".to_string())?;
    Ok(exe_folder.join("backgrounds"))
}

/// Best-effort: delete background media files no view references anymore.
/// Never returns an error — cleanup failures must not break view mutations.
pub(crate) fn prune_unreferenced_backgrounds(app: &tauri::AppHandle) {
    let storage = app.state::<storage::Storage>();
    let referenced = storage.with_connection_infallible(|conn| {
        dashboard_storage::referenced_background_image_files(conn)
            .map_err(|error| format!("{error:?}"))
    });
    let referenced = match referenced {
        Ok(set) => set,
        Err(error) => {
            eprintln!("background prune skipped: {error}");
            return;
        }
    };
    let folder = match backgrounds_folder() {
        Ok(folder) => folder,
        Err(error) => {
            eprintln!("background prune skipped: {error}");
            return;
        }
    };
    let entries = match fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(_) => return, // folder may not exist yet — nothing to prune.
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        if !referenced.contains(&name) {
            if let Err(error) = fs::remove_file(&path) {
                eprintln!(
                    "failed to prune background image {}: {error}",
                    path.display()
                );
            }
        }
    }
}

fn custom_font_entry(path: PathBuf) -> Option<CustomFontEntry> {
    if !path.is_file() {
        return None;
    }

    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_lowercase())?;

    if !is_supported_font_extension(&extension) {
        return None;
    }

    let name = path
        .file_stem()
        .and_then(|name| name.to_str())
        .or_else(|| path.file_name().and_then(|name| name.to_str()))?
        .to_string();

    Some(CustomFontEntry {
        name,
        path: path.to_string_lossy().into_owned(),
        extension,
    })
}

fn is_supported_font_extension(extension: &str) -> bool {
    matches!(extension, "ttf" | "otf" | "woff" | "woff2")
}

/// Returns the lowercased extension if `path` is a supported background media file.
fn background_media_extension(path: &std::path::Path) -> Option<String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_lowercase())?;
    if matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "mp4" | "webm" | "mov" | "m4v" | "ogv",
    ) {
        Some(extension)
    } else {
        None
    }
}

fn background_media_mime(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        _ => "application/octet-stream",
    }
}

fn background_media_extension_error() -> &'static str {
    "background file must be .png, .jpg, .jpeg, .webp, .gif, .bmp, .mp4, .webm, .mov, .m4v, or .ogv"
}

#[tauri::command]
fn list_connection_tree(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::ConnectionTree, String> {
    storage.list_connection_tree()
}

#[tauri::command]
fn create_connection(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::CreateConnectionRequest,
) -> Result<storage::SavedConnection, String> {
    storage.create_connection(request)
}

#[tauri::command]
fn create_connection_folder(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::CreateConnectionFolderRequest,
) -> Result<storage::ConnectionFolder, String> {
    storage.create_connection_folder(request)
}

#[tauri::command]
fn rename_connection_folder(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::RenameConnectionFolderRequest,
) -> Result<storage::ConnectionFolder, String> {
    storage.rename_connection_folder(request)
}

#[tauri::command]
fn delete_connection_folder(
    storage: tauri::State<'_, storage::Storage>,
    folder_id: String,
) -> Result<(), String> {
    storage.delete_connection_folder(folder_id)
}

#[tauri::command]
fn rename_connection(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::RenameConnectionRequest,
) -> Result<storage::SavedConnection, String> {
    storage.rename_connection(request)
}

#[tauri::command]
fn update_connection(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::UpdateConnectionRequest,
) -> Result<storage::SavedConnection, String> {
    storage.update_connection(request)
}

#[tauri::command]
fn update_connection_icon_data_url(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
    icon_data_url: Option<String>,
) -> Result<Option<storage::SavedConnection>, String> {
    storage.update_connection_icon_data_url(connection_id, icon_data_url)
}

#[tauri::command]
fn update_connection_icon_background_color(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
    icon_background_color: Option<String>,
) -> Result<Option<storage::SavedConnection>, String> {
    storage.update_connection_icon_background_color(connection_id, icon_background_color)
}

#[tauri::command]
fn delete_connection(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
) -> Result<(), String> {
    storage.delete_connection(connection_id)
}

#[tauri::command]
fn duplicate_connection(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::DuplicateConnectionRequest,
) -> Result<storage::SavedConnection, String> {
    storage.duplicate_connection(request)
}

#[tauri::command]
fn move_connection_folder(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::MoveConnectionFolderRequest,
) -> Result<storage::ConnectionTree, String> {
    storage.move_connection_folder(request)
}

#[tauri::command]
fn move_connection(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::MoveConnectionRequest,
) -> Result<storage::ConnectionTree, String> {
    storage.move_connection(request)
}

#[tauri::command]
async fn update_url_connection_icon_from_page(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
    page_url: String,
) -> Result<Option<storage::SavedConnection>, String> {
    let icon_data_url = favicon::fetch_favicon_data_url(&page_url).await;
    storage.update_url_connection_icon_data_url(connection_id, icon_data_url)
}

#[tauri::command]
fn upsert_url_credential(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::UpsertUrlCredentialRequest,
) -> Result<storage::SavedConnection, String> {
    storage.upsert_url_credential(request)
}

#[tauri::command]
fn list_url_credentials(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<Vec<storage::UrlCredentialSummary>, String> {
    storage.list_url_credentials()
}

#[tauri::command]
fn delete_url_credential(
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
    connection_id: String,
) -> Result<(), String> {
    storage.delete_url_credential(connection_id.clone())?;
    secrets.delete_secret(secrets::SecretReferenceRequest::url_password(connection_id))
}

#[tauri::command]
fn list_url_data_partitions(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<Vec<storage::UrlDataPartitionSummary>, String> {
    storage.list_url_data_partitions()
}

#[tauri::command]
fn clear_url_data_partition(
    storage: tauri::State<'_, storage::Storage>,
    name: String,
) -> Result<(), String> {
    storage.clear_url_data_partition(name)
}

#[tauri::command]
fn get_terminal_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::TerminalSettings, String> {
    storage.terminal_settings()
}

#[tauri::command]
fn get_general_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::GeneralSettings, String> {
    storage.general_settings()
}

#[tauri::command]
fn update_general_settings(
    storage: tauri::State<'_, storage::Storage>,
    tray_state: tauri::State<'_, app_tray::TrayState>,
    power: tauri::State<'_, power::DontSleepManager>,
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: storage::GeneralSettings,
) -> Result<storage::GeneralSettings, String> {
    auto_start::sync_auto_start_with_windows(request.auto_start_with_windows())?;
    let saved = storage.update_general_settings(request)?;
    tray_state.set_minimize_to_tray(saved.minimize_to_tray());
    if let Err(error) = power.set_enabled(saved.dont_sleep_enabled()) {
        eprintln!("failed to apply saved Don't Sleep setting: {error}");
    }
    webviews.set_clipboard_read_allowed(saved.allow_clipboard_read());
    Ok(saved)
}

#[tauri::command]
fn get_app_launcher_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::AppLauncherSettings, String> {
    storage.app_launcher_settings()
}

#[tauri::command]
fn update_app_launcher_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::AppLauncherSettings,
) -> Result<storage::AppLauncherSettings, String> {
    storage.update_app_launcher_settings(request)
}

#[tauri::command]
fn get_dashboard_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::DashboardSettings, String> {
    storage.dashboard_settings()
}

#[tauri::command]
fn update_dashboard_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::DashboardSettings,
) -> Result<storage::DashboardSettings, String> {
    storage.update_dashboard_settings(request)
}

#[tauri::command]
fn prepare_app_launcher_entry(
    request: app_launcher::PrepareAppLauncherEntryRequest,
) -> app_launcher::PreparedAppLauncherEntry {
    app_launcher::prepare_entry(request)
}

#[tauri::command]
fn launch_app_launcher_entry(
    app: tauri::AppHandle,
    request: app_launcher::LaunchAppLauncherEntryRequest,
) -> Result<(), String> {
    app_launcher::launch_entry(app, request)
}

#[tauri::command]
fn import_settings_database(
    storage: tauri::State<'_, storage::Storage>,
    tray_state: tauri::State<'_, app_tray::TrayState>,
    power: tauri::State<'_, power::DontSleepManager>,
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    path: String,
) -> Result<storage::ImportedDatabaseSnapshot, String> {
    let snapshot = storage.import_database_zip(path.into())?;
    let general_settings = storage.general_settings()?;
    tray_state.set_minimize_to_tray(general_settings.minimize_to_tray());
    if let Err(error) = power.set_enabled(general_settings.dont_sleep_enabled()) {
        eprintln!("failed to apply imported Don't Sleep setting: {error}");
    }
    webviews.set_clipboard_read_allowed(general_settings.allow_clipboard_read());
    Ok(snapshot)
}

#[tauri::command]
fn backup_settings_database(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::DatabaseBackupInfo, String> {
    storage.backup_database()
}

#[tauri::command]
fn get_database_folder(storage: tauri::State<'_, storage::Storage>) -> Result<String, String> {
    storage.database_folder()
}

fn persist_main_window_state(
    window: &tauri::Window,
    storage: &storage::Storage,
    window_tracker: &window_state::MainWindowState,
) -> Result<(), String> {
    let settings = window_tracker.snapshot_for_window(window);
    storage.update_main_window_settings(settings)?;
    Ok(())
}

#[tauri::command]
fn update_terminal_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::TerminalSettings,
) -> Result<storage::TerminalSettings, String> {
    storage.update_terminal_settings(request)
}

#[tauri::command]
fn get_appearance_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::AppearanceSettings, String> {
    storage.appearance_settings()
}

#[tauri::command]
fn update_appearance_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::AppearanceSettings,
) -> Result<storage::AppearanceSettings, String> {
    storage.update_appearance_settings(request)
}

#[tauri::command]
fn get_ssh_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::SshSettings, String> {
    storage.ssh_settings()
}

#[tauri::command]
fn update_ssh_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::SshSettings,
) -> Result<storage::SshSettings, String> {
    storage.update_ssh_settings(request)
}

#[tauri::command]
fn generate_ssh_key_pair(
    request: ssh_keys::GenerateSshKeyPairRequest,
) -> Result<ssh_keys::GeneratedSshKeyPair, String> {
    ssh_keys::generate_key_pair(request)
}

#[tauri::command]
async fn transfer_ssh_public_key(
    app: tauri::AppHandle,
    request: ssh_keys::TransferSshPublicKeyRequest,
) -> Result<ssh_keys::TransferSshPublicKeyResult, String> {
    run_blocking_command("SSH public key transfer", move || {
        ssh_keys::transfer_public_key(app, request)
    })
    .await
}

#[tauri::command]
fn get_sftp_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::SftpSettings, String> {
    storage.sftp_settings()
}

#[tauri::command]
fn update_sftp_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::SftpSettings,
) -> Result<storage::SftpSettings, String> {
    storage.update_sftp_settings(request)
}

#[tauri::command]
fn get_url_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::UrlSettings, String> {
    storage.url_settings()
}

#[tauri::command]
fn update_url_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::UrlSettings,
) -> Result<storage::UrlSettings, String> {
    storage.update_url_settings(request)
}

#[tauri::command]
fn get_rdp_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::RdpSettings, String> {
    storage.rdp_settings()
}

#[tauri::command]
fn update_rdp_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::RdpSettings,
) -> Result<storage::RdpSettings, String> {
    storage.update_rdp_settings(request)
}

#[tauri::command]
fn get_vnc_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::VncSettings, String> {
    storage.vnc_settings()
}

#[tauri::command]
fn update_vnc_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::VncSettings,
) -> Result<storage::VncSettings, String> {
    storage.update_vnc_settings(request)
}

#[tauri::command]
fn get_screenshot_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::ScreenshotSettings, String> {
    storage.screenshot_settings()
}

#[tauri::command]
fn update_screenshot_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::ScreenshotSettings,
) -> Result<storage::ScreenshotSettings, String> {
    storage.update_screenshot_settings(request)
}

#[tauri::command]
fn get_ai_provider_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::AiProviderSettings, String> {
    storage.ai_provider_settings()
}

#[tauri::command]
fn update_ai_provider_settings(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::AiProviderSettings,
) -> Result<storage::AiProviderSettings, String> {
    storage.update_ai_provider_settings(request)
}

#[tauri::command]
fn list_assistant_skills(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
) -> Result<Vec<assistant_skills::AssistantSkillSummary>, String> {
    let settings = storage.ai_provider_settings()?;
    assistant_skills::ensure_bundled_skills_installed(&app)?;
    let root = assistant_skills::assistant_skills_root(&app)?;
    assistant_skills::list_skill_summaries(&root, settings.disabled_skill_names())
}

#[tauri::command]
fn set_assistant_skill_enabled(
    storage: tauri::State<'_, storage::Storage>,
    name: String,
    enabled: bool,
) -> Result<storage::AiProviderSettings, String> {
    let mut settings = storage.ai_provider_settings()?;
    settings.set_skill_enabled(name, enabled);
    storage.update_ai_provider_settings(settings)
}

#[tauri::command]
fn open_assistant_skills_folder(app: tauri::AppHandle) -> Result<(), String> {
    assistant_skills::open_skills_folder(&app)
}

#[tauri::command]
fn open_assistant_skill(app: tauri::AppHandle, name: String) -> Result<(), String> {
    assistant_skills::open_skill_folder(&app, &name)
}

#[tauri::command]
fn list_assistant_chat_threads(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<Vec<storage::AssistantChatThreadRecord>, String> {
    storage.list_assistant_chat_threads()
}

#[tauri::command]
fn upsert_assistant_chat_thread(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::AssistantChatThreadRecord,
) -> Result<storage::AssistantChatThreadRecord, String> {
    storage.upsert_assistant_chat_thread(request)
}

#[tauri::command]
fn delete_assistant_chat_thread(
    storage: tauri::State<'_, storage::Storage>,
    thread_id: String,
) -> Result<(), String> {
    storage.delete_assistant_chat_thread(thread_id)
}

#[tauri::command]
async fn start_github_copilot_device_flow(
) -> Result<github_copilot::GitHubCopilotDeviceFlow, String> {
    github_copilot::start_device_flow().await
}

#[tauri::command]
async fn poll_github_copilot_device_flow(
    secrets: tauri::State<'_, secrets::Secrets>,
    request: github_copilot::GitHubCopilotDevicePollRequest,
) -> Result<github_copilot::GitHubCopilotDevicePollResponse, String> {
    let (response, token) = github_copilot::poll_device_flow(request).await?;
    if let Some(token) = token {
        secrets
            .store_ai_api_key(
                storage::ai_provider_secret_owner_id("github-copilot"),
                token,
            )
            .map_err(|error| format!("failed to store GitHub Copilot token: {error}"))?;
    }
    Ok(response)
}

#[tauri::command]
async fn list_github_copilot_models(
    app: tauri::AppHandle,
    secrets: tauri::State<'_, secrets::Secrets>,
) -> Result<Vec<ai::CopilotModelOption>, String> {
    let token = read_ai_provider_api_key(&secrets, "github-copilot")?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Connect GitHub Copilot in Settings before listing Copilot models.".to_string()
        })?;
    ai::list_copilot_models(&app, &token).await
}

#[tauri::command]
async fn list_ai_provider_models(
    app: tauri::AppHandle,
    secrets: tauri::State<'_, secrets::Secrets>,
    request: ai::ListAiProviderModelsRequest,
) -> Result<Vec<ai::AiProviderModelOption>, String> {
    let api_key = read_ai_provider_api_key(&secrets, request.provider_kind())?;
    ai::list_ai_provider_models(
        &app,
        request.provider_kind(),
        request.base_url(),
        request.extra_headers(),
        api_key,
        request.allow_insecure_tls(),
    )
    .await
}

#[tauri::command]
fn plan_command_proposal(
    request: ai::CommandProposalRequest,
) -> Result<ai::CommandProposalPlan, String> {
    ai::plan_command_proposal(request)
}

#[tauri::command]
fn complete_assistant_live_tool_request(
    bridge: tauri::State<'_, ai::AssistantLiveToolBridge>,
    completion: ai::AssistantLiveToolCompletion,
) -> Result<(), String> {
    ai::complete_live_tool_request(&bridge, completion)
}

#[tauri::command]
fn complete_assistant_tool_approval_request(
    bridge: tauri::State<'_, ai::AssistantToolApprovalBridge>,
    completion: ai::AssistantToolApprovalCompletion,
) -> Result<(), String> {
    ai::complete_tool_approval_request(&bridge, completion)
}

#[tauri::command]
async fn run_ai_agent(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
    request: ai::AgentRunRequest,
) -> Result<ai::AgentRunResponse, String> {
    let mut settings = storage.ai_provider_settings()?;
    let api_key = read_ai_provider_api_key(&secrets, settings.provider_kind())?;
    inject_search_api_key(&secrets, &mut settings)?;
    inject_email_secret(&secrets, &mut settings)?;
    ai::run_agent(app, settings, api_key, request).await
}

#[tauri::command]
async fn run_ai_agent_streaming(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
    channel: tauri::ipc::Channel<serde_json::Value>,
    request: ai::AgentRunRequest,
) -> Result<ai::AgentRunResponse, String> {
    let mut settings = storage.ai_provider_settings()?;
    let api_key = read_ai_provider_api_key(&secrets, settings.provider_kind())?;
    inject_search_api_key(&secrets, &mut settings)?;
    inject_email_secret(&secrets, &mut settings)?;
    ai::run_agent_streaming(app, settings, api_key, request, channel).await
}

fn read_ai_provider_api_key(
    secrets: &secrets::Secrets,
    provider_kind: &str,
) -> Result<Option<String>, String> {
    let owner_id = storage::ai_provider_secret_owner_id(provider_kind);
    let provider_key = secrets
        .read_ai_api_key(owner_id)
        .map_err(|error| format!("failed to read AI API key: {error}"))?;
    if provider_key.is_some() {
        return Ok(provider_key);
    }
    secrets
        .read_ai_api_key(storage::LEGACY_AI_PROVIDER_SECRET_OWNER_ID.to_string())
        .map_err(|error| format!("failed to read AI API key: {error}"))
}

fn inject_search_api_key(
    secrets: &secrets::Secrets,
    settings: &mut storage::AiProviderSettings,
) -> Result<(), String> {
    let key = match settings.search_provider() {
        "brave" => secrets
            .read_brave_search_api_key("brave-search".to_string())
            .map_err(|e| format!("failed to read Brave Search API key: {e}"))?,
        "tavily" => secrets
            .read_tavily_search_api_key("tavily-search".to_string())
            .map_err(|e| format!("failed to read Tavily Search API key: {e}"))?,
        _ => None,
    };
    settings.set_search_provider_api_key(key);
    Ok(())
}

fn inject_email_secret(
    secrets: &secrets::Secrets,
    settings: &mut storage::AiProviderSettings,
) -> Result<(), String> {
    let secret = if settings.email_provider() == "smtp" {
        secrets
            .read_email_smtp_password(storage::EMAIL_SMTP_SECRET_OWNER_ID.to_string())
            .map_err(|e| format!("failed to read SMTP password: {e}"))?
    } else {
        secrets
            .read_email_api_key(storage::EMAIL_API_SECRET_OWNER_ID.to_string())
            .map_err(|e| format!("failed to read email API key: {e}"))?
    };
    settings.set_email_secret(secret);
    Ok(())
}

#[tauri::command]
fn keychain_status(secrets: tauri::State<'_, secrets::Secrets>) -> secrets::KeychainStatus {
    secrets.status()
}

#[tauri::command]
fn get_performance_snapshot(
    performance: tauri::State<'_, performance::PerformanceMonitor>,
) -> performance::PerformanceSnapshot {
    performance.snapshot()
}

#[tauri::command]
fn get_host_usage_snapshot(
    performance: tauri::State<'_, performance::PerformanceMonitor>,
) -> performance::HostUsageSnapshot {
    performance.host_usage_snapshot()
}

#[tauri::command]
fn get_system_performance_counters(
    performance: tauri::State<'_, performance::PerformanceMonitor>,
) -> performance::SystemPerformanceCountersSnapshot {
    performance.system_performance_counters_snapshot()
}

#[tauri::command]
fn create_diagnostics_bundle(
    app: tauri::AppHandle,
    performance: tauri::State<'_, performance::PerformanceMonitor>,
) -> Result<diagnostics::DiagnosticsBundle, String> {
    diagnostics::create_bundle(&app, &performance)
}

#[tauri::command]
fn get_dont_sleep_enabled(power: tauri::State<'_, power::DontSleepManager>) -> bool {
    power.is_enabled()
}

#[tauri::command]
fn set_dont_sleep_enabled(
    app: tauri::AppHandle,
    power: tauri::State<'_, power::DontSleepManager>,
    storage: tauri::State<'_, storage::Storage>,
    tray_state: tauri::State<'_, app_tray::TrayState>,
    enabled: bool,
) -> Result<bool, String> {
    let saved = power.set_enabled(enabled)?;
    storage.update_dont_sleep_enabled(saved)?;
    if let Err(error) = app_tray::rebuild_menu(&app, &tray_state) {
        eprintln!("failed to refresh tray menu after Don't Sleep change: {error}");
    }
    Ok(saved)
}

#[tauri::command]
fn update_tray_menu(
    app: tauri::AppHandle,
    tray_state: tauri::State<'_, app_tray::TrayState>,
    snapshot: app_tray::TrayMenuSnapshot,
) -> Result<(), String> {
    tray_state.set_snapshot(snapshot);
    app_tray::rebuild_menu(&app, &tray_state)
}

#[tauri::command]
fn capture_screenshot_to_clipboard(
    app: tauri::AppHandle,
    request: screenshot::CaptureScreenshotRequest,
) -> Result<(), String> {
    screenshot::capture_rect_to_clipboard(&app, request)
}

#[tauri::command]
fn capture_screenshot_for_assistant(
    app: tauri::AppHandle,
    request: screenshot::CaptureScreenshotRequest,
) -> Result<screenshot::AssistantScreenshot, String> {
    screenshot::capture_rect_for_assistant(&app, request)
}

#[tauri::command]
fn capture_fullscreen_screenshot_for_assistant() -> Result<screenshot::AssistantScreenshot, String>
{
    screenshot::capture_fullscreen_for_assistant()
}

#[tauri::command]
fn capture_screenshot_to_library(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    request: screenshot::CaptureScreenshotRequest,
    kind: String,
) -> Result<screenshot::StoredScreenshot, String> {
    let settings = storage.screenshot_settings()?;
    screenshot::capture_rect_to_library(&app, request, kind, settings.folder_path().to_string())
}

#[tauri::command]
fn capture_fullscreen_screenshot_to_library(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    kind: String,
) -> Result<screenshot::StoredScreenshot, String> {
    let settings = storage.screenshot_settings()?;
    screenshot::capture_fullscreen_to_library(&app, kind, settings.folder_path().to_string())
}

#[tauri::command]
fn capture_active_window_screenshot_to_library(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    kind: String,
) -> Result<screenshot::StoredScreenshot, String> {
    let settings = storage.screenshot_settings()?;
    screenshot::capture_active_window_to_library(&app, kind, settings.folder_path().to_string())
}

#[tauri::command]
fn capture_interactive_region_screenshot_to_library(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    kind: String,
) -> Result<screenshot::StoredScreenshot, String> {
    let settings = storage.screenshot_settings()?;
    screenshot::capture_interactive_region_to_library(
        &app,
        kind,
        settings.folder_path().to_string(),
    )
}

#[tauri::command]
fn list_screenshots(
    storage: tauri::State<'_, storage::Storage>,
    request: screenshot::ListScreenshotsRequest,
) -> Result<screenshot::ListScreenshotsResponse, String> {
    let settings = storage.screenshot_settings()?;
    screenshot::list_library_screenshots(request, settings.folder_path().to_string())
}

#[tauri::command]
fn delete_screenshot(
    storage: tauri::State<'_, storage::Storage>,
    id: String,
) -> Result<(), String> {
    let settings = storage.screenshot_settings()?;
    screenshot::delete_library_screenshot(id, settings.folder_path().to_string())
}

#[tauri::command]
fn clear_screenshots(storage: tauri::State<'_, storage::Storage>) -> Result<(), String> {
    let settings = storage.screenshot_settings()?;
    screenshot::clear_library_screenshots(settings.folder_path().to_string())
}

#[tauri::command]
fn ssh_transport_plan() -> ssh::SshTransportPlan {
    ssh::transport_plan()
}

#[tauri::command]
fn import_ssh_config(
    request: ssh_config::ImportSshConfigRequest,
) -> Result<ssh_config::SshConfigImportPreview, String> {
    ssh_config::import_ssh_config(request)
}

#[tauri::command]
fn parse_import_file(
    request: import::ParseImportFileRequest,
) -> Result<import::ImportFilePreview, String> {
    import::parse_import_file(request)
}

#[tauri::command]
fn list_browser_bookmark_sources() -> import::BrowserBookmarkSourcesResponse {
    import::list_browser_bookmark_sources()
}

#[tauri::command]
fn preview_browser_bookmark_import(
    request: import::PreviewBrowserBookmarkImportRequest,
) -> Result<import::ImportFilePreview, String> {
    import::preview_browser_bookmark_import(request)
}

#[tauri::command]
fn scan_network_for_connections(
    app: tauri::AppHandle,
    request: import::ScanNetworkRequest,
) -> Result<import::ScanNetworkResponse, String> {
    import::scan_network(app, request)
}

#[tauri::command]
fn inspect_ssh_host_key(
    app: tauri::AppHandle,
    request: ssh::InspectSshHostKeyRequest,
) -> Result<ssh::SshHostKeyPreview, String> {
    ssh::inspect_host_key(ssh::app_known_hosts_path(&app)?, request)
}

#[tauri::command]
fn trust_ssh_host_key(
    app: tauri::AppHandle,
    request: ssh::TrustSshHostKeyRequest,
) -> Result<ssh::SshHostKeyPreview, String> {
    ssh::trust_host_key(ssh::app_known_hosts_path(&app)?, request)
}

#[tauri::command]
fn store_secret(
    secrets: tauri::State<'_, secrets::Secrets>,
    request: secrets::StoreSecretRequest,
) -> Result<(), String> {
    secrets.store_secret(request)
}

#[tauri::command]
fn secret_exists(
    secrets: tauri::State<'_, secrets::Secrets>,
    request: secrets::SecretReferenceRequest,
) -> Result<secrets::SecretPresence, String> {
    secrets.secret_exists(request)
}

#[tauri::command]
fn delete_secret(
    secrets: tauri::State<'_, secrets::Secrets>,
    request: secrets::SecretReferenceRequest,
) -> Result<(), String> {
    secrets.delete_secret(request)
}

#[tauri::command]
fn list_stored_credentials(
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
) -> Result<Vec<StoredCredentialSummary>, String> {
    let candidates = storage.list_stored_credential_candidates()?;
    let mut summaries = Vec::new();
    for candidate in candidates {
        let reference = credential_reference(&candidate.secret_kind, candidate.owner_id.clone())?;
        let exists = secrets.secret_exists(reference)?.exists();
        if exists || matches!(candidate.kind.as_str(), "urlPassword" | "widgetSecret") {
            summaries.push(StoredCredentialSummary {
                id: candidate.id,
                kind: candidate.kind,
                secret_kind: candidate.secret_kind,
                owner_id: candidate.owner_id,
                label: candidate.label,
                detail: candidate.detail,
                username: candidate.username,
                updated_at: candidate.updated_at,
                metadata_source: candidate.metadata_source,
                exists,
            });
        }
    }
    Ok(summaries)
}

#[tauri::command]
fn delete_stored_credential(
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
    request: DeleteStoredCredentialRequest,
) -> Result<(), String> {
    let owner_id = request.owner_id.trim().to_string();
    if owner_id.is_empty() {
        return Err("credential owner id is required".to_string());
    }
    match request.kind.as_str() {
        "urlPassword" => {
            storage.delete_url_credential(owner_id.clone())?;
            secrets.delete_secret(secrets::SecretReferenceRequest::url_password(owner_id))
        }
        "widgetSecret" => {
            secrets.delete_secret(secrets::SecretReferenceRequest::widget_secret(
                owner_id.clone(),
            ))?;
            if let Some((instance_id, key)) = parse_widget_secret_owner_id(&owner_id) {
                storage.clear_widget_secret_reference(instance_id, key)?;
            }
            Ok(())
        }
        "aiApiKey" => secrets.delete_secret(secrets::SecretReferenceRequest::ai_api_key(owner_id)),
        "emailApiKey" => {
            secrets.delete_secret(secrets::SecretReferenceRequest::email_api_key(owner_id))
        }
        "emailSmtpPassword" => secrets.delete_secret(
            secrets::SecretReferenceRequest::email_smtp_password(owner_id),
        ),
        "connectionPassword" => secrets.delete_secret(
            secrets::SecretReferenceRequest::connection_password(owner_id),
        ),
        _ => Err("unsupported credential kind".to_string()),
    }
}

fn credential_reference(
    secret_kind: &str,
    owner_id: String,
) -> Result<secrets::SecretReferenceRequest, String> {
    match secret_kind {
        "connectionPassword" => Ok(secrets::SecretReferenceRequest::connection_password(
            owner_id,
        )),
        "urlPassword" => Ok(secrets::SecretReferenceRequest::url_password(owner_id)),
        "aiApiKey" => Ok(secrets::SecretReferenceRequest::ai_api_key(owner_id)),
        "emailApiKey" => Ok(secrets::SecretReferenceRequest::email_api_key(owner_id)),
        "emailSmtpPassword" => Ok(secrets::SecretReferenceRequest::email_smtp_password(owner_id)),
        "widgetSecret" => Ok(secrets::SecretReferenceRequest::widget_secret(owner_id)),
        _ => Err("unsupported credential kind".to_string()),
    }
}

fn parse_widget_secret_owner_id(owner_id: &str) -> Option<(String, String)> {
    let rest = owner_id.strip_prefix("dashboard-widget-secret:")?;
    let (instance_id, key) = rest.rsplit_once(':')?;
    if instance_id.trim().is_empty() || key.trim().is_empty() {
        return None;
    }
    Some((instance_id.to_string(), key.to_string()))
}

#[tauri::command]
async fn start_terminal_session(
    app: tauri::AppHandle,
    request: sessions::StartTerminalSessionRequest,
) -> Result<sessions::TerminalSessionStarted, String> {
    let startup_app = app.clone();
    let started = run_blocking_command("terminal session startup", move || {
        let sessions = startup_app.state::<sessions::SessionManager>();
        let secrets = startup_app.state::<secrets::Secrets>();
        sessions.start_terminal_session(startup_app.clone(), &secrets, request)
    })
    .await;
    let started = started?;
    if let Some(terminal_ready_ms) = started.terminal_ready_ms() {
        let performance = app.state::<performance::PerformanceMonitor>();
        performance.record_ssh_terminal_ready(terminal_ready_ms);
    }
    Ok(started)
}

#[tauri::command]
fn write_terminal_input(
    sessions: tauri::State<'_, sessions::SessionManager>,
    request: sessions::TerminalInputRequest,
) -> Result<(), String> {
    sessions.write_terminal_input(request)
}

#[tauri::command]
fn resize_terminal(
    sessions: tauri::State<'_, sessions::SessionManager>,
    request: sessions::ResizeTerminalRequest,
) -> Result<(), String> {
    sessions.resize_terminal(request)
}

#[tauri::command]
fn close_terminal_session(
    sessions: tauri::State<'_, sessions::SessionManager>,
    session_id: String,
) -> Result<(), String> {
    sessions.close_terminal_session(session_id)
}

#[tauri::command]
async fn list_tmux_sessions(
    app: tauri::AppHandle,
    request: sessions::TmuxConnectionRequest,
) -> Result<Vec<sessions::TmuxSession>, String> {
    run_blocking_command("tmux list sessions", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.list_tmux_sessions(app.clone(), &secrets, request)
    })
    .await
}

#[tauri::command]
async fn close_tmux_session(
    app: tauri::AppHandle,
    request: sessions::CloseTmuxSessionRequest,
) -> Result<(), String> {
    run_blocking_command("tmux close session", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.close_tmux_session(app.clone(), &secrets, request)
    })
    .await
}

#[tauri::command]
async fn rename_tmux_session(
    app: tauri::AppHandle,
    request: sessions::RenameTmuxSessionRequest,
) -> Result<(), String> {
    run_blocking_command("tmux rename session", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.rename_tmux_session(app.clone(), &secrets, request)
    })
    .await
}

#[tauri::command]
async fn set_tmux_mouse(
    app: tauri::AppHandle,
    request: sessions::SetTmuxSessionMouseRequest,
) -> Result<(), String> {
    run_blocking_command("tmux set mouse", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.set_tmux_session_mouse(app.clone(), &secrets, request)
    })
    .await
}

#[tauri::command]
async fn capture_tmux_pane(
    app: tauri::AppHandle,
    request: sessions::CaptureTmuxPaneRequest,
) -> Result<String, String> {
    run_blocking_command("tmux capture pane", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.capture_tmux_pane(app.clone(), &secrets, request)
    })
    .await
}

#[tauri::command]
async fn inspect_ssh_system_context(
    app: tauri::AppHandle,
    request: sessions::TmuxConnectionRequest,
) -> Result<String, String> {
    run_blocking_command("SSH system context inspection", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.inspect_ssh_system_context(app.clone(), &secrets, request)
    })
    .await
}

#[tauri::command]
async fn list_remote_loopback_ports(
    app: tauri::AppHandle,
    request: sessions::TmuxConnectionRequest,
) -> Result<Vec<sessions::RemoteLoopbackPort>, String> {
    run_blocking_command("SSH loopback port discovery", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        let storage = app.state::<storage::Storage>();
        let hide_common_ports = storage.ssh_settings()?.hide_common_port_redirects();
        sessions.list_remote_loopback_ports(app.clone(), &secrets, request, hide_common_ports)
    })
    .await
}

#[tauri::command]
async fn start_ssh_port_forward(
    app: tauri::AppHandle,
    request: sessions::StartSshPortForwardRequest,
) -> Result<sessions::SshPortForwardStarted, String> {
    run_blocking_command("SSH port forward startup", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.start_ssh_port_forward(app.clone(), &secrets, request)
    })
    .await
}

#[tauri::command]
fn close_ssh_port_forward(
    sessions: tauri::State<'_, sessions::SessionManager>,
    request: sessions::CloseSshPortForwardRequest,
) -> Result<(), String> {
    sessions.close_ssh_port_forward(request)
}

#[tauri::command]
fn launch_elevated_terminal(
    request: sessions::LaunchElevatedTerminalRequest,
) -> Result<(), String> {
    sessions::launch_elevated_terminal(request)
}

async fn run_blocking_command<T, F>(label: &'static str, job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| format!("{label} worker failed: {error}"))?
}

#[tauri::command]
async fn start_sftp_session(
    app: tauri::AppHandle,
    request: sftp::StartSftpSessionRequest,
) -> Result<sftp::SftpSessionStarted, String> {
    let worker_app = app.clone();
    run_blocking_command("SFTP startup", move || {
        let sftp_sessions = worker_app.state::<sftp::SftpSessionManager>();
        let secrets = worker_app.state::<secrets::Secrets>();
        sftp_sessions.start_sftp_session(worker_app.clone(), &secrets, request)
    })
    .await
}

#[tauri::command]
async fn list_sftp_directory(
    app: tauri::AppHandle,
    request: sftp::ListSftpDirectoryRequest,
) -> Result<sftp::SftpDirectoryListing, String> {
    run_blocking_command("SFTP list directory", move || {
        let sftp_sessions = app.state::<sftp::SftpSessionManager>();
        sftp_sessions.list_directory(request)
    })
    .await
}

#[tauri::command]
fn list_local_directory(
    request: sftp::ListLocalDirectoryRequest,
) -> Result<sftp::LocalDirectoryListing, String> {
    sftp::list_local_directory(request)
}

#[tauri::command]
async fn upload_sftp_path(
    app: tauri::AppHandle,
    request: sftp::UploadSftpPathRequest,
) -> Result<sftp::SftpTransferResult, String> {
    let worker_app = app.clone();
    run_blocking_command("SFTP upload", move || {
        let sftp_sessions = worker_app.state::<sftp::SftpSessionManager>();
        sftp_sessions.upload_path(worker_app.clone(), request)
    })
    .await
}

#[tauri::command]
async fn download_sftp_path(
    app: tauri::AppHandle,
    request: sftp::DownloadSftpPathRequest,
) -> Result<sftp::SftpTransferResult, String> {
    let worker_app = app.clone();
    run_blocking_command("SFTP download", move || {
        let sftp_sessions = worker_app.state::<sftp::SftpSessionManager>();
        sftp_sessions.download_path(worker_app.clone(), request)
    })
    .await
}

#[tauri::command]
fn cancel_sftp_transfer(
    sftp_sessions: tauri::State<'_, sftp::SftpSessionManager>,
    request: sftp::CancelSftpTransferRequest,
) -> Result<(), String> {
    sftp_sessions.cancel_transfer(request)
}

#[tauri::command]
async fn create_sftp_folder(
    app: tauri::AppHandle,
    request: sftp::CreateSftpFolderRequest,
) -> Result<(), String> {
    run_blocking_command("SFTP create folder", move || {
        let sftp_sessions = app.state::<sftp::SftpSessionManager>();
        sftp_sessions.create_folder(request)
    })
    .await
}

#[tauri::command]
async fn rename_sftp_path(
    app: tauri::AppHandle,
    request: sftp::RenameSftpPathRequest,
) -> Result<(), String> {
    run_blocking_command("SFTP rename", move || {
        let sftp_sessions = app.state::<sftp::SftpSessionManager>();
        sftp_sessions.rename_path(request)
    })
    .await
}

#[tauri::command]
async fn delete_sftp_path(
    app: tauri::AppHandle,
    request: sftp::DeleteSftpPathRequest,
) -> Result<(), String> {
    run_blocking_command("SFTP delete", move || {
        let sftp_sessions = app.state::<sftp::SftpSessionManager>();
        sftp_sessions.delete_path(request)
    })
    .await
}

#[tauri::command]
async fn sftp_path_properties(
    app: tauri::AppHandle,
    request: sftp::SftpPathPropertiesRequest,
) -> Result<sftp::SftpPathProperties, String> {
    run_blocking_command("SFTP properties", move || {
        let sftp_sessions = app.state::<sftp::SftpSessionManager>();
        sftp_sessions.path_properties(request)
    })
    .await
}

#[tauri::command]
async fn update_sftp_path_properties(
    app: tauri::AppHandle,
    request: sftp::UpdateSftpPathPropertiesRequest,
) -> Result<sftp::SftpPathProperties, String> {
    run_blocking_command("SFTP update properties", move || {
        let sftp_sessions = app.state::<sftp::SftpSessionManager>();
        sftp_sessions.update_path_properties(request)
    })
    .await
}

#[tauri::command]
async fn close_sftp_session(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    run_blocking_command("SFTP close", move || {
        let sftp_sessions = app.state::<sftp::SftpSessionManager>();
        sftp_sessions.close_sftp_session(session_id)
    })
    .await
}

#[tauri::command]
async fn start_ftp_session(
    app: tauri::AppHandle,
    request: ftp::StartFtpSessionRequest,
) -> Result<ftp::FtpSessionStarted, String> {
    let worker_app = app.clone();
    run_blocking_command("FTP startup", move || {
        let ftp_sessions = worker_app.state::<ftp::FtpSessionManager>();
        let secrets = worker_app.state::<secrets::Secrets>();
        ftp_sessions.start_ftp_session(worker_app.clone(), &secrets, request)
    })
    .await
}

#[tauri::command]
async fn list_ftp_directory(
    app: tauri::AppHandle,
    request: ftp::ListFtpDirectoryRequest,
) -> Result<ftp::FtpDirectoryListing, String> {
    run_blocking_command("FTP list directory", move || {
        let ftp_sessions = app.state::<ftp::FtpSessionManager>();
        ftp_sessions.list_ftp_directory(request)
    })
    .await
}

#[tauri::command]
async fn upload_ftp_path(
    app: tauri::AppHandle,
    request: ftp::UploadFtpPathRequest,
) -> Result<ftp::FtpTransferResult, String> {
    let worker_app = app.clone();
    run_blocking_command("FTP upload", move || {
        let ftp_sessions = worker_app.state::<ftp::FtpSessionManager>();
        ftp_sessions.upload_ftp_path(worker_app.clone(), request)
    })
    .await
}

#[tauri::command]
async fn download_ftp_path(
    app: tauri::AppHandle,
    request: ftp::DownloadFtpPathRequest,
) -> Result<ftp::FtpTransferResult, String> {
    let worker_app = app.clone();
    run_blocking_command("FTP download", move || {
        let ftp_sessions = worker_app.state::<ftp::FtpSessionManager>();
        ftp_sessions.download_ftp_path(worker_app.clone(), request)
    })
    .await
}

#[tauri::command]
fn cancel_ftp_transfer(
    ftp_sessions: tauri::State<'_, ftp::FtpSessionManager>,
    request: ftp::CancelFtpTransferRequest,
) -> Result<(), String> {
    ftp_sessions.cancel_ftp_transfer(request)
}

#[tauri::command]
async fn create_ftp_folder(
    app: tauri::AppHandle,
    request: ftp::CreateFtpFolderRequest,
) -> Result<(), String> {
    run_blocking_command("FTP create folder", move || {
        let ftp_sessions = app.state::<ftp::FtpSessionManager>();
        ftp_sessions.create_ftp_folder(request)
    })
    .await
}

#[tauri::command]
async fn rename_ftp_path(
    app: tauri::AppHandle,
    request: ftp::RenameFtpPathRequest,
) -> Result<(), String> {
    run_blocking_command("FTP rename", move || {
        let ftp_sessions = app.state::<ftp::FtpSessionManager>();
        ftp_sessions.rename_ftp_path(request)
    })
    .await
}

#[tauri::command]
async fn delete_ftp_path(
    app: tauri::AppHandle,
    request: ftp::DeleteFtpPathRequest,
) -> Result<(), String> {
    run_blocking_command("FTP delete", move || {
        let ftp_sessions = app.state::<ftp::FtpSessionManager>();
        ftp_sessions.delete_ftp_path(request)
    })
    .await
}

#[tauri::command]
async fn ftp_path_properties(
    app: tauri::AppHandle,
    request: ftp::FtpPathPropertiesRequest,
) -> Result<ftp::FtpPathProperties, String> {
    run_blocking_command("FTP properties", move || {
        let ftp_sessions = app.state::<ftp::FtpSessionManager>();
        ftp_sessions.ftp_path_properties(request)
    })
    .await
}

#[tauri::command]
async fn close_ftp_session(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    run_blocking_command("FTP close", move || {
        let ftp_sessions = app.state::<ftp::FtpSessionManager>();
        ftp_sessions.close_ftp_session(&session_id)
    })
    .await
}

#[tauri::command]
async fn start_webview_session(
    app: tauri::AppHandle,
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::StartWebviewSessionRequest,
) -> Result<webview::WebviewSessionStarted, String> {
    webviews.start_session(&app, request)
}

#[tauri::command]
fn update_webview_bounds(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::UpdateWebviewBoundsRequest,
) -> Result<(), String> {
    webviews.update_bounds(request)
}

#[tauri::command]
fn set_webview_visibility(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::SetWebviewVisibilityRequest,
) -> Result<(), String> {
    webviews.set_visibility(request)
}

#[tauri::command]
fn webview_navigate(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::WebviewNavigateRequest,
) -> Result<(), String> {
    webviews.navigate(request)
}

#[tauri::command]
fn webview_reload(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::WebviewSimpleRequest,
) -> Result<(), String> {
    webviews.reload(request)
}

#[tauri::command]
fn webview_go_back(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::WebviewSimpleRequest,
) -> Result<(), String> {
    webviews.go_back(request)
}

#[tauri::command]
fn webview_go_forward(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::WebviewSimpleRequest,
) -> Result<(), String> {
    webviews.go_forward(request)
}

#[tauri::command]
fn fill_webview_credential(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
    request: FillWebviewCredentialRequest,
) -> Result<(), String> {
    let credential = storage
        .url_credential_fill(&request.secret_owner_id)?
        .ok_or_else(|| "stored URL credential was not found".to_string())?;
    let username = credential.username.trim().to_string();
    if username.is_empty() {
        return Err("URL credential username is required".to_string());
    }
    let password = secrets
        .read_url_password(request.secret_owner_id)
        .map_err(|error| format!("failed to read URL password: {error}"))?
        .ok_or_else(|| "stored URL password was not found".to_string())?;
    webviews.fill_credential(webview::WebviewFillCredentialRequest {
        session_id: request.session_id,
        username,
        password,
        username_selector: credential.username_selector,
        password_selector: credential.password_selector,
        field_values: credential.field_values,
        automatic: request.automatic.unwrap_or(false),
    })
}

#[tauri::command]
fn capture_webview_credential(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::WebviewCaptureCredentialRequest,
) -> Result<(), String> {
    webviews.capture_credential(request)
}

#[tauri::command]
fn close_webview_session(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::WebviewSimpleRequest,
) -> Result<(), String> {
    webviews.close_session(request)
}

#[tauri::command]
async fn start_rdp_session(
    app: tauri::AppHandle,
    rdp_sessions: tauri::State<'_, rdp::RdpSessionManager>,
    secrets: tauri::State<'_, secrets::Secrets>,
    mut request: rdp::StartRdpSessionRequest,
) -> Result<rdp::RdpSessionStarted, String> {
    if request.password().is_none() {
        if let Some(owner_id) = request.secret_owner_id().map(str::to_string) {
            request.set_password(
                secrets
                    .read_connection_password(owner_id)
                    .map_err(|error| format!("failed to read RDP password: {error}"))?,
            );
        }
    }
    rdp_sessions.start_session(app, request)
}

#[tauri::command]
fn update_rdp_bounds(
    app: tauri::AppHandle,
    rdp_sessions: tauri::State<'_, rdp::RdpSessionManager>,
    request: rdp::UpdateRdpBoundsRequest,
) -> Result<(), String> {
    rdp_sessions.update_bounds(app, request)
}

#[tauri::command]
fn set_rdp_visibility(
    app: tauri::AppHandle,
    rdp_sessions: tauri::State<'_, rdp::RdpSessionManager>,
    request: rdp::SetRdpVisibilityRequest,
) -> Result<(), String> {
    rdp_sessions.set_visibility(app, request)
}

#[tauri::command]
fn sync_rdp_display_size(
    app: tauri::AppHandle,
    rdp_sessions: tauri::State<'_, rdp::RdpSessionManager>,
    request: rdp::SyncRdpDisplaySizeRequest,
) -> Result<rdp::RdpDisplaySizeSync, String> {
    rdp_sessions.sync_display_size(app, request)
}

#[tauri::command]
fn close_rdp_session(
    app: tauri::AppHandle,
    rdp_sessions: tauri::State<'_, rdp::RdpSessionManager>,
    request: rdp::RdpSimpleRequest,
) -> Result<(), String> {
    rdp_sessions.close_session(app, request)
}

#[tauri::command]
fn get_rdp_session_status(
    app: tauri::AppHandle,
    rdp_sessions: tauri::State<'_, rdp::RdpSessionManager>,
    request: rdp::RdpSimpleRequest,
) -> Result<rdp::RdpSessionStatus, String> {
    rdp_sessions.session_status(app, request)
}

#[tauri::command]
fn send_rdp_ctrl_alt_delete(
    app: tauri::AppHandle,
    rdp_sessions: tauri::State<'_, rdp::RdpSessionManager>,
    request: rdp::RdpSimpleRequest,
) -> Result<(), String> {
    rdp_sessions.send_ctrl_alt_delete(app, request)
}

#[tauri::command]
fn send_rdp_text(
    app: tauri::AppHandle,
    rdp_sessions: tauri::State<'_, rdp::RdpSessionManager>,
    request: rdp::SendRdpTextRequest,
) -> Result<rdp::RdpTextSent, String> {
    rdp_sessions.send_text(app, request)
}

#[tauri::command]
fn send_rdp_key_press(
    app: tauri::AppHandle,
    rdp_sessions: tauri::State<'_, rdp::RdpSessionManager>,
    request: rdp::SendRdpKeyPressRequest,
) -> Result<(), String> {
    rdp_sessions.send_key_press(app, request)
}

#[tauri::command]
fn send_rdp_mouse_click(
    app: tauri::AppHandle,
    rdp_sessions: tauri::State<'_, rdp::RdpSessionManager>,
    request: rdp::SendRdpMouseClickRequest,
) -> Result<(), String> {
    rdp_sessions.send_mouse_click(app, request)
}

#[tauri::command]
async fn start_vnc_session(
    app: tauri::AppHandle,
    mut request: vnc::StartVncSessionRequest,
) -> Result<vnc::VncSessionStarted, String> {
    run_blocking_command("VNC startup", move || {
        let vnc_sessions = app.state::<vnc::VncSessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        if request.password().is_none() {
            if let Some(owner_id) = request.secret_owner_id().map(str::to_string) {
                request.set_password(
                    secrets
                        .read_connection_password(owner_id)
                        .map_err(|error| format!("failed to read VNC password: {error}"))?,
                );
            }
        }
        vnc_sessions.start_session(app.clone(), request)
    })
    .await
}

#[tauri::command]
fn send_vnc_pointer_event(
    vnc_sessions: tauri::State<'_, vnc::VncSessionManager>,
    request: vnc::VncPointerEventRequest,
) -> Result<(), String> {
    vnc_sessions.pointer_event(request)
}

#[tauri::command]
fn send_vnc_key_event(
    vnc_sessions: tauri::State<'_, vnc::VncSessionManager>,
    request: vnc::VncKeyEventRequest,
) -> Result<(), String> {
    vnc_sessions.key_event(request)
}

#[tauri::command]
fn refresh_vnc_session(
    vnc_sessions: tauri::State<'_, vnc::VncSessionManager>,
    request: vnc::VncSimpleRequest,
) -> Result<(), String> {
    vnc_sessions.refresh(request)
}

#[tauri::command]
async fn close_vnc_session(
    app: tauri::AppHandle,
    request: vnc::VncSimpleRequest,
) -> Result<(), String> {
    run_blocking_command("VNC close", move || {
        let vnc_sessions = app.state::<vnc::VncSessionManager>();
        vnc_sessions.close_session(request)
    })
    .await
}

#[tauri::command]
fn get_vnc_session_status(
    vnc_sessions: tauri::State<'_, vnc::VncSessionManager>,
    request: vnc::VncSimpleRequest,
) -> Result<vnc::VncSessionStatus, String> {
    vnc_sessions.session_status(request)
}

#[tauri::command]
fn send_vnc_ctrl_alt_delete(
    vnc_sessions: tauri::State<'_, vnc::VncSessionManager>,
    request: vnc::VncSimpleRequest,
) -> Result<(), String> {
    vnc_sessions.send_ctrl_alt_delete(request)
}

#[tauri::command]
fn list_wiki_tree(storage: tauri::State<'_, storage::Storage>) -> Result<wiki::WikiTree, String> {
    wiki::list_wiki_tree(&storage)
}

#[tauri::command]
fn get_wiki_page(
    storage: tauri::State<'_, storage::Storage>,
    page_id: String,
) -> Result<wiki::WikiPage, String> {
    wiki::get_wiki_page(&storage, page_id)
}

#[tauri::command]
fn create_wiki_page(
    storage: tauri::State<'_, storage::Storage>,
    request: wiki::CreateWikiPageRequest,
) -> Result<wiki::WikiPage, String> {
    wiki::create_wiki_page(&storage, request)
}

#[tauri::command]
fn update_wiki_page(
    storage: tauri::State<'_, storage::Storage>,
    request: wiki::UpdateWikiPageRequest,
) -> Result<wiki::WikiPage, String> {
    wiki::update_wiki_page(&storage, request)
}

#[tauri::command]
fn delete_wiki_page(
    storage: tauri::State<'_, storage::Storage>,
    paths: tauri::State<'_, wiki::WikiPaths>,
    page_id: String,
) -> Result<(), String> {
    wiki::delete_wiki_page(&storage, &paths, page_id)
}

#[tauri::command]
fn move_wiki_page(
    storage: tauri::State<'_, storage::Storage>,
    request: wiki::MoveWikiPageRequest,
) -> Result<wiki::WikiTree, String> {
    wiki::move_wiki_page(&storage, request)
}

#[tauri::command]
fn search_wiki(
    storage: tauri::State<'_, storage::Storage>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<wiki::WikiSearchHit>, String> {
    wiki::search_wiki(&storage, query, limit.unwrap_or(20))
}

#[tauri::command]
fn list_wiki_pages_for_connection(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
) -> Result<Vec<wiki::WikiPageReference>, String> {
    wiki::list_wiki_pages_for_connection(&storage, connection_id)
}

#[tauri::command]
fn save_wiki_attachment(
    storage: tauri::State<'_, storage::Storage>,
    paths: tauri::State<'_, wiki::WikiPaths>,
    request: wiki::SaveWikiAttachmentRequest,
) -> Result<wiki::WikiAttachment, String> {
    wiki::save_wiki_attachment(&storage, &paths, request)
}

#[tauri::command]
fn delete_wiki_attachment(
    storage: tauri::State<'_, storage::Storage>,
    paths: tauri::State<'_, wiki::WikiPaths>,
    request: wiki::DeleteWikiAttachmentRequest,
) -> Result<(), String> {
    wiki::delete_wiki_attachment(&storage, &paths, request)
}

#[tauri::command]
fn export_wiki_zip(
    storage: tauri::State<'_, storage::Storage>,
    paths: tauri::State<'_, wiki::WikiPaths>,
    dest_path: String,
) -> Result<wiki::WikiExportInfo, String> {
    wiki::export_wiki_zip(&storage, &paths, std::path::PathBuf::from(dest_path))
}

#[tauri::command]
fn get_wiki_attachments_folder(paths: tauri::State<'_, wiki::WikiPaths>) -> Result<String, String> {
    Ok(paths.root().display().to_string())
}

#[cfg(target_os = "windows")]
fn configure_single_instance<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        focus_main_window(app);
    }))
}

#[cfg(not(target_os = "windows"))]
fn configure_single_instance<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
}

#[cfg(target_os = "windows")]
fn focus_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(main_window) = app.get_window(window_state::MAIN_WINDOW_LABEL) {
        if main_window.is_minimized().unwrap_or(false) {
            let _ = main_window.unminimize();
        }

        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();
    debug_heartbeat::start();

    configure_single_instance(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|error| {
                setup_error(format!("failed to resolve app data directory: {error}"))
            })?;
            let db_path = app_data_dir.join("kkterm.sqlite3");
            let wiki_paths = wiki::WikiPaths::new(app_data_dir);
            let storage = storage::Storage::open(db_path).map_err(setup_error)?;
            let general_settings = storage.general_settings().map_err(setup_error)?;
            let main_window_settings = storage.main_window_settings().map_err(setup_error)?;
            if let Err(error) = storage.backup_if_enabled_for_startup() {
                eprintln!("failed to create automatic database backup at startup: {error}");
            }
            if let Err(error) =
                auto_start::sync_auto_start_with_windows(general_settings.auto_start_with_windows())
            {
                eprintln!("{error}");
            }
            let webview_sessions =
                webview::WebviewSessionManager::new(general_settings.allow_clipboard_read());
            if let Some(main_webview) = app.get_webview_window(window_state::MAIN_WINDOW_LABEL) {
                webview::configure_shell_clipboard_read_permission(
                    &main_webview,
                    webview_sessions.clipboard_read_allowed_state(),
                )
                .map_err(setup_error)?;
            }
            if let Some(main_window) = app.get_window(window_state::MAIN_WINDOW_LABEL) {
                let title = format!("KKTerm v{}", env!("CARGO_PKG_VERSION"));
                main_window
                    .set_title(&title)
                    .map_err(|e| setup_error(e.to_string()))?;
                let initial_window_settings =
                    window_state::restore_main_window(&main_window, main_window_settings);
                app.manage(window_state::MainWindowState::new(initial_window_settings));
            }
            if let Err(error) = app_tray::install(app, "KKTerm") {
                eprintln!("{error}");
            }
            app.manage(app_tray::TrayState::new(
                general_settings.minimize_to_tray(),
            ));
            if general_settings.auto_start_with_windows() {
                if let Some(main_window) = app.get_window(window_state::MAIN_WINDOW_LABEL) {
                    let _ = main_window.minimize();
                    if general_settings.minimize_to_tray() {
                        let _ = main_window.hide();
                    }
                }
            }
            let power_manager = power::DontSleepManager::new();
            if general_settings.dont_sleep_enabled() {
                if let Err(error) = power_manager.set_enabled(true) {
                    eprintln!("failed to restore Don't Sleep state: {error}");
                }
            }
            app.manage(storage);
            app.manage(performance::PerformanceMonitor::new());
            app.manage(power_manager);
            app.manage(secrets::Secrets::new());
            app.manage(ai::AssistantLiveToolBridge::new());
            app.manage(ai::AssistantToolApprovalBridge::new());
            app.manage(sessions::SessionManager::new());
            app.manage(sftp::SftpSessionManager::new());
            app.manage(ftp::FtpSessionManager::new());
            app.manage(webview_sessions);
            app.manage(rdp::RdpSessionManager::new());
            app.manage(vnc::VncSessionManager::new());
            app.manage(wiki_paths);
            app.manage(std::sync::Arc::new(net::stream::StreamRegistry::new()));
            app.manage(std::sync::Arc::new(watchdog::WatchdogRegistry::new()));
            app.manage(std::sync::Arc::new(watchdog::SessionActivityTracker::new()));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != window_state::MAIN_WINDOW_LABEL {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                app_tray::hide_window_on_close_if_enabled(window, api);
            }

            if let Some(window_tracker) = window.try_state::<window_state::MainWindowState>() {
                match event {
                    tauri::WindowEvent::Resized(size) => {
                        if !window.is_maximized().unwrap_or(false) {
                            window_tracker.update_normal_size(*size);
                        }
                        if let Some(storage) = window.try_state::<storage::Storage>() {
                            if let Err(error) =
                                persist_main_window_state(window, &storage, &window_tracker)
                            {
                                eprintln!("failed to persist main window state: {error}");
                            }
                        }
                        app_tray::hide_minimized_window_if_enabled(window);
                    }
                    tauri::WindowEvent::Focused(false) => {
                        app_tray::hide_minimized_window_if_enabled(window);
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
            is_debug_build,
            debug_frontend_heartbeat,
            list_connection_tree,
            create_connection,
            create_connection_folder,
            rename_connection_folder,
            delete_connection_folder,
            rename_connection,
            update_connection,
            update_connection_icon_data_url,
            update_connection_icon_background_color,
            delete_connection,
            duplicate_connection,
            move_connection_folder,
            move_connection,
            update_url_connection_icon_from_page,
            upsert_url_credential,
            list_url_credentials,
            delete_url_credential,
            list_url_data_partitions,
            clear_url_data_partition,
            get_general_settings,
            update_general_settings,
            get_app_launcher_settings,
            update_app_launcher_settings,
            get_dashboard_settings,
            update_dashboard_settings,
            prepare_app_launcher_entry,
            launch_app_launcher_entry,
            import_settings_database,
            backup_settings_database,
            get_database_folder,
            get_terminal_settings,
            update_terminal_settings,
            get_appearance_settings,
            update_appearance_settings,
            get_custom_fonts_folder,
            open_custom_fonts_folder,
            list_custom_fonts,
            load_custom_font_data,
            get_ssh_settings,
            update_ssh_settings,
            generate_ssh_key_pair,
            transfer_ssh_public_key,
            get_sftp_settings,
            update_sftp_settings,
            get_url_settings,
            update_url_settings,
            get_rdp_settings,
            update_rdp_settings,
            get_vnc_settings,
            update_vnc_settings,
            get_screenshot_settings,
            update_screenshot_settings,
            get_ai_provider_settings,
            update_ai_provider_settings,
            list_assistant_skills,
            set_assistant_skill_enabled,
            open_assistant_skills_folder,
            open_assistant_skill,
            list_assistant_chat_threads,
            upsert_assistant_chat_thread,
            delete_assistant_chat_thread,
            start_github_copilot_device_flow,
            poll_github_copilot_device_flow,
            list_github_copilot_models,
            list_ai_provider_models,
            plan_command_proposal,
            complete_assistant_live_tool_request,
            complete_assistant_tool_approval_request,
            run_ai_agent,
            run_ai_agent_streaming,
            ai_coding_usage::ai_coding_usage_load,
            ai_coding_usage::ai_coding_usage_connect,
            ai_coding_usage::ai_coding_usage_refresh,
            ai_coding_usage::ai_coding_usage_disconnect,
            keychain_status,
            get_performance_snapshot,
            get_host_usage_snapshot,
            get_system_performance_counters,
            create_diagnostics_bundle,
            get_dont_sleep_enabled,
            set_dont_sleep_enabled,
            update_tray_menu,
            capture_screenshot_to_clipboard,
            capture_screenshot_for_assistant,
            capture_fullscreen_screenshot_for_assistant,
            capture_screenshot_to_library,
            capture_fullscreen_screenshot_to_library,
            capture_active_window_screenshot_to_library,
            capture_interactive_region_screenshot_to_library,
            list_screenshots,
            delete_screenshot,
            clear_screenshots,
            ssh_transport_plan,
            import_ssh_config,
            parse_import_file,
            list_browser_bookmark_sources,
            preview_browser_bookmark_import,
            scan_network_for_connections,
            inspect_ssh_host_key,
            trust_ssh_host_key,
            store_secret,
            secret_exists,
            delete_secret,
            list_stored_credentials,
            delete_stored_credential,
            start_terminal_session,
            write_terminal_input,
            resize_terminal,
            close_terminal_session,
            list_tmux_sessions,
            close_tmux_session,
            rename_tmux_session,
            set_tmux_mouse,
            capture_tmux_pane,
            inspect_ssh_system_context,
            list_remote_loopback_ports,
            start_ssh_port_forward,
            close_ssh_port_forward,
            launch_elevated_terminal,
            start_sftp_session,
            list_sftp_directory,
            list_local_directory,
            upload_sftp_path,
            download_sftp_path,
            cancel_sftp_transfer,
            create_sftp_folder,
            rename_sftp_path,
            delete_sftp_path,
            sftp_path_properties,
            update_sftp_path_properties,
            close_sftp_session,
            start_ftp_session,
            list_ftp_directory,
            upload_ftp_path,
            download_ftp_path,
            cancel_ftp_transfer,
            create_ftp_folder,
            rename_ftp_path,
            delete_ftp_path,
            ftp_path_properties,
            close_ftp_session,
            start_webview_session,
            update_webview_bounds,
            set_webview_visibility,
            webview_navigate,
            webview_reload,
            webview_go_back,
            webview_go_forward,
            fill_webview_credential,
            capture_webview_credential,
            close_webview_session,
            start_rdp_session,
            update_rdp_bounds,
            set_rdp_visibility,
            sync_rdp_display_size,
            close_rdp_session,
            get_rdp_session_status,
            send_rdp_ctrl_alt_delete,
            send_rdp_text,
            send_rdp_key_press,
            send_rdp_mouse_click,
            start_vnc_session,
            send_vnc_pointer_event,
            send_vnc_key_event,
            refresh_vnc_session,
            close_vnc_session,
            get_vnc_session_status,
            send_vnc_ctrl_alt_delete,
            list_wiki_tree,
            get_wiki_page,
            create_wiki_page,
            update_wiki_page,
            delete_wiki_page,
            move_wiki_page,
            search_wiki,
            list_wiki_pages_for_connection,
            save_wiki_attachment,
            delete_wiki_attachment,
            export_wiki_zip,
            get_wiki_attachments_folder,
            dashboard_commands::dashboard_load_state,
            dashboard_commands::dashboard_create_view,
            dashboard_commands::dashboard_update_view,
            dashboard_commands::dashboard_remove_view,
            dashboard_commands::dashboard_reorder_views,
            dashboard_commands::dashboard_add_instance,
            dashboard_commands::dashboard_update_instance,
            dashboard_commands::dashboard_read_widget_secret,
            dashboard_commands::dashboard_remove_instance,
            dashboard_commands::dashboard_apply_layout,
            dashboard_commands::dashboard_create_widget,
            dashboard_commands::dashboard_create_custom_widget,
            dashboard_commands::dashboard_update_custom_widget,
            dashboard_commands::dashboard_remove_custom_widget,
            dashboard_commands::dashboard_reset,
            dashboard_import_background_image,
            dashboard_load_background_image,
            mcp::mcp_list_servers,
            mcp::mcp_create_server,
            mcp::mcp_update_server,
            mcp::mcp_delete_server,
            mcp::mcp_refresh_tools,
            mcp::mcp_call_tool,
            manual::list_manual_chapters,
            manual::read_manual_chapter,
            net::commands::network_dns_lookup,
            net::commands::network_tcp_check,
            net::commands::network_interfaces,
            net::commands::network_wol,
            net::commands::network_whois,
            net::commands::network_ping_start,
            net::commands::network_port_scan_start,
            net::commands::network_stream_cancel,
            watchdog::commands::watchdog_create,
            watchdog::commands::watchdog_list,
            watchdog::commands::watchdog_cancel,
            watchdog::commands::watchdog_get_report,
            watchdog::commands::watchdog_record_intervention
        ])
        .run(tauri::generate_context!())
        .expect("error while running KKTerm");
}

fn setup_error(message: String) -> Box<dyn std::error::Error> {
    Box::new(std::io::Error::new(std::io::ErrorKind::Other, message))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_test_background_file(extension: &str, bytes: &[u8]) -> String {
        let folder = backgrounds_folder().expect("backgrounds folder");
        fs::create_dir_all(&folder).expect("create backgrounds folder");
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let file = format!("bg-test-{}-{nonce}.{extension}", std::process::id());
        fs::write(folder.join(&file), bytes).expect("write background test media");
        file
    }

    #[test]
    fn dashboard_load_background_video_returns_data_url() {
        let file = write_test_background_file("mp4", b"test-video-bytes");
        let result =
            dashboard_load_background_image_sync(file.clone()).expect("load background video");

        assert_eq!(result.path, None);
        assert_eq!(
            result.data_url,
            Some("data:video/mp4;base64,dGVzdC12aWRlby1ieXRlcw==".to_string())
        );

        let _ = fs::remove_file(backgrounds_folder().expect("backgrounds folder").join(file));
    }
}

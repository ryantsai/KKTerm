mod ai;
mod ai_coding_usage;
mod app_launcher;
mod app_tray;
mod app_updates;
mod assistant_skills;
mod auto_start;
mod currency_rates;
mod dashboard_commands;
mod dashboard_ids;
mod dashboard_storage;
mod dashboard_validation;
mod debug_heartbeat;
mod diagnostics;
mod favicon;
mod file_viewer;
mod ftp;
mod git;
mod github_copilot;
mod import;
mod installer;
mod itops;
mod linux_env;
mod logging;
mod manual;
mod mcp;
mod mcp_bridge;
mod mcp_tool_catalog;
mod media;
mod native_tooltip;
mod net;
mod pc_info;
mod performance;
mod power;
mod rdp;
#[cfg(not(target_os = "windows"))]
mod rdp_client;
mod screenshot;
mod screenshot_shortcuts;
mod secrets;
mod selective_export;
mod serial;
mod sessions;
mod sftp;
mod socks;
mod ssh;
mod ssh_config;
mod ssh_keys;
mod storage;
mod system_theme;
mod telnet;
mod vnc;
mod vt_text;
mod watchdog;
mod webview;
mod window_effects;
mod window_state;
#[cfg(target_os = "windows")]
mod windows_local_pty;
mod x_server;
#[allow(unused_imports)]
pub(crate) use media::*;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum BuiltInMcpConfigLocation {
    Codex,
    ClaudeCode,
    Antigravity,
    GithubCopilot,
    OpenCode,
}

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
    family: String,
    path: String,
    extension: String,
    weight: u16,
    style: String,
    #[serde(rename = "isMonospace")]
    is_monospaced: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemFontEntry {
    pub(crate) family: String,
    #[serde(rename = "isMonospace")]
    pub(crate) is_monospaced: bool,
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
    connection_type: Option<String>,
    host: Option<String>,
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
struct CreateConnectionPasswordCredentialRequest {
    connection_id: String,
    secret: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssignConnectionPasswordCredentialRequest {
    connection_id: String,
    credential_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FillWebviewCredentialRequest {
    session_id: String,
    connection_id: String,
    page_url: Option<String>,
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
fn debug_frontend_heartbeat(heartbeat: debug_heartbeat::FrontendHeartbeat) {
    debug_heartbeat::record_frontend_heartbeat(heartbeat);
}

#[tauri::command]
fn ui_debug_log(event: String, payload: serde_json::Value) {
    logging::ui_debug(&event, &payload);
}

#[tauri::command]
fn url_connection_debug_log(event: String, payload: serde_json::Value) {
    logging::url_connection_debug(&event, &payload);
}

#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(window_state::MAIN_WINDOW_LABEL) {
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn get_custom_fonts_folder(app: tauri::AppHandle) -> Result<String, String> {
    let folder = custom_fonts_folder(&app)?;
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
    let folder = custom_fonts_folder(&app)?;
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
fn open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    let folder = logging::log_dir()?;
    fs::create_dir_all(&folder)
        .map_err(|error| format!("failed to create log folder {}: {error}", folder.display()))?;
    app.opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("failed to open log folder {}: {error}", folder.display()))
}

#[tauri::command]
fn open_filesystem_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let requested_path = PathBuf::from(&path);
    let canonical_path = requested_path
        .canonicalize()
        .map_err(|error| format!("failed to resolve filesystem path {path}: {error}"))?;
    if is_windows_executable_path(&canonical_path) {
        return open_windows_executable_path(&requested_path);
    }
    app.opener()
        .open_path(canonical_path.to_string_lossy(), None::<&str>)
        .map_err(|error| {
            format!(
                "failed to open filesystem path {}: {error}",
                canonical_path.display()
            )
        })
}

fn is_windows_executable_path(path: &Path) -> bool {
    cfg!(target_os = "windows")
        && path.is_file()
        && path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
}

#[cfg(target_os = "windows")]
fn open_windows_executable_path(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let file = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    let working_directory = path.parent().map(|parent| {
        parent
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>()
    });
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            null(),
            file.as_ptr(),
            null(),
            working_directory
                .as_ref()
                .map(|value| value.as_ptr())
                .unwrap_or(null()),
            SW_SHOWNORMAL,
        )
    } as isize;

    if result <= 32 {
        return Err(format!("failed to launch executable {}", path.display()));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_windows_executable_path(path: &Path) -> Result<(), String> {
    Err(format!(
        "Windows executable launch is unavailable for {}",
        path.display()
    ))
}

#[tauri::command]
async fn list_custom_fonts(app: tauri::AppHandle) -> Result<Vec<CustomFontEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_custom_fonts_sync(&app))
        .await
        .map_err(|error| format!("failed to list custom fonts: {error}"))?
}

#[tauri::command]
async fn list_system_fonts() -> Result<Vec<SystemFontEntry>, String> {
    tauri::async_runtime::spawn_blocking(list_system_fonts_sync)
        .await
        .map_err(|error| format!("failed to list system fonts: {error}"))
}

#[tauri::command]
async fn load_custom_font_data(
    app: tauri::AppHandle,
    path: String,
) -> Result<CustomFontData, String> {
    tauri::async_runtime::spawn_blocking(move || load_custom_font_data_sync(&app, path))
        .await
        .map_err(|error| format!("failed to load custom font: {error}"))?
}

#[tauri::command]
async fn dashboard_import_background_image(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        dashboard_import_background_image_sync(&app, source_path)
    })
    .await
    .map_err(|error| format!("failed to import background image: {error}"))?
}

fn dashboard_import_background_image_sync(
    app: &tauri::AppHandle,
    source_path: String,
) -> Result<String, String> {
    use std::hash::{Hash, Hasher};

    let source = PathBuf::from(&source_path);
    let extension = background_media_extension(&source)
        .ok_or_else(|| background_media_extension_error().to_string())?;

    let bytes = fs::read(&source)
        .map_err(|error| format!("failed to read background image {source_path}: {error}"))?;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    let file_name = format!("bg-{:016x}.{extension}", hasher.finish());

    let folder = backgrounds_folder(app)?;
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
    app: tauri::AppHandle,
    file: String,
) -> Result<DashboardBackgroundImageData, String> {
    tauri::async_runtime::spawn_blocking(move || dashboard_load_background_image_sync(&app, file))
        .await
        .map_err(|error| format!("failed to load background image: {error}"))?
}

fn dashboard_load_background_image_sync(
    app: &tauri::AppHandle,
    file: String,
) -> Result<DashboardBackgroundImageData, String> {
    let folder = backgrounds_folder(app)?;
    load_background_image_from_folder(&folder, file)
}

fn load_background_image_from_folder(
    folder: &Path,
    file: String,
) -> Result<DashboardBackgroundImageData, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    if file.is_empty() || file.contains('/') || file.contains('\\') || file.contains("..") {
        return Err("invalid background image file name".to_string());
    }

    fs::create_dir_all(folder).map_err(|error| {
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

#[tauri::command]
fn list_connection_tree(
    storage: tauri::State<'_, storage::Storage>,
    workspace_id: Option<String>,
) -> Result<storage::ConnectionTree, String> {
    match workspace_id {
        Some(workspace_id) => storage.list_connection_tree_for_workspace(workspace_id),
        None => storage.list_connection_tree(),
    }
}

#[tauri::command]
fn list_workspaces(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<Vec<storage::Workspace>, String> {
    storage.list_workspaces()
}

#[tauri::command]
fn create_workspace(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::CreateWorkspaceRequest,
) -> Result<storage::Workspace, String> {
    storage.create_workspace(request)
}

#[tauri::command]
fn rename_workspace(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::RenameWorkspaceRequest,
) -> Result<storage::Workspace, String> {
    storage.rename_workspace(request)
}

#[tauri::command]
fn delete_workspace(storage: tauri::State<'_, storage::Storage>, id: String) -> Result<(), String> {
    storage.delete_workspace(id)
}

#[tauri::command]
fn reorder_workspaces(
    storage: tauri::State<'_, storage::Storage>,
    request: storage::ReorderWorkspacesRequest,
) -> Result<Vec<storage::Workspace>, String> {
    storage.reorder_workspaces(request)
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
fn update_connection_folder_icon_data_url(
    storage: tauri::State<'_, storage::Storage>,
    folder_id: String,
    icon_data_url: Option<String>,
) -> Result<storage::ConnectionFolder, String> {
    storage.update_connection_folder_icon_data_url(folder_id, icon_data_url)
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
fn update_connection_icon_color(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
    icon_color: Option<String>,
) -> Result<Option<storage::SavedConnection>, String> {
    storage.update_connection_icon_color(connection_id, icon_color)
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
fn update_connection_file_browser_view_options(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
    view_options: Option<storage::FileBrowserViewOptions>,
) -> Result<Option<storage::SavedConnection>, String> {
    storage.update_connection_file_browser_view_options(connection_id, view_options)
}

#[tauri::command]
fn update_connection_ssh_port_forwardings(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
    forwardings: Option<Vec<storage::SshPortForwarding>>,
) -> Result<Option<storage::SavedConnection>, String> {
    storage.update_connection_ssh_port_forwardings(connection_id, forwardings)
}

#[tauri::command]
fn update_connection_terminal_appearance(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
    terminal_opacity: Option<u8>,
    terminal_background: Option<dashboard_storage::DashboardBackground>,
) -> Result<Option<storage::SavedConnection>, String> {
    storage.update_connection_terminal_appearance(
        connection_id,
        terminal_opacity,
        terminal_background,
    )
}

#[tauri::command]
fn update_connection_terminal_color_scheme(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
    terminal_color_scheme: Option<String>,
) -> Result<Option<storage::SavedConnection>, String> {
    storage.update_connection_terminal_color_scheme(connection_id, terminal_color_scheme)
}

#[tauri::command]
fn update_connection_tab_title(
    storage: tauri::State<'_, storage::Storage>,
    connection_id: String,
    tab_title: Option<String>,
) -> Result<Option<storage::SavedConnection>, String> {
    storage.update_connection_tab_title(connection_id, tab_title)
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
fn list_serial_ports() -> Vec<String> {
    serial::available_serial_ports()
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
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    tray_state: tauri::State<'_, app_tray::TrayState>,
    power: tauri::State<'_, power::DontSleepManager>,
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: storage::GeneralSettings,
) -> Result<storage::GeneralSettings, String> {
    auto_start::sync_auto_start_with_windows(request.auto_start_with_windows())?;
    let saved = storage.update_general_settings(request)?;
    net::proxy::set(net::proxy::from_settings(
        saved.proxy_mode(),
        saved.proxy_url(),
    ));
    logging::set_advanced_debugging_enabled(saved.advanced_debugging_enabled());
    debug_heartbeat::start(app);
    tray_state.set_minimize_to_tray(saved.minimize_to_tray());
    if let Err(error) = power.set_foreground_only(saved.dont_sleep_foreground_only()) {
        eprintln!("failed to apply Don't Sleep foreground setting: {error}");
    }
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
fn get_credential_settings(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<storage::CredentialSettings, String> {
    storage.credential_settings()
}

#[tauri::command]
fn update_credential_settings(
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
    request: storage::CredentialSettings,
) -> Result<storage::CredentialSettings, String> {
    let settings = storage::validate_credential_settings_for_command(request)?;
    secrets.set_secret_store(settings.secret_store())?;
    storage.update_credential_settings(settings)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigureEncryptedFileSecretStoreResult {
    settings: storage::CredentialSettings,
    status: secrets::KeychainStatus,
}

#[tauri::command]
fn configure_encrypted_file_secret_store(
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
    request: secrets::ConfigureEncryptedFileSecretStoreRequest,
) -> Result<ConfigureEncryptedFileSecretStoreResult, String> {
    let status = secrets.configure_encrypted_file_store(request)?;
    let mut settings = storage.credential_settings()?;
    settings.secret_store = "file".to_string();
    let settings = storage::validate_credential_settings_for_command(settings)?;
    let settings = storage.update_credential_settings(settings)?;
    Ok(ConfigureEncryptedFileSecretStoreResult { settings, status })
}

/// Frontend -> backend push of a script widget's latest runtime-health state
/// (from `ScriptWidgetHost`'s smoke test / watchdog) so the assistant's
/// `dashboard_check_widget_health` tool can read it in the same turn.
#[tauri::command]
fn dashboard_report_widget_health(
    registry: tauri::State<'_, ai::WidgetHealthRegistry>,
    instance_id: String,
    state: String,
    error: Option<String>,
) {
    registry.report(instance_id, state, error);
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
async fn import_settings_database(
    app: tauri::AppHandle,
    path: String,
) -> Result<storage::ImportedDatabaseSnapshot, String> {
    let worker_app = app.clone();
    let (snapshot, general_settings, credential_settings) =
        run_blocking_database_command("settings database import", move || {
            let storage = worker_app.state::<storage::Storage>();
            let snapshot = storage.import_database_zip(path.into())?;
            let general_settings = storage.general_settings()?;
            let credential_settings = storage.credential_settings()?;
            Ok((snapshot, general_settings, credential_settings))
        })
        .await?;
    let secrets = app.state::<secrets::Secrets>();
    let tray_state = app.state::<app_tray::TrayState>();
    let power = app.state::<power::DontSleepManager>();
    let webviews = app.state::<webview::WebviewSessionManager>();
    secrets.set_secret_store(credential_settings.secret_store())?;
    logging::set_advanced_debugging_enabled(general_settings.advanced_debugging_enabled());
    debug_heartbeat::start(app.clone());
    tray_state.set_minimize_to_tray(general_settings.minimize_to_tray());
    if let Err(error) = power.set_foreground_only(general_settings.dont_sleep_foreground_only()) {
        eprintln!("failed to apply imported Don't Sleep foreground setting: {error}");
    }
    if let Err(error) = power.set_enabled(general_settings.dont_sleep_enabled()) {
        eprintln!("failed to apply imported Don't Sleep setting: {error}");
    }
    webviews.set_clipboard_read_allowed(general_settings.allow_clipboard_read());
    if let Some(main_webview) = app.get_webview_window(window_state::MAIN_WINDOW_LABEL) {
        window_effects::apply_title_bar_mode(&main_webview);
    }
    Ok(snapshot)
}

#[tauri::command]
async fn export_settings_database(
    app: tauri::AppHandle,
    path: String,
) -> Result<storage::DatabaseBackupInfo, String> {
    run_blocking_database_command("settings database export", move || {
        app.state::<storage::Storage>().export_database(path.into())
    })
    .await
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

fn main_window_is_foreground(window: &tauri::Window) -> bool {
    let focused = window.is_focused().unwrap_or(true);
    let minimized = window.is_minimized().unwrap_or(false);
    focused && !minimized
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
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    request: storage::AppearanceSettings,
) -> Result<storage::AppearanceSettings, String> {
    let saved = storage.update_appearance_settings(request)?;
    if let Some(main_webview) = app.get_webview_window(window_state::MAIN_WINDOW_LABEL) {
        window_effects::apply_title_bar_mode(&main_webview);
    }
    Ok(saved)
}

#[tauri::command]
fn get_system_accent_color() -> Option<system_theme::SystemAccentColor> {
    system_theme::system_accent_color()
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
async fn launch_ssh_x_server(
    app: tauri::AppHandle,
) -> Result<x_server::XServerLaunchResult, String> {
    run_blocking_command("X server launch", move || {
        let settings = app.state::<storage::Storage>().ssh_settings()?;
        x_server::launch_vcxsrv_if_needed(
            settings.x_server_path(),
            settings.x_server_display(),
            Some(settings.x_server_args()),
        )
    })
    .await
}

#[tauri::command]
async fn restart_ssh_x_server(
    storage: tauri::State<'_, storage::Storage>,
) -> Result<x_server::XServerLaunchResult, String> {
    let settings = storage.ssh_settings()?;
    let path = settings.x_server_path().map(str::to_string);
    let display = settings.x_server_display();
    let args = settings.x_server_args().to_string();
    run_blocking_command("X server restart", move || {
        x_server::restart_vcxsrv(path.as_deref(), display, Some(args.as_str()))
    })
    .await
}

#[tauri::command]
async fn stop_ssh_x_server() -> Result<(), String> {
    run_blocking_command("X server stop", x_server::stop_vcxsrv).await
}

#[tauri::command]
async fn generate_ssh_key_pair(
    request: ssh_keys::GenerateSshKeyPairRequest,
) -> Result<ssh_keys::GeneratedSshKeyPair, String> {
    run_blocking_command("SSH key generation", move || {
        ssh_keys::generate_key_pair(request)
    })
    .await
}

#[tauri::command]
async fn transfer_ssh_public_key(
    app: tauri::AppHandle,
    mut request: ssh_keys::TransferSshPublicKeyRequest,
) -> Result<ssh_keys::TransferSshPublicKeyResult, String> {
    let secrets = app.state::<secrets::Secrets>();
    let transfer_has_proxy_jump = trimmed_optional(request.proxy_jump.clone()).is_some();
    request.ssh_socks_proxy = resolve_ssh_socks_proxy(
        &secrets,
        request.ssh_socks_proxy.take(),
        request.ssh_socks_proxy_username.take(),
        request.ssh_socks_proxy_secret_owner_id.take(),
        transfer_has_proxy_jump,
    )?;
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
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    request: storage::ScreenshotSettings,
) -> Result<storage::ScreenshotSettings, String> {
    screenshot_shortcuts::validate(&request)?;
    let saved = storage.update_screenshot_settings(request)?;
    screenshot_shortcuts::apply(&app, &saved)?;
    Ok(saved)
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
    assistant_skills::list_skill_summaries(
        &root,
        settings.disabled_skill_names(),
        settings.custom_skills_enabled(),
    )
}

#[tauri::command]
fn set_custom_assistant_skills_enabled(
    storage: tauri::State<'_, storage::Storage>,
    enabled: bool,
) -> Result<storage::AiProviderSettings, String> {
    let mut settings = storage.ai_provider_settings()?;
    settings.set_custom_skills_enabled(enabled);
    storage.update_ai_provider_settings(settings)
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
fn open_custom_assistant_skills_folder(app: tauri::AppHandle) -> Result<(), String> {
    assistant_skills::open_custom_skills_folder(&app)
}

#[tauri::command]
fn get_built_in_mcp_command_path() -> Result<String, String> {
    let exe_path = std::env::current_exe()
        .map_err(|error| format!("failed to resolve app executable path: {error}"))?;
    let exe_folder = exe_path
        .parent()
        .ok_or_else(|| "failed to resolve app executable folder".to_string())?;
    let cli_name = if cfg!(target_os = "windows") {
        "kkterm-cli.exe"
    } else {
        "kkterm-cli"
    };
    Ok(exe_folder.join(cli_name).to_string_lossy().into_owned())
}

#[tauri::command]
fn open_built_in_mcp_config_location(location: BuiltInMcpConfigLocation) -> Result<(), String> {
    let path = built_in_mcp_config_path(location)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create MCP config folder {}: {error}",
                parent.display()
            )
        })?;
    }
    if !path.exists() {
        fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(|error| {
                format!(
                    "failed to create MCP config file {}: {error}",
                    path.display()
                )
            })?;
    }
    std::process::Command::new("notepad.exe")
        .arg(&path)
        .spawn()
        .map_err(|error| {
            format!(
                "failed to open MCP config file {} in Notepad: {error}",
                path.display()
            )
        })?;
    Ok(())
}

fn built_in_mcp_config_path(location: BuiltInMcpConfigLocation) -> Result<PathBuf, String> {
    let user_profile = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "failed to resolve user profile folder".to_string())?;

    match location {
        BuiltInMcpConfigLocation::Codex => Ok(user_profile.join(".codex").join("config.toml")),
        BuiltInMcpConfigLocation::ClaudeCode => Ok(user_profile.join(".claude.json")),
        BuiltInMcpConfigLocation::Antigravity => Ok(user_profile
            .join(".gemini")
            .join("antigravity")
            .join("mcp_config.json")),
        BuiltInMcpConfigLocation::GithubCopilot => {
            let app_data = std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| user_profile.join("AppData").join("Roaming"));
            Ok(app_data.join("Code").join("User").join("mcp.json"))
        }
        BuiltInMcpConfigLocation::OpenCode => Ok(user_profile
            .join(".config")
            .join("opencode")
            .join("opencode.json")),
    }
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
fn list_durable_ui_state(
    storage: tauri::State<'_, storage::Storage>,
    prefix: String,
) -> Result<Vec<storage::DurableUiStateRecord>, String> {
    storage.list_durable_ui_state(prefix)
}

#[tauri::command]
fn get_durable_ui_state(
    storage: tauri::State<'_, storage::Storage>,
    key: String,
) -> Result<Option<String>, String> {
    storage.get_durable_ui_state(key)
}

#[tauri::command]
fn set_durable_ui_state(
    storage: tauri::State<'_, storage::Storage>,
    key: String,
    value: String,
) -> Result<(), String> {
    storage.set_durable_ui_state(key, value)
}

#[tauri::command]
fn delete_durable_ui_state(
    storage: tauri::State<'_, storage::Storage>,
    key: String,
) -> Result<(), String> {
    storage.delete_durable_ui_state(key)
}

#[tauri::command]
fn delete_durable_ui_state_by_prefix(
    storage: tauri::State<'_, storage::Storage>,
    prefix: String,
) -> Result<(), String> {
    storage.delete_durable_ui_state_by_prefix(prefix)
}

#[tauri::command]
async fn start_github_copilot_device_flow()
-> Result<github_copilot::GitHubCopilotDeviceFlow, String> {
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
async fn get_github_copilot_cli_status() -> Result<ai::GitHubCopilotCliStatus, String> {
    Ok(ai::github_copilot_cli_status_async().await)
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
async fn get_ai_cli_backend_status(
    storage: tauri::State<'_, storage::Storage>,
    provider: ai::AiCliBackendKind,
) -> Result<ai::AiCliBackendStatus, String> {
    let settings = storage.ai_provider_settings()?;
    let configured_path = match provider {
        ai::AiCliBackendKind::Codex => settings.codex_cli_path().map(str::to_string),
        ai::AiCliBackendKind::ClaudeCode => settings.claude_cli_path().map(str::to_string),
        ai::AiCliBackendKind::Cursor => settings.cursor_cli_path().map(str::to_string),
    };
    Ok(ai::ai_cli_backend_status(provider, configured_path).await)
}

#[tauri::command]
fn open_ai_cli_backend_auth(
    storage: tauri::State<'_, storage::Storage>,
    provider: ai::AiCliBackendKind,
) -> Result<(), String> {
    let settings = storage.ai_provider_settings()?;
    let configured_path = match provider {
        ai::AiCliBackendKind::Codex => settings.codex_cli_path().map(str::to_string),
        ai::AiCliBackendKind::ClaudeCode => settings.claude_cli_path().map(str::to_string),
        ai::AiCliBackendKind::Cursor => settings.cursor_cli_path().map(str::to_string),
    };
    ai::open_ai_cli_backend_auth(provider, configured_path)
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
fn cancel_assistant_streams(app: tauri::AppHandle) {
    ai::cancel_assistant_streams(&app);
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

fn resolve_ssh_socks_proxy(
    secrets: &secrets::Secrets,
    proxy: Option<String>,
    username: Option<String>,
    secret_owner_id: Option<String>,
    has_proxy_jump: bool,
) -> Result<Option<String>, String> {
    let password = match trimmed_optional(username.clone()) {
        Some(_) => match trimmed_optional(secret_owner_id) {
            Some(owner_id) => secrets
                .read_ssh_socks_proxy_password(owner_id)
                .map_err(|error| format!("failed to read SOCKS proxy password: {error}"))?,
            None => None,
        },
        None => None,
    };
    let composed = compose_ssh_socks_proxy(proxy, username, password)?;
    // A per-Connection SOCKS proxy wins. Otherwise fall back to the global app
    // proxy (Settings → Proxy) when it is a manual SOCKS5 endpoint —
    // but never when the Connection uses ProxyJump, which is its own mutually
    // exclusive reachability path.
    if composed.is_none() && !has_proxy_jump {
        return Ok(net::proxy::socks_endpoint());
    }
    Ok(composed)
}

fn compose_ssh_socks_proxy(
    proxy: Option<String>,
    username: Option<String>,
    password: Option<String>,
) -> Result<Option<String>, String> {
    let Some(proxy) = trimmed_optional(proxy) else {
        return Ok(None);
    };
    let Some(username) = trimmed_optional(username) else {
        return crate::socks::validate_socks_proxy(&proxy).map(Some);
    };
    let Some(password) = password else {
        return crate::socks::validate_socks_proxy(&proxy).map(Some);
    };
    if password.is_empty() {
        return crate::socks::validate_socks_proxy(&proxy).map(Some);
    }
    let proxy_with_credentials = format!("{username}:{password}@{proxy}");
    crate::socks::validate_socks_proxy(&proxy_with_credentials).map(Some)
}

fn trimmed_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[tauri::command]
fn keychain_status(secrets: tauri::State<'_, secrets::Secrets>) -> secrets::KeychainStatus {
    secrets.status()
}

#[tauri::command]
fn credential_secret_store_status(
    secrets: tauri::State<'_, secrets::Secrets>,
) -> secrets::CredentialSecretStoreStatus {
    secrets.credential_secret_store_status()
}

#[tauri::command]
fn lock_encrypted_file_secret_store(
    secrets: tauri::State<'_, secrets::Secrets>,
) -> Result<secrets::CredentialSecretStoreStatus, String> {
    secrets.lock_encrypted_file_store()
}

#[tauri::command]
fn get_performance_snapshot(
    performance: tauri::State<'_, performance::PerformanceMonitor>,
) -> performance::PerformanceSnapshot {
    performance.snapshot()
}

#[tauri::command]
async fn get_host_usage_snapshot(
    app: tauri::AppHandle,
) -> Result<performance::HostUsageSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<performance::PerformanceMonitor>()
            .host_usage_snapshot()
    })
    .await
    .map_err(|error| format!("host usage sampling task failed: {error}"))
}

#[tauri::command]
async fn get_system_performance_counters(
    app: tauri::AppHandle,
) -> Result<performance::SystemPerformanceCountersSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<performance::PerformanceMonitor>()
            .system_performance_counters_snapshot()
    })
    .await
    .map_err(|error| format!("system performance sampling task failed: {error}"))
}

#[tauri::command]
async fn pc_info_get(app: tauri::AppHandle) -> Result<pc_info::PcInfoSnapshot, String> {
    // Cheap when cached; only the first call spawns the collector process. The
    // gather runs on the blocking pool so the OS-command wait never stalls the
    // async runtime or the UI.
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<pc_info::PcInfoCache>().get_or_gather()
    })
    .await
    .map_err(|error| format!("PC info collection task failed: {error}"))
}

#[tauri::command]
async fn pc_info_refresh(app: tauri::AppHandle) -> Result<pc_info::PcInfoSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<pc_info::PcInfoCache>().refresh())
        .await
        .map_err(|error| format!("PC info refresh task failed: {error}"))
}

#[tauri::command]
fn open_windows_task_manager() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("taskmgr.exe")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("failed to open Windows Task Manager: {error}"))
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", "Activity Monitor"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("failed to open Activity Monitor: {error}"))
    }

    #[cfg(target_os = "linux")]
    {
        // No single activity monitor exists across desktops; launch the first
        // installed one, GNOME first since Fedora/Ubuntu default to it.
        const MONITORS: [&str; 6] = [
            "gnome-system-monitor",
            "plasma-systemmonitor",
            "ksysguard",
            "xfce4-taskmanager",
            "mate-system-monitor",
            "lxtask",
        ];
        for program in MONITORS {
            match linux_env::spawn_detached_host_process(std::process::Command::new(program)) {
                Ok(()) => return Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(format!("failed to open {program}: {error}"));
                }
            }
        }
        Err("no system activity monitor application was found".to_string())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Opening the system activity monitor is not supported on this platform.".to_string())
    }
}

#[tauri::command]
async fn create_diagnostics_bundle(
    app: tauri::AppHandle,
) -> Result<diagnostics::DiagnosticsBundle, String> {
    run_blocking_command("diagnostics bundle creation", move || {
        let performance = app.state::<performance::PerformanceMonitor>();
        diagnostics::create_bundle(&app, &performance)
    })
    .await
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
async fn capture_screenshot_to_clipboard(
    app: tauri::AppHandle,
    request: screenshot::CaptureScreenshotRequest,
) -> Result<(), String> {
    run_blocking_screenshot_command("screenshot clipboard capture", move || {
        let settings = app.state::<storage::Storage>().general_settings()?;
        screenshot::capture_rect_to_clipboard(&app, request, settings.use_directx_screen_capture())
    })
    .await
}

#[tauri::command]
async fn write_screenshot_data_url_to_clipboard(
    app: tauri::AppHandle,
    request: screenshot::ScreenshotDataUrlRequest,
) -> Result<(), String> {
    run_blocking_screenshot_command("stitched screenshot clipboard write", move || {
        screenshot::write_data_url_to_clipboard(&app, request)
    })
    .await
}

#[tauri::command]
async fn capture_screenshot_for_assistant(
    app: tauri::AppHandle,
    request: screenshot::CaptureScreenshotRequest,
) -> Result<screenshot::AssistantScreenshot, String> {
    run_blocking_screenshot_command("assistant screenshot capture", move || {
        let settings = app.state::<storage::Storage>().general_settings()?;
        screenshot::capture_rect_for_assistant(&app, request, settings.use_directx_screen_capture())
    })
    .await
}

#[tauri::command]
async fn capture_fullscreen_screenshot_for_assistant(
    app: tauri::AppHandle,
) -> Result<screenshot::AssistantScreenshot, String> {
    run_blocking_screenshot_command("assistant fullscreen screenshot capture", move || {
        let settings = app.state::<storage::Storage>().general_settings()?;
        screenshot::capture_fullscreen_for_assistant(settings.use_directx_screen_capture())
    })
    .await
}

/// Resolves the persisted library save options plus the DirectX capture flag
/// shared by every capture-to-library command.
fn screenshot_library_context(
    app: &tauri::AppHandle,
) -> Result<(screenshot::LibrarySaveOptions, bool), String> {
    let storage = app.state::<storage::Storage>();
    let settings = storage.screenshot_settings()?;
    let general_settings = storage.general_settings()?;
    Ok((
        screenshot::LibrarySaveOptions {
            folder_path: settings.folder_path().to_string(),
            format: settings.format().to_string(),
            jpeg_quality: settings.jpeg_quality(),
        },
        general_settings.use_directx_screen_capture(),
    ))
}

#[tauri::command]
async fn capture_screenshot_to_library(
    app: tauri::AppHandle,
    request: screenshot::CaptureScreenshotRequest,
    kind: String,
) -> Result<screenshot::StoredScreenshot, String> {
    run_blocking_screenshot_command("screenshot library capture", move || {
        let (options, use_directx) = screenshot_library_context(&app)?;
        screenshot::capture_rect_to_library(&app, request, kind, options, use_directx)
    })
    .await
}

#[tauri::command]
async fn capture_fullscreen_screenshot_to_library(
    app: tauri::AppHandle,
    kind: String,
) -> Result<screenshot::StoredScreenshot, String> {
    run_blocking_screenshot_command("fullscreen screenshot library capture", move || {
        let (options, use_directx) = screenshot_library_context(&app)?;
        screenshot::capture_fullscreen_to_library(&app, kind, options, use_directx)
    })
    .await
}

#[tauri::command]
async fn capture_active_window_screenshot_to_library(
    app: tauri::AppHandle,
    kind: String,
) -> Result<screenshot::StoredScreenshot, String> {
    run_blocking_screenshot_command("active-window screenshot library capture", move || {
        let (options, use_directx) = screenshot_library_context(&app)?;
        screenshot::capture_active_window_to_library(&app, kind, options, use_directx)
    })
    .await
}

#[tauri::command]
async fn capture_interactive_region_screenshot_to_library(
    app: tauri::AppHandle,
    kind: String,
) -> Result<screenshot::StoredScreenshot, String> {
    run_blocking_screenshot_command("interactive screenshot library capture", move || {
        let (options, use_directx) = screenshot_library_context(&app)?;
        screenshot::capture_interactive_region_to_library(&app, kind, options, use_directx)
    })
    .await
}

#[tauri::command]
async fn list_screenshots(
    app: tauri::AppHandle,
    request: screenshot::ListScreenshotsRequest,
) -> Result<screenshot::ListScreenshotsResponse, String> {
    run_blocking_screenshot_command("screenshot library listing", move || {
        let settings = app.state::<storage::Storage>().screenshot_settings()?;
        screenshot::list_library_screenshots(request, settings.folder_path().to_string())
    })
    .await
}

#[tauri::command]
async fn delete_screenshot(app: tauri::AppHandle, id: String) -> Result<(), String> {
    run_blocking_screenshot_command("screenshot deletion", move || {
        let settings = app.state::<storage::Storage>().screenshot_settings()?;
        screenshot::delete_library_screenshot(id, settings.folder_path().to_string())
    })
    .await
}

#[tauri::command]
async fn clear_screenshots(app: tauri::AppHandle) -> Result<(), String> {
    run_blocking_screenshot_command("screenshot library clearing", move || {
        let settings = app.state::<storage::Storage>().screenshot_settings()?;
        screenshot::clear_library_screenshots(settings.folder_path().to_string())
    })
    .await
}

#[tauri::command]
async fn read_screenshot(
    app: tauri::AppHandle,
    id: String,
) -> Result<screenshot::FullScreenshot, String> {
    run_blocking_screenshot_command("screenshot loading", move || {
        let settings = app.state::<storage::Storage>().screenshot_settings()?;
        screenshot::read_library_screenshot(id, settings.folder_path().to_string())
    })
    .await
}

#[tauri::command]
async fn rename_screenshot(
    app: tauri::AppHandle,
    id: String,
    new_name: String,
) -> Result<screenshot::StoredScreenshot, String> {
    run_blocking_screenshot_command("screenshot renaming", move || {
        let settings = app.state::<storage::Storage>().screenshot_settings()?;
        screenshot::rename_library_screenshot(id, new_name, settings.folder_path().to_string())
    })
    .await
}

#[tauri::command]
async fn copy_stored_screenshot_to_clipboard(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    run_blocking_screenshot_command("screenshot clipboard copy", move || {
        let settings = app.state::<storage::Storage>().screenshot_settings()?;
        screenshot::copy_library_screenshot_to_clipboard(
            &app,
            id,
            settings.folder_path().to_string(),
        )
    })
    .await
}

#[tauri::command]
fn open_screenshots_folder(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
) -> Result<(), String> {
    let settings = storage.screenshot_settings()?;
    let folder = storage::expand_screenshot_folder_path(settings.folder_path());
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "failed to create screenshots folder {}: {error}",
            folder.display()
        )
    })?;
    app.opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|error| {
            format!(
                "failed to open screenshots folder {}: {error}",
                folder.display()
            )
        })
}

#[tauri::command]
fn reveal_screenshot(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    id: String,
) -> Result<(), String> {
    let settings = storage.screenshot_settings()?;
    let path = screenshot::library_screenshot_path(&id, settings.folder_path())?;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|error| format!("failed to reveal screenshot {}: {error}", path.display()))
}

#[tauri::command]
fn open_screenshot_file(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::Storage>,
    id: String,
) -> Result<(), String> {
    let settings = storage.screenshot_settings()?;
    let path = screenshot::library_screenshot_path(&id, settings.folder_path())?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("failed to open screenshot {}: {error}", path.display()))
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
async fn inspect_ssh_host_key(
    app: tauri::AppHandle,
    mut request: ssh::InspectSshHostKeyRequest,
) -> Result<ssh::SshHostKeyPreview, String> {
    run_blocking_command("SSH host-key inspection", move || {
        let secrets = app.state::<secrets::Secrets>();
        request.ssh_socks_proxy = resolve_ssh_socks_proxy(
            &secrets,
            request.ssh_socks_proxy.take(),
            request.ssh_socks_proxy_username.take(),
            request.ssh_socks_proxy_secret_owner_id.take(),
            // Host-key inspection has no ProxyJump path; a global SOCKS5 proxy is
            // the only routing it can apply.
            false,
        )?;
        ssh::inspect_host_key(ssh::app_known_hosts_path(&app)?, request)
    })
    .await
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
fn read_url_credential_password(
    secrets: tauri::State<'_, secrets::Secrets>,
    owner_id: String,
) -> Result<Option<String>, String> {
    let owner_id = owner_id.trim().to_string();
    if owner_id.is_empty() {
        return Err("URL credential owner id is required".to_string());
    }
    secrets.read_url_password(owner_id)
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
                connection_type: candidate.connection_type,
                host: candidate.host,
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
fn list_connection_password_credentials(
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
) -> Result<Vec<storage::ConnectionPasswordCredentialSummary>, String> {
    let credentials = storage.list_connection_password_credentials()?;
    let mut existing_credentials = Vec::new();
    for credential in credentials {
        let exists = secrets
            .secret_exists(secrets::SecretReferenceRequest::connection_password(
                credential.id.clone(),
            ))?
            .exists();
        if exists {
            existing_credentials.push(credential);
        }
    }
    Ok(existing_credentials)
}

#[tauri::command]
fn create_connection_password_credential(
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
    request: CreateConnectionPasswordCredentialRequest,
) -> Result<storage::SavedConnection, String> {
    let secret = request.secret;
    if secret.is_empty() {
        return Err("secret value is required".to_string());
    }
    let credential =
        storage.create_connection_password_credential_metadata(request.connection_id.clone())?;
    if let Err(error) = secrets.store_secret(secrets::StoreSecretRequest::connection_password(
        credential.id.clone(),
        secret,
    )) {
        let _ = storage.delete_connection_password_credential_metadata(credential.id);
        return Err(error);
    }
    match storage
        .assign_connection_password_credential(request.connection_id, credential.id.clone())
    {
        Ok(connection) => Ok(connection),
        Err(error) => {
            let _ = secrets.delete_secret(secrets::SecretReferenceRequest::connection_password(
                credential.id.clone(),
            ));
            let _ = storage.delete_connection_password_credential_metadata(credential.id);
            Err(error)
        }
    }
}

#[tauri::command]
fn assign_connection_password_credential(
    storage: tauri::State<'_, storage::Storage>,
    secrets: tauri::State<'_, secrets::Secrets>,
    request: AssignConnectionPasswordCredentialRequest,
) -> Result<storage::SavedConnection, String> {
    let presence = secrets.secret_exists(secrets::SecretReferenceRequest::connection_password(
        request.credential_id.clone(),
    ))?;
    if !presence.exists() {
        return Err("stored password was not found".to_string());
    }
    storage.assign_connection_password_credential(request.connection_id, request.credential_id)
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
        "connectionPassword" => secrets
            .delete_secret(secrets::SecretReferenceRequest::connection_password(
                owner_id.clone(),
            ))
            .and_then(|_| storage.delete_connection_password_credential_metadata(owner_id)),
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
        "emailSmtpPassword" => Ok(secrets::SecretReferenceRequest::email_smtp_password(
            owner_id,
        )),
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
fn local_shell_available(shell: String) -> bool {
    sessions::local_shell_available(&shell)
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
fn set_terminal_encoding(
    sessions: tauri::State<'_, sessions::SessionManager>,
    request: sessions::SetTerminalEncodingRequest,
) -> Result<(), String> {
    sessions.set_terminal_encoding(request)
}

#[tauri::command]
fn close_terminal_session(
    app: tauri::AppHandle,
    sessions: tauri::State<'_, sessions::SessionManager>,
    session_id: String,
) -> Result<(), String> {
    // Drop the watchdog activity-tracker entry so the per-session tail buffer
    // doesn't leak across the app lifetime and a silence watchdog stops
    // measuring against a session that no longer exists.
    if let Some(tracker) = app.try_state::<std::sync::Arc<watchdog::SessionActivityTracker>>() {
        tracker.forget(&session_id);
    }
    sessions.close_terminal_session(session_id)
}

#[tauri::command]
fn start_terminal_recording(
    app: tauri::AppHandle,
    sessions: tauri::State<'_, sessions::SessionManager>,
    request: sessions::StartTerminalRecordingRequest,
) -> Result<sessions::TerminalRecordingInfo, String> {
    sessions.start_terminal_recording(sessions::terminal_recordings_root(&app)?, request)
}

#[tauri::command]
fn stop_terminal_recording(
    sessions: tauri::State<'_, sessions::SessionManager>,
    session_id: String,
) -> Result<Option<sessions::TerminalRecordingInfo>, String> {
    sessions.stop_terminal_recording(session_id)
}

#[tauri::command]
async fn list_terminal_recordings(
    app: tauri::AppHandle,
    request: sessions::ListTerminalRecordingsRequest,
) -> Result<Vec<sessions::TerminalRecordingEntry>, String> {
    run_blocking_command("terminal recording listing", move || {
        let root = sessions::terminal_recordings_root(&app)?;
        app.state::<sessions::SessionManager>()
            .list_terminal_recordings(root, request)
    })
    .await
}

#[tauri::command]
async fn list_all_terminal_recordings(
    app: tauri::AppHandle,
) -> Result<Vec<sessions::TerminalRecordingEntry>, String> {
    run_blocking_command("all terminal recordings listing", move || {
        sessions::list_all_terminal_recordings(sessions::terminal_recordings_root(&app)?)
    })
    .await
}

#[tauri::command]
async fn search_terminal_recordings(
    app: tauri::AppHandle,
    query: String,
) -> Result<Vec<PathBuf>, String> {
    run_blocking_command("terminal recording search", move || {
        sessions::search_terminal_recordings(sessions::terminal_recordings_root(&app)?, &query)
    })
    .await
}

#[tauri::command]
async fn prepare_terminal_recording_summary(
    app: tauri::AppHandle,
    path: String,
) -> Result<sessions::TerminalRecordingSummaryInput, String> {
    run_blocking_command("terminal recording summary preparation", move || {
        sessions::prepare_terminal_recording_summary(
            sessions::terminal_recordings_root(&app)?,
            &path,
        )
    })
    .await
}

#[tauri::command]
async fn save_terminal_recording_summary(
    app: tauri::AppHandle,
    request: sessions::SaveTerminalRecordingSummaryRequest,
) -> Result<(), String> {
    run_blocking_command("terminal recording summary save", move || {
        sessions::save_terminal_recording_summary(
            sessions::terminal_recordings_root(&app)?,
            request,
        )
    })
    .await
}

#[tauri::command]
async fn export_terminal_recordings(
    app: tauri::AppHandle,
    request: sessions::ExportTerminalRecordingsRequest,
) -> Result<sessions::ExportTerminalRecordingsResult, String> {
    run_blocking_command("terminal recording export", move || {
        sessions::export_terminal_recordings(sessions::terminal_recordings_root(&app)?, request)
    })
    .await
}

fn open_folder_in_file_manager(app: &tauri::AppHandle, folder: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        std::process::Command::new("explorer.exe")
            .arg(folder)
            .spawn()
            .map(|_| ())
            .map_err(|error| {
                format!(
                    "failed to open folder {} with Windows Explorer: {error}",
                    folder.display()
                )
            })
    }

    #[cfg(not(target_os = "windows"))]
    {
        app.opener()
            .open_path(folder.to_string_lossy(), None::<&str>)
            .map_err(|error| format!("failed to open folder {}: {error}", folder.display()))
    }
}

#[tauri::command]
fn open_terminal_recordings_root(app: tauri::AppHandle) -> Result<(), String> {
    let root = sessions::terminal_recordings_root(&app)?;
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "failed to create terminal recordings folder {}: {error}",
            root.display()
        )
    })?;
    open_folder_in_file_manager(&app, &root)
}

#[tauri::command]
fn open_terminal_recordings_folder(
    app: tauri::AppHandle,
    sessions: tauri::State<'_, sessions::SessionManager>,
    request: sessions::ListTerminalRecordingsRequest,
) -> Result<(), String> {
    let folder =
        sessions.terminal_recordings_folder(sessions::terminal_recordings_root(&app)?, request)?;
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "failed to create terminal recordings folder {}: {error}",
            folder.display()
        )
    })?;
    open_folder_in_file_manager(&app, &folder)
}

#[tauri::command]
fn open_terminal_recording(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let root = sessions::terminal_recordings_root(&app)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve terminal recordings root: {error}"))?;
    let requested = PathBuf::from(&path);
    let canonical_path = requested
        .canonicalize()
        .map_err(|error| format!("failed to resolve terminal recording {path}: {error}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("terminal recording path must stay inside the recordings folder".to_string());
    }
    if canonical_path.extension().and_then(|value| value.to_str()) != Some("txt") {
        return Err("terminal recording must be a text file".to_string());
    }
    app.opener()
        .open_path(canonical_path.to_string_lossy(), None::<&str>)
        .map_err(|error| {
            format!(
                "failed to open terminal recording {}: {error}",
                canonical_path.display()
            )
        })
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
async fn scroll_tmux_pane(
    app: tauri::AppHandle,
    request: sessions::ScrollTmuxPaneRequest,
) -> Result<(), String> {
    run_blocking_command("tmux scroll pane", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.scroll_tmux_pane(app.clone(), &secrets, request)
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
async fn tmux_current_path(
    app: tauri::AppHandle,
    request: sessions::TmuxCurrentPathRequest,
) -> Result<String, String> {
    run_blocking_command("tmux current path", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.tmux_current_path(app.clone(), &secrets, request)
    })
    .await
}

#[tauri::command]
async fn list_psmux_sessions() -> Result<Vec<sessions::TmuxSession>, String> {
    run_blocking_command("psmux list sessions", sessions::list_psmux_sessions).await
}

#[tauri::command]
async fn close_psmux_session(psmux_session_id: String) -> Result<(), String> {
    run_blocking_command("psmux close session", move || {
        sessions::close_psmux_session(psmux_session_id)
    })
    .await
}

#[tauri::command]
async fn rename_psmux_session(
    psmux_session_id: String,
    new_psmux_session_id: String,
) -> Result<(), String> {
    run_blocking_command("psmux rename session", move || {
        sessions::rename_psmux_session(psmux_session_id, new_psmux_session_id)
    })
    .await
}

#[tauri::command]
async fn set_psmux_mouse(psmux_session_id: String, enabled: bool) -> Result<(), String> {
    run_blocking_command("psmux set mouse", move || {
        sessions::set_psmux_session_mouse(psmux_session_id, enabled)
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
async fn detect_ssh_remote_os(
    app: tauri::AppHandle,
    request: sessions::TmuxConnectionRequest,
    session_id: Option<String>,
) -> Result<sessions::DetectedRemoteOs, String> {
    run_blocking_command("SSH remote OS detection", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.detect_ssh_remote_os(app.clone(), &secrets, request, session_id)
    })
    .await
}

#[tauri::command]
async fn list_remote_loopback_ports(
    app: tauri::AppHandle,
    request: sessions::TmuxConnectionRequest,
    session_id: Option<String>,
) -> Result<Vec<sessions::RemoteLoopbackPort>, String> {
    run_blocking_command("SSH loopback port discovery", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.list_remote_loopback_ports(app.clone(), &secrets, request, session_id, false)
    })
    .await
}

#[tauri::command]
async fn list_remote_network_addresses(
    app: tauri::AppHandle,
    request: sessions::TmuxConnectionRequest,
    session_id: Option<String>,
) -> Result<Vec<String>, String> {
    run_blocking_command("SSH remote network address discovery", move || {
        let sessions = app.state::<sessions::SessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        sessions.list_remote_network_addresses(app.clone(), &secrets, request, session_id)
    })
    .await
}

#[tauri::command]
async fn list_local_tcp_listeners(
    app: tauri::AppHandle,
) -> Result<Vec<sessions::LocalTcpListener>, String> {
    run_blocking_command("local TCP listener discovery", move || {
        app.state::<sessions::SessionManager>()
            .list_local_tcp_listeners()
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

#[tauri::command]
fn is_app_elevated() -> bool {
    sessions::is_app_elevated()
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

static SCREENSHOT_COMMAND_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

async fn run_blocking_screenshot_command<T, F>(label: &'static str, job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    run_blocking_command(label, move || {
        let _guard = SCREENSHOT_COMMAND_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        job()
    })
    .await
}

// Full and selective settings-database import/export share the live SQLite
// file, its backup folder, and second-resolution temp snapshot paths; the
// multi-step replace/backup sequences are only safe when whole commands cannot
// overlap.
static SETTINGS_DATABASE_COMMAND_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

async fn run_blocking_database_command<T, F>(label: &'static str, job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    run_blocking_command(label, move || {
        let _guard = SETTINGS_DATABASE_COMMAND_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        job()
    })
    .await
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
async fn list_local_directory(
    request: sftp::ListLocalDirectoryRequest,
) -> Result<sftp::LocalDirectoryListing, String> {
    run_blocking_command("list local directory", move || {
        sftp::list_local_directory(request)
    })
    .await
}

#[tauri::command]
async fn list_local_places() -> Result<sftp::LocalPlacesListing, String> {
    run_blocking_command("list local places", sftp::list_local_places).await
}

#[tauri::command]
async fn create_local_folder(request: sftp::CreateLocalFolderRequest) -> Result<(), String> {
    run_blocking_command("create local folder", move || {
        sftp::create_local_folder(request)
    })
    .await
}

#[tauri::command]
async fn rename_local_path(request: sftp::RenameLocalPathRequest) -> Result<(), String> {
    run_blocking_command("rename local path", move || {
        sftp::rename_local_path(request)
    })
    .await
}

#[tauri::command]
async fn delete_local_path(request: sftp::DeleteLocalPathRequest) -> Result<(), String> {
    run_blocking_command("delete local path", move || {
        sftp::delete_local_path(request)
    })
    .await
}

#[tauri::command]
async fn local_path_properties(
    request: sftp::LocalPathPropertiesRequest,
) -> Result<sftp::SftpPathProperties, String> {
    run_blocking_command("local path properties", move || {
        sftp::local_path_properties(request)
    })
    .await
}

#[tauri::command]
async fn copy_local_path(
    request: sftp::CopyLocalPathRequest,
) -> Result<sftp::SftpTransferResult, String> {
    run_blocking_command("copy local path", move || sftp::copy_local_path(request)).await
}

#[tauri::command]
async fn copy_local_path_to(
    request: sftp::CopyLocalPathToRequest,
) -> Result<sftp::SftpTransferResult, String> {
    run_blocking_command("copy local path to", move || {
        sftp::copy_local_path_to(request)
    })
    .await
}

#[tauri::command]
async fn compare_folders(
    request: sftp::CompareFoldersRequest,
) -> Result<sftp::FolderCompareResult, String> {
    run_blocking_command("compare folders", move || sftp::compare_folders(request)).await
}

#[tauri::command]
async fn probe_file_view(
    request: file_viewer::FileViewProbeRequest,
) -> Result<file_viewer::FileViewProbe, String> {
    run_blocking_command("probe file view", move || file_viewer::probe(request)).await
}

#[tauri::command]
async fn read_file_view_text(
    request: file_viewer::FileViewTextRequest,
) -> Result<file_viewer::FileViewText, String> {
    run_blocking_command("read file view text", move || {
        file_viewer::read_text(request)
    })
    .await
}

#[tauri::command]
async fn index_file_view_text(
    request: file_viewer::FileViewTextIndexRequest,
) -> Result<file_viewer::FileViewTextIndex, String> {
    run_blocking_command("index file view text", move || {
        file_viewer::index_text(request)
    })
    .await
}

#[tauri::command]
async fn read_file_view_text_page(
    request: file_viewer::FileViewTextPageRequest,
) -> Result<file_viewer::FileViewTextPage, String> {
    run_blocking_command("read file view text page", move || {
        file_viewer::read_text_page(request)
    })
    .await
}

#[tauri::command]
async fn read_file_view_bytes(
    request: file_viewer::FileViewBytesRequest,
) -> Result<file_viewer::FileViewBytes, String> {
    run_blocking_command("read file view bytes", move || {
        file_viewer::read_bytes(request)
    })
    .await
}

#[tauri::command]
async fn file_view_pdf_status() -> Result<file_viewer::PdfViewStatus, String> {
    run_blocking_command("file view pdf status", || Ok(file_viewer::pdf_status())).await
}

#[tauri::command]
async fn write_file_view(
    request: file_viewer::FileViewWriteRequest,
) -> Result<file_viewer::FileViewWriteResult, String> {
    run_blocking_command("write file view", move || file_viewer::write_text(request)).await
}

#[tauri::command]
async fn render_pdf_view(
    request: file_viewer::PdfRenderRequest,
) -> Result<file_viewer::PdfRender, String> {
    run_blocking_command("render pdf view", move || file_viewer::render_pdf(request)).await
}

// ── Git Browser commands ────────────────────────────────────────────────────
// Each shells out to the system `git` binary on a background worker per the
// UI-liveness invariant. Network operations inherit the user's git credential
// configuration; mutating operations surface git's stderr on failure.

#[tauri::command]
async fn git_detect_repo(request: git::PathRequest) -> Result<git::GitDetect, String> {
    run_blocking_command("git detect repo", move || Ok(git::detect_repo(request))).await
}

#[tauri::command]
async fn git_repo_overview(request: git::RepoRequest) -> Result<git::GitOverview, String> {
    run_blocking_command("git repo overview", move || git::repo_overview(request)).await
}

#[tauri::command]
async fn git_log_graph(request: git::LogRequest) -> Result<Vec<git::GitCommit>, String> {
    run_blocking_command("git log graph", move || git::log_graph(request)).await
}

#[tauri::command]
async fn git_commit_files(
    request: git::CommitFilesRequest,
) -> Result<Vec<git::GitChangedFile>, String> {
    run_blocking_command("git commit files", move || git::commit_files(request)).await
}

#[tauri::command]
async fn git_diff_commit(request: git::DiffCommitRequest) -> Result<Vec<git::GitDiffLine>, String> {
    run_blocking_command("git diff commit", move || git::diff_commit(request)).await
}

#[tauri::command]
async fn git_diff_worktree(
    request: git::DiffWorktreeRequest,
) -> Result<Vec<git::GitDiffLine>, String> {
    run_blocking_command("git diff worktree", move || git::diff_worktree(request)).await
}

#[tauri::command]
async fn git_diff_no_index(
    request: git::DiffNoIndexRequest,
) -> Result<Vec<git::GitDiffLine>, String> {
    run_blocking_command("git diff no-index", move || git::diff_no_index(request)).await
}

/// Allocate a fresh, unique temp directory used to stage remote files before a
/// File Compare. Each call returns a distinct empty directory so two compared
/// files with the same base name never collide.
#[tauri::command]
fn create_compare_temp_dir() -> Result<String, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|delta| delta.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("kkterm-compare-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create compare staging directory: {error}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
async fn git_status(request: git::RepoRequest) -> Result<git::GitStatus, String> {
    run_blocking_command("git status", move || git::status(request)).await
}

#[tauri::command]
async fn git_stage(request: git::PathsRequest) -> Result<String, String> {
    run_blocking_command("git stage", move || git::stage(request)).await
}

#[tauri::command]
async fn git_unstage(request: git::PathsRequest) -> Result<String, String> {
    run_blocking_command("git unstage", move || git::unstage(request)).await
}

#[tauri::command]
async fn git_stage_all(request: git::RepoRequest) -> Result<String, String> {
    run_blocking_command("git stage all", move || git::stage_all(request)).await
}

#[tauri::command]
async fn git_unstage_all(request: git::RepoRequest) -> Result<String, String> {
    run_blocking_command("git unstage all", move || git::unstage_all(request)).await
}

#[tauri::command]
async fn git_commit(request: git::CommitRequest) -> Result<String, String> {
    run_blocking_command("git commit", move || git::commit(request)).await
}

#[tauri::command]
async fn git_checkout(request: git::RefRequest) -> Result<String, String> {
    run_blocking_command("git checkout", move || git::checkout(request)).await
}

#[tauri::command]
async fn git_create_branch(request: git::CreateBranchRequest) -> Result<String, String> {
    run_blocking_command("git create branch", move || git::create_branch(request)).await
}

#[tauri::command]
async fn git_delete_branch(request: git::DeleteBranchRequest) -> Result<String, String> {
    run_blocking_command("git delete branch", move || git::delete_branch(request)).await
}

#[tauri::command]
async fn git_rename_branch(request: git::RenameBranchRequest) -> Result<String, String> {
    run_blocking_command("git rename branch", move || git::rename_branch(request)).await
}

#[tauri::command]
async fn git_create_tag(request: git::CreateTagRequest) -> Result<String, String> {
    run_blocking_command("git create tag", move || git::create_tag(request)).await
}

#[tauri::command]
async fn git_merge(request: git::RefRequest) -> Result<String, String> {
    run_blocking_command("git merge", move || git::merge(request)).await
}

#[tauri::command]
async fn git_cherry_pick(request: git::ShaRequest) -> Result<String, String> {
    run_blocking_command("git cherry-pick", move || git::cherry_pick(request)).await
}

#[tauri::command]
async fn git_revert(request: git::ShaRequest) -> Result<String, String> {
    run_blocking_command("git revert", move || git::revert(request)).await
}

#[tauri::command]
async fn git_stash_push(request: git::StashPushRequest) -> Result<String, String> {
    run_blocking_command("git stash push", move || git::stash_push(request)).await
}

#[tauri::command]
async fn git_stash_pop(request: git::StashIndexRequest) -> Result<String, String> {
    run_blocking_command("git stash pop", move || git::stash_pop(request)).await
}

#[tauri::command]
async fn git_stash_apply(request: git::StashIndexRequest) -> Result<String, String> {
    run_blocking_command("git stash apply", move || git::stash_apply(request)).await
}

#[tauri::command]
async fn git_stash_drop(request: git::StashIndexRequest) -> Result<String, String> {
    run_blocking_command("git stash drop", move || git::stash_drop(request)).await
}

#[tauri::command]
async fn git_fetch(request: git::FetchRequest) -> Result<String, String> {
    run_blocking_command("git fetch", move || git::fetch(request)).await
}

#[tauri::command]
async fn git_pull(request: git::PullRequest) -> Result<String, String> {
    run_blocking_command("git pull", move || git::pull(request)).await
}

#[tauri::command]
async fn git_push(request: git::PushRequest) -> Result<String, String> {
    run_blocking_command("git push", move || git::push(request)).await
}

#[tauri::command]
async fn git_discard(request: git::DiscardRequest) -> Result<String, String> {
    run_blocking_command("git discard", move || git::discard(request)).await
}

#[tauri::command]
async fn git_reset(request: git::ResetRequest) -> Result<String, String> {
    run_blocking_command("git reset", move || git::reset(request)).await
}

#[tauri::command]
async fn git_worktree_list(request: git::RepoRequest) -> Result<Vec<git::GitWorktree>, String> {
    run_blocking_command("git worktree list", move || git::worktree_list(request)).await
}

#[tauri::command]
async fn git_worktree_add(request: git::WorktreeAddRequest) -> Result<String, String> {
    run_blocking_command("git worktree add", move || git::worktree_add(request)).await
}

#[tauri::command]
async fn git_worktree_remove(request: git::WorktreeRemoveRequest) -> Result<String, String> {
    run_blocking_command("git worktree remove", move || git::worktree_remove(request)).await
}

#[tauri::command]
async fn move_local_path(
    request: sftp::MoveLocalPathRequest,
) -> Result<sftp::SftpTransferResult, String> {
    run_blocking_command("move local path", move || sftp::move_local_path(request)).await
}

#[tauri::command]
async fn set_local_file_clipboard(
    request: sftp::SetLocalFileClipboardRequest,
) -> Result<(), String> {
    run_blocking_command("set local file clipboard", move || {
        sftp::set_local_file_clipboard(request)
    })
    .await
}

#[tauri::command]
async fn read_local_file_clipboard() -> Result<Option<sftp::LocalFileClipboard>, String> {
    run_blocking_command("read local file clipboard", sftp::read_local_file_clipboard).await
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
fn focus_webview_session(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::WebviewSimpleRequest,
) -> Result<(), String> {
    webviews.focus(request)
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
        .url_credential_fill(&request.connection_id, request.page_url.as_deref())?
        .ok_or_else(|| "stored URL credential was not found".to_string())?;
    let username = credential.username.trim().to_string();
    if username.is_empty() {
        return Err("URL credential username is required".to_string());
    }
    // Form-data credentials may carry no password (e.g. a search or config form),
    // so a missing keychain secret is normal: restore the saved fields without one.
    let password = secrets
        .read_url_password(credential.secret_owner_id)
        .map_err(|error| format!("failed to read URL password: {error}"))?
        .unwrap_or_default();
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
fn request_webview_page_capture_state(
    webviews: tauri::State<'_, webview::WebviewSessionManager>,
    request: webview::WebviewPageCaptureStateRequest,
) -> Result<(), String> {
    webviews.request_page_capture_state(request)
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

// ── macOS/Linux IronRDP client commands (Windows uses the native ActiveX path) ─

#[cfg(not(target_os = "windows"))]
#[tauri::command]
async fn start_rdp_client_session(
    app: tauri::AppHandle,
    mut request: rdp_client::StartRdpClientSessionRequest,
) -> Result<rdp_client::RdpClientSessionStarted, String> {
    run_blocking_command("RDP startup", move || {
        let rdp_sessions = app.state::<rdp_client::RdpClientSessionManager>();
        let secrets = app.state::<secrets::Secrets>();
        if request.password().is_none() {
            if let Some(owner_id) = request.secret_owner_id().map(str::to_string) {
                request.set_password(
                    secrets
                        .read_connection_password(owner_id)
                        .map_err(|error| format!("failed to read RDP password: {error}"))?,
                );
            }
        }
        rdp_sessions.start_session(app.clone(), request)
    })
    .await
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn send_rdp_client_pointer_event(
    rdp_sessions: tauri::State<'_, rdp_client::RdpClientSessionManager>,
    request: rdp_client::RdpClientPointerEventRequest,
) -> Result<(), String> {
    rdp_sessions.pointer_event(request)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn send_rdp_client_key_event(
    rdp_sessions: tauri::State<'_, rdp_client::RdpClientSessionManager>,
    request: rdp_client::RdpClientKeyEventRequest,
) -> Result<(), String> {
    rdp_sessions.key_event(request)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn send_rdp_client_text(
    rdp_sessions: tauri::State<'_, rdp_client::RdpClientSessionManager>,
    request: rdp_client::RdpClientTextRequest,
) -> Result<(), String> {
    rdp_sessions.text_input(request)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn send_rdp_client_clipboard_text(
    rdp_sessions: tauri::State<'_, rdp_client::RdpClientSessionManager>,
    request: rdp_client::RdpClientTextRequest,
) -> Result<(), String> {
    rdp_sessions.clipboard_text(request)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn paste_rdp_client_clipboard(
    rdp_sessions: tauri::State<'_, rdp_client::RdpClientSessionManager>,
    request: rdp_client::RdpClientSimpleRequest,
) -> Result<(), String> {
    rdp_sessions.paste_clipboard(request)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn send_rdp_client_ctrl_alt_delete(
    rdp_sessions: tauri::State<'_, rdp_client::RdpClientSessionManager>,
    request: rdp_client::RdpClientSimpleRequest,
) -> Result<(), String> {
    rdp_sessions.send_ctrl_alt_delete(request)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn close_rdp_client_session(
    rdp_sessions: tauri::State<'_, rdp_client::RdpClientSessionManager>,
    request: rdp_client::RdpClientSimpleRequest,
) -> Result<(), String> {
    rdp_sessions.close_session(request)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_rdp_client_session_status(
    rdp_sessions: tauri::State<'_, rdp_client::RdpClientSessionManager>,
    request: rdp_client::RdpClientSimpleRequest,
) -> Result<rdp_client::RdpClientSessionStatus, String> {
    rdp_sessions.session_status(request)
}

#[cfg(target_os = "windows")]
fn configure_single_instance<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        restore_main_window(app);
    }))
}

#[cfg(not(target_os = "windows"))]
fn configure_single_instance<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
}

#[cfg(target_os = "windows")]
fn restore_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(main_webview) = app.get_webview_window(window_state::MAIN_WINDOW_LABEL) {
        let main_window = main_webview.as_ref().window();
        if main_window.is_minimized().unwrap_or(false) {
            let _ = main_window.unminimize();
        }

        let _ = main_window.show();
        let _ = window_state::recover_if_offscreen(&main_window);
        let _ = main_window.set_focus();
    }
}

#[tauri::command]
fn show_native_tooltip(
    app: tauri::AppHandle,
    state: tauri::State<'_, native_tooltip::SharedNativeTooltipState>,
    request: native_tooltip::NativeTooltipRequest,
) -> Result<bool, String> {
    native_tooltip::show(app, state, request)
}

#[tauri::command]
fn hide_native_tooltip(
    state: tauri::State<'_, native_tooltip::SharedNativeTooltipState>,
) -> Result<(), String> {
    native_tooltip::hide(state)
}

/// True when KKTerm is running inside a remote (RDP) session.
fn is_remote_session() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_REMOTESESSION};
        // SAFETY: GetSystemMetrics is a pure read of a Windows session metric.
        unsafe { GetSystemMetrics(SM_REMOTESESSION) != 0 }
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_updater<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_updater<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();
    // The heartbeat is started from `setup` once the main window's AppHandle
    // exists, so the native UI-thread liveness probe has a window to ping.

    configure_macos_updater(configure_single_instance(tauri::Builder::default()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|error| {
                setup_error(format!("failed to resolve app data directory: {error}"))
            })?;
            let db_path = app_data_dir.join("kkterm.sqlite3");
            let mcp_bridge_dir = app_data_dir.clone();
            let storage = storage::Storage::open(db_path).map_err(setup_error)?;
            let general_settings = storage.general_settings().map_err(setup_error)?;
            let credential_settings = storage.credential_settings().map_err(setup_error)?;
            let ai_provider_settings = storage.ai_provider_settings().map_err(setup_error)?;
            net::proxy::set(net::proxy::from_settings(
                general_settings.proxy_mode(),
                general_settings.proxy_url(),
            ));
            logging::set_advanced_debugging_enabled(general_settings.advanced_debugging_enabled());
            debug_heartbeat::start(app.handle().clone());

            let apply_webview_stability =
                general_settings.rdp_webview_stability() || is_remote_session();
            // The main window is created here in Rust rather than in
            // tauri.conf.json so the RDP/WebView2 stability flags can be applied
            // per launch (see webview::REMOTE_SESSION_WEBVIEW2_ARGS). The flags
            // reliably apply only through WebviewWindowBuilder::additional_browser_args;
            // they are enabled when the user opts in or when KKTerm detects it
            // launched inside a remote session, so local installs keep GPU
            // acceleration. This must run before any code looks up the main
            // window below.
            {
                #[allow(unused_mut)]
                let mut main_window_builder = tauri::WebviewWindowBuilder::new(
                    app,
                    window_state::MAIN_WINDOW_LABEL,
                    tauri::WebviewUrl::default(),
                )
                .title("KKTerm")
                .inner_size(1360.0, 860.0)
                .min_inner_size(1120.0, 720.0)
                .initialization_script_for_all_frames(webview::SUPPRESS_SHELL_F5_RELOAD_SCRIPT)
                .disable_drag_drop_handler();
                // macOS keeps the native traffic-light controls but renders them
                // over a transparent overlay title bar so the React-painted bar
                // shows through (the title text is hidden). Every other platform
                // drops system decorations entirely and relies on the custom bar.
                #[cfg(target_os = "macos")]
                {
                    main_window_builder = main_window_builder
                        .title_bar_style(tauri::TitleBarStyle::Overlay)
                        .hidden_title(true);
                }
                #[cfg(not(target_os = "macos"))]
                {
                    main_window_builder = main_window_builder.decorations(false);
                }
                #[cfg(target_os = "windows")]
                if apply_webview_stability {
                    main_window_builder = main_window_builder
                        .additional_browser_args(webview::REMOTE_SESSION_WEBVIEW2_ARGS);
                    eprintln!(
                        "applying WebView2 RDP-stability flags to main window ({})",
                        webview::REMOTE_SESSION_WEBVIEW2_ARGS
                    );
                }
                #[cfg(not(target_os = "windows"))]
                let _ = apply_webview_stability;
                main_window_builder
                    .build()
                    .map_err(|error| setup_error(error.to_string()))?;
            }

            let main_window_settings = storage.main_window_settings().map_err(setup_error)?;
            if let Err(error) = storage.backup_if_enabled_for_startup() {
                eprintln!("failed to create automatic database backup at startup: {error}");
            }
            if let Err(error) =
                auto_start::sync_auto_start_with_windows(general_settings.auto_start_with_windows())
            {
                eprintln!("{error}");
            }
            let webview_additional_browser_args = if apply_webview_stability {
                #[cfg(target_os = "windows")]
                {
                    Some(webview::REMOTE_SESSION_WEBVIEW2_ARGS)
                }
                #[cfg(not(target_os = "windows"))]
                {
                    None
                }
            } else {
                None
            };
            let webview_sessions = webview::WebviewSessionManager::new(
                general_settings.allow_clipboard_read(),
                webview_additional_browser_args,
            );
            if let Some(main_webview) = app.get_webview_window(window_state::MAIN_WINDOW_LABEL) {
                webview::configure_shell_refresh_shortcut(&main_webview).map_err(setup_error)?;
                webview::configure_shell_clipboard_read_permission(
                    &main_webview,
                    webview_sessions.clipboard_read_allowed_state(),
                )
                .map_err(setup_error)?;
                window_effects::apply_title_bar_mode(&main_webview);
            }
            if let Some(main_webview) = app.get_webview_window(window_state::MAIN_WINDOW_LABEL) {
                let main_window = main_webview.as_ref().window();
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
                if let Some(main_webview) = app.get_webview_window(window_state::MAIN_WINDOW_LABEL)
                {
                    let main_window = main_webview.as_ref().window();
                    let _ = main_window.minimize();
                    if general_settings.minimize_to_tray() {
                        let _ = main_window.hide();
                    }
                }
            }
            let power_manager = power::DontSleepManager::new();
            if let Err(error) =
                power_manager.set_foreground_only(general_settings.dont_sleep_foreground_only())
            {
                eprintln!("failed to restore Don't Sleep foreground setting: {error}");
            }
            if let Some(main_webview) = app.get_webview_window(window_state::MAIN_WINDOW_LABEL) {
                let main_window = main_webview.as_ref().window();
                if let Err(error) =
                    power_manager.set_app_foreground(main_window_is_foreground(&main_window))
                {
                    eprintln!("failed to restore Don't Sleep foreground state: {error}");
                }
            }
            if general_settings.dont_sleep_enabled() {
                if let Err(error) = power_manager.set_enabled(true) {
                    eprintln!("failed to restore Don't Sleep state: {error}");
                }
            }
            let secret_db_path = storage.db_path();
            match storage.screenshot_settings() {
                Ok(screenshot_settings) => {
                    if let Err(error) =
                        screenshot_shortcuts::apply(app.handle(), &screenshot_settings)
                    {
                        eprintln!("failed to register screenshot capture shortcuts: {error}");
                    }
                }
                Err(error) => {
                    eprintln!("failed to load screenshot settings for capture shortcuts: {error}");
                }
            }
            app.manage(storage);
            app.manage(performance::PerformanceMonitor::new());
            app.manage(pc_info::PcInfoCache::new());
            app.manage(power_manager);
            app.manage(secrets::Secrets::new(
                credential_settings.secret_store(),
                secret_db_path,
            ));
            app.manage(ai::AssistantLiveToolBridge::new());
            app.manage(ai::AssistantToolApprovalBridge::new());
            app.manage(ai::AssistantStreamCancellation::new());
            app.manage(ai::WidgetHealthRegistry::new());
            app.manage(native_tooltip::new_state());
            app.manage(sessions::SessionManager::new());
            app.manage(sftp::SftpSessionManager::new());
            app.manage(ftp::FtpSessionManager::new());
            app.manage(webview_sessions);
            app.manage(rdp::RdpSessionManager::new());
            app.manage(vnc::VncSessionManager::new());
            #[cfg(not(target_os = "windows"))]
            app.manage(rdp_client::RdpClientSessionManager::new());
            app.manage(std::sync::Arc::new(net::stream::StreamRegistry::new()));
            app.manage(itops::commands::ItopsRunRegistry::default());
            app.manage(std::sync::Arc::new(watchdog::WatchdogRegistry::new()));
            app.manage(std::sync::Arc::new(watchdog::SessionActivityTracker::new()));
            app.manage(itops::automation_commands::ItopsAutomationRuntime::default());
            itops::automation_commands::install_trigger_hook(app.handle());
            itops::automation_commands::hydrate_automations(app.handle().clone());
            app.manage(installer::InstallerRuntime::new());
            mcp_bridge::start_if_enabled(
                app.handle().clone(),
                mcp_bridge_dir,
                ai_provider_settings.built_in_mcp_server_enabled(),
                ai_provider_settings.built_in_mcp_allow_all_dangerous(),
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != window_state::MAIN_WINDOW_LABEL {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                debug_heartbeat::record_window_event("close-requested");
                app_tray::hide_window_on_close_if_enabled(window, api);
            }

            if let Some(window_tracker) = window.try_state::<window_state::MainWindowState>() {
                match event {
                    tauri::WindowEvent::Resized(size) => {
                        debug_heartbeat::record_window_event(format!(
                            "resized:{}x{}",
                            size.width, size.height
                        ));
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
                        if let Some(power) = window.try_state::<power::DontSleepManager>() {
                            if let Err(error) =
                                power.set_app_foreground(main_window_is_foreground(window))
                            {
                                eprintln!("failed to update Don't Sleep foreground state: {error}");
                            }
                        }
                    }
                    tauri::WindowEvent::Focused(focused) => {
                        debug_heartbeat::record_window_event(format!("focused:{focused}"));
                        let _ = window.emit("kkterm://main-window-focus-changed", *focused);
                        if !focused {
                            app_tray::hide_minimized_window_if_enabled(window);
                        }
                        if let Some(power) = window.try_state::<power::DontSleepManager>() {
                            if let Err(error) =
                                power.set_app_foreground(main_window_is_foreground(window))
                            {
                                eprintln!("failed to update Don't Sleep foreground state: {error}");
                            }
                        }
                    }
                    tauri::WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                        // A DPI change on RDP reconnect is a leading suspect for
                        // the WebView2 freeze; record it so the heartbeat shows
                        // whether one preceded the hang.
                        debug_heartbeat::record_scale_factor(*scale_factor);
                        debug_heartbeat::record_window_event(format!(
                            "scale-factor:{scale_factor}"
                        ));
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // ── App lifecycle, window, diagnostics & updates
            app_bootstrap,
            is_debug_build,
            app_updates::get_app_update_target_triple,
            app_updates::download_app_update,
            app_updates::cancel_app_update_download,
            app_updates::install_downloaded_app_update,
            currency_rates::fetch_currency_rates,
            debug_frontend_heartbeat,
            ui_debug_log,
            url_connection_debug_log,
            focus_main_window,
            show_native_tooltip,
            hide_native_tooltip,
            // ── Connections & folders
            list_connection_tree,
            list_workspaces,
            create_workspace,
            rename_workspace,
            delete_workspace,
            reorder_workspaces,
            create_connection,
            create_connection_folder,
            rename_connection_folder,
            update_connection_folder_icon_data_url,
            delete_connection_folder,
            rename_connection,
            update_connection,
            update_connection_icon_data_url,
            update_connection_icon_color,
            update_connection_icon_background_color,
            update_connection_terminal_appearance,
            update_connection_terminal_color_scheme,
            update_connection_file_browser_view_options,
            update_connection_ssh_port_forwardings,
            update_connection_tab_title,
            delete_connection,
            duplicate_connection,
            move_connection_folder,
            move_connection,
            list_serial_ports,
            // ── URL connections & credentials
            update_url_connection_icon_from_page,
            upsert_url_credential,
            list_url_credentials,
            delete_url_credential,
            list_url_data_partitions,
            clear_url_data_partition,
            // ── Settings (general, launcher, dashboard, terminal, appearance, transport)
            get_general_settings,
            update_general_settings,
            get_app_launcher_settings,
            update_app_launcher_settings,
            get_dashboard_settings,
            update_dashboard_settings,
            get_credential_settings,
            update_credential_settings,
            configure_encrypted_file_secret_store,
            dashboard_report_widget_health,
            prepare_app_launcher_entry,
            launch_app_launcher_entry,
            import_settings_database,
            export_settings_database,
            selective_export::export_selective_database,
            selective_export::inspect_selective_database,
            selective_export::import_selective_database,
            get_database_folder,
            get_terminal_settings,
            update_terminal_settings,
            get_appearance_settings,
            update_appearance_settings,
            get_system_accent_color,
            get_custom_fonts_folder,
            open_custom_fonts_folder,
            open_log_folder,
            list_custom_fonts,
            list_system_fonts,
            load_custom_font_data,
            get_ssh_settings,
            update_ssh_settings,
            launch_ssh_x_server,
            restart_ssh_x_server,
            stop_ssh_x_server,
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
            // ── Assistant skills, MCP config & chat threads
            list_assistant_skills,
            set_custom_assistant_skills_enabled,
            set_assistant_skill_enabled,
            open_assistant_skills_folder,
            open_custom_assistant_skills_folder,
            open_assistant_skill,
            get_built_in_mcp_command_path,
            open_built_in_mcp_config_location,
            list_assistant_chat_threads,
            upsert_assistant_chat_thread,
            list_durable_ui_state,
            get_durable_ui_state,
            set_durable_ui_state,
            delete_durable_ui_state,
            delete_durable_ui_state_by_prefix,
            delete_assistant_chat_thread,
            // ── AI providers, models & CLI backends
            start_github_copilot_device_flow,
            poll_github_copilot_device_flow,
            list_github_copilot_models,
            get_github_copilot_cli_status,
            list_ai_provider_models,
            get_ai_cli_backend_status,
            open_ai_cli_backend_auth,
            // ── AI assistant: command proposals & tool approvals
            plan_command_proposal,
            complete_assistant_live_tool_request,
            complete_assistant_tool_approval_request,
            // ── AI agent runs
            run_ai_agent,
            run_ai_agent_streaming,
            cancel_assistant_streams,
            // ── AI coding usage
            ai_coding_usage::ai_coding_usage_load,
            ai_coding_usage::ai_coding_usage_connect,
            ai_coding_usage::ai_coding_usage_refresh,
            ai_coding_usage::ai_coding_usage_reconnect,
            ai_coding_usage::ai_coding_usage_disconnect,
            // ── Keychain, performance, diagnostics, power & tray
            keychain_status,
            credential_secret_store_status,
            lock_encrypted_file_secret_store,
            get_performance_snapshot,
            get_host_usage_snapshot,
            get_system_performance_counters,
            pc_info_get,
            pc_info_refresh,
            open_windows_task_manager,
            create_diagnostics_bundle,
            get_dont_sleep_enabled,
            set_dont_sleep_enabled,
            update_tray_menu,
            // ── Screenshots
            capture_screenshot_to_clipboard,
            write_screenshot_data_url_to_clipboard,
            capture_screenshot_for_assistant,
            capture_fullscreen_screenshot_for_assistant,
            capture_screenshot_to_library,
            capture_fullscreen_screenshot_to_library,
            capture_active_window_screenshot_to_library,
            capture_interactive_region_screenshot_to_library,
            list_screenshots,
            read_screenshot,
            rename_screenshot,
            copy_stored_screenshot_to_clipboard,
            delete_screenshot,
            clear_screenshots,
            open_screenshots_folder,
            reveal_screenshot,
            open_screenshot_file,
            // ── SSH transport, config import, bookmarks & host keys
            ssh_transport_plan,
            import_ssh_config,
            parse_import_file,
            list_browser_bookmark_sources,
            preview_browser_bookmark_import,
            scan_network_for_connections,
            inspect_ssh_host_key,
            trust_ssh_host_key,
            // ── Secrets & stored credentials
            store_secret,
            secret_exists,
            delete_secret,
            read_url_credential_password,
            list_stored_credentials,
            list_connection_password_credentials,
            create_connection_password_credential,
            assign_connection_password_credential,
            delete_stored_credential,
            // ── Terminal sessions & recordings
            start_terminal_session,
            local_shell_available,
            write_terminal_input,
            resize_terminal,
            set_terminal_encoding,
            close_terminal_session,
            start_terminal_recording,
            stop_terminal_recording,
            list_terminal_recordings,
            list_all_terminal_recordings,
            search_terminal_recordings,
            prepare_terminal_recording_summary,
            save_terminal_recording_summary,
            export_terminal_recordings,
            open_terminal_recordings_folder,
            open_terminal_recordings_root,
            open_terminal_recording,
            // ── tmux
            list_tmux_sessions,
            close_tmux_session,
            rename_tmux_session,
            set_tmux_mouse,
            list_psmux_sessions,
            close_psmux_session,
            rename_psmux_session,
            set_psmux_mouse,
            scroll_tmux_pane,
            capture_tmux_pane,
            tmux_current_path,
            // ── SSH system context, port forwarding & elevation
            inspect_ssh_system_context,
            detect_ssh_remote_os,
            list_remote_loopback_ports,
            list_remote_network_addresses,
            list_local_tcp_listeners,
            start_ssh_port_forward,
            close_ssh_port_forward,
            is_app_elevated,
            launch_elevated_terminal,
            // ── SFTP
            start_sftp_session,
            list_sftp_directory,
            list_local_directory,
            list_local_places,
            create_local_folder,
            rename_local_path,
            delete_local_path,
            local_path_properties,
            probe_file_view,
            read_file_view_text,
            index_file_view_text,
            read_file_view_text_page,
            read_file_view_bytes,
            file_view_pdf_status,
            write_file_view,
            render_pdf_view,
            // ── Git Browser
            git_detect_repo,
            git_repo_overview,
            git_log_graph,
            git_commit_files,
            git_diff_commit,
            git_diff_worktree,
            git_diff_no_index,
            create_compare_temp_dir,
            git_status,
            git_stage,
            git_unstage,
            git_stage_all,
            git_unstage_all,
            git_commit,
            git_checkout,
            git_create_branch,
            git_delete_branch,
            git_rename_branch,
            git_create_tag,
            git_merge,
            git_cherry_pick,
            git_revert,
            git_stash_push,
            git_stash_pop,
            git_stash_apply,
            git_stash_drop,
            git_fetch,
            git_pull,
            git_push,
            git_discard,
            git_reset,
            git_worktree_list,
            git_worktree_add,
            git_worktree_remove,
            open_filesystem_path,
            copy_local_path,
            copy_local_path_to,
            compare_folders,
            move_local_path,
            set_local_file_clipboard,
            read_local_file_clipboard,
            upload_sftp_path,
            download_sftp_path,
            cancel_sftp_transfer,
            create_sftp_folder,
            rename_sftp_path,
            delete_sftp_path,
            sftp_path_properties,
            update_sftp_path_properties,
            close_sftp_session,
            // ── FTP
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
            // ── URL WebView
            start_webview_session,
            update_webview_bounds,
            set_webview_visibility,
            focus_webview_session,
            webview_navigate,
            webview_reload,
            webview_go_back,
            webview_go_forward,
            fill_webview_credential,
            capture_webview_credential,
            request_webview_page_capture_state,
            close_webview_session,
            // ── RDP
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
            // ── VNC
            start_vnc_session,
            send_vnc_pointer_event,
            send_vnc_key_event,
            refresh_vnc_session,
            close_vnc_session,
            get_vnc_session_status,
            send_vnc_ctrl_alt_delete,
            #[cfg(not(target_os = "windows"))]
            start_rdp_client_session,
            #[cfg(not(target_os = "windows"))]
            send_rdp_client_pointer_event,
            #[cfg(not(target_os = "windows"))]
            send_rdp_client_key_event,
            #[cfg(not(target_os = "windows"))]
            send_rdp_client_text,
            #[cfg(not(target_os = "windows"))]
            send_rdp_client_clipboard_text,
            #[cfg(not(target_os = "windows"))]
            paste_rdp_client_clipboard,
            #[cfg(not(target_os = "windows"))]
            send_rdp_client_ctrl_alt_delete,
            #[cfg(not(target_os = "windows"))]
            close_rdp_client_session,
            #[cfg(not(target_os = "windows"))]
            get_rdp_client_session_status,
            // ── Dashboard
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
            dashboard_commands::export_dashboard_widgets,
            dashboard_commands::import_dashboard_widgets,
            dashboard_commands::read_dashboard_widget_import_file,
            dashboard_commands::import_dashboard_widgets_json,
            dashboard_commands::dashboard_reset,
            dashboard_import_background_image,
            dashboard_load_background_image,
            // ── IT Ops
            itops::commands::itops_list_sites,
            itops::commands::itops_create_site,
            itops::commands::itops_update_site,
            itops::commands::itops_remove_site,
            itops::commands::itops_reorder_sites,
            itops::commands::itops_resolve_site,
            itops::commands::itops_list_racks,
            itops::commands::itops_list_server_rooms,
            itops::commands::itops_create_server_room,
            itops::commands::itops_update_server_room,
            itops::commands::itops_delete_server_room,
            itops::commands::itops_duplicate_server_room,
            itops::commands::itops_create_rack,
            itops::commands::itops_update_rack,
            itops::commands::itops_duplicate_rack,
            itops::commands::itops_set_site_background,
            itops::commands::itops_set_server_room_background,
            itops::commands::itops_set_room_icon,
            itops::commands::itops_set_rack_background,
            itops::commands::itops_delete_rack,
            itops::commands::itops_reorder_racks,
            itops::commands::itops_set_rack_placements,
            itops::commands::itops_set_rack_facings,
            itops::commands::itops_list_room_objects,
            itops::commands::itops_set_room_objects,
            itops::commands::itops_place_rack_item,
            itops::commands::itops_update_rack_item,
            itops::commands::itops_move_rack_item,
            itops::commands::itops_remove_rack_item,
            itops::commands::itops_refresh_rack_item_snmp,
            itops::commands::itops_list_hosts,
            itops::commands::itops_create_host,
            itops::commands::itops_update_host,
            itops::commands::itops_delete_host,
            itops::commands::itops_import_hosts,
            itops::commands::itops_scan_hosts,
            itops::commands::itops_get_connection,
            itops::commands::itops_start_batch_run,
            itops::commands::itops_cancel_batch_run,
            itops::commands::itops_list_run_history,
            itops::task_commands::itops_list_tasks,
            itops::task_commands::itops_create_task,
            itops::task_commands::itops_update_task,
            itops::task_commands::itops_remove_task,
            itops::automation_commands::itops_list_automations,
            itops::automation_commands::itops_create_automation,
            itops::automation_commands::itops_update_automation,
            itops::automation_commands::itops_set_automation_enabled,
            itops::automation_commands::itops_remove_automation,
            itops::automation_commands::itops_test_automation,
            // ── Install Helper
            installer::commands::installer_load_catalog,
            installer::commands::installer_load_detection_cache,
            installer::commands::installer_detect_all,
            installer::commands::installer_detect_all_streaming,
            installer::commands::installer_redetect,
            installer::commands::installer_check_latest_versions,
            installer::commands::installer_install_recipe,
            installer::commands::installer_uninstall_recipe,
            installer::commands::installer_cancel,
            installer::commands::installer_get_web_ui_status,
            installer::commands::installer_run_web_ui,
            installer::commands::installer_stop_web_ui,
            installer::commands::installer_open_terminal_launcher,
            installer::commands::installer_launch_app,
            installer::commands::installer_list_quick_launch,
            installer::commands::installer_launch_quick_command,
            installer::commands::installer_open_quick_launch_terminal,
            installer::commands::installer_install_service,
            installer::commands::installer_remove_service,
            installer::commands::installer_get_state,
            installer::commands::installer_set_pinned,
            installer::commands::installer_wsl_list_distros,
            installer::commands::installer_wsl_list_online,
            installer::commands::installer_wsl_set_default,
            installer::commands::installer_wsl_unregister,
            installer::commands::installer_wsl_install,
            // ── MCP servers
            mcp::mcp_list_servers,
            mcp::mcp_create_server,
            mcp::mcp_update_server,
            mcp::mcp_delete_server,
            mcp::mcp_refresh_tools,
            mcp::mcp_call_tool,
            // ── Operation manual
            manual::list_manual_chapters,
            manual::read_manual_chapter,
            // ── Network tools
            net::commands::network_dns_lookup,
            net::commands::network_tcp_check,
            net::commands::network_interfaces,
            net::commands::network_wol,
            net::commands::network_whois,
            net::commands::network_ping_start,
            net::commands::network_port_scan_start,
            net::commands::network_stream_cancel,
            // ── Watchdog
            watchdog::commands::watchdog_create,
            watchdog::commands::watchdog_list,
            watchdog::commands::watchdog_cancel,
            watchdog::commands::watchdog_get_report,
            watchdog::commands::watchdog_record_intervention
        ])
        .build(tauri::generate_context!())
        .expect("error while building KKTerm")
        .run(|_app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Err(error) = x_server::stop_managed_vcxsrv_on_exit() {
                    eprintln!("failed to stop managed VcXsrv on exit: {error}");
                }
            }
        });
}

fn setup_error(message: String) -> Box<dyn std::error::Error> {
    Box::new(std::io::Error::new(std::io::ErrorKind::Other, message))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_test_background_file(folder: &Path, extension: &str, bytes: &[u8]) -> String {
        fs::create_dir_all(folder).expect("create backgrounds folder");
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
        // Use a tempdir rather than the real (app-data) backgrounds folder so the
        // test exercises the encode logic without depending on a Tauri AppHandle.
        let dir = tempfile::tempdir().expect("tempdir");
        let file = write_test_background_file(dir.path(), "mp4", b"test-video-bytes");
        let result =
            load_background_image_from_folder(dir.path(), file).expect("load background video");

        assert_eq!(result.path, None);
        assert_eq!(
            result.data_url,
            Some("data:video/mp4;base64,dGVzdC12aWRlby1ieXRlcw==".to_string())
        );
    }

    #[test]
    fn compose_ssh_socks_proxy_uses_separate_stored_credentials() {
        let resolved = compose_ssh_socks_proxy(
            Some("  10.0.0.119:1080  ".to_string()),
            Some("  proxy-user  ".to_string()),
            Some("p@ss:word".to_string()),
        )
        .expect("SOCKS proxy resolves");

        assert_eq!(
            resolved.as_deref(),
            Some("proxy-user:p@ss:word@10.0.0.119:1080")
        );
    }

    #[test]
    fn compose_ssh_socks_proxy_keeps_inline_credentials_without_stored_password() {
        let resolved = compose_ssh_socks_proxy(
            Some("inline:secret@10.0.0.119:1080".to_string()),
            None,
            None,
        )
        .expect("inline SOCKS proxy resolves");

        assert_eq!(resolved.as_deref(), Some("inline:secret@10.0.0.119:1080"));
    }
}

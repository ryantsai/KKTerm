use crate::secrets;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime},
};
use suppaftp::{
    list::{File as FtpListFile, ListParser, PosixPexQuery},
    tokio::{AsyncFtpStream, AsyncNativeTlsConnector, AsyncNativeTlsFtpStream},
    types::{FileType, FormatControl, Mode as FtpConnMode},
};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::runtime::Runtime;

const TRANSFER_CHUNK_SIZE: usize = 64 * 1024;
const TRANSFER_CANCELED: &str = "transfer canceled";

// ------------------------------- public types -------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FtpProtocol {
    Sftp,
    Ftp,
    Ftps,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FtpTlsMode {
    Explicit,
    Implicit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FtpConnectionMode {
    Passive,
    Active,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FtpTransferType {
    Binary,
    Ascii,
}

/// Persisted-in-SQLite (`connections.ftp_options` JSON) options for an FTP
/// Connection. Field defaults are deliberately conservative to match what
/// most servers expect.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpOptions {
    pub protocol: FtpProtocol,
    #[serde(default = "default_mode")]
    pub mode: FtpConnectionMode,
    #[serde(default)]
    pub tls_mode: Option<FtpTlsMode>,
    #[serde(default = "default_transfer_type")]
    pub transfer_type: FtpTransferType,
    #[serde(default)]
    pub utf8: bool,
    #[serde(default)]
    pub show_hidden: bool,
    #[serde(default)]
    pub connect_timeout_secs: Option<u64>,
    #[serde(default)]
    pub ignore_cert_errors: bool,
    /// Keepalive (NOOP) interval in seconds; None = no keepalive.
    #[serde(default)]
    pub keepalive_secs: Option<u64>,
    /// Start directory for the local pane; None = the OS home folder.
    #[serde(default)]
    pub local_path: Option<String>,
    /// Start directory for the remote pane; None = the server's home.
    #[serde(default)]
    pub remote_path: Option<String>,
}

fn default_mode() -> FtpConnectionMode {
    FtpConnectionMode::Passive
}

fn default_transfer_type() -> FtpTransferType {
    FtpTransferType::Binary
}

impl Default for FtpOptions {
    fn default() -> Self {
        Self {
            protocol: FtpProtocol::Ftp,
            mode: FtpConnectionMode::Passive,
            tls_mode: None,
            transfer_type: FtpTransferType::Binary,
            utf8: true,
            show_hidden: false,
            connect_timeout_secs: Some(30),
            ignore_cert_errors: false,
            keepalive_secs: None,
            local_path: None,
            remote_path: None,
        }
    }
}

impl FtpOptions {
    /// Returns the canonical effective TLS mode for FTPS connections.
    /// Defaults to Explicit when protocol is FTPS but tls_mode is absent.
    pub fn effective_tls_mode(&self) -> FtpTlsMode {
        self.tls_mode.unwrap_or(FtpTlsMode::Explicit)
    }
}

#[cfg(test)]
impl FtpOptions {
    pub fn from_json(value: &str) -> Result<Self, String> {
        serde_json::from_str(value).map_err(|e| format!("invalid ftp options: {e}"))
    }

    pub fn to_json(&self) -> Result<String, String> {
        serde_json::to_string(self).map_err(|e| format!("failed to serialize ftp options: {e}"))
    }
}

// ----------------------------- request/response -----------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartFtpSessionRequest {
    pub session_id: Option<String>,
    pub title: String,
    pub host: String,
    pub user: String,
    pub port: Option<u16>,
    pub secret_owner_id: Option<String>,
    pub password: Option<String>,
    pub path: Option<String>,
    pub options: FtpOptions,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFtpDirectoryRequest {
    pub session_id: String,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFtpPathRequest {
    pub session_id: String,
    pub transfer_id: String,
    pub local_path: String,
    pub remote_directory: String,
    pub overwrite_behavior: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFtpPathRequest {
    pub session_id: String,
    pub transfer_id: String,
    pub remote_path: String,
    pub local_directory: String,
    pub overwrite_behavior: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelFtpTransferRequest {
    pub transfer_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFtpFolderRequest {
    pub session_id: String,
    pub parent_path: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameFtpPathRequest {
    pub session_id: String,
    pub path: String,
    pub new_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFtpPathRequest {
    pub session_id: String,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpPathPropertiesRequest {
    pub session_id: String,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpSessionStarted {
    pub session_id: String,
    pub path: String,
    pub entries: Vec<FtpDirectoryEntry>,
    pub welcome: Option<String>,
    pub features: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FtpDirectoryListing {
    pub session_id: String,
    pub path: String,
    pub entries: Vec<FtpDirectoryEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FtpDirectoryEntry {
    pub name: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
    pub user: Option<String>,
    pub group: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpTransferResult {
    pub name: String,
    pub files: u64,
    pub folders: u64,
    pub bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpPathProperties {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
    pub mode: Option<String>,
    pub user: Option<String>,
    pub group: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpTransferProgress {
    pub transfer_id: String,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub progress: u8,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FtpOverwriteBehavior {
    Fail,
    Overwrite,
}

// ------------------------------- session mgmt -------------------------------

/// Backing transport for an FTP session. `Sftp` is intentionally not handled
/// here — frontend dispatches SFTP sub-protocol Connections to the existing
/// `sftp_*` commands and SftpSessionManager.
enum FtpTransport {
    Plain(AsyncFtpStream),
    Tls(AsyncNativeTlsFtpStream),
}

struct FtpConnection {
    runtime: Runtime,
    transport: FtpTransport,
    options: FtpOptions,
}

pub struct FtpSessionManager {
    sessions: std::sync::Mutex<HashMap<String, FtpConnection>>,
    transfers: std::sync::Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl FtpSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: std::sync::Mutex::new(HashMap::new()),
            transfers: std::sync::Mutex::new(HashMap::new()),
        }
    }

    pub fn start_ftp_session(
        &self,
        _app: AppHandle,
        secrets: &secrets::Secrets,
        request: StartFtpSessionRequest,
    ) -> Result<FtpSessionStarted, String> {
        if matches!(request.options.protocol, FtpProtocol::Sftp) {
            return Err(
                "SFTP sub-protocol is handled via the SFTP session manager, not FTP".to_string(),
            );
        }

        let session_id = request
            .session_id
            .clone()
            .unwrap_or_else(|| make_session_id(&request.title));
        let host = request.host.clone();
        let user_name = request.user.clone();
        let port = request
            .port
            .unwrap_or_else(|| default_ftp_port(&request.options));
        let initial_path = request
            .path
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or("/")
            .to_string();

        let password = match request
            .password
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(password) => password.to_string(),
            None => match request.secret_owner_id.clone() {
                Some(owner_id) if !owner_id.trim().is_empty() => secrets
                    .read_connection_password(owner_id)
                    .map_err(|e| format!("failed to read FTP password: {e}"))?
                    .unwrap_or_default(),
                _ => String::new(),
            },
        };

        let options = request.options.clone();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("failed to create FTP runtime: {e}"))?;

        let connect_timeout =
            Duration::from_secs(options.connect_timeout_secs.unwrap_or(30).clamp(1, 600));
        let (transport, welcome, features, entries, resolved_path) = runtime.block_on(async {
            tokio::time::timeout(
                connect_timeout,
                connect_and_login(&host, port, &user_name, &password, &options, &initial_path),
            )
            .await
            .map_err(|_| {
                format!(
                    "FTP connect timed out after {} seconds",
                    connect_timeout.as_secs()
                )
            })?
        })?;

        self.sessions
            .lock()
            .map_err(|_| "FTP session lock is poisoned".to_string())?
            .insert(
                session_id.clone(),
                FtpConnection {
                    runtime,
                    transport,
                    options,
                },
            );

        Ok(FtpSessionStarted {
            session_id,
            path: resolved_path,
            entries,
            welcome,
            features,
        })
    }

    pub fn close_ftp_session(&self, session_id: &str) -> Result<(), String> {
        // Remove under the lock, then drop the guard before the blocking QUIT
        // so a slow/hung server teardown can't freeze every other FTP session.
        let removed = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| "FTP session lock is poisoned".to_string())?;
            sessions.remove(session_id)
        };
        if let Some(mut conn) = removed {
            let _ = conn.runtime.block_on(async {
                match &mut conn.transport {
                    FtpTransport::Plain(s) => s.quit().await.ok(),
                    FtpTransport::Tls(s) => s.quit().await.ok(),
                }
            });
        }
        Ok(())
    }

    pub fn list_ftp_directory(
        &self,
        request: ListFtpDirectoryRequest,
    ) -> Result<FtpDirectoryListing, String> {
        self.with_session(&request.session_id.clone(), |conn| {
            let path = normalize_remote_path(&request.path);
            let show_hidden = conn.options.show_hidden;
            conn.runtime.block_on(async {
                let entries = read_directory(&mut conn.transport, &path, show_hidden).await?;
                Ok::<FtpDirectoryListing, String>(FtpDirectoryListing {
                    session_id: request.session_id.clone(),
                    path,
                    entries,
                })
            })
        })
    }

    pub fn create_ftp_folder(&self, request: CreateFtpFolderRequest) -> Result<(), String> {
        self.with_session(&request.session_id.clone(), |conn| {
            let name = validate_remote_child_name(&request.name)?;
            let parent = normalize_remote_path(&request.parent_path);
            let target = join_remote_path(&parent, &name);
            conn.runtime.block_on(async {
                match &mut conn.transport {
                    FtpTransport::Plain(s) => s.mkdir(&target).await.map_err(map_ftp_err)?,
                    FtpTransport::Tls(s) => s.mkdir(&target).await.map_err(map_ftp_err)?,
                };
                Ok::<(), String>(())
            })
        })
    }

    pub fn rename_ftp_path(&self, request: RenameFtpPathRequest) -> Result<(), String> {
        self.with_session(&request.session_id.clone(), |conn| {
            let new_name = validate_remote_child_name(&request.new_name)?;
            let path = normalize_remote_path(&request.path);
            let parent = remote_parent_path(&path);
            let target = join_remote_path(&parent, &new_name);
            conn.runtime.block_on(async {
                match &mut conn.transport {
                    FtpTransport::Plain(s) => {
                        s.rename(&path, &target).await.map_err(map_ftp_err)?
                    }
                    FtpTransport::Tls(s) => s.rename(&path, &target).await.map_err(map_ftp_err)?,
                };
                Ok::<(), String>(())
            })
        })
    }

    pub fn delete_ftp_path(&self, request: DeleteFtpPathRequest) -> Result<(), String> {
        self.with_session(&request.session_id.clone(), |conn| {
            let path = normalize_remote_path(&request.path);
            let show_hidden = conn.options.show_hidden;
            conn.runtime.block_on(async {
                delete_remote_recursive(&mut conn.transport, &path, show_hidden).await
            })
        })
    }

    pub fn ftp_path_properties(
        &self,
        request: FtpPathPropertiesRequest,
    ) -> Result<FtpPathProperties, String> {
        self.with_session(&request.session_id.clone(), |conn| {
            let path = normalize_remote_path(&request.path);
            let show_hidden = conn.options.show_hidden;
            conn.runtime
                .block_on(async { path_properties(&mut conn.transport, &path, show_hidden).await })
        })
    }

    pub fn upload_ftp_path(
        &self,
        app: AppHandle,
        request: UploadFtpPathRequest,
    ) -> Result<FtpTransferResult, String> {
        let overwrite = normalize_overwrite(request.overwrite_behavior.as_deref())?;
        let transfer_id = request.transfer_id.clone();
        let cancel_flag = self.register_transfer(&transfer_id);

        let result = self.with_session(&request.session_id.clone(), |conn| {
            let local_path = PathBuf::from(&request.local_path);
            let remote_dir = normalize_remote_path(&request.remote_directory);
            let app_handle = app.clone();
            let cancel = cancel_flag.clone();
            let tid = transfer_id.clone();
            conn.runtime.block_on(async {
                upload_entry(
                    &mut conn.transport,
                    &local_path,
                    &remote_dir,
                    overwrite,
                    &app_handle,
                    &tid,
                    cancel,
                )
                .await
            })
        });

        self.clear_transfer(&transfer_id);
        result
    }

    pub fn download_ftp_path(
        &self,
        app: AppHandle,
        request: DownloadFtpPathRequest,
    ) -> Result<FtpTransferResult, String> {
        let overwrite = normalize_overwrite(request.overwrite_behavior.as_deref())?;
        let transfer_id = request.transfer_id.clone();
        let cancel_flag = self.register_transfer(&transfer_id);

        let result = self.with_session(&request.session_id.clone(), |conn| {
            let remote_path = normalize_remote_path(&request.remote_path);
            let local_dir = PathBuf::from(&request.local_directory);
            let app_handle = app.clone();
            let cancel = cancel_flag.clone();
            let tid = transfer_id.clone();
            let show_hidden = conn.options.show_hidden;
            conn.runtime.block_on(async {
                download_entry(
                    &mut conn.transport,
                    &remote_path,
                    &local_dir,
                    overwrite,
                    &app_handle,
                    &tid,
                    cancel,
                    show_hidden,
                )
                .await
            })
        });

        self.clear_transfer(&transfer_id);
        result
    }

    pub fn cancel_ftp_transfer(&self, request: CancelFtpTransferRequest) -> Result<(), String> {
        let transfers = self
            .transfers
            .lock()
            .map_err(|_| "FTP transfer lock is poisoned".to_string())?;
        if let Some(flag) = transfers.get(&request.transfer_id) {
            flag.store(true, Ordering::SeqCst);
        }
        Ok(())
    }

    fn register_transfer(&self, transfer_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut transfers) = self.transfers.lock() {
            transfers.insert(transfer_id.to_string(), flag.clone());
        }
        flag
    }

    fn clear_transfer(&self, transfer_id: &str) {
        if let Ok(mut transfers) = self.transfers.lock() {
            transfers.remove(transfer_id);
        }
    }

    fn with_session<R>(
        &self,
        session_id: &str,
        f: impl FnOnce(&mut FtpConnection) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "FTP session lock is poisoned".to_string())?;
        let conn = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("unknown FTP session: {session_id}"))?;
        f(conn)
    }
}

impl Default for FtpSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

// ------------------------------ connect/login -------------------------------

async fn connect_and_login(
    host: &str,
    port: u16,
    user: &str,
    password: &str,
    options: &FtpOptions,
    initial_path: &str,
) -> Result<
    (
        FtpTransport,
        Option<String>,
        Vec<String>,
        Vec<FtpDirectoryEntry>,
        String,
    ),
    String,
> {
    let addr = format!("{host}:{port}");

    let (mut transport, welcome) = match (options.protocol, options.effective_tls_mode()) {
        (FtpProtocol::Ftp, _) => {
            let stream = AsyncFtpStream::connect(addr.as_str())
                .await
                .map_err(|e| format!("failed to connect to FTP server: {e}"))?;
            let welcome = stream.get_welcome_msg().map(|s| s.to_string());
            (FtpTransport::Plain(stream), welcome)
        }
        (FtpProtocol::Ftps, FtpTlsMode::Explicit) => {
            let plain: AsyncNativeTlsFtpStream = AsyncNativeTlsFtpStream::connect(addr.as_str())
                .await
                .map_err(|e| format!("failed to connect to FTPS server: {e}"))?;
            let welcome = plain.get_welcome_msg().map(|s| s.to_string());
            let connector = build_native_tls_connector(options.ignore_cert_errors)?;
            let secure: AsyncNativeTlsFtpStream = plain
                .into_secure(connector, host)
                .await
                .map_err(|e| format!("AUTH TLS failed: {e}"))?;
            (FtpTransport::Tls(secure), welcome)
        }
        (FtpProtocol::Ftps, FtpTlsMode::Implicit) => {
            let connector = build_native_tls_connector(options.ignore_cert_errors)?;
            let stream =
                AsyncNativeTlsFtpStream::connect_secure_implicit(addr.as_str(), connector, host)
                    .await
                    .map_err(|e| format!("failed to connect to implicit FTPS server: {e}"))?;
            let welcome = stream.get_welcome_msg().map(|s| s.to_string());
            (FtpTransport::Tls(stream), welcome)
        }
        (FtpProtocol::Sftp, _) => {
            return Err("SFTP not handled by ftp.rs".to_string());
        }
    };

    let user = if user.trim().is_empty() {
        "anonymous"
    } else {
        user
    };

    match &mut transport {
        FtpTransport::Plain(s) => s
            .login(user, password)
            .await
            .map_err(|e| format!("FTP login failed: {e}"))?,
        FtpTransport::Tls(s) => s
            .login(user, password)
            .await
            .map_err(|e| format!("FTPS login failed: {e}"))?,
    };

    let mode = match options.mode {
        FtpConnectionMode::Passive => FtpConnMode::Passive,
        FtpConnectionMode::Active => FtpConnMode::Active,
    };
    match &mut transport {
        FtpTransport::Plain(s) => s.set_mode(mode),
        FtpTransport::Tls(s) => s.set_mode(mode),
    }

    let file_type = match options.transfer_type {
        FtpTransferType::Binary => FileType::Binary,
        FtpTransferType::Ascii => FileType::Ascii(FormatControl::Default),
    };
    match &mut transport {
        FtpTransport::Plain(s) => s
            .transfer_type(file_type)
            .await
            .map_err(|e| format!("TYPE command failed: {e}"))?,
        FtpTransport::Tls(s) => s
            .transfer_type(file_type)
            .await
            .map_err(|e| format!("TYPE command failed: {e}"))?,
    };

    let features = match &mut transport {
        FtpTransport::Plain(s) => s.feat().await.ok(),
        FtpTransport::Tls(s) => s.feat().await.ok(),
    };
    let features_vec: Vec<String> = features
        .as_ref()
        .map(|hm| {
            hm.iter()
                .map(|(k, v)| {
                    if let Some(v) = v {
                        format!("{k} {v}")
                    } else {
                        k.clone()
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    if options.utf8
        && features_vec
            .iter()
            .any(|f| f.eq_ignore_ascii_case("UTF8") || f.starts_with("UTF8"))
    {
        let _ = match &mut transport {
            FtpTransport::Plain(s) => s.site("UTF8 ON").await.ok(),
            FtpTransport::Tls(s) => s.site("UTF8 ON").await.ok(),
        };
    }

    if !initial_path.is_empty() && initial_path != "/" {
        let _ = match &mut transport {
            FtpTransport::Plain(s) => s.cwd(initial_path).await.ok(),
            FtpTransport::Tls(s) => s.cwd(initial_path).await.ok(),
        };
    }

    let resolved_path = match &mut transport {
        FtpTransport::Plain(s) => s.pwd().await.unwrap_or_else(|_| initial_path.to_string()),
        FtpTransport::Tls(s) => s.pwd().await.unwrap_or_else(|_| initial_path.to_string()),
    };

    let entries = read_directory(&mut transport, &resolved_path, options.show_hidden).await?;

    Ok((transport, welcome, features_vec, entries, resolved_path))
}

fn build_native_tls_connector(ignore_cert_errors: bool) -> Result<AsyncNativeTlsConnector, String> {
    let mut connector = async_native_tls::TlsConnector::new();
    if ignore_cert_errors {
        connector = connector
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true);
    }
    Ok(AsyncNativeTlsConnector::from(connector))
}

fn default_ftp_port(options: &FtpOptions) -> u16 {
    match (options.protocol, options.effective_tls_mode()) {
        (FtpProtocol::Ftps, FtpTlsMode::Implicit) => 990,
        _ => 21,
    }
}

fn map_ftp_err<E: std::fmt::Display>(e: E) -> String {
    format!("FTP error: {e}")
}

// ------------------------------ directory ops -------------------------------

async fn read_directory(
    transport: &mut FtpTransport,
    path: &str,
    show_hidden: bool,
) -> Result<Vec<FtpDirectoryEntry>, String> {
    let raw_lines: Vec<String> = match transport {
        FtpTransport::Plain(s) => s.list(Some(path)).await.map_err(map_ftp_err)?,
        FtpTransport::Tls(s) => s.list(Some(path)).await.map_err(map_ftp_err)?,
    };

    let mut entries: Vec<FtpDirectoryEntry> = Vec::with_capacity(raw_lines.len());
    for line in raw_lines {
        match ListParser::parse_posix(&line) {
            Ok(file) => {
                let name = file.name().to_string();
                if name == "." || name == ".." {
                    continue;
                }
                if !show_hidden && name.starts_with('.') {
                    continue;
                }
                let kind = if file.is_directory() {
                    "folder"
                } else if file.is_symlink() {
                    "symlink"
                } else {
                    "file"
                };
                let modified = system_time_to_unix(Some(file.modified()));
                entries.push(FtpDirectoryEntry {
                    name,
                    kind: kind.to_string(),
                    size: Some(file.size() as u64),
                    modified,
                    permissions: posix_permissions_bits(&file),
                    user: None,
                    group: None,
                });
            }
            Err(_) => {
                // Fall back: treat the entry as a file with the raw line as the name.
                if line.trim().is_empty() {
                    continue;
                }
                let name = line.trim().to_string();
                if !show_hidden && name.starts_with('.') {
                    continue;
                }
                entries.push(FtpDirectoryEntry {
                    name,
                    kind: "file".to_string(),
                    size: None,
                    modified: None,
                    permissions: None,
                    user: None,
                    group: None,
                });
            }
        }
    }

    entries.sort_by(|a, b| {
        kind_rank(&a.kind)
            .cmp(&kind_rank(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

fn kind_rank(kind: &str) -> u8 {
    match kind {
        "folder" => 0,
        "symlink" => 1,
        _ => 2,
    }
}

fn posix_permissions_bits(file: &FtpListFile) -> Option<u32> {
    let mut mode: u32 = 0;
    let checks = [
        (PosixPexQuery::Owner, true, false, false),
        (PosixPexQuery::Owner, false, true, false),
        (PosixPexQuery::Owner, false, false, true),
        (PosixPexQuery::Group, true, false, false),
        (PosixPexQuery::Group, false, true, false),
        (PosixPexQuery::Group, false, false, true),
        (PosixPexQuery::Others, true, false, false),
        (PosixPexQuery::Others, false, true, false),
        (PosixPexQuery::Others, false, false, true),
    ];
    for (i, (who, read, write, exec)) in checks.iter().enumerate() {
        let allowed = if *read {
            file.can_read(*who)
        } else if *write {
            file.can_write(*who)
        } else if *exec {
            file.can_execute(*who)
        } else {
            false
        };
        if allowed {
            mode |= 1 << (8 - i);
        }
    }
    Some(mode)
}

async fn path_properties(
    transport: &mut FtpTransport,
    path: &str,
    show_hidden: bool,
) -> Result<FtpPathProperties, String> {
    let parent = remote_parent_path(path);
    let name = remote_path_name(path)?;
    let listing = read_directory(transport, &parent, show_hidden).await?;
    let entry = listing
        .into_iter()
        .find(|e| e.name == name)
        .ok_or_else(|| format!("remote path not found: {path}"))?;

    let mode = entry
        .permissions
        .map(|bits| format!("{:03o}", bits & 0o777));

    Ok(FtpPathProperties {
        path: path.to_string(),
        name: entry.name,
        kind: entry.kind,
        size: entry.size,
        modified: entry.modified,
        permissions: entry.permissions,
        mode,
        user: entry.user,
        group: entry.group,
    })
}

fn system_time_to_unix(time: Option<SystemTime>) -> Option<u64> {
    time.and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

// --------------------------- recursive delete -------------------------------

fn delete_remote_recursive<'a>(
    transport: &'a mut FtpTransport,
    path: &'a str,
    show_hidden: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        let parent = remote_parent_path(path);
        let name = remote_path_name(path)?;
        let listing = read_directory(transport, &parent, show_hidden).await?;
        let entry = match listing.into_iter().find(|e| e.name == name) {
            Some(e) => e,
            None => return Ok(()),
        };

        if entry.kind == "folder" {
            let children = read_directory(transport, path, true).await?;
            for child in children {
                let child_path = join_remote_path(path, &child.name);
                delete_remote_recursive(transport, &child_path, true).await?;
            }
            match transport {
                FtpTransport::Plain(s) => s.rmdir(path).await.map_err(map_ftp_err)?,
                FtpTransport::Tls(s) => s.rmdir(path).await.map_err(map_ftp_err)?,
            };
        } else {
            match transport {
                FtpTransport::Plain(s) => s.rm(path).await.map_err(map_ftp_err)?,
                FtpTransport::Tls(s) => s.rm(path).await.map_err(map_ftp_err)?,
            };
        }
        Ok(())
    })
}

// ------------------------------ upload paths --------------------------------

async fn upload_entry(
    transport: &mut FtpTransport,
    local_path: &Path,
    remote_dir: &str,
    overwrite: FtpOverwriteBehavior,
    app: &AppHandle,
    transfer_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<FtpTransferResult, String> {
    let metadata = fs::metadata(local_path)
        .map_err(|e| format!("cannot read local path {}: {e}", local_path.display()))?;
    let name = local_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("invalid local file name: {}", local_path.display()))?
        .to_string();

    let total_bytes = if metadata.is_file() {
        metadata.len()
    } else {
        directory_size(local_path)?
    };

    let mut transferred: u64 = 0;
    let mut files: u64 = 0;
    let mut folders: u64 = 0;

    upload_recursive(
        transport,
        local_path,
        remote_dir,
        overwrite,
        app,
        transfer_id,
        &cancel,
        total_bytes,
        &mut transferred,
        &mut files,
        &mut folders,
    )
    .await?;

    emit_progress(app, transfer_id, transferred, total_bytes);

    Ok(FtpTransferResult {
        name,
        files,
        folders,
        bytes: transferred,
    })
}

fn upload_recursive<'a>(
    transport: &'a mut FtpTransport,
    local_path: &'a Path,
    remote_dir: &'a str,
    overwrite: FtpOverwriteBehavior,
    app: &'a AppHandle,
    transfer_id: &'a str,
    cancel: &'a Arc<AtomicBool>,
    total_bytes: u64,
    transferred: &'a mut u64,
    files: &'a mut u64,
    folders: &'a mut u64,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        if cancel.load(Ordering::SeqCst) {
            return Err(TRANSFER_CANCELED.to_string());
        }

        let metadata =
            fs::metadata(local_path).map_err(|e| format!("cannot stat local path: {e}"))?;
        let name = local_path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "invalid local name".to_string())?
            .to_string();
        let target = join_remote_path(remote_dir, &name);

        if metadata.is_dir() {
            // Create the remote directory if missing.
            let mkdir_res = match transport {
                FtpTransport::Plain(s) => s.mkdir(&target).await,
                FtpTransport::Tls(s) => s.mkdir(&target).await,
            };
            // Ignore "already exists" errors on the mkdir, which manifest as 550.
            if let Err(e) = mkdir_res {
                let msg = format!("{e}");
                if !msg.contains("550") && !msg.contains("File exists") {
                    return Err(map_ftp_err(e));
                }
            }
            *folders += 1;

            let mut entries: Vec<_> = fs::read_dir(local_path)
                .map_err(|e| format!("cannot read local directory: {e}"))?
                .collect::<Result<_, _>>()
                .map_err(|e| format!("cannot read local directory entry: {e}"))?;
            entries.sort_by_key(|e| e.file_name());

            for child in entries {
                upload_recursive(
                    transport,
                    &child.path(),
                    &target,
                    overwrite,
                    app,
                    transfer_id,
                    cancel,
                    total_bytes,
                    transferred,
                    files,
                    folders,
                )
                .await?;
            }
        } else {
            if overwrite == FtpOverwriteBehavior::Fail {
                let exists = remote_path_exists(transport, &target).await;
                if exists {
                    return Err(format!("remote path already exists: {target}"));
                }
            }
            upload_file_bytes(
                transport,
                local_path,
                &target,
                app,
                transfer_id,
                cancel,
                total_bytes,
                transferred,
            )
            .await?;
            *files += 1;
        }

        Ok(())
    })
}

async fn upload_file_bytes(
    transport: &mut FtpTransport,
    local_path: &Path,
    remote_path: &str,
    app: &AppHandle,
    transfer_id: &str,
    cancel: &Arc<AtomicBool>,
    total_bytes: u64,
    transferred: &mut u64,
) -> Result<(), String> {
    let mut file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("cannot open local file: {e}"))?;

    let mut buf = vec![0u8; TRANSFER_CHUNK_SIZE];
    let mut cursor: Vec<u8> = Vec::new();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(TRANSFER_CANCELED.to_string());
        }
        let n = file
            .read(&mut buf)
            .await
            .map_err(|e| format!("read error: {e}"))?;
        if n == 0 {
            break;
        }
        cursor.extend_from_slice(&buf[..n]);
        *transferred += n as u64;
        emit_progress(app, transfer_id, *transferred, total_bytes);
    }

    let mut reader = Cursor::new(cursor);
    match transport {
        FtpTransport::Plain(s) => s
            .put_file(remote_path, &mut reader)
            .await
            .map_err(map_ftp_err)?,
        FtpTransport::Tls(s) => s
            .put_file(remote_path, &mut reader)
            .await
            .map_err(map_ftp_err)?,
    };

    Ok(())
}

// ----------------------------- download paths -------------------------------

async fn download_entry(
    transport: &mut FtpTransport,
    remote_path: &str,
    local_dir: &Path,
    overwrite: FtpOverwriteBehavior,
    app: &AppHandle,
    transfer_id: &str,
    cancel: Arc<AtomicBool>,
    show_hidden: bool,
) -> Result<FtpTransferResult, String> {
    let name = remote_path_name(remote_path)?;
    let props = path_properties(transport, remote_path, show_hidden).await?;
    let is_dir = props.kind == "folder";
    let total_bytes = if is_dir {
        directory_remote_size(transport, remote_path, show_hidden).await?
    } else {
        props.size.unwrap_or(0)
    };

    let mut transferred: u64 = 0;
    let mut files: u64 = 0;
    let mut folders: u64 = 0;

    download_recursive(
        transport,
        remote_path,
        local_dir,
        overwrite,
        app,
        transfer_id,
        &cancel,
        total_bytes,
        &mut transferred,
        &mut files,
        &mut folders,
        show_hidden,
    )
    .await?;

    emit_progress(app, transfer_id, transferred, total_bytes);

    Ok(FtpTransferResult {
        name,
        files,
        folders,
        bytes: transferred,
    })
}

fn download_recursive<'a>(
    transport: &'a mut FtpTransport,
    remote_path: &'a str,
    local_dir: &'a Path,
    overwrite: FtpOverwriteBehavior,
    app: &'a AppHandle,
    transfer_id: &'a str,
    cancel: &'a Arc<AtomicBool>,
    total_bytes: u64,
    transferred: &'a mut u64,
    files: &'a mut u64,
    folders: &'a mut u64,
    show_hidden: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        if cancel.load(Ordering::SeqCst) {
            return Err(TRANSFER_CANCELED.to_string());
        }

        let name = remote_path_name(remote_path)?;
        let local_target = local_dir.join(&name);

        let parent = remote_parent_path(remote_path);
        let listing = read_directory(transport, &parent, show_hidden).await?;
        let entry = listing
            .into_iter()
            .find(|e| e.name == name)
            .ok_or_else(|| format!("remote path not found: {remote_path}"))?;

        if entry.kind == "folder" {
            if !local_target.exists() {
                fs::create_dir_all(&local_target)
                    .map_err(|e| format!("cannot create local directory: {e}"))?;
            }
            *folders += 1;

            let children = read_directory(transport, remote_path, show_hidden).await?;
            for child in children {
                let child_path = join_remote_path(remote_path, &child.name);
                download_recursive(
                    transport,
                    &child_path,
                    &local_target,
                    overwrite,
                    app,
                    transfer_id,
                    cancel,
                    total_bytes,
                    transferred,
                    files,
                    folders,
                    show_hidden,
                )
                .await?;
            }
        } else {
            if overwrite == FtpOverwriteBehavior::Fail && local_target.exists() {
                return Err(format!(
                    "local path already exists: {}",
                    local_target.display()
                ));
            }
            if local_target.exists() && local_target.is_file() {
                fs::remove_file(&local_target)
                    .map_err(|e| format!("cannot overwrite local file: {e}"))?;
            }
            download_file_bytes(
                transport,
                remote_path,
                &local_target,
                app,
                transfer_id,
                cancel,
                total_bytes,
                transferred,
            )
            .await?;
            *files += 1;
        }

        Ok(())
    })
}

async fn download_file_bytes(
    transport: &mut FtpTransport,
    remote_path: &str,
    local_target: &Path,
    app: &AppHandle,
    transfer_id: &str,
    cancel: &Arc<AtomicBool>,
    total_bytes: u64,
    transferred: &mut u64,
) -> Result<(), String> {
    let bytes = match transport {
        FtpTransport::Plain(s) => {
            let mut reader = s.retr_as_stream(remote_path).await.map_err(map_ftp_err)?;
            let mut buf = Vec::new();
            let mut chunk = vec![0u8; TRANSFER_CHUNK_SIZE];
            loop {
                if cancel.load(Ordering::SeqCst) {
                    return Err(TRANSFER_CANCELED.to_string());
                }
                let n = reader
                    .read(&mut chunk)
                    .await
                    .map_err(|e| format!("FTP read error: {e}"))?;
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                *transferred += n as u64;
                emit_progress(app, transfer_id, *transferred, total_bytes);
            }
            reader.finish().await.map_err(map_ftp_err)?;
            buf
        }
        FtpTransport::Tls(s) => {
            let mut reader = s.retr_as_stream(remote_path).await.map_err(map_ftp_err)?;
            let mut buf = Vec::new();
            let mut chunk = vec![0u8; TRANSFER_CHUNK_SIZE];
            loop {
                if cancel.load(Ordering::SeqCst) {
                    return Err(TRANSFER_CANCELED.to_string());
                }
                let n = reader
                    .read(&mut chunk)
                    .await
                    .map_err(|e| format!("FTPS read error: {e}"))?;
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                *transferred += n as u64;
                emit_progress(app, transfer_id, *transferred, total_bytes);
            }
            reader.finish().await.map_err(map_ftp_err)?;
            buf
        }
    };

    let mut local = tokio::fs::File::create(local_target)
        .await
        .map_err(|e| format!("cannot create local file: {e}"))?;
    local
        .write_all(&bytes)
        .await
        .map_err(|e| format!("cannot write local file: {e}"))?;
    Ok(())
}

async fn directory_remote_size(
    transport: &mut FtpTransport,
    path: &str,
    show_hidden: bool,
) -> Result<u64, String> {
    let mut total = 0u64;
    let entries = read_directory(transport, path, show_hidden).await?;
    for entry in entries {
        let entry_path = join_remote_path(path, &entry.name);
        if entry.kind == "folder" {
            // Use a boxed recursive call to compute children.
            let nested = Box::pin(directory_remote_size(transport, &entry_path, show_hidden));
            total = total.saturating_add(nested.await?);
        } else {
            total = total.saturating_add(entry.size.unwrap_or(0));
        }
    }
    Ok(total)
}

async fn remote_path_exists(transport: &mut FtpTransport, path: &str) -> bool {
    let size_res = match transport {
        FtpTransport::Plain(s) => s.size(path).await,
        FtpTransport::Tls(s) => s.size(path).await,
    };
    if size_res.is_ok() {
        return true;
    }
    let cwd_res = match transport {
        FtpTransport::Plain(s) => s.cwd(path).await.map(|_| ()),
        FtpTransport::Tls(s) => s.cwd(path).await.map(|_| ()),
    };
    if cwd_res.is_ok() {
        let _ = match transport {
            FtpTransport::Plain(s) => s.cdup().await,
            FtpTransport::Tls(s) => s.cdup().await,
        };
        return true;
    }
    false
}

fn directory_size(path: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    if path.is_file() {
        return Ok(fs::metadata(path).map(|m| m.len()).unwrap_or(0));
    }
    let walker = walk_dir(path)?;
    for entry in walker {
        if entry.is_file() {
            total = total.saturating_add(fs::metadata(&entry).map(|m| m.len()).unwrap_or(0));
        }
    }
    Ok(total)
}

fn walk_dir(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        let metadata = fs::metadata(&current).map_err(|e| format!("walk error: {e}"))?;
        if metadata.is_file() {
            out.push(current);
        } else if metadata.is_dir() {
            for entry in fs::read_dir(&current).map_err(|e| format!("walk error: {e}"))? {
                let entry = entry.map_err(|e| format!("walk error: {e}"))?;
                stack.push(entry.path());
            }
        }
    }
    Ok(out)
}

// -------------------------------- helpers -----------------------------------

fn normalize_remote_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        "/".to_string()
    } else if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

fn join_remote_path(base: &str, child: &str) -> String {
    let base = base.trim_end_matches('/');
    let child = child.trim_start_matches('/');
    if base.is_empty() {
        format!("/{child}")
    } else {
        format!("{base}/{child}")
    }
}

fn remote_parent_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    match trimmed.rfind('/') {
        Some(0) => "/".to_string(),
        Some(idx) => trimmed[..idx].to_string(),
        None => "/".to_string(),
    }
}

fn remote_path_name(path: &str) -> Result<String, String> {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("remote path has no name".to_string());
    }
    Ok(trimmed.rsplit('/').next().unwrap_or(trimmed).to_string())
}

fn validate_remote_child_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("name cannot be empty".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("name cannot contain path separators".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("name cannot be '.' or '..'".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_overwrite(value: Option<&str>) -> Result<FtpOverwriteBehavior, String> {
    match value.unwrap_or("fail") {
        "fail" => Ok(FtpOverwriteBehavior::Fail),
        "overwrite" => Ok(FtpOverwriteBehavior::Overwrite),
        other => Err(format!("unknown overwrite behavior: {other}")),
    }
}

fn make_session_id(title: &str) -> String {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let slug: String = title
        .chars()
        .filter_map(|c| {
            if c.is_ascii_alphanumeric() {
                Some(c.to_ascii_lowercase())
            } else if c.is_whitespace() || c == '-' || c == '_' {
                Some('-')
            } else {
                None
            }
        })
        .collect();
    let slug = if slug.is_empty() {
        "ftp".to_string()
    } else {
        slug
    };
    format!("ftp-{slug}-{now}")
}

fn emit_progress(app: &AppHandle, transfer_id: &str, transferred: u64, total: u64) {
    let progress = if total == 0 {
        100
    } else {
        ((transferred as u128 * 100) / total as u128).min(100) as u8
    };
    let _ = app.emit(
        "ftp-transfer-progress",
        FtpTransferProgress {
            transfer_id: transfer_id.to_string(),
            transferred_bytes: transferred,
            total_bytes: total,
            progress,
        },
    );
    let _ = Duration::from_secs(0);
}

// --------------------------------- tests ------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ftp_options_round_trip_through_json() {
        let opts = FtpOptions {
            protocol: FtpProtocol::Ftps,
            mode: FtpConnectionMode::Active,
            tls_mode: Some(FtpTlsMode::Implicit),
            transfer_type: FtpTransferType::Ascii,
            utf8: true,
            show_hidden: true,
            connect_timeout_secs: Some(15),
            ignore_cert_errors: true,
            keepalive_secs: Some(30),
            local_path: Some("C:\\Users\\example\\Downloads".to_string()),
            remote_path: Some("/srv/files".to_string()),
        };
        let json = opts.to_json().unwrap();
        let parsed = FtpOptions::from_json(&json).unwrap();
        assert_eq!(parsed.protocol, FtpProtocol::Ftps);
        assert_eq!(parsed.mode, FtpConnectionMode::Active);
        assert_eq!(parsed.tls_mode, Some(FtpTlsMode::Implicit));
        assert_eq!(parsed.transfer_type, FtpTransferType::Ascii);
        assert!(parsed.show_hidden);
        assert!(parsed.ignore_cert_errors);
        assert_eq!(parsed.keepalive_secs, Some(30));
        assert_eq!(
            parsed.local_path.as_deref(),
            Some("C:\\Users\\example\\Downloads")
        );
        assert_eq!(parsed.remote_path.as_deref(), Some("/srv/files"));
    }

    #[test]
    fn ftp_options_defaults_when_fields_missing() {
        let json = r#"{"protocol":"ftp"}"#;
        let parsed = FtpOptions::from_json(json).unwrap();
        assert_eq!(parsed.protocol, FtpProtocol::Ftp);
        assert_eq!(parsed.mode, FtpConnectionMode::Passive);
        assert_eq!(parsed.transfer_type, FtpTransferType::Binary);
        assert!(!parsed.show_hidden);
        assert!(parsed.tls_mode.is_none());
    }

    #[test]
    fn default_port_resolves_by_protocol_and_tls_mode() {
        let plain = FtpOptions::default();
        assert_eq!(default_ftp_port(&plain), 21);

        let explicit_ftps = FtpOptions {
            protocol: FtpProtocol::Ftps,
            tls_mode: Some(FtpTlsMode::Explicit),
            ..FtpOptions::default()
        };
        assert_eq!(default_ftp_port(&explicit_ftps), 21);

        let implicit_ftps = FtpOptions {
            protocol: FtpProtocol::Ftps,
            tls_mode: Some(FtpTlsMode::Implicit),
            ..FtpOptions::default()
        };
        assert_eq!(default_ftp_port(&implicit_ftps), 990);
    }

    #[test]
    fn remote_path_helpers_handle_root_and_nested() {
        assert_eq!(normalize_remote_path(""), "/");
        assert_eq!(normalize_remote_path("foo"), "/foo");
        assert_eq!(normalize_remote_path("/foo/bar"), "/foo/bar");

        assert_eq!(remote_parent_path("/foo"), "/");
        assert_eq!(remote_parent_path("/foo/bar"), "/foo");
        assert_eq!(remote_parent_path("/"), "/");

        assert_eq!(remote_path_name("/foo/bar").unwrap(), "bar");
        assert_eq!(remote_path_name("/foo").unwrap(), "foo");
        assert!(remote_path_name("/").is_err());

        assert_eq!(join_remote_path("/foo", "bar"), "/foo/bar");
        assert_eq!(join_remote_path("/", "bar"), "/bar");
        assert_eq!(join_remote_path("/foo/", "/bar"), "/foo/bar");
    }

    #[test]
    fn validate_remote_child_name_rejects_path_segments() {
        assert!(validate_remote_child_name("foo").is_ok());
        assert!(validate_remote_child_name("").is_err());
        assert!(validate_remote_child_name("foo/bar").is_err());
        assert!(validate_remote_child_name("..").is_err());
        assert!(validate_remote_child_name(".").is_err());
    }
}

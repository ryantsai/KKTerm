use crate::{secrets, ssh};
use russh::{Disconnect, client};
use russh_sftp::{
    client::{Config as SftpConfig, SftpSession, fs::Metadata},
    protocol::{FileAttributes, FileType, OpenFlags},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    future::Future,
    io::{Read, Write},
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::runtime::Runtime;
use tokio_util::sync::CancellationToken;

const TRANSFER_CHUNK_SIZE: usize = 64 * 1024;
const SFTP_MAX_CONCURRENT_WRITES: usize = 1;
const SFTP_STARTUP_TIMEOUT: Duration = Duration::from_secs(45);
const SFTP_TRANSFER_IO_TIMEOUT: Duration = Duration::from_secs(60);
const SFTP_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
const TRANSFER_CANCELED: &str = "transfer canceled";
const SFTP_SESSION_INVALIDATED_MARKER: &str = "[KKTERM_SFTP_SESSION_INVALIDATED]";
const WINDOWS_DRIVES_PATH: &str = "__KKTERM_WINDOWS_DRIVES__";

fn sftp_client_config() -> SftpConfig {
    SftpConfig {
        max_concurrent_writes: SFTP_MAX_CONCURRENT_WRITES,
        ..SftpConfig::default()
    }
}

fn effective_sftp_ssh_compression(_requested: Option<bool>) -> bool {
    // russh 0.61.2 can truncate an outgoing zlib stream when incompressible
    // input fills its undersized compression buffer. SFTP commonly carries
    // already-compressed data, so keep compression off until the dependency is
    // fixed and covered by an incompressible-payload regression test.
    false
}

pub struct SftpSessionManager {
    sessions: Mutex<HashMap<String, Arc<Mutex<SftpConnection>>>>,
    transfers: Mutex<HashMap<String, CancellationToken>>,
}

struct SftpConnection {
    runtime: Runtime,
    ssh_session: client::Handle<ssh::VerifyingClient>,
    sftp: SftpSession,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSftpSessionRequest {
    pub session_id: Option<String>,
    pub title: String,
    pub host: String,
    pub user: String,
    pub port: Option<u16>,
    pub key_path: Option<String>,
    pub proxy_jump: Option<String>,
    pub ssh_socks_proxy: Option<String>,
    pub ssh_socks_proxy_username: Option<String>,
    pub ssh_socks_proxy_secret_owner_id: Option<String>,
    pub auth_method: Option<String>,
    pub secret_owner_id: Option<String>,
    pub password: Option<String>,
    pub passphrase_owner_id: Option<String>,
    pub path: Option<String>,
    pub ssh_compression: Option<bool>,
    #[serde(default)]
    pub ssh_old_protocols: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSftpDirectoryRequest {
    session_id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListLocalDirectoryRequest {
    path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSftpPathRequest {
    session_id: String,
    transfer_id: String,
    local_path: String,
    remote_directory: String,
    overwrite_behavior: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSftpPathRequest {
    session_id: String,
    transfer_id: String,
    remote_path: String,
    local_directory: String,
    overwrite_behavior: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelSftpTransferRequest {
    transfer_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSftpFolderRequest {
    session_id: String,
    parent_path: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSftpPathRequest {
    session_id: String,
    path: String,
    new_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSftpPathRequest {
    session_id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpPathPropertiesRequest {
    session_id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSftpPathPropertiesRequest {
    session_id: String,
    path: String,
    permissions: Option<String>,
    uid: Option<u32>,
    gid: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpSessionStarted {
    session_id: String,
    path: String,
    entries: Vec<SftpDirectoryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDirectoryListing {
    session_id: String,
    path: String,
    entries: Vec<SftpDirectoryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirectoryListing {
    path: String,
    entries: Vec<LocalDirectoryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDirectoryEntry {
    name: String,
    kind: String,
    size: Option<u64>,
    modified: Option<u64>,
    accessed: Option<u64>,
    permissions: Option<u32>,
    uid: Option<u32>,
    user: Option<String>,
    gid: Option<u32>,
    group: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirectoryEntry {
    name: String,
    kind: String,
    size: Option<u64>,
    modified: Option<u64>,
}

// Finder/Explorer-style sidebar places: the user's home and well-known folders
// plus mounted drives with capacity. Backs the local File Explorer / file-browser
// local-pane navigation sidebar.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlace {
    id: String,
    label: String,
    path: String,
    icon: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDrivePlace {
    id: String,
    label: String,
    path: String,
    icon: String,
    total_bytes: u64,
    free_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlacesListing {
    home: Option<LocalPlace>,
    common: Vec<LocalPlace>,
    drives: Vec<LocalDrivePlace>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferResult {
    name: String,
    files: u64,
    folders: u64,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpPathProperties {
    path: String,
    name: String,
    kind: String,
    size: Option<u64>,
    modified: Option<u64>,
    accessed: Option<u64>,
    permissions: Option<u32>,
    mode: Option<String>,
    uid: Option<u32>,
    user: Option<String>,
    gid: Option<u32>,
    group: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferProgress {
    transfer_id: String,
    transferred_bytes: u64,
    total_bytes: u64,
    progress: u8,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SftpAuthMethod {
    KeyFile,
    Password,
    Agent,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SftpOverwriteBehavior {
    Fail,
    Overwrite,
}

struct RemoteUploadTarget {
    flags: OpenFlags,
    existed: bool,
}

fn sftp_debug(event: &str, payload: Value) {
    crate::logging::sftp_debug(event, &payload);
}

impl SftpSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            transfers: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_sftp_session(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        mut request: StartSftpSessionRequest,
    ) -> Result<SftpSessionStarted, String> {
        let has_proxy_jump = request
            .proxy_jump
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        request.ssh_socks_proxy = crate::resolve_ssh_socks_proxy(
            secrets,
            request.ssh_socks_proxy.take(),
            request.ssh_socks_proxy_username.take(),
            request.ssh_socks_proxy_secret_owner_id.take(),
            has_proxy_jump,
        )?;
        if request
            .proxy_jump
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
        {
            return Err("native SFTP sessions do not support ProxyJump yet".to_string());
        }

        let session_id = request
            .session_id
            .clone()
            .unwrap_or_else(|| make_session_id(&request.title));
        let path = request
            .path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(".")
            .to_string();
        let auth_method = auth_method_for(&request)?;
        let auth = auth_for(secrets, &request, auth_method)?;
        let known_hosts_path = ssh::app_known_hosts_path(&app)?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("failed to create SFTP runtime: {error}"))?;

        let host = request.host.clone();
        let user = request.user.clone();
        let port = request.port.unwrap_or(22);
        let socks_proxy = request.ssh_socks_proxy.clone();
        let requested_compression = request.ssh_compression.unwrap_or(true);
        let compression = effective_sftp_ssh_compression(request.ssh_compression);
        sftp_debug(
            "session.start.begin",
            json!({
                "sessionId": session_id,
                "host": host,
                "port": port,
                "user": user,
                "authMethod": sftp_auth_method_name(auth_method),
                "keyPathConfigured": request.key_path.as_deref().map(str::trim).is_some_and(|value| !value.is_empty()),
                "transientPasswordProvided": request.password.as_deref().map(str::trim).is_some_and(|value| !value.is_empty()),
                "passphraseOwnerConfigured": request.passphrase_owner_id.as_deref().map(str::trim).is_some_and(|value| !value.is_empty()),
                "socksProxyConfigured": request.ssh_socks_proxy.as_deref().map(str::trim).is_some_and(|value| !value.is_empty()),
                "compressionRequested": requested_compression,
                "compression": compression,
                "path": path,
                "timeoutSeconds": SFTP_STARTUP_TIMEOUT.as_secs(),
            }),
        );
        let startup = runtime.block_on(async {
            tokio::time::timeout(SFTP_STARTUP_TIMEOUT, async {
                let ssh_session = ssh::connect_verified_client(ssh::NativeSshConnectionRequest {
                    host: host.clone(),
                    user: user.clone(),
                    port,
                    auth,
                    known_hosts_path,
                    x11_forwarding: None,
                    socks_proxy,
                    compression,
                    old_protocols: request.ssh_old_protocols.unwrap_or(false),
                    remote_forward_targets: None,
                    bridge_tasks: None,
                })
                .await?;
                sftp_debug(
                    "session.start.ssh_connected",
                    json!({
                        "sessionId": session_id,
                        "host": host,
                        "port": port,
                        "user": user,
                    }),
                );

                let channel = ssh_session
                    .channel_open_session()
                    .await
                    .map_err(|error| format!("failed to open SFTP SSH channel: {error}"))?;
                sftp_debug(
                    "session.start.channel_opened",
                    json!({
                        "sessionId": session_id,
                        "host": host,
                        "port": port,
                    }),
                );
                channel
                    .request_subsystem(true, "sftp")
                    .await
                    .map_err(|error| format!("failed to start SFTP subsystem: {error}"))?;
                sftp_debug(
                    "session.start.subsystem_started",
                    json!({
                        "sessionId": session_id,
                        "host": host,
                        "port": port,
                    }),
                );
                let sftp =
                    SftpSession::new_with_config(channel.into_stream(), sftp_client_config())
                        .await
                        .map_err(|error| format!("failed to initialize SFTP session: {error}"))?;
                let listing = read_directory(&sftp, &session_id, &path).await?;
                sftp_debug(
                    "session.start.listing_ok",
                    json!({
                        "sessionId": session_id,
                        "host": host,
                        "port": port,
                        "path": listing.path,
                        "entryCount": listing.entries.len(),
                    }),
                );
                Ok::<_, String>((ssh_session, sftp, listing))
            })
            .await
            .map_err(|_| sftp_timeout_message("starting SFTP session", SFTP_STARTUP_TIMEOUT))?
        });
        let (ssh_session, sftp, listing) = match startup {
            Ok(started) => started,
            Err(error) => {
                sftp_debug(
                    "session.start.error",
                    json!({
                        "sessionId": session_id,
                        "host": request.host,
                        "port": port,
                        "user": request.user,
                        "error": error,
                    }),
                );
                return Err(error);
            }
        };

        self.sessions
            .lock()
            .map_err(|_| "SFTP session lock is poisoned".to_string())?
            .insert(
                session_id.clone(),
                Arc::new(Mutex::new(SftpConnection {
                    runtime,
                    ssh_session,
                    sftp,
                })),
            );
        sftp_debug(
            "session.start.ok",
            json!({
                "sessionId": session_id,
                "host": request.host,
                "port": port,
                "path": listing.path,
                "entryCount": listing.entries.len(),
            }),
        );

        Ok(SftpSessionStarted {
            session_id,
            path: listing.path,
            entries: listing.entries,
        })
    }

    pub fn list_directory(
        &self,
        request: ListSftpDirectoryRequest,
    ) -> Result<SftpDirectoryListing, String> {
        self.with_session(&request.session_id, "listDirectory", |session| {
            session.runtime.block_on(read_directory(
                &session.sftp,
                &request.session_id,
                &request.path,
            ))
        })
    }

    pub fn upload_path(
        &self,
        app: AppHandle,
        request: UploadSftpPathRequest,
    ) -> Result<SftpTransferResult, String> {
        let overwrite_behavior =
            normalize_sftp_overwrite_behavior(request.overwrite_behavior.as_deref())?;
        let cancellation = self.register_transfer(&request.transfer_id)?;
        sftp_debug(
            "transfer.upload.begin",
            json!({
                "sessionId": request.session_id,
                "transferId": request.transfer_id,
                "localPath": request.local_path,
                "remoteDirectory": request.remote_directory,
                "overwriteBehavior": sftp_overwrite_behavior_name(overwrite_behavior),
            }),
        );
        let result = self.with_session(&request.session_id, "upload", |session| {
            session.runtime.block_on(upload_path(
                &session.sftp,
                app,
                &request.transfer_id,
                cancellation,
                overwrite_behavior,
                &request.local_path,
                &request.remote_directory,
            ))
        });
        if let Err(error) = &result
            && is_session_invalidating_transfer_error(error)
        {
            self.invalidate_session(&request.session_id, transfer_error_message(error), "upload");
        }
        self.finish_transfer(&request.transfer_id);
        log_transfer_result(
            "transfer.upload",
            &request.session_id,
            &request.transfer_id,
            &result,
        );
        result
    }

    pub fn download_path(
        &self,
        app: AppHandle,
        request: DownloadSftpPathRequest,
    ) -> Result<SftpTransferResult, String> {
        let overwrite_behavior =
            normalize_sftp_overwrite_behavior(request.overwrite_behavior.as_deref())?;
        let cancellation = self.register_transfer(&request.transfer_id)?;
        sftp_debug(
            "transfer.download.begin",
            json!({
                "sessionId": request.session_id,
                "transferId": request.transfer_id,
                "remotePath": request.remote_path,
                "localDirectory": request.local_directory,
                "overwriteBehavior": sftp_overwrite_behavior_name(overwrite_behavior),
            }),
        );
        let result = self.with_session(&request.session_id, "download", |session| {
            session.runtime.block_on(download_path(
                &session.sftp,
                app,
                &request.transfer_id,
                cancellation,
                overwrite_behavior,
                &request.remote_path,
                &request.local_directory,
            ))
        });
        if let Err(error) = &result
            && is_session_invalidating_transfer_error(error)
        {
            self.invalidate_session(
                &request.session_id,
                transfer_error_message(error),
                "download",
            );
        }
        self.finish_transfer(&request.transfer_id);
        log_transfer_result(
            "transfer.download",
            &request.session_id,
            &request.transfer_id,
            &result,
        );
        result
    }

    pub fn cancel_transfer(&self, request: CancelSftpTransferRequest) -> Result<(), String> {
        let found = if let Some(cancellation) = self
            .transfers
            .lock()
            .map_err(|_| "SFTP transfer lock is poisoned".to_string())?
            .get(&request.transfer_id)
        {
            cancellation.cancel();
            true
        } else {
            false
        };
        sftp_debug(
            "transfer.cancel",
            json!({
                "transferId": request.transfer_id,
                "found": found,
            }),
        );
        Ok(())
    }

    pub fn create_folder(&self, request: CreateSftpFolderRequest) -> Result<(), String> {
        self.with_session(&request.session_id, "createFolder", |session| {
            session.runtime.block_on(create_folder(
                &session.sftp,
                &request.parent_path,
                &request.name,
            ))
        })
    }

    pub fn rename_path(&self, request: RenameSftpPathRequest) -> Result<(), String> {
        self.with_session(&request.session_id, "rename", |session| {
            session
                .runtime
                .block_on(rename_path(&session.sftp, &request.path, &request.new_name))
        })
    }

    pub fn delete_path(&self, request: DeleteSftpPathRequest) -> Result<(), String> {
        self.with_session(&request.session_id, "delete", |session| {
            session
                .runtime
                .block_on(delete_remote_entry(&session.sftp, &request.path))
        })
    }

    pub fn path_properties(
        &self,
        request: SftpPathPropertiesRequest,
    ) -> Result<SftpPathProperties, String> {
        self.with_session(&request.session_id, "properties", |session| {
            session
                .runtime
                .block_on(path_properties(&session.sftp, &request.path))
        })
    }

    pub fn update_path_properties(
        &self,
        request: UpdateSftpPathPropertiesRequest,
    ) -> Result<SftpPathProperties, String> {
        let permissions = match request.permissions.as_deref() {
            Some(value) => Some(parse_octal_permissions(value)?),
            None => None,
        };
        if permissions.is_none() && request.uid.is_none() && request.gid.is_none() {
            return Err("at least one SFTP property must be changed".to_string());
        }

        self.with_session(&request.session_id, "updateProperties", |session| {
            session.runtime.block_on(async {
                update_path_properties(
                    &session.sftp,
                    &request.path,
                    permissions,
                    request.uid,
                    request.gid,
                )
                .await?;
                path_properties(&session.sftp, &request.path).await
            })
        })
    }

    pub fn close_sftp_session(&self, session_id: String) -> Result<(), String> {
        let session = {
            self.sessions
                .lock()
                .map_err(|_| "SFTP session lock is poisoned".to_string())?
                .remove(&session_id)
        };
        if let Some(session) = session {
            sftp_debug(
                "session.close.begin",
                json!({
                    "sessionId": session_id,
                    "sharedReferences": Arc::strong_count(&session),
                    "timeoutSeconds": SFTP_CLOSE_TIMEOUT.as_secs(),
                }),
            );
            let close_result = {
                let session = session
                    .lock()
                    .map_err(|_| "SFTP session lock is poisoned".to_string())?;
                session.runtime.block_on(async {
                    tokio::time::timeout(SFTP_CLOSE_TIMEOUT, async {
                        let _ = session.sftp.close().await;
                        session
                            .ssh_session
                            .disconnect(Disconnect::ByApplication, "", "en")
                            .await
                    })
                    .await
                    .map_err(|_| sftp_timeout_message("closing SFTP session", SFTP_CLOSE_TIMEOUT))
                })
            };
            match close_result {
                Ok(_) => sftp_debug("session.close.ok", json!({ "sessionId": session_id })),
                Err(error) => sftp_debug(
                    "session.close.error",
                    json!({
                        "sessionId": session_id,
                        "error": error,
                    }),
                ),
            }
        } else {
            sftp_debug(
                "session.close.missing",
                json!({
                    "sessionId": session_id,
                }),
            );
        }
        Ok(())
    }

    fn shared_session(&self, session_id: &str) -> Result<Arc<Mutex<SftpConnection>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "SFTP session map lock is poisoned".to_string())?
            .get(session_id)
            .cloned()
            .ok_or_else(|| "SFTP session was not found".to_string())
    }

    fn with_session<R>(
        &self,
        session_id: &str,
        operation: &'static str,
        f: impl FnOnce(&SftpConnection) -> Result<R, String>,
    ) -> Result<R, String> {
        let session = self.shared_session(session_id)?;
        sftp_debug(
            "session.operation.wait",
            json!({
                "sessionId": session_id,
                "operation": operation,
            }),
        );
        let session = session
            .lock()
            .map_err(|_| "SFTP session lock is poisoned".to_string())?;
        sftp_debug(
            "session.operation.begin",
            json!({
                "sessionId": session_id,
                "operation": operation,
            }),
        );
        let result = f(&session);
        match &result {
            Ok(_) => sftp_debug(
                "session.operation.ok",
                json!({
                    "sessionId": session_id,
                    "operation": operation,
                }),
            ),
            Err(error) => sftp_debug(
                "session.operation.error",
                json!({
                    "sessionId": session_id,
                    "operation": operation,
                    "error": error,
                }),
            ),
        }
        result
    }

    fn invalidate_session(&self, session_id: &str, reason: &str, operation: &str) {
        let session = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(session_id));
        sftp_debug(
            "session.invalidated",
            json!({
                "sessionId": session_id,
                "operation": operation,
                "reason": reason,
                "removed": session.is_some(),
            }),
        );
        let Some(session) = session else {
            return;
        };
        let close_result = session
            .lock()
            .map_err(|_| "SFTP session lock is poisoned".to_string())
            .and_then(|session| {
                session.runtime.block_on(async {
                    tokio::time::timeout(SFTP_CLOSE_TIMEOUT, async {
                        let _ = session.sftp.close().await;
                        session
                            .ssh_session
                            .disconnect(Disconnect::ByApplication, "", "en")
                            .await
                    })
                    .await
                    .map_err(|_| {
                        sftp_timeout_message("closing invalidated SFTP session", SFTP_CLOSE_TIMEOUT)
                    })
                })
            });
        match close_result {
            Ok(_) => sftp_debug(
                "session.invalidated.close_ok",
                json!({ "sessionId": session_id }),
            ),
            Err(error) => sftp_debug(
                "session.invalidated.close_error",
                json!({
                    "sessionId": session_id,
                    "error": error,
                }),
            ),
        }
    }

    fn register_transfer(&self, transfer_id: &str) -> Result<CancellationToken, String> {
        let transfer_id = transfer_id.trim();
        if transfer_id.is_empty() {
            return Err("SFTP transfer id cannot be blank".to_string());
        }

        let cancellation = CancellationToken::new();
        self.transfers
            .lock()
            .map_err(|_| "SFTP transfer lock is poisoned".to_string())?
            .insert(transfer_id.to_string(), cancellation.clone());
        Ok(cancellation)
    }

    fn finish_transfer(&self, transfer_id: &str) {
        if let Ok(mut transfers) = self.transfers.lock() {
            transfers.remove(transfer_id);
        }
    }
}

async fn upload_path(
    sftp: &SftpSession,
    app: AppHandle,
    transfer_id: &str,
    cancellation: CancellationToken,
    overwrite_behavior: SftpOverwriteBehavior,
    local_path: &str,
    remote_directory: &str,
) -> Result<SftpTransferResult, String> {
    let source = fs::canonicalize(local_path)
        .map_err(|error| format!("failed to resolve local source: {error}"))?;
    let name = local_path_name(&source)?;
    let remote_target = join_remote_path(remote_directory, &name);
    let total_bytes = local_transfer_size(&source)?;
    sftp_debug(
        "transfer.upload.plan",
        json!({
            "transferId": transfer_id,
            "localPath": display_local_path(&source),
            "remoteTarget": remote_target,
            "totalBytes": total_bytes,
        }),
    );
    let mut progress = TransferProgress::new(app, transfer_id, cancellation, total_bytes);
    progress.emit();

    let mut summary = TransferSummary {
        name,
        ..TransferSummary::default()
    };
    upload_local_entry(
        sftp,
        &source,
        &remote_target,
        transfer_id,
        overwrite_behavior,
        &mut summary,
        &mut progress,
    )
    .await?;
    Ok(summary.into_result())
}

async fn download_path(
    sftp: &SftpSession,
    app: AppHandle,
    transfer_id: &str,
    cancellation: CancellationToken,
    overwrite_behavior: SftpOverwriteBehavior,
    remote_path: &str,
    local_directory: &str,
) -> Result<SftpTransferResult, String> {
    let local_directory = resolve_local_directory(Some(local_directory))?;
    let remote_path = normalize_path(remote_path);
    let name = remote_path_name(&remote_path)?;
    let local_target = local_directory.join(&name);
    let total_bytes = with_sftp_transfer_io_timeout(
        "calculating remote transfer size",
        &cancellation,
        remote_transfer_size(sftp, &remote_path),
    )
    .await?;
    let mut progress = TransferProgress::new(app, transfer_id, cancellation, total_bytes);
    progress.emit();

    let mut summary = TransferSummary {
        name,
        ..TransferSummary::default()
    };
    download_remote_entry(
        sftp,
        &remote_path,
        &local_target,
        overwrite_behavior,
        &mut summary,
        &mut progress,
    )
    .await?;
    Ok(summary.into_result())
}

async fn create_folder(sftp: &SftpSession, parent_path: &str, name: &str) -> Result<(), String> {
    let name = validate_remote_child_name(name)?;
    let target = join_remote_path(parent_path, &name);
    ensure_remote_missing(sftp, &target).await?;
    sftp.create_dir(target)
        .await
        .map_err(|error| format!("failed to create remote folder: {error}"))
}

async fn rename_path(sftp: &SftpSession, path: &str, new_name: &str) -> Result<(), String> {
    let source = normalize_mutable_remote_path(path)?;
    let new_name = validate_remote_child_name(new_name)?;
    let target = join_remote_path(&remote_parent_path(&source), &new_name);
    ensure_remote_missing(sftp, &target).await?;
    sftp.rename(source, target)
        .await
        .map_err(|error| format!("failed to rename remote path: {error}"))
}

fn delete_remote_entry<'a>(
    sftp: &'a SftpSession,
    path: &'a str,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + 'a>> {
    Box::pin(async move {
        let path = normalize_mutable_remote_path(path)?;
        let metadata = sftp
            .symlink_metadata(path.clone())
            .await
            .map_err(|error| format!("failed to inspect remote path: {error}"))?;
        if metadata.file_type() == FileType::Dir {
            let entries = sftp
                .read_dir(path.clone())
                .await
                .map_err(|error| format!("failed to read remote folder: {error}"))?
                .map(|entry| entry.file_name())
                .filter(|name| name != "." && name != "..")
                .collect::<Vec<_>>();
            for child_name in entries {
                let child_path = join_remote_path(&path, &child_name);
                delete_remote_entry(sftp, &child_path).await?;
            }
            sftp.remove_dir(path)
                .await
                .map_err(|error| format!("failed to delete remote folder: {error}"))?;
            return Ok(());
        }

        sftp.remove_file(path)
            .await
            .map_err(|error| format!("failed to delete remote file: {error}"))
    })
}

fn upload_local_entry<'a>(
    sftp: &'a SftpSession,
    local_path: &'a Path,
    remote_path: &'a str,
    transfer_id: &'a str,
    overwrite_behavior: SftpOverwriteBehavior,
    summary: &'a mut TransferSummary,
    progress: &'a mut TransferProgress,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + 'a>> {
    Box::pin(async move {
        progress.check_cancelled()?;
        let metadata = fs::metadata(local_path)
            .map_err(|error| format!("failed to inspect local source: {error}"))?;
        if metadata.is_dir() {
            with_sftp_transfer_io_timeout(
                "preparing remote upload folder",
                progress.cancellation(),
                prepare_remote_upload_directory(sftp, remote_path, overwrite_behavior),
            )
            .await?;
            summary.folders += 1;
            let mut children = fs::read_dir(local_path)
                .map_err(|error| format!("failed to read local folder: {error}"))?
                .filter_map(|entry| entry.ok())
                .collect::<Vec<_>>();
            children.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
            for child in children {
                let child_name = child.file_name().to_string_lossy().to_string();
                let child_path = child.path();
                let child_remote_path = join_remote_path(remote_path, &child_name);
                upload_local_entry(
                    sftp,
                    &child_path,
                    &child_remote_path,
                    transfer_id,
                    overwrite_behavior,
                    summary,
                    progress,
                )
                .await?;
            }
            return Ok(());
        }

        if !metadata.is_file() {
            return Err("only local files and folders can be uploaded".to_string());
        }

        let target = with_sftp_transfer_io_timeout(
            "checking remote upload target",
            progress.cancellation(),
            remote_upload_target(sftp, remote_path, overwrite_behavior),
        )
        .await?;
        sftp_debug(
            "transfer.upload.file_open.begin",
            json!({
                "transferId": transfer_id,
                "localPath": display_local_path(local_path),
                "remotePath": remote_path,
                "bytes": metadata.len(),
                "targetExisted": target.existed,
                "timeoutSeconds": SFTP_TRANSFER_IO_TIMEOUT.as_secs(),
            }),
        );
        let mut file = with_sftp_transfer_io_timeout(
            "opening remote upload file",
            progress.cancellation(),
            async {
                sftp.open_with_flags(remote_path.to_string(), target.flags)
                    .await
                    .map_err(|error| format!("failed to create remote file: {error}"))
            },
        )
        .await?;
        sftp_debug(
            "transfer.upload.file_open.ok",
            json!({
                "transferId": transfer_id,
                "remotePath": remote_path,
                "targetExisted": target.existed,
            }),
        );
        let upload_result = upload_file_chunks(
            &mut file,
            local_path,
            remote_path,
            transfer_id,
            metadata.len(),
            summary,
            progress,
        )
        .await;
        if let Err(error) = upload_result {
            if is_session_invalidating_transfer_error(&error) {
                sftp_debug(
                    "transfer.upload.partial_cleanup_skipped",
                    json!({
                        "transferId": transfer_id,
                        "remotePath": remote_path,
                        "reason": transfer_error_message(&error),
                        "targetExisted": target.existed,
                    }),
                );
                return Err(error);
            }
            let _ = with_sftp_io_timeout("closing failed remote upload file", async {
                file.shutdown()
                    .await
                    .map_err(|error| format!("failed to close failed remote upload: {error}"))
            })
            .await;
            if !target.existed {
                let cleanup = with_sftp_io_timeout("removing partial remote upload", async {
                    sftp.remove_file(remote_path.to_string())
                        .await
                        .map_err(|error| error.to_string())
                })
                .await;
                sftp_debug(
                    "transfer.upload.partial_cleanup",
                    json!({
                        "transferId": transfer_id,
                        "remotePath": remote_path,
                        "reason": error,
                        "removed": cleanup.is_ok(),
                        "cleanupError": cleanup.err().map(|cleanup_error| cleanup_error.to_string()),
                    }),
                );
            }
            return Err(error);
        }
        summary.files += 1;
        Ok(())
    })
}

async fn upload_file_chunks(
    remote_file: &mut russh_sftp::client::fs::File,
    local_path: &Path,
    remote_path: &str,
    transfer_id: &str,
    file_size: u64,
    summary: &mut TransferSummary,
    progress: &mut TransferProgress,
) -> Result<(), String> {
    let mut local_file = fs::File::open(local_path)
        .map_err(|error| format!("failed to read local file: {error}"))?;
    let mut buffer = vec![0; TRANSFER_CHUNK_SIZE];
    let mut wrote_first_chunk = false;
    loop {
        progress.check_cancelled()?;
        let read = local_file
            .read(&mut buffer)
            .map_err(|error| format!("failed to read local file: {error}"))?;
        if read == 0 {
            break;
        }
        with_sftp_transfer_io_timeout(
            "uploading remote file chunk",
            progress.cancellation(),
            async {
                remote_file
                    .write_all(&buffer[..read])
                    .await
                    .map_err(|error| format!("failed to upload remote file: {error}"))
            },
        )
        .await?;
        if !wrote_first_chunk {
            wrote_first_chunk = true;
            sftp_debug(
                "transfer.upload.first_chunk",
                json!({
                    "transferId": transfer_id,
                    "remotePath": remote_path,
                    "chunkBytes": read,
                    "fileBytes": file_size,
                }),
            );
        }
        summary.bytes += read as u64;
        progress.add_bytes(read as u64);
    }
    with_sftp_transfer_io_timeout("finishing remote upload", progress.cancellation(), async {
        remote_file
            .shutdown()
            .await
            .map_err(|error| format!("failed to finish remote upload: {error}"))
    })
    .await?;
    sftp_debug(
        "transfer.upload.file_ok",
        json!({
            "transferId": transfer_id,
            "remotePath": remote_path,
            "bytes": file_size,
        }),
    );
    if file_size == 0 {
        progress.emit();
    }
    Ok(())
}

fn download_remote_entry<'a>(
    sftp: &'a SftpSession,
    remote_path: &'a str,
    local_path: &'a Path,
    overwrite_behavior: SftpOverwriteBehavior,
    summary: &'a mut TransferSummary,
    progress: &'a mut TransferProgress,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + 'a>> {
    Box::pin(async move {
        progress.check_cancelled()?;
        let metadata = with_sftp_transfer_io_timeout(
            "inspecting remote download source",
            progress.cancellation(),
            async {
                sftp.metadata(remote_path.to_string())
                    .await
                    .map_err(|error| format!("failed to inspect remote source: {error}"))
            },
        )
        .await?;
        match metadata.file_type() {
            FileType::Dir => {
                prepare_local_download_directory(local_path, overwrite_behavior)?;
                summary.folders += 1;
                let mut entries = with_sftp_transfer_io_timeout(
                    "reading remote download folder",
                    progress.cancellation(),
                    async {
                        sftp.read_dir(remote_path.to_string())
                            .await
                            .map(|entries| {
                                entries
                                    .map(|entry| entry.file_name())
                                    .filter(|name| name != "." && name != "..")
                                    .collect::<Vec<_>>()
                            })
                            .map_err(|error| format!("failed to read remote folder: {error}"))
                    },
                )
                .await?;
                entries.sort_by_key(|name| name.to_lowercase());
                for child_name in entries {
                    let child_remote_path = join_remote_path(remote_path, &child_name);
                    let child_local_path = local_path.join(&child_name);
                    download_remote_entry(
                        sftp,
                        &child_remote_path,
                        &child_local_path,
                        overwrite_behavior,
                        summary,
                        progress,
                    )
                    .await?;
                }
                Ok(())
            }
            FileType::File => {
                let target_existed = prepare_local_download_file(local_path, overwrite_behavior)?;
                let mut remote_file = with_sftp_transfer_io_timeout(
                    "opening remote download file",
                    progress.cancellation(),
                    async {
                        sftp.open(remote_path.to_string())
                            .await
                            .map_err(|error| format!("failed to download remote file: {error}"))
                    },
                )
                .await?;
                let download_result = download_file_chunks(
                    &mut remote_file,
                    local_path,
                    overwrite_behavior,
                    summary,
                    progress,
                )
                .await;
                if let Err(error) = download_result {
                    if !is_session_invalidating_transfer_error(&error) {
                        let _ = with_sftp_io_timeout("closing failed remote download", async {
                            remote_file.shutdown().await.map_err(|error| {
                                format!("failed to close failed remote download: {error}")
                            })
                        })
                        .await;
                    }
                    if !target_existed {
                        let _ = fs::remove_file(local_path);
                    }
                    return Err(error);
                }
                summary.files += 1;
                Ok(())
            }
            _ => Err("only remote files and folders can be downloaded".to_string()),
        }
    })
}

async fn download_file_chunks(
    remote_file: &mut russh_sftp::client::fs::File,
    local_path: &Path,
    overwrite_behavior: SftpOverwriteBehavior,
    summary: &mut TransferSummary,
    progress: &mut TransferProgress,
) -> Result<(), String> {
    let mut open_options = fs::OpenOptions::new();
    open_options.write(true);
    if overwrite_behavior == SftpOverwriteBehavior::Overwrite {
        open_options.create(true).truncate(true);
    } else {
        open_options.create_new(true);
    }
    let mut local_file = open_options
        .open(local_path)
        .map_err(|error| format!("failed to create local file: {error}"))?;
    let mut buffer = vec![0; TRANSFER_CHUNK_SIZE];
    loop {
        progress.check_cancelled()?;
        let read = with_sftp_transfer_io_timeout(
            "downloading remote file chunk",
            progress.cancellation(),
            async {
                remote_file
                    .read(&mut buffer)
                    .await
                    .map_err(|error| format!("failed to download remote file: {error}"))
            },
        )
        .await?;
        if read == 0 {
            break;
        }
        local_file
            .write_all(&buffer[..read])
            .map_err(|error| format!("failed to write local file: {error}"))?;
        summary.bytes += read as u64;
        progress.add_bytes(read as u64);
    }
    local_file
        .flush()
        .map_err(|error| format!("failed to finish local download: {error}"))?;
    with_sftp_transfer_io_timeout(
        "finishing remote download",
        progress.cancellation(),
        async {
            remote_file
                .shutdown()
                .await
                .map_err(|error| format!("failed to finish remote download: {error}"))
        },
    )
    .await?;
    Ok(())
}

pub fn list_local_directory(
    request: ListLocalDirectoryRequest,
) -> Result<LocalDirectoryListing, String> {
    let requested_path = request.path.as_deref();
    if requested_path == Some(WINDOWS_DRIVES_PATH) {
        return list_windows_drives();
    }

    let directory = resolve_local_directory(requested_path)?;
    if requested_path.is_some_and(requests_parent_directory) && is_windows_drive_root(&directory) {
        return list_windows_drives();
    }
    let mut entries = fs::read_dir(&directory)
        .map_err(|error| format!("failed to list local directory: {error}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            let file_type = entry.file_type().ok()?;
            Some(LocalDirectoryEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                kind: local_file_kind(&file_type).to_string(),
                size: if metadata.is_file() {
                    Some(metadata.len())
                } else {
                    None
                },
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|time| unix_timestamp(time).ok()),
            })
        })
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        file_kind_rank(&left.kind)
            .cmp(&file_kind_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(LocalDirectoryListing {
        path: display_local_path(&directory),
        entries,
    })
}

pub fn list_local_places() -> Result<LocalPlacesListing, String> {
    let home = default_local_directory();
    let home_label = home
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| display_local_path(&home));
    let home_place = LocalPlace {
        id: "home".to_string(),
        label: home_label,
        path: display_local_path(&home),
        icon: "home".to_string(),
    };

    let mut common = Vec::new();
    for (folder, icon) in [
        ("Desktop", "desktop"),
        ("Documents", "documents"),
        ("Downloads", "downloads"),
        ("Pictures", "pictures"),
    ] {
        let candidate = home.join(folder);
        if candidate.is_dir() {
            common.push(LocalPlace {
                id: folder.to_lowercase(),
                label: folder.to_string(),
                path: display_local_path(&candidate),
                icon: icon.to_string(),
            });
        }
    }

    Ok(LocalPlacesListing {
        home: Some(home_place),
        common,
        drives: list_local_drives(),
    })
}

fn list_local_drives() -> Vec<LocalDrivePlace> {
    #[cfg(target_os = "windows")]
    {
        windows_local_drives()
    }
    #[cfg(target_os = "macos")]
    {
        sysinfo_local_drives()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Vec::new()
    }
}

#[cfg(target_os = "windows")]
fn windows_local_drives() -> Vec<LocalDrivePlace> {
    use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW};

    const DRIVE_REMOVABLE: u32 = 2;
    let mut drives = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if !Path::new(&root).is_dir() {
            continue;
        }
        let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
        let mut free_available: u64 = 0;
        let mut total: u64 = 0;
        let mut total_free: u64 = 0;
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_available,
                &mut total,
                &mut total_free,
            )
        };
        let (total_bytes, free_bytes) = if ok != 0 {
            (total, free_available)
        } else {
            (0, 0)
        };
        let drive_type = unsafe { GetDriveTypeW(wide.as_ptr()) };
        drives.push(LocalDrivePlace {
            id: format!("drive-{root}"),
            label: root.clone(),
            icon: if drive_type == DRIVE_REMOVABLE {
                "externaldrive".to_string()
            } else {
                "internaldrive".to_string()
            },
            path: root,
            total_bytes,
            free_bytes,
        });
    }
    drives
}

#[cfg(target_os = "macos")]
fn sysinfo_local_drives() -> Vec<LocalDrivePlace> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut seen = std::collections::HashSet::new();
    let mut seen_visible_drives = std::collections::HashSet::new();
    let mut drives = Vec::new();
    for disk in disks.iter() {
        let path = display_local_path(disk.mount_point());
        if path.is_empty() || !seen.insert(path.clone()) {
            continue;
        }
        let total_bytes = disk.total_space();
        // Skip pseudo / zero-sized mounts that aren't useful as navigation targets.
        if total_bytes == 0 {
            continue;
        }
        let volume_name = disk.name().to_string_lossy().trim().to_string();
        let label = if volume_name.is_empty() || volume_name == path {
            path.clone()
        } else {
            volume_name
        };
        let visible_key = (label.to_lowercase(), total_bytes, disk.available_space());
        if !seen_visible_drives.insert(visible_key) {
            continue;
        }
        drives.push(LocalDrivePlace {
            id: format!("drive-{path}"),
            label,
            icon: if disk.is_removable() {
                "externaldrive".to_string()
            } else {
                "internaldrive".to_string()
            },
            path,
            total_bytes,
            free_bytes: disk.available_space(),
        });
    }
    drives.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));
    drives
}

// Local File Explorer file operations. These back the `localFiles` Connection
// type's file-browser surface and operate purely on the local filesystem (no
// network session). They reuse the same listing/path helpers as the local pane
// of the SFTP browser.

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLocalFolderRequest {
    parent_path: String,
    name: String,
}

pub fn create_local_folder(request: CreateLocalFolderRequest) -> Result<(), String> {
    let parent = resolve_local_directory(Some(&request.parent_path))?;
    let name = request.name.trim();
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err("invalid folder name".to_string());
    }
    fs::create_dir(parent.join(name)).map_err(|error| format!("failed to create folder: {error}"))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameLocalPathRequest {
    path: String,
    new_name: String,
}

pub fn rename_local_path(request: RenameLocalPathRequest) -> Result<(), String> {
    let source = PathBuf::from(&request.path);
    let name = request.new_name.trim();
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err("invalid name".to_string());
    }
    let parent = source
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;
    fs::rename(&source, parent.join(name)).map_err(|error| format!("failed to rename: {error}"))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLocalPathRequest {
    path: String,
}

pub fn delete_local_path(request: DeleteLocalPathRequest) -> Result<(), String> {
    let path = PathBuf::from(&request.path);
    let metadata =
        fs::symlink_metadata(&path).map_err(|error| format!("cannot read path: {error}"))?;
    if metadata.is_dir() {
        fs::remove_dir_all(&path)
    } else {
        fs::remove_file(&path)
    }
    .map_err(|error| format!("failed to delete: {error}"))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPathPropertiesRequest {
    path: String,
}

pub fn local_path_properties(
    request: LocalPathPropertiesRequest,
) -> Result<SftpPathProperties, String> {
    let path = PathBuf::from(&request.path);
    let metadata =
        fs::symlink_metadata(&path).map_err(|error| format!("cannot read path: {error}"))?;
    let kind = if metadata.file_type().is_symlink() {
        "symlink"
    } else if metadata.is_dir() {
        "folder"
    } else if metadata.is_file() {
        "file"
    } else {
        "other"
    };
    Ok(SftpPathProperties {
        path: display_local_path(&path),
        name: local_path_name(&path)?,
        kind: kind.to_string(),
        size: if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        },
        modified: metadata
            .modified()
            .ok()
            .and_then(|time| unix_timestamp(time).ok()),
        accessed: metadata
            .accessed()
            .ok()
            .and_then(|time| unix_timestamp(time).ok()),
        permissions: None,
        mode: None,
        uid: None,
        user: None,
        gid: None,
        group: None,
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyLocalPathRequest {
    source_path: String,
    destination_directory: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveLocalPathRequest {
    source_path: String,
    destination_directory: String,
}

pub fn copy_local_path(request: CopyLocalPathRequest) -> Result<SftpTransferResult, String> {
    let source = PathBuf::from(&request.source_path);
    let source_metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("cannot read {}: {error}", source.display()))?;
    let source_canonical = fs::canonicalize(&source)
        .map_err(|error| format!("cannot resolve {}: {error}", source.display()))?;
    let destination_directory = resolve_local_directory(Some(&request.destination_directory))?;
    let destination_canonical = fs::canonicalize(&destination_directory).map_err(|error| {
        format!(
            "cannot resolve destination {}: {error}",
            destination_directory.display()
        )
    })?;
    let name = local_path_name(&source)?;
    let target = destination_directory.join(&name);
    if target.exists()
        && fs::canonicalize(&target)
            .map(|target_canonical| target_canonical == source_canonical)
            .unwrap_or(false)
    {
        return Err("source and destination are the same".to_string());
    }
    if source_metadata.is_dir() && destination_canonical.starts_with(&source_canonical) {
        return Err("cannot copy a folder into itself or one of its subfolders".to_string());
    }
    let mut files = 0u64;
    let mut folders = 0u64;
    let mut bytes = 0u64;
    copy_local_recursive(&source, &target, &mut files, &mut folders, &mut bytes)?;
    Ok(SftpTransferResult {
        name,
        files,
        folders,
        bytes,
    })
}

pub fn move_local_path(request: MoveLocalPathRequest) -> Result<SftpTransferResult, String> {
    let source = PathBuf::from(&request.source_path);
    let source_metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("cannot read {}: {error}", source.display()))?;
    let source_canonical = fs::canonicalize(&source)
        .map_err(|error| format!("cannot resolve {}: {error}", source.display()))?;
    let destination_directory = resolve_local_directory(Some(&request.destination_directory))?;
    let destination_canonical = fs::canonicalize(&destination_directory).map_err(|error| {
        format!(
            "cannot resolve destination {}: {error}",
            destination_directory.display()
        )
    })?;
    let name = local_path_name(&source)?;
    let target = destination_directory.join(&name);
    if target.exists() {
        if fs::canonicalize(&target)
            .map(|target_canonical| target_canonical == source_canonical)
            .unwrap_or(false)
        {
            return Err("source and destination are the same".to_string());
        }
        return Err(format!("destination already exists: {}", target.display()));
    }
    if source_metadata.is_dir() && destination_canonical.starts_with(&source_canonical) {
        return Err("cannot move a folder into itself or one of its subfolders".to_string());
    }

    let mut files = 0u64;
    let mut folders = 0u64;
    let mut bytes = 0u64;
    count_local_recursive(&source, &mut files, &mut folders, &mut bytes)?;
    match fs::rename(&source, &target) {
        Ok(()) => Ok(SftpTransferResult {
            name,
            files,
            folders,
            bytes,
        }),
        Err(_) => {
            let mut copied_files = 0u64;
            let mut copied_folders = 0u64;
            let mut copied_bytes = 0u64;
            copy_local_recursive(
                &source,
                &target,
                &mut copied_files,
                &mut copied_folders,
                &mut copied_bytes,
            )?;
            delete_local_path(DeleteLocalPathRequest {
                path: request.source_path,
            })?;
            Ok(SftpTransferResult {
                name,
                files: copied_files,
                folders: copied_folders,
                bytes: copied_bytes,
            })
        }
    }
}

fn copy_local_recursive(
    source: &Path,
    target: &Path,
    files: &mut u64,
    folders: &mut u64,
    bytes: &mut u64,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("cannot read {}: {error}", source.display()))?;
    if metadata.is_dir() {
        fs::create_dir_all(target)
            .map_err(|error| format!("failed to create {}: {error}", target.display()))?;
        *folders += 1;
        for entry in fs::read_dir(source)
            .map_err(|error| format!("failed to read {}: {error}", source.display()))?
        {
            let entry = entry.map_err(|error| format!("failed to read entry: {error}"))?;
            copy_local_recursive(
                &entry.path(),
                &target.join(entry.file_name()),
                files,
                folders,
                bytes,
            )?;
        }
    } else {
        let copied = fs::copy(source, target)
            .map_err(|error| format!("failed to copy {}: {error}", source.display()))?;
        *files += 1;
        *bytes += copied;
    }
    Ok(())
}

fn count_local_recursive(
    source: &Path,
    files: &mut u64,
    folders: &mut u64,
    bytes: &mut u64,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("cannot read {}: {error}", source.display()))?;
    if metadata.is_dir() {
        *folders += 1;
        for entry in fs::read_dir(source)
            .map_err(|error| format!("failed to read {}: {error}", source.display()))?
        {
            let entry = entry.map_err(|error| format!("failed to read entry: {error}"))?;
            count_local_recursive(&entry.path(), files, folders, bytes)?;
        }
    } else {
        *files += 1;
        *bytes += metadata.len();
    }
    Ok(())
}

// ── Folder Compare (Beyond Compare-style two-pane directory diff) ──────────
// Walks two local directory trees, aligns entries by their relative path, and
// classifies each as same / different / left-only / right-only. Folders
// aggregate their descendants: a folder is "different" when any child differs
// or exists on only one side. The result is a flat, depth-first pre-order list
// the frontend renders as a collapsible tree.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareFoldersRequest {
    left: String,
    right: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderCompareSide {
    size: Option<u64>,
    modified: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCompareRow {
    /// Forward-slash relative path from the compared roots, e.g. "src/main.rs".
    relative_path: String,
    name: String,
    depth: usize,
    is_dir: bool,
    /// "same" | "different" | "left-only" | "right-only".
    status: String,
    left: Option<FolderCompareSide>,
    right: Option<FolderCompareSide>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderCompareSummary {
    same: u64,
    different: u64,
    left_only: u64,
    right_only: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCompareResult {
    left_root: String,
    right_root: String,
    rows: Vec<FolderCompareRow>,
    summary: FolderCompareSummary,
    /// True when the walk hit the entry cap and stopped early, so the tree shown
    /// is partial. Keeps a pathological tree (e.g. comparing a huge root) from
    /// freezing the UI with an unbounded result.
    truncated: bool,
}

const COMPARE_STATUS_SAME: &str = "same";
const COMPARE_STATUS_DIFFERENT: &str = "different";
const COMPARE_STATUS_LEFT_ONLY: &str = "left-only";
const COMPARE_STATUS_RIGHT_ONLY: &str = "right-only";
// Stop after this many aligned entries; protects against pathologically large
// trees producing an unbounded payload the renderer can't handle.
const FOLDER_COMPARE_MAX_ENTRIES: usize = 200_000;
// Above this size, decide equal-size files by modification time instead of
// reading their full contents, so a tree of large files can't stall the scan.
const FOLDER_COMPARE_MAX_CONTENT_BYTES: u64 = 64 * 1024 * 1024;

pub fn compare_folders(request: CompareFoldersRequest) -> Result<FolderCompareResult, String> {
    let left_root = resolve_local_directory(Some(&request.left))?;
    let right_root = resolve_local_directory(Some(&request.right))?;
    if !left_root.is_dir() {
        return Err(format!("not a folder: {}", left_root.display()));
    }
    if !right_root.is_dir() {
        return Err(format!("not a folder: {}", right_root.display()));
    }

    let mut rows = Vec::new();
    let mut summary = FolderCompareSummary::default();
    let mut count = 0usize;
    compare_dir_level(
        Some(left_root.as_path()),
        Some(right_root.as_path()),
        "",
        0,
        &mut rows,
        &mut summary,
        &mut count,
    )?;

    Ok(FolderCompareResult {
        left_root: display_local_path(&left_root),
        right_root: display_local_path(&right_root),
        rows,
        summary,
        truncated: count >= FOLDER_COMPARE_MAX_ENTRIES,
    })
}

// A single child of the level currently being compared.
struct LevelEntry {
    is_dir: bool,
    path: PathBuf,
    size: Option<u64>,
    modified: Option<u64>,
}

fn read_level_entries(dir: Option<&Path>) -> HashMap<String, LevelEntry> {
    let mut map = HashMap::new();
    let Some(dir) = dir else {
        return map;
    };
    let Ok(read) = fs::read_dir(dir) else {
        return map;
    };
    for entry in read.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let metadata = entry.metadata().ok();
        let is_dir = file_type.is_dir();
        let name = entry.file_name().to_string_lossy().to_string();
        map.insert(
            name,
            LevelEntry {
                is_dir,
                path: entry.path(),
                size: metadata
                    .as_ref()
                    .filter(|_| !is_dir)
                    .map(|metadata| metadata.len()),
                modified: metadata
                    .as_ref()
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|time| unix_timestamp(time).ok()),
            },
        );
    }
    map
}

fn side_of(entry: Option<&LevelEntry>) -> Option<FolderCompareSide> {
    entry.map(|entry| FolderCompareSide {
        size: entry.size,
        modified: entry.modified,
    })
}

// Compare one directory level. Either side may be absent (None) when the
// containing folder exists on only one side; in that case every descendant is
// emitted as left-only / right-only. Returns true when this level (recursively)
// contains any difference, so the parent can label its folder row.
fn compare_dir_level(
    left_dir: Option<&Path>,
    right_dir: Option<&Path>,
    parent_rel: &str,
    depth: usize,
    rows: &mut Vec<FolderCompareRow>,
    summary: &mut FolderCompareSummary,
    count: &mut usize,
) -> Result<bool, String> {
    let left_entries = read_level_entries(left_dir);
    let right_entries = read_level_entries(right_dir);

    // Union of names, sorted folders-first then case-insensitive by name to
    // match the rest of the file browser's ordering.
    let mut names: Vec<String> = left_entries
        .keys()
        .chain(right_entries.keys())
        .cloned()
        .collect();
    names.sort();
    names.dedup();
    names.sort_by(|left, right| {
        let left_dir = left_entries
            .get(left)
            .or_else(|| right_entries.get(left))
            .map(|entry| entry.is_dir)
            .unwrap_or(false);
        let right_dir = left_entries
            .get(right)
            .or_else(|| right_entries.get(right))
            .map(|entry| entry.is_dir)
            .unwrap_or(false);
        (!left_dir)
            .cmp(&(!right_dir))
            .then_with(|| left.to_lowercase().cmp(&right.to_lowercase()))
    });

    let mut level_differs = false;
    for name in names {
        // Honor the global entry cap so an enormous tree can't run unbounded.
        if *count >= FOLDER_COMPARE_MAX_ENTRIES {
            break;
        }
        *count += 1;
        let left = left_entries.get(&name);
        let right = right_entries.get(&name);
        let relative_path = if parent_rel.is_empty() {
            name.clone()
        } else {
            format!("{parent_rel}/{name}")
        };
        let left_is_dir = left.map(|entry| entry.is_dir).unwrap_or(false);
        let right_is_dir = right.map(|entry| entry.is_dir).unwrap_or(false);
        // Treat as a folder row whenever either side is a directory.
        let is_dir = left_is_dir || right_is_dir;

        if is_dir {
            // Reserve this folder's row; its status is filled in after the
            // subtree is walked so it can reflect descendant differences.
            let row_index = rows.len();
            rows.push(FolderCompareRow {
                relative_path: relative_path.clone(),
                name: name.clone(),
                depth,
                is_dir: true,
                status: COMPARE_STATUS_SAME.to_string(),
                left: side_of(left),
                right: side_of(right),
            });

            let subtree_differs = compare_dir_level(
                left.filter(|entry| entry.is_dir)
                    .map(|entry| entry.path.as_path()),
                right
                    .filter(|entry| entry.is_dir)
                    .map(|entry| entry.path.as_path()),
                &relative_path,
                depth + 1,
                rows,
                summary,
                count,
            )?;

            let status = if left.is_none() {
                COMPARE_STATUS_RIGHT_ONLY
            } else if right.is_none() {
                COMPARE_STATUS_LEFT_ONLY
            } else if subtree_differs || left_is_dir != right_is_dir {
                COMPARE_STATUS_DIFFERENT
            } else {
                COMPARE_STATUS_SAME
            };
            bump_summary(summary, status);
            if status != COMPARE_STATUS_SAME {
                level_differs = true;
            }
            rows[row_index].status = status.to_string();
            continue;
        }

        // File (or symlink/other) row.
        let status = match (left, right) {
            (Some(left_entry), Some(right_entry)) => {
                if file_entries_same(left_entry, right_entry) {
                    COMPARE_STATUS_SAME
                } else {
                    COMPARE_STATUS_DIFFERENT
                }
            }
            (Some(_), None) => COMPARE_STATUS_LEFT_ONLY,
            (None, Some(_)) => COMPARE_STATUS_RIGHT_ONLY,
            (None, None) => COMPARE_STATUS_SAME,
        };
        bump_summary(summary, status);
        if status != COMPARE_STATUS_SAME {
            level_differs = true;
        }
        rows.push(FolderCompareRow {
            relative_path,
            name,
            depth,
            is_dir: false,
            status: status.to_string(),
            left: side_of(left),
            right: side_of(right),
        });
    }

    Ok(level_differs)
}

// Decide whether two file entries are identical. Differing sizes are an instant
// "no"; equal-size files are byte-compared, except very large ones which fall
// back to a modification-time check so the scan stays bounded.
fn file_entries_same(left: &LevelEntry, right: &LevelEntry) -> bool {
    if left.size != right.size {
        return false;
    }
    if left.size.unwrap_or(0) > FOLDER_COMPARE_MAX_CONTENT_BYTES {
        return left.modified == right.modified;
    }
    files_equal(&left.path, &right.path).unwrap_or(false)
}

fn bump_summary(summary: &mut FolderCompareSummary, status: &str) {
    match status {
        COMPARE_STATUS_SAME => summary.same += 1,
        COMPARE_STATUS_DIFFERENT => summary.different += 1,
        COMPARE_STATUS_LEFT_ONLY => summary.left_only += 1,
        COMPARE_STATUS_RIGHT_ONLY => summary.right_only += 1,
        _ => {}
    }
}

// Byte-exact file comparison: cheap size check first, then a streamed chunk
// compare that bails at the first mismatch.
fn files_equal(left: &Path, right: &Path) -> Result<bool, String> {
    let left_meta =
        fs::metadata(left).map_err(|error| format!("cannot read {}: {error}", left.display()))?;
    let right_meta =
        fs::metadata(right).map_err(|error| format!("cannot read {}: {error}", right.display()))?;
    if left_meta.len() != right_meta.len() {
        return Ok(false);
    }
    let mut left_file =
        fs::File::open(left).map_err(|error| format!("cannot open {}: {error}", left.display()))?;
    let mut right_file = fs::File::open(right)
        .map_err(|error| format!("cannot open {}: {error}", right.display()))?;
    let mut left_buf = vec![0u8; TRANSFER_CHUNK_SIZE];
    let mut right_buf = vec![0u8; TRANSFER_CHUNK_SIZE];
    loop {
        let left_read = read_full(&mut left_file, &mut left_buf)?;
        let right_read = read_full(&mut right_file, &mut right_buf)?;
        if left_read != right_read {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
        if left_buf[..left_read] != right_buf[..right_read] {
            return Ok(false);
        }
    }
}

// Read until the buffer is full or EOF, so chunk boundaries line up between the
// two files regardless of how the OS splits reads.
fn read_full(file: &mut fs::File, buf: &mut [u8]) -> Result<usize, String> {
    let mut filled = 0;
    while filled < buf.len() {
        let read = file
            .read(&mut buf[filled..])
            .map_err(|error| format!("read failed: {error}"))?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    Ok(filled)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyLocalPathToRequest {
    source_path: String,
    /// Full destination path (not a directory): the source is copied to exactly
    /// this path, creating parent directories as needed and overwriting.
    destination_path: String,
}

// Copy a file or folder to an explicit destination path, used by Folder Compare
// to mirror an entry to the matching location on the other side. Parent
// directories are created; existing files are overwritten and existing folders
// merged.
pub fn copy_local_path_to(request: CopyLocalPathToRequest) -> Result<SftpTransferResult, String> {
    let source = PathBuf::from(&request.source_path);
    let target = PathBuf::from(&request.destination_path);
    let source_metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("cannot read {}: {error}", source.display()))?;
    let source_canonical = fs::canonicalize(&source)
        .map_err(|error| format!("cannot resolve {}: {error}", source.display()))?;
    if let Ok(target_canonical) = fs::canonicalize(&target) {
        if target_canonical == source_canonical {
            return Err("source and destination are the same".to_string());
        }
        if source_metadata.is_dir() && target_canonical.starts_with(&source_canonical) {
            return Err("cannot copy a folder into itself or one of its subfolders".to_string());
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    let name = local_path_name(&source)?;
    let mut files = 0u64;
    let mut folders = 0u64;
    let mut bytes = 0u64;
    copy_local_recursive(&source, &target, &mut files, &mut folders, &mut bytes)?;
    Ok(SftpTransferResult {
        name,
        files,
        folders,
        bytes,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileClipboard {
    operation: String,
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLocalFileClipboardRequest {
    operation: String,
    paths: Vec<String>,
}

pub fn set_local_file_clipboard(request: SetLocalFileClipboardRequest) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_file_clipboard::set(request)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = request;
        Err("native file clipboard is only available on Windows".to_string())
    }
}

pub fn read_local_file_clipboard() -> Result<Option<LocalFileClipboard>, String> {
    #[cfg(target_os = "windows")]
    {
        windows_file_clipboard::read()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[cfg(target_os = "windows")]
mod windows_file_clipboard {
    use super::{LocalFileClipboard, SetLocalFileClipboardRequest};
    use std::{ffi::c_void, mem, ptr};
    use windows_sys::Win32::{
        Foundation::POINT,
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
                OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
            },
            Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
        },
        UI::Shell::{DROPFILES, DragQueryFileW},
    };

    const CF_HDROP: u32 = 15;
    const DROPEFFECT_COPY: u32 = 1;
    const DROPEFFECT_MOVE: u32 = 2;

    struct ClipboardGuard;

    impl ClipboardGuard {
        fn open() -> Result<Self, String> {
            let opened = unsafe { OpenClipboard(std::ptr::null_mut()) };
            if opened == 0 {
                return Err("failed to open clipboard".to_string());
            }
            Ok(Self)
        }
    }

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }

    pub fn set(request: SetLocalFileClipboardRequest) -> Result<(), String> {
        let operation = normalize_operation(&request.operation);
        let paths = request
            .paths
            .into_iter()
            .filter(|path| !path.trim().is_empty())
            .collect::<Vec<_>>();
        if paths.is_empty() {
            return Err("no file paths to copy".to_string());
        }

        let _guard = ClipboardGuard::open()?;
        let emptied = unsafe { EmptyClipboard() };
        if emptied == 0 {
            return Err("failed to empty clipboard".to_string());
        }

        let drop_data = build_dropfiles(&paths)?;
        let drop_result = unsafe { SetClipboardData(CF_HDROP, drop_data) };
        if drop_result.is_null() {
            return Err("failed to set file clipboard data".to_string());
        }

        let effect_data = build_dropeffect(operation)?;
        let format = preferred_drop_effect_format();
        let effect_result = unsafe { SetClipboardData(format, effect_data) };
        if effect_result.is_null() {
            return Err("failed to set clipboard drop effect".to_string());
        }

        Ok(())
    }

    pub fn read() -> Result<Option<LocalFileClipboard>, String> {
        let _guard = ClipboardGuard::open()?;
        let has_drop = unsafe { IsClipboardFormatAvailable(CF_HDROP) };
        if has_drop == 0 {
            return Ok(None);
        }

        let handle = unsafe { GetClipboardData(CF_HDROP) };
        if handle.is_null() {
            return Ok(None);
        }

        let count = unsafe { DragQueryFileW(handle, u32::MAX, ptr::null_mut(), 0) };
        let mut paths = Vec::new();
        for index in 0..count {
            let len = unsafe { DragQueryFileW(handle, index, ptr::null_mut(), 0) };
            if len == 0 {
                continue;
            }
            let mut buffer = vec![0u16; len as usize + 1];
            let copied =
                unsafe { DragQueryFileW(handle, index, buffer.as_mut_ptr(), buffer.len() as u32) };
            if copied > 0 {
                paths.push(String::from_utf16_lossy(&buffer[..copied as usize]));
            }
        }

        if paths.is_empty() {
            return Ok(None);
        }

        Ok(Some(LocalFileClipboard {
            operation: read_drop_effect_operation(),
            paths,
        }))
    }

    fn normalize_operation(operation: &str) -> &str {
        if operation.eq_ignore_ascii_case("cut") || operation.eq_ignore_ascii_case("move") {
            "cut"
        } else {
            "copy"
        }
    }

    fn preferred_drop_effect_format() -> u32 {
        let mut wide = "Preferred DropEffect".encode_utf16().collect::<Vec<_>>();
        wide.push(0);
        unsafe { RegisterClipboardFormatW(wide.as_ptr()) }
    }

    fn build_dropfiles(paths: &[String]) -> Result<*mut c_void, String> {
        let mut path_list = Vec::<u16>::new();
        for path in paths {
            path_list.extend(path.encode_utf16());
            path_list.push(0);
        }
        path_list.push(0);

        let header_size = mem::size_of::<DROPFILES>();
        let bytes = header_size + path_list.len() * mem::size_of::<u16>();
        let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes) };
        if handle.is_null() {
            return Err("failed to allocate clipboard data".to_string());
        }

        let locked = unsafe { GlobalLock(handle) };
        if locked.is_null() {
            return Err("failed to lock clipboard data".to_string());
        }

        unsafe {
            let dropfiles = locked as *mut DROPFILES;
            ptr::write(
                dropfiles,
                DROPFILES {
                    pFiles: header_size as u32,
                    pt: POINT { x: 0, y: 0 },
                    fNC: 0,
                    fWide: 1,
                },
            );
            ptr::copy_nonoverlapping(
                path_list.as_ptr(),
                (locked as *mut u8).add(header_size) as *mut u16,
                path_list.len(),
            );
            GlobalUnlock(handle);
        }

        Ok(handle)
    }

    fn build_dropeffect(operation: &str) -> Result<*mut c_void, String> {
        let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, mem::size_of::<u32>()) };
        if handle.is_null() {
            return Err("failed to allocate clipboard effect".to_string());
        }
        let locked = unsafe { GlobalLock(handle) };
        if locked.is_null() {
            return Err("failed to lock clipboard effect".to_string());
        }
        unsafe {
            ptr::write(
                locked as *mut u32,
                if operation == "cut" {
                    DROPEFFECT_MOVE
                } else {
                    DROPEFFECT_COPY
                },
            );
            GlobalUnlock(handle);
        }
        Ok(handle)
    }

    fn read_drop_effect_operation() -> String {
        let format = preferred_drop_effect_format();
        let handle = unsafe { GetClipboardData(format) };
        if handle.is_null() {
            return "copy".to_string();
        }
        let locked = unsafe { GlobalLock(handle) };
        if locked.is_null() {
            return "copy".to_string();
        }
        let effect = unsafe { *(locked as *const u32) };
        unsafe {
            GlobalUnlock(handle);
        }
        if effect & DROPEFFECT_MOVE != 0 {
            "cut".to_string()
        } else {
            "copy".to_string()
        }
    }
}

async fn read_directory(
    sftp: &SftpSession,
    session_id: &str,
    path: &str,
) -> Result<SftpDirectoryListing, String> {
    let path = normalize_path(path);
    let canonical_path = sftp
        .canonicalize(path)
        .await
        .map_err(|error| format!("failed to resolve SFTP directory: {error}"))?;
    let dir_entries = sftp
        .read_dir(canonical_path.clone())
        .await
        .map_err(|error| format!("failed to list SFTP directory: {error}"))?
        .collect::<Vec<_>>();
    let mut entries = Vec::with_capacity(dir_entries.len());
    for entry in dir_entries {
        let metadata = entry.metadata();
        let name = entry.file_name();
        let kind = remote_listing_kind(sftp, &canonical_path, &name, metadata.file_type()).await;
        entries.push(SftpDirectoryEntry {
            name,
            kind: kind.to_string(),
            size: metadata.size,
            modified: metadata
                .modified()
                .ok()
                .and_then(|time| unix_timestamp(time).ok()),
            accessed: metadata
                .accessed()
                .ok()
                .and_then(|time| unix_timestamp(time).ok()),
            permissions: metadata.permissions.map(sftp_file_mode),
            uid: metadata.uid,
            user: metadata.user,
            gid: metadata.gid,
            group: metadata.group,
        });
    }
    entries.sort_by(|left, right| {
        file_kind_rank(&left.kind)
            .cmp(&file_kind_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(SftpDirectoryListing {
        session_id: session_id.to_string(),
        path: canonical_path,
        entries,
    })
}

async fn remote_listing_kind(
    sftp: &SftpSession,
    parent_path: &str,
    name: &str,
    file_type: FileType,
) -> &'static str {
    if file_type != FileType::Symlink {
        return file_kind(file_type);
    }

    let path = join_remote_path(parent_path, name);
    match sftp.metadata(path).await {
        Ok(metadata) if metadata.file_type() == FileType::Dir => "folder",
        _ => file_kind(file_type),
    }
}

async fn path_properties(sftp: &SftpSession, path: &str) -> Result<SftpPathProperties, String> {
    let path = normalize_path(path);
    let metadata = sftp
        .symlink_metadata(path.clone())
        .await
        .map_err(|error| format!("failed to read SFTP properties: {error}"))?;
    Ok(properties_from_metadata(path, metadata))
}

async fn update_path_properties(
    sftp: &SftpSession,
    path: &str,
    permissions: Option<u32>,
    uid: Option<u32>,
    gid: Option<u32>,
) -> Result<(), String> {
    let path = normalize_path(path);
    let mut attrs = FileAttributes::empty();
    attrs.permissions = permissions;
    attrs.uid = uid;
    attrs.gid = gid;
    sftp.set_metadata(path, attrs)
        .await
        .map_err(|error| format!("failed to update SFTP properties: {error}"))
}

fn properties_from_metadata(path: String, metadata: Metadata) -> SftpPathProperties {
    let permissions = metadata.permissions.map(sftp_file_mode);
    SftpPathProperties {
        name: display_remote_path_name(&path),
        path,
        kind: file_kind(metadata.file_type()).to_string(),
        size: metadata.size,
        modified: metadata
            .modified()
            .ok()
            .and_then(|time| unix_timestamp(time).ok()),
        accessed: metadata
            .accessed()
            .ok()
            .and_then(|time| unix_timestamp(time).ok()),
        permissions,
        mode: permissions.map(format_octal_permissions),
        uid: metadata.uid,
        user: metadata.user,
        gid: metadata.gid,
        group: metadata.group,
    }
}

fn display_remote_path_name(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn sftp_file_mode(permissions: u32) -> u32 {
    permissions & 0o7777
}

fn format_octal_permissions(permissions: u32) -> String {
    format!("{:03o}", permissions & 0o7777)
}

fn auth_for(
    secrets: &secrets::Secrets,
    request: &StartSftpSessionRequest,
    auth_method: SftpAuthMethod,
) -> Result<ssh::NativeSshAuth, String> {
    match auth_method {
        SftpAuthMethod::KeyFile => Ok(ssh::NativeSshAuth::KeyFile {
            key_path: request.key_path.clone().unwrap_or_default(),
            passphrase: request.passphrase_owner_id.as_ref().and_then(|owner_id| {
                secrets
                    .read_connection_passphrase(owner_id.clone())
                    .ok()
                    .flatten()
            }),
        }),
        SftpAuthMethod::Password => {
            if let Some(password) = request
                .password
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Ok(ssh::NativeSshAuth::Password {
                    password: Some(password.to_string()),
                });
            }
            let owner_id = request
                .secret_owner_id
                .clone()
                .ok_or_else(|| "password auth requires a connection secret owner".to_string())?;
            let password = secrets
                .read_connection_password(owner_id)
                .map_err(|error| format!("failed to read SFTP password: {error}"))?
                .ok_or_else(|| "password auth requires a stored connection password".to_string())?;
            Ok(ssh::NativeSshAuth::Password {
                password: Some(password),
            })
        }
        SftpAuthMethod::Agent => Ok(ssh::NativeSshAuth::Agent),
    }
}

fn auth_method_for(request: &StartSftpSessionRequest) -> Result<SftpAuthMethod, String> {
    match request
        .auth_method
        .as_deref()
        .map(str::trim)
        .filter(|method| !method.is_empty())
    {
        Some("keyFile") | Some("key-file") | Some("key") => Ok(SftpAuthMethod::KeyFile),
        Some("password") => Ok(SftpAuthMethod::Password),
        Some("agent") | Some("sshAgent") | Some("ssh-agent") => Ok(SftpAuthMethod::Agent),
        Some(_) => Err("SFTP auth method must be keyFile, password, or agent".to_string()),
        None if request
            .key_path
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty()) =>
        {
            Ok(SftpAuthMethod::KeyFile)
        }
        None => Ok(SftpAuthMethod::Agent),
    }
}

fn sftp_auth_method_name(method: SftpAuthMethod) -> &'static str {
    match method {
        SftpAuthMethod::KeyFile => "keyFile",
        SftpAuthMethod::Password => "password",
        SftpAuthMethod::Agent => "agent",
    }
}

fn sftp_overwrite_behavior_name(behavior: SftpOverwriteBehavior) -> &'static str {
    match behavior {
        SftpOverwriteBehavior::Fail => "fail",
        SftpOverwriteBehavior::Overwrite => "overwrite",
    }
}

fn sftp_timeout_message(operation: &str, timeout: Duration) -> String {
    format!(
        "timed out while {operation} after {} seconds",
        timeout.as_secs()
    )
}

async fn with_sftp_io_timeout<T, F>(operation: &'static str, future: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::time::timeout(SFTP_TRANSFER_IO_TIMEOUT, future)
        .await
        .map_err(|_| sftp_timeout_message(operation, SFTP_TRANSFER_IO_TIMEOUT))?
}

async fn with_sftp_transfer_io_timeout<T, F>(
    operation: &'static str,
    cancellation: &CancellationToken,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    with_sftp_transfer_io_timeout_for(operation, SFTP_TRANSFER_IO_TIMEOUT, cancellation, future)
        .await
}

async fn with_sftp_transfer_io_timeout_for<T, F>(
    operation: &'static str,
    timeout: Duration,
    cancellation: &CancellationToken,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            Err(session_invalidating_transfer_error(TRANSFER_CANCELED))
        }
        result = tokio::time::timeout(timeout, future) => {
            result
                .map_err(|_| {
                    session_invalidating_transfer_error(&sftp_timeout_message(operation, timeout))
                })?
        }
    }
}

fn session_invalidating_transfer_error(message: &str) -> String {
    format!("{SFTP_SESSION_INVALIDATED_MARKER}{message}")
}

fn is_session_invalidating_transfer_error(error: &str) -> bool {
    error.starts_with(SFTP_SESSION_INVALIDATED_MARKER)
}

fn transfer_error_message(error: &str) -> &str {
    error
        .strip_prefix(SFTP_SESSION_INVALIDATED_MARKER)
        .unwrap_or(error)
}

fn log_transfer_result(
    event_prefix: &str,
    session_id: &str,
    transfer_id: &str,
    result: &Result<SftpTransferResult, String>,
) {
    match result {
        Ok(summary) => sftp_debug(
            &format!("{event_prefix}.ok"),
            json!({
                "sessionId": session_id,
                "transferId": transfer_id,
                "name": summary.name,
                "files": summary.files,
                "folders": summary.folders,
                "bytes": summary.bytes,
            }),
        ),
        Err(error) => sftp_debug(
            &format!("{event_prefix}.error"),
            json!({
                "sessionId": session_id,
                "transferId": transfer_id,
                "error": transfer_error_message(error),
                "sessionInvalidated": is_session_invalidating_transfer_error(error),
            }),
        ),
    }
}

fn file_kind(file_type: FileType) -> &'static str {
    match file_type {
        FileType::Dir => "folder",
        FileType::File => "file",
        FileType::Symlink => "symlink",
        FileType::Other => "other",
    }
}

fn file_kind_rank(kind: &str) -> u8 {
    match kind {
        "folder" => 0,
        "file" => 1,
        "symlink" => 2,
        _ => 3,
    }
}

fn local_file_kind(file_type: &fs::FileType) -> &'static str {
    if file_type.is_dir() {
        "folder"
    } else if file_type.is_file() {
        "file"
    } else if file_type.is_symlink() {
        "symlink"
    } else {
        "other"
    }
}

fn normalize_path(path: &str) -> String {
    let path = path.trim();
    if path.is_empty() {
        ".".to_string()
    } else {
        path.to_string()
    }
}

fn normalize_mutable_remote_path(path: &str) -> Result<String, String> {
    let path = normalize_path(path);
    if path == "." || path == "/" || path == ".." {
        return Err("select a remote file or folder first".to_string());
    }
    Ok(path)
}

fn join_remote_path(base_path: &str, child_name: &str) -> String {
    let base_path = normalize_path(base_path);
    if base_path == "." {
        child_name.to_string()
    } else if base_path.ends_with('/') {
        format!("{base_path}{child_name}")
    } else {
        format!("{base_path}/{child_name}")
    }
}

fn remote_parent_path(path: &str) -> String {
    let path = normalize_path(path).trim_end_matches('/').to_string();
    match path.rsplit_once('/') {
        Some(("", _)) => "/".to_string(),
        Some((parent, _)) if !parent.is_empty() => parent.to_string(),
        _ => ".".to_string(),
    }
}

fn validate_remote_child_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("remote name cannot be blank".to_string());
    }
    if name == "." || name == ".." {
        return Err("remote name cannot be . or ..".to_string());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("remote name cannot contain path separators".to_string());
    }
    Ok(name.to_string())
}

fn local_path_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "local source must have a file or folder name".to_string())
}

fn remote_path_name(path: &str) -> Result<String, String> {
    normalize_path(path)
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|name| !name.is_empty() && *name != "." && *name != "..")
        .map(ToString::to_string)
        .ok_or_else(|| "remote source must have a file or folder name".to_string())
}

fn ensure_local_missing(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Err(format!(
            "local destination already exists: {}",
            display_local_path(path)
        ));
    }
    Ok(())
}

async fn ensure_remote_missing(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let exists = sftp
        .try_exists(path.to_string())
        .await
        .map_err(|error| format!("failed to inspect remote destination: {error}"))?;
    if exists {
        return Err(format!("remote destination already exists: {path}"));
    }
    Ok(())
}

async fn prepare_remote_upload_directory(
    sftp: &SftpSession,
    path: &str,
    overwrite_behavior: SftpOverwriteBehavior,
) -> Result<(), String> {
    if overwrite_behavior == SftpOverwriteBehavior::Fail {
        return create_remote_dir_if_missing(sftp, path).await;
    }

    if !sftp
        .try_exists(path.to_string())
        .await
        .map_err(|error| format!("failed to inspect remote folder: {error}"))?
    {
        return sftp
            .create_dir(path.to_string())
            .await
            .map_err(|error| format!("failed to create remote folder: {error}"));
    }

    let metadata = sftp
        .metadata(path.to_string())
        .await
        .map_err(|error| format!("failed to inspect remote folder: {error}"))?;
    if metadata.file_type() == FileType::Dir {
        Ok(())
    } else {
        Err(format!("remote destination is not a folder: {path}"))
    }
}

async fn remote_upload_target(
    sftp: &SftpSession,
    path: &str,
    overwrite_behavior: SftpOverwriteBehavior,
) -> Result<RemoteUploadTarget, String> {
    if overwrite_behavior == SftpOverwriteBehavior::Fail {
        ensure_remote_missing(sftp, path).await?;
        return Ok(RemoteUploadTarget {
            flags: OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
            existed: false,
        });
    }

    let existed = sftp
        .try_exists(path.to_string())
        .await
        .map_err(|error| format!("failed to inspect remote destination: {error}"))?;
    if existed {
        let metadata = sftp
            .metadata(path.to_string())
            .await
            .map_err(|error| format!("failed to inspect remote destination: {error}"))?;
        if metadata.file_type() == FileType::Dir {
            return Err(format!("remote destination is a folder: {path}"));
        }
    }

    Ok(RemoteUploadTarget {
        flags: OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        existed,
    })
}

fn prepare_local_download_directory(
    path: &Path,
    overwrite_behavior: SftpOverwriteBehavior,
) -> Result<(), String> {
    if overwrite_behavior == SftpOverwriteBehavior::Fail {
        ensure_local_missing(path)?;
        return fs::create_dir(path)
            .map_err(|error| format!("failed to create local folder: {error}"));
    }

    if path.exists() {
        if path.is_dir() {
            Ok(())
        } else {
            Err(format!(
                "local destination is not a folder: {}",
                display_local_path(path)
            ))
        }
    } else {
        fs::create_dir(path).map_err(|error| format!("failed to create local folder: {error}"))
    }
}

fn prepare_local_download_file(
    path: &Path,
    overwrite_behavior: SftpOverwriteBehavior,
) -> Result<bool, String> {
    if overwrite_behavior == SftpOverwriteBehavior::Fail {
        ensure_local_missing(path)?;
        return Ok(false);
    }

    if path.is_dir() {
        return Err(format!(
            "local destination is a folder: {}",
            display_local_path(path)
        ));
    }
    Ok(path.exists())
}

fn local_transfer_size(path: &Path) -> Result<u64, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("failed to inspect local transfer size: {error}"))?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    if !metadata.is_dir() {
        return Ok(0);
    }

    let mut bytes = 0;
    for child in
        fs::read_dir(path).map_err(|error| format!("failed to inspect local folder: {error}"))?
    {
        let child = child.map_err(|error| format!("failed to inspect local folder: {error}"))?;
        bytes += local_transfer_size(&child.path())?;
    }
    Ok(bytes)
}

fn remote_transfer_size<'a>(
    sftp: &'a SftpSession,
    path: &'a str,
) -> Pin<Box<dyn Future<Output = Result<u64, String>> + 'a>> {
    Box::pin(async move {
        let metadata = sftp
            .metadata(path.to_string())
            .await
            .map_err(|error| format!("failed to inspect remote transfer size: {error}"))?;
        match metadata.file_type() {
            FileType::File => Ok(metadata.size.unwrap_or(0)),
            FileType::Dir => {
                let entries = sftp
                    .read_dir(path.to_string())
                    .await
                    .map_err(|error| format!("failed to inspect remote folder: {error}"))?
                    .map(|entry| entry.file_name())
                    .filter(|name| name != "." && name != "..")
                    .collect::<Vec<_>>();
                let mut bytes = 0;
                for child_name in entries {
                    let child_path = join_remote_path(path, &child_name);
                    bytes += remote_transfer_size(sftp, &child_path).await?;
                }
                Ok(bytes)
            }
            _ => Ok(0),
        }
    })
}

async fn create_remote_dir_if_missing(sftp: &SftpSession, path: &str) -> Result<(), String> {
    if sftp
        .try_exists(path.to_string())
        .await
        .map_err(|error| format!("failed to inspect remote folder: {error}"))?
    {
        return Err(format!("remote destination already exists: {path}"));
    }
    sftp.create_dir(path.to_string())
        .await
        .map_err(|error| format!("failed to create remote folder: {error}"))
}

fn resolve_local_directory(path: Option<&str>) -> Result<PathBuf, String> {
    let path = path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_local_directory);
    let path = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|error| format!("failed to resolve current directory: {error}"))?
            .join(path)
    };
    let directory = fs::canonicalize(&path)
        .map_err(|error| format!("failed to resolve local directory: {error}"))?;
    if !directory.is_dir() {
        return Err("local path is not a directory".to_string());
    }
    Ok(directory)
}

fn list_windows_drives() -> Result<LocalDirectoryListing, String> {
    #[cfg(windows)]
    {
        let mut entries = Vec::new();
        for letter in b'A'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            if Path::new(&path).is_dir() {
                entries.push(LocalDirectoryEntry {
                    name: path,
                    kind: "folder".to_string(),
                    size: None,
                    modified: None,
                });
            }
        }

        return Ok(LocalDirectoryListing {
            path: WINDOWS_DRIVES_PATH.to_string(),
            entries,
        });
    }

    #[cfg(not(windows))]
    {
        Err("Windows drive navigation is only available on Windows".to_string())
    }
}

fn requests_parent_directory(path: &str) -> bool {
    Path::new(path)
        .components()
        .any(|component| component == std::path::Component::ParentDir)
}

fn is_windows_drive_root(path: &Path) -> bool {
    let value = display_local_path(path);
    let mut chars = value.chars();
    matches!(
        (chars.next(), chars.next(), chars.next(), chars.next()),
        (Some(letter), Some(':'), Some(separator), None)
            if letter.is_ascii_alphabetic() && (separator == '\\' || separator == '/')
    )
}

fn default_local_directory() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn display_local_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(stripped) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{stripped}")
    } else if let Some(stripped) = value.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        value.to_string()
    }
}

fn unix_timestamp(time: SystemTime) -> Result<u64, std::time::SystemTimeError> {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
}

fn make_session_id(title: &str) -> String {
    let slug = title
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{}-{unique}", if slug.is_empty() { "sftp" } else { &slug })
}

#[derive(Default)]
struct TransferSummary {
    name: String,
    files: u64,
    folders: u64,
    bytes: u64,
}

impl TransferSummary {
    fn into_result(self) -> SftpTransferResult {
        SftpTransferResult {
            name: self.name,
            files: self.files,
            folders: self.folders,
            bytes: self.bytes,
        }
    }
}

struct TransferProgress {
    app: AppHandle,
    transfer_id: String,
    cancellation: CancellationToken,
    transferred_bytes: u64,
    total_bytes: u64,
}

impl TransferProgress {
    fn new(
        app: AppHandle,
        transfer_id: &str,
        cancellation: CancellationToken,
        total_bytes: u64,
    ) -> Self {
        Self {
            app,
            transfer_id: transfer_id.to_string(),
            cancellation,
            transferred_bytes: 0,
            total_bytes,
        }
    }

    fn add_bytes(&mut self, bytes: u64) {
        self.transferred_bytes = self.transferred_bytes.saturating_add(bytes);
        self.emit();
    }

    fn emit(&self) {
        let _ = self.app.emit(
            "sftp-transfer-progress",
            SftpTransferProgress {
                transfer_id: self.transfer_id.clone(),
                transferred_bytes: self.transferred_bytes,
                total_bytes: self.total_bytes,
                progress: transfer_progress_percent(self.transferred_bytes, self.total_bytes),
            },
        );
    }

    fn check_cancelled(&self) -> Result<(), String> {
        if self.cancellation.is_cancelled() {
            Err(session_invalidating_transfer_error(TRANSFER_CANCELED))
        } else {
            Ok(())
        }
    }

    fn cancellation(&self) -> &CancellationToken {
        &self.cancellation
    }
}

fn transfer_progress_percent(transferred_bytes: u64, total_bytes: u64) -> u8 {
    if total_bytes == 0 {
        return 0;
    }
    let percent = transferred_bytes.saturating_mul(100) / total_bytes;
    percent.min(100) as u8
}

fn normalize_sftp_overwrite_behavior(value: Option<&str>) -> Result<SftpOverwriteBehavior, String> {
    match value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("fail")
        .to_lowercase()
        .as_str()
    {
        "fail" | "error" | "never" => Ok(SftpOverwriteBehavior::Fail),
        "overwrite" | "replace" => Ok(SftpOverwriteBehavior::Overwrite),
        _ => Err("SFTP overwrite behavior must be fail or overwrite".to_string()),
    }
}

fn parse_octal_permissions(value: &str) -> Result<u32, String> {
    let trimmed = value.trim().trim_start_matches("0o");
    if trimmed.is_empty()
        || trimmed.len() > 4
        || !trimmed.chars().all(|digit| ('0'..='7').contains(&digit))
    {
        return Err("SFTP permissions must be an octal mode like 755 or 0644".to_string());
    }

    u32::from_str_radix(trimmed, 8)
        .map(|mode| mode & 0o7777)
        .map_err(|_| "SFTP permissions must be an octal mode like 755 or 0644".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tokio::io::DuplexStream;

    async fn read_test_sftp_packet(stream: &mut DuplexStream) -> std::io::Result<Vec<u8>> {
        let length = stream.read_u32().await? as usize;
        let mut packet = vec![0; length];
        stream.read_exact(&mut packet).await?;
        Ok(packet)
    }

    async fn write_test_sftp_packet(
        stream: &mut DuplexStream,
        packet_type: u8,
        body: &[u8],
    ) -> std::io::Result<()> {
        stream.write_u32((body.len() + 1) as u32).await?;
        stream.write_u8(packet_type).await?;
        stream.write_all(body).await?;
        stream.flush().await
    }

    fn test_sftp_packet_id(packet: &[u8]) -> u32 {
        u32::from_be_bytes(packet[1..5].try_into().expect("packet contains an id"))
    }

    fn test_sftp_write_data(packet: &[u8]) -> &[u8] {
        let handle_length = u32::from_be_bytes(
            packet[5..9]
                .try_into()
                .expect("write contains a handle length"),
        ) as usize;
        let data_length_offset = 9 + handle_length + 8;
        let data_length = u32::from_be_bytes(
            packet[data_length_offset..data_length_offset + 4]
                .try_into()
                .expect("write contains a data length"),
        ) as usize;
        &packet[data_length_offset + 4..data_length_offset + 4 + data_length]
    }

    async fn write_test_sftp_status(stream: &mut DuplexStream, id: u32) -> std::io::Result<()> {
        let mut body = Vec::with_capacity(16);
        body.extend_from_slice(&id.to_be_bytes());
        body.extend_from_slice(&0u32.to_be_bytes());
        body.extend_from_slice(&0u32.to_be_bytes());
        body.extend_from_slice(&0u32.to_be_bytes());
        write_test_sftp_packet(stream, 101, &body).await
    }

    async fn run_serial_write_test_server(
        mut stream: DuplexStream,
        received: Arc<Mutex<Vec<u8>>>,
        saw_pipelining: Arc<AtomicBool>,
    ) -> std::io::Result<()> {
        let init = read_test_sftp_packet(&mut stream).await?;
        assert_eq!(init.first(), Some(&1), "expected SSH_FXP_INIT");
        write_test_sftp_packet(&mut stream, 2, &3u32.to_be_bytes()).await?;

        loop {
            let packet = read_test_sftp_packet(&mut stream).await?;
            match packet.first().copied() {
                Some(3) => {
                    let id = test_sftp_packet_id(&packet);
                    let mut body = Vec::with_capacity(9);
                    body.extend_from_slice(&id.to_be_bytes());
                    body.extend_from_slice(&1u32.to_be_bytes());
                    body.push(b'h');
                    write_test_sftp_packet(&mut stream, 102, &body).await?;
                }
                Some(6) => {
                    received
                        .lock()
                        .expect("received bytes lock")
                        .extend_from_slice(test_sftp_write_data(&packet));
                    let id = test_sftp_packet_id(&packet);
                    match tokio::time::timeout(
                        Duration::from_millis(50),
                        read_test_sftp_packet(&mut stream),
                    )
                    .await
                    {
                        Ok(Ok(next_packet)) if next_packet.first() == Some(&6) => {
                            saw_pipelining.store(true, Ordering::SeqCst);
                            std::future::pending::<()>().await;
                        }
                        Ok(Ok(next_packet)) => {
                            panic!(
                                "received unexpected packet type {:?} before write acknowledgement",
                                next_packet.first()
                            );
                        }
                        Ok(Err(error)) => return Err(error),
                        Err(_) => write_test_sftp_status(&mut stream, id).await?,
                    }
                }
                Some(4) => {
                    write_test_sftp_status(&mut stream, test_sftp_packet_id(&packet)).await?;
                    return Ok(());
                }
                packet_type => panic!("unexpected SFTP packet type {packet_type:?}"),
            }
        }
    }

    #[test]
    fn upload_larger_than_eight_chunks_uses_serial_acknowledged_writes() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime");
        runtime.block_on(async {
            let (client, server) = tokio::io::duplex(2 * 1024 * 1024);
            let received = Arc::new(Mutex::new(Vec::new()));
            let saw_pipelining = Arc::new(AtomicBool::new(false));
            let server_task = tokio::spawn(run_serial_write_test_server(
                server,
                Arc::clone(&received),
                Arc::clone(&saw_pipelining),
            ));
            let sftp = SftpSession::new_with_config(client, sftp_client_config())
                .await
                .expect("SFTP client initializes");
            let mut remote_file = sftp
                .open_with_flags(
                    "/upload.bin",
                    OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
                )
                .await
                .expect("remote file opens");

            let payload = vec![0x5a; 900 * 1024];

            tokio::time::timeout(Duration::from_secs(3), async {
                for chunk in payload.chunks(TRANSFER_CHUNK_SIZE) {
                    remote_file
                        .write_all(chunk)
                        .await
                        .map_err(|error| error.to_string())?;
                }
                remote_file
                    .shutdown()
                    .await
                    .map_err(|error| error.to_string())
            })
            .await
            .expect("upload must not stall at the in-flight write boundary")
            .expect("upload succeeds");

            assert!(!saw_pipelining.load(Ordering::SeqCst));
            assert_eq!(
                received.lock().expect("received bytes lock").as_slice(),
                payload
            );
            server_task
                .await
                .expect("server task joins")
                .expect("server completes");
        });
    }

    #[test]
    fn sftp_compression_is_forced_off_for_every_request() {
        assert!(!effective_sftp_ssh_compression(None));
        assert!(!effective_sftp_ssh_compression(Some(false)));
        assert!(!effective_sftp_ssh_compression(Some(true)));
    }

    #[test]
    fn cancel_wakes_in_flight_sftp_io_and_invalidates_the_session() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime");
        runtime.block_on(async {
            let cancellation = CancellationToken::new();
            let trigger = cancellation.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(20)).await;
                trigger.cancel();
            });
            let started = std::time::Instant::now();
            let result = with_sftp_transfer_io_timeout_for(
                "testing cancellation",
                Duration::from_secs(10),
                &cancellation,
                std::future::pending::<Result<(), String>>(),
            )
            .await;

            let error = result.expect_err("cancellation must interrupt pending SFTP I/O");
            assert!(is_session_invalidating_transfer_error(&error));
            assert_eq!(transfer_error_message(&error), TRANSFER_CANCELED);
            assert!(started.elapsed() < Duration::from_millis(500));
        });
    }

    #[test]
    fn timeout_marks_in_flight_sftp_session_unusable() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime");
        runtime.block_on(async {
            let cancellation = CancellationToken::new();
            let result = with_sftp_transfer_io_timeout_for(
                "testing timeout",
                Duration::from_millis(20),
                &cancellation,
                std::future::pending::<Result<(), String>>(),
            )
            .await;

            let error = result.expect_err("timeout must interrupt pending SFTP I/O");
            assert!(is_session_invalidating_transfer_error(&error));
            assert_eq!(
                transfer_error_message(&error),
                "timed out while testing timeout after 0 seconds"
            );
        });
    }

    #[test]
    fn sftp_auth_defaults_to_agent_without_key_path() {
        let request = sftp_request();

        assert!(matches!(
            auth_method_for(&request),
            Ok(SftpAuthMethod::Agent)
        ));
    }

    #[test]
    fn sftp_auth_uses_key_file_when_key_path_exists() {
        let mut request = sftp_request();
        request.key_path = Some("C:\\Users\\example\\.ssh\\id_ed25519".to_string());

        assert!(matches!(
            auth_method_for(&request),
            Ok(SftpAuthMethod::KeyFile)
        ));
    }

    #[test]
    fn sftp_auth_rejects_unknown_methods() {
        let mut request = sftp_request();
        request.auth_method = Some("keyboardInteractive".to_string());

        assert!(auth_method_for(&request).is_err());
    }

    #[test]
    fn blank_sftp_paths_open_home_directory() {
        assert_eq!(normalize_path(""), ".");
        assert_eq!(normalize_path("  "), ".");
        assert_eq!(normalize_path("/srv/releases"), "/srv/releases");
    }

    #[test]
    fn display_local_path_strips_windows_verbatim_prefixes() {
        assert_eq!(
            display_local_path(Path::new(r"\\?\C:\Users\Ryan")),
            r"C:\Users\Ryan"
        );
        assert_eq!(
            display_local_path(Path::new(r"\\?\UNC\server\share")),
            r"\\server\share"
        );
    }

    #[test]
    fn remote_paths_join_with_single_separator() {
        assert_eq!(join_remote_path(".", "release.zip"), "release.zip");
        assert_eq!(
            join_remote_path("/srv/releases", "release.zip"),
            "/srv/releases/release.zip"
        );
        assert_eq!(
            join_remote_path("/srv/releases/", "release.zip"),
            "/srv/releases/release.zip"
        );
    }

    #[test]
    fn remote_parent_paths_keep_sibling_renames_in_place() {
        assert_eq!(remote_parent_path("release.zip"), ".");
        assert_eq!(
            remote_parent_path("/srv/releases/release.zip"),
            "/srv/releases"
        );
        assert_eq!(remote_parent_path("/release.zip"), "/");
    }

    #[test]
    fn remote_child_names_reject_paths_and_parent_segments() {
        assert_eq!(
            validate_remote_child_name("release.zip"),
            Ok("release.zip".to_string())
        );
        assert!(validate_remote_child_name("").is_err());
        assert!(validate_remote_child_name("..").is_err());
        assert!(validate_remote_child_name("folder/release.zip").is_err());
        assert!(validate_remote_child_name(r"folder\release.zip").is_err());
    }

    #[test]
    fn mutable_remote_paths_reject_directory_only_values() {
        assert_eq!(
            normalize_mutable_remote_path("/srv/releases/app.zip"),
            Ok("/srv/releases/app.zip".to_string())
        );
        assert!(normalize_mutable_remote_path(".").is_err());
        assert!(normalize_mutable_remote_path("/").is_err());
        assert!(normalize_mutable_remote_path("..").is_err());
    }

    #[test]
    fn remote_path_names_reject_directory_only_values() {
        assert_eq!(
            remote_path_name("/srv/releases/app.zip"),
            Ok("app.zip".to_string())
        );
        assert!(remote_path_name(".").is_err());
        assert!(remote_path_name("..").is_err());
    }

    #[test]
    fn sftp_permission_modes_parse_octal_values() {
        assert_eq!(parse_octal_permissions("755"), Ok(0o755));
        assert_eq!(parse_octal_permissions("0644"), Ok(0o644));
        assert_eq!(parse_octal_permissions("0o600"), Ok(0o600));
        assert!(parse_octal_permissions("").is_err());
        assert!(parse_octal_permissions("888").is_err());
        assert!(parse_octal_permissions("10000").is_err());
    }

    #[test]
    fn transfer_progress_handles_zero_and_caps_at_one_hundred() {
        assert_eq!(transfer_progress_percent(0, 0), 0);
        assert_eq!(transfer_progress_percent(50, 200), 25);
        assert_eq!(transfer_progress_percent(250, 200), 100);
    }

    #[test]
    fn sftp_overwrite_behavior_defaults_to_fail_and_normalizes_aliases() {
        assert!(matches!(
            normalize_sftp_overwrite_behavior(None),
            Ok(SftpOverwriteBehavior::Fail)
        ));
        assert!(matches!(
            normalize_sftp_overwrite_behavior(Some(" replace ")),
            Ok(SftpOverwriteBehavior::Overwrite)
        ));
        assert!(normalize_sftp_overwrite_behavior(Some("skip")).is_err());
    }

    #[test]
    fn local_copy_rejects_directory_into_its_descendant() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time is after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("kkterm-local-copy-{unique}"));
        let source = root.join("source");
        let child = source.join("child");
        fs::create_dir_all(&child).expect("test directories are created");

        let result = copy_local_path(CopyLocalPathRequest {
            source_path: display_local_path(&source),
            destination_directory: display_local_path(&child),
        });

        let _ = fs::remove_dir_all(&root);
        assert!(matches!(
            result,
            Err(message) if message.contains("cannot copy a folder into itself")
        ));
    }

    fn compare_test_root(tag: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time is after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("kkterm-{tag}-{unique}"))
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent dir is created");
        }
        fs::write(path, contents).expect("file is written");
    }

    fn row_status<'a>(result: &'a FolderCompareResult, relative_path: &str) -> Option<&'a str> {
        result
            .rows
            .iter()
            .find(|row| row.relative_path == relative_path)
            .map(|row| row.status.as_str())
    }

    #[test]
    fn folder_compare_classifies_entries() {
        let root = compare_test_root("folder-compare");
        let left = root.join("left");
        let right = root.join("right");
        write_file(&left.join("same.txt"), "hello");
        write_file(&right.join("same.txt"), "hello");
        write_file(&left.join("diff.txt"), "alpha");
        write_file(&right.join("diff.txt"), "beta!");
        write_file(&left.join("only_left.txt"), "L");
        write_file(&right.join("only_right.txt"), "R");
        // A subfolder that differs only deep down marks its folder row different.
        write_file(&left.join("common/inner.txt"), "1");
        write_file(&right.join("common/inner.txt"), "2");
        // A folder present on only one side is an orphan.
        write_file(&left.join("left_dir/child.txt"), "x");

        let result = compare_folders(CompareFoldersRequest {
            left: display_local_path(&left),
            right: display_local_path(&right),
        })
        .expect("comparison succeeds");

        assert_eq!(row_status(&result, "same.txt"), Some("same"));
        assert_eq!(row_status(&result, "diff.txt"), Some("different"));
        assert_eq!(row_status(&result, "only_left.txt"), Some("left-only"));
        assert_eq!(row_status(&result, "only_right.txt"), Some("right-only"));
        assert_eq!(row_status(&result, "common"), Some("different"));
        assert_eq!(row_status(&result, "common/inner.txt"), Some("different"));
        assert_eq!(row_status(&result, "left_dir"), Some("left-only"));
        assert_eq!(row_status(&result, "left_dir/child.txt"), Some("left-only"));
        assert_eq!(result.summary.different, 3); // diff.txt, common, common/inner.txt
        assert_eq!(result.summary.left_only, 3); // only_left.txt, left_dir, left_dir/child.txt
        assert_eq!(result.summary.right_only, 1);
        assert_eq!(result.summary.same, 1);
        assert!(!result.truncated);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_local_path_to_mirrors_into_missing_parents() {
        let root = compare_test_root("copy-to");
        let source = root.join("left/nested/file.txt");
        write_file(&source, "payload");
        let destination = root.join("right/nested/file.txt");

        copy_local_path_to(CopyLocalPathToRequest {
            source_path: display_local_path(&source),
            destination_path: display_local_path(&destination),
        })
        .expect("copy succeeds");

        assert_eq!(
            fs::read_to_string(&destination).expect("destination exists"),
            "payload"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn files_equal_detects_content_difference_at_same_size() {
        let root = compare_test_root("files-equal");
        let left = root.join("a.bin");
        let right = root.join("b.bin");
        write_file(&left, "abcde");
        write_file(&right, "abcde");
        assert_eq!(files_equal(&left, &right), Ok(true));
        write_file(&right, "abcdX");
        assert_eq!(files_equal(&left, &right), Ok(false));
        let _ = fs::remove_dir_all(&root);
    }

    fn sftp_request() -> StartSftpSessionRequest {
        StartSftpSessionRequest {
            session_id: None,
            title: "Test SFTP".to_string(),
            host: "files.internal".to_string(),
            user: "deploy".to_string(),
            port: Some(22),
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_secret_owner_id: None,
            auth_method: None,
            secret_owner_id: None,
            password: None,
            passphrase_owner_id: None,
            path: None,
            ssh_compression: None,
            ssh_old_protocols: None,
        }
    }
}

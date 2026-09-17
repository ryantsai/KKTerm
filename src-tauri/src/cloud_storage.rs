// Cloud storage Connections.
//
// One durable Connection type (`cloudStorage`) covers S3-compatible object
// storage and Azure Blob Storage. The provider is a discriminator inside the
// persisted option JSON (`connections.cloud_storage_options`), so adding a
// provider never changes the SQLite CHECK constraint or the frontend's
// Connection-type plumbing.
//
// Both providers ride the `object_store` crate. Like the SFTP and FTP managers,
// each session owns a current-thread Tokio runtime and every command is invoked
// from a blocking worker at the Tauri command boundary.
//
// Protocol differences are expressed through the shared file-browser capability
// flags rather than by faking POSIX semantics:
//   * object stores have no POSIX permissions (chmod/chown is unavailable);
//   * object stores have no empty-folder primitive, so the New Folder action is
//     withheld rather than faked with a placeholder object - folders appear
//     implicitly once an object is uploaded beneath them;
//   * object-store renames are a server-side copy followed by a delete.

use crate::{net::proxy, secrets};
use bytes::Bytes;
use futures::StreamExt;
use object_store::{
    aws::AmazonS3Builder, azure::MicrosoftAzureBuilder, buffered::BufWriter,
    path::Path as ObjectPath, ClientOptions, ObjectStore, ObjectStoreExt,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    runtime::Runtime,
};

const TRANSFER_CHUNK_SIZE: usize = 256 * 1024;
const UPLOAD_BUFFER_BYTES: usize = 8 * 1024 * 1024;
const TRANSFER_CANCELED: &str = "transfer canceled";
const PROGRESS_EVENT: &str = "cloud-storage-transfer-progress";
const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 30;
const MAX_CONNECT_TIMEOUT_SECS: u64 = 600;

/// Provider list-page caps used to flag a possibly truncated listing. S3
/// returns at most 1000 keys per delimiter page and Azure at most 5000 blobs;
/// both are surfaced to the operator rather than hidden.
const S3_LIST_PAGE_CAP: usize = 1000;
const AZURE_LIST_PAGE_CAP: usize = 5000;

// ------------------------------- public types -------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum CloudStorageProvider {
    #[serde(rename = "s3")]
    S3,
    #[serde(rename = "azureBlob")]
    AzureBlob,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AzureBlobAuthMode {
    Key,
    Sas,
}

/// Persisted-in-SQLite (`connections.cloud_storage_options` JSON) options for
/// a Cloud Storage Connection.
///
/// The struct is deliberately one flat shape with `#[serde(default)]` on every
/// field: the SQLite column is opaque JSON, and `normalize()` clears the fields
/// that do not belong to the selected provider so switching provider in the
/// edit dialog can never leave stale endpoint/region values behind.
///
/// Credentials are deliberately *not* here. The provider principal (S3 access
/// key id, Azure account name) is the Connection's `username`, and the secret
/// (S3 secret access key, Azure account key or SAS token) lives in the OS
/// keychain under the Connection's secret owner id, exactly like FTP.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStorageOptions {
    pub provider: CloudStorageProvider,
    #[serde(default)]
    pub ignore_cert_errors: bool,
    #[serde(default)]
    pub connect_timeout_secs: Option<u64>,
    /// Start directory for the local pane; None = the OS home folder.
    #[serde(default)]
    pub local_path: Option<String>,
    /// Start directory for the remote pane; None = the provider root.
    #[serde(default)]
    pub remote_path: Option<String>,

    // ---- S3-compatible ----
    /// Target bucket. Required: object stores have no portable bucket-listing
    /// permission model, so a Connection addresses exactly one bucket.
    #[serde(default)]
    pub bucket: Option<String>,
    /// Custom endpoint for MinIO / R2 / Ceph / Spaces / localstack.
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
    /// Path-style addressing, required by most self-hosted S3 servers.
    #[serde(default)]
    pub force_path_style: bool,

    // ---- Azure Blob ----
    #[serde(default)]
    pub account: Option<String>,
    /// Target container. Required, same rationale as `bucket`.
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default)]
    pub auth_mode: Option<AzureBlobAuthMode>,
}

impl Default for CloudStorageOptions {
    fn default() -> Self {
        Self {
            provider: CloudStorageProvider::S3,
            ignore_cert_errors: false,
            connect_timeout_secs: Some(DEFAULT_CONNECT_TIMEOUT_SECS),
            local_path: None,
            remote_path: None,
            bucket: None,
            endpoint: None,
            region: None,
            force_path_style: false,
            account: None,
            container: None,
            auth_mode: Some(AzureBlobAuthMode::Key),
        }
    }
}

impl CloudStorageOptions {
    pub fn effective_auth_mode(&self) -> AzureBlobAuthMode {
        self.auth_mode.unwrap_or(AzureBlobAuthMode::Key)
    }

    fn connect_timeout(&self) -> Duration {
        Duration::from_secs(
            self.connect_timeout_secs
                .unwrap_or(DEFAULT_CONNECT_TIMEOUT_SECS)
                .clamp(1, MAX_CONNECT_TIMEOUT_SECS),
        )
    }
}

/// Normalizes persisted options for a Connection of `connection_type`.
/// Mirrors `normalize_ftp_connection_options`: a non-cloud Connection stores
/// no cloud options, and a cloud Connection always stores a complete, valid
/// option set for its provider.
pub fn normalize_cloud_storage_options(
    options: Option<CloudStorageOptions>,
    connection_type: &str,
) -> Result<Option<CloudStorageOptions>, String> {
    if connection_type != "cloudStorage" {
        return Ok(None);
    }
    let mut options = options.unwrap_or_default();
    match options.provider {
        CloudStorageProvider::S3 => {
            options.bucket = Some(required_option(options.bucket.take(), "bucket")?);
            let region = options
                .region
                .take()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "us-east-1".to_string());
            options.region = Some(region);
            options.endpoint = trim_option(options.endpoint.take());
            if let Some(endpoint) = options.endpoint.as_deref() {
                validate_http_endpoint(endpoint)?;
            }
            // Clear the providers that are not in use so a provider switch in
            // the dialog cannot leave contradictory parameters behind.
            options.account = None;
            options.container = None;
            options.auth_mode = None;
        }
        CloudStorageProvider::AzureBlob => {
            options.account = Some(required_option(options.account.take(), "account name")?);
            options.container = Some(required_option(options.container.take(), "container")?);
            options.auth_mode = Some(options.effective_auth_mode());
            options.endpoint = trim_option(options.endpoint.take());
            if let Some(endpoint) = options.endpoint.as_deref() {
                validate_http_endpoint(endpoint)?;
            }
            options.bucket = None;
            options.region = None;
            options.force_path_style = false;
        }
    }
    options.local_path = trim_option(options.local_path.take());
    options.remote_path = trim_option(options.remote_path.take());
    Ok(Some(options))
}

fn required_option(value: Option<String>, label: &str) -> Result<String, String> {
    let trimmed = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    match trimmed {
        Some(value) => Ok(value),
        None => Err(format!("{label} is required for a cloud storage connection")),
    }
}

fn trim_option(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn validate_http_endpoint(value: &str) -> Result<(), String> {
    let parsed = url::Url::parse(value).map_err(|_| format!("invalid server URL: {value}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        other => Err(format!(
            "cloud storage server URLs must use http or https, found {other}"
        )),
    }
}

// ----------------------------- request/response -----------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCloudStorageSessionRequest {
    pub session_id: Option<String>,
    pub title: String,
    pub host: String,
    pub user: String,
    pub secret_owner_id: Option<String>,
    pub password: Option<String>,
    pub path: Option<String>,
    pub options: CloudStorageOptions,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCloudStorageDirectoryRequest {
    pub session_id: String,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadCloudStoragePathRequest {
    pub session_id: String,
    pub transfer_id: String,
    pub local_path: String,
    pub remote_directory: String,
    pub overwrite_behavior: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadCloudStoragePathRequest {
    pub session_id: String,
    pub transfer_id: String,
    pub remote_path: String,
    pub local_directory: String,
    pub overwrite_behavior: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelCloudStorageTransferRequest {
    pub transfer_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCloudStorageFolderRequest {
    pub session_id: String,
    pub parent_path: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameCloudStoragePathRequest {
    pub session_id: String,
    pub path: String,
    pub new_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCloudStoragePathRequest {
    pub session_id: String,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStoragePathPropertiesRequest {
    pub session_id: String,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseCloudStorageSessionRequest {
    pub session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStorageDirectoryEntry {
    pub name: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStorageDirectoryListing {
    pub session_id: String,
    pub path: String,
    pub entries: Vec<CloudStorageDirectoryEntry>,
    /// True when the provider returned a full listing page, meaning the folder
    /// may contain more entries than are shown.
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStoragePathProperties {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified: Option<i64>,
    pub permissions: Option<u32>,
    pub mode: Option<String>,
    pub user: Option<String>,
    pub group: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStorageTransferProgress {
    pub transfer_id: String,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub progress: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStorageTransferResult {
    pub name: String,
    pub files: u64,
    pub folders: u64,
    pub bytes: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum OverwriteBehavior {
    Fail,
    Overwrite,
}

impl OverwriteBehavior {
    fn from_request(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("overwrite") => OverwriteBehavior::Overwrite,
            _ => OverwriteBehavior::Fail,
        }
    }
}

// ------------------------------- session mgmt -------------------------------

/// Transport behind a Cloud Storage session. Both providers share the
/// `object_store` implementation; the enum keeps the dispatch seam explicit for
/// a future provider that needs its own client.
enum CloudStorageTransport {
    ObjectStore {
        store: Arc<dyn ObjectStore>,
        provider: CloudStorageProvider,
    },
}

struct CloudStorageConnection {
    runtime: Runtime,
    transport: CloudStorageTransport,
    options: CloudStorageOptions,
}

pub struct CloudStorageSessionManager {
    sessions: Mutex<HashMap<String, Arc<CloudStorageConnection>>>,
    transfers: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl CloudStorageSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            transfers: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_cloud_storage_session(
        &self,
        _app: AppHandle,
        secrets: &secrets::Secrets,
        request: StartCloudStorageSessionRequest,
    ) -> Result<CloudStorageDirectoryListing, String> {
        let session_id = request
            .session_id
            .clone()
            .unwrap_or_else(|| make_session_id(&request.title));
        let options = request.options.clone();

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
                    .map_err(|e| format!("failed to read cloud storage secret: {e}"))?
                    .unwrap_or_default(),
                _ => String::new(),
            },
        };

        let user_name = request.user.trim().to_string();
        let initial_path = normalize_remote_path(
            request.path.as_deref().unwrap_or("/"),
        );

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("failed to create cloud storage runtime: {e}"))?;

        let connect_timeout = options.connect_timeout();
        let transport = runtime.block_on(async {
            tokio::time::timeout(
                connect_timeout,
                build_transport(&options, &user_name, &password),
            )
            .await
            .map_err(|_| {
                format!(
                    "cloud storage connect timed out after {} seconds",
                    connect_timeout.as_secs()
                )
            })?
        })?;

        let connection = Arc::new(CloudStorageConnection {
            runtime,
            transport,
            options: options.clone(),
        });

        // Resolve the initial listing before publishing the session so a bad
        // root path fails the open action instead of leaving a live session
        // behind a broken pane.
        let (entries, resolved_path, truncated) = read_cloud_directory(
            &connection,
            &initial_path,
        )?;

        self.sessions
            .lock()
            .map_err(|_| "cloud storage session lock is poisoned".to_string())?
            .insert(session_id.clone(), connection);

        Ok(CloudStorageDirectoryListing {
            session_id,
            path: resolved_path,
            entries,
            truncated,
        })
    }

    pub fn close_cloud_storage_session(&self, session_id: &str) -> Result<(), String> {
        let removed = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| "cloud storage session lock is poisoned".to_string())?;
            sessions.remove(session_id)
        };
        // Object-store and reqwest clients drop without a network round trip;
        // there is no protocol-level goodbye to wait on.
        drop(removed);
        Ok(())
    }

    pub fn list_cloud_storage_directory(
        &self,
        request: ListCloudStorageDirectoryRequest,
    ) -> Result<CloudStorageDirectoryListing, String> {
        let connection = self.session(&request.session_id)?;
        let path = normalize_remote_path(&request.path);
        let (entries, resolved_path, truncated) = read_cloud_directory(&connection, &path)?;
        Ok(CloudStorageDirectoryListing {
            session_id: request.session_id,
            path: resolved_path,
            entries,
            truncated,
        })
    }

    /// Object storage has no empty-folder primitive: a "folder" there is only
    /// the shared prefix of existing objects, and `object_store` refuses to
    /// write a key ending in `/`. The browser withholds the New Folder action
    /// (`FileBrowserCapabilities::createFolder` is false); this stays as a guard
    /// so a stale frontend or a direct caller gets a clear reason instead of a
    /// silent no-op.
    pub fn create_cloud_storage_folder(
        &self,
        _request: CreateCloudStorageFolderRequest,
    ) -> Result<(), String> {
        Err(
            "object storage has no empty-folder primitive; upload a file into a folder to create it"
                .to_string(),
        )
    }

    pub fn rename_cloud_storage_path(
        &self,
        request: RenameCloudStoragePathRequest,
    ) -> Result<(), String> {
        let connection = self.session(&request.session_id)?;
        let new_name = validate_remote_child_name(&request.new_name)?;
        let path = normalize_remote_path(&request.path);
        if path == "/" {
            return Err("the storage root cannot be renamed".to_string());
        }
        let parent = remote_parent_path(&path);
        let target = join_remote_path(&parent, &new_name);
        if target == path {
            return Ok(());
        }
        connection.runtime.block_on(async {
            match &connection.transport {
                CloudStorageTransport::ObjectStore { store, .. } => {
                    object_store_rename(store, &path, &target).await
                }
            }
        })
    }

    pub fn delete_cloud_storage_path(
        &self,
        request: DeleteCloudStoragePathRequest,
    ) -> Result<(), String> {
        let connection = self.session(&request.session_id)?;
        let path = normalize_remote_path(&request.path);
        if path == "/" {
            return Err("the storage root cannot be deleted".to_string());
        }
        connection.runtime.block_on(async {
            match &connection.transport {
                CloudStorageTransport::ObjectStore { store, .. } => {
                    object_store_delete(store, &path).await
                }
            }
        })
    }

    pub fn cloud_storage_path_properties(
        &self,
        request: CloudStoragePathPropertiesRequest,
    ) -> Result<CloudStoragePathProperties, String> {
        let connection = self.session(&request.session_id)?;
        let path = normalize_remote_path(&request.path);
        connection.runtime.block_on(async {
            match &connection.transport {
                CloudStorageTransport::ObjectStore { store, .. } => {
                    object_store_properties(store, &path).await
                }
            }
        })
    }

    pub fn upload_cloud_storage_path(
        &self,
        app: AppHandle,
        request: UploadCloudStoragePathRequest,
    ) -> Result<CloudStorageTransferResult, String> {
        let connection = self.session(&request.session_id)?;
        let local_path = PathBuf::from(&request.local_path);
        if !local_path.is_file() {
            return Err(format!(
                "local file does not exist: {}",
                request.local_path
            ));
        }
        let result = transfer_result_for(&local_path)?;
        let remote_directory = normalize_remote_path(&request.remote_directory);
        let remote_path = join_remote_path(&remote_directory, &result.name);
        let behavior = OverwriteBehavior::from_request(request.overwrite_behavior.as_deref());
        let cancel = self.register_transfer(&request.transfer_id);

        let outcome = connection.runtime.block_on(async {
            if behavior == OverwriteBehavior::Fail
                && remote_target_exists(&connection, &remote_path).await?
            {
                return Err(format!("destination already exists: {remote_path}"));
            }
            match &connection.transport {
                CloudStorageTransport::ObjectStore { store, .. } => {
                    object_store_upload(
                        store,
                        &local_path,
                        &remote_path,
                        &cancel,
                        &app,
                        &request.transfer_id,
                    )
                    .await
                }
            }
        });
        self.finish_transfer(&request.transfer_id);
        outcome.map(|_| result)
    }

    pub fn download_cloud_storage_path(
        &self,
        app: AppHandle,
        request: DownloadCloudStoragePathRequest,
    ) -> Result<CloudStorageTransferResult, String> {
        let connection = self.session(&request.session_id)?;
        let remote_path = normalize_remote_path(&request.remote_path);
        if remote_path == "/" {
            return Err("the storage root cannot be downloaded".to_string());
        }
        let name = remote_child_name(&remote_path);
        if name.is_empty() {
            return Err("remote path must name a file or folder".to_string());
        }
        let local_directory = PathBuf::from(&request.local_directory);
        if !local_directory.is_dir() {
            return Err(format!(
                "local directory does not exist: {}",
                request.local_directory
            ));
        }
        let destination = local_directory.join(&name);
        let behavior = OverwriteBehavior::from_request(request.overwrite_behavior.as_deref());
        if behavior == OverwriteBehavior::Fail && destination.exists() {
            return Err(format!(
                "destination already exists: {}",
                destination.display()
            ));
        }
        let cancel = self.register_transfer(&request.transfer_id);

        let outcome = connection.runtime.block_on(async {
            let is_folder = remote_is_folder(&connection, &remote_path).await?;
            if is_folder {
                download_object_tree(
                    &connection,
                    &remote_path,
                    &destination,
                    &name,
                    &cancel,
                    &app,
                    &request.transfer_id,
                )
                .await
            } else {
                match &connection.transport {
                    CloudStorageTransport::ObjectStore { store, .. } => {
                        object_store_download(
                            store,
                            &remote_path,
                            &destination,
                            &cancel,
                            &app,
                            &request.transfer_id,
                        )
                        .await
                    }
                }
            }
        });
        self.finish_transfer(&request.transfer_id);
        outcome.map(|bytes| CloudStorageTransferResult {
            name,
            files: 1,
            folders: 0,
            bytes,
        })
    }

    pub fn cancel_cloud_storage_transfer(
        &self,
        request: CancelCloudStorageTransferRequest,
    ) -> Result<(), String> {
        if let Some(flag) = self
            .transfers
            .lock()
            .map_err(|_| "cloud storage transfer lock is poisoned".to_string())?
            .get(&request.transfer_id)
        {
            flag.store(true, Ordering::SeqCst);
        }
        Ok(())
    }

    // ----------------------------- internals -----------------------------

    fn session(&self, session_id: &str) -> Result<Arc<CloudStorageConnection>, String> {
        self.sessions
            .lock()
            .map_err(|_| "cloud storage session lock is poisoned".to_string())?
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("cloud storage session not found: {session_id}"))
    }

    fn register_transfer(&self, transfer_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut transfers) = self.transfers.lock() {
            transfers.insert(transfer_id.to_string(), flag.clone());
        }
        flag
    }

    fn finish_transfer(&self, transfer_id: &str) {
        if let Ok(mut transfers) = self.transfers.lock() {
            transfers.remove(transfer_id);
        }
    }
}

// --------------------------- provider construction --------------------------

async fn build_transport(
    options: &CloudStorageOptions,
    user: &str,
    secret: &str,
) -> Result<CloudStorageTransport, String> {
    match options.provider {
        CloudStorageProvider::S3 => {
            let store = build_s3_store(options, user, secret)?;
            Ok(CloudStorageTransport::ObjectStore {
                store,
                provider: CloudStorageProvider::S3,
            })
        }
        CloudStorageProvider::AzureBlob => {
            let store = build_azure_store(options, secret)?;
            Ok(CloudStorageTransport::ObjectStore {
                store,
                provider: CloudStorageProvider::AzureBlob,
            })
        }
    }
}

fn client_options(options: &CloudStorageOptions) -> ClientOptions {
    let mut client = ClientOptions::new()
        .with_allow_http(true)
        .with_allow_invalid_certificates(options.ignore_cert_errors)
        .with_connect_timeout(options.connect_timeout())
        .with_timeout(Duration::from_secs(300));
    // Cloud storage is app traffic, so the app/global proxy applies, matching
    // every other reqwest client in KKTerm. object_store can only express a
    // single proxy URL, so the SOCKS5 endpoint is the one that is honored.
    if let Some(endpoint) = proxy::socks_endpoint() {
        client = client.with_proxy_url(endpoint);
    }
    client
}

fn build_s3_store(
    options: &CloudStorageOptions,
    user: &str,
    secret: &str,
) -> Result<Arc<dyn ObjectStore>, String> {
    let bucket = options
        .bucket
        .clone()
        .ok_or_else(|| "bucket is required for an S3 connection".to_string())?;
    let mut builder = AmazonS3Builder::new()
        .with_bucket_name(bucket)
        .with_region(
            options
                .region
                .clone()
                .unwrap_or_else(|| "us-east-1".to_string()),
        )
        .with_client_options(client_options(options))
        .with_virtual_hosted_style_request(!options.force_path_style);
    if let Some(endpoint) = options.endpoint.as_deref() {
        builder = builder.with_endpoint(endpoint.to_string());
    }
    if !user.is_empty() {
        builder = builder.with_access_key_id(user.to_string());
    }
    if !secret.is_empty() {
        builder = builder.with_secret_access_key(secret.to_string());
    }
    let store = builder
        .build()
        .map_err(|e| format!("failed to configure the S3 client: {e}"))?;
    Ok(Arc::new(store))
}

fn build_azure_store(
    options: &CloudStorageOptions,
    secret: &str,
) -> Result<Arc<dyn ObjectStore>, String> {
    let account = options
        .account
        .clone()
        .ok_or_else(|| "account name is required for an Azure Blob connection".to_string())?;
    let container = options
        .container
        .clone()
        .ok_or_else(|| "container is required for an Azure Blob connection".to_string())?;
    let mut builder = MicrosoftAzureBuilder::new()
        .with_account(account)
        .with_container_name(container)
        .with_client_options(client_options(options));
    if let Some(endpoint) = options.endpoint.as_deref() {
        builder = builder.with_endpoint(endpoint.to_string());
    }
    match options.effective_auth_mode() {
        AzureBlobAuthMode::Key => {
            if secret.is_empty() {
                return Err(
                    "an Azure Blob account key is required when the credential mode is account key"
                        .to_string(),
                );
            }
            builder = builder.with_access_key(secret.to_string());
        }
        AzureBlobAuthMode::Sas => {
            if secret.is_empty() {
                return Err(
                    "a SAS token is required when the credential mode is shared access signature"
                        .to_string(),
                );
            }
            builder = builder.with_sas_authorization(parse_sas_query(secret));
        }
    }
    let store = builder
        .build()
        .map_err(|e| format!("failed to configure the Azure Blob client: {e}"))?;
    Ok(Arc::new(store))
}

/// Splits a SAS token (already a query string such as
/// `sv=2022-11-02&ss=b&sig=...`) into the pairs `object_store` expects.
fn parse_sas_query(token: &str) -> Vec<(String, String)> {
    token
        .trim()
        .trim_start_matches('?')
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

// ------------------------------- dispatch -----------------------------------

/// Reads one directory from whichever provider backs the session.
fn read_cloud_directory(
    connection: &CloudStorageConnection,
    path: &str,
) -> Result<(Vec<CloudStorageDirectoryEntry>, String, bool), String> {
    connection.runtime.block_on(async {
        match &connection.transport {
            CloudStorageTransport::ObjectStore { store, provider } => {
                let cap = match provider {
                    CloudStorageProvider::AzureBlob => AZURE_LIST_PAGE_CAP,
                    _ => S3_LIST_PAGE_CAP,
                };
                let (entries, truncated) = object_store_list(store, path, cap).await?;
                Ok((entries, path.to_string(), truncated))
            }
        }
    })
}

async fn remote_target_exists(
    connection: &CloudStorageConnection,
    path: &str,
) -> Result<bool, String> {
    match &connection.transport {
        CloudStorageTransport::ObjectStore { store, .. } => {
            let key = object_key(path);
            match store.head(&ObjectPath::from(key.as_str())).await {
                Ok(_) => Ok(true),
                Err(object_store::Error::NotFound { .. }) => Ok(false),
                Err(error) => Err(format!("failed to check the destination: {error}")),
            }
        }
    }
}

async fn remote_is_folder(
    connection: &CloudStorageConnection,
    path: &str,
) -> Result<bool, String> {
    if path == "/" {
        return Ok(true);
    }
    match &connection.transport {
        CloudStorageTransport::ObjectStore { store, .. } => {
            let key = object_key(path);
            if store.head(&ObjectPath::from(key.as_str())).await.is_ok() {
                return Ok(false);
            }
            // A prefix is a folder when at least one object lives beneath it.
            let prefix = ObjectPath::from(format!("{key}/").as_str());
            let mut stream = store.list(Some(&prefix));
            Ok(stream.next().await.is_some())
        }
    }
}

/// Recursively downloads a folder by walking the provider's own listing.
async fn download_object_tree(
    connection: &CloudStorageConnection,
    remote_path: &str,
    destination: &Path,
    name: &str,
    cancel: &Arc<AtomicBool>,
    app: &AppHandle,
    transfer_id: &str,
) -> Result<u64, String> {
    tokio::fs::create_dir_all(destination)
        .await
        .map_err(|e| format!("failed to create {}: {e}", destination.display()))?;
    let (entries, _, _) = read_cloud_directory(connection, remote_path)?;
    let mut total = 0u64;
    for entry in entries {
        if cancel.load(Ordering::SeqCst) {
            return Err(TRANSFER_CANCELED.to_string());
        }
        let child_remote = join_remote_path(remote_path, &entry.name);
        let child_local = destination.join(&entry.name);
        if entry.kind == "folder" {
            total += Box::pin(download_object_tree(
                connection,
                &child_remote,
                &child_local,
                &entry.name,
                cancel,
                app,
                transfer_id,
            ))
            .await?;
            continue;
        }
        let bytes = connection.runtime.block_on(async {
            match &connection.transport {
                CloudStorageTransport::ObjectStore { store, .. } => {
                    object_store_download(store, &child_remote, &child_local, cancel, app, transfer_id)
                        .await
                }
            }
        })?;
        total += bytes;
    }
    let _ = name;
    Ok(total)
}

// ------------------------------ object stores -------------------------------

fn object_key(path: &str) -> String {
    normalize_remote_path(path)
        .trim_start_matches('/')
        .to_string()
}

fn object_store_error(error: object_store::Error) -> String {
    match &error {
        object_store::Error::NotFound { .. } => "not found".to_string(),
        object_store::Error::Unauthenticated { .. } => {
            "authentication failed - check the access key or secret".to_string()
        }
        object_store::Error::PermissionDenied { .. } => "permission denied".to_string(),
        _ => format!("object storage request failed: {error}"),
    }
}

fn path_from_key(key: &str) -> Result<ObjectPath, String> {
    if key.is_empty() {
        return Ok(ObjectPath::default());
    }
    ObjectPath::parse(key).map_err(|error| format!("invalid object key {key}: {error}"))
}

async fn object_store_list(
    store: &Arc<dyn ObjectStore>,
    path: &str,
    page_cap: usize,
) -> Result<(Vec<CloudStorageDirectoryEntry>, bool), String> {
    let key = object_key(path);
    let prefix = path_from_key(&key)?;
    let prefix = if key.is_empty() { None } else { Some(prefix) };
    let result = store
        .list_with_delimiter(prefix.as_ref())
        .await
        .map_err(object_store_error)?;

    let mut entries = Vec::with_capacity(result.objects.len() + result.common_prefixes.len());
    for child in &result.common_prefixes {
        let name = child
            .parts()
            .last()
            .map(|part| part.as_ref().to_string())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        entries.push(CloudStorageDirectoryEntry {
            name,
            kind: "folder".to_string(),
            size: None,
            modified: None,
        });
    }
    for object in &result.objects {
        let name = object
            .location
            .filename()
            .map(str::to_string)
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        entries.push(CloudStorageDirectoryEntry {
            name,
            kind: "file".to_string(),
            size: Some(object.size),
            modified: Some(object.last_modified.timestamp()),
        });
    }
    // Delimiter listings are paged by the provider; a full page means the
    // folder may hold more entries than are shown, so say so instead of
    // silently dropping them.
    let truncated = !result.common_prefixes.is_empty() && result.objects.len() >= page_cap;
    Ok((entries, truncated))
}

async fn object_store_properties(
    store: &Arc<dyn ObjectStore>,
    path: &str,
) -> Result<CloudStoragePathProperties, String> {
    let name = if path == "/" {
        "/".to_string()
    } else {
        remote_child_name(path)
    };
    let key = object_key(path);
    if key.is_empty() {
        return Ok(CloudStoragePathProperties {
            path: path.to_string(),
            name,
            kind: "folder".to_string(),
            size: None,
            modified: None,
            permissions: None,
            mode: None,
            user: None,
            group: None,
        });
    }
    match store.head(&path_from_key(&key)?).await {
        Ok(meta) => Ok(CloudStoragePathProperties {
            path: path.to_string(),
            name,
            kind: "file".to_string(),
            size: Some(meta.size),
            modified: Some(meta.last_modified.timestamp()),
            permissions: None,
            mode: meta.e_tag.clone(),
            user: None,
            group: None,
        }),
        Err(object_store::Error::NotFound { .. }) => {
            let prefix = ObjectPath::from(format!("{key}/").as_str());
            let mut stream = store.list(Some(&prefix));
            if stream.next().await.is_some() {
                Ok(CloudStoragePathProperties {
                    path: path.to_string(),
                    name,
                    kind: "folder".to_string(),
                    size: None,
                    modified: None,
                    permissions: None,
                    mode: None,
                    user: None,
                    group: None,
                })
            } else {
                Err(format!("not found: {path}"))
            }
        }
        Err(error) => Err(object_store_error(error)),
    }
}

async fn object_store_delete(store: &Arc<dyn ObjectStore>, path: &str) -> Result<(), String> {
    let key = object_key(path);
    if key.is_empty() {
        return Err("the storage root cannot be deleted".to_string());
    }
    // A single key deletes directly; a prefix is deleted breadth-first so a
    // folder removal cannot silently orphan children.
    if store.head(&path_from_key(&key)?).await.is_ok() {
        return store
            .delete(&path_from_key(&key)?)
            .await
            .map_err(object_store_error);
    }
    let prefix = ObjectPath::from(format!("{key}/").as_str());
    let mut stream = store.list(Some(&prefix));
    let mut victims: Vec<ObjectPath> = Vec::new();
    while let Some(item) = stream.next().await {
        let meta = item.map_err(object_store_error)?;
        victims.push(meta.location);
    }
    if victims.is_empty() {
        return Err(format!("not found: {path}"));
    }
    for victim in victims {
        store
            .delete(&victim)
            .await
            .map_err(object_store_error)?;
    }
    Ok(())
}

/// Object-store rename is a server-side copy followed by a delete. Folder
/// renames walk the prefix and copy every object beneath it.
async fn object_store_rename(
    store: &Arc<dyn ObjectStore>,
    from: &str,
    to: &str,
) -> Result<(), String> {
    let from_key = object_key(from);
    let to_key = object_key(to);
    if from_key.is_empty() || to_key.is_empty() {
        return Err("the storage root cannot be renamed".to_string());
    }
    if store.head(&path_from_key(&from_key)?).await.is_ok() {
        store
            .copy(&path_from_key(&from_key)?, &path_from_key(&to_key)?)
            .await
            .map_err(object_store_error)?;
        return Ok(());
    }
    let from_prefix = ObjectPath::from(format!("{from_key}/").as_str());
    let mut stream = store.list(Some(&from_prefix));
    let mut moves: Vec<(ObjectPath, ObjectPath)> = Vec::new();
    while let Some(item) = stream.next().await {
        let meta = item.map_err(object_store_error)?;
        let suffix = meta
            .location
            .as_ref()
            .strip_prefix(from_prefix.as_ref())
            .unwrap_or_default()
            .to_string();
        let target = path_from_key(&format!("{to_key}/{suffix}"))?;
        moves.push((meta.location.clone(), target));
    }
    if moves.is_empty() {
        return Err(format!("not found: {from}"));
    }
    for (source, target) in moves {
        store
            .copy(&source, &target)
            .await
            .map_err(object_store_error)?;
        store.delete(&source).await.map_err(object_store_error)?;
    }
    Ok(())
}

async fn object_store_upload(
    store: &Arc<dyn ObjectStore>,
    local_path: &Path,
    remote_path: &str,
    cancel: &Arc<AtomicBool>,
    app: &AppHandle,
    transfer_id: &str,
) -> Result<u64, String> {
    let key = object_key(remote_path);
    if key.is_empty() {
        return Err("a destination file name is required".to_string());
    }
    let meta = tokio::fs::metadata(local_path)
        .await
        .map_err(|e| format!("failed to read {}: {e}", local_path.display()))?;
    let total = meta.len();
    let file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("failed to open {}: {e}", local_path.display()))?;
    let mut reader = tokio::io::BufReader::new(file);
    let mut writer = BufWriter::with_capacity(store.clone(), path_from_key(&key)?, UPLOAD_BUFFER_BYTES);
    let mut buffer = vec![0u8; TRANSFER_CHUNK_SIZE];
    let mut written = 0u64;
    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|e| format!("failed to read {}: {e}", local_path.display()))?;
        if read == 0 {
            break;
        }
        if cancel.load(Ordering::SeqCst) {
            let _ = writer.abort().await;
            return Err(TRANSFER_CANCELED.to_string());
        }
        writer
            .put(Bytes::copy_from_slice(&buffer[..read]))
            .await
            .map_err(|e| format!("object storage upload failed: {e}"))?;
        written += read as u64;
        emit_progress(app, transfer_id, written, total);
    }
    if cancel.load(Ordering::SeqCst) {
        let _ = writer.abort().await;
        return Err(TRANSFER_CANCELED.to_string());
    }
    // Flushing a BufWriter either issues a single PUT or completes the
    // multipart upload, so a cancellation past this point would leave a
    // partially-committed object; abort instead of racing the commit.
    writer
        .shutdown()
        .await
        .map_err(|e| format!("object storage upload failed: {e}"))?;
    emit_progress(app, transfer_id, total, total);
    Ok(total)
}

async fn object_store_download(
    store: &Arc<dyn ObjectStore>,
    remote_path: &str,
    destination: &Path,
    cancel: &Arc<AtomicBool>,
    app: &AppHandle,
    transfer_id: &str,
) -> Result<u64, String> {
    let key = object_key(remote_path);
    let result = store
        .get(&path_from_key(&key)?)
        .await
        .map_err(object_store_error)?;
    let total = result.meta.size;
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|e| format!("failed to create {}: {e}", destination.display()))?;
    let mut stream = result.into_stream();
    let mut written = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(object_store_error)?;
        if cancel.load(Ordering::SeqCst) {
            drop(file);
            let _ = tokio::fs::remove_file(destination).await;
            return Err(TRANSFER_CANCELED.to_string());
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("failed to write {}: {e}", destination.display()))?;
        written += chunk.len() as u64;
        emit_progress(app, transfer_id, written, total);
    }
    file.flush()
        .await
        .map_err(|e| format!("failed to flush {}: {e}", destination.display()))?;
    Ok(written)
}

// --------------------------------- helpers ----------------------------------

fn make_session_id(title: &str) -> String {
    let slug: String = title
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() {
                value.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    if slug.is_empty() {
        format!("cloud-{suffix}")
    } else {
        format!("cloud-{slug}-{suffix}")
    }
}

/// Canonicalizes a remote browser path to an absolute POSIX-style path with no
/// trailing slash, no empty segments, and no `.`/`..` segments.
fn normalize_remote_path(path: &str) -> String {
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.trim().split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            continue;
        }
        segments.push(segment);
    }
    if segments.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", segments.join("/"))
    }
}

fn remote_child_name(path: &str) -> String {
    normalize_remote_path(path)
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string()
}

fn remote_parent_path(path: &str) -> String {
    let normalized = normalize_remote_path(path);
    match normalized.rsplit_once('/') {
        Some((parent, _)) if !parent.is_empty() => parent.to_string(),
        _ => "/".to_string(),
    }
}

fn join_remote_path(parent: &str, name: &str) -> String {
    let parent = normalize_remote_path(parent);
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{parent}/{name}")
    }
}

/// Rejects names that would escape the current container or name nothing.
fn validate_remote_child_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("a name is required".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("that name is not allowed".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("names cannot contain path separators".to_string());
    }
    Ok(trimmed.to_string())
}

fn emit_progress(app: &AppHandle, transfer_id: &str, transferred: u64, total: u64) {
    let progress = if total == 0 {
        100
    } else {
        ((transferred as u128 * 100) / total as u128).min(100) as u8
    };
    let _ = app.emit(
        PROGRESS_EVENT,
        CloudStorageTransferProgress {
            transfer_id: transfer_id.to_string(),
            transferred_bytes: transferred,
            total_bytes: total,
            progress,
        },
    );
}

fn transfer_result_for(local_path: &Path) -> Result<CloudStorageTransferResult, String> {
    let name = local_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "the selected file has no name".to_string())?;
    let size = std::fs::metadata(local_path)
        .map(|meta| meta.len())
        .unwrap_or_default();
    Ok(CloudStorageTransferResult {
        name,
        files: 1,
        folders: 0,
        bytes: size,
    })
}

// ---------------------------------- tests -----------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_options_normalize_to_none_for_other_connection_types() {
        let options = Some(CloudStorageOptions::default());
        assert!(normalize_cloud_storage_options(options, "ftp")
            .expect("ftp connections never persist cloud options")
            .is_none());
    }

    #[test]
    fn s3_normalization_strips_foreign_provider_fields() {
        let options = CloudStorageOptions {
            provider: CloudStorageProvider::S3,
            bucket: Some("  media  ".to_string()),
            region: Some("   ".to_string()),
            account: Some("account".to_string()),
            container: Some("container".to_string()),
            auth_mode: Some(AzureBlobAuthMode::Sas),
            ..CloudStorageOptions::default()
        };
        let normalized = normalize_cloud_storage_options(Some(options), "cloudStorage")
            .expect("s3 options normalize")
            .expect("cloudStorage keeps options");
        assert_eq!(normalized.bucket.as_deref(), Some("media"));
        // A blank region falls back to the AWS default rather than persisting "".
        assert_eq!(normalized.region.as_deref(), Some("us-east-1"));
        // Every non-S3 field is cleared so a provider switch in the edit
        // dialog cannot leave contradictory parameters behind.
        assert!(normalized.account.is_none());
        assert!(normalized.container.is_none());
        assert!(normalized.auth_mode.is_none());
    }

    #[test]
    fn s3_requires_a_bucket() {
        let options = CloudStorageOptions {
            provider: CloudStorageProvider::S3,
            bucket: None,
            ..CloudStorageOptions::default()
        };
        let error = normalize_cloud_storage_options(Some(options), "cloudStorage")
            .expect_err("a bucket is required");
        assert!(error.contains("bucket is required"), "unexpected: {error}");
    }

    #[test]
    fn azure_normalization_requires_account_and_container() {
        let missing = CloudStorageOptions {
            provider: CloudStorageProvider::AzureBlob,
            account: Some("storage".to_string()),
            container: Some("   ".to_string()),
            ..CloudStorageOptions::default()
        };
        let error = normalize_cloud_storage_options(Some(missing), "cloudStorage")
            .expect_err("a container is required");
        assert!(error.contains("container is required"), "unexpected: {error}");
    }

    #[test]
    fn remote_paths_normalize_without_traversal_or_trailing_slashes() {
        assert_eq!(normalize_remote_path(""), "/");
        assert_eq!(normalize_remote_path("/"), "/");
        assert_eq!(normalize_remote_path("//logs//2026//"), "/logs/2026");
        assert_eq!(normalize_remote_path(".."), "/");
        assert_eq!(normalize_remote_path("/a/./b/../c"), "/a/b/c");
        assert_eq!(normalize_remote_path("/bucket"), "/bucket");
    }

    #[test]
    fn remote_path_helpers_round_trip() {
        assert_eq!(remote_child_name("/logs/2026/app.log"), "app.log");
        assert_eq!(remote_parent_path("/logs/2026/app.log"), "/logs/2026");
        assert_eq!(remote_parent_path("/logs"), "/");
        assert_eq!(join_remote_path("/", "logs"), "/logs");
        assert_eq!(join_remote_path("/logs", "app.log"), "/logs/app.log");
    }

    #[test]
    fn child_names_reject_separators_and_empty_values() {
        assert!(validate_remote_child_name("").is_err());
        assert!(validate_remote_child_name("  ").is_err());
        assert!(validate_remote_child_name("..").is_err());
        assert!(validate_remote_child_name("a/b").is_err());
        assert!(validate_remote_child_name("a\\b").is_err());
        assert_eq!(
            validate_remote_child_name(" report.csv ").expect("trimmed name"),
            "report.csv"
        );
    }

    #[test]
    fn object_keys_are_relative_and_segment_safe() {
        assert_eq!(object_key("/"), "");
        assert_eq!(object_key("/logs/2026"), "logs/2026");
        assert_eq!(object_key("logs//2026/"), "logs/2026");
    }

    #[test]
    fn sas_tokens_split_into_query_pairs() {
        let pairs = parse_sas_query("?sv=2022-11-02&ss=b&sig=abc%3D");
        assert_eq!(pairs.len(), 3);
        assert_eq!(pairs[0], ("sv".to_string(), "2022-11-02".to_string()));
        assert_eq!(pairs[2], ("sig".to_string(), "abc%3D".to_string()));
    }
}

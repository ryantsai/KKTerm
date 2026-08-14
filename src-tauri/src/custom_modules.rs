use crate::{app_paths::AppPaths, secrets, storage::Storage, webview};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use regex::Regex;
use reqwest::blocking::Client;
use rusqlite::{OptionalExtension, params};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use url::Url;
use zip::ZipArchive;

const MANIFEST_FILE: &str = "kkterm-extension.json";
const HOST_API_VERSION: u32 = 2;
const MAX_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_UNCOMPRESSED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES: u64 = 128 * 1024 * 1024;
const STORAGE_QUOTA_BYTES: i64 = 10 * 1024 * 1024;
const MAX_STORAGE_KEYS: i64 = 10_000;
const MAX_BRIDGE_PAYLOAD_BYTES: usize = 11 * 1024 * 1024;
const DOCUMENT_STORAGE_QUOTA_BYTES: i64 = 512 * 1024 * 1024;
const MAX_DOCUMENT_BYTES: usize = 64 * 1024 * 1024;
const MAX_DOCUMENT_KEYS: i64 = 4_096;
const BLOB_STORAGE_QUOTA_BYTES: i64 = 1024 * 1024 * 1024;
const MAX_BLOB_BYTES: u64 = 256 * 1024 * 1024;
const MAX_BLOB_KEYS: i64 = 16_384;
const MAX_BLOB_CHUNK_BYTES: usize = 1024 * 1024;
const MAX_NETWORK_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_NETWORK_RESPONSE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DOCUMENT_BRIDGE_PAYLOAD_BYTES: usize = MAX_DOCUMENT_BYTES + 1024 * 1024;
const MAX_ACTIVITY_RAIL_ICON_BYTES: u64 = 64 * 1024;
const MAX_CATALOG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_CATALOG_VALIDITY_DAYS: i64 = 45;
const FIRST_PARTY_VERIFYING_KEY_HEX: &str = env!("KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY");
const ONLINE_CATALOG_URL: &str = env!("KKTERM_CUSTOM_MODULE_CATALOG_URL");
const CATALOG_JSON: &str = include_str!("../../custom-modules/catalog.v2.json");
const CATALOG_CACHE_FILE: &str = "catalog-cache.v2.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomModuleManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub publisher: String,
    #[serde(default)]
    pub summary: String,
    pub api_version: u32,
    #[serde(default)]
    pub homepage: Option<String>,
    pub license: CustomModuleLicense,
    #[serde(default)]
    pub permissions: CustomModulePermissions,
    pub modules: Vec<CustomModuleContribution>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomModuleLicense {
    pub name: String,
    pub file: String,
    #[serde(default)]
    pub notices_file: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomModuleContribution {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub icon: Option<String>,
    pub entrypoint: String,
    #[serde(default = "default_true")]
    pub rail_visible: bool,
    #[serde(default)]
    pub routing: CustomModuleRouting,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CustomModuleRouting {
    #[default]
    Static,
    Spa,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct CustomModulePermissions {
    pub storage: bool,
    pub document_storage: bool,
    pub blob_storage: bool,
    pub browser_storage: bool,
    pub open_external: bool,
    pub clipboard: bool,
    pub files: Option<CustomModuleFilePermission>,
    pub network_fetch: Option<CustomModuleNetworkPermission>,
    pub secret_references: bool,
    pub host_ui: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomModuleFilePermission {
    #[serde(default)]
    pub open: bool,
    #[serde(default)]
    pub save: bool,
    #[serde(default)]
    pub extensions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomModuleNetworkPermission {
    pub origins: Vec<String>,
    #[serde(default = "default_network_methods")]
    pub methods: Vec<String>,
    #[serde(default)]
    pub allow_private_network: bool,
    #[serde(default = "default_network_response_bytes")]
    pub max_response_bytes: u64,
}

impl CustomModulePermissions {
    fn enabled_names(&self) -> Vec<&'static str> {
        let mut names = Vec::new();
        for (enabled, name) in [
            (self.storage, "storage"),
            (self.document_storage, "documentStorage"),
            (self.blob_storage, "blobStorage"),
            (self.browser_storage, "browserStorage"),
            (self.open_external, "openExternal"),
            (self.clipboard, "clipboard"),
            (self.files.is_some(), "files"),
            (self.network_fetch.is_some(), "networkFetch"),
            (self.secret_references, "secretReferences"),
            (self.host_ui, "hostUi"),
        ] {
            if enabled {
                names.push(name);
            }
        }
        names
    }

    fn restricted_to(&self, grants: &HashSet<String>) -> Self {
        let granted = |name: &str| grants.contains(name);
        Self {
            storage: self.storage && granted("storage"),
            document_storage: self.document_storage && granted("documentStorage"),
            blob_storage: self.blob_storage && granted("blobStorage"),
            browser_storage: self.browser_storage && granted("browserStorage"),
            open_external: self.open_external && granted("openExternal"),
            clipboard: self.clipboard && granted("clipboard"),
            files: granted("files").then(|| self.files.clone()).flatten(),
            network_fetch: granted("networkFetch")
                .then(|| self.network_fetch.clone())
                .flatten(),
            secret_references: self.secret_references && granted("secretReferences"),
            host_ui: self.host_ui && granted("hostUi"),
        }
    }
}

fn default_network_methods() -> Vec<String> {
    vec!["GET".into()]
}

fn default_network_response_bytes() -> u64 {
    16 * 1024 * 1024
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledCustomModule {
    #[serde(flatten)]
    pub manifest: CustomModuleManifest,
    pub source: String,
    pub trust: String,
    pub enabled: bool,
    pub rail_visible: bool,
    pub sha256: String,
    pub previous_version: Option<String>,
    pub health: String,
    pub icon_data_urls: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub publisher: String,
    pub summary: String,
    pub api_version: u32,
    pub download_url: String,
    pub sha256: String,
    pub signature: String,
    pub license: String,
    #[serde(default)]
    pub permissions: CustomModulePermissions,
    pub download_size: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Catalog {
    schema_version: u32,
    modules: Vec<CatalogEntry>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignedCatalogEnvelope {
    schema_version: u32,
    key_id: String,
    payload: String,
    signature: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OnlineCatalogPayload {
    schema_version: u32,
    sequence: u64,
    generated_at: String,
    expires_at: String,
    modules: Vec<CatalogEntry>,
}

#[derive(Debug)]
struct VerifiedOnlineCatalog {
    payload: OnlineCatalogPayload,
    payload_sha256: String,
    expired: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageReview {
    pub manifest: CustomModuleManifest,
    pub sha256: String,
    pub archive_bytes: u64,
    pub expanded_bytes: u64,
    pub file_count: usize,
    pub signed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCustomModuleRequest {
    pub module_id: String,
    pub contribution_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub theme: String,
    pub locale: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomModuleBoundsRequest {
    pub session_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomModuleContextRequest {
    pub session_id: String,
    pub theme: String,
    pub locale: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomModuleBridgeRequest {
    pub operation: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveCustomModuleSecretPromptRequest {
    pub request_id: String,
    pub secret: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomModuleSessionStarted {
    pub session_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomModuleDataUsage {
    pub storage_bytes: u64,
    pub document_bytes: u64,
    pub blob_bytes: u64,
    pub browser_bytes: u64,
    pub secret_count: u64,
    pub total_bytes: u64,
}

#[derive(Clone)]
struct RuntimeSession {
    module_id: String,
    contribution_id: String,
    permissions: HashSet<String>,
    permission_config: CustomModulePermissions,
    theme: String,
    locale: String,
    ready_sent: Arc<AtomicBool>,
    last_external_open: Arc<Mutex<Option<Instant>>>,
    blob_writes: Arc<Mutex<HashMap<String, BlobWrite>>>,
    file_tokens: Arc<Mutex<HashMap<String, FileToken>>>,
    view_state: Arc<Mutex<RuntimeViewState>>,
    window: WebviewWindow,
    host_window: WebviewWindow,
}

struct BlobWrite {
    key: String,
    mime_type: String,
    path: PathBuf,
    file: File,
    byte_size: u64,
}

enum FileToken {
    Read {
        path: PathBuf,
        byte_size: u64,
    },
    Write {
        target: PathBuf,
        temporary: PathBuf,
        file: File,
        byte_size: u64,
    },
}

#[derive(Clone, Copy)]
struct RuntimeBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

struct RuntimeViewState {
    bounds: RuntimeBounds,
    visible: bool,
}

#[derive(Clone)]
struct ModuleRoute {
    root: PathBuf,
    entrypoint: String,
    routing: CustomModuleRouting,
    origin_host: String,
    clipboard_allowed: bool,
}

#[derive(Default)]
pub struct CustomModuleRuntime {
    sessions: Mutex<HashMap<String, RuntimeSession>>,
    routes: Mutex<HashMap<String, ModuleRoute>>,
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
    secret_prompts: Mutex<HashMap<String, PendingSecretPrompt>>,
}

struct PendingSecretPrompt {
    session_id: String,
    module_id: String,
    key: String,
    completion: tokio::sync::oneshot::Sender<bool>,
}

impl CustomModuleRuntime {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, RuntimeSession>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "Custom Module runtime lock is poisoned".to_string())
    }

    fn session(&self, label: &str) -> Result<RuntimeSession, String> {
        self.lock()?
            .get(label)
            .cloned()
            .ok_or_else(|| "Custom Module session is not registered".to_string())
    }

    fn lock_routes(&self) -> Result<MutexGuard<'_, HashMap<String, ModuleRoute>>, String> {
        self.routes
            .lock()
            .map_err(|_| "Custom Module route lock is poisoned".to_string())
    }

    fn lock_downloads(&self) -> Result<MutexGuard<'_, HashMap<String, Arc<AtomicBool>>>, String> {
        self.downloads
            .lock()
            .map_err(|_| "Custom Module download lock is poisoned".to_string())
    }

    fn lock_secret_prompts(
        &self,
    ) -> Result<MutexGuard<'_, HashMap<String, PendingSecretPrompt>>, String> {
        self.secret_prompts
            .lock()
            .map_err(|_| "Custom Module secret-prompt lock is poisoned".to_string())
    }
}

fn default_true() -> bool {
    true
}

fn modules_root(paths: &AppPaths) -> PathBuf {
    paths.data_dir().join("custom-modules")
}

fn package_storage_root(paths: &AppPaths) -> PathBuf {
    modules_root(paths).join("packages")
}

fn staging_root(paths: &AppPaths) -> PathBuf {
    modules_root(paths).join("staging")
}

fn downloads_root(paths: &AppPaths) -> PathBuf {
    modules_root(paths).join("downloads")
}

fn webview_data_root(paths: &AppPaths) -> PathBuf {
    modules_root(paths).join("webview-data")
}

fn document_storage_root(paths: &AppPaths) -> PathBuf {
    modules_root(paths).join("documents")
}

fn blob_storage_root(paths: &AppPaths) -> PathBuf {
    modules_root(paths).join("blobs")
}

fn package_relative_path(module_id: &str, version: &str) -> PathBuf {
    PathBuf::from("packages").join(module_id).join(version)
}

fn canonical_package_root(paths: &AppPaths, package_root: &Path) -> Result<PathBuf, String> {
    let packages_root = fs::canonicalize(package_storage_root(paths))
        .map_err(|error| format!("failed to resolve Custom Module packages directory: {error}"))?;
    let canonical_root = fs::canonicalize(package_root)
        .map_err(|error| format!("failed to resolve Custom Module package root: {error}"))?;
    if !canonical_root.starts_with(&packages_root) {
        return Err("Custom Module package root escapes the packages directory".into());
    }
    Ok(canonical_root)
}

fn remove_owned_directory(base: &Path, target: &Path, label: &str) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("failed to inspect {label}: {error}")),
    };
    if metadata.file_type().is_symlink() {
        return fs::remove_dir(target)
            .or_else(|_| fs::remove_file(target))
            .map_err(|error| format!("failed to remove {label} link: {error}"));
    }
    let canonical_base = fs::canonicalize(base)
        .map_err(|error| format!("failed to resolve {label} parent: {error}"))?;
    let canonical_target =
        fs::canonicalize(target).map_err(|error| format!("failed to resolve {label}: {error}"))?;
    if canonical_target == canonical_base || !canonical_target.starts_with(&canonical_base) {
        return Err(format!(
            "refused to remove {label} outside its owned directory"
        ));
    }
    fs::remove_dir_all(target).map_err(|error| format!("failed to remove {label}: {error}"))
}

fn owned_directory_size(base: &Path, target: &Path) -> Result<u64, String> {
    let metadata = match fs::symlink_metadata(target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Custom Module data directory is not an owned regular directory".into());
    }
    let canonical_base = fs::canonicalize(base).map_err(|error| error.to_string())?;
    let canonical_target = fs::canonicalize(target).map_err(|error| error.to_string())?;
    if !canonical_target.starts_with(&canonical_base) {
        return Err("Custom Module data directory escapes its owned root".into());
    }
    let mut total = 0_u64;
    let mut pending = vec![canonical_target];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                return Err("Custom Module data directory contains a symbolic link".into());
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
    }
    Ok(total)
}

fn validate_identifier(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b".-".contains(&byte))
        || !value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase())
    {
        return Err(format!(
            "{field} must start with a lowercase letter and contain only lowercase letters, digits, dots, and hyphens"
        ));
    }
    Ok(())
}

fn validate_relative_path(value: &str, field: &str) -> Result<PathBuf, String> {
    if value.trim().is_empty()
        || value.len() > 240
        || value.contains('\\')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"/._-@".contains(&byte))
    {
        return Err(format!(
            "{field} must be a non-empty portable relative path"
        ));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || path.components().any(|component| match component {
            Component::Normal(value) => {
                let value = value.to_string_lossy();
                if value.ends_with('.') {
                    return true;
                }
                let stem = value
                    .trim_end_matches([' ', '.'])
                    .split('.')
                    .next()
                    .unwrap_or_default()
                    .to_ascii_uppercase();
                matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                    || stem
                        .strip_prefix("COM")
                        .or_else(|| stem.strip_prefix("LPT"))
                        .is_some_and(|number| {
                            number.len() == 1
                                && number.as_bytes()[0].is_ascii_digit()
                                && number != "0"
                        })
            }
            _ => false,
        })
    {
        return Err(format!("{field} contains an unsafe path"));
    }
    Ok(path.to_path_buf())
}

fn validate_manifest(manifest: &CustomModuleManifest) -> Result<(), String> {
    validate_identifier(&manifest.id, "manifest id")?;
    if manifest.version.len() > 64 {
        return Err("manifest version is too long".into());
    }
    Version::parse(&manifest.version)
        .map_err(|error| format!("manifest version is invalid: {error}"))?;
    if manifest.api_version != HOST_API_VERSION {
        return Err(format!(
            "module requires host API {}, but this KKTerm supports API {HOST_API_VERSION}",
            manifest.api_version
        ));
    }
    if manifest.name.trim().is_empty()
        || manifest.name.len() > 128
        || manifest.publisher.trim().is_empty()
        || manifest.publisher.len() > 256
        || manifest.summary.len() > 2_048
    {
        return Err("module name and publisher are required".into());
    }
    if manifest.license.name.trim().is_empty() || manifest.license.name.len() > 128 {
        return Err("module license name is required".into());
    }
    validate_relative_path(&manifest.license.file, "license file")?;
    if let Some(path) = manifest.license.notices_file.as_deref() {
        validate_relative_path(path, "notices file")?;
    }
    validate_permissions(&manifest.permissions)?;
    if manifest.modules.is_empty() || manifest.modules.len() > 64 {
        return Err("manifest must contribute between 1 and 64 Modules".into());
    }
    let mut contribution_ids = HashSet::new();
    for contribution in &manifest.modules {
        validate_identifier(&contribution.id, "Module contribution id")?;
        if !contribution_ids.insert(contribution.id.as_str()) {
            return Err(format!(
                "duplicate Module contribution id '{}'",
                contribution.id
            ));
        }
        if contribution.title.trim().is_empty() || contribution.title.len() > 128 {
            return Err("Module contribution title is required".into());
        }
        let entrypoint = validate_relative_path(&contribution.entrypoint, "entrypoint")?;
        if !entrypoint.starts_with("dist")
            || entrypoint.extension().and_then(|value| value.to_str()) != Some("html")
        {
            return Err("Module entrypoints must be HTML files below dist/".into());
        }
        if let Some(icon) = contribution.icon.as_deref() {
            let icon = validate_relative_path(icon, "Module icon")?;
            if !icon.starts_with("dist") {
                return Err("Module icons must be below dist/".into());
            }
        }
    }
    if let Some(homepage) = manifest.homepage.as_deref() {
        let url = Url::parse(homepage).map_err(|error| format!("invalid homepage URL: {error}"))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("module homepage must use HTTP or HTTPS".into());
        }
    }
    Ok(())
}

fn validate_permissions(permissions: &CustomModulePermissions) -> Result<(), String> {
    if let Some(files) = &permissions.files {
        if !files.open && !files.save {
            return Err("files permission must enable open, save, or both".into());
        }
        if files.extensions.len() > 128 {
            return Err("files permission declares too many extensions".into());
        }
        let mut extensions = HashSet::new();
        for extension in &files.extensions {
            if extension.is_empty()
                || extension.len() > 32
                || !extension
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            {
                return Err(format!(
                    "invalid Custom Module file extension '{extension}'"
                ));
            }
            if !extensions.insert(extension) {
                return Err(format!(
                    "duplicate Custom Module file extension '{extension}'"
                ));
            }
        }
    }
    if let Some(network) = &permissions.network_fetch {
        if network.origins.is_empty() || network.origins.len() > 64 {
            return Err("networkFetch must declare between 1 and 64 origins".into());
        }
        if network.methods.is_empty() || network.methods.len() > 8 {
            return Err("networkFetch must declare between 1 and 8 methods".into());
        }
        let mut origins = HashSet::new();
        for origin in &network.origins {
            let url = Url::parse(origin)
                .map_err(|error| format!("invalid networkFetch origin '{origin}': {error}"))?;
            let scheme_allowed = url.scheme() == "https"
                || (url.scheme() == "http" && network.allow_private_network);
            if !scheme_allowed
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.path() != "/"
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(format!(
                    "networkFetch origin must be an exact HTTPS origin without credentials, path, query, or fragment: '{origin}'"
                ));
            }
            let canonical = url.origin().ascii_serialization();
            if canonical != *origin || !origins.insert(canonical) {
                return Err(format!(
                    "networkFetch origin must be canonical and unique: '{origin}'"
                ));
            }
        }
        let mut methods = HashSet::new();
        for method in &network.methods {
            if !matches!(method.as_str(), "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE") {
                return Err(format!("unsupported networkFetch method '{method}'"));
            }
            if !methods.insert(method) {
                return Err(format!("duplicate networkFetch method '{method}'"));
            }
        }
        if !(1..=64 * 1024 * 1024).contains(&network.max_response_bytes) {
            return Err("networkFetch maxResponseBytes must be between 1 byte and 64 MiB".into());
        }
    }
    Ok(())
}

fn is_forbidden_payload(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "exe"
                    | "dll"
                    | "so"
                    | "dylib"
                    | "bat"
                    | "cmd"
                    | "com"
                    | "ps1"
                    | "sh"
                    | "app"
                    | "msi"
                    | "jar"
            )
        })
}

fn is_allowed_payload(path: &Path) -> bool {
    if path == Path::new(MANIFEST_FILE) {
        return true;
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if path.starts_with("licenses") {
        return extension
            .as_deref()
            .is_none_or(|value| matches!(value, "txt" | "md" | "html"));
    }
    if !path.starts_with("dist") {
        return false;
    }
    extension.as_deref().is_some_and(|value| {
        matches!(
            value,
            "html"
                | "css"
                | "js"
                | "mjs"
                | "json"
                | "map"
                | "wasm"
                | "svg"
                | "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "avif"
                | "ico"
                | "woff"
                | "woff2"
                | "ttf"
                | "otf"
                | "txt"
                | "md"
                | "xml"
                | "webmanifest"
                | "gz"
                | "bcmap"
                | "pfb"
                | "ftl"
                | "icc"
                | "whl"
                | "zip"
        )
    })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("failed to open package {}: {error}", path.display()))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("failed to inspect package {}: {error}", path.display()))?;
    if metadata.len() == 0 || metadata.len() > MAX_ARCHIVE_BYTES {
        return Err("Custom Module package is empty or exceeds the 1 GiB limit".into());
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("failed to read package: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(encode_hex(&hasher.finalize()))
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn inspect_archive(path: &Path) -> Result<PackageReview, String> {
    let sha256 = sha256_file(path)?;
    let archive_bytes = fs::metadata(path).map_err(|error| error.to_string())?.len();
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("Custom Module package is not a valid ZIP archive: {error}"))?;
    if archive.len() == 0 || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("Custom Module package has an invalid number of entries".into());
    }

    let mut seen = HashSet::new();
    let mut seen_exact = HashSet::new();
    let mut expanded_bytes = 0_u64;
    let mut file_count = 0_usize;
    let mut manifest_bytes = None;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("failed to inspect package entry: {error}"))?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Custom Module packages cannot contain symbolic links".into());
        }
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "Custom Module package contains an unsafe path".to_string())?;
        let portable = relative
            .to_str()
            .ok_or_else(|| "Custom Module package paths must be UTF-8".to_string())?
            .replace('\\', "/");
        validate_relative_path(portable.trim_end_matches('/'), "package entry")?;
        if !seen.insert(portable.to_ascii_lowercase()) {
            return Err(format!("package contains a duplicate path: {portable}"));
        }
        seen_exact.insert(portable.clone());
        if entry.is_dir() {
            if !relative.starts_with("dist") && !relative.starts_with("licenses") {
                return Err(format!(
                    "package contains an unsupported directory: {portable}"
                ));
            }
            continue;
        }
        file_count += 1;
        if entry.size() > MAX_SINGLE_FILE_BYTES {
            return Err(format!("package entry is too large: {portable}"));
        }
        if entry.compressed_size() > 0 && entry.size() / entry.compressed_size().max(1) > 1_000 {
            return Err(format!(
                "package entry has an unsafe compression ratio: {portable}"
            ));
        }
        expanded_bytes = expanded_bytes
            .checked_add(entry.size())
            .ok_or_else(|| "Custom Module expanded size overflowed".to_string())?;
        if expanded_bytes > MAX_UNCOMPRESSED_BYTES {
            return Err("Custom Module package expands beyond the 1 GiB limit".into());
        }
        if is_forbidden_payload(&relative) {
            return Err(format!(
                "package contains a forbidden executable payload: {portable}"
            ));
        }
        if !is_allowed_payload(&relative) {
            return Err(format!(
                "package contains an unsupported payload type: {portable}"
            ));
        }
        if portable == MANIFEST_FILE {
            if entry.size() > 1024 * 1024 {
                return Err("Custom Module manifest exceeds 1 MiB".into());
            }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut bytes)
                .map_err(|error| format!("failed to read Custom Module manifest: {error}"))?;
            manifest_bytes = Some(bytes);
        }
    }
    let manifest_bytes = manifest_bytes
        .ok_or_else(|| format!("Custom Module package is missing root {MANIFEST_FILE}"))?;
    let manifest: CustomModuleManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("Custom Module manifest is invalid: {error}"))?;
    validate_manifest(&manifest)?;
    for required in std::iter::once(manifest.license.file.as_str())
        .chain(manifest.license.notices_file.as_deref())
        .chain(
            manifest
                .modules
                .iter()
                .map(|module| module.entrypoint.as_str()),
        )
        .chain(
            manifest
                .modules
                .iter()
                .filter_map(|module| module.icon.as_deref()),
        )
    {
        if !seen_exact.contains(required) {
            return Err(format!(
                "Custom Module package is missing required file {required}"
            ));
        }
    }
    Ok(PackageReview {
        manifest,
        sha256,
        archive_bytes,
        expanded_bytes,
        file_count,
        signed: false,
    })
}

fn extract_archive(path: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "Custom Module staging path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "failed to create Custom Module staging parent {}: {error}",
            parent.display()
        )
    })?;
    fs::create_dir(destination).map_err(|error| {
        format!(
            "failed to create Custom Module staging directory {}: {error}",
            destination.display()
        )
    })?;
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "Custom Module package contains an unsafe path".to_string())?;
        let output_path = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = File::create(&output_path).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn install_package(
    storage: &Storage,
    paths: &AppPaths,
    package_path: &Path,
    source: &str,
    trust: &str,
    expected_sha256: Option<&str>,
    catalog_metadata: Option<&CatalogEntry>,
) -> Result<InstalledCustomModule, String> {
    let review = inspect_archive(package_path)?;
    if expected_sha256.is_some_and(|expected| !expected.eq_ignore_ascii_case(&review.sha256)) {
        return Err(
            "Custom Module checksum changed after review or does not match catalog metadata".into(),
        );
    }
    if let Some(expected_metadata) = catalog_metadata {
        if review.manifest.id != expected_metadata.id
            || review.manifest.version != expected_metadata.version
            || review.manifest.name != expected_metadata.name
            || review.manifest.publisher != expected_metadata.publisher
            || review.manifest.api_version != expected_metadata.api_version
            || review.manifest.permissions != expected_metadata.permissions
            || review.manifest.license.name != expected_metadata.license
        {
            return Err("downloaded Custom Module identity, permissions, or license do not match catalog metadata".into());
        }
    }
    let root = modules_root(paths);
    let staging = staging_root(paths).join(format!(
        "{}-{}-{:016x}",
        review.manifest.id,
        review.manifest.version,
        rand::random::<u64>()
    ));
    let relative_path = package_relative_path(&review.manifest.id, &review.manifest.version);
    let destination = root.join(&relative_path);
    if destination.exists() {
        return Err(format!(
            "Custom Module {} version {} is already installed",
            review.manifest.name, review.manifest.version
        ));
    }
    if let Err(error) = extract_archive(package_path, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(&staging, &destination).map_err(|error| {
        let _ = fs::remove_dir_all(&staging);
        format!("failed to activate Custom Module package: {error}")
    })?;

    let manifest_json =
        serde_json::to_string(&review.manifest).map_err(|error| error.to_string())?;
    let install_result = storage.with_connection_mut(|connection| {
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        let previous: Option<String> = transaction
            .query_row(
                "SELECT active_version FROM custom_modules WHERE id = ?1",
                [&review.manifest.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let sort_order: i64 = transaction
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM custom_modules",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO custom_modules (
                    id, manifest_json, active_version, previous_version, source, trust,
                    installed, enabled, rail_visible, sort_order, sha256, installed_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, ?7, ?8, ?9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 ON CONFLICT(id) DO UPDATE SET
                    manifest_json = excluded.manifest_json,
                    previous_version = CASE
                        WHEN custom_modules.installed = 0 THEN NULL
                        WHEN custom_modules.active_version = excluded.active_version
                            THEN custom_modules.previous_version
                        ELSE custom_modules.active_version
                    END,
                    active_version = excluded.active_version,
                    source = excluded.source,
                    trust = excluded.trust,
                    enabled = CASE
                        WHEN custom_modules.installed = 0 THEN 1
                        ELSE custom_modules.enabled
                    END,
                    rail_visible = CASE
                        WHEN custom_modules.installed = 0 THEN excluded.rail_visible
                        ELSE custom_modules.rail_visible
                    END,
                    installed = 1,
                    sha256 = excluded.sha256,
                    installed_at = CASE
                        WHEN custom_modules.installed = 0 THEN CURRENT_TIMESTAMP
                        ELSE custom_modules.installed_at
                    END,
                    updated_at = CURRENT_TIMESTAMP",
                params![
                    review.manifest.id,
                    manifest_json,
                    review.manifest.version,
                    previous,
                    source,
                    trust,
                    review.manifest.modules.iter().any(|module| module.rail_visible),
                    sort_order,
                    review.sha256,
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO custom_module_versions (module_id, version, relative_path, sha256)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(module_id, version) DO UPDATE SET
                    relative_path = excluded.relative_path,
                    sha256 = excluded.sha256,
                    installed_at = CURRENT_TIMESTAMP",
                params![
                    review.manifest.id,
                    review.manifest.version,
                    relative_path.to_string_lossy(),
                    review.sha256,
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM custom_module_permissions WHERE module_id = ?1",
                [&review.manifest.id],
            )
            .map_err(|error| error.to_string())?;
        for permission in review.manifest.permissions.enabled_names() {
            transaction
                .execute(
                    "INSERT INTO custom_module_permissions (module_id, permission) VALUES (?1, ?2)",
                    params![review.manifest.id, permission],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    });
    if let Err(error) = install_result {
        let _ = fs::remove_dir_all(&destination);
        return Err(format!(
            "failed to record Custom Module installation: {error}"
        ));
    }
    let obsolete_paths = storage.with_connection(|connection| {
        let retained_previous: Option<String> = connection
            .query_row(
                "SELECT previous_version FROM custom_modules WHERE id = ?1",
                [&review.manifest.id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare("SELECT version FROM custom_module_versions WHERE module_id = ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([&review.manifest.id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let obsolete = rows
            .into_iter()
            .filter(|version| {
                version != &review.manifest.version
                    && retained_previous.as_deref() != Some(version.as_str())
            })
            .collect::<Vec<_>>();
        for version in &obsolete {
            if version.len() > 64 || Version::parse(version).is_err() {
                return Err("stored Custom Module version is invalid".into());
            }
            connection
                .execute(
                    "DELETE FROM custom_module_versions WHERE module_id = ?1 AND version = ?2",
                    params![review.manifest.id, version],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(obsolete
            .into_iter()
            .map(|version| package_relative_path(&review.manifest.id, &version))
            .collect::<Vec<_>>())
    })?;
    for obsolete in obsolete_paths {
        let _ = remove_owned_directory(
            &package_storage_root(paths),
            &root.join(obsolete),
            "obsolete Custom Module version",
        );
    }
    installed_module(storage, paths, &review.manifest.id)?.ok_or_else(|| {
        "Custom Module was installed but its metadata could not be reloaded".to_string()
    })
}

fn installed_module(
    storage: &Storage,
    paths: &AppPaths,
    module_id: &str,
) -> Result<Option<InstalledCustomModule>, String> {
    storage.with_connection(|connection| {
        connection
            .query_row(
                "SELECT manifest_json, active_version, source, trust, enabled, rail_visible, sha256, previous_version
                 FROM custom_modules WHERE id = ?1 AND installed = 1",
                [module_id],
                |row| {
                    let manifest_json: String = row.get(0)?;
                    Ok((
                        manifest_json,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, bool>(4)?,
                        row.get::<_, bool>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, Option<String>>(7)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .map(|(
                manifest_json,
                active_version,
                source,
                trust,
                enabled,
                rail_visible,
                sha256,
                previous_version,
            )| {
                let manifest: CustomModuleManifest =
                    serde_json::from_str(&manifest_json).map_err(|error| error.to_string())?;
                validate_manifest(&manifest)?;
                if manifest.id != module_id || manifest.version != active_version {
                    return Err("Custom Module manifest identity does not match its metadata".into());
                }
                let package_path = modules_root(paths)
                    .join(package_relative_path(&manifest.id, &manifest.version));
                let icon_data_urls = activity_rail_icon_data_urls(paths, &package_path, &manifest);
                Ok(InstalledCustomModule {
                    manifest,
                    source,
                    trust,
                    enabled,
                    rail_visible,
                    sha256,
                    previous_version,
                    health: if package_path.is_dir() { "ready" } else { "missing" }.into(),
                    icon_data_urls,
                })
            })
            .transpose()
    })
}

fn activity_rail_icon_data_urls(
    paths: &AppPaths,
    package_path: &Path,
    manifest: &CustomModuleManifest,
) -> BTreeMap<String, String> {
    let Ok(canonical_root) = canonical_package_root(paths, package_path) else {
        return BTreeMap::new();
    };
    manifest
        .modules
        .iter()
        .filter_map(|contribution| {
            let relative = contribution.icon.as_deref()?;
            if Path::new(relative)
                .extension()
                .and_then(|extension| extension.to_str())
                .is_none_or(|extension| !extension.eq_ignore_ascii_case("svg"))
            {
                return None;
            }
            let path = fs::canonicalize(package_path.join(relative)).ok()?;
            if !path.starts_with(&canonical_root) {
                return None;
            }
            let metadata = path.metadata().ok()?;
            if !metadata.is_file()
                || metadata.len() == 0
                || metadata.len() > MAX_ACTIVITY_RAIL_ICON_BYTES
            {
                return None;
            }
            let bytes = fs::read(path).ok()?;
            if !is_inert_activity_rail_svg(&bytes) {
                return None;
            }
            Some((
                contribution.id.clone(),
                format!("data:image/svg+xml;base64,{}", BASE64.encode(bytes)),
            ))
        })
        .collect()
}

fn is_inert_activity_rail_svg(bytes: &[u8]) -> bool {
    static SVG_ROOT: OnceLock<Regex> = OnceLock::new();
    static FORBIDDEN_SVG_CONTENT: OnceLock<Regex> = OnceLock::new();
    let Ok(svg) = std::str::from_utf8(bytes) else {
        return false;
    };
    let svg_root = SVG_ROOT.get_or_init(|| Regex::new(r"(?is)<svg\b").expect("valid SVG regex"));
    let forbidden = FORBIDDEN_SVG_CONTENT.get_or_init(|| {
        Regex::new(
            r"(?is)<(?:script|foreignobject|iframe|object|embed|image|use|style)\b|\bon[a-z]+\s*=|\b(?:href|xlink:href)\s*=|url\s*\(|<!doctype|<\?xml-stylesheet",
        )
        .expect("valid inert SVG regex")
    });
    svg_root.is_match(svg) && !forbidden.is_match(svg)
}

fn granted_permissions(storage: &Storage, module_id: &str) -> Result<HashSet<String>, String> {
    storage.with_connection(|connection| {
        let mut statement = connection
            .prepare(
                "SELECT permission FROM custom_module_permissions
                 WHERE module_id = ?1 ORDER BY permission",
            )
            .map_err(|error| error.to_string())?;
        statement
            .query_map([module_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub fn list_custom_modules(
    storage: tauri::State<'_, Storage>,
    paths: tauri::State<'_, AppPaths>,
) -> Result<Vec<InstalledCustomModule>, String> {
    let ids = storage.with_connection(|connection| {
        let mut statement = connection
            .prepare("SELECT id FROM custom_modules WHERE installed = 1 ORDER BY sort_order, id")
            .map_err(|error| error.to_string())?;
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    })?;
    ids.iter()
        .map(|id| {
            installed_module(&storage, &paths, id)?
                .ok_or_else(|| format!("Custom Module metadata disappeared while listing {id}"))
        })
        .collect()
}

#[tauri::command]
pub async fn inspect_custom_module_package(path: String) -> Result<PackageReview, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_archive(Path::new(&path)))
        .await
        .map_err(|error| format!("Custom Module inspection task failed: {error}"))?
}

#[tauri::command]
pub async fn install_custom_module_from_file(
    path: String,
    expected_sha256: String,
    app: tauri::AppHandle,
) -> Result<InstalledCustomModule, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let storage = app.state::<Storage>();
        let paths = app.state::<AppPaths>();
        install_package(
            &storage,
            &paths,
            Path::new(&path),
            "local",
            "local",
            Some(&expected_sha256),
            None,
        )
    })
    .await
    .map_err(|error| format!("Custom Module install task failed: {error}"))?
}

fn validate_catalog_with_key(catalog: &Catalog, public_key_hex: &str) -> Result<(), String> {
    if catalog.schema_version != 2 {
        return Err("unsupported Custom Module catalog schema".into());
    }
    let mut ids = HashSet::new();
    for entry in &catalog.modules {
        validate_identifier(&entry.id, "catalog module id")?;
        if entry.version.len() > 64 {
            return Err("catalog module version is too long".into());
        }
        Version::parse(&entry.version)
            .map_err(|error| format!("catalog module version is invalid: {error}"))?;
        if !ids.insert(entry.id.as_str()) {
            return Err(format!("duplicate Custom Module catalog id '{}'", entry.id));
        }
        if entry.name.trim().is_empty()
            || entry.name.len() > 128
            || entry.publisher.trim().is_empty()
            || entry.publisher.len() > 256
            || entry.summary.len() > 2_048
            || entry.license.trim().is_empty()
            || entry.license.len() > 128
        {
            return Err("catalog module name, publisher, and license are required".into());
        }
        if entry.api_version == 0 {
            return Err("catalog module API version must be positive".into());
        }
        decode_hex::<32>(&entry.sha256)?;
        if entry.sha256 != entry.sha256.to_ascii_lowercase() {
            return Err("catalog package SHA-256 must use lowercase hexadecimal".into());
        }
        let signature = BASE64
            .decode(&entry.signature)
            .map_err(|error| format!("invalid catalog signature encoding: {error}"))?;
        Signature::from_slice(&signature)
            .map_err(|error| format!("invalid catalog package signature: {error}"))?;
        verify_catalog_signature_with_key(public_key_hex, &entry.sha256, &entry.signature)?;
        validate_permissions(&entry.permissions)?;
        if entry.download_size == 0 || entry.download_size > MAX_ARCHIVE_BYTES {
            return Err(format!(
                "catalog package '{}' exceeds the size limit",
                entry.id
            ));
        }
        let url = Url::parse(&entry.download_url)
            .map_err(|error| format!("invalid catalog download URL: {error}"))?;
        if url.scheme() != "https" {
            return Err("catalog packages must be downloaded over HTTPS".into());
        }
    }
    Ok(())
}

fn validate_catalog(catalog: &Catalog) -> Result<(), String> {
    validate_catalog_with_key(catalog, FIRST_PARTY_VERIFYING_KEY_HEX)
}

fn baseline_catalog() -> Result<Catalog, String> {
    let catalog: Catalog = serde_json::from_str(CATALOG_JSON)
        .map_err(|error| format!("bundled Custom Module catalog is invalid: {error}"))?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

fn catalog_cache_path(paths: &AppPaths) -> PathBuf {
    modules_root(paths).join(CATALOG_CACHE_FILE)
}

fn catalog_key_id_for_key(key: &VerifyingKey) -> String {
    encode_hex(Sha256::digest(key.as_bytes()).as_slice())
}

fn parse_catalog_time(value: &str, field: &str) -> Result<OffsetDateTime, String> {
    OffsetDateTime::parse(value, &Rfc3339)
        .map_err(|error| format!("online Custom Module catalog {field} is invalid: {error}"))
}

fn verify_online_catalog(
    bytes: &[u8],
    now: OffsetDateTime,
) -> Result<VerifiedOnlineCatalog, String> {
    verify_online_catalog_with_key(
        bytes,
        now,
        FIRST_PARTY_VERIFYING_KEY_HEX,
        ONLINE_CATALOG_URL,
    )
}

fn verify_online_catalog_with_key(
    bytes: &[u8],
    now: OffsetDateTime,
    public_key_hex: &str,
    online_catalog_url: &str,
) -> Result<VerifiedOnlineCatalog, String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_CATALOG_BYTES {
        return Err("online Custom Module catalog exceeds the 4 MiB limit".into());
    }
    let envelope: SignedCatalogEnvelope = serde_json::from_slice(bytes)
        .map_err(|error| format!("online Custom Module catalog envelope is invalid: {error}"))?;
    if envelope.schema_version != 2 {
        return Err("unsupported online Custom Module catalog envelope schema".into());
    }
    let verifying_key = VerifyingKey::from_bytes(&decode_hex(public_key_hex)?)
        .map_err(|error| format!("invalid embedded catalog key: {error}"))?;
    if envelope.key_id != catalog_key_id_for_key(&verifying_key) {
        return Err("online Custom Module catalog was signed by an unexpected key".into());
    }
    let payload_bytes = BASE64.decode(&envelope.payload).map_err(|error| {
        format!("online Custom Module catalog payload encoding is invalid: {error}")
    })?;
    if payload_bytes.is_empty() || payload_bytes.len() as u64 > MAX_CATALOG_BYTES {
        return Err("online Custom Module catalog payload exceeds the 4 MiB limit".into());
    }
    let signature_bytes = BASE64.decode(&envelope.signature).map_err(|error| {
        format!("online Custom Module catalog signature encoding is invalid: {error}")
    })?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|error| format!("online Custom Module catalog signature is invalid: {error}"))?;
    verifying_key
        .verify(&payload_bytes, &signature)
        .map_err(|_| "online Custom Module catalog signature is not trusted".to_string())?;

    let payload: OnlineCatalogPayload = serde_json::from_slice(&payload_bytes)
        .map_err(|error| format!("online Custom Module catalog payload is invalid: {error}"))?;
    if payload.schema_version != 2 || payload.sequence == 0 {
        return Err("unsupported online Custom Module catalog payload schema".into());
    }
    let generated_at = parse_catalog_time(&payload.generated_at, "generatedAt")?;
    let expires_at = parse_catalog_time(&payload.expires_at, "expiresAt")?;
    if generated_at > now + time::Duration::minutes(10) {
        return Err("online Custom Module catalog is dated too far in the future".into());
    }
    if expires_at <= generated_at
        || expires_at - generated_at > time::Duration::days(MAX_CATALOG_VALIDITY_DAYS)
    {
        return Err("online Custom Module catalog validity period is invalid".into());
    }
    let catalog = Catalog {
        schema_version: payload.schema_version,
        modules: payload.modules.clone(),
    };
    validate_catalog_with_key(&catalog, public_key_hex)?;

    if !online_catalog_url.is_empty() {
        let catalog_url = Url::parse(online_catalog_url)
            .map_err(|error| format!("online Custom Module catalog URL is invalid: {error}"))?;
        for entry in &payload.modules {
            let download_url = Url::parse(&entry.download_url)
                .map_err(|error| format!("catalog package URL is invalid: {error}"))?;
            if download_url.origin() != catalog_url.origin() {
                return Err(format!(
                    "catalog package '{}' is not hosted by the configured catalog origin",
                    entry.id
                ));
            }
        }
    }

    Ok(VerifiedOnlineCatalog {
        payload,
        payload_sha256: encode_hex(Sha256::digest(&payload_bytes).as_slice()),
        expired: expires_at <= now,
    })
}

fn cached_online_catalog(
    paths: &AppPaths,
    now: OffsetDateTime,
) -> Result<Option<VerifiedOnlineCatalog>, String> {
    let path = catalog_cache_path(paths);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "failed to read cached Custom Module catalog {}: {error}",
                path.display()
            ));
        }
    };
    verify_online_catalog(&bytes, now).map(Some)
}

fn merge_catalogs(
    baseline: Catalog,
    online: Option<&VerifiedOnlineCatalog>,
) -> Result<Vec<CatalogEntry>, String> {
    let mut merged = BTreeMap::<String, CatalogEntry>::new();
    for entry in baseline.modules {
        merged.insert(entry.id.clone(), entry);
    }
    if let Some(online) = online.filter(|catalog| !catalog.expired) {
        for entry in &online.payload.modules {
            if let Some(existing) = merged.get(&entry.id) {
                if existing.name != entry.name || existing.publisher != entry.publisher {
                    return Err(format!(
                        "online catalog changed the identity of Custom Module '{}'",
                        entry.id
                    ));
                }
                if Version::parse(&entry.version).map_err(|error| error.to_string())?
                    <= Version::parse(&existing.version).map_err(|error| error.to_string())?
                {
                    continue;
                }
            }
            merged.insert(entry.id.clone(), entry.clone());
        }
    }
    Ok(merged.into_values().collect())
}

fn available_catalog(paths: &AppPaths) -> Result<Vec<CatalogEntry>, String> {
    let baseline = baseline_catalog()?;
    let cached = match cached_online_catalog(paths, OffsetDateTime::now_utc()) {
        Ok(cached) => cached,
        Err(_) => None,
    };
    merge_catalogs(baseline, cached.as_ref())
}

fn write_catalog_cache(paths: &AppPaths, bytes: &[u8]) -> Result<(), String> {
    let destination = catalog_cache_path(paths);
    let parent = destination
        .parent()
        .ok_or_else(|| "Custom Module catalog cache path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = destination.with_extension(format!("tmp-{:016x}", rand::random::<u64>()));
    let mut output = File::create(&temporary).map_err(|error| error.to_string())?;
    output.write_all(bytes).map_err(|error| error.to_string())?;
    output.sync_all().map_err(|error| error.to_string())?;
    drop(output);
    if let Err(error) = fs::rename(&temporary, &destination) {
        if destination.exists() {
            fs::remove_file(&destination).map_err(|remove_error| {
                format!("failed to replace cached Custom Module catalog: {remove_error}")
            })?;
            fs::rename(&temporary, &destination).map_err(|rename_error| {
                format!("failed to activate cached Custom Module catalog: {rename_error}")
            })?;
        } else {
            let _ = fs::remove_file(&temporary);
            return Err(format!("failed to cache Custom Module catalog: {error}"));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_custom_module_catalog(
    paths: tauri::State<'_, AppPaths>,
) -> Result<Vec<CatalogEntry>, String> {
    available_catalog(&paths)
}

#[tauri::command]
pub async fn refresh_custom_module_catalog(
    app: tauri::AppHandle,
) -> Result<Vec<CatalogEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = app.state::<AppPaths>();
        if ONLINE_CATALOG_URL.is_empty() {
            return available_catalog(&paths);
        }
        let url = Url::parse(ONLINE_CATALOG_URL)
            .map_err(|error| format!("online Custom Module catalog URL is invalid: {error}"))?;
        if url.scheme() != "https" {
            return Err("online Custom Module catalog must use HTTPS".into());
        }
        let client = crate::net::proxy::apply_blocking(
            Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(60)),
        )
        .build()
        .map_err(|error| error.to_string())?;
        let response = client
            .get(url)
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| format!("failed to refresh Custom Module catalog: {error}"))?;
        if response
            .content_length()
            .is_some_and(|length| length > MAX_CATALOG_BYTES)
        {
            return Err("online Custom Module catalog exceeds the 4 MiB limit".into());
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_CATALOG_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("failed to read Custom Module catalog: {error}"))?;
        if bytes.len() as u64 > MAX_CATALOG_BYTES {
            return Err("online Custom Module catalog exceeds the 4 MiB limit".into());
        }
        let now = OffsetDateTime::now_utc();
        let refreshed = verify_online_catalog(&bytes, now)?;
        if refreshed.expired {
            return Err("online Custom Module catalog has expired".into());
        }
        if let Ok(Some(current)) = cached_online_catalog(&paths, now) {
            if refreshed.payload.sequence < current.payload.sequence {
                return Err("online Custom Module catalog sequence was rolled back".into());
            }
            if refreshed.payload.sequence == current.payload.sequence
                && refreshed.payload_sha256 != current.payload_sha256
            {
                return Err("online Custom Module catalog changed without a new sequence".into());
            }
        }
        write_catalog_cache(&paths, &bytes)?;
        merge_catalogs(baseline_catalog()?, Some(&refreshed))
    })
    .await
    .map_err(|error| format!("Custom Module catalog refresh task failed: {error}"))?
}

fn decode_hex<const N: usize>(value: &str) -> Result<[u8; N], String> {
    if value.len() != N * 2 {
        return Err("hex value has the wrong length".into());
    }
    let mut output = [0_u8; N];
    for (index, byte) in output.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| "hex value contains invalid characters".to_string())?;
    }
    Ok(output)
}

fn verify_catalog_signature(sha256: &str, encoded_signature: &str) -> Result<(), String> {
    verify_catalog_signature_with_key(FIRST_PARTY_VERIFYING_KEY_HEX, sha256, encoded_signature)
}

fn verify_catalog_signature_with_key(
    public_key_hex: &str,
    sha256: &str,
    encoded_signature: &str,
) -> Result<(), String> {
    let public_key = VerifyingKey::from_bytes(&decode_hex(public_key_hex)?)
        .map_err(|error| format!("invalid embedded catalog key: {error}"))?;
    let signature_bytes = BASE64
        .decode(encoded_signature)
        .map_err(|error| format!("invalid package signature encoding: {error}"))?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|error| format!("invalid package signature: {error}"))?;
    public_key
        .verify(sha256.as_bytes(), &signature)
        .map_err(|_| "Custom Module package signature is not trusted".to_string())
}

#[tauri::command]
pub async fn install_custom_module_from_catalog(
    module_id: String,
    version: String,
    app: tauri::AppHandle,
) -> Result<InstalledCustomModule, String> {
    let entry = available_catalog(&app.state::<AppPaths>())?
        .into_iter()
        .find(|entry| entry.id == module_id && entry.version == version)
        .ok_or_else(|| {
            "Custom Module version is not present in the verified catalog".to_string()
        })?;
    if entry.api_version != HOST_API_VERSION {
        return Err(format!(
            "module requires host API {}, but this KKTerm supports API {HOST_API_VERSION}",
            entry.api_version
        ));
    }
    verify_catalog_signature(&entry.sha256, &entry.signature)?;
    let url = Url::parse(&entry.download_url)
        .map_err(|error| format!("invalid catalog download URL: {error}"))?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let runtime = app.state::<CustomModuleRuntime>();
        let mut downloads = runtime.lock_downloads()?;
        if downloads.contains_key(&entry.id) {
            return Err("this Custom Module is already downloading".into());
        }
        downloads.insert(entry.id.clone(), cancelled.clone());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let storage = app.state::<Storage>();
            let paths = app.state::<AppPaths>();
            let cache = downloads_root(&paths);
            fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
            let destination = cache.join(format!("{}-{}.kkmod", entry.id, entry.version));
            let client = crate::net::proxy::apply_blocking(
                Client::builder()
                    .connect_timeout(Duration::from_secs(30))
                    .timeout(Duration::from_secs(10 * 60)),
            )
            .build()
            .map_err(|error| error.to_string())?;
            let mut response = client
                .get(url)
                .send()
                .and_then(|response| response.error_for_status())
                .map_err(|error| format!("failed to download Custom Module: {error}"))?;
            if response
                .content_length()
                .is_some_and(|length| length > MAX_ARCHIVE_BYTES)
            {
                return Err("catalog package exceeds the 1 GiB download limit".into());
            }
            if response
                .content_length()
                .is_some_and(|actual| entry.download_size != actual)
            {
                return Err("catalog package size does not match catalog metadata".into());
            }
            let _ = app.emit(
                "custom-modules://progress",
                json!({
                    "moduleId": entry.id,
                    "kind": "started"
                }),
            );
            let mut output = File::create(&destination).map_err(|error| error.to_string())?;
            let mut downloaded = 0_u64;
            let total = Some(entry.download_size);
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                if cancelled.load(Ordering::Relaxed) {
                    drop(output);
                    let _ = fs::remove_file(&destination);
                    let _ = app.emit(
                        "custom-modules://progress",
                        json!({
                            "moduleId": entry.id,
                            "kind": "cancelled"
                        }),
                    );
                    return Err("Custom Module download was cancelled".into());
                }
                let read = response
                    .read(&mut buffer)
                    .map_err(|error| error.to_string())?;
                if read == 0 {
                    break;
                }
                downloaded = downloaded.saturating_add(read as u64);
                if downloaded > MAX_ARCHIVE_BYTES {
                    drop(output);
                    let _ = fs::remove_file(&destination);
                    return Err("catalog package exceeds the 1 GiB download limit".into());
                }
                output
                    .write_all(&buffer[..read])
                    .map_err(|error| error.to_string())?;
                let _ = app.emit(
                    "custom-modules://progress",
                    json!({
                        "moduleId": entry.id,
                        "kind": "progress",
                        "downloaded": downloaded,
                        "total": total
                    }),
                );
            }
            output.sync_all().map_err(|error| error.to_string())?;
            if entry.download_size != downloaded {
                drop(output);
                let _ = fs::remove_file(&destination);
                return Err("downloaded Custom Module size does not match catalog metadata".into());
            }
            drop(output);
            let result = install_package(
                &storage,
                &paths,
                &destination,
                "catalog",
                "firstParty",
                Some(&entry.sha256),
                Some(&entry),
            );
            let _ = fs::remove_file(&destination);
            if result.is_ok() {
                let _ = app.emit(
                    "custom-modules://progress",
                    json!({
                    "moduleId": entry.id,
                        "kind": "finished"
                    }),
                );
            }
            result
        })();
        if let Ok(mut downloads) = app.state::<CustomModuleRuntime>().lock_downloads() {
            downloads.remove(&entry.id);
        }
        if result.is_err() {
            let _ = app.emit(
                "custom-modules://progress",
                json!({
                    "moduleId": entry.id,
                    "kind": "failed"
                }),
            );
        }
        result
    })
    .await
    .map_err(|error| format!("Custom Module download task failed: {error}"))?
}

#[tauri::command]
pub fn cancel_custom_module_download(
    module_id: String,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<(), String> {
    let downloads = runtime.lock_downloads()?;
    let cancelled = downloads
        .get(&module_id)
        .ok_or_else(|| "Custom Module download is not active".to_string())?;
    cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn set_custom_module_enabled(
    module_id: String,
    enabled: bool,
    storage: tauri::State<'_, Storage>,
) -> Result<(), String> {
    storage.with_connection(|connection| {
        let changed = connection
            .execute(
                "UPDATE custom_modules SET enabled = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND installed = 1",
                params![module_id, enabled],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("Custom Module is not installed".into());
        }
        Ok(())
    })
}

#[tauri::command]
pub fn set_custom_module_rail_visible(
    module_id: String,
    rail_visible: bool,
    storage: tauri::State<'_, Storage>,
) -> Result<(), String> {
    storage.with_connection(|connection| {
        let changed = connection
            .execute(
                "UPDATE custom_modules SET rail_visible = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND installed = 1",
                params![module_id, rail_visible],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("Custom Module is not installed".into());
        }
        Ok(())
    })
}

#[tauri::command]
pub fn read_custom_module_license_file(
    module_id: String,
    notices: bool,
    storage: tauri::State<'_, Storage>,
    paths: tauri::State<'_, AppPaths>,
) -> Result<String, String> {
    let installed = installed_module(&storage, &paths, &module_id)?
        .ok_or_else(|| "Custom Module is not installed".to_string())?;
    let relative = if notices {
        installed
            .manifest
            .license
            .notices_file
            .as_deref()
            .ok_or_else(|| "Custom Module does not declare a notices file".to_string())?
    } else {
        &installed.manifest.license.file
    };
    let package_root = modules_root(&paths).join(package_relative_path(
        &installed.manifest.id,
        &installed.manifest.version,
    ));
    let canonical_root = canonical_package_root(&paths, &package_root)?;
    let path =
        fs::canonicalize(package_root.join(validate_relative_path(relative, "license file")?))
            .map_err(|error| format!("failed to resolve Custom Module license: {error}"))?;
    if !path.starts_with(&canonical_root) {
        return Err("Custom Module license escapes its package root".into());
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("failed to inspect Custom Module license: {error}"))?;
    if metadata.len() > 1024 * 1024 {
        return Err("Custom Module license text exceeds 1 MiB".into());
    }
    fs::read_to_string(&path)
        .map_err(|error| format!("failed to read Custom Module license text: {error}"))
}

#[tauri::command]
pub fn rollback_custom_module(
    module_id: String,
    storage: tauri::State<'_, Storage>,
    paths: tauri::State<'_, AppPaths>,
) -> Result<InstalledCustomModule, String> {
    validate_identifier(&module_id, "module id")?;
    let (active_version, previous_version, sha256) = storage.with_connection(|connection| {
        let (active, previous): (String, Option<String>) = connection
            .query_row(
                "SELECT active_version, previous_version FROM custom_modules
                     WHERE id = ?1 AND installed = 1",
                [&module_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| error.to_string())?;
        let previous = previous
            .ok_or_else(|| "Custom Module does not have a retained previous version".to_string())?;
        if previous.len() > 64 || Version::parse(&previous).is_err() {
            return Err("retained Custom Module version is invalid".into());
        }
        let sha: String = connection
            .query_row(
                "SELECT sha256 FROM custom_module_versions
                     WHERE module_id = ?1 AND version = ?2",
                params![module_id, previous],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        Ok((active, previous, sha))
    })?;
    let package_root =
        modules_root(&paths).join(package_relative_path(&module_id, &previous_version));
    let canonical_root = canonical_package_root(&paths, &package_root)?;
    let manifest_path = fs::canonicalize(package_root.join(MANIFEST_FILE))
        .map_err(|error| format!("failed to resolve retained Custom Module manifest: {error}"))?;
    if !manifest_path.starts_with(&canonical_root) {
        return Err("retained Custom Module manifest escapes its package root".into());
    }
    let manifest: CustomModuleManifest = serde_json::from_slice(
        &fs::read(&manifest_path)
            .map_err(|error| format!("failed to read retained Custom Module manifest: {error}"))?,
    )
    .map_err(|error| format!("retained Custom Module manifest is invalid: {error}"))?;
    validate_manifest(&manifest)?;
    if manifest.id != module_id || manifest.version != previous_version {
        return Err("retained Custom Module version identity does not match its metadata".into());
    }
    let manifest_json = serde_json::to_string(&manifest).map_err(|error| error.to_string())?;
    storage.with_connection_mut(|connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE custom_modules SET manifest_json = ?2, active_version = ?3,
                    previous_version = ?4, sha256 = ?5,
                    updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![
                    module_id,
                    manifest_json,
                    previous_version,
                    active_version,
                    sha256
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM custom_module_permissions WHERE module_id = ?1",
                [&module_id],
            )
            .map_err(|error| error.to_string())?;
        for permission in manifest.permissions.enabled_names() {
            transaction
                .execute(
                    "INSERT INTO custom_module_permissions (module_id, permission) VALUES (?1, ?2)",
                    params![module_id, permission],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    })?;
    installed_module(&storage, &paths, &module_id)?
        .ok_or_else(|| "rolled-back Custom Module could not be reloaded".to_string())
}

#[tauri::command]
pub fn uninstall_custom_module(
    module_id: String,
    delete_data: bool,
    app: tauri::AppHandle,
    storage: tauri::State<'_, Storage>,
    paths: tauri::State<'_, AppPaths>,
    secret_store: tauri::State<'_, secrets::Secrets>,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<(), String> {
    validate_identifier(&module_id, "module id")?;
    installed_module(&storage, &paths, &module_id)?
        .ok_or_else(|| "Custom Module is not installed".to_string())?;
    let labels = runtime
        .lock()?
        .iter()
        .filter_map(|(label, session)| (session.module_id == module_id).then_some(label.clone()))
        .collect::<Vec<_>>();
    for label in labels {
        if let Some(session) = runtime.lock()?.remove(&label) {
            let _ = webview::hide_overlay(&session.window);
            abort_session_blob_writes(&session);
            close_session_file_tokens(&session);
            cancel_session_secret_prompts(&runtime, &app, &label);
            let _ = session.window.close();
        }
        runtime.lock_routes()?.remove(&label);
    }
    let packages = package_storage_root(&paths);
    let package_dir = packages.join(&module_id);
    remove_owned_directory(&packages, &package_dir, "Custom Module package files")?;
    if delete_data {
        delete_all_custom_module_secrets(&storage, &secret_store, &module_id)?;
        let webview_root = webview_data_root(&paths);
        let webview_data = webview_root.join(&module_id);
        remove_owned_directory(&webview_root, &webview_data, "Custom Module WebView data")?;
        let document_data = document_storage_root(&paths).join(&module_id);
        remove_owned_directory(
            &document_storage_root(&paths),
            &document_data,
            "Custom Module document data",
        )?;
        let blob_data = blob_storage_root(&paths).join(&module_id);
        remove_owned_directory(
            &blob_storage_root(&paths),
            &blob_data,
            "Custom Module blob data",
        )?;
    }
    storage.with_connection_mut(|connection| {
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        if delete_data {
            transaction
                .execute("DELETE FROM custom_modules WHERE id = ?1", [&module_id])
                .map_err(|error| error.to_string())?;
        } else {
            transaction
                .execute(
                    "DELETE FROM custom_module_versions WHERE module_id = ?1",
                    [&module_id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE custom_modules SET installed = 0, enabled = 0, rail_visible = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                    [&module_id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    })?;
    Ok(())
}

fn delete_all_custom_module_secrets(
    storage: &Storage,
    secret_store: &secrets::Secrets,
    module_id: &str,
) -> Result<(), String> {
    let secret_owner_ids = storage.with_connection(|connection| {
        let mut statement = connection
            .prepare("SELECT owner_id FROM custom_module_secret_refs WHERE module_id = ?1")
            .map_err(|error| error.to_string())?;
        statement
            .query_map([module_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    })?;
    for owner_id in secret_owner_ids {
        if secret_store
            .secret_exists(secrets::SecretReferenceRequest::custom_module_secret(
                owner_id.clone(),
            ))?
            .exists()
        {
            secret_store.delete_secret(secrets::SecretReferenceRequest::custom_module_secret(
                owner_id,
            ))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_custom_module_data_usage(
    module_id: String,
    storage: tauri::State<'_, Storage>,
    paths: tauri::State<'_, AppPaths>,
) -> Result<CustomModuleDataUsage, String> {
    validate_identifier(&module_id, "module id")?;
    let (storage_bytes, document_bytes, blob_bytes, secret_count): (i64, i64, i64, i64) =
        storage.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT
                        COALESCE((SELECT SUM(byte_size) FROM custom_module_storage WHERE module_id = ?1), 0),
                        COALESCE((SELECT SUM(byte_size) FROM custom_module_documents WHERE module_id = ?1), 0),
                        COALESCE((SELECT SUM(byte_size) FROM custom_module_blobs WHERE module_id = ?1), 0),
                        (SELECT COUNT(*) FROM custom_module_secret_refs WHERE module_id = ?1)",
                    [&module_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(|error| error.to_string())
        })?;
    let browser_bytes = owned_directory_size(
        &webview_data_root(&paths),
        &webview_data_root(&paths).join(&module_id),
    )?;
    let storage_bytes = storage_bytes.max(0) as u64;
    let document_bytes = document_bytes.max(0) as u64;
    let blob_bytes = blob_bytes.max(0) as u64;
    Ok(CustomModuleDataUsage {
        storage_bytes,
        document_bytes,
        blob_bytes,
        browser_bytes,
        secret_count: secret_count.max(0) as u64,
        total_bytes: storage_bytes
            .saturating_add(document_bytes)
            .saturating_add(blob_bytes)
            .saturating_add(browser_bytes),
    })
}

#[tauri::command]
pub fn clear_custom_module_data(
    module_id: String,
    storage: tauri::State<'_, Storage>,
    paths: tauri::State<'_, AppPaths>,
    secret_store: tauri::State<'_, secrets::Secrets>,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<(), String> {
    validate_identifier(&module_id, "module id")?;
    let installed = installed_module(&storage, &paths, &module_id)?
        .ok_or_else(|| "Custom Module is not installed".to_string())?;
    if installed.enabled
        || runtime
            .lock()?
            .values()
            .any(|session| session.module_id == module_id)
    {
        return Err("Disable the Custom Module before clearing its data".into());
    }
    delete_all_custom_module_secrets(&storage, &secret_store, &module_id)?;
    for (base, label) in [
        (webview_data_root(&paths), "Custom Module WebView data"),
        (document_storage_root(&paths), "Custom Module document data"),
        (blob_storage_root(&paths), "Custom Module blob data"),
    ] {
        remove_owned_directory(&base, &base.join(&module_id), label)?;
    }
    storage.with_connection_mut(|connection| {
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        for table in [
            "custom_module_storage",
            "custom_module_documents",
            "custom_module_blobs",
            "custom_module_secret_refs",
        ] {
            transaction
                .execute(&format!("DELETE FROM {table} WHERE module_id = ?1"), [&module_id])
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    })
}

fn session_label(module_id: &str, contribution_id: &str) -> String {
    let digest = Sha256::digest(format!("{module_id}:{contribution_id}"));
    format!("custom-module-{}", encode_hex(&digest[..12]))
}

fn package_origin_host(module_id: &str) -> String {
    let digest = Sha256::digest(module_id.as_bytes());
    format!("m-{}", encode_hex(&digest[..12]))
}

fn initialization_script(
    theme: &str,
    locale: &str,
    permissions: &CustomModulePermissions,
) -> Result<String, String> {
    let context = serde_json::to_string(&json!({
        "apiVersion": HOST_API_VERSION,
        "theme": theme,
        "locale": locale,
    }))
    .map_err(|error| error.to_string())?;
    let capabilities = serde_json::to_string(permissions).map_err(|error| error.to_string())?;
    let clipboard_allowed = permissions.clipboard;
    let browser_storage_allowed = permissions.browser_storage;
    Ok(format!(
        r#"
        (() => {{
          const ephemeralValues = new Map();
          const ephemeralStorage = Object.freeze({{
            get length() {{ return ephemeralValues.size; }},
            clear: () => ephemeralValues.clear(),
            getItem: (key) => ephemeralValues.has(String(key)) ? ephemeralValues.get(String(key)) : null,
            key: (index) => Array.from(ephemeralValues.keys())[index] ?? null,
            removeItem: (key) => ephemeralValues.delete(String(key)),
            setItem: (key, value) => ephemeralValues.set(String(key), String(value))
          }});
          const clipboardUnavailable = () => Promise.reject(
            new DOMException('Clipboard access is unavailable to Custom Modules.', 'NotAllowedError')
          );
          const unavailableClipboard = Object.freeze({{
            read: clipboardUnavailable,
            readText: clipboardUnavailable,
            write: clipboardUnavailable,
            writeText: clipboardUnavailable
          }});
          const replace = (target, name, value) => {{
            try {{ Object.defineProperty(target, name, {{ configurable: false, value }}); }} catch {{}}
          }};
          if (!{browser_storage_allowed}) {{
            for (const target of [window, Window.prototype]) {{
              replace(target, 'localStorage', ephemeralStorage);
              replace(target, 'indexedDB', undefined);
            }}
            for (const target of [navigator, Navigator.prototype]) replace(target, 'storage', undefined);
          }}
          for (const target of [window, Window.prototype]) replace(target, 'caches', undefined);
          for (const target of [navigator, Navigator.prototype]) {{
            replace(target, 'serviceWorker', undefined);
            if (!{clipboard_allowed}) replace(target, 'clipboard', unavailableClipboard);
          }}
          for (const target of [document, Document.prototype]) {{
            try {{ Object.defineProperty(target, 'cookie', {{ configurable: false, get: () => '', set: () => true }}); }} catch {{}}
          }}
          class KKTermError extends Error {{
            constructor(code, message, details) {{
              super(message); this.name = 'KKTermError'; this.code = code; this.details = details;
            }}
          }}
          const normalizeError = (error) => {{
            if (error instanceof KKTermError) return error;
            if (error && typeof error === 'object' && typeof error.code === 'string') {{
              return new KKTermError(error.code, String(error.message || error.code), error.details);
            }}
            const message = error instanceof Error ? error.message : String(error);
            const code = message.includes('permission') ? 'permission_denied' : 'host_error';
            return new KKTermError(code, message);
          }};
          const invoke = async (operation, payload = {{}}) => {{
            try {{
              return await window.__TAURI_INTERNALS__.invoke(
                'custom_module_bridge', {{ request: {{ operation, payload }} }}
              );
            }} catch (error) {{ throw normalizeError(error); }}
          }};
          const listeners = new Map();
          const deepFreeze = (value) => {{
            if (value && typeof value === 'object' && !Object.isFrozen(value)) {{
              for (const child of Object.values(value)) deepFreeze(child);
              Object.freeze(value);
            }}
            return value;
          }};
          const capabilities = deepFreeze({capabilities});
          let currentContext = Object.freeze({context});
          window.KKTerm = Object.freeze({{
            apiVersion: {HOST_API_VERSION},
            get context() {{ return currentContext; }},
            ready: () => invoke('host.ready'),
            getContext: () => invoke('host.getContext'),
            getCapabilities: () => Promise.resolve(capabilities),
            openExternal: (url) => invoke('host.openExternal', {{ url }}),
            storage: Object.freeze({{
              get: (key) => invoke('storage.get', {{ key }}),
              set: (key, value) => invoke('storage.set', {{ key, value }}),
              delete: (key) => invoke('storage.delete', {{ key }}),
              list: () => invoke('storage.list')
            }}),
            documents: Object.freeze({{
              get: (key) => invoke('documents.get', {{ key }}),
              set: (key, value) => invoke('documents.set', {{ key, value }}),
              delete: (key) => invoke('documents.delete', {{ key }}),
              list: () => invoke('documents.list')
            }}),
            files: Object.freeze({{
              open: (options = {{}}) => invoke('files.open', options),
              beginSave: (options = {{}}) => invoke('files.beginSave', options),
              read: (token, offset = 0, length) => invoke('files.read', {{ token, offset, length }}),
              write: (token, dataBase64) => invoke('files.write', {{ token, dataBase64 }}),
              commit: (token) => invoke('files.commit', {{ token }}),
              close: (token) => invoke('files.close', {{ token }})
            }}),
            network: Object.freeze({{
              fetch: (request) => invoke('network.fetch', request)
            }}),
            secrets: Object.freeze({{
              has: (key) => invoke('secrets.has', {{ key }}),
              requestEntry: (key, label) => invoke('secrets.requestEntry', {{ key, label }}),
              delete: (key) => invoke('secrets.delete', {{ key }})
            }}),
            ui: Object.freeze({{
              notice: (message, options = {{}}) => invoke('ui.notice', {{ message, ...options }}),
              progress: (id, message, progress) => invoke('ui.progress', {{ id, message, progress }}),
              clearProgress: (id) => invoke('ui.clearProgress', {{ id }})
            }}),
            blobs: Object.freeze({{
              beginWrite: (key, mimeType) => invoke('blobs.beginWrite', {{ key, mimeType }}),
              write: (token, dataBase64) => invoke('blobs.write', {{ token, dataBase64 }}),
              commit: (token) => invoke('blobs.commit', {{ token }}),
              abort: (token) => invoke('blobs.abort', {{ token }}),
              read: (key, offset = 0, length) => invoke('blobs.read', {{ key, offset, length }}),
              delete: (key) => invoke('blobs.delete', {{ key }}),
              list: () => invoke('blobs.list')
            }}),
            on: (event, listener) => {{
              const current = listeners.get(event) || new Set();
              current.add(listener); listeners.set(event, current);
              return () => current.delete(listener);
            }}
          }});
          window.__KKTERM_MODULE_EVENT__ = (event, detail) => {{
            if (event === 'contextChanged') {{
              currentContext = Object.freeze({{ ...currentContext, ...detail }});
            }}
            for (const listener of listeners.get(event) || []) {{
              try {{ listener(detail); }} catch (error) {{ console.error(error); }}
            }}
          }};
          const externalUrl = (value) => {{
            try {{
              const url = new URL(String(value), location.href);
              return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
            }} catch {{ return null; }}
          }};
          document.addEventListener('click', (event) => {{
            if (!event.isTrusted || event.defaultPrevented || event.button !== 0) return;
            const target = event.target;
            const anchor = target instanceof Element ? target.closest('a[href]') : null;
            if (!anchor) return;
            const url = externalUrl(anchor.getAttribute('href'));
            if (!url || new URL(url).origin === location.origin) return;
            event.preventDefault();
            void invoke('host.openExternal', {{ url }}).catch(console.error);
          }}, true);
          const nativeOpen = window.open.bind(window);
          replace(window, 'open', (url, target, features) => {{
            const external = externalUrl(url);
            if (external && new URL(external).origin !== location.origin && navigator.userActivation?.isActive) {{
              void invoke('host.openExternal', {{ url: external }}).catch(console.error);
              return null;
            }}
            return nativeOpen(url, target, features);
          }});
          window.addEventListener('focus', () => window.__KKTERM_MODULE_EVENT__('focusChanged', {{ focused: true }}));
          window.addEventListener('blur', () => window.__KKTERM_MODULE_EVENT__('focusChanged', {{ focused: false }}));
        }})();
        "#
    ))
}

#[tauri::command]
pub async fn start_custom_module(
    request: StartCustomModuleRequest,
    app: tauri::AppHandle,
    storage: tauri::State<'_, Storage>,
    paths: tauri::State<'_, AppPaths>,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<CustomModuleSessionStarted, String> {
    let installed = installed_module(&storage, &paths, &request.module_id)?
        .ok_or_else(|| "Custom Module is not installed".to_string())?;
    if !installed.enabled || installed.health != "ready" {
        return Err("Custom Module is disabled or its package files are missing".into());
    }
    let contribution = installed
        .manifest
        .modules
        .iter()
        .find(|contribution| contribution.id == request.contribution_id)
        .cloned()
        .ok_or_else(|| "Custom Module contribution is not declared".to_string())?;
    let label = session_label(&request.module_id, &request.contribution_id);
    if let Some(session) = runtime.lock()?.get(&label).cloned() {
        update_runtime_view_bounds(
            &session,
            RuntimeBounds {
                x: request.x,
                y: request.y,
                width: request.width,
                height: request.height,
            },
        )?;
        return Ok(CustomModuleSessionStarted { session_id: label });
    }

    let root = modules_root(&paths).join(package_relative_path(
        &installed.manifest.id,
        &installed.manifest.version,
    ));
    let host_window = app
        .get_webview_window(crate::window_state::MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window is not available".to_string())?;
    let origin_host = package_origin_host(&installed.manifest.id);
    let initial_url = Url::parse(&format!(
        "kkmodule://{origin_host}/{}",
        contribution.entrypoint
    ))
        .map_err(|error| format!("failed to build Custom Module URL: {error}"))?;
    let permissions = granted_permissions(&storage, &installed.manifest.id)?;
    let effective_permissions = installed.manifest.permissions.restricted_to(&permissions);
    let clipboard_allowed = effective_permissions.clipboard;
    let navigation_origin_host = origin_host.clone();
    let windows_origin_host = format!("kkmodule.{origin_host}");
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(initial_url))
        .initialization_script(initialization_script(
            &request.theme,
            &request.locale,
            &effective_permissions,
        )?)
        .decorations(false)
        .resizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .position(-32_000.0, -32_000.0)
        .inner_size(request.width.max(1.0), request.height.max(1.0))
        .data_directory(webview_data_root(&paths).join(&installed.manifest.id))
        .on_navigation(move |url| {
            let is_module_asset = (url.scheme() == "kkmodule"
                && url.host_str() == Some(navigation_origin_host.as_str()))
                || (url.scheme() == "http"
                    && url.host_str() == Some(windows_origin_host.as_str()));
            is_module_asset
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    if clipboard_allowed {
        builder = builder.enable_clipboard_access();
    }
    #[cfg(windows)]
    {
        builder = builder
            .owner(&host_window)
            .map_err(|error| format!("failed to assign Custom Module owner: {error}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .parent(&host_window)
            .map_err(|error| format!("failed to assign Custom Module parent: {error}"))?;
    }
    runtime.lock_routes()?.insert(
        label.clone(),
        ModuleRoute {
            root: root.clone(),
            entrypoint: contribution.entrypoint.clone(),
            routing: contribution.routing,
            origin_host,
            clipboard_allowed,
        },
    );
    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            runtime.lock_routes()?.remove(&label);
            return Err(format!("failed to create Custom Module WebView: {error}"));
        }
    };
    let session = RuntimeSession {
        module_id: installed.manifest.id,
        contribution_id: contribution.id,
        permissions,
        permission_config: effective_permissions,
        theme: request.theme,
        locale: request.locale,
        ready_sent: Arc::new(AtomicBool::new(false)),
        last_external_open: Arc::new(Mutex::new(None)),
        blob_writes: Arc::new(Mutex::new(HashMap::new())),
        file_tokens: Arc::new(Mutex::new(HashMap::new())),
        view_state: Arc::new(Mutex::new(RuntimeViewState {
            bounds: RuntimeBounds {
                x: request.x,
                y: request.y,
                width: request.width,
                height: request.height,
            },
            visible: false,
        })),
        window: window.clone(),
        host_window: host_window.clone(),
    };
    if let Err(error) = runtime.lock().map(|mut sessions| {
        sessions.insert(label.clone(), session.clone());
    }) {
        runtime.lock_routes()?.remove(&label);
        let _ = window.close();
        return Err(error);
    }
    if let Err(error) = set_runtime_view_visibility(&session, true) {
        let _ = runtime.lock().map(|mut sessions| sessions.remove(&label));
        let _ = runtime
            .lock_routes()
            .map(|mut routes| routes.remove(&label));
        let _ = window.close();
        return Err(error);
    }
    Ok(CustomModuleSessionStarted { session_id: label })
}

fn update_runtime_view_bounds(
    session: &RuntimeSession,
    bounds: RuntimeBounds,
) -> Result<(), String> {
    let mut state = session
        .view_state
        .lock()
        .map_err(|_| "Custom Module view-state lock is poisoned".to_string())?;
    state.bounds = bounds;
    if state.visible {
        webview::set_overlay_bounds(
            &session.host_window,
            &session.window,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
        )?;
    }
    Ok(())
}

fn set_runtime_view_visibility(session: &RuntimeSession, visible: bool) -> Result<(), String> {
    let mut state = session
        .view_state
        .lock()
        .map_err(|_| "Custom Module view-state lock is poisoned".to_string())?;
    if visible {
        let bounds = state.bounds;
        webview::set_overlay_bounds(
            &session.host_window,
            &session.window,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
        )?;
    } else {
        let _ = session.window.eval(
            "window.__KKTERM_MODULE_EVENT__?.('suspending', { deadlineMs: 500 });",
        );
        webview::hide_overlay(&session.window)?;
    }
    state.visible = visible;
    drop(state);
    let _ = session.window.eval(format!(
        "window.__KKTERM_MODULE_EVENT__?.('visibilityChanged', {{ visible: {visible} }});"
    ));
    Ok(())
}

fn abort_session_blob_writes(session: &RuntimeSession) {
    if let Ok(mut writes) = session.blob_writes.lock() {
        for (_, write) in writes.drain() {
            drop(write.file);
            let _ = fs::remove_file(write.path);
        }
    }
}

fn close_session_file_tokens(session: &RuntimeSession) {
    if let Ok(mut tokens) = session.file_tokens.lock() {
        for (_, token) in tokens.drain() {
            if let FileToken::Write {
                temporary, file, ..
            } = token
            {
                drop(file);
                let _ = fs::remove_file(temporary);
            }
        }
    }
}

fn cancel_session_secret_prompts(
    runtime: &CustomModuleRuntime,
    app: &tauri::AppHandle,
    session_id: &str,
) {
    if let Ok(mut prompts) = runtime.lock_secret_prompts() {
        let request_ids = prompts
            .iter()
            .filter_map(|(request_id, prompt)| {
                (prompt.session_id == session_id).then_some(request_id.clone())
            })
            .collect::<Vec<_>>();
        for request_id in request_ids {
            if let Some(prompt) = prompts.remove(&request_id) {
                let _ = prompt.completion.send(false);
                let _ = app.emit_to(
                    crate::window_state::MAIN_WINDOW_LABEL,
                    "custom-module-secret-prompt-cancelled",
                    json!({ "requestId": request_id }),
                );
            }
        }
    }
}

#[tauri::command]
pub fn update_custom_module_bounds(
    request: CustomModuleBoundsRequest,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<(), String> {
    let session = runtime.session(&request.session_id)?;
    update_runtime_view_bounds(
        &session,
        RuntimeBounds {
            x: request.x,
            y: request.y,
            width: request.width,
            height: request.height,
        },
    )
}

#[tauri::command]
pub fn set_custom_module_visibility(
    session_id: String,
    visible: bool,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<(), String> {
    let session = runtime.session(&session_id)?;
    set_runtime_view_visibility(&session, visible)
}

#[tauri::command]
pub fn update_custom_module_context(
    request: CustomModuleContextRequest,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<(), String> {
    let mut sessions = runtime.lock()?;
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| "Custom Module session is not registered".to_string())?;
    session.theme = request.theme;
    session.locale = request.locale;
    let payload = serde_json::to_string(&json!({
        "theme": session.theme,
        "locale": session.locale,
    }))
    .map_err(|error| error.to_string())?;
    session
        .window
        .eval(format!(
            "window.__KKTERM_MODULE_EVENT__?.('contextChanged', {payload});"
        ))
        .map_err(|error| format!("failed to update Custom Module context: {error}"))
}

#[tauri::command]
pub fn close_custom_module(
    session_id: String,
    app: tauri::AppHandle,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<(), String> {
    let session = runtime.session(&session_id)?;
    let _ = webview::hide_overlay(&session.window);
    let _ = session
        .window
        .eval("window.__KKTERM_MODULE_EVENT__?.('closing', { reason: 'host' });");
    abort_session_blob_writes(&session);
    close_session_file_tokens(&session);
    cancel_session_secret_prompts(&runtime, &app, &session_id);
    session
        .window
        .close()
        .map_err(|error| format!("failed to close Custom Module WebView: {error}"))?;
    runtime.lock()?.remove(&session_id);
    runtime.lock_routes()?.remove(&session_id);
    Ok(())
}

fn bridge_key(payload: &Value) -> Result<&str, String> {
    let key = payload
        .get("key")
        .and_then(Value::as_str)
        .ok_or_else(|| "storage operation requires a key".to_string())?;
    if key.is_empty() || key.len() > 256 || key.chars().any(char::is_control) {
        return Err("Custom Module storage key is invalid".into());
    }
    Ok(key)
}

fn document_content_path(paths: &AppPaths, module_id: &str, sha256: &str) -> PathBuf {
    document_storage_root(paths)
        .join(module_id)
        .join(format!("{sha256}.json"))
}

fn ensure_document_quota(
    connection: &rusqlite::Connection,
    module_id: &str,
    key: &str,
    byte_size: i64,
) -> Result<(), String> {
    let (existing, key_count): (i64, i64) = connection
        .query_row(
            "SELECT COALESCE(SUM(byte_size), 0), COUNT(*) FROM custom_module_documents
             WHERE module_id = ?1 AND key <> ?2",
            params![module_id, key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    if key_count >= MAX_DOCUMENT_KEYS {
        return Err("Custom Module document key limit exceeded".into());
    }
    if existing.saturating_add(byte_size) > DOCUMENT_STORAGE_QUOTA_BYTES {
        return Err("Custom Module document storage quota exceeded".into());
    }
    Ok(())
}

fn write_document_content(
    paths: &AppPaths,
    module_id: &str,
    sha256: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let directory = document_storage_root(paths).join(module_id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create Custom Module document directory: {error}"))?;
    let destination = document_content_path(paths, module_id, sha256);
    if destination.exists() {
        let existing = fs::read(&destination)
            .map_err(|error| format!("failed to verify Custom Module document: {error}"))?;
        if existing == bytes {
            return Ok(());
        }
        return Err("Custom Module document content hash collision or corruption detected".into());
    }
    let temporary = directory.join(format!(".{sha256}-{:016x}.tmp", rand::random::<u64>()));
    let result = (|| -> Result<(), String> {
        let mut output = File::create(&temporary)
            .map_err(|error| format!("failed to create Custom Module document: {error}"))?;
        output
            .write_all(bytes)
            .map_err(|error| format!("failed to write Custom Module document: {error}"))?;
        output
            .sync_all()
            .map_err(|error| format!("failed to flush Custom Module document: {error}"))?;
        drop(output);
        match fs::rename(&temporary, &destination) {
            Ok(()) => Ok(()),
            Err(_) if destination.exists() => {
                let existing = fs::read(&destination).map_err(|error| {
                    format!("failed to verify concurrently written Custom Module document: {error}")
                })?;
                if existing == bytes {
                    Ok(())
                } else {
                    Err(
                        "Custom Module document content hash collision or corruption detected"
                            .into(),
                    )
                }
            }
            Err(error) => Err(format!(
                "failed to activate Custom Module document: {error}"
            )),
        }
    })();
    let _ = fs::remove_file(&temporary);
    result
}

fn remove_unreferenced_document(
    storage: &Storage,
    paths: &AppPaths,
    module_id: &str,
    sha256: &str,
) -> Result<(), String> {
    let references: i64 = storage.with_connection(|connection| {
        connection
            .query_row(
                "SELECT COUNT(*) FROM custom_module_documents
                 WHERE module_id = ?1 AND content_sha256 = ?2",
                params![module_id, sha256],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    })?;
    if references == 0 {
        let path = document_content_path(paths, module_id, sha256);
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("failed to remove Custom Module document: {error}")),
        }
    }
    Ok(())
}

fn set_document(
    storage: &Storage,
    paths: &AppPaths,
    module_id: &str,
    key: &str,
    value: &Value,
) -> Result<Value, String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err("Custom Module document exceeds the 64 MiB per-document limit".into());
    }
    let byte_size = i64::try_from(bytes.len())
        .map_err(|_| "Custom Module document is too large".to_string())?;
    let sha256 = encode_hex(&Sha256::digest(&bytes));
    let previous_sha256 = storage.with_connection(|connection| {
        ensure_document_quota(connection, module_id, key, byte_size)?;
        connection
            .query_row(
                "SELECT content_sha256 FROM custom_module_documents
                 WHERE module_id = ?1 AND key = ?2",
                params![module_id, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    })?;
    write_document_content(paths, module_id, &sha256, &bytes)?;
    let update = storage.with_connection_mut(|connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        ensure_document_quota(&transaction, module_id, key, byte_size)?;
        transaction
            .execute(
                "INSERT INTO custom_module_documents (
                    module_id, key, content_sha256, byte_size
                 ) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(module_id, key) DO UPDATE SET
                    content_sha256 = excluded.content_sha256,
                    byte_size = excluded.byte_size,
                    updated_at = CURRENT_TIMESTAMP",
                params![module_id, key, sha256, byte_size],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    });
    if let Err(error) = update {
        let _ = remove_unreferenced_document(storage, paths, module_id, &sha256);
        return Err(error);
    }
    if let Some(previous) = previous_sha256.filter(|previous| previous != &sha256) {
        remove_unreferenced_document(storage, paths, module_id, &previous)?;
    }
    Ok(json!(true))
}

fn get_document(
    storage: &Storage,
    paths: &AppPaths,
    module_id: &str,
    key: &str,
) -> Result<Value, String> {
    let metadata: Option<(String, i64)> = storage.with_connection(|connection| {
        connection
            .query_row(
                "SELECT content_sha256, byte_size FROM custom_module_documents
                 WHERE module_id = ?1 AND key = ?2",
                params![module_id, key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())
    })?;
    let Some((sha256, byte_size)) = metadata else {
        return Ok(Value::Null);
    };
    let path = document_content_path(paths, module_id, &sha256);
    let bytes = fs::read(path)
        .map_err(|error| format!("failed to read Custom Module document: {error}"))?;
    if bytes.len() > MAX_DOCUMENT_BYTES
        || i64::try_from(bytes.len()).ok() != Some(byte_size)
        || encode_hex(&Sha256::digest(&bytes)) != sha256
    {
        return Err("Custom Module document metadata does not match its stored content".into());
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Custom Module document contains invalid JSON: {error}"))
}

fn list_documents(storage: &Storage, module_id: &str) -> Result<Value, String> {
    storage.with_connection(|connection| {
        let mut statement = connection
            .prepare(
                "SELECT key, content_sha256, byte_size, updated_at
                 FROM custom_module_documents WHERE module_id = ?1 ORDER BY key",
            )
            .map_err(|error| error.to_string())?;
        let documents = statement
            .query_map([module_id], |row| {
                Ok(json!({
                    "key": row.get::<_, String>(0)?,
                    "sha256": row.get::<_, String>(1)?,
                    "byteSize": row.get::<_, i64>(2)?,
                    "updatedAt": row.get::<_, String>(3)?,
                }))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(json!(documents))
    })
}

fn blob_content_path(paths: &AppPaths, module_id: &str, sha256: &str) -> PathBuf {
    blob_storage_root(paths)
        .join(module_id)
        .join(format!("{sha256}.blob"))
}

fn ensure_blob_quota(
    connection: &rusqlite::Connection,
    module_id: &str,
    key: &str,
    byte_size: i64,
) -> Result<(), String> {
    let (existing, key_count): (i64, i64) = connection
        .query_row(
            "SELECT COALESCE(SUM(byte_size), 0), COUNT(*) FROM custom_module_blobs
             WHERE module_id = ?1 AND key <> ?2",
            params![module_id, key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    if key_count >= MAX_BLOB_KEYS {
        return Err("Custom Module blob key limit exceeded".into());
    }
    if existing.saturating_add(byte_size) > BLOB_STORAGE_QUOTA_BYTES {
        return Err("Custom Module blob storage quota exceeded".into());
    }
    Ok(())
}

fn remove_unreferenced_blob(
    storage: &Storage,
    paths: &AppPaths,
    module_id: &str,
    sha256: &str,
) -> Result<(), String> {
    let references: i64 = storage.with_connection(|connection| {
        connection
            .query_row(
                "SELECT COUNT(*) FROM custom_module_blobs
                 WHERE module_id = ?1 AND content_sha256 = ?2",
                params![module_id, sha256],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    })?;
    if references == 0 {
        match fs::remove_file(blob_content_path(paths, module_id, sha256)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("failed to remove Custom Module blob: {error}")),
        }
    }
    Ok(())
}

fn begin_blob_write(
    paths: &AppPaths,
    session: &RuntimeSession,
    payload: &Value,
) -> Result<Value, String> {
    let key = bridge_key(payload)?.to_string();
    let mime_type = payload
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .trim()
        .to_ascii_lowercase();
    if mime_type.is_empty()
        || mime_type.len() > 128
        || mime_type.chars().any(char::is_control)
        || !mime_type.contains('/')
    {
        return Err("Custom Module blob MIME type is invalid".into());
    }
    let directory = blob_storage_root(paths)
        .join(&session.module_id)
        .join(".staging");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create Custom Module blob directory: {error}"))?;
    let token = format!("{:032x}", rand::random::<u128>());
    let path = directory.join(format!("{token}.tmp"));
    let file = File::create(&path)
        .map_err(|error| format!("failed to create Custom Module blob: {error}"))?;
    session
        .blob_writes
        .lock()
        .map_err(|_| "Custom Module blob-write lock is poisoned".to_string())?
        .insert(
            token.clone(),
            BlobWrite {
                key,
                mime_type,
                path,
                file,
                byte_size: 0,
            },
        );
    Ok(json!({ "token": token, "maxChunkBytes": MAX_BLOB_CHUNK_BYTES }))
}

fn blob_write_chunk(session: &RuntimeSession, payload: &Value) -> Result<Value, String> {
    let token = payload
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "blobs.write requires a token".to_string())?;
    let encoded = payload
        .get("dataBase64")
        .and_then(Value::as_str)
        .ok_or_else(|| "blobs.write requires dataBase64".to_string())?;
    let bytes = BASE64
        .decode(encoded)
        .map_err(|error| format!("invalid Custom Module blob chunk: {error}"))?;
    if bytes.len() > MAX_BLOB_CHUNK_BYTES {
        return Err("Custom Module blob chunk exceeds 1 MiB".into());
    }
    let mut writes = session
        .blob_writes
        .lock()
        .map_err(|_| "Custom Module blob-write lock is poisoned".to_string())?;
    let write = writes
        .get_mut(token)
        .ok_or_else(|| "Custom Module blob-write token is invalid or expired".to_string())?;
    let next_size = write.byte_size.saturating_add(bytes.len() as u64);
    if next_size > MAX_BLOB_BYTES {
        return Err("Custom Module blob exceeds the 256 MiB per-blob limit".into());
    }
    write
        .file
        .write_all(&bytes)
        .map_err(|error| format!("failed to write Custom Module blob: {error}"))?;
    write.byte_size = next_size;
    Ok(json!({ "byteSize": next_size }))
}

fn commit_blob_write(
    storage: &Storage,
    paths: &AppPaths,
    session: &RuntimeSession,
    payload: &Value,
) -> Result<Value, String> {
    let token = payload
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "blobs.commit requires a token".to_string())?;
    let write = session
        .blob_writes
        .lock()
        .map_err(|_| "Custom Module blob-write lock is poisoned".to_string())?
        .remove(token)
        .ok_or_else(|| "Custom Module blob-write token is invalid or expired".to_string())?;
    let result = (|| -> Result<Value, String> {
        write
            .file
            .sync_all()
            .map_err(|error| format!("failed to flush Custom Module blob: {error}"))?;
        drop(write.file);
        let mut input = File::open(&write.path)
            .map_err(|error| format!("failed to reopen Custom Module blob: {error}"))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = input
                .read(&mut buffer)
                .map_err(|error| format!("failed to hash Custom Module blob: {error}"))?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        let sha256 = encode_hex(&hasher.finalize());
        let byte_size = i64::try_from(write.byte_size)
            .map_err(|_| "Custom Module blob is too large".to_string())?;
        let previous_sha256: Option<String> = storage.with_connection(|connection| {
            ensure_blob_quota(connection, &session.module_id, &write.key, byte_size)?;
            connection
                .query_row(
                    "SELECT content_sha256 FROM custom_module_blobs WHERE module_id = ?1 AND key = ?2",
                    params![session.module_id, write.key],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())
        })?;
        let destination = blob_content_path(paths, &session.module_id, &sha256);
        if destination.exists() {
            fs::remove_file(&write.path)
                .map_err(|error| format!("failed to discard duplicate Custom Module blob: {error}"))?;
        } else {
            fs::rename(&write.path, &destination)
                .map_err(|error| format!("failed to activate Custom Module blob: {error}"))?;
        }
        let update = storage.with_connection_mut(|connection| {
            let transaction = connection.transaction().map_err(|error| error.to_string())?;
            ensure_blob_quota(&transaction, &session.module_id, &write.key, byte_size)?;
            transaction
                .execute(
                    "INSERT INTO custom_module_blobs (
                        module_id, key, content_sha256, mime_type, byte_size
                     ) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(module_id, key) DO UPDATE SET
                        content_sha256 = excluded.content_sha256,
                        mime_type = excluded.mime_type,
                        byte_size = excluded.byte_size,
                        updated_at = CURRENT_TIMESTAMP",
                    params![session.module_id, write.key, sha256, write.mime_type, byte_size],
                )
                .map_err(|error| error.to_string())?;
            transaction.commit().map_err(|error| error.to_string())
        });
        if let Err(error) = update {
            let _ = remove_unreferenced_blob(storage, paths, &session.module_id, &sha256);
            return Err(error);
        }
        if let Some(previous) = previous_sha256.filter(|previous| previous != &sha256) {
            remove_unreferenced_blob(storage, paths, &session.module_id, &previous)?;
        }
        Ok(json!({
            "key": write.key,
            "sha256": sha256,
            "mimeType": write.mime_type,
            "byteSize": byte_size,
        }))
    })();
    let _ = fs::remove_file(&write.path);
    result
}

fn abort_blob_write(session: &RuntimeSession, payload: &Value) -> Result<Value, String> {
    let token = payload
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "blobs.abort requires a token".to_string())?;
    if let Some(write) = session
        .blob_writes
        .lock()
        .map_err(|_| "Custom Module blob-write lock is poisoned".to_string())?
        .remove(token)
    {
        drop(write.file);
        let _ = fs::remove_file(write.path);
    }
    Ok(json!(true))
}

fn read_blob(
    storage: &Storage,
    paths: &AppPaths,
    module_id: &str,
    payload: &Value,
) -> Result<Value, String> {
    let key = bridge_key(payload)?;
    let offset = payload.get("offset").and_then(Value::as_u64).unwrap_or(0);
    let length = payload
        .get("length")
        .and_then(Value::as_u64)
        .unwrap_or(MAX_BLOB_CHUNK_BYTES as u64)
        .min(MAX_BLOB_CHUNK_BYTES as u64) as usize;
    let metadata: Option<(String, String, i64, String)> = storage.with_connection(|connection| {
        connection
            .query_row(
                "SELECT content_sha256, mime_type, byte_size, updated_at
                 FROM custom_module_blobs WHERE module_id = ?1 AND key = ?2",
                params![module_id, key],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|error| error.to_string())
    })?;
    let Some((sha256, mime_type, byte_size, updated_at)) = metadata else {
        return Ok(Value::Null);
    };
    let mut file = File::open(blob_content_path(paths, module_id, &sha256))
        .map_err(|error| format!("failed to read Custom Module blob: {error}"))?;
    if file.metadata().map_err(|error| error.to_string())?.len() != byte_size as u64 {
        return Err("Custom Module blob failed its integrity size check".into());
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("failed to seek Custom Module blob: {error}"))?;
    let mut bytes = vec![0; length];
    let count = file
        .read(&mut bytes)
        .map_err(|error| format!("failed to read Custom Module blob: {error}"))?;
    bytes.truncate(count);
    Ok(json!({
        "key": key,
        "sha256": sha256,
        "mimeType": mime_type,
        "byteSize": byte_size,
        "updatedAt": updated_at,
        "offset": offset,
        "dataBase64": BASE64.encode(bytes),
        "eof": offset.saturating_add(count as u64) >= byte_size as u64,
    }))
}

fn list_blobs(storage: &Storage, module_id: &str) -> Result<Value, String> {
    storage.with_connection(|connection| {
        let mut statement = connection
            .prepare(
                "SELECT key, content_sha256, mime_type, byte_size, updated_at
                 FROM custom_module_blobs WHERE module_id = ?1 ORDER BY key",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([module_id], |row| {
                Ok(json!({
                    "key": row.get::<_, String>(0)?,
                    "sha256": row.get::<_, String>(1)?,
                    "mimeType": row.get::<_, String>(2)?,
                    "byteSize": row.get::<_, i64>(3)?,
                    "updatedAt": row.get::<_, String>(4)?,
                }))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(json!(rows))
    })
}

fn delete_blob(
    storage: &Storage,
    paths: &AppPaths,
    module_id: &str,
    payload: &Value,
) -> Result<Value, String> {
    let key = bridge_key(payload)?;
    let previous: Option<String> = storage.with_connection(|connection| {
        connection
            .query_row(
                "SELECT content_sha256 FROM custom_module_blobs WHERE module_id = ?1 AND key = ?2",
                params![module_id, key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    })?;
    storage.with_connection(|connection| {
        connection
            .execute(
                "DELETE FROM custom_module_blobs WHERE module_id = ?1 AND key = ?2",
                params![module_id, key],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })?;
    if let Some(sha256) = previous {
        remove_unreferenced_blob(storage, paths, module_id, &sha256)?;
    }
    Ok(json!(true))
}

fn delete_document(
    storage: &Storage,
    paths: &AppPaths,
    module_id: &str,
    key: &str,
) -> Result<Value, String> {
    let previous_sha256 = storage.with_connection_mut(|connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let previous = transaction
            .query_row(
                "SELECT content_sha256 FROM custom_module_documents
                 WHERE module_id = ?1 AND key = ?2",
                params![module_id, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM custom_module_documents WHERE module_id = ?1 AND key = ?2",
                params![module_id, key],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(previous)
    })?;
    if let Some(sha256) = previous_sha256 {
        remove_unreferenced_document(storage, paths, module_id, &sha256)?;
    }
    Ok(json!(true))
}

fn ensure_storage_quota(
    connection: &rusqlite::Connection,
    module_id: &str,
    key: &str,
    byte_size: i64,
) -> Result<(), String> {
    let (existing, key_count): (i64, i64) = connection
        .query_row(
            "SELECT COALESCE(SUM(byte_size), 0), COUNT(*) FROM custom_module_storage
             WHERE module_id = ?1 AND key <> ?2",
            params![module_id, key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    if key_count >= MAX_STORAGE_KEYS {
        return Err("Custom Module storage key limit exceeded".into());
    }
    if existing.saturating_add(byte_size) > STORAGE_QUOTA_BYTES {
        return Err("Custom Module storage quota exceeded".into());
    }
    Ok(())
}

fn selected_file_allowed(path: &Path, permission: &CustomModuleFilePermission) -> bool {
    permission.extensions.is_empty()
        || path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .is_some_and(|extension| permission.extensions.contains(&extension))
}

async fn select_module_file(
    app: &tauri::AppHandle,
    session: &RuntimeSession,
    permission: &CustomModuleFilePermission,
    save: bool,
    payload: &Value,
) -> Result<Value, String> {
    use tauri_plugin_dialog::DialogExt;

    if (save && !permission.save) || (!save && !permission.open) {
        return Err("Custom Module file operation is not granted".into());
    }
    let mut picker = app.dialog().file();
    if let Some(main_webview) = app.get_webview_window(crate::window_state::MAIN_WINDOW_LABEL) {
        picker = picker.set_parent(&main_webview.as_ref().window());
    }
    if !permission.extensions.is_empty() {
        let extensions = permission
            .extensions
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        picker = picker.add_filter("Allowed files", &extensions);
    }
    if save {
        if let Some(suggested_name) = payload.get("suggestedName").and_then(Value::as_str) {
            let file_name = Path::new(suggested_name)
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty() && name.len() <= 255)
                .ok_or_else(|| "files.beginSave suggestedName is invalid".to_string())?;
            picker = picker.set_file_name(file_name);
        }
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if save {
        picker.save_file(move |selection| {
            let _ = sender.send(selection.and_then(|path| path.into_path().ok()));
        });
    } else {
        picker.pick_file(move |selection| {
            let _ = sender.send(selection.and_then(|path| path.into_path().ok()));
        });
    }
    let Some(selected) = receiver
        .await
        .map_err(|_| "Custom Module file picker was closed unexpectedly".to_string())?
    else {
        return Ok(Value::Null);
    };
    if !selected_file_allowed(&selected, permission) {
        return Err("selected file does not match the granted extension filters".into());
    }
    let session = session.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let token = format!("{:032x}", rand::random::<u128>());
        let name = selected
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file")
            .to_string();
        let (file_token, byte_size) = if save {
            let parent = selected
                .parent()
                .ok_or_else(|| "selected save target has no parent directory".to_string())?;
            let temporary = parent.join(format!(".kkterm-save-{token}.tmp"));
            let file = File::create(&temporary)
                .map_err(|error| format!("failed to create temporary save file: {error}"))?;
            (
                FileToken::Write {
                    target: selected,
                    temporary,
                    file,
                    byte_size: 0,
                },
                0,
            )
        } else {
            let canonical = fs::canonicalize(&selected)
                .map_err(|error| format!("failed to resolve selected file: {error}"))?;
            let metadata = canonical
                .metadata()
                .map_err(|error| format!("failed to inspect selected file: {error}"))?;
            if !metadata.is_file() {
                return Err("selected path is not a regular file".into());
            }
            let byte_size = metadata.len();
            (
                FileToken::Read {
                    path: canonical,
                    byte_size,
                },
                byte_size,
            )
        };
        session
            .file_tokens
            .lock()
            .map_err(|_| "Custom Module file-token lock is poisoned".to_string())?
            .insert(token.clone(), file_token);
        Ok(json!({
            "token": token,
            "name": name,
            "byteSize": byte_size,
            "writable": save,
            "maxChunkBytes": MAX_BLOB_CHUNK_BYTES,
        }))
    })
    .await
    .map_err(|error| format!("Custom Module file worker failed: {error}"))?
}

fn read_selected_file(session: &RuntimeSession, payload: &Value) -> Result<Value, String> {
    let token = payload
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "files.read requires a token".to_string())?;
    let offset = payload.get("offset").and_then(Value::as_u64).unwrap_or(0);
    let length = payload
        .get("length")
        .and_then(Value::as_u64)
        .unwrap_or(MAX_BLOB_CHUNK_BYTES as u64)
        .min(MAX_BLOB_CHUNK_BYTES as u64) as usize;
    let tokens = session
        .file_tokens
        .lock()
        .map_err(|_| "Custom Module file-token lock is poisoned".to_string())?;
    let FileToken::Read { path, byte_size } = tokens
        .get(token)
        .ok_or_else(|| "Custom Module file token is invalid or expired".to_string())?
    else {
        return Err("Custom Module file token is not readable".into());
    };
    let mut file = File::open(path).map_err(|error| format!("failed to open selected file: {error}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("failed to seek selected file: {error}"))?;
    let mut bytes = vec![0; length];
    let count = file
        .read(&mut bytes)
        .map_err(|error| format!("failed to read selected file: {error}"))?;
    bytes.truncate(count);
    Ok(json!({
        "offset": offset,
        "dataBase64": BASE64.encode(bytes),
        "eof": offset.saturating_add(count as u64) >= *byte_size,
    }))
}

fn write_selected_file(session: &RuntimeSession, payload: &Value) -> Result<Value, String> {
    let token = payload
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "files.write requires a token".to_string())?;
    let encoded = payload
        .get("dataBase64")
        .and_then(Value::as_str)
        .ok_or_else(|| "files.write requires dataBase64".to_string())?;
    let bytes = BASE64
        .decode(encoded)
        .map_err(|error| format!("invalid selected-file chunk: {error}"))?;
    if bytes.len() > MAX_BLOB_CHUNK_BYTES {
        return Err("Custom Module file chunk exceeds 1 MiB".into());
    }
    let mut tokens = session
        .file_tokens
        .lock()
        .map_err(|_| "Custom Module file-token lock is poisoned".to_string())?;
    let FileToken::Write {
        file, byte_size, ..
    } = tokens
        .get_mut(token)
        .ok_or_else(|| "Custom Module file token is invalid or expired".to_string())?
    else {
        return Err("Custom Module file token is not writable".into());
    };
    file.write_all(&bytes)
        .map_err(|error| format!("failed to write selected file: {error}"))?;
    *byte_size = byte_size.saturating_add(bytes.len() as u64);
    Ok(json!({ "byteSize": *byte_size }))
}

fn commit_selected_file(session: &RuntimeSession, payload: &Value) -> Result<Value, String> {
    let token = payload
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "files.commit requires a token".to_string())?;
    let selected = session
        .file_tokens
        .lock()
        .map_err(|_| "Custom Module file-token lock is poisoned".to_string())?
        .remove(token)
        .ok_or_else(|| "Custom Module file token is invalid or expired".to_string())?;
    let FileToken::Write {
        target,
        temporary,
        file,
        byte_size,
    } = selected
    else {
        return Err("Custom Module file token is not writable".into());
    };
    file.sync_all()
        .map_err(|error| format!("failed to flush selected file: {error}"))?;
    drop(file);
    let backup = target.with_extension(format!("kkterm-backup-{:016x}", rand::random::<u64>()));
    let had_target = target.exists();
    if had_target {
        fs::rename(&target, &backup)
            .map_err(|error| format!("failed to stage existing save target: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, &target) {
        if had_target {
            let _ = fs::rename(&backup, &target);
        }
        let _ = fs::remove_file(&temporary);
        return Err(format!("failed to commit selected file: {error}"));
    }
    if had_target {
        let _ = fs::remove_file(backup);
    }
    Ok(json!({ "byteSize": byte_size }))
}

fn close_selected_file(session: &RuntimeSession, payload: &Value) -> Result<Value, String> {
    let token = payload
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "files.close requires a token".to_string())?;
    if let Some(FileToken::Write {
        temporary, file, ..
    }) = session
        .file_tokens
        .lock()
        .map_err(|_| "Custom Module file-token lock is poisoned".to_string())?
        .remove(token)
    {
        drop(file);
        let _ = fs::remove_file(temporary);
    }
    Ok(json!(true))
}

fn network_address_is_private(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(address) => {
            let octets = address.octets();
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_broadcast()
                || address.is_documentation()
                || address.is_unspecified()
                || address.is_multicast()
                || octets[0] == 0
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
                || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
                || (octets[0] == 198 && matches!(octets[1], 18 | 19))
                || octets[0] >= 240
        }
        std::net::IpAddr::V6(address) => {
            if let Some(ipv4) = address.to_ipv4_mapped() {
                return network_address_is_private(std::net::IpAddr::V4(ipv4));
            }
            let segments = address.segments();
            address.is_loopback()
                || address.is_unique_local()
                || address.is_unicast_link_local()
                || address.is_unspecified()
                || address.is_multicast()
                || segments[0] & 0xe000 != 0x2000
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
                || (segments[0] == 0x2001 && segments[1] == 0x0002)
                || (segments[0] == 0x2001 && segments[1] == 0)
                || segments[0] == 0x2002
                || (segments[0] & 0xfff0 == 0x3ff0)
        }
    }
}

fn custom_module_secret_key(payload: &Value) -> Result<&str, String> {
    let key = payload
        .get("key")
        .and_then(Value::as_str)
        .ok_or_else(|| "Custom Module secret operation requires a key".to_string())?;
    validate_custom_module_secret_key(key)?;
    Ok(key)
}

fn validate_custom_module_secret_key(key: &str) -> Result<(), String> {
    if key.is_empty()
        || key.len() > 64
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err("Custom Module secret key is invalid".into());
    }
    Ok(())
}

fn custom_module_secret_owner_id(module_id: &str, key: &str) -> String {
    let digest = Sha256::digest(module_id.as_bytes());
    format!("{}:{key}", encode_hex(&digest[..16]))
}

async fn request_custom_module_secret(
    app: &tauri::AppHandle,
    runtime: &CustomModuleRuntime,
    session: &RuntimeSession,
    session_id: &str,
    payload: &Value,
) -> Result<Value, String> {
    let key = custom_module_secret_key(payload)?.to_string();
    let label = payload
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or(&key)
        .trim();
    if label.is_empty() || label.len() > 128 || label.chars().any(char::is_control) {
        return Err("Custom Module secret label is invalid".into());
    }
    let request_id = format!("{:032x}", rand::random::<u128>());
    let (sender, receiver) = tokio::sync::oneshot::channel();
    runtime.lock_secret_prompts()?.insert(
        request_id.clone(),
        PendingSecretPrompt {
            session_id: session_id.to_string(),
            module_id: session.module_id.clone(),
            key: key.clone(),
            completion: sender,
        },
    );
    if let Err(error) = app.emit_to(
        crate::window_state::MAIN_WINDOW_LABEL,
        "custom-module-secret-prompt",
        json!({
            "requestId": request_id,
            "moduleId": session.module_id,
            "key": key,
            "label": label,
        }),
    ) {
        runtime.lock_secret_prompts()?.remove(&request_id);
        return Err(format!("failed to request Custom Module secret entry: {error}"));
    }
    let stored = match tokio::time::timeout(Duration::from_secs(300), receiver).await {
        Ok(Ok(stored)) => stored,
        Ok(Err(_)) => false,
        Err(_) => {
            runtime.lock_secret_prompts()?.remove(&request_id);
            return Err("Custom Module secret entry timed out".into());
        }
    };
    Ok(json!({ "stored": stored }))
}

#[tauri::command]
pub fn resolve_custom_module_secret_prompt(
    request: ResolveCustomModuleSecretPromptRequest,
    webview_window: WebviewWindow,
    storage: tauri::State<'_, Storage>,
    secret_store: tauri::State<'_, secrets::Secrets>,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<bool, String> {
    if webview_window.label() != crate::window_state::MAIN_WINDOW_LABEL {
        return Err("Custom Module secret prompts can be resolved only by the main window".into());
    }
    let pending = runtime
        .lock_secret_prompts()?
        .remove(&request.request_id)
        .ok_or_else(|| "Custom Module secret prompt is invalid or expired".to_string())?;
    let stored = if let Some(secret) = request.secret.filter(|secret| !secret.is_empty()) {
        if secret.len() > 64 * 1024 {
            let _ = pending.completion.send(false);
            return Err("Custom Module secret is too large".into());
        }
        let owner_id = custom_module_secret_owner_id(&pending.module_id, &pending.key);
        secret_store.store_secret(secrets::StoreSecretRequest::custom_module_secret(
            owner_id.clone(),
            secret,
        ))?;
        if let Err(error) = storage.with_connection(|connection| {
            connection
                .execute(
                    "INSERT INTO custom_module_secret_refs (module_id, key, owner_id)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(module_id, key) DO UPDATE SET
                        owner_id = excluded.owner_id,
                        updated_at = CURRENT_TIMESTAMP",
                    params![pending.module_id, pending.key, owner_id],
                )
                .map_err(|error| error.to_string())?;
            Ok(())
        }) {
            let _ = secret_store.delete_secret(secrets::SecretReferenceRequest::custom_module_secret(
                custom_module_secret_owner_id(&pending.module_id, &pending.key),
            ));
            let _ = pending.completion.send(false);
            return Err(error);
        }
        true
    } else {
        false
    };
    let _ = pending.completion.send(stored);
    Ok(stored)
}

fn custom_module_secret_presence(
    secret_store: &secrets::Secrets,
    module_id: &str,
    payload: &Value,
) -> Result<Value, String> {
    let key = custom_module_secret_key(payload)?;
    let presence = secret_store.secret_exists(secrets::SecretReferenceRequest::custom_module_secret(
        custom_module_secret_owner_id(module_id, key),
    ))?;
    Ok(json!({ "exists": presence.exists() }))
}

fn delete_custom_module_secret(
    storage: &Storage,
    secret_store: &secrets::Secrets,
    module_id: &str,
    payload: &Value,
) -> Result<Value, String> {
    let key = custom_module_secret_key(payload)?;
    let owner_id = custom_module_secret_owner_id(module_id, key);
    secret_store.delete_secret(secrets::SecretReferenceRequest::custom_module_secret(
        owner_id,
    ))?;
    storage.with_connection(|connection| {
        connection
            .execute(
                "DELETE FROM custom_module_secret_refs WHERE module_id = ?1 AND key = ?2",
                params![module_id, key],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })?;
    Ok(json!(true))
}

async fn validate_network_target(
    permission: &CustomModuleNetworkPermission,
    url: &Url,
) -> Result<std::net::SocketAddr, String> {
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("network.fetch URL may not contain credentials or a fragment".into());
    }
    if url.scheme() != "https" && !(url.scheme() == "http" && permission.allow_private_network) {
        return Err("network.fetch requires HTTPS unless private-network access is granted".into());
    }
    let origin = url.origin().ascii_serialization();
    if !permission.origins.contains(&origin) {
        return Err(format!("network.fetch origin '{origin}' is not granted"));
    }
    let host = url
        .host_str()
        .ok_or_else(|| "network.fetch URL has no host".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "network.fetch URL has no usable port".to_string())?;
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| format!("network.fetch DNS lookup failed: {error}"))?
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err("network.fetch DNS lookup returned no addresses".into());
    }
    if !permission.allow_private_network
        && addresses
            .iter()
            .any(|address| network_address_is_private(address.ip()))
    {
        return Err("network.fetch target resolves to a private or local address".into());
    }
    Ok(addresses[0])
}

fn request_headers(payload: &Value) -> Result<reqwest::header::HeaderMap, String> {
    let mut output = reqwest::header::HeaderMap::new();
    let Some(headers) = payload.get("headers") else {
        return Ok(output);
    };
    let headers = headers
        .as_object()
        .ok_or_else(|| "network.fetch headers must be an object".to_string())?;
    if headers.len() > 64 {
        return Err("network.fetch has too many headers".into());
    }
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "authorization"
                | "cookie"
                | "host"
                | "connection"
                | "content-length"
                | "proxy-authorization"
                | "proxy-connection"
                | "te"
                | "trailer"
                | "transfer-encoding"
                | "upgrade"
        ) || lower.starts_with("sec-")
        {
            return Err(format!("network.fetch header '{name}' is controlled by the host"));
        }
        let value = value
            .as_str()
            .ok_or_else(|| format!("network.fetch header '{name}' must be a string"))?;
        let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("invalid network.fetch header name: {error}"))?;
        let value = reqwest::header::HeaderValue::from_str(value)
            .map_err(|error| format!("invalid network.fetch header value: {error}"))?;
        output.insert(name, value);
    }
    Ok(output)
}

async fn module_network_fetch(
    permission: &CustomModuleNetworkPermission,
    app: &tauri::AppHandle,
    module_id: &str,
    payload: &Value,
) -> Result<Value, String> {
    let raw_url = payload
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "network.fetch requires a URL".to_string())?;
    let mut url = Url::parse(raw_url).map_err(|error| format!("invalid network.fetch URL: {error}"))?;
    let method = payload
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET")
        .to_ascii_uppercase();
    if !permission.methods.contains(&method) {
        return Err(format!("network.fetch method '{method}' is not granted"));
    }
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("invalid network.fetch method: {error}"))?;
    let mut headers = request_headers(payload)?;
    if let Some(binding) = payload.get("secret") {
        let binding = binding
            .as_object()
            .ok_or_else(|| "network.fetch secret must be an object".to_string())?;
        let key = binding
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| "network.fetch secret requires a key".to_string())?;
        validate_custom_module_secret_key(key)?;
        let header_name = binding
            .get("header")
            .and_then(Value::as_str)
            .unwrap_or("authorization")
            .to_ascii_lowercase();
        if !matches!(header_name.as_str(), "authorization" | "x-api-key" | "api-key") {
            return Err("network.fetch secret header must be Authorization, X-API-Key, or API-Key".into());
        }
        let prefix = binding
            .get("prefix")
            .and_then(Value::as_str)
            .unwrap_or("");
        if prefix.len() > 32 || prefix.chars().any(char::is_control) {
            return Err("network.fetch secret prefix is invalid".into());
        }
        let owner_id = custom_module_secret_owner_id(module_id, key);
        let worker_app = app.clone();
        let secret = tauri::async_runtime::spawn_blocking(move || {
            worker_app
                .state::<secrets::Secrets>()
                .read_custom_module_secret(owner_id)
        })
        .await
        .map_err(|error| format!("Custom Module secret worker failed: {error}"))??
        .ok_or_else(|| "the requested Custom Module secret is not stored".to_string())?;
        let name = reqwest::header::HeaderName::from_bytes(header_name.as_bytes())
            .map_err(|error| format!("invalid network.fetch secret header: {error}"))?;
        let mut value = reqwest::header::HeaderValue::from_str(&format!("{prefix}{secret}"))
            .map_err(|_| "stored Custom Module secret cannot be used as an HTTP header".to_string())?;
        value.set_sensitive(true);
        headers.insert(name, value);
    }
    let body = payload
        .get("bodyBase64")
        .and_then(Value::as_str)
        .map(|body| {
            BASE64
                .decode(body)
                .map_err(|error| format!("invalid network.fetch bodyBase64: {error}"))
        })
        .transpose()?
        .unwrap_or_default();
    if body.len() > MAX_NETWORK_REQUEST_BYTES {
        return Err("network.fetch request body exceeds 8 MiB".into());
    }
    let max_response = permission
        .max_response_bytes
        .min(MAX_NETWORK_RESPONSE_BYTES);
    for redirect_count in 0..=5 {
        let pinned_address = validate_network_target(permission, &url).await?;
        let host = url
            .host_str()
            .ok_or_else(|| "network.fetch URL has no host".to_string())?
            .to_string();
        let client = crate::net::proxy::apply_async(
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .resolve(&host, pinned_address),
        )
        .build()
        .map_err(|error| format!("failed to create network.fetch client: {error}"))?;
        let mut response = client
            .request(method.clone(), url.clone())
            .headers(headers.clone())
            .body(body.clone())
            .send()
            .await
            .map_err(|error| format!("network.fetch failed: {error}"))?;
        if response.status().is_redirection() && matches!(method, reqwest::Method::GET | reqwest::Method::HEAD) {
            if redirect_count == 5 {
                return Err("network.fetch exceeded 5 redirects".into());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "network.fetch redirect has no valid Location".to_string())?;
            url = url
                .join(location)
                .map_err(|error| format!("invalid network.fetch redirect: {error}"))?;
            continue;
        }
        if response.content_length().is_some_and(|size| size > max_response) {
            return Err("network.fetch response exceeds the granted byte limit".into());
        }
        let status = response.status().as_u16();
        let final_url = response.url().as_str().to_string();
        let mut response_headers = serde_json::Map::new();
        let mut header_bytes = 0_usize;
        for (name, value) in response.headers() {
            if name == reqwest::header::SET_COOKIE {
                continue;
            }
            let Ok(value) = value.to_str() else { continue };
            header_bytes = header_bytes.saturating_add(name.as_str().len() + value.len());
            if header_bytes > 64 * 1024 {
                return Err("network.fetch response headers are too large".into());
            }
            response_headers.insert(name.as_str().to_string(), json!(value));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("failed to read network.fetch response: {error}"))?
        {
            if (bytes.len() as u64).saturating_add(chunk.len() as u64) > max_response {
                return Err("network.fetch response exceeds the granted byte limit".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(json!({
            "status": status,
            "url": final_url,
            "headers": response_headers,
            "bodyBase64": BASE64.encode(bytes),
        }));
    }
    Err("network.fetch redirect loop did not terminate".into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomModuleBridgeError {
    code: &'static str,
    message: String,
}

impl From<String> for CustomModuleBridgeError {
    fn from(message: String) -> Self {
        let lower = message.to_ascii_lowercase();
        let code = if lower.contains("permission") || lower.contains("not been granted") {
            "permission_denied"
        } else if lower.contains("cancel") {
            "cancelled"
        } else if lower.contains("quota") || lower.contains("limit exceeded") {
            "quota_exceeded"
        } else if lower.contains("rate limit") {
            "rate_limited"
        } else if lower.contains("not found") || lower.contains("is not installed") {
            "not_found"
        } else if lower.contains("integrity")
            || lower.contains("corrupt")
            || lower.contains("hash collision")
        {
            "integrity_error"
        } else if lower.contains("invalid")
            || lower.contains("requires")
            || lower.contains("unsupported")
            || lower.contains("unknown")
            || lower.contains("must ")
        {
            "invalid_request"
        } else if lower.contains("too large") || lower.contains("exceeds") {
            "size_limit_exceeded"
        } else if lower.contains("network") || lower.contains("http") || lower.contains("dns") {
            "network_error"
        } else {
            "host_error"
        };
        Self { code, message }
    }
}

#[tauri::command]
pub async fn custom_module_bridge(
    request: CustomModuleBridgeRequest,
    webview_window: WebviewWindow,
    app: tauri::AppHandle,
    storage: tauri::State<'_, Storage>,
    secret_store: tauri::State<'_, secrets::Secrets>,
    paths: tauri::State<'_, AppPaths>,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<Value, CustomModuleBridgeError> {
    let operation = request.operation.as_str();
    let should_run_blocking = operation.starts_with("storage.")
        || operation.starts_with("documents.")
        || operation.starts_with("blobs.")
        || matches!(
            operation,
            "files.read"
                | "files.write"
                | "files.commit"
                | "files.close"
                | "secrets.has"
                | "secrets.delete"
        );
    if should_run_blocking {
        let worker_app = app.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let state_app = worker_app.clone();
            let storage = state_app.state::<Storage>();
            let secret_store = state_app.state::<secrets::Secrets>();
            let paths = state_app.state::<AppPaths>();
            let runtime = state_app.state::<CustomModuleRuntime>();
            tauri::async_runtime::block_on(custom_module_bridge_inner(
                request,
                webview_window,
                worker_app,
                storage,
                secret_store,
                paths,
                runtime,
            ))
            .map_err(CustomModuleBridgeError::from)
        })
        .await
        .map_err(|error| CustomModuleBridgeError {
            code: "host_error",
            message: format!("Custom Module host worker failed: {error}"),
        })?;
    }
    custom_module_bridge_inner(
        request,
        webview_window,
        app,
        storage,
        secret_store,
        paths,
        runtime,
    )
    .await
    .map_err(CustomModuleBridgeError::from)
}

async fn custom_module_bridge_inner(
    request: CustomModuleBridgeRequest,
    webview_window: WebviewWindow,
    app: tauri::AppHandle,
    storage: tauri::State<'_, Storage>,
    secret_store: tauri::State<'_, secrets::Secrets>,
    paths: tauri::State<'_, AppPaths>,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<Value, String> {
    let label = webview_window.label();
    if !label.starts_with("custom-module-") {
        return Err("Custom Module bridge is available only to registered module WebViews".into());
    }
    let max_payload_bytes = if request.operation == "documents.set" {
        MAX_DOCUMENT_BRIDGE_PAYLOAD_BYTES
    } else {
        MAX_BRIDGE_PAYLOAD_BYTES
    };
    if serde_json::to_vec(&request.payload)
        .map_err(|error| error.to_string())?
        .len()
        > max_payload_bytes
    {
        return Err("Custom Module bridge payload is too large".into());
    }
    let session = runtime.session(label)?;
    match request.operation.as_str() {
        "host.ready" => {
            if session.ready_sent.swap(true, Ordering::Relaxed) {
                return Ok(json!(true));
            }
            let _ = app.emit(
                "custom-module-ready",
                json!({
                    "moduleId": session.module_id,
                    "contributionId": session.contribution_id,
                    "sessionId": label,
                }),
            );
            Ok(json!(true))
        }
        "host.getContext" => Ok(json!({
            "apiVersion": HOST_API_VERSION,
            "theme": session.theme,
            "locale": session.locale,
        })),
        "host.openExternal" => {
            if !session.permissions.contains("openExternal") {
                return Err("Custom Module has not been granted openExternal permission".into());
            }
            let raw_url = request
                .payload
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "openExternal requires a URL".to_string())?;
            let url = Url::parse(raw_url).map_err(|error| format!("invalid URL: {error}"))?;
            if !matches!(url.scheme(), "http" | "https") {
                return Err("Custom Modules may open only HTTP or HTTPS URLs".into());
            }
            let mut last_open = session
                .last_external_open
                .lock()
                .map_err(|_| "Custom Module external-link lock is poisoned".to_string())?;
            if last_open.is_some_and(|last| last.elapsed() < Duration::from_secs(1)) {
                return Err("Custom Module external-link requests are rate limited".into());
            }
            *last_open = Some(Instant::now());
            app.opener()
                .open_url(url.as_str(), None::<&str>)
                .map_err(|error| error.to_string())?;
            Ok(json!(true))
        }
        operation if operation.starts_with("storage.") => {
            if !session.permissions.contains("storage") {
                return Err("Custom Module has not been granted storage permission".into());
            }
            storage.with_connection(|connection| match operation {
                "storage.get" => {
                    let key = bridge_key(&request.payload)?;
                    let value: Option<String> = connection
                        .query_row(
                            "SELECT value_json FROM custom_module_storage WHERE module_id = ?1 AND key = ?2",
                            params![session.module_id, key],
                            |row| row.get(0),
                        )
                        .optional()
                        .map_err(|error| error.to_string())?;
                    value
                        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
                        .transpose()
                        .map(|value| value.unwrap_or(Value::Null))
                }
                "storage.set" => {
                    let key = bridge_key(&request.payload)?;
                    let value = request
                        .payload
                        .get("value")
                        .ok_or_else(|| "storage.set requires a value".to_string())?;
                    let value_json = serde_json::to_string(value).map_err(|error| error.to_string())?;
                    let byte_size = i64::try_from(key.len() + value_json.len())
                        .map_err(|_| "Custom Module storage value is too large".to_string())?;
                    ensure_storage_quota(connection, &session.module_id, key, byte_size)?;
                    connection
                        .execute(
                            "INSERT INTO custom_module_storage (module_id, key, value_json, byte_size)
                             VALUES (?1, ?2, ?3, ?4)
                             ON CONFLICT(module_id, key) DO UPDATE SET
                                value_json = excluded.value_json,
                                byte_size = excluded.byte_size,
                                updated_at = CURRENT_TIMESTAMP",
                            params![session.module_id, key, value_json, byte_size],
                        )
                        .map_err(|error| error.to_string())?;
                    Ok(json!(true))
                }
                "storage.delete" => {
                    let key = bridge_key(&request.payload)?;
                    connection
                        .execute(
                            "DELETE FROM custom_module_storage WHERE module_id = ?1 AND key = ?2",
                            params![session.module_id, key],
                        )
                        .map_err(|error| error.to_string())?;
                    Ok(json!(true))
                }
                "storage.list" => {
                    let mut statement = connection
                        .prepare(
                            "SELECT key FROM custom_module_storage WHERE module_id = ?1 ORDER BY key",
                        )
                        .map_err(|error| error.to_string())?;
                    let keys = statement
                        .query_map([&session.module_id], |row| row.get::<_, String>(0))
                        .map_err(|error| error.to_string())?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|error| error.to_string())?;
                    Ok(json!(keys))
                }
                _ => Err("unknown Custom Module storage operation".into()),
            })
        }
        operation if operation.starts_with("documents.") => {
            if !session.permissions.contains("documentStorage") {
                return Err("Custom Module has not been granted documentStorage permission".into());
            }
            match operation {
                "documents.get" => {
                    let key = bridge_key(&request.payload)?;
                    get_document(&storage, &paths, &session.module_id, key)
                }
                "documents.set" => {
                    let key = bridge_key(&request.payload)?;
                    let value = request
                        .payload
                        .get("value")
                        .ok_or_else(|| "documents.set requires a value".to_string())?;
                    set_document(&storage, &paths, &session.module_id, key, value)
                }
                "documents.delete" => {
                    let key = bridge_key(&request.payload)?;
                    delete_document(&storage, &paths, &session.module_id, key)
                }
                "documents.list" => list_documents(&storage, &session.module_id),
                _ => Err("unknown Custom Module document operation".into()),
            }
        }
        operation if operation.starts_with("blobs.") => {
            if !session.permissions.contains("blobStorage") {
                return Err("Custom Module has not been granted blobStorage permission".into());
            }
            match operation {
                "blobs.beginWrite" => begin_blob_write(&paths, &session, &request.payload),
                "blobs.write" => blob_write_chunk(&session, &request.payload),
                "blobs.commit" => {
                    commit_blob_write(&storage, &paths, &session, &request.payload)
                }
                "blobs.abort" => abort_blob_write(&session, &request.payload),
                "blobs.read" => {
                    read_blob(&storage, &paths, &session.module_id, &request.payload)
                }
                "blobs.delete" => {
                    delete_blob(&storage, &paths, &session.module_id, &request.payload)
                }
                "blobs.list" => list_blobs(&storage, &session.module_id),
                _ => Err("unknown Custom Module blob operation".into()),
            }
        }
        operation if operation.starts_with("files.") => {
            let permission = session
                .permission_config
                .files
                .as_ref()
                .ok_or_else(|| "Custom Module has not been granted files permission".to_string())?;
            match operation {
                "files.open" => {
                    select_module_file(&app, &session, permission, false, &request.payload).await
                }
                "files.beginSave" => {
                    select_module_file(&app, &session, permission, true, &request.payload).await
                }
                "files.read" => read_selected_file(&session, &request.payload),
                "files.write" => write_selected_file(&session, &request.payload),
                "files.commit" => commit_selected_file(&session, &request.payload),
                "files.close" => close_selected_file(&session, &request.payload),
                _ => Err("unknown Custom Module file operation".into()),
            }
        }
        "network.fetch" => {
            let permission = session
                .permission_config
                .network_fetch
                .as_ref()
                .ok_or_else(|| {
                    "Custom Module has not been granted networkFetch permission".to_string()
                })?;
            if request.payload.get("secret").is_some()
                && !session.permission_config.secret_references
            {
                return Err(
                    "Custom Module has not been granted secretReferences permission".into(),
                );
            }
            module_network_fetch(permission, &app, &session.module_id, &request.payload)
                .await
        }
        operation if operation.starts_with("secrets.") => {
            if !session.permission_config.secret_references {
                return Err(
                    "Custom Module has not been granted secretReferences permission".into(),
                );
            }
            match operation {
                "secrets.has" => custom_module_secret_presence(
                    &secret_store,
                    &session.module_id,
                    &request.payload,
                ),
                "secrets.requestEntry" => {
                    request_custom_module_secret(
                        &app,
                        &runtime,
                        &session,
                        label,
                        &request.payload,
                    )
                    .await
                }
                "secrets.delete" => delete_custom_module_secret(
                    &storage,
                    &secret_store,
                    &session.module_id,
                    &request.payload,
                ),
                _ => Err("unknown Custom Module secret operation".into()),
            }
        }
        operation if operation.starts_with("ui.") => {
            if !session.permission_config.host_ui {
                return Err("Custom Module has not been granted hostUi permission".into());
            }
            let message = request
                .payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if message.len() > 500 || message.chars().any(char::is_control) {
                return Err("Custom Module host UI message is invalid".into());
            }
            match operation {
                "ui.notice" => {
                    if message.is_empty() {
                        return Err("ui.notice requires a message".into());
                    }
                    let tone = request
                        .payload
                        .get("tone")
                        .and_then(Value::as_str)
                        .unwrap_or("info");
                    if !matches!(tone, "info" | "success" | "warning" | "error") {
                        return Err("ui.notice tone is invalid".into());
                    }
                    app.emit_to(
                        crate::window_state::MAIN_WINDOW_LABEL,
                        "custom-module-host-notice",
                        json!({ "moduleId": session.module_id, "message": message, "tone": tone }),
                    )
                    .map_err(|error| error.to_string())?;
                    Ok(json!(true))
                }
                "ui.progress" | "ui.clearProgress" => {
                    let id = request
                        .payload
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "Custom Module progress requires an id".to_string())?;
                    if id.is_empty()
                        || id.len() > 64
                        || !id.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
                        })
                    {
                        return Err("Custom Module progress id is invalid".into());
                    }
                    if operation == "ui.progress" && message.is_empty() {
                        return Err("ui.progress requires a message".into());
                    }
                    let progress = request
                        .payload
                        .get("progress")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0)
                        .clamp(0.0, 100.0);
                    app.emit_to(
                        crate::window_state::MAIN_WINDOW_LABEL,
                        "custom-module-host-progress",
                        json!({
                            "moduleId": session.module_id,
                            "id": id,
                            "message": message,
                            "progress": progress,
                            "clear": operation == "ui.clearProgress",
                        }),
                    )
                    .map_err(|error| error.to_string())?;
                    Ok(json!(true))
                }
                _ => Err("unknown Custom Module host UI operation".into()),
            }
        }
        _ => Err("unknown Custom Module bridge operation".into()),
    }
}

pub fn protocol_response(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let result = (|| -> Result<(Vec<u8>, String, bool), String> {
        let runtime = context.app_handle().state::<CustomModuleRuntime>();
        let paths = context.app_handle().state::<AppPaths>();
        let route = runtime
            .lock_routes()?
            .get(context.webview_label())
            .cloned()
            .ok_or_else(|| "Custom Module route is not registered".to_string())?;
        let request_host = request.uri().host().unwrap_or_default();
        let expected_windows_host = format!("kkmodule.{}", route.origin_host);
        if request_host != route.origin_host && request_host != expected_windows_host {
            return Err("Custom Module request origin does not match its package".into());
        }
        let requested = request.uri().path().trim_start_matches('/');
        let relative = if requested.is_empty() {
            route.entrypoint.clone()
        } else {
            requested.to_string()
        };
        let mut safe_path = validate_relative_path(&relative, "Custom Module asset")?;
        let canonical_root = canonical_package_root(&paths, &route.root)?;
        let mut path = fs::canonicalize(route.root.join(&safe_path));
        if path.is_err()
            && route.routing == CustomModuleRouting::Spa
            && safe_path.extension().is_none()
        {
            safe_path = validate_relative_path(&route.entrypoint, "Custom Module entrypoint")?;
            path = fs::canonicalize(route.root.join(&safe_path));
        }
        let path = path.map_err(|error| format!("failed to resolve Custom Module asset: {error}"))?;
        if !path.starts_with(&canonical_root) {
            return Err("Custom Module asset escapes its package root".into());
        }
        if !path.is_file() {
            return Err("Custom Module asset was not found".into());
        }
        let bytes =
            fs::read(&path).map_err(|error| format!("failed to read module asset: {error}"))?;
        let mime = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .essence_str()
            .to_string();
        Ok((bytes, mime, route.clipboard_allowed))
    })();
    match result {
        Ok((body, mime, clipboard_allowed)) => tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", mime)
            .header("X-Content-Type-Options", "nosniff")
            .header("Cache-Control", "no-store")
            .header(
                "Permissions-Policy",
                if clipboard_allowed {
                    "accelerometer=(), ambient-light-sensor=(), autoplay=(), bluetooth=(), camera=(), clipboard-read=(self), clipboard-write=(self), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), window-management=(), xr-spatial-tracking=()"
                } else {
                    "accelerometer=(), ambient-light-sensor=(), autoplay=(), bluetooth=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), window-management=(), xr-spatial-tracking=()"
                },
            )
            .header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; base-uri 'none'; form-action 'none'",
            )
            .body(body)
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new())),
        Err(message) => tauri::http::Response::builder()
            .status(404)
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("X-Content-Type-Options", "nosniff")
            .body(message.into_bytes())
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::io::Cursor;
    use zip::write::SimpleFileOptions;

    fn valid_manifest() -> CustomModuleManifest {
        CustomModuleManifest {
            id: "com.kkterm.fixture".into(),
            name: "Fixture".into(),
            version: "1.0.0".into(),
            publisher: "KKTerm".into(),
            summary: "Fixture module".into(),
            api_version: 2,
            homepage: Some("https://kkterm.example".into()),
            license: CustomModuleLicense {
                name: "MIT".into(),
                file: "licenses/LICENSE".into(),
                notices_file: None,
            },
            permissions: CustomModulePermissions {
                storage: true,
                ..Default::default()
            },
            modules: vec![CustomModuleContribution {
                id: "fixture".into(),
                title: "Fixture".into(),
                icon: None,
                entrypoint: "dist/index.html".into(),
                rail_visible: true,
                routing: CustomModuleRouting::Static,
            }],
        }
    }

    fn write_package(path: &Path, unsafe_path: Option<&str>) {
        write_package_manifest(path, &valid_manifest(), unsafe_path);
    }

    fn write_package_manifest(
        path: &Path,
        manifest: &CustomModuleManifest,
        unsafe_path: Option<&str>,
    ) {
        let file = File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        writer.start_file(MANIFEST_FILE, options).unwrap();
        writer
            .write_all(&serde_json::to_vec(manifest).unwrap())
            .unwrap();
        writer.start_file("dist/index.html", options).unwrap();
        writer
            .write_all(b"<!doctype html><title>Fixture</title>")
            .unwrap();
        writer.start_file("licenses/LICENSE", options).unwrap();
        writer.write_all(b"MIT").unwrap();
        if let Some(path) = unsafe_path {
            writer.start_file(path, options).unwrap();
            writer.write_all(b"unsafe").unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn valid_manifest_passes_v2_contract() {
        validate_manifest(&valid_manifest()).unwrap();
    }

    #[test]
    fn manifest_rejects_invalid_network_permission() {
        let mut manifest = valid_manifest();
        manifest.permissions.network_fetch = Some(CustomModuleNetworkPermission {
            origins: vec!["https://example.com".into()],
            methods: vec!["CONNECT".into()],
            allow_private_network: false,
            max_response_bytes: 1024,
        });
        assert!(
            validate_manifest(&manifest)
                .unwrap_err()
                .contains("unsupported")
        );
    }

    #[test]
    fn mediated_network_rejects_non_public_and_transition_addresses() {
        use std::net::IpAddr;

        for address in [
            "127.0.0.1",
            "100.64.0.1",
            "198.18.0.1",
            "2001:db8::1",
            "2001::1",
            "2002::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(network_address_is_private(address.parse::<IpAddr>().unwrap()));
        }
        for address in ["8.8.8.8", "2606:4700:4700::1111"] {
            assert!(!network_address_is_private(address.parse::<IpAddr>().unwrap()));
        }
    }

    #[test]
    fn manifest_accepts_document_storage_permission() {
        let mut manifest = valid_manifest();
        manifest.permissions.document_storage = true;
        validate_manifest(&manifest).unwrap();
    }

    #[test]
    fn manifest_accepts_clipboard_permission() {
        let mut manifest = valid_manifest();
        manifest.permissions.clipboard = true;
        validate_manifest(&manifest).unwrap();
    }

    #[test]
    fn archive_review_requires_manifest_entrypoint_and_license() {
        let directory = tempfile::tempdir().unwrap();
        let package = directory.path().join("fixture.kkmod");
        write_package(&package, None);
        let review = inspect_archive(&package).unwrap();
        assert_eq!(review.manifest.id, "com.kkterm.fixture");
        assert_eq!(review.file_count, 3);
    }

    #[test]
    fn activity_rail_icons_are_inert_bounded_svg_data_urls_for_all_trust_levels() {
        let directory = tempfile::tempdir().unwrap();
        let paths = AppPaths::for_test(directory.path().join("data"));
        let package_path =
            modules_root(&paths).join(package_relative_path("com.kkterm.fixture", "1.0.0"));
        fs::create_dir_all(package_path.join("dist")).unwrap();
        fs::write(
            package_path.join("dist/icon.svg"),
            br#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>"#,
        )
        .unwrap();
        let mut manifest = valid_manifest();
        manifest.modules[0].icon = Some("dist/icon.svg".into());

        let icons = activity_rail_icon_data_urls(&paths, &package_path, &manifest);
        assert!(
            icons["fixture"].starts_with("data:image/svg+xml;base64,"),
            "validated SVG should be exposed only as an inert image data URL"
        );

        fs::write(
            package_path.join("dist/icon.svg"),
            br#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#,
        )
        .unwrap();
        assert!(
            activity_rail_icon_data_urls(&paths, &package_path, &manifest).is_empty(),
            "active SVG content must fall back to the generic glyph"
        );

        fs::write(
            package_path.join("dist/icon.svg"),
            vec![b'x'; MAX_ACTIVITY_RAIL_ICON_BYTES as usize + 1],
        )
        .unwrap();
        assert!(
            activity_rail_icon_data_urls(&paths, &package_path, &manifest).is_empty(),
            "oversized icons must fall back to the generic glyph"
        );
    }

    #[test]
    fn archive_rejects_forbidden_executable_payload() {
        let directory = tempfile::tempdir().unwrap();
        let package = directory.path().join("fixture.kkmod");
        write_package(&package, Some("dist/helper.exe"));
        assert!(
            inspect_archive(&package)
                .unwrap_err()
                .contains("forbidden executable")
        );
    }

    #[test]
    fn archive_rejects_non_static_payload_types() {
        let directory = tempfile::tempdir().unwrap();
        let package = directory.path().join("fixture.kkmod");
        write_package(&package, Some("dist/helper.py"));
        assert!(
            inspect_archive(&package)
                .unwrap_err()
                .contains("unsupported payload type")
        );
    }

    #[test]
    fn packaged_browser_runtime_data_types_are_allowed() {
        for asset in [
            "dist/runtime.wasm.gz",
            "dist/cmaps/identity.bcmap",
            "dist/fonts/standard.pfb",
            "dist/locales/en.ftl",
            "dist/profiles/srgb.icc",
            "dist/python/package.whl",
            "dist/python/stdlib.zip",
        ] {
            assert!(is_allowed_payload(Path::new(asset)), "rejected {asset}");
        }
        assert!(!is_allowed_payload(Path::new("dist/runtime.py")));
    }

    #[test]
    fn archive_rejects_case_colliding_paths() {
        let directory = tempfile::tempdir().unwrap();
        let package = directory.path().join("fixture.kkmod");
        let buffer = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(buffer);
        let options = SimpleFileOptions::default();
        writer.start_file(MANIFEST_FILE, options).unwrap();
        writer
            .write_all(&serde_json::to_vec(&valid_manifest()).unwrap())
            .unwrap();
        writer.start_file("dist/index.html", options).unwrap();
        writer.write_all(b"one").unwrap();
        writer.start_file("DIST/INDEX.HTML", options).unwrap();
        writer.write_all(b"two").unwrap();
        writer.start_file("licenses/LICENSE", options).unwrap();
        writer.write_all(b"MIT").unwrap();
        fs::write(&package, writer.finish().unwrap().into_inner()).unwrap();
        assert!(
            inspect_archive(&package)
                .unwrap_err()
                .contains("duplicate path")
        );
    }

    #[test]
    fn manifest_rejects_windows_reserved_paths() {
        let mut manifest = valid_manifest();
        manifest.license.file = "licenses/CON.txt".into();
        assert!(
            validate_manifest(&manifest)
                .unwrap_err()
                .contains("unsafe path")
        );
    }

    #[test]
    fn manifest_rejects_unknown_contract_fields() {
        let mut value = serde_json::to_value(valid_manifest()).unwrap();
        value["nativeExecutable"] = json!("helper.exe");
        assert!(serde_json::from_value::<CustomModuleManifest>(value).is_err());
    }

    #[test]
    fn manifest_rejects_unimplemented_permission_fields() {
        let mut value = serde_json::to_value(valid_manifest()).unwrap();
        value["permissions"]["connectionsRead"] = json!(false);
        assert!(serde_json::from_value::<CustomModuleManifest>(value).is_err());
    }

    #[test]
    fn manifest_rejects_unsupported_host_api_versions() {
        let mut manifest = valid_manifest();
        manifest.api_version = HOST_API_VERSION + 1;
        let error = validate_manifest(&manifest).unwrap_err();
        assert!(error.contains(&format!(
            "module requires host API {}",
            HOST_API_VERSION + 1
        )));
    }

    #[test]
    fn catalog_signature_verifies_the_declared_hash() {
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let key_hex = encode_hex(signing_key.verifying_key().as_bytes());
        let digest = "2f6b2dcf7f8d7d53e3f0f375d4f48130276f9cf9466ee63f04745bbda870f070";
        let signature = BASE64.encode(signing_key.sign(digest.as_bytes()).to_bytes());
        verify_catalog_signature_with_key(&key_hex, digest, &signature).unwrap();
        assert!(
            verify_catalog_signature_with_key(&key_hex, &"0".repeat(64), &signature)
                .unwrap_err()
                .contains("not trusted")
        );
    }

    fn signed_catalog_fixture(
        signing_key: &SigningKey,
        sequence: u64,
        version: &str,
        generated_at: OffsetDateTime,
        expires_at: OffsetDateTime,
    ) -> Vec<u8> {
        let digest = "2f6b2dcf7f8d7d53e3f0f375d4f48130276f9cf9466ee63f04745bbda870f070";
        let package_signature = BASE64.encode(signing_key.sign(digest.as_bytes()).to_bytes());
        let payload = OnlineCatalogPayload {
            schema_version: 2,
            sequence,
            generated_at: generated_at.format(&Rfc3339).unwrap(),
            expires_at: expires_at.format(&Rfc3339).unwrap(),
            modules: vec![CatalogEntry {
                id: "com.kkterm.fixture".into(),
                name: "Fixture".into(),
                version: version.into(),
                publisher: "KKTerm".into(),
                summary: "Fixture module".into(),
                api_version: 2,
                download_url: format!(
                    "https://modules.example.test/packages/sha256/{digest}.kkmod"
                ),
                sha256: digest.into(),
                signature: package_signature,
                license: "MIT".into(),
                permissions: CustomModulePermissions {
                    storage: true,
                    ..Default::default()
                },
                download_size: 1234,
            }],
        };
        let payload_bytes = serde_json::to_vec(&payload).unwrap();
        let envelope = SignedCatalogEnvelope {
            schema_version: 2,
            key_id: catalog_key_id_for_key(&signing_key.verifying_key()),
            payload: BASE64.encode(&payload_bytes),
            signature: BASE64.encode(signing_key.sign(&payload_bytes).to_bytes()),
        };
        serde_json::to_vec(&envelope).unwrap()
    }

    #[test]
    fn online_catalog_verifies_envelope_package_and_origin() {
        let signing_key = SigningKey::from_bytes(&[9_u8; 32]);
        let key_hex = encode_hex(signing_key.verifying_key().as_bytes());
        let now = OffsetDateTime::from_unix_timestamp(1_800_000_000).unwrap();
        let bytes = signed_catalog_fixture(
            &signing_key,
            7,
            "1.2.0",
            now - time::Duration::minutes(1),
            now + time::Duration::days(30),
        );
        let verified = verify_online_catalog_with_key(
            &bytes,
            now,
            &key_hex,
            "https://modules.example.test/catalog/v2/catalog.json",
        )
        .unwrap();
        assert_eq!(verified.payload.sequence, 7);
        assert_eq!(verified.payload.modules[0].version, "1.2.0");
        assert!(!verified.expired);
    }

    #[test]
    fn online_catalog_rejects_tampering_and_marks_expiration() {
        let signing_key = SigningKey::from_bytes(&[11_u8; 32]);
        let key_hex = encode_hex(signing_key.verifying_key().as_bytes());
        let now = OffsetDateTime::from_unix_timestamp(1_800_000_000).unwrap();
        let expired = signed_catalog_fixture(
            &signing_key,
            2,
            "1.0.0",
            now - time::Duration::days(2),
            now - time::Duration::days(1),
        );
        assert!(
            verify_online_catalog_with_key(&expired, now, &key_hex, "")
                .unwrap()
                .expired
        );

        let mut tampered: SignedCatalogEnvelope = serde_json::from_slice(&expired).unwrap();
        let mut payload_bytes = BASE64.decode(&tampered.payload).unwrap();
        payload_bytes[0] ^= 1;
        tampered.payload = BASE64.encode(payload_bytes);
        assert!(
            verify_online_catalog_with_key(
                &serde_json::to_vec(&tampered).unwrap(),
                now,
                &key_hex,
                "",
            )
            .unwrap_err()
            .contains("signature")
        );
    }

    #[test]
    fn online_catalog_cannot_downgrade_the_bundled_baseline() {
        let signing_key = SigningKey::from_bytes(&[13_u8; 32]);
        let now = OffsetDateTime::from_unix_timestamp(1_800_000_000).unwrap();
        let key_hex = encode_hex(signing_key.verifying_key().as_bytes());
        let baseline_bytes = signed_catalog_fixture(
            &signing_key,
            1,
            "2.0.0",
            now - time::Duration::minutes(1),
            now + time::Duration::days(30),
        );
        let baseline_verified =
            verify_online_catalog_with_key(&baseline_bytes, now, &key_hex, "").unwrap();
        let online_bytes = signed_catalog_fixture(
            &signing_key,
            2,
            "1.9.0",
            now - time::Duration::minutes(1),
            now + time::Duration::days(30),
        );
        let online = verify_online_catalog_with_key(&online_bytes, now, &key_hex, "").unwrap();
        let merged = merge_catalogs(
            Catalog {
                schema_version: 2,
                modules: baseline_verified.payload.modules,
            },
            Some(&online),
        )
        .unwrap();
        assert_eq!(merged[0].version, "2.0.0");
    }

    #[test]
    fn installation_retains_one_atomic_rollback_version() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path().join("test.sqlite3")).unwrap();
        let paths = AppPaths::for_test(directory.path().join("data"));
        let first_package = directory.path().join("first.kkmod");
        write_package(&first_package, None);
        let first = install_package(
            &storage,
            &paths,
            &first_package,
            "local",
            "local",
            None,
            None,
        )
        .unwrap();
        assert_eq!(first.manifest.version, "1.0.0");
        storage
            .with_connection(|connection| {
                connection
                    .execute(
                        "UPDATE custom_modules SET enabled = 0, rail_visible = 0
                         WHERE id = 'com.kkterm.fixture'",
                        [],
                    )
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            })
            .unwrap();

        let mut second_manifest = valid_manifest();
        second_manifest.version = "1.1.0".into();
        let second_package = directory.path().join("second.kkmod");
        write_package_manifest(&second_package, &second_manifest, None);
        let second = install_package(
            &storage,
            &paths,
            &second_package,
            "local",
            "local",
            None,
            None,
        )
        .unwrap();
        assert_eq!(second.manifest.version, "1.1.0");
        assert_eq!(second.previous_version.as_deref(), Some("1.0.0"));
        assert!(!second.enabled);
        assert!(!second.rail_visible);
        assert!(
            modules_root(&paths)
                .join(package_relative_path("com.kkterm.fixture", "1.0.0"))
                .is_dir()
        );
        fs::remove_dir_all(
            modules_root(&paths).join(package_relative_path("com.kkterm.fixture", "1.1.0")),
        )
        .unwrap();
        let repaired = install_package(
            &storage,
            &paths,
            &second_package,
            "local",
            "local",
            None,
            None,
        )
        .unwrap();
        assert_eq!(repaired.previous_version.as_deref(), Some("1.0.0"));
    }

    #[test]
    fn portable_mode_keeps_custom_module_packages_and_data_beside_the_executable() {
        let directory = tempfile::tempdir().unwrap();
        let portable_data = directory.path().join("portable").join("data");
        fs::create_dir_all(&portable_data).unwrap();
        let paths = AppPaths::for_portable_test(portable_data.clone());
        let database_path = paths.database_path();
        let storage = Storage::open(database_path.clone()).unwrap();
        let package = directory.path().join("fixture.kkmod");
        write_package(&package, None);

        install_package(&storage, &paths, &package, "local", "local", None, None).unwrap();
        let document = json!({"elements": [{"id": "portable"}], "files": {}});
        set_document(&storage, &paths, "com.kkterm.fixture", "scene", &document).unwrap();
        let document_sha256: String = storage
            .with_connection(|connection| {
                connection
                    .query_row(
                        "SELECT content_sha256 FROM custom_module_documents
                         WHERE module_id = 'com.kkterm.fixture' AND key = 'scene'",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();

        assert!(paths.is_portable());
        assert_eq!(database_path, portable_data.join("kkterm.sqlite3"));
        assert!(database_path.is_file());
        assert_eq!(
            package_storage_root(&paths),
            portable_data.join("custom-modules").join("packages")
        );
        assert_eq!(
            staging_root(&paths),
            portable_data.join("custom-modules").join("staging")
        );
        assert_eq!(
            downloads_root(&paths),
            portable_data.join("custom-modules").join("downloads")
        );
        assert_eq!(
            webview_data_root(&paths),
            portable_data.join("custom-modules").join("webview-data")
        );
        assert_eq!(
            catalog_cache_path(&paths),
            portable_data
                .join("custom-modules")
                .join(CATALOG_CACHE_FILE)
        );
        assert!(
            package_storage_root(&paths)
                .join("com.kkterm.fixture")
                .join("1.0.0")
                .join("dist")
                .join("index.html")
                .is_file()
        );
        assert_eq!(
            document_content_path(&paths, "com.kkterm.fixture", &document_sha256),
            portable_data
                .join("custom-modules")
                .join("documents")
                .join("com.kkterm.fixture")
                .join(format!("{document_sha256}.json"))
        );
        assert!(document_content_path(&paths, "com.kkterm.fixture", &document_sha256).is_file());
    }

    #[test]
    fn storage_quota_is_scoped_by_module_and_excludes_the_replaced_key() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path().join("test.sqlite3")).unwrap();
        storage
            .with_connection(|connection| {
                for id in ["com.example.one", "com.example.two"] {
                    connection
                        .execute(
                            "INSERT INTO custom_modules (
                                id, manifest_json, active_version, source, trust, sha256
                             ) VALUES (?1, '{}', '1.0.0', 'local', 'local', 'hash')",
                            [id],
                        )
                        .map_err(|error| error.to_string())?;
                }
                connection
                    .execute(
                        "INSERT INTO custom_module_storage (module_id, key, value_json, byte_size)
                         VALUES ('com.example.one', 'existing', 'null', ?1),
                                ('com.example.two', 'other', 'null', ?1)",
                        [STORAGE_QUOTA_BYTES - 4],
                    )
                    .map_err(|error| error.to_string())?;
                ensure_storage_quota(connection, "com.example.one", "existing", 8)?;
                assert!(
                    ensure_storage_quota(connection, "com.example.one", "new", 8)
                        .unwrap_err()
                        .contains("quota")
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn document_storage_keeps_content_outside_sqlite_and_cleans_replaced_files() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path().join("test.sqlite3")).unwrap();
        let paths = AppPaths::for_test(directory.path().join("data"));
        storage
            .with_connection(|connection| {
                connection
                    .execute(
                        "INSERT INTO custom_modules (
                            id, manifest_json, active_version, source, trust, sha256
                         ) VALUES ('com.example.documents', '{}', '1.0.0', 'local', 'local', 'hash')",
                        [],
                    )
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            })
            .unwrap();

        let first =
            json!({"elements": [{"id": "one"}], "files": {"image": "data:image/png;base64,AA=="}});
        set_document(&storage, &paths, "com.example.documents", "scene", &first).unwrap();
        let (first_sha256, byte_size): (String, i64) = storage
            .with_connection(|connection| {
                connection
                    .query_row(
                        "SELECT content_sha256, byte_size FROM custom_module_documents
                         WHERE module_id = 'com.example.documents' AND key = 'scene'",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        assert!(byte_size > 0);
        let first_path = document_content_path(&paths, "com.example.documents", &first_sha256);
        assert!(first_path.is_file());
        assert_eq!(
            get_document(&storage, &paths, "com.example.documents", "scene").unwrap(),
            first
        );
        assert_eq!(
            list_documents(&storage, "com.example.documents").unwrap()[0]["key"],
            "scene"
        );

        let second = json!({"elements": [{"id": "two"}], "files": {}});
        set_document(&storage, &paths, "com.example.documents", "scene", &second).unwrap();
        assert!(!first_path.exists());
        assert_eq!(
            get_document(&storage, &paths, "com.example.documents", "scene").unwrap(),
            second
        );
        delete_document(&storage, &paths, "com.example.documents", "scene").unwrap();
        assert_eq!(
            get_document(&storage, &paths, "com.example.documents", "scene").unwrap(),
            Value::Null
        );
        assert_eq!(
            list_documents(&storage, "com.example.documents").unwrap(),
            json!([])
        );
    }

    #[test]
    fn document_quota_is_scoped_by_module_and_excludes_the_replaced_key() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path().join("test.sqlite3")).unwrap();
        storage
            .with_connection(|connection| {
                for id in ["com.example.one", "com.example.two"] {
                    connection
                        .execute(
                            "INSERT INTO custom_modules (
                                id, manifest_json, active_version, source, trust, sha256
                             ) VALUES (?1, '{}', '1.0.0', 'local', 'local', 'hash')",
                            [id],
                        )
                        .map_err(|error| error.to_string())?;
                }
                connection
                    .execute(
                        "INSERT INTO custom_module_documents (
                            module_id, key, content_sha256, byte_size
                         ) VALUES ('com.example.one', 'existing', 'one', ?1),
                                  ('com.example.two', 'other', 'two', ?1)",
                        [DOCUMENT_STORAGE_QUOTA_BYTES - 4],
                    )
                    .map_err(|error| error.to_string())?;
                ensure_document_quota(connection, "com.example.one", "existing", 8)?;
                assert!(
                    ensure_document_quota(connection, "com.example.one", "new", 8)
                        .unwrap_err()
                        .contains("quota")
                );
                Ok(())
            })
            .unwrap();
    }
}

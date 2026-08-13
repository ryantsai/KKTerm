use crate::{app_paths::AppPaths, storage::Storage, webview};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use reqwest::blocking::Client;
use rusqlite::{OptionalExtension, params};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard,
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
const HOST_API_VERSION: u32 = 1;
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES: u64 = 128 * 1024 * 1024;
const STORAGE_QUOTA_BYTES: i64 = 10 * 1024 * 1024;
const MAX_STORAGE_KEYS: i64 = 10_000;
const MAX_BRIDGE_PAYLOAD_BYTES: usize = 11 * 1024 * 1024;
const DOCUMENT_STORAGE_QUOTA_BYTES: i64 = 512 * 1024 * 1024;
const MAX_DOCUMENT_BYTES: usize = 64 * 1024 * 1024;
const MAX_DOCUMENT_KEYS: i64 = 4_096;
const MAX_DOCUMENT_BRIDGE_PAYLOAD_BYTES: usize = MAX_DOCUMENT_BYTES + 1024 * 1024;
const MAX_ACTIVITY_RAIL_ICON_BYTES: u64 = 64 * 1024;
const MAX_CATALOG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_CATALOG_VALIDITY_DAYS: i64 = 45;
const FIRST_PARTY_VERIFYING_KEY_HEX: &str = env!("KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY");
const ONLINE_CATALOG_URL: &str = env!("KKTERM_CUSTOM_MODULE_CATALOG_URL");
const CATALOG_JSON: &str = include_str!("../../custom-modules/catalog.v1.json");
const CATALOG_CACHE_FILE: &str = "catalog-cache.v1.json";

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
    pub permissions: Vec<String>,
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
    pub permissions: Vec<String>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomModuleSessionStarted {
    pub session_id: String,
}

#[derive(Clone)]
struct RuntimeSession {
    module_id: String,
    contribution_id: String,
    permissions: HashSet<String>,
    theme: String,
    locale: String,
    ready_sent: Arc<AtomicBool>,
    last_external_open: Arc<Mutex<Option<Instant>>>,
    window: WebviewWindow,
    host_window: WebviewWindow,
}

#[derive(Default)]
pub struct CustomModuleRuntime {
    sessions: Mutex<HashMap<String, RuntimeSession>>,
    routes: Mutex<HashMap<String, (PathBuf, String)>>,
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
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

    fn lock_routes(&self) -> Result<MutexGuard<'_, HashMap<String, (PathBuf, String)>>, String> {
        self.routes
            .lock()
            .map_err(|_| "Custom Module route lock is poisoned".to_string())
    }

    fn lock_downloads(&self) -> Result<MutexGuard<'_, HashMap<String, Arc<AtomicBool>>>, String> {
        self.downloads
            .lock()
            .map_err(|_| "Custom Module download lock is poisoned".to_string())
    }
}

fn default_true() -> bool {
    true
}

fn modules_root(paths: &AppPaths) -> PathBuf {
    paths.data_dir().join("custom-modules")
}

fn document_storage_root(paths: &AppPaths) -> PathBuf {
    modules_root(paths).join("documents")
}

fn package_relative_path(module_id: &str, version: &str) -> PathBuf {
    PathBuf::from("packages").join(module_id).join(version)
}

fn canonical_package_root(paths: &AppPaths, package_root: &Path) -> Result<PathBuf, String> {
    let packages_root = fs::canonicalize(modules_root(paths).join("packages"))
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
    let allowed_permissions = ["storage", "documentStorage", "openExternal", "clipboard"];
    let mut permissions = HashSet::new();
    for permission in &manifest.permissions {
        if !allowed_permissions.contains(&permission.as_str()) {
            return Err(format!(
                "unsupported Custom Module permission '{permission}'"
            ));
        }
        if !permissions.insert(permission) {
            return Err(format!("duplicate Custom Module permission '{permission}'"));
        }
    }
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
        return Err("Custom Module package is empty or exceeds the 256 MiB limit".into());
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
            return Err("Custom Module package expands beyond the 512 MiB limit".into());
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
        let expected = expected_metadata.permissions.iter().collect::<HashSet<_>>();
        let actual = review.manifest.permissions.iter().collect::<HashSet<_>>();
        if review.manifest.id != expected_metadata.id
            || review.manifest.version != expected_metadata.version
            || review.manifest.name != expected_metadata.name
            || review.manifest.publisher != expected_metadata.publisher
            || review.manifest.api_version != expected_metadata.api_version
            || expected != actual
            || review.manifest.license.name != expected_metadata.license
        {
            return Err("downloaded Custom Module identity, permissions, or license do not match catalog metadata".into());
        }
    }
    let root = modules_root(paths);
    let staging = root.join("staging").join(format!(
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
        for permission in &review.manifest.permissions {
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
            &root.join("packages"),
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
                let icon_data_urls = curated_icon_data_urls(
                    paths,
                    &package_path,
                    &manifest,
                    &trust,
                );
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

fn curated_icon_data_urls(
    paths: &AppPaths,
    package_path: &Path,
    manifest: &CustomModuleManifest,
    trust: &str,
) -> BTreeMap<String, String> {
    if trust != "firstParty" {
        return BTreeMap::new();
    }
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
            Some((
                contribution.id.clone(),
                format!("data:image/svg+xml;base64,{}", BASE64.encode(bytes)),
            ))
        })
        .collect()
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
    if catalog.schema_version != 1 {
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
        let mut permissions = HashSet::new();
        for permission in &entry.permissions {
            if !matches!(
                permission.as_str(),
                "storage" | "documentStorage" | "openExternal" | "clipboard"
            ) {
                return Err(format!("unsupported catalog permission '{permission}'"));
            }
            if !permissions.insert(permission) {
                return Err(format!("duplicate catalog permission '{permission}'"));
            }
        }
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
    if envelope.schema_version != 1 {
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
    if payload.schema_version != 1 || payload.sequence == 0 {
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
            let cache = modules_root(&paths).join("downloads");
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
                return Err("catalog package exceeds the 256 MiB download limit".into());
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
                    return Err("catalog package exceeds the 256 MiB download limit".into());
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
        for permission in &manifest.permissions {
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
    storage: tauri::State<'_, Storage>,
    paths: tauri::State<'_, AppPaths>,
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
            let _ = session.window.close();
        }
        runtime.lock_routes()?.remove(&label);
    }
    let package_dir = modules_root(&paths).join("packages").join(&module_id);
    remove_owned_directory(
        &modules_root(&paths).join("packages"),
        &package_dir,
        "Custom Module package files",
    )?;
    if delete_data {
        let webview_data = modules_root(&paths).join("webview-data").join(&module_id);
        remove_owned_directory(
            &modules_root(&paths).join("webview-data"),
            &webview_data,
            "Custom Module WebView data",
        )?;
        let document_data = document_storage_root(&paths).join(&module_id);
        remove_owned_directory(
            &document_storage_root(&paths),
            &document_data,
            "Custom Module document data",
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

fn session_label(module_id: &str, contribution_id: &str) -> String {
    let digest = Sha256::digest(format!("{module_id}:{contribution_id}"));
    format!("custom-module-{}", encode_hex(&digest[..12]))
}

fn initialization_script(
    theme: &str,
    locale: &str,
    clipboard_allowed: bool,
) -> Result<String, String> {
    let context = serde_json::to_string(&json!({
        "apiVersion": HOST_API_VERSION,
        "theme": theme,
        "locale": locale,
    }))
    .map_err(|error| error.to_string())?;
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
          for (const target of [window, Window.prototype]) {{
            replace(target, 'localStorage', ephemeralStorage);
            replace(target, 'indexedDB', undefined);
            replace(target, 'caches', undefined);
          }}
          for (const target of [navigator, Navigator.prototype]) {{
            replace(target, 'storage', undefined);
            if (!{clipboard_allowed}) replace(target, 'clipboard', unavailableClipboard);
          }}
          for (const target of [document, Document.prototype]) {{
            try {{ Object.defineProperty(target, 'cookie', {{ configurable: false, get: () => '', set: () => true }}); }} catch {{}}
          }}
          const invoke = (operation, payload = {{}}) =>
            window.__TAURI_INTERNALS__.invoke('custom_module_bridge', {{ request: {{ operation, payload }} }});
          const listeners = new Map();
          window.KKTerm = Object.freeze({{
            apiVersion: {HOST_API_VERSION},
            context: {context},
            ready: () => invoke('host.ready'),
            getContext: () => invoke('host.getContext'),
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
            on: (event, listener) => {{
              const current = listeners.get(event) || new Set();
              current.add(listener); listeners.set(event, current);
              return () => current.delete(listener);
            }}
          }});
          window.__KKTERM_MODULE_EVENT__ = (event, detail) => {{
            for (const listener of listeners.get(event) || []) {{
              try {{ listener(detail); }} catch (error) {{ console.error(error); }}
            }}
          }};
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
        webview::set_overlay_bounds(
            &session.host_window,
            &session.window,
            request.x,
            request.y,
            request.width,
            request.height,
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
    let initial_url = Url::parse(&format!("kkmodule://localhost/{}", contribution.entrypoint))
        .map_err(|error| format!("failed to build Custom Module URL: {error}"))?;
    let permissions = granted_permissions(&storage, &installed.manifest.id)?;
    let clipboard_allowed = permissions.contains("clipboard");
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(initial_url))
        .initialization_script(initialization_script(
            &request.theme,
            &request.locale,
            clipboard_allowed,
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
        .data_directory(
            modules_root(&paths)
                .join("webview-data")
                .join(&installed.manifest.id),
        )
        .on_navigation(move |url| {
            let is_module_asset = url.scheme() == "kkmodule"
                || (url.scheme() == "http" && url.host_str() == Some("kkmodule.localhost"));
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
        (root.clone(), contribution.entrypoint.clone()),
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
        theme: request.theme,
        locale: request.locale,
        ready_sent: Arc::new(AtomicBool::new(false)),
        last_external_open: Arc::new(Mutex::new(None)),
        window: window.clone(),
        host_window: host_window.clone(),
    };
    if let Err(error) = runtime.lock().map(|mut sessions| {
        sessions.insert(label.clone(), session);
    }) {
        runtime.lock_routes()?.remove(&label);
        let _ = window.close();
        return Err(error);
    }
    if let Err(error) = webview::set_overlay_bounds(
        &host_window,
        &window,
        request.x,
        request.y,
        request.width,
        request.height,
    ) {
        let _ = runtime.lock().map(|mut sessions| sessions.remove(&label));
        let _ = runtime
            .lock_routes()
            .map(|mut routes| routes.remove(&label));
        let _ = window.close();
        return Err(error);
    }
    Ok(CustomModuleSessionStarted { session_id: label })
}

#[tauri::command]
pub fn update_custom_module_bounds(
    request: CustomModuleBoundsRequest,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<(), String> {
    let session = runtime.session(&request.session_id)?;
    webview::set_overlay_bounds(
        &session.host_window,
        &session.window,
        request.x,
        request.y,
        request.width,
        request.height,
    )
}

#[tauri::command]
pub fn set_custom_module_visibility(
    session_id: String,
    visible: bool,
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<(), String> {
    let session = runtime.session(&session_id)?;
    if visible {
        webview::show_overlay(&session.window)
    } else {
        webview::hide_overlay(&session.window)
    }
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
    runtime: tauri::State<'_, CustomModuleRuntime>,
) -> Result<(), String> {
    let session = runtime.session(&session_id)?;
    let _ = webview::hide_overlay(&session.window);
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

#[tauri::command]
pub fn custom_module_bridge(
    request: CustomModuleBridgeRequest,
    webview_window: WebviewWindow,
    app: tauri::AppHandle,
    storage: tauri::State<'_, Storage>,
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
        _ => Err("unknown Custom Module bridge operation".into()),
    }
}

pub fn protocol_response(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let result = (|| -> Result<(Vec<u8>, String), String> {
        let runtime = context.app_handle().state::<CustomModuleRuntime>();
        let paths = context.app_handle().state::<AppPaths>();
        let (root, entrypoint) = runtime
            .lock_routes()?
            .get(context.webview_label())
            .cloned()
            .ok_or_else(|| "Custom Module route is not registered".to_string())?;
        let requested = request.uri().path().trim_start_matches('/');
        let relative = if requested.is_empty() {
            entrypoint
        } else {
            requested.to_string()
        };
        let safe_path = validate_relative_path(&relative, "Custom Module asset")?;
        let canonical_root = canonical_package_root(&paths, &root)?;
        let path = fs::canonicalize(root.join(&safe_path))
            .map_err(|error| format!("failed to resolve Custom Module asset: {error}"))?;
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
        Ok((bytes, mime))
    })();
    match result {
        Ok((body, mime)) => tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", mime)
            .header("X-Content-Type-Options", "nosniff")
            .header("Cache-Control", "no-store")
            .header(
                "Permissions-Policy",
                "accelerometer=(), ambient-light-sensor=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), window-management=(), xr-spatial-tracking=()",
            )
            .header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'",
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
            api_version: 1,
            homepage: Some("https://kkterm.example".into()),
            license: CustomModuleLicense {
                name: "MIT".into(),
                file: "licenses/LICENSE".into(),
                notices_file: None,
            },
            permissions: vec!["storage".into()],
            modules: vec![CustomModuleContribution {
                id: "fixture".into(),
                title: "Fixture".into(),
                icon: None,
                entrypoint: "dist/index.html".into(),
                rail_visible: true,
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
    fn valid_manifest_passes_v1_contract() {
        validate_manifest(&valid_manifest()).unwrap();
    }

    #[test]
    fn manifest_rejects_unknown_permissions() {
        let mut manifest = valid_manifest();
        manifest.permissions.push("terminal.raw".into());
        assert!(
            validate_manifest(&manifest)
                .unwrap_err()
                .contains("unsupported")
        );
    }

    #[test]
    fn manifest_accepts_document_storage_permission() {
        let mut manifest = valid_manifest();
        manifest.permissions.push("documentStorage".into());
        validate_manifest(&manifest).unwrap();
    }

    #[test]
    fn manifest_accepts_clipboard_permission() {
        let mut manifest = valid_manifest();
        manifest.permissions.push("clipboard".into());
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
    fn curated_activity_rail_icons_are_bounded_svg_data_urls() {
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

        let icons = curated_icon_data_urls(&paths, &package_path, &manifest, "firstParty");
        assert!(
            icons["fixture"].starts_with("data:image/svg+xml;base64,"),
            "curated SVG should be exposed only as an inert image data URL"
        );
        assert!(curated_icon_data_urls(&paths, &package_path, &manifest, "local").is_empty());

        fs::write(
            package_path.join("dist/icon.svg"),
            vec![b'x'; MAX_ACTIVITY_RAIL_ICON_BYTES as usize + 1],
        )
        .unwrap();
        assert!(
            curated_icon_data_urls(&paths, &package_path, &manifest, "firstParty").is_empty(),
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
            schema_version: 1,
            sequence,
            generated_at: generated_at.format(&Rfc3339).unwrap(),
            expires_at: expires_at.format(&Rfc3339).unwrap(),
            modules: vec![CatalogEntry {
                id: "com.kkterm.fixture".into(),
                name: "Fixture".into(),
                version: version.into(),
                publisher: "KKTerm".into(),
                summary: "Fixture module".into(),
                api_version: 1,
                download_url: format!(
                    "https://modules.example.test/packages/sha256/{digest}.kkmod"
                ),
                sha256: digest.into(),
                signature: package_signature,
                license: "MIT".into(),
                permissions: vec!["storage".into()],
                download_size: 1234,
            }],
        };
        let payload_bytes = serde_json::to_vec(&payload).unwrap();
        let envelope = SignedCatalogEnvelope {
            schema_version: 1,
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
            "https://modules.example.test/catalog/v1/catalog.json",
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
                schema_version: 1,
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

//! Safe, data-driven cleanup recipes for System Cleaner.
//!
//! The preview/execute split is informed by BleachBit's CleanerML workflow and
//! FluentCleaner's Winapp2 analysis model. This is an original, deliberately
//! narrower implementation: recipes can only enumerate regular files. They
//! cannot edit the registry, launch commands, mutate databases, or delete an
//! unresolved directory tree.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env, fs,
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{
        OnceLock, RwLock,
        atomic::{AtomicBool, Ordering},
    },
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::storage::{Storage, SystemCleanerHistoryRecord, SystemCleanerRecipeBundleRecord};

#[cfg(target_os = "windows")]
use std::os::windows::{fs::MetadataExt, process::CommandExt};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

const RECIPE_SCHEMA_VERSION: u32 = 1;
const MAX_RECIPE_TARGETS: usize = 64;
const MAX_PLAN_ITEMS: usize = 250_000;
const MAX_IMPORTED_RECIPES: usize = 8_000;
const MAX_BUNDLE_BYTES: usize = 16 * 1024 * 1024;
const PLAN_MAX_AGE_MINUTES: i64 = 30;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecipeSafety {
    Safe,
    Review,
    Risky,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanerTarget {
    pub path: String,
    #[serde(default)]
    pub file_patterns: Vec<String>,
    #[serde(default = "default_true")]
    pub recursive: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanerRecipe {
    pub id: String,
    pub version: u32,
    pub title: String,
    pub description: String,
    pub safety: RecipeSafety,
    #[serde(default)]
    pub default_selected: bool,
    #[serde(default)]
    pub targets: Vec<CleanerTarget>,
    #[serde(default)]
    pub excludes: Vec<String>,
    #[serde(default)]
    pub running_processes: Vec<String>,
    #[serde(default)]
    pub warning: Option<String>,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub built_in: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecipeBundlePayload {
    pub schema_version: u32,
    pub bundle_id: String,
    pub version: u64,
    pub source: String,
    #[serde(default)]
    pub update_url: Option<String>,
    pub recipes: Vec<CleanerRecipe>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignedRecipeBundle {
    payload: String,
    public_key_hex: String,
    signature_hex: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeCatalogEntry {
    pub id: String,
    pub version: u32,
    pub title: String,
    pub description: String,
    pub safety: RecipeSafety,
    pub default_selected: bool,
    pub display_path: String,
    pub bytes: u64,
    pub item_count: u64,
    pub source: String,
    pub built_in: bool,
    pub warning: Option<String>,
    pub running_processes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPlanItem {
    pub recipe_id: String,
    pub path: String,
    pub bytes: u64,
    pub modified_unix_ms: u64,
    pub file_id: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPlan {
    pub token: String,
    pub created_at: String,
    pub total_bytes: u64,
    pub excluded_items: u64,
    pub items: Vec<CleanupPlanItem>,
    pub recipe_versions: BTreeMap<String, u32>,
    pub blocked_processes: Vec<String>,
}

#[derive(Clone)]
struct CachedPlanItem {
    public: CleanupPlanItem,
    target_root: PathBuf,
}

#[derive(Clone)]
struct CachedPlan {
    public: CleanupPlan,
    items: Vec<CachedPlanItem>,
    recipe_processes: HashMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSkip {
    pub path: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub run_id: String,
    pub freed_bytes: u64,
    pub deleted_items: u64,
    pub skipped: Vec<CleanupSkip>,
    pub cancelled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub recipe: Option<CleanerRecipe>,
    pub preview: Option<CleanupPlan>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeBundlePreview {
    pub bundle_id: String,
    pub version: u64,
    pub source: String,
    pub signer_fingerprint: String,
    pub sha256: String,
    pub recipe_count: usize,
    pub added: Vec<String>,
    pub updated: Vec<String>,
    pub removed: Vec<String>,
    #[serde(skip_serializing)]
    payload_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeBundleInfo {
    pub bundle_id: String,
    pub version: u64,
    pub source: String,
    pub signer_fingerprint: String,
    pub sha256: String,
    pub recipe_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Winapp2ImportPreview {
    pub recipe_count: usize,
    pub skipped_registry_keys: usize,
    pub skipped_unsupported_entries: usize,
    pub warnings: Vec<String>,
    #[serde(skip_serializing)]
    payload_json: String,
}

static PLAN_CACHE: OnceLock<RwLock<HashMap<String, CachedPlan>>> = OnceLock::new();
static CLEAN_CANCELLED: AtomicBool = AtomicBool::new(false);

fn default_true() -> bool {
    true
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn decode_hex<const N: usize>(value: &str) -> Result<[u8; N], String> {
    if value.len() != N * 2 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("Expected {} hexadecimal characters.", N * 2));
    }
    let mut output = [0_u8; N];
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        let text = std::str::from_utf8(chunk).map_err(|error| error.to_string())?;
        output[index] = u8::from_str_radix(text, 16).map_err(|error| error.to_string())?;
    }
    Ok(output)
}

fn normalize(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn path_within(path: &Path, parent: &Path) -> bool {
    let path = normalize(path);
    let parent = normalize(parent);
    path == parent
        || path
            .strip_prefix(&parent)
            .is_some_and(|rest| rest.starts_with('\\'))
}

#[cfg(target_os = "windows")]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(target_os = "windows"))]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn metadata_modified_ms(metadata: &fs::Metadata) -> u64 {
    #[cfg(target_os = "windows")]
    {
        const WINDOWS_TO_UNIX_EPOCH_TICKS: u64 = 116_444_736_000_000_000;
        return metadata
            .last_write_time()
            .saturating_sub(WINDOWS_TO_UNIX_EPOCH_TICKS)
            / 10_000;
    }
    #[cfg(not(target_os = "windows"))]
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

fn file_identity(path: &Path) -> u64 {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::{
            Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
            Storage::FileSystem::{
                BY_HANDLE_FILE_INFORMATION, CreateFileW, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE,
                FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileInformationByHandle, OPEN_EXISTING,
            },
        };
        let wide = path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return 0;
        }
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        let ok = unsafe { GetFileInformationByHandle(handle, &mut info) };
        unsafe { CloseHandle(handle) };
        if ok == 0 {
            0
        } else {
            ((u64::from(info.dwVolumeSerialNumber)) << 32)
                ^ ((u64::from(info.nFileIndexHigh)) << 32)
                ^ u64::from(info.nFileIndexLow)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        0
    }
}

fn env_value(name: &str) -> Option<PathBuf> {
    let canonical = match name.to_ascii_uppercase().as_str() {
        "LOCALAPPDATA" => "LOCALAPPDATA",
        "APPDATA" => "APPDATA",
        "TEMP" | "TMP" => "TEMP",
        "USERPROFILE" => "USERPROFILE",
        "WINDIR" | "SYSTEMROOT" => "WINDIR",
        "PROGRAMDATA" => "PROGRAMDATA",
        _ => return None,
    };
    env::var_os(canonical).map(PathBuf::from)
}

fn expand_template(template: &str) -> Result<PathBuf, String> {
    let normalized = template.replace('/', "\\");
    if !normalized.starts_with('%') {
        return Err("Targets must start with a supported environment variable.".into());
    }
    let end = normalized[1..]
        .find('%')
        .map(|index| index + 1)
        .ok_or_else(|| "Target environment variable is not closed.".to_string())?;
    let variable = &normalized[1..end];
    let mut base = env_value(variable)
        .ok_or_else(|| format!("Unsupported target environment variable %{variable}%."))?;
    let suffix = normalized[end + 1..].trim_start_matches('\\');
    for component in Path::new(suffix).components() {
        match component {
            Component::Normal(value) => base.push(value),
            Component::CurDir => {}
            _ => return Err("Targets cannot contain parent or rooted path components.".into()),
        }
    }
    Ok(base)
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase().into_bytes();
    let value = value.to_ascii_lowercase().into_bytes();
    let (mut p, mut v, mut star, mut retry) = (0_usize, 0_usize, None, 0_usize);
    while v < value.len() {
        if p < pattern.len() && (pattern[p] == b'?' || pattern[p] == value[v]) {
            p += 1;
            v += 1;
        } else if p < pattern.len() && pattern[p] == b'*' {
            star = Some(p);
            retry = v;
            p += 1;
        } else if let Some(star_index) = star {
            p = star_index + 1;
            retry += 1;
            v = retry;
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == b'*' {
        p += 1;
    }
    p == pattern.len()
}

fn expand_wildcard_directories(template: &str) -> Result<Vec<PathBuf>, String> {
    let expanded = expand_template(template)?;
    let components = expanded
        .components()
        .map(|component| component.as_os_str().to_owned())
        .collect::<Vec<_>>();
    let first_wildcard = components.iter().position(|component| {
        let value = component.to_string_lossy();
        value.contains('*') || value.contains('?')
    });
    let Some(first_wildcard) = first_wildcard else {
        return Ok(vec![expanded]);
    };
    let mut roots = PathBuf::new();
    for component in &components[..first_wildcard] {
        roots.push(component);
    }
    let mut candidates = vec![roots];
    for component in &components[first_wildcard..] {
        let pattern = component.to_string_lossy();
        let mut next = Vec::new();
        for parent in candidates {
            if pattern.contains('*') || pattern.contains('?') {
                let Ok(entries) = fs::read_dir(&parent) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if wildcard_match(&pattern, &entry.file_name().to_string_lossy())
                        && fs::symlink_metadata(&path)
                            .is_ok_and(|metadata| metadata.is_dir() && !is_reparse(&metadata))
                    {
                        next.push(path);
                    }
                }
            } else {
                let path = parent.join(component);
                if fs::symlink_metadata(&path)
                    .is_ok_and(|metadata| metadata.is_dir() && !is_reparse(&metadata))
                {
                    next.push(path);
                }
            }
        }
        candidates = next;
    }
    Ok(candidates)
}

fn protected_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(profile) = env_value("USERPROFILE") {
        for name in [
            "Desktop",
            "Documents",
            "Downloads",
            "Favorites",
            "Music",
            "Pictures",
            "Saved Games",
            "Videos",
            ".ssh",
            ".gnupg",
            ".aws",
            ".azure",
            ".kube",
            ".config/gcloud",
        ] {
            roots.push(profile.join(name));
        }
    }
    for variable in [
        "OneDrive",
        "OneDriveConsumer",
        "OneDriveCommercial",
        "Dropbox",
    ] {
        if let Some(path) = env::var_os(variable) {
            roots.push(PathBuf::from(path));
        }
    }
    roots
}

fn is_protected(path: &Path) -> bool {
    if protected_roots().iter().any(|root| path_within(path, root)) {
        return true;
    }
    const PROTECTED_COMPONENTS: &[&str] = &[
        ".git",
        ".svn",
        ".hg",
        ".ssh",
        ".gnupg",
        ".aws",
        ".azure",
        ".kube",
        "extensions",
        "sessions",
        "session storage",
        "indexeddb",
        "local storage",
    ];
    const PROTECTED_FILES: &[&str] = &[
        ".env",
        ".git-credentials",
        "bookmarks",
        "cookies",
        "history",
        "login data",
        "logins.json",
        "key4.db",
        "places.sqlite",
        "web data",
    ];
    path.components().any(|component| {
        let component = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        PROTECTED_COMPONENTS.contains(&component.as_str())
    }) || path
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .is_some_and(|name| PROTECTED_FILES.contains(&name.as_str()))
}

fn matches_exclusion(path: &Path, recipe: &CleanerRecipe, keep_paths: &[PathBuf]) -> bool {
    keep_paths.iter().any(|keep| path_within(path, keep))
        || recipe.excludes.iter().any(|pattern| {
            wildcard_match(
                &pattern.replace('/', "\\"),
                &path.to_string_lossy().replace('/', "\\"),
            )
        })
}

fn validate_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b".-_".contains(&byte)
        })
}

fn validate_recipe(recipe: &CleanerRecipe, imported: bool) -> Vec<String> {
    let mut errors = Vec::new();
    if !validate_id(&recipe.id) {
        errors.push(
            "Recipe id must contain only lowercase letters, digits, '.', '-', or '_'.".into(),
        );
    }
    if recipe.version == 0 {
        errors.push("Recipe version must be greater than zero.".into());
    }
    if recipe.title.trim().is_empty() || recipe.title.len() > 160 {
        errors.push("Recipe title must contain 1–160 characters.".into());
    }
    if recipe.description.trim().is_empty() || recipe.description.len() > 1_000 {
        errors.push("Recipe description must contain 1–1,000 characters.".into());
    }
    if recipe.targets.is_empty() || recipe.targets.len() > MAX_RECIPE_TARGETS {
        errors.push(format!(
            "Recipes must define 1–{MAX_RECIPE_TARGETS} file targets."
        ));
    }
    if imported && recipe.default_selected {
        errors.push("Imported recipes cannot be selected by default.".into());
    }
    for target in &recipe.targets {
        match expand_template(&target.path) {
            Ok(path) => {
                if imported {
                    let root = path.components().take(1).count();
                    let depth = path.components().count();
                    if depth <= root + 1 {
                        errors.push(format!("Target '{}' is too broad.", target.path));
                    }
                }
            }
            Err(error) => errors.push(format!("Target '{}': {error}", target.path)),
        }
        if target.file_patterns.len() > 32
            || target.file_patterns.iter().any(|pattern| {
                pattern.contains(['/', '\\']) || pattern.contains("..") || pattern.len() > 160
            })
        {
            errors.push(format!(
                "Target '{}' has an invalid file pattern.",
                target.path
            ));
        }
    }
    if imported && recipe.safety == RecipeSafety::Safe {
        errors.push(
            "Imported recipes must use Review or Risky safety until locally reviewed.".into(),
        );
    }
    errors
}

fn target(path: &str) -> CleanerTarget {
    CleanerTarget {
        path: path.into(),
        file_patterns: Vec::new(),
        recursive: true,
    }
}

fn files(path: &str, patterns: &[&str]) -> CleanerTarget {
    CleanerTarget {
        path: path.into(),
        file_patterns: patterns.iter().map(|value| (*value).into()).collect(),
        recursive: false,
    }
}

fn builtin(
    id: &str,
    safety: RecipeSafety,
    default_selected: bool,
    targets: Vec<CleanerTarget>,
    processes: &[&str],
) -> CleanerRecipe {
    CleanerRecipe {
        id: id.into(),
        version: 1,
        title: String::new(),
        description: String::new(),
        safety,
        default_selected,
        targets,
        excludes: Vec::new(),
        running_processes: processes.iter().map(|value| (*value).into()).collect(),
        warning: None,
        source: "KKTerm".into(),
        built_in: true,
    }
}

pub fn built_in_recipes() -> Vec<CleanerRecipe> {
    use RecipeSafety::{Review, Risky, Safe};
    vec![
        builtin("temp", Safe, true, vec![target("%TEMP%")], &[]),
        builtin(
            "windows-temp",
            Safe,
            true,
            vec![target("%WINDIR%/Temp")],
            &[],
        ),
        builtin(
            "browser-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/Microsoft/Edge/User Data/*/Cache"),
                target("%LOCALAPPDATA%/Microsoft/Edge/User Data/*/Code Cache"),
                target("%LOCALAPPDATA%/Microsoft/Edge/User Data/*/GPUCache"),
            ],
            &["msedge.exe"],
        ),
        builtin(
            "chrome-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/Google/Chrome/User Data/*/Cache"),
                target("%LOCALAPPDATA%/Google/Chrome/User Data/*/Code Cache"),
                target("%LOCALAPPDATA%/Google/Chrome/User Data/*/GPUCache"),
            ],
            &["chrome.exe"],
        ),
        builtin(
            "firefox-cache",
            Safe,
            true,
            vec![target("%LOCALAPPDATA%/Mozilla/Firefox/Profiles/*/cache2")],
            &["firefox.exe"],
        ),
        builtin(
            "brave-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data/*/Cache"),
                target("%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data/*/Code Cache"),
                target("%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data/*/GPUCache"),
            ],
            &["brave.exe"],
        ),
        builtin(
            "vivaldi-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/Vivaldi/User Data/*/Cache"),
                target("%LOCALAPPDATA%/Vivaldi/User Data/*/Code Cache"),
                target("%LOCALAPPDATA%/Vivaldi/User Data/*/GPUCache"),
            ],
            &["vivaldi.exe"],
        ),
        builtin(
            "opera-cache",
            Safe,
            true,
            vec![
                target("%APPDATA%/Opera Software/Opera Stable/Cache"),
                target("%APPDATA%/Opera Software/Opera Stable/Code Cache"),
                target("%APPDATA%/Opera Software/Opera Stable/GPUCache"),
            ],
            &["opera.exe"],
        ),
        builtin(
            "shader-cache",
            Safe,
            true,
            vec![target("%LOCALAPPDATA%/D3DSCache")],
            &[],
        ),
        builtin(
            "thumbnail-cache",
            Safe,
            true,
            vec![files(
                "%LOCALAPPDATA%/Microsoft/Windows/Explorer",
                &["thumbcache_*.db", "iconcache_*.db"],
            )],
            &[],
        ),
        builtin(
            "crash-dumps",
            Risky,
            false,
            vec![target("%LOCALAPPDATA%/CrashDumps")],
            &[],
        ),
        builtin(
            "error-reports",
            Review,
            false,
            vec![
                target("%LOCALAPPDATA%/Microsoft/Windows/WER/ReportArchive"),
                target("%LOCALAPPDATA%/Microsoft/Windows/WER/ReportQueue"),
            ],
            &[],
        ),
        builtin(
            "teams-cache",
            Safe,
            true,
            vec![
                target(
                    "%LOCALAPPDATA%/Packages/MSTeams_8wekyb3d8bbwe/LocalCache/Microsoft/MSTeams/EBWebView/*/Cache",
                ),
                target("%APPDATA%/Microsoft/Teams/Cache"),
                target("%APPDATA%/Microsoft/Teams/Code Cache"),
                target("%APPDATA%/Microsoft/Teams/GPUCache"),
            ],
            &["ms-teams.exe", "teams.exe"],
        ),
        builtin(
            "discord-cache",
            Safe,
            true,
            vec![
                target("%APPDATA%/discord/Cache"),
                target("%APPDATA%/discord/Code Cache"),
                target("%APPDATA%/discord/GPUCache"),
            ],
            &["discord.exe"],
        ),
        builtin(
            "slack-cache",
            Safe,
            true,
            vec![
                target("%APPDATA%/Slack/Cache"),
                target("%APPDATA%/Slack/Code Cache"),
                target("%APPDATA%/Slack/GPUCache"),
                target("%APPDATA%/Slack/Service Worker/CacheStorage"),
            ],
            &["slack.exe"],
        ),
        builtin(
            "vscode-cache",
            Safe,
            true,
            vec![
                target("%APPDATA%/Code/Cache"),
                target("%APPDATA%/Code/CachedData"),
                target("%APPDATA%/Code/Code Cache"),
                target("%APPDATA%/Code/GPUCache"),
                target("%APPDATA%/Code/Service Worker/CacheStorage"),
            ],
            &["code.exe"],
        ),
        builtin(
            "jetbrains-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/JetBrains/*/caches"),
                target("%LOCALAPPDATA%/JetBrains/*/log"),
            ],
            &[
                "idea64.exe",
                "pycharm64.exe",
                "webstorm64.exe",
                "rider64.exe",
            ],
        ),
        builtin(
            "npm-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/npm-cache/_cacache"),
                target("%APPDATA%/npm-cache/_cacache"),
            ],
            &["npm.exe", "node.exe"],
        ),
        builtin(
            "pnpm-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/pnpm/store"),
                target("%LOCALAPPDATA%/pnpm-cache"),
            ],
            &["pnpm.exe", "node.exe"],
        ),
        builtin(
            "yarn-cache",
            Safe,
            true,
            vec![target("%LOCALAPPDATA%/Yarn/Cache")],
            &["yarn.exe", "node.exe"],
        ),
        builtin(
            "nuget-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/NuGet/v3-cache"),
                target("%LOCALAPPDATA%/NuGet/plugins-cache"),
            ],
            &["dotnet.exe", "nuget.exe"],
        ),
        builtin(
            "pip-cache",
            Safe,
            true,
            vec![target("%LOCALAPPDATA%/pip/Cache")],
            &["python.exe", "python3.exe", "pip.exe"],
        ),
        builtin(
            "cargo-cache",
            Review,
            false,
            vec![
                target("%USERPROFILE%/.cargo/registry/cache"),
                target("%USERPROFILE%/.cargo/git/db"),
            ],
            &["cargo.exe", "rustc.exe"],
        ),
        builtin(
            "gradle-cache",
            Review,
            false,
            vec![
                target("%USERPROFILE%/.gradle/caches"),
                target("%USERPROFILE%/.gradle/daemon"),
            ],
            &["java.exe", "gradle.exe"],
        ),
        builtin(
            "nvidia-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/NVIDIA/DXCache"),
                target("%LOCALAPPDATA%/NVIDIA/GLCache"),
                target("%LOCALAPPDATA%/NVIDIA/ComputeCache"),
            ],
            &[],
        ),
        builtin(
            "amd-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/AMD/DxCache"),
                target("%LOCALAPPDATA%/AMD/GLCache"),
            ],
            &[],
        ),
        builtin(
            "steam-web-cache",
            Safe,
            true,
            vec![
                target("%LOCALAPPDATA%/Steam/htmlcache/Cache"),
                target("%LOCALAPPDATA%/Steam/htmlcache/Code Cache"),
                target("%LOCALAPPDATA%/Steam/htmlcache/GPUCache"),
            ],
            &["steam.exe", "steamwebhelper.exe"],
        ),
        builtin(
            "zoom-cache",
            Safe,
            true,
            vec![
                target("%APPDATA%/Zoom/data/WebviewCache"),
                target("%APPDATA%/Zoom/logs"),
            ],
            &["zoom.exe"],
        ),
        builtin(
            "office-cache",
            Review,
            false,
            vec![target(
                "%LOCALAPPDATA%/Microsoft/Office/16.0/OfficeFileCache",
            )],
            &["winword.exe", "excel.exe", "powerpnt.exe", "outlook.exe"],
        ),
        builtin(
            "windows-logs",
            Review,
            false,
            vec![files("%WINDIR%/Logs", &["*.log", "*.etl", "*.cab"])],
            &[],
        ),
    ]
}

fn imported_recipes(storage: &Storage) -> Result<Vec<CleanerRecipe>, String> {
    let mut output = Vec::new();
    for record in storage.system_cleaner_recipe_bundles()? {
        let payload: RecipeBundlePayload =
            serde_json::from_str(&record.payload_json).map_err(|error| {
                format!(
                    "Stored recipe bundle {} is invalid: {error}",
                    record.bundle_id
                )
            })?;
        output.extend(payload.recipes.into_iter().map(|mut recipe| {
            recipe.source = payload.source.clone();
            recipe.built_in = false;
            recipe.default_selected = false;
            recipe
        }));
    }
    Ok(output)
}

pub fn all_recipes(storage: &Storage) -> Result<Vec<CleanerRecipe>, String> {
    let mut recipes = built_in_recipes();
    let mut ids = recipes
        .iter()
        .map(|recipe| recipe.id.clone())
        .collect::<HashSet<_>>();
    for recipe in imported_recipes(storage)? {
        if ids.insert(recipe.id.clone()) {
            recipes.push(recipe);
        }
    }
    Ok(recipes)
}

fn collect_target_files(
    recipe: &CleanerRecipe,
    target: &CleanerTarget,
    keep_paths: &[PathBuf],
    output: &mut Vec<CachedPlanItem>,
    excluded: &mut u64,
) -> Result<(), String> {
    let roots = expand_wildcard_directories(&target.path)?;
    for root in roots {
        let root_metadata = match fs::symlink_metadata(&root) {
            Ok(metadata) if metadata.is_dir() && !is_reparse(&metadata) => metadata,
            _ => continue,
        };
        let _ = root_metadata;
        let canonical_root = fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
        let mut work = vec![root];
        while let Some(directory) = work.pop() {
            let Ok(entries) = fs::read_dir(&directory) else {
                continue;
            };
            for entry in entries.flatten() {
                if output.len() >= MAX_PLAN_ITEMS {
                    return Err(format!(
                        "Cleanup preview exceeds the {MAX_PLAN_ITEMS}-file safety limit."
                    ));
                }
                let path = entry.path();
                let Ok(metadata) = fs::symlink_metadata(&path) else {
                    continue;
                };
                if is_reparse(&metadata) {
                    *excluded = excluded.saturating_add(1);
                    continue;
                }
                if metadata.is_dir() {
                    if target.recursive {
                        work.push(path);
                    }
                    continue;
                }
                if !metadata.is_file() {
                    continue;
                }
                if !target.file_patterns.is_empty()
                    && !target.file_patterns.iter().any(|pattern| {
                        wildcard_match(pattern, &entry.file_name().to_string_lossy())
                    })
                {
                    continue;
                }
                if is_protected(&path) || matches_exclusion(&path, recipe, keep_paths) {
                    *excluded = excluded.saturating_add(1);
                    continue;
                }
                output.push(CachedPlanItem {
                    public: CleanupPlanItem {
                        recipe_id: recipe.id.clone(),
                        path: path.to_string_lossy().into_owned(),
                        bytes: metadata.len(),
                        modified_unix_ms: metadata_modified_ms(&metadata),
                        file_id: file_identity(&path),
                    },
                    target_root: canonical_root.clone(),
                });
            }
        }
    }
    Ok(())
}

fn running_process_names() -> HashSet<String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("tasklist.exe");
        command.args(["/FO", "CSV", "/NH"]);
        command.creation_flags(CREATE_NO_WINDOW);
        return command
            .output()
            .ok()
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
            .unwrap_or_default()
            .lines()
            .filter_map(|line| line.trim().strip_prefix('"'))
            .filter_map(|line| line.split("\",").next())
            .map(|name| name.to_ascii_lowercase())
            .collect();
    }
    #[cfg(not(target_os = "windows"))]
    HashSet::new()
}

fn recipe_blockers(recipe: &CleanerRecipe, running: &HashSet<String>) -> Vec<String> {
    recipe
        .running_processes
        .iter()
        .filter(|process| running.contains(&process.to_ascii_lowercase()))
        .cloned()
        .collect()
}

fn build_cached_plan(
    recipes: &[CleanerRecipe],
    selected_ids: &HashSet<String>,
    keep_paths: &[PathBuf],
) -> Result<CachedPlan, String> {
    let mut items = Vec::new();
    let mut excluded_items = 0_u64;
    let mut versions = BTreeMap::new();
    let mut process_map = HashMap::new();
    let running = running_process_names();
    let mut blocked = HashSet::new();
    for recipe in recipes
        .iter()
        .filter(|recipe| selected_ids.contains(&recipe.id))
    {
        versions.insert(recipe.id.clone(), recipe.version);
        let blockers = recipe_blockers(recipe, &running);
        blocked.extend(blockers.iter().cloned());
        process_map.insert(recipe.id.clone(), recipe.running_processes.clone());
        for target in &recipe.targets {
            collect_target_files(recipe, target, keep_paths, &mut items, &mut excluded_items)?;
        }
    }
    let mut unique = HashSet::new();
    items.retain(|item| unique.insert(normalize(Path::new(&item.public.path))));
    items.sort_by(|left, right| left.public.path.cmp(&right.public.path));
    let total_bytes = items
        .iter()
        .map(|item| item.public.bytes)
        .fold(0_u64, u64::saturating_add);
    let created_at = now_rfc3339();
    let mut token_material = serde_json::to_vec(&(
        &created_at,
        &versions,
        items
            .iter()
            .map(|item| {
                (
                    &item.public.path,
                    item.public.bytes,
                    item.public.modified_unix_ms,
                )
            })
            .collect::<Vec<_>>(),
    ))
    .map_err(|error| error.to_string())?;
    token_material.extend_from_slice(&std::process::id().to_le_bytes());
    let token = sha256_hex(&token_material);
    let public = CleanupPlan {
        token,
        created_at,
        total_bytes,
        excluded_items,
        items: items.iter().map(|item| item.public.clone()).collect(),
        recipe_versions: versions,
        blocked_processes: {
            let mut values = blocked.into_iter().collect::<Vec<_>>();
            values.sort();
            values
        },
    };
    Ok(CachedPlan {
        public,
        items,
        recipe_processes: process_map,
    })
}

fn cache_plan(plan: CachedPlan) {
    let cache = PLAN_CACHE.get_or_init(|| RwLock::new(HashMap::new()));
    let Ok(mut cache) = cache.write() else {
        return;
    };
    if cache.len() >= 3 {
        let oldest = cache
            .values()
            .min_by_key(|plan| plan.public.created_at.clone())
            .map(|plan| plan.public.token.clone());
        if let Some(oldest) = oldest {
            cache.remove(&oldest);
        }
    }
    cache.insert(plan.public.token.clone(), plan);
}

pub fn build_plan(storage: &Storage, ids: Vec<String>) -> Result<CleanupPlan, String> {
    let selected = ids.into_iter().collect::<HashSet<_>>();
    if selected.is_empty() {
        return Err("Select at least one cleanup recipe.".into());
    }
    let recipes = all_recipes(storage)?;
    if selected
        .iter()
        .any(|id| !recipes.iter().any(|recipe| &recipe.id == id))
    {
        return Err("The cleanup selection contains an unknown recipe.".into());
    }
    let keep_paths = storage
        .system_cleaner_keep_paths()?
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let plan = build_cached_plan(&recipes, &selected, &keep_paths)?;
    let public = plan.public.clone();
    cache_plan(plan);
    Ok(public)
}

pub fn catalog(storage: &Storage) -> Result<Vec<RecipeCatalogEntry>, String> {
    let recipes = all_recipes(storage)?;
    let keep_paths = storage
        .system_cleaner_keep_paths()?
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let running = running_process_names();
    recipes
        .into_iter()
        .map(|recipe| {
            let mut items = Vec::new();
            let mut excluded = 0_u64;
            // Built-ins are few and reviewed, so the scan reports their exact
            // size. Imported catalogs may contain thousands of Winapp2 rules;
            // expanding every rule would multiply filesystem work. Imported
            // rules are enumerated exactly only when the user selects Preview.
            if recipe.built_in {
                for target in &recipe.targets {
                    collect_target_files(&recipe, target, &keep_paths, &mut items, &mut excluded)?;
                }
            }
            let mut unique = HashSet::new();
            items.retain(|item| unique.insert(normalize(Path::new(&item.public.path))));
            let running_processes = recipe_blockers(&recipe, &running);
            Ok(RecipeCatalogEntry {
                id: recipe.id,
                version: recipe.version,
                title: recipe.title,
                description: recipe.description,
                safety: recipe.safety,
                default_selected: recipe.default_selected,
                display_path: recipe
                    .targets
                    .first()
                    .map(|target| target.path.clone())
                    .unwrap_or_default(),
                bytes: items
                    .iter()
                    .map(|item| item.public.bytes)
                    .fold(0_u64, u64::saturating_add),
                item_count: items.len() as u64,
                source: recipe.source,
                built_in: recipe.built_in,
                warning: recipe.warning,
                running_processes,
            })
        })
        .collect()
}

fn validate_plan_item(
    item: &CachedPlanItem,
    keep_paths: &[PathBuf],
) -> Result<fs::Metadata, String> {
    let path = Path::new(&item.public.path);
    if is_protected(path) || keep_paths.iter().any(|keep| path_within(path, keep)) {
        return Err("excluded".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "missing".to_string()
        } else {
            "locked".to_string()
        }
    })?;
    if !metadata.is_file() || is_reparse(&metadata) {
        return Err("changed".into());
    }
    let canonical = fs::canonicalize(path).map_err(|_| "changed".to_string())?;
    if !path_within(&canonical, &item.target_root)
        || metadata.len() != item.public.bytes
        || metadata_modified_ms(&metadata) / 1_000 != item.public.modified_unix_ms / 1_000
        || (item.public.file_id != 0 && file_identity(path) != item.public.file_id)
    {
        return Err("changed".into());
    }
    Ok(metadata)
}

pub fn cancel_cleanup() {
    CLEAN_CANCELLED.store(true, Ordering::Release);
}

pub fn execute_plan(
    storage: &Storage,
    token: &str,
    retry_paths: Option<Vec<String>>,
) -> Result<CleanupResult, String> {
    let plan = PLAN_CACHE
        .get_or_init(|| RwLock::new(HashMap::new()))
        .read()
        .map_err(|_| "Cleanup plan cache is unavailable.".to_string())?
        .get(token)
        .cloned()
        .ok_or_else(|| "The cleanup preview expired. Preview the selection again.".to_string())?;
    let created_at = OffsetDateTime::parse(&plan.public.created_at, &Rfc3339)
        .map_err(|_| "The cleanup preview timestamp is invalid.".to_string())?;
    if OffsetDateTime::now_utc() - created_at > time::Duration::minutes(PLAN_MAX_AGE_MINUTES) {
        return Err("The cleanup preview expired. Preview the selection again.".into());
    }
    let retry_filter = retry_paths.map(|paths| {
        paths
            .into_iter()
            .map(|path| normalize(Path::new(&path)))
            .collect::<HashSet<_>>()
    });
    let keep_paths = storage
        .system_cleaner_keep_paths()?
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let running = running_process_names();
    let blocked_recipes = plan
        .recipe_processes
        .iter()
        .filter(|(_, processes)| {
            processes
                .iter()
                .any(|process| running.contains(&process.to_ascii_lowercase()))
        })
        .map(|(id, _)| id.clone())
        .collect::<HashSet<_>>();
    CLEAN_CANCELLED.store(false, Ordering::Release);
    let started_at = now_rfc3339();
    let run_id =
        sha256_hex(format!("{}:{}:{}", token, started_at, retry_filter.is_some()).as_bytes())[..24]
            .to_string();
    let mut freed_bytes = 0_u64;
    let mut deleted_items = 0_u64;
    let mut skipped = Vec::new();
    let mut cancelled = false;
    for item in &plan.items {
        if retry_filter
            .as_ref()
            .is_some_and(|paths| !paths.contains(&normalize(Path::new(&item.public.path))))
        {
            continue;
        }
        if CLEAN_CANCELLED.load(Ordering::Acquire) {
            cancelled = true;
            skipped.push(CleanupSkip {
                path: item.public.path.clone(),
                reason: "cancelled".into(),
            });
            continue;
        }
        if blocked_recipes.contains(&item.public.recipe_id) {
            skipped.push(CleanupSkip {
                path: item.public.path.clone(),
                reason: "applicationRunning".into(),
            });
            continue;
        }
        if let Err(reason) = validate_plan_item(item, &keep_paths) {
            skipped.push(CleanupSkip {
                path: item.public.path.clone(),
                reason,
            });
            continue;
        }
        match fs::remove_file(&item.public.path) {
            Ok(()) => {
                freed_bytes = freed_bytes.saturating_add(item.public.bytes);
                deleted_items = deleted_items.saturating_add(1);
            }
            Err(error) => skipped.push(CleanupSkip {
                path: item.public.path.clone(),
                reason: if error.kind() == std::io::ErrorKind::PermissionDenied {
                    "locked"
                } else {
                    "failed"
                }
                .into(),
            }),
        }
    }
    let status = if cancelled {
        "cancelled"
    } else if skipped.is_empty() {
        "completed"
    } else {
        "partial"
    };
    let details_json = serde_json::to_string(&serde_json::json!({ "skipped": &skipped }))
        .map_err(|error| error.to_string())?;
    storage.system_cleaner_record_history(&SystemCleanerHistoryRecord {
        id: run_id.clone(),
        started_at,
        completed_at: now_rfc3339(),
        origin: if retry_filter.is_some() {
            "retry"
        } else {
            "manual"
        }
        .into(),
        status: status.into(),
        recipe_versions_json: serde_json::to_string(&plan.public.recipe_versions)
            .map_err(|error| error.to_string())?,
        planned_bytes: plan.public.total_bytes,
        freed_bytes,
        deleted_items,
        skipped_items: skipped.len() as u64,
        details_json,
    })?;
    Ok(CleanupResult {
        run_id,
        freed_bytes,
        deleted_items,
        skipped,
        cancelled,
    })
}

pub fn validate_rule(storage: &Storage, raw_json: &str) -> RecipeValidationResult {
    let mut errors = Vec::new();
    let recipe = match serde_json::from_str::<CleanerRecipe>(raw_json) {
        Ok(mut recipe) => {
            recipe.built_in = false;
            recipe.default_selected = false;
            if recipe.source.trim().is_empty() {
                recipe.source = "Rule Lab".into();
            }
            errors.extend(validate_recipe(&recipe, true));
            Some(recipe)
        }
        Err(error) => {
            errors.push(format!("Invalid recipe JSON: {error}"));
            None
        }
    };
    let preview = if errors.is_empty() {
        recipe.as_ref().and_then(|recipe| {
            let keep = storage
                .system_cleaner_keep_paths()
                .ok()?
                .into_iter()
                .map(PathBuf::from)
                .collect::<Vec<_>>();
            let selected = HashSet::from([recipe.id.clone()]);
            build_cached_plan(std::slice::from_ref(recipe), &selected, &keep)
                .ok()
                .map(|plan| plan.public)
        })
    } else {
        None
    };
    RecipeValidationResult {
        valid: errors.is_empty(),
        errors,
        recipe,
        preview,
    }
}

fn parse_signed_bundle(
    raw_json: &str,
) -> Result<(RecipeBundlePayload, RecipeBundlePreview), String> {
    if raw_json.len() > MAX_BUNDLE_BYTES {
        return Err("Recipe bundle exceeds the 16 MB limit.".into());
    }
    let signed: SignedRecipeBundle = serde_json::from_str(raw_json)
        .map_err(|error| format!("Invalid signed bundle: {error}"))?;
    let key_bytes = decode_hex::<32>(&signed.public_key_hex)?;
    let signature_bytes = decode_hex::<64>(&signed.signature_hex)?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|error| error.to_string())?;
    let signature = Signature::from_bytes(&signature_bytes);
    key.verify(signed.payload.as_bytes(), &signature)
        .map_err(|_| "Recipe bundle signature verification failed.".to_string())?;
    let payload: RecipeBundlePayload = serde_json::from_str(&signed.payload)
        .map_err(|error| format!("Invalid recipe payload: {error}"))?;
    validate_bundle(&payload)?;
    let fingerprint = sha256_hex(&key_bytes)[..16].to_string();
    let preview = RecipeBundlePreview {
        bundle_id: payload.bundle_id.clone(),
        version: payload.version,
        source: payload.source.clone(),
        signer_fingerprint: fingerprint,
        sha256: sha256_hex(signed.payload.as_bytes()),
        recipe_count: payload.recipes.len(),
        added: Vec::new(),
        updated: Vec::new(),
        removed: Vec::new(),
        payload_json: signed.payload,
    };
    Ok((payload, preview))
}

fn validate_bundle(payload: &RecipeBundlePayload) -> Result<(), String> {
    if payload.schema_version != RECIPE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported recipe schema version {}.",
            payload.schema_version
        ));
    }
    if !validate_id(&payload.bundle_id) || payload.version == 0 {
        return Err("Bundle id or version is invalid.".into());
    }
    if payload.recipes.is_empty() || payload.recipes.len() > MAX_IMPORTED_RECIPES {
        return Err(format!(
            "Bundles must contain 1–{MAX_IMPORTED_RECIPES} recipes."
        ));
    }
    let builtins = built_in_recipes()
        .into_iter()
        .map(|recipe| recipe.id)
        .collect::<HashSet<_>>();
    let mut ids = HashSet::new();
    for recipe in &payload.recipes {
        let errors = validate_recipe(recipe, true);
        if !errors.is_empty() {
            return Err(format!("Recipe '{}': {}", recipe.id, errors.join(" ")));
        }
        if builtins.contains(&recipe.id) || !ids.insert(recipe.id.clone()) {
            return Err(format!(
                "Recipe id '{}' conflicts with another recipe.",
                recipe.id
            ));
        }
    }
    if payload
        .update_url
        .as_ref()
        .is_some_and(|url| !url.starts_with("https://"))
    {
        return Err("Recipe update URLs must use HTTPS.".into());
    }
    Ok(())
}

pub fn preview_signed_bundle(
    storage: &Storage,
    raw_json: &str,
) -> Result<RecipeBundlePreview, String> {
    let (payload, mut preview) = parse_signed_bundle(raw_json)?;
    let installed = storage.system_cleaner_recipe_bundles()?;
    let incoming_ids = payload
        .recipes
        .iter()
        .map(|recipe| recipe.id.as_str())
        .collect::<HashSet<_>>();
    for record in installed
        .iter()
        .filter(|record| record.bundle_id != payload.bundle_id)
    {
        let other: RecipeBundlePayload =
            serde_json::from_str(&record.payload_json).map_err(|error| {
                format!(
                    "Stored recipe bundle {} is invalid: {error}",
                    record.bundle_id
                )
            })?;
        if let Some(conflict) = other
            .recipes
            .iter()
            .find(|recipe| incoming_ids.contains(recipe.id.as_str()))
        {
            return Err(format!(
                "Recipe id '{}' is already owned by bundle '{}'.",
                conflict.id, record.bundle_id
            ));
        }
    }
    let existing = installed
        .into_iter()
        .find(|record| record.bundle_id == payload.bundle_id);
    if let Some(existing) = existing {
        if payload.version <= existing.version {
            return Err(format!(
                "Bundle version {} is not newer than installed version {}.",
                payload.version, existing.version
            ));
        }
        if existing.signer_fingerprint != preview.signer_fingerprint {
            return Err("The update was signed by a different key.".into());
        }
        let old: RecipeBundlePayload =
            serde_json::from_str(&existing.payload_json).map_err(|error| error.to_string())?;
        let old_versions = old
            .recipes
            .into_iter()
            .map(|recipe| (recipe.id, recipe.version))
            .collect::<HashMap<_, _>>();
        let new_versions = payload
            .recipes
            .iter()
            .map(|recipe| (recipe.id.clone(), recipe.version))
            .collect::<HashMap<_, _>>();
        if let Some((id, version, old_version)) = new_versions.iter().find_map(|(id, version)| {
            old_versions
                .get(id)
                .filter(|old_version| version < *old_version)
                .map(|old_version| (id, version, old_version))
        }) {
            return Err(format!(
                "Recipe '{id}' version {version} cannot replace newer installed version {old_version}."
            ));
        }
        preview.added = new_versions
            .keys()
            .filter(|id| !old_versions.contains_key(*id))
            .cloned()
            .collect();
        preview.updated = new_versions
            .iter()
            .filter(|(id, version)| old_versions.get(*id).is_some_and(|old| old != *version))
            .map(|(id, _)| id.clone())
            .collect();
        preview.removed = old_versions
            .keys()
            .filter(|id| !new_versions.contains_key(*id))
            .cloned()
            .collect();
    } else {
        preview.added = payload
            .recipes
            .iter()
            .map(|recipe| recipe.id.clone())
            .collect();
    }
    Ok(preview)
}

pub fn import_signed_bundle(storage: &Storage, raw_json: &str) -> Result<RecipeBundleInfo, String> {
    let preview = preview_signed_bundle(storage, raw_json)?;
    storage.system_cleaner_upsert_recipe_bundle(&SystemCleanerRecipeBundleRecord {
        bundle_id: preview.bundle_id.clone(),
        version: preview.version,
        source: preview.source.clone(),
        signer_fingerprint: preview.signer_fingerprint.clone(),
        sha256: preview.sha256.clone(),
        payload_json: preview.payload_json.clone(),
    })?;
    Ok(RecipeBundleInfo {
        bundle_id: preview.bundle_id,
        version: preview.version,
        source: preview.source,
        signer_fingerprint: preview.signer_fingerprint,
        sha256: preview.sha256,
        recipe_count: preview.recipe_count,
    })
}

pub fn bundle_infos(storage: &Storage) -> Result<Vec<RecipeBundleInfo>, String> {
    storage
        .system_cleaner_recipe_bundles()?
        .into_iter()
        .map(|record| {
            let payload: RecipeBundlePayload =
                serde_json::from_str(&record.payload_json).map_err(|error| error.to_string())?;
            Ok(RecipeBundleInfo {
                bundle_id: record.bundle_id,
                version: record.version,
                source: record.source,
                signer_fingerprint: record.signer_fingerprint,
                sha256: record.sha256,
                recipe_count: payload.recipes.len(),
            })
        })
        .collect()
}

fn slug(value: &str) -> String {
    let mut output = String::new();
    let mut dash = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_lowercase());
            dash = false;
        } else if !dash && !output.is_empty() {
            output.push('-');
            dash = true;
        }
    }
    output.trim_matches('-').chars().take(72).collect()
}

fn normalize_winapp_variable(path: &str) -> String {
    let replacements = [
        ("%localappdata%", "%LOCALAPPDATA%"),
        ("%appdata%", "%APPDATA%"),
        ("%userprofile%", "%USERPROFILE%"),
        ("%windir%", "%WINDIR%"),
        ("%systemroot%", "%WINDIR%"),
        ("%programdata%", "%PROGRAMDATA%"),
        ("%temp%", "%TEMP%"),
    ];
    let lower = path.to_ascii_lowercase();
    for (source, target) in replacements {
        if lower.starts_with(source) {
            return format!("{target}{}", &path[source.len()..]).replace('\\', "/");
        }
    }
    path.replace('\\', "/")
}

pub fn preview_winapp2(text: &str, source: &str) -> Result<Winapp2ImportPreview, String> {
    if text.len() > MAX_BUNDLE_BYTES {
        return Err("Winapp2 data exceeds the 16 MB limit.".into());
    }
    let mut recipes = Vec::new();
    let mut current_name = String::new();
    let mut current_targets = Vec::new();
    let mut registry = 0_usize;
    let mut unsupported = 0_usize;
    let bundle_hash = &sha256_hex(text.as_bytes())[..12];
    let flush =
        |recipes: &mut Vec<CleanerRecipe>, name: &mut String, targets: &mut Vec<CleanerTarget>| {
            if name.is_empty() || targets.is_empty() || recipes.len() >= MAX_IMPORTED_RECIPES {
                targets.clear();
                return;
            }
            let id = format!("winapp2.{bundle_hash}.{}", slug(name));
            if validate_id(&id) && !recipes.iter().any(|recipe: &CleanerRecipe| recipe.id == id) {
                recipes.push(CleanerRecipe {
                    id,
                    version: 1,
                    title: name.clone(),
                    description: "__kkterm_winapp2__".into(),
                    safety: RecipeSafety::Review,
                    default_selected: false,
                    targets: std::mem::take(targets),
                    excludes: Vec::new(),
                    running_processes: Vec::new(),
                    warning: Some("__kkterm_winapp2_warning__".into()),
                    source: source.into(),
                    built_in: false,
                });
            } else {
                targets.clear();
            }
        };
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            flush(&mut recipes, &mut current_name, &mut current_targets);
            current_name = line[1..line.len() - 1]
                .trim_end_matches('*')
                .trim()
                .to_string();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key_lower = key.trim().to_ascii_lowercase();
        if key_lower.starts_with("regkey") {
            registry += 1;
            continue;
        }
        if !key_lower.starts_with("filekey") {
            continue;
        }
        let parts = value.split('|').map(str::trim).collect::<Vec<_>>();
        if parts.len() < 2 {
            unsupported += 1;
            continue;
        }
        let path = normalize_winapp_variable(parts[0]);
        if !path.starts_with('%') || expand_template(&path).is_err() {
            unsupported += 1;
            continue;
        }
        let recursive = parts
            .iter()
            .skip(2)
            .any(|flag| flag.eq_ignore_ascii_case("RECURSE"));
        let patterns = parts[1]
            .split(';')
            .map(str::trim)
            .filter(|pattern| {
                !pattern.is_empty() && !pattern.contains(['/', '\\']) && !pattern.contains("..")
            })
            .map(str::to_string)
            .collect::<Vec<_>>();
        if patterns.is_empty() {
            unsupported += 1;
            continue;
        }
        current_targets.push(CleanerTarget {
            path,
            file_patterns: patterns,
            recursive,
        });
    }
    flush(&mut recipes, &mut current_name, &mut current_targets);
    if recipes.is_empty() {
        return Err("No supported file-only Winapp2 rules were found.".into());
    }
    let payload = RecipeBundlePayload {
        schema_version: RECIPE_SCHEMA_VERSION,
        bundle_id: format!("winapp2-{bundle_hash}"),
        version: 1,
        source: source.into(),
        update_url: None,
        recipes,
    };
    let payload_json = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    Ok(Winapp2ImportPreview {
        recipe_count: payload.recipes.len(),
        skipped_registry_keys: registry,
        skipped_unsupported_entries: unsupported,
        warnings: vec![
            "Registry keys, commands, and unsupported variables are ignored.".into(),
            "All imported rules are Review safety and remain off by default.".into(),
        ],
        payload_json,
    })
}

pub fn import_winapp2(
    storage: &Storage,
    text: &str,
    source: &str,
) -> Result<RecipeBundleInfo, String> {
    let preview = preview_winapp2(text, source)?;
    let payload: RecipeBundlePayload =
        serde_json::from_str(&preview.payload_json).map_err(|error| error.to_string())?;
    let sha256 = sha256_hex(preview.payload_json.as_bytes());
    storage.system_cleaner_upsert_recipe_bundle(&SystemCleanerRecipeBundleRecord {
        bundle_id: payload.bundle_id.clone(),
        version: payload.version,
        source: payload.source.clone(),
        signer_fingerprint: "local-unverified".into(),
        sha256: sha256.clone(),
        payload_json: preview.payload_json,
    })?;
    Ok(RecipeBundleInfo {
        bundle_id: payload.bundle_id,
        version: payload.version,
        source: payload.source,
        signer_fingerprint: "local-unverified".into(),
        sha256,
        recipe_count: payload.recipes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcard_match_is_case_insensitive_and_bounded() {
        assert!(wildcard_match("thumbcache_*.db", "ThumbCache_256.DB"));
        assert!(!wildcard_match("*.log", "notes.txt"));
    }

    #[test]
    fn imported_rules_cannot_claim_safe_or_default_selection() {
        let mut recipe = builtin(
            "third-party",
            RecipeSafety::Safe,
            true,
            vec![target("%TEMP%/vendor/cache")],
            &[],
        );
        recipe.built_in = false;
        recipe.title = "Third-party cache".into();
        recipe.description = "Fixture imported cache rule.".into();
        let errors = validate_recipe(&recipe, true);
        assert!(
            errors
                .iter()
                .any(|error| error.contains("cannot be selected by default"))
        );
        assert!(
            errors
                .iter()
                .any(|error| error.contains("must use Review or Risky"))
        );
    }

    #[test]
    fn winapp2_import_ignores_registry_and_keeps_file_rules_review_only() {
        let source = "[Example*]\nLangSecRef=3021\nFileKey1=%LocalAppData%\\Example\\Cache|*.tmp|RECURSE\nRegKey1=HKCU\\Software\\Example";
        let preview = preview_winapp2(source, "fixture").expect("preview");
        assert_eq!(preview.recipe_count, 1);
        assert_eq!(preview.skipped_registry_keys, 1);
        let payload: RecipeBundlePayload =
            serde_json::from_str(&preview.payload_json).expect("payload");
        assert_eq!(payload.recipes[0].safety, RecipeSafety::Review);
        assert!(!payload.recipes[0].default_selected);
    }

    #[test]
    fn protected_credentials_are_never_cleanable() {
        assert!(is_protected(Path::new(r"C:\Users\tester\.ssh\config")));
        assert!(is_protected(Path::new(
            r"C:\Users\tester\AppData\Local\Browser\Login Data"
        )));
    }

    fn cached_test_item(path: &Path, root: &Path) -> CachedPlanItem {
        let metadata = fs::metadata(path).expect("fixture metadata");
        CachedPlanItem {
            public: CleanupPlanItem {
                recipe_id: "fixture".into(),
                path: path.to_string_lossy().into_owned(),
                bytes: metadata.len(),
                modified_unix_ms: metadata_modified_ms(&metadata),
                file_id: file_identity(path),
            },
            target_root: fs::canonicalize(root).expect("canonical fixture root"),
        }
    }

    #[test]
    fn plan_item_revalidation_rejects_a_changed_file() {
        let root = tempfile::tempdir().expect("cleanup fixture");
        let path = root.path().join("cache.bin");
        fs::write(&path, [1_u8; 4]).expect("fixture file");
        let item = cached_test_item(&path, root.path());
        assert!(validate_plan_item(&item, &[]).is_ok());
        fs::write(&path, [2_u8; 8]).expect("changed fixture file");
        assert_eq!(validate_plan_item(&item, &[]).unwrap_err(), "changed");
    }

    #[test]
    fn exact_plan_execution_deletes_only_the_planned_file_and_records_history() {
        let root = tempfile::tempdir().expect("cleanup fixture");
        let planned_path = root.path().join("planned.tmp");
        let untouched_path = root.path().join("untouched.tmp");
        fs::write(&planned_path, [1_u8; 5]).expect("planned fixture");
        fs::write(&untouched_path, [2_u8; 7]).expect("unplanned fixture");
        let item = cached_test_item(&planned_path, root.path());
        let public = CleanupPlan {
            token: "fixture-plan".into(),
            created_at: now_rfc3339(),
            total_bytes: 5,
            excluded_items: 0,
            items: vec![item.public.clone()],
            recipe_versions: BTreeMap::from([("fixture".into(), 1)]),
            blocked_processes: Vec::new(),
        };
        cache_plan(CachedPlan {
            public,
            items: vec![item],
            recipe_processes: HashMap::new(),
        });
        let storage = Storage::open(root.path().join("history.sqlite3")).expect("test storage");
        let result = execute_plan(&storage, "fixture-plan", None).expect("cleanup executes");
        assert_eq!(result.deleted_items, 1);
        assert_eq!(result.freed_bytes, 5);
        assert!(!planned_path.exists());
        assert!(untouched_path.exists());
        assert_eq!(storage.system_cleaner_history(10).unwrap().len(), 1);
    }
}

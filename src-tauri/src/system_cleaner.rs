use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
#[cfg(target_os = "windows")]
use std::os::windows::{ffi::OsStrExt, fs::MetadataExt, process::CommandExt};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{OnceLock, RwLock},
};
use tauri::{AppHandle, Emitter, Manager};
use time::OffsetDateTime;

use crate::storage::{Storage, SystemCleanerHistoryRecord};
use crate::system_cleaner_recipes::{CleanupPlan, CleanupResult, RecipeCatalogEntry};

#[cfg(target_os = "windows")]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
#[cfg(target_os = "windows")]
const FILE_ATTRIBUTE_SPARSE_FILE: u32 = 0x200;
#[cfg(target_os = "windows")]
const FILE_ATTRIBUTE_COMPRESSED: u32 = 0x800;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const LARGE_OLD_FILE_MIN_BYTES: u64 = 100 * 1024 * 1024;
const LARGE_OLD_FILE_AGE_DAYS: u64 = 180;
const OLD_DOWNLOAD_AGE_DAYS: u64 = 90;
const MAX_REVIEW_FILES_PER_CATEGORY: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanerOverview {
    scan_root: String,
    total_bytes: u64,
    total_allocated_bytes: u64,
    largest: Vec<DiskEntry>,
    cleanup: Vec<RecipeCatalogEntry>,
    recommendations: Vec<ReviewCategory>,
    apps: Vec<InstalledApp>,
    extensions: Vec<ExtensionEntry>,
    file_count: u64,
    folder_count: u64,
    elapsed_ms: u64,
    disk_capacity_bytes: u64,
    disk_free_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveEntry {
    path: String,
    capacity_bytes: u64,
    free_bytes: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionEntry {
    extension: String,
    bytes: u64,
    allocated_bytes: u64,
    files: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    phase: ScanProgressPhase,
    files: u64,
    folders: u64,
    bytes: u64,
    current_path: String,
    elapsed_ms: u64,
    phase_completed: u64,
    phase_total: u64,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum ScanProgressPhase {
    Files,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskEntry {
    name: String,
    path: String,
    bytes: u64,
    allocated_bytes: u64,
    is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    path: String,
    parent_path: Option<String>,
    total_bytes: u64,
    total_allocated_bytes: u64,
    entries: Vec<DiskEntry>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewFile {
    name: String,
    path: String,
    bytes: u64,
    allocated_bytes: u64,
    modified_unix_ms: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewCategory {
    id: String,
    bytes: u64,
    files: Vec<ReviewFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledApp {
    name: String,
    id: String,
    version: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppxPackage {
    #[serde(alias = "Name")]
    name: String,
    #[serde(alias = "PackageFullName")]
    package_full_name: String,
    #[serde(alias = "Version")]
    version: String,
    #[serde(alias = "Publisher")]
    publisher: String,
    #[serde(default, alias = "IsFramework")]
    is_framework: bool,
    #[serde(default, alias = "NonRemovable")]
    non_removable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsMaintenanceStatus {
    recycle_bin_bytes: u64,
    recycle_bin_items: u64,
    delivery_optimization_available: bool,
    component_cleanup_available: bool,
}

struct ScanCache {
    root: PathBuf,
    directory_bytes: HashMap<PathBuf, u64>,
    directory_allocated_bytes: HashMap<PathBuf, u64>,
    review_files: HashMap<String, ReviewFile>,
}

#[derive(Deserialize, Serialize)]
struct DriveScan {
    root_entries: Vec<DiskEntry>,
    extensions: Vec<ExtensionEntry>,
    files: u64,
    folders: u64,
    elapsed_ms: u64,
    total_bytes: u64,
    total_allocated_bytes: u64,
    directory_bytes: HashMap<PathBuf, u64>,
    directory_allocated_bytes: HashMap<PathBuf, u64>,
    recommendations: Vec<ReviewCategory>,
}

enum ScanWork {
    Enter {
        path: PathBuf,
        parent: Option<PathBuf>,
    },
    Exit {
        path: PathBuf,
        parent: Option<PathBuf>,
    },
}

struct ScannedEntry {
    name: String,
    path: PathBuf,
    bytes: u64,
    allocated_bytes: u64,
    is_directory: bool,
    modified_unix_ms: u64,
}

static SCAN_CACHE: OnceLock<RwLock<Option<ScanCache>>> = OnceLock::new();

#[cfg(target_os = "windows")]
fn allocation_unit_size(root: &Path) -> u64 {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceW;

    let wide = root
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let (mut sectors_per_cluster, mut bytes_per_sector) = (0_u32, 0_u32);
    let ok = unsafe {
        GetDiskFreeSpaceW(
            wide.as_ptr(),
            &mut sectors_per_cluster,
            &mut bytes_per_sector,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        1
    } else {
        u64::from(sectors_per_cluster).saturating_mul(u64::from(bytes_per_sector))
    }
}

#[cfg(not(target_os = "windows"))]
fn allocation_unit_size(_root: &Path) -> u64 {
    1
}

fn round_to_allocation_unit(bytes: u64, allocation_unit: u64) -> u64 {
    if bytes == 0 || allocation_unit <= 1 {
        bytes
    } else {
        bytes
            .saturating_sub(1)
            .saturating_div(allocation_unit)
            .saturating_add(1)
            .saturating_mul(allocation_unit)
    }
}

#[cfg(target_os = "windows")]
fn filetime_unix_ms(filetime: windows_sys::Win32::Foundation::FILETIME) -> u64 {
    let ticks = (u64::from(filetime.dwHighDateTime) << 32) | u64::from(filetime.dwLowDateTime);
    filetime_ticks_unix_ms(ticks)
}

#[cfg(target_os = "windows")]
fn filetime_ticks_unix_ms(ticks: u64) -> u64 {
    const WINDOWS_TO_UNIX_EPOCH_TICKS: u64 = 116_444_736_000_000_000;
    ticks.saturating_sub(WINDOWS_TO_UNIX_EPOCH_TICKS) / 10_000
}

#[cfg(not(target_os = "windows"))]
fn metadata_modified_unix_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

fn downloads_root() -> Option<PathBuf> {
    env::var("USERPROFILE")
        .ok()
        .map(PathBuf::from)
        .map(|path| path.join("Downloads"))
}

fn is_path_within(path: &Path, parent: &Path) -> bool {
    let path = normalized_windows_path(path);
    let parent = normalized_windows_path(parent);
    path == parent
        || path
            .strip_prefix(&parent)
            .is_some_and(|rest| rest.starts_with('\\'))
}

fn is_older_than(modified_unix_ms: u64, age_days: u64, now_unix_ms: u64) -> bool {
    modified_unix_ms > 0
        && now_unix_ms.saturating_sub(modified_unix_ms)
            >= age_days.saturating_mul(24 * 60 * 60 * 1_000)
}

fn keep_largest_review_files(files: &mut Vec<ReviewFile>) {
    files.sort_by(|left, right| {
        right
            .allocated_bytes
            .cmp(&left.allocated_bytes)
            .then_with(|| left.modified_unix_ms.cmp(&right.modified_unix_ms))
    });
    files.truncate(MAX_REVIEW_FILES_PER_CATEGORY);
}

fn build_review_categories(
    mut large_old_files: Vec<ReviewFile>,
    mut old_downloads: Vec<ReviewFile>,
) -> Vec<ReviewCategory> {
    keep_largest_review_files(&mut large_old_files);
    keep_largest_review_files(&mut old_downloads);
    [
        ("large-old-files", large_old_files),
        ("old-downloads", old_downloads),
    ]
    .into_iter()
    .map(|(id, files)| ReviewCategory {
        id: id.into(),
        bytes: files
            .iter()
            .map(|file| file.allocated_bytes)
            .fold(0_u64, u64::saturating_add),
        files,
    })
    .collect()
}

fn collect_review_file(
    large_old_files: &mut Vec<ReviewFile>,
    old_downloads: &mut Vec<ReviewFile>,
    downloads: Option<&Path>,
    path: &Path,
    bytes: u64,
    allocated_bytes: u64,
    modified_unix_ms: u64,
    now_unix_ms: u64,
) {
    let candidate = || ReviewFile {
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        bytes,
        allocated_bytes,
        modified_unix_ms,
    };
    if bytes >= LARGE_OLD_FILE_MIN_BYTES
        && is_older_than(modified_unix_ms, LARGE_OLD_FILE_AGE_DAYS, now_unix_ms)
    {
        large_old_files.push(candidate());
    }
    if downloads.is_some_and(|root| is_path_within(path, root))
        && is_older_than(modified_unix_ms, OLD_DOWNLOAD_AGE_DAYS, now_unix_ms)
    {
        old_downloads.push(candidate());
    }
}

#[cfg(target_os = "windows")]
fn allocated_file_size(
    path: &Path,
    logical_bytes: u64,
    attributes: u32,
    allocation_unit: u64,
) -> u64 {
    use windows_sys::Win32::{
        Foundation::{GetLastError, SetLastError},
        Storage::FileSystem::GetCompressedFileSizeW,
    };

    if attributes & (FILE_ATTRIBUTE_COMPRESSED | FILE_ATTRIBUTE_SPARSE_FILE) == 0 {
        return round_to_allocation_unit(logical_bytes, allocation_unit);
    }
    let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
    if !wide.starts_with(&[b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16]) {
        wide.splice(0..0, "\\\\?\\".encode_utf16());
    }
    wide.push(0);
    let mut high = 0_u32;
    unsafe { SetLastError(0) };
    let low = unsafe { GetCompressedFileSizeW(wide.as_ptr(), &mut high) };
    if low == u32::MAX && unsafe { GetLastError() } != 0 {
        round_to_allocation_unit(logical_bytes, allocation_unit)
    } else {
        round_to_allocation_unit((u64::from(high) << 32) | u64::from(low), allocation_unit)
    }
}

#[cfg(target_os = "windows")]
fn scan_directory_entries(path: &Path, allocation_unit: u64) -> Result<Vec<ScannedEntry>, String> {
    use windows_sys::Win32::{
        Foundation::INVALID_HANDLE_VALUE,
        Storage::FileSystem::{
            FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FIND_FIRST_EX_LARGE_FETCH,
            FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FindNextFileW,
            WIN32_FIND_DATAW,
        },
    };

    let pattern = path.join("*");
    let mut wide = pattern.as_os_str().encode_wide().collect::<Vec<_>>();
    if !wide.starts_with(&[b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16]) {
        wide.splice(0..0, "\\\\?\\".encode_utf16());
    }
    wide.push(0);

    let mut find_data = WIN32_FIND_DATAW::default();
    let handle = unsafe {
        FindFirstFileExW(
            wide.as_ptr(),
            FindExInfoBasic,
            (&mut find_data as *mut WIN32_FIND_DATAW).cast(),
            FindExSearchNameMatch,
            std::ptr::null(),
            FIND_FIRST_EX_LARGE_FETCH,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(format!("Could not read {}", path.display()));
    }

    let mut entries = Vec::new();
    loop {
        let name_len = find_data
            .cFileName
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(find_data.cFileName.len());
        let name = String::from_utf16_lossy(&find_data.cFileName[..name_len]);
        let attributes = find_data.dwFileAttributes;
        let is_directory = attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
        if name != "."
            && name != ".."
            && !(is_directory && attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        {
            let entry_path = path.join(&name);
            let bytes = ((find_data.nFileSizeHigh as u64) << 32) | find_data.nFileSizeLow as u64;
            entries.push(ScannedEntry {
                path: entry_path.clone(),
                name,
                bytes,
                allocated_bytes: if is_directory {
                    0
                } else {
                    allocated_file_size(&entry_path, bytes, attributes, allocation_unit)
                },
                is_directory,
                modified_unix_ms: filetime_unix_ms(find_data.ftLastWriteTime),
            });
        }
        if unsafe { FindNextFileW(handle, &mut find_data) } == 0 {
            break;
        }
    }
    unsafe { FindClose(handle) };
    Ok(entries)
}

#[cfg(not(target_os = "windows"))]
fn scan_directory_entries(path: &Path, _allocation_unit: u64) -> Result<Vec<ScannedEntry>, String> {
    let entries = fs::read_dir(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    Ok(entries
        .flatten()
        .filter_map(|entry| {
            let entry_path = entry.path();
            let metadata = fs::symlink_metadata(&entry_path).ok()?;
            if is_reparse_point(&metadata) || (!metadata.is_dir() && !metadata.is_file()) {
                return None;
            }
            Some(ScannedEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry_path,
                bytes: metadata.len(),
                allocated_bytes: metadata.len(),
                is_directory: metadata.is_dir(),
                modified_unix_ms: metadata_modified_unix_ms(&metadata),
            })
        })
        .collect())
}

#[cfg(target_os = "windows")]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(target_os = "windows"))]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn directory_entries(
    root: &Path,
    path: &Path,
    directory_bytes: &HashMap<PathBuf, u64>,
    directory_allocated_bytes: &HashMap<PathBuf, u64>,
) -> Result<DirectoryListing, String> {
    let mut entries = scan_directory_entries(path, allocation_unit_size(root))?
        .into_iter()
        .map(|entry| DiskEntry {
            name: entry.name,
            path: entry.path.to_string_lossy().into_owned(),
            bytes: if entry.is_directory {
                directory_bytes
                    .get(&entry.path)
                    .copied()
                    .unwrap_or_default()
            } else {
                entry.bytes
            },
            allocated_bytes: if entry.is_directory {
                directory_allocated_bytes
                    .get(&entry.path)
                    .copied()
                    .unwrap_or_default()
            } else {
                entry.allocated_bytes
            },
            is_directory: entry.is_directory,
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| right.bytes.cmp(&left.bytes))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    let parent_path = path
        .parent()
        .filter(|parent| path != root && parent.starts_with(root))
        .map(|parent| parent.to_string_lossy().into_owned());
    Ok(DirectoryListing {
        path: path.to_string_lossy().into_owned(),
        parent_path,
        total_bytes: directory_bytes.get(path).copied().unwrap_or_default(),
        total_allocated_bytes: directory_allocated_bytes
            .get(path)
            .copied()
            .unwrap_or_default(),
        entries,
    })
}

fn scan_tree<F>(root: &Path, mut emit_progress: F) -> Result<DriveScan, String>
where
    F: FnMut(ScanProgress),
{
    let started = std::time::Instant::now();
    let mut pending = vec![ScanWork::Enter {
        path: root.to_path_buf(),
        parent: None,
    }];
    let mut directory_bytes: HashMap<PathBuf, u64> = HashMap::new();
    let mut directory_allocated_bytes: HashMap<PathBuf, u64> = HashMap::new();
    let mut extension_totals: HashMap<String, (u64, u64, u64)> = HashMap::new();
    let allocation_unit = allocation_unit_size(root);
    let mut files = 0_u64;
    let mut folders = 0_u64;
    let mut bytes = 0_u64;
    let mut large_old_files = Vec::new();
    let mut old_downloads = Vec::new();
    let downloads = downloads_root();
    let now_unix_ms = u64::try_from(OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000)
        .unwrap_or_default();
    let mut since_progress = 0_u16;
    let mut last_progress = std::time::Instant::now();

    while let Some(work) = pending.pop() {
        match work {
            ScanWork::Enter { path, parent } => {
                folders += 1;
                directory_bytes.entry(path.clone()).or_default();
                directory_allocated_bytes.entry(path.clone()).or_default();
                pending.push(ScanWork::Exit {
                    path: path.clone(),
                    parent,
                });
                let Ok(entries) = scan_directory_entries(&path, allocation_unit) else {
                    continue;
                };
                for entry in entries {
                    let entry_path = entry.path;
                    let current_path = entry_path.to_string_lossy().into_owned();
                    if entry.is_directory {
                        pending.push(ScanWork::Enter {
                            path: entry_path,
                            parent: Some(path.clone()),
                        });
                    } else {
                        let size = entry.bytes;
                        collect_review_file(
                            &mut large_old_files,
                            &mut old_downloads,
                            downloads.as_deref(),
                            &entry_path,
                            size,
                            entry.allocated_bytes,
                            entry.modified_unix_ms,
                            now_unix_ms,
                        );
                        files += 1;
                        bytes = bytes.saturating_add(size);
                        let directory_total = directory_bytes.entry(path.clone()).or_default();
                        *directory_total = directory_total.saturating_add(size);
                        let directory_allocated_total =
                            directory_allocated_bytes.entry(path.clone()).or_default();
                        *directory_allocated_total =
                            directory_allocated_total.saturating_add(entry.allocated_bytes);
                        let extension = entry_path
                            .extension()
                            .and_then(|value| value.to_str())
                            .filter(|value| !value.is_empty())
                            .map(|value| format!(".{}", value.to_ascii_lowercase()))
                            .unwrap_or_else(|| "(none)".into());
                        let total = extension_totals.entry(extension).or_default();
                        total.0 = total.0.saturating_add(size);
                        total.1 = total.1.saturating_add(entry.allocated_bytes);
                        total.2 += 1;
                    }
                    since_progress = since_progress.saturating_add(1);
                    if since_progress >= 4_096
                        || last_progress.elapsed() >= std::time::Duration::from_millis(150)
                    {
                        since_progress = 0;
                        last_progress = std::time::Instant::now();
                        emit_progress(ScanProgress {
                            phase: ScanProgressPhase::Files,
                            files,
                            folders,
                            bytes,
                            current_path,
                            elapsed_ms: started.elapsed().as_millis() as u64,
                            phase_completed: files.saturating_add(folders),
                            phase_total: 0,
                        });
                    }
                }
            }
            ScanWork::Exit { path, parent } => {
                let total = directory_bytes.get(&path).copied().unwrap_or_default();
                if let Some(parent) = parent {
                    let parent_total = directory_bytes.entry(parent.clone()).or_default();
                    *parent_total = parent_total.saturating_add(total);
                    let allocated = directory_allocated_bytes
                        .get(&path)
                        .copied()
                        .unwrap_or_default();
                    let parent_allocated_total =
                        directory_allocated_bytes.entry(parent).or_default();
                    *parent_allocated_total = parent_allocated_total.saturating_add(allocated);
                }
            }
        }
    }
    emit_progress(ScanProgress {
        phase: ScanProgressPhase::Files,
        files,
        folders,
        bytes,
        current_path: root.to_string_lossy().into_owned(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        phase_completed: files.saturating_add(folders),
        phase_total: files.saturating_add(folders),
    });
    let root_listing = directory_entries(root, root, &directory_bytes, &directory_allocated_bytes)?;
    let mut extensions = extension_totals
        .into_iter()
        .map(
            |(extension, (bytes, allocated_bytes, files))| ExtensionEntry {
                extension,
                bytes,
                allocated_bytes,
                files,
            },
        )
        .collect::<Vec<_>>();
    extensions.sort_by_key(|entry| std::cmp::Reverse(entry.allocated_bytes));
    extensions.truncate(100);
    Ok(DriveScan {
        root_entries: root_listing.entries,
        extensions,
        files,
        folders,
        elapsed_ms: started.elapsed().as_millis() as u64,
        total_bytes: directory_bytes.get(root).copied().unwrap_or_default(),
        total_allocated_bytes: directory_allocated_bytes
            .get(root)
            .copied()
            .unwrap_or_default(),
        directory_bytes,
        directory_allocated_bytes,
        recommendations: build_review_categories(large_old_files, old_downloads),
    })
}

fn normalized_windows_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    value.trim_end_matches('\\').to_ascii_lowercase()
}

fn scan_drive(app: &AppHandle, root: &Path) -> Result<DriveScan, String> {
    scan_tree(root, |progress| {
        let _ = app.emit("system-cleaner://scan-progress", progress);
    })
}

#[cfg(target_os = "windows")]
fn disk_space(root: &Path) -> (u64, u64) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide = root
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let (mut free, mut total) = (0_u64, 0_u64);
    let ok =
        unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, std::ptr::null_mut()) };
    if ok == 0 { (0, 0) } else { (total, free) }
}

#[cfg(target_os = "windows")]
fn available_drives() -> Vec<DriveEntry> {
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;

    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;

    let mut drives = Vec::new();
    for letter in b'A'..=b'Z' {
        let path = format!("{}:\\", letter as char);
        let wide = path.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let drive_type = unsafe { GetDriveTypeW(wide.as_ptr()) };
        if drive_type != DRIVE_FIXED && drive_type != DRIVE_REMOVABLE {
            continue;
        }
        let root = PathBuf::from(&path);
        let (capacity_bytes, free_bytes) = disk_space(&root);
        if capacity_bytes == 0 {
            continue;
        }
        drives.push(DriveEntry {
            path,
            capacity_bytes,
            free_bytes,
        });
    }
    let system_root = env::var("SystemDrive")
        .ok()
        .map(|drive| format!("{drive}\\"));
    drives.sort_by(|left, right| {
        let left_is_system = system_root
            .as_deref()
            .is_some_and(|root| left.path.eq_ignore_ascii_case(root));
        let right_is_system = system_root
            .as_deref()
            .is_some_and(|root| right.path.eq_ignore_ascii_case(root));
        right_is_system
            .cmp(&left_is_system)
            .then_with(|| left.path.cmp(&right.path))
    });
    drives
}

#[cfg(target_os = "windows")]
fn selected_drive_root(requested: Option<&str>) -> Result<PathBuf, String> {
    let requested = requested
        .map(str::to_owned)
        .or_else(|| {
            env::var("SystemDrive")
                .ok()
                .map(|drive| format!("{drive}\\"))
        })
        .ok_or_else(|| "Windows system drive is unavailable.".to_string())?;
    available_drives()
        .into_iter()
        .find(|drive| drive.path.eq_ignore_ascii_case(&requested))
        .map(|drive| PathBuf::from(drive.path))
        .ok_or_else(|| "The selected drive is unavailable.".to_string())
}

fn audit(event: &str, details: serde_json::Value) {
    let Ok(directory) = crate::logging::log_dir() else {
        return;
    };
    let path = directory.join("system-cleaner.operations.log");
    let record = json!({
        "timestampUnixMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or_default(),
        "event": event,
        "details": details,
    });
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{record}");
    }
}

fn installed_apps() -> Vec<InstalledApp> {
    let mut command = Command::new("winget");
    command.args([
        "list",
        "--accept-source-agreements",
        "--disable-interactivity",
    ]);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let Ok(output) = command.output() else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .skip_while(|line| !line.starts_with("---"))
        .skip(1)
        .filter_map(|line| {
            let columns: Vec<_> = line.split_whitespace().collect();
            if columns.len() < 3 {
                return None;
            }
            Some(InstalledApp {
                name: columns[..columns.len() - 2].join(" "),
                id: columns[columns.len() - 2].into(),
                version: columns[columns.len() - 1].into(),
            })
        })
        .take(250)
        .collect()
}

#[cfg(target_os = "windows")]
fn appx_packages() -> Result<Vec<AppxPackage>, String> {
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-AppxPackage | Select-Object Name,PackageFullName,Version,Publisher,IsFramework,NonRemovable | ConvertTo-Json -Compress",
    ]);
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Could not read Windows app packages: {error}"))?;
    let values = match value {
        serde_json::Value::Array(values) => values,
        serde_json::Value::Null => Vec::new(),
        value => vec![value],
    };
    let mut packages = values
        .into_iter()
        .filter_map(|value| serde_json::from_value::<AppxPackage>(value).ok())
        .filter(|package| {
            !package.is_framework
                && !package.non_removable
                && !matches!(
                    package.name.as_str(),
                    "Microsoft.AAD.BrokerPlugin"
                        | "Microsoft.AccountsControl"
                        | "Microsoft.LockApp"
                        | "Microsoft.Windows.SecHealthUI"
                        | "Microsoft.Windows.ShellExperienceHost"
                        | "Microsoft.Windows.StartMenuExperienceHost"
                )
                && !package.name.starts_with("MicrosoftWindows.Client.")
        })
        .collect::<Vec<_>>();
    packages.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
    });
    Ok(packages)
}

#[tauri::command]
pub async fn system_cleaner_list_appx_packages() -> Result<Vec<AppxPackage>, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("Windows app packages are available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(appx_packages)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn system_cleaner_remove_appx_package(package_full_name: String) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    return Err("Windows app packages are available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        if package_full_name.is_empty()
            || package_full_name.len() > 512
            || !package_full_name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-~=".contains(&byte))
        {
            return Err("Windows returned an invalid package identity.".into());
        }
        if !appx_packages()?.iter().any(|package| {
            package
                .package_full_name
                .eq_ignore_ascii_case(&package_full_name)
        }) {
            return Err("The package is no longer in the current removable-app inventory.".into());
        }
        audit(
            "appx-remove.approved",
            json!({ "packageFullName": &package_full_name }),
        );
        let escaped = package_full_name.replace('\'', "''");
        let script =
            format!("Remove-AppxPackage -Package '{escaped}' -Confirm:$false -ErrorAction Stop");
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        command.creation_flags(CREATE_NO_WINDOW);
        let output = command.output().map_err(|error| error.to_string())?;
        if output.status.success() {
            audit(
                "appx-remove.completed",
                json!({ "packageFullName": package_full_name }),
            );
            Ok(())
        } else {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            audit(
                "appx-remove.failed",
                json!({ "packageFullName": package_full_name, "error": &error }),
            );
            Err(if error.is_empty() {
                "Windows could not remove the app package.".into()
            } else {
                error
            })
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(target_os = "windows")]
fn recycle_bin_status() -> Result<(u64, u64), String> {
    use windows_sys::Win32::UI::Shell::{SHQUERYRBINFO, SHQueryRecycleBinW};
    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        i64Size: 0,
        i64NumItems: 0,
    };
    let result = unsafe { SHQueryRecycleBinW(std::ptr::null(), &mut info) };
    if result < 0 {
        Err(format!(
            "Windows could not query the Recycle Bin (HRESULT {result:#x})."
        ))
    } else {
        Ok((info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64))
    }
}

#[tauri::command]
pub async fn system_cleaner_windows_maintenance_status() -> Result<WindowsMaintenanceStatus, String>
{
    #[cfg(not(target_os = "windows"))]
    return Err("Windows maintenance is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    {
        let (recycle_bin_bytes, recycle_bin_items) = recycle_bin_status().unwrap_or_default();
        Ok(WindowsMaintenanceStatus {
            recycle_bin_bytes,
            recycle_bin_items,
            delivery_optimization_available: true,
            component_cleanup_available: dism_path().is_file(),
        })
    }
}

#[cfg(target_os = "windows")]
fn dism_path() -> PathBuf {
    env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("Dism.exe")
}

#[tauri::command]
pub async fn system_cleaner_empty_recycle_bin() -> Result<u64, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("Recycle Bin cleanup is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        use windows_sys::Win32::UI::Shell::{
            SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND, SHEmptyRecycleBinW,
        };
        let (before, items) = recycle_bin_status()?;
        audit(
            "recycle-bin.approved",
            json!({ "items": items, "bytes": before }),
        );
        let result = unsafe {
            SHEmptyRecycleBinW(
                std::ptr::null_mut(),
                std::ptr::null(),
                SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND,
            )
        };
        if result < 0 {
            audit("recycle-bin.failed", json!({ "hresult": result }));
            Err(format!(
                "Windows could not empty the Recycle Bin (HRESULT {result:#x})."
            ))
        } else {
            audit(
                "recycle-bin.completed",
                json!({ "items": items, "freedBytes": before }),
            );
            Ok(before)
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(target_os = "windows")]
fn run_elevated_maintenance(file: &str, arguments: &[&str]) -> Result<(), String> {
    let quoted = arguments
        .iter()
        .map(|value| format!("'{}'", value.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",");
    let file = file.replace('\'', "''");
    let script = format!(
        "$p=Start-Process -FilePath '{file}' -ArgumentList @({quoted}) -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
    );
    let mut command = Command::new("powershell.exe");
    command.creation_flags(CREATE_NO_WINDOW).args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        &script,
    ]);
    let status = command.status().map_err(|error| error.to_string())?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| format!("Windows maintenance exited with status {status}."))
}

#[tauri::command]
pub async fn system_cleaner_clear_delivery_optimization() -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    return Err("Delivery Optimization cleanup is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        audit("delivery-optimization.approved", json!({}));
        let result = run_elevated_maintenance(
            "powershell.exe",
            &[
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Delete-DeliveryOptimizationCache -Force -ErrorAction Stop",
            ],
        );
        audit(
            if result.is_ok() {
                "delivery-optimization.completed"
            } else {
                "delivery-optimization.failed"
            },
            json!({ "error": result.as_ref().err() }),
        );
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn system_cleaner_start_component_cleanup() -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    return Err("Windows component cleanup is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        audit("component-cleanup.approved", json!({}));
        let dism = dism_path();
        let dism = dism
            .to_str()
            .ok_or_else(|| "The Windows DISM path is not valid Unicode.".to_string())?;
        let result = run_elevated_maintenance(
            dism,
            &["/Online", "/Cleanup-Image", "/StartComponentCleanup"],
        );
        audit(
            if result.is_ok() {
                "component-cleanup.completed"
            } else {
                "component-cleanup.failed"
            },
            json!({ "error": result.as_ref().err() }),
        );
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn system_cleaner_list_drives() -> Result<Vec<DriveEntry>, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(available_drives)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn system_cleaner_catalog(app: AppHandle) -> Result<Vec<RecipeCatalogEntry>, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        crate::system_cleaner_recipes::catalog(&app.state::<Storage>())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn system_cleaner_scan(
    app: AppHandle,
    root: Option<String>,
) -> Result<CleanerOverview, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let root = selected_drive_root(root.as_deref())?;
            let (drive_scan, (cleanup, apps)) = rayon::join(
                || scan_drive(&app, &root),
                || {
                    rayon::join(
                        || crate::system_cleaner_recipes::catalog(&app.state::<Storage>()),
                        installed_apps,
                    )
                },
            );
            let drive_scan = drive_scan?;
            let cleanup = cleanup?;
            let (disk_capacity_bytes, disk_free_bytes) = disk_space(&root);
            let review_files = drive_scan
                .recommendations
                .iter()
                .flat_map(|category| category.files.iter().cloned())
                .map(|file| (normalized_windows_path(Path::new(&file.path)), file))
                .collect();
            let overview = CleanerOverview {
                scan_root: root.to_string_lossy().into_owned(),
                total_bytes: drive_scan.total_bytes,
                total_allocated_bytes: drive_scan.total_allocated_bytes,
                largest: drive_scan.root_entries,
                cleanup,
                recommendations: drive_scan.recommendations,
                apps,
                extensions: drive_scan.extensions,
                file_count: drive_scan.files,
                folder_count: drive_scan.folders,
                elapsed_ms: drive_scan.elapsed_ms,
                disk_capacity_bytes,
                disk_free_bytes,
            };
            *SCAN_CACHE
                .get_or_init(|| RwLock::new(None))
                .write()
                .map_err(|_| "System Cleaner scan cache is unavailable.")? = Some(ScanCache {
                root,
                directory_bytes: drive_scan.directory_bytes,
                directory_allocated_bytes: drive_scan.directory_allocated_bytes,
                review_files,
            });
            Ok(overview)
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

#[tauri::command]
pub async fn system_cleaner_list_directory(path: String) -> Result<DirectoryListing, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        let requested = PathBuf::from(path);
        let cache_guard = SCAN_CACHE
            .get_or_init(|| RwLock::new(None))
            .read()
            .map_err(|_| "System Cleaner scan cache is unavailable.")?;
        let cache = cache_guard
            .as_ref()
            .ok_or_else(|| "Scan the system drive before opening folders.".to_string())?;
        let canonical_root = fs::canonicalize(&cache.root).map_err(|error| error.to_string())?;
        let canonical_requested =
            fs::canonicalize(&requested).map_err(|error| error.to_string())?;
        if !canonical_requested.starts_with(&canonical_root)
            || !cache.directory_bytes.contains_key(&requested)
        {
            return Err("The requested folder is outside the completed scan.".into());
        }
        let metadata = fs::symlink_metadata(&requested).map_err(|error| error.to_string())?;
        if !metadata.is_dir() || is_reparse_point(&metadata) {
            return Err("The requested path is not a scanned folder.".into());
        }
        directory_entries(
            &cache.root,
            &requested,
            &cache.directory_bytes,
            &cache.directory_allocated_bytes,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn system_cleaner_clean(app: AppHandle, ids: Vec<String>) -> Result<u64, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        let storage = app.state::<Storage>();
        let plan = crate::system_cleaner_recipes::build_plan(&storage, ids)?;
        let result = crate::system_cleaner_recipes::execute_plan(&storage, &plan.token, None)?;
        Ok(result.freed_bytes)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn system_cleaner_build_cleanup_plan(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<CleanupPlan, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        crate::system_cleaner_recipes::build_plan(&app.state::<Storage>(), ids)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn system_cleaner_execute_cleanup_plan(
    app: AppHandle,
    token: String,
    retry_paths: Option<Vec<String>>,
) -> Result<CleanupResult, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        audit(
            "cleanup-plan.approved",
            json!({ "token": &token, "retryPaths": &retry_paths }),
        );
        let result = crate::system_cleaner_recipes::execute_plan(
            &app.state::<Storage>(),
            &token,
            retry_paths,
        )?;
        audit(
            "cleanup-plan.completed",
            json!({
                "token": token,
                "runId": result.run_id,
                "freedBytes": result.freed_bytes,
                "deletedItems": result.deleted_items,
                "skippedItems": result.skipped.len(),
                "cancelled": result.cancelled,
            }),
        );
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn system_cleaner_cancel_cleanup() {
    crate::system_cleaner_recipes::cancel_cleanup();
}

#[tauri::command]
pub fn system_cleaner_history(
    storage: tauri::State<'_, Storage>,
    limit: Option<usize>,
) -> Result<Vec<SystemCleanerHistoryRecord>, String> {
    storage.system_cleaner_history(limit.unwrap_or(50))
}

#[tauri::command]
pub async fn system_cleaner_delete_review_files(paths: Vec<String>) -> Result<u64, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        let requested = paths
            .into_iter()
            .map(PathBuf::from)
            .collect::<Vec<_>>();
        if requested.is_empty() {
            return Ok(0);
        }
        let cache_guard = SCAN_CACHE
            .get_or_init(|| RwLock::new(None))
            .read()
            .map_err(|_| "System Cleaner scan cache is unavailable.")?;
        let cache = cache_guard
            .as_ref()
            .ok_or_else(|| "Scan the drive before deleting review files.".to_string())?;
        let canonical_root = fs::canonicalize(&cache.root).map_err(|error| error.to_string())?;
        let mut seen = HashSet::new();
        let mut validated = Vec::new();
        for path in requested {
            let key = normalized_windows_path(&path);
            if !seen.insert(key.clone()) {
                continue;
            }
            let candidate = cache
                .review_files
                .get(&key)
                .ok_or_else(|| format!("{} is not in the completed review scan.", path.display()))?;
            let canonical_path = fs::canonicalize(&path).map_err(|error| error.to_string())?;
            let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if !canonical_path.starts_with(&canonical_root)
                || !metadata.is_file()
                || is_reparse_point(&metadata)
                || metadata.len() != candidate.bytes
                || filetime_ticks_unix_ms(metadata.last_write_time()) / 1_000
                    != candidate.modified_unix_ms / 1_000
            {
                return Err(format!(
                    "{} changed after the scan. Scan again before deleting it.",
                    path.display()
                ));
            }
            validated.push((path, candidate.allocated_bytes));
        }
        drop(cache_guard);

        audit(
            "review-files.approved",
            json!({ "paths": validated.iter().map(|(path, _)| path).collect::<Vec<_>>() }),
        );
        let mut freed = 0_u64;
        for (path, bytes) in &validated {
            if let Err(error) = fs::remove_file(path) {
                audit(
                    "review-files.failed",
                    json!({ "path": path, "freedBytes": freed, "error": error.to_string() }),
                );
                return Err(format!("Could not delete {}: {error}", path.display()));
            }
            freed = freed.saturating_add(*bytes);
        }
        audit(
            "review-files.completed",
            json!({ "paths": validated.iter().map(|(path, _)| path).collect::<Vec<_>>(), "freedBytes": freed }),
        );
        Ok(freed)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn system_cleaner_uninstall(app_id: String) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        if !app_id.chars().all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character)) {
            return Err("Windows Package Manager returned an invalid package identifier.".into());
        }
        audit("uninstall.approved", json!({ "packageId": &app_id }));
        // Keep elevated work outside KKTerm. PowerShell is only the broker: its
        // RunAs child displays the standard UAC consent UI and performs the
        // package-owned uninstall in a separate elevated process.
        let script = format!(
            "$p=Start-Process -FilePath 'winget.exe' -ArgumentList @('uninstall','--id','{app_id}','--exact','--interactive') -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
        );
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            audit("uninstall.completed", json!({ "packageId": app_id }));
            Ok(())
        } else {
            audit("uninstall.failed", json!({ "packageId": app_id, "status": status.to_string() }));
            Err(format!("winget exited with status {status}"))
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_categories_keep_personal_files_opt_in_and_bounded() {
        let now = 2_000_u64 * 24 * 60 * 60 * 1_000;
        let old = now - 200 * 24 * 60 * 60 * 1_000;
        let recent = now - 20 * 24 * 60 * 60 * 1_000;
        let downloads = Path::new(r"C:\Users\tester\Downloads");
        let mut large_old = Vec::new();
        let mut old_downloads = Vec::new();

        collect_review_file(
            &mut large_old,
            &mut old_downloads,
            Some(downloads),
            Path::new(r"C:\Users\tester\Downloads\archive.iso"),
            LARGE_OLD_FILE_MIN_BYTES,
            LARGE_OLD_FILE_MIN_BYTES,
            old,
            now,
        );
        collect_review_file(
            &mut large_old,
            &mut old_downloads,
            Some(downloads),
            Path::new(r"C:\Users\tester\Downloads\recent.iso"),
            LARGE_OLD_FILE_MIN_BYTES,
            LARGE_OLD_FILE_MIN_BYTES,
            recent,
            now,
        );

        let categories = build_review_categories(large_old, old_downloads);
        assert_eq!(categories[0].id, "large-old-files");
        assert_eq!(categories[0].files.len(), 1);
        assert_eq!(categories[1].id, "old-downloads");
        assert_eq!(categories[1].files.len(), 1);
        assert_eq!(categories[0].files[0].path, categories[1].files[0].path);
    }

    #[test]
    fn scan_tree_retains_nested_directory_totals_for_browsing() {
        let root = tempfile::tempdir().expect("temporary scan root");
        let first = root.path().join("first");
        let nested = first.join("nested");
        fs::create_dir_all(&nested).expect("nested scan fixture");
        fs::write(first.join("first.bin"), [0_u8; 3]).expect("first fixture file");
        fs::write(nested.join("nested.bin"), [0_u8; 5]).expect("nested fixture file");

        let scan = scan_tree(root.path(), |_| {}).expect("tree scan");
        assert_eq!(scan.total_bytes, 8);
        assert_eq!(scan.directory_bytes.get(&first), Some(&8));
        assert_eq!(scan.directory_bytes.get(&nested), Some(&5));

        let listing = directory_entries(
            root.path(),
            &first,
            &scan.directory_bytes,
            &scan.directory_allocated_bytes,
        )
        .expect("cached directory listing");
        let nested_entry = listing
            .entries
            .iter()
            .find(|entry| entry.name == "nested")
            .expect("nested directory entry");
        assert!(nested_entry.is_directory);
        assert_eq!(nested_entry.bytes, 5);
    }

    #[test]
    fn scan_tree_emits_file_progress_with_a_current_path() {
        let root = tempfile::tempdir().expect("temporary scan root");
        let file = root.path().join("visible-progress.bin");
        fs::write(&file, [0_u8; 7]).expect("progress fixture file");
        let mut progress = Vec::new();

        scan_tree(root.path(), |event| progress.push(event)).expect("tree scan");

        let final_event = progress.last().expect("final scan progress");
        assert!(matches!(final_event.phase, ScanProgressPhase::Files));
        assert_eq!(final_event.files, 1);
        assert_eq!(final_event.bytes, 7);
        assert!(!final_event.current_path.is_empty());
    }

    #[test]
    fn allocation_unit_rounding_matches_large_cluster_volumes() {
        assert_eq!(round_to_allocation_unit(0, 262_144), 0);
        assert_eq!(round_to_allocation_unit(1, 262_144), 262_144);
        assert_eq!(round_to_allocation_unit(262_144, 262_144), 262_144);
        assert_eq!(round_to_allocation_unit(262_145, 262_144), 524_288);
    }
}

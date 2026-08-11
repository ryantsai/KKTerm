use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
#[cfg(target_os = "windows")]
use std::os::windows::{ffi::OsStrExt, fs::MetadataExt, process::CommandExt};
use std::{
    env, fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{OnceLock, RwLock},
};
use tauri::{AppHandle, Emitter};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::installer::detect::github_release_install_dir;

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
    cleanup: Vec<CleanupEntry>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerStatus {
    available: bool,
    tool_id: &'static str,
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
    Metadata,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupEntry {
    id: String,
    path: String,
    bytes: u64,
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

enum CleanupTarget {
    DirectoryContents(PathBuf),
    FilesWithPrefix { directory: PathBuf, prefix: String },
}

struct CleanupLocation {
    id: String,
    display_path: String,
    targets: Vec<CleanupTarget>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledApp {
    name: String,
    id: String,
    version: String,
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

fn parse_modified_unix_ms(value: &str) -> u64 {
    OffsetDateTime::parse(value, &Rfc3339)
        .ok()
        .and_then(|value| u64::try_from(value.unix_timestamp_nanos() / 1_000_000).ok())
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

fn directory_size(path: &Path) -> u64 {
    let mut bytes = 0_u64;
    let mut pending = vec![path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = scan_directory_entries(&directory, 1) else {
            continue;
        };
        for entry in entries {
            if entry.is_directory {
                pending.push(entry.path);
            } else {
                bytes = bytes.saturating_add(entry.bytes);
            }
        }
    }
    bytes
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

#[cfg(target_os = "windows")]
const RAW_VOLUME_ALIGNMENT: usize = 4096;
#[cfg(target_os = "windows")]
const RAW_VOLUME_BUFFER_SIZE: usize = 64 * 1024;

#[cfg(target_os = "windows")]
#[repr(align(4096))]
struct AlignedVolumeBuffer([u8; RAW_VOLUME_BUFFER_SIZE]);

#[cfg(target_os = "windows")]
struct RawVolumeReader {
    file: fs::File,
    position: u64,
    length: u64,
    buffer: Box<AlignedVolumeBuffer>,
}

#[cfg(target_os = "windows")]
impl RawVolumeReader {
    fn new(file: fs::File, length: u64) -> Self {
        Self {
            file,
            position: 0,
            length,
            buffer: Box::new(AlignedVolumeBuffer([0; RAW_VOLUME_BUFFER_SIZE])),
        }
    }
}

#[cfg(target_os = "windows")]
impl std::io::Read for RawVolumeReader {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        use std::os::windows::fs::FileExt;

        if output.is_empty() || self.position >= self.length {
            return Ok(0);
        }
        let aligned_position =
            self.position / RAW_VOLUME_ALIGNMENT as u64 * RAW_VOLUME_ALIGNMENT as u64;
        let offset = (self.position - aligned_position) as usize;
        let wanted = output.len().min(RAW_VOLUME_BUFFER_SIZE - offset);
        let aligned_length =
            (offset + wanted).div_ceil(RAW_VOLUME_ALIGNMENT) * RAW_VOLUME_ALIGNMENT;
        let bytes_read = self
            .file
            .seek_read(&mut self.buffer.0[..aligned_length], aligned_position)?;
        if bytes_read <= offset {
            return Ok(0);
        }
        let available = (bytes_read - offset).min(wanted);
        output[..available].copy_from_slice(&self.buffer.0[offset..offset + available]);
        self.position = self.position.saturating_add(available as u64);
        Ok(available)
    }
}

#[cfg(target_os = "windows")]
impl std::io::Seek for RawVolumeReader {
    fn seek(&mut self, position: std::io::SeekFrom) -> std::io::Result<u64> {
        let next = match position {
            std::io::SeekFrom::Start(value) => Some(value),
            std::io::SeekFrom::End(offset) => self.length.checked_add_signed(offset),
            std::io::SeekFrom::Current(offset) => self.position.checked_add_signed(offset),
        }
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid seek"))?;
        self.position = next;
        Ok(next)
    }
}

#[cfg(target_os = "windows")]
fn fixup_mft_record(data: &mut [u8]) -> bool {
    use ntfs_reader::api::{FILE_RECORD_SIGNATURE, NtfsFileRecordHeader, SECTOR_SIZE};

    if data.len() < std::mem::size_of::<NtfsFileRecordHeader>() {
        return false;
    }
    let header = unsafe { std::ptr::read_unaligned(data.as_ptr().cast::<NtfsFileRecordHeader>()) };
    if &header.signature != FILE_RECORD_SIGNATURE {
        return false;
    }
    let usn_start = header.update_sequence_offset as usize;
    let usa_end = usn_start.saturating_add(header.update_sequence_length as usize * 2);
    if usn_start + 2 > data.len() || usa_end > data.len() {
        return false;
    }

    let usn = [data[usn_start], data[usn_start + 1]];
    let mut sector_offset = SECTOR_SIZE - 2;
    for usa_offset in (usn_start + 2..usa_end).step_by(2) {
        if sector_offset + 2 > data.len() || data[sector_offset..sector_offset + 2] != usn {
            return false;
        }
        let replacement = [data[usa_offset], data[usa_offset + 1]];
        data[sector_offset..sector_offset + 2].copy_from_slice(&replacement);
        sector_offset += SECTOR_SIZE;
    }
    true
}

#[cfg(target_os = "windows")]
fn load_mft_tolerating_bad_records<F>(
    volume: ntfs_reader::volume::Volume,
    mut emit_progress: F,
) -> Result<ntfs_reader::mft::Mft, String>
where
    F: FnMut(u64, u64),
{
    use ntfs::Ntfs;
    use ntfs_reader::mft::Mft;
    use std::io::Read;

    let raw_volume = fs::OpenOptions::new()
        .read(true)
        .open(&volume.path)
        .map_err(|error| error.to_string())?;
    let mut reader = RawVolumeReader::new(raw_volume, volume.volume_size);
    let ntfs = Ntfs::new(&mut reader).map_err(|error| error.to_string())?;
    let mft_file = ntfs
        .file(&mut reader, 0)
        .map_err(|error| error.to_string())?;
    let mft_attribute_item = mft_file
        .data(&mut reader, "")
        .ok_or_else(|| "$MFT has no data attribute.".to_string())?
        .map_err(|error| error.to_string())?;
    let mft_attribute = mft_attribute_item
        .to_attribute()
        .map_err(|error| error.to_string())?;
    let mut mft_stream = mft_attribute
        .value(&mut reader)
        .map_err(|error| error.to_string())?
        .attach(&mut reader);
    let value_length = mft_attribute.value_length();
    let progress_total = value_length.saturating_mul(2);
    let mut data = Vec::with_capacity(value_length as usize);
    let mut chunk = vec![0_u8; 1024 * 1024];
    let mut last_reported = 0_u64;
    loop {
        let count = mft_stream
            .read(&mut chunk)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..count]);
        let completed = data.len() as u64;
        if completed.saturating_sub(last_reported) >= 2 * 1024 * 1024 {
            last_reported = completed;
            emit_progress(completed, progress_total);
        }
    }
    emit_progress(value_length, progress_total);
    let max_record = data.len() as u64 / volume.file_record_size;
    let bitmap = vec![u8::MAX; max_record.div_ceil(8) as usize];

    for number in 0..max_record {
        let start = (number * volume.file_record_size) as usize;
        let end = start + volume.file_record_size as usize;
        if !fixup_mft_record(&mut data[start..end]) {
            data[start..start + 4].fill(0);
        }
        if number % 4_096 == 0 {
            emit_progress(
                value_length.saturating_add(number.saturating_mul(volume.file_record_size)),
                progress_total,
            );
        }
    }
    emit_progress(progress_total, progress_total);

    Ok(Mft {
        volume,
        data,
        bitmap,
        max_record,
    })
}

#[cfg(target_os = "windows")]
fn resolve_mft_directory_path(
    record: u64,
    directories: &HashMap<u64, (u64, String)>,
    resolved: &mut HashMap<u64, PathBuf>,
) -> Option<PathBuf> {
    if let Some(path) = resolved.get(&record) {
        return Some(path.clone());
    }

    let mut chain = Vec::new();
    let mut current = record;
    for _ in 0..1024 {
        if let Some(mut path) = resolved.get(&current).cloned() {
            for child in chain.into_iter().rev() {
                let (_, name) = directories.get(&child)?;
                path.push(name);
                resolved.insert(child, path.clone());
            }
            return resolved.get(&record).cloned();
        }
        if chain.contains(&current) {
            return None;
        }
        chain.push(current);
        current = directories.get(&current)?.0;
    }
    None
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Default)]
struct MftSizeTotals {
    logical: u64,
    allocated: u64,
}

#[cfg(target_os = "windows")]
#[derive(Default)]
struct MftSizeAccumulator {
    sizes: MftSizeTotals,
    has_unnamed_data: bool,
    has_any_data: bool,
}

#[cfg(target_os = "windows")]
fn resolve_mft_sizes(
    stream: MftSizeTotals,
    filename: MftSizeTotals,
    has_unnamed_data: bool,
    has_any_data: bool,
) -> MftSizeTotals {
    MftSizeTotals {
        logical: if has_unnamed_data {
            stream.logical
        } else {
            filename.logical
        },
        allocated: if has_any_data {
            stream.allocated
        } else {
            filename.allocated
        },
    }
}

#[cfg(target_os = "windows")]
fn direct_mft_file_names(
    file: &ntfs_reader::file::NtfsFile<'_>,
) -> Vec<ntfs_reader::api::NtfsFileName> {
    use ntfs_reader::api::NtfsAttributeType;

    let mut names = Vec::new();
    file.attributes(|attribute| {
        if attribute.header.type_id != NtfsAttributeType::FileName as u32 {
            return;
        }
        let Some(name) = attribute.as_name() else {
            return;
        };
        names.push(name);
    });
    names
}

#[cfg(target_os = "windows")]
fn best_mft_file_names(
    base: &ntfs_reader::file::NtfsFile<'_>,
    extensions: &[ntfs_reader::file::NtfsFile<'_>],
    mft: &ntfs_reader::mft::Mft,
) -> Vec<ntfs_reader::api::NtfsFileName> {
    use ntfs_reader::api::NtfsFileNamespace;

    let mut names = direct_mft_file_names(base);
    for extension in extensions {
        names.extend(direct_mft_file_names(extension));
    }
    if names
        .iter()
        .any(|name| name.header.namespace != NtfsFileNamespace::Dos as u8)
    {
        names.retain(|name| name.header.namespace != NtfsFileNamespace::Dos as u8);
    }
    if names.is_empty()
        && let Some(name) = base.get_best_file_name(mft)
    {
        names.push(name);
    }
    let mut unique = Vec::with_capacity(names.len());
    for name in names {
        if !unique
            .iter()
            .any(|existing: &ntfs_reader::api::NtfsFileName| {
                existing.parent() == name.parent() && existing.to_string() == name.to_string()
            })
        {
            unique.push(name);
        }
    }
    unique
}

#[cfg(target_os = "windows")]
fn physical_data_run_bytes(
    attribute: &ntfs_reader::attribute::NtfsAttribute<'_>,
    cluster_size: u64,
) -> Option<u64> {
    let header = attribute.nonresident_header()?;
    let mut cursor = header.data_runs_offset as usize;
    let data = attribute.data();
    if cursor >= data.len() || cluster_size == 0 {
        return None;
    }

    let mut allocated = 0_u64;
    loop {
        let descriptor = *data.get(cursor)?;
        cursor = cursor.checked_add(1)?;
        if descriptor == 0 {
            return Some(allocated);
        }
        let length_bytes = usize::from(descriptor & 0x0f);
        let offset_bytes = usize::from(descriptor >> 4);
        if length_bytes == 0 || length_bytes > 8 || offset_bytes > 8 {
            return None;
        }
        let length_end = cursor.checked_add(length_bytes)?;
        let length_slice = data.get(cursor..length_end)?;
        let mut length_buffer = [0_u8; 8];
        length_buffer[..length_bytes].copy_from_slice(length_slice);
        let clusters = u64::from_le_bytes(length_buffer);
        if clusters == 0 {
            return None;
        }
        cursor = length_end.checked_add(offset_bytes)?;
        if cursor > data.len() {
            return None;
        }
        if offset_bytes > 0 {
            allocated = allocated.checked_add(clusters.checked_mul(cluster_size)?)?;
        }
    }
}

#[cfg(target_os = "windows")]
fn accumulate_mft_record_sizes(
    file: &ntfs_reader::file::NtfsFile<'_>,
    cluster_size: u64,
    accumulator: &mut MftSizeAccumulator,
) {
    use ntfs_reader::api::NtfsAttributeType;

    file.attributes(|attribute| {
        if attribute.header.type_id != NtfsAttributeType::Data as u32 {
            return;
        }
        accumulator.has_any_data = true;
        let unnamed = attribute.header.name_length == 0;
        if attribute.header.is_non_resident == 0 {
            if unnamed {
                let logical = attribute
                    .resident_header()
                    .map(|header| u64::from(header.value_length))
                    .unwrap_or_default();
                accumulator.has_unnamed_data = true;
                accumulator.sizes.logical = accumulator.sizes.logical.max(logical);
            }
            return;
        }

        let Some(header) = attribute.nonresident_header() else {
            return;
        };
        if unnamed && header.lowest_vcn == 0 {
            accumulator.has_unnamed_data = true;
            accumulator.sizes.logical = accumulator.sizes.logical.max(header.data_size);
        }
        if let Some(allocated) = physical_data_run_bytes(attribute, cluster_size) {
            accumulator.sizes.allocated = accumulator.sizes.allocated.saturating_add(allocated);
        }
    });
}

#[cfg(target_os = "windows")]
fn mft_record_sizes(
    base: &ntfs_reader::file::NtfsFile<'_>,
    extensions: &[ntfs_reader::file::NtfsFile<'_>],
    filename: Option<&ntfs_reader::api::NtfsFileName>,
    is_directory: bool,
    cluster_size: u64,
) -> MftSizeTotals {
    let mut accumulator = MftSizeAccumulator::default();
    accumulate_mft_record_sizes(base, cluster_size, &mut accumulator);
    for extension in extensions {
        accumulate_mft_record_sizes(extension, cluster_size, &mut accumulator);
    }

    let filename_sizes = if is_directory {
        MftSizeTotals::default()
    } else {
        filename
            .map(|name| {
                let logical = name.header.real_size;
                let allocated = name.header.allocated_size;
                MftSizeTotals { logical, allocated }
            })
            .unwrap_or_default()
    };
    resolve_mft_sizes(
        accumulator.sizes,
        filename_sizes,
        accumulator.has_unnamed_data,
        accumulator.has_any_data,
    )
}

#[cfg(target_os = "windows")]
fn scan_raw_mft<F>(root: &Path, mut emit_progress: F) -> Result<DriveScan, String>
where
    F: FnMut(ScanProgress),
{
    use ntfs_reader::volume::Volume;

    let started = std::time::Instant::now();
    let drive = root.to_string_lossy().chars().take(2).collect::<String>();
    if drive.len() != 2 || !drive.ends_with(':') {
        return Err("Raw MFT scan requires a drive root.".into());
    }
    let volume_path = format!(r"\\.\{drive}");
    let volume = Volume::new(&volume_path)
        .map_err(|error| format!("Could not open {volume_path}: {error}"))?;
    let metadata_path = root.join("$MFT").to_string_lossy().into_owned();
    let mut mft = load_mft_tolerating_bad_records(volume, |completed, total| {
        emit_progress(ScanProgress {
            phase: ScanProgressPhase::Metadata,
            files: 0,
            folders: 0,
            bytes: 0,
            current_path: metadata_path.clone(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            phase_completed: completed,
            phase_total: total,
        });
    })?;
    mft.volume.path = root.to_path_buf();

    let mut extension_records: HashMap<u64, Vec<u64>> = HashMap::new();
    for record in 0..mft.max_record {
        let Some(file) = mft.get_record(record).filter(|file| file.is_used()) else {
            continue;
        };
        let base_reference = file.header.base_reference;
        let base_record = base_reference & 0x0000_FFFF_FFFF_FFFF;
        if base_record == 0 {
            continue;
        }
        if mft
            .get_record(base_record)
            .is_some_and(|base| base.is_used() && base.reference_number() == base_reference)
        {
            extension_records
                .entry(base_record)
                .or_default()
                .push(record);
        }
    }

    let mut extension_totals: HashMap<String, (u64, u64, u64)> = HashMap::new();
    let mut direct_directory_bytes: HashMap<u64, u64> = HashMap::new();
    let mut direct_directory_allocated_bytes: HashMap<u64, u64> = HashMap::new();
    let mut directories = HashMap::new();
    let mut root_entries = Vec::new();
    let mut files = 0_u64;
    let mut folders = 1_u64;
    let mut bytes = 0_u64;
    let mut allocated_bytes = 0_u64;
    let record_total = mft.max_record;
    let mut processed = 0_u64;
    for record in 0..record_total {
        if !mft.record_exists(record) {
            continue;
        }
        let Some(file) = mft.get_record(record) else {
            continue;
        };
        if !file.is_used() {
            continue;
        }
        let base_reference = file.header.base_reference & 0x0000_FFFF_FFFF_FFFF;
        if base_reference != 0 {
            continue;
        }
        processed = processed.saturating_add(1);
        let is_directory = file.is_directory();
        let extension_files = extension_records
            .get(&record)
            .into_iter()
            .flatten()
            .filter_map(|number| mft.get_record(*number))
            .collect::<Vec<_>>();
        let name_attributes = best_mft_file_names(&file, &extension_files, &mft);
        let sizes = mft_record_sizes(
            &file,
            &extension_files,
            name_attributes.first(),
            is_directory,
            mft.volume.cluster_size,
        );
        allocated_bytes = allocated_bytes.saturating_add(sizes.allocated);

        let Some(name_attribute) = name_attributes.first() else {
            bytes = bytes.saturating_add(sizes.logical);
            let logical_total = direct_directory_bytes.entry(5).or_default();
            *logical_total = logical_total.saturating_add(sizes.logical);
            let allocated_total = direct_directory_allocated_bytes.entry(5).or_default();
            *allocated_total = allocated_total.saturating_add(sizes.allocated);
            continue;
        };
        let name = name_attribute.to_string();
        let parent = name_attribute.parent();
        let current_path = root.join(&name).to_string_lossy().into_owned();

        if is_directory {
            bytes = bytes.saturating_add(sizes.logical);
            let logical_total = direct_directory_bytes.entry(record).or_default();
            *logical_total = logical_total.saturating_add(sizes.logical);
            let allocated_total = direct_directory_allocated_bytes.entry(record).or_default();
            *allocated_total = allocated_total.saturating_add(sizes.allocated);
            if record != 5 {
                directories.insert(record, (parent, name));
                folders += 1;
            }
        } else {
            for (link_index, name_attribute) in name_attributes.iter().enumerate() {
                let name = name_attribute.to_string();
                let parent = name_attribute.parent();
                let link_allocated = if link_index == 0 { sizes.allocated } else { 0 };
                bytes = bytes.saturating_add(sizes.logical);
                files = files.saturating_add(1);
                let extension = Path::new(&name)
                    .extension()
                    .and_then(|value| value.to_str())
                    .filter(|value| !value.is_empty())
                    .map(|value| format!(".{}", value.to_ascii_lowercase()))
                    .unwrap_or_else(|| "(none)".into());
                let extension_total = extension_totals.entry(extension).or_default();
                extension_total.0 = extension_total.0.saturating_add(sizes.logical);
                extension_total.1 = extension_total.1.saturating_add(link_allocated);
                extension_total.2 = extension_total.2.saturating_add(1);
                let logical_total = direct_directory_bytes.entry(parent).or_default();
                *logical_total = logical_total.saturating_add(sizes.logical);
                let allocated_total = direct_directory_allocated_bytes.entry(parent).or_default();
                *allocated_total = allocated_total.saturating_add(link_allocated);

                if parent == 5 {
                    root_entries.push(DiskEntry {
                        name: name.clone(),
                        path: root.join(&name).to_string_lossy().into_owned(),
                        bytes: sizes.logical,
                        allocated_bytes: link_allocated,
                        is_directory: false,
                    });
                }
            }
        }
        if processed % 2_048 == 0 {
            emit_progress(ScanProgress {
                phase: ScanProgressPhase::Files,
                files,
                folders,
                bytes,
                current_path,
                elapsed_ms: started.elapsed().as_millis() as u64,
                phase_completed: processed,
                phase_total: record_total,
            });
        }
    }

    let mut resolved_paths = HashMap::from([(5_u64, root.to_path_buf())]);
    let mut resolved_directories = Vec::with_capacity(directories.len());
    for (&record, (parent, name)) in &directories {
        let Some(path) = resolve_mft_directory_path(record, &directories, &mut resolved_paths)
        else {
            continue;
        };
        resolved_directories.push((record, *parent, name.clone(), path));
    }
    resolved_directories
        .sort_by_key(|(_, _, _, path)| std::cmp::Reverse(path.components().count()));

    for (record, parent, _, _) in &resolved_directories {
        let bytes = direct_directory_bytes
            .get(record)
            .copied()
            .unwrap_or_default();
        let parent_total = direct_directory_bytes.entry(*parent).or_default();
        *parent_total = parent_total.saturating_add(bytes);
        let allocated = direct_directory_allocated_bytes
            .get(record)
            .copied()
            .unwrap_or_default();
        let parent_allocated_total = direct_directory_allocated_bytes.entry(*parent).or_default();
        *parent_allocated_total = parent_allocated_total.saturating_add(allocated);
    }

    let mut directory_bytes = HashMap::with_capacity(resolved_directories.len() + 1);
    let mut directory_allocated_bytes = HashMap::with_capacity(resolved_directories.len() + 1);
    directory_bytes.insert(root.to_path_buf(), bytes);
    directory_allocated_bytes.insert(root.to_path_buf(), allocated_bytes);
    for (record, parent, name, path) in resolved_directories {
        let bytes = direct_directory_bytes
            .get(&record)
            .copied()
            .unwrap_or_default();
        if parent == 5 {
            root_entries.push(DiskEntry {
                name,
                path: path.to_string_lossy().into_owned(),
                bytes,
                allocated_bytes: direct_directory_allocated_bytes
                    .get(&record)
                    .copied()
                    .unwrap_or_default(),
                is_directory: true,
            });
        }
        directory_bytes.insert(path.clone(), bytes);
        directory_allocated_bytes.insert(
            path,
            direct_directory_allocated_bytes
                .get(&record)
                .copied()
                .unwrap_or_default(),
        );
    }

    root_entries.sort_by_key(|entry| std::cmp::Reverse(entry.allocated_bytes));
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
    let total_bytes = bytes;
    let total_allocated_bytes = allocated_bytes;

    Ok(DriveScan {
        root_entries,
        extensions,
        files,
        folders,
        elapsed_ms: started.elapsed().as_millis() as u64,
        total_bytes,
        total_allocated_bytes,
        directory_bytes,
        directory_allocated_bytes,
        recommendations: Vec::new(),
    })
}

#[cfg(target_os = "windows")]
fn powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(target_os = "windows")]
fn valid_mft_helper_file(path: &Path, prefix: &str, suffix: &str) -> bool {
    path.parent()
        .and_then(|parent| fs::canonicalize(parent).ok())
        .zip(fs::canonicalize(env::temp_dir()).ok())
        .is_some_and(|(parent, temp)| parent == temp)
        && path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.starts_with(prefix) && name.ends_with(suffix))
        && path.is_file()
}

#[cfg(target_os = "windows")]
fn write_mft_progress(path: &Path, progress: &ScanProgress) -> Result<(), String> {
    let mut line = serde_json::to_vec(progress).map_err(|error| error.to_string())?;
    line.push(b'\n');
    fs::OpenOptions::new()
        .append(true)
        .open(path)
        .and_then(|mut file| file.write_all(&line))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
const STORAGE_SCANNER_TOOL_ID: &str = "windirstat";

#[cfg(target_os = "windows")]
fn find_windirstat_executable() -> Option<PathBuf> {
    let install_dir = github_release_install_dir(STORAGE_SCANNER_TOOL_ID);
    let architecture = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "x64"
    };
    [
        install_dir.join(architecture).join("WinDirStat.exe"),
        install_dir.join("WinDirStat.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

#[cfg(target_os = "windows")]
fn write_windirstat_settings(executable: &Path) -> Result<(), String> {
    let settings_path = executable
        .parent()
        .ok_or_else(|| "WinDirStat has no installation directory.".to_string())?
        .join("WinDirStat.ini");
    fs::write(
        settings_path,
        concat!(
            "[Options]\r\n",
            "LanguageId=9\r\n",
            "UseFastScanEngine=1\r\n",
            "UseBackupRestore=1\r\n",
            "ShowElevationPrompt=0\r\n",
            "AutoElevate=0\r\n",
            "ShowFreeSpace=0\r\n",
            "ShowUnknown=0\r\n",
            "ProcessHardlinks=1\r\n",
            "ExcludeJunctions=1\r\n",
            "ExcludeSymbolicLinksDirectory=1\r\n",
            "ExcludeSymbolicLinksFile=1\r\n",
            "ExcludeVolumeMountPoints=1\r\n",
            "FollowVolumeMountPoints=0\r\n",
            "\r\n[DupeView]\r\n",
            "ScanForDuplicates=0\r\n",
        ),
    )
    .map_err(|error| format!("Could not configure WinDirStat: {error}"))
}

fn parse_csv_fields(line: &str) -> Result<Vec<String>, String> {
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut chars = line.trim_end_matches(['\r', '\n']).chars().peekable();
    let mut quoted = false;
    while let Some(character) = chars.next() {
        match character {
            '"' if quoted && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => fields.push(std::mem::take(&mut field)),
            _ => field.push(character),
        }
    }
    if quoted {
        return Err("WinDirStat returned an unterminated CSV field.".into());
    }
    fields.push(field);
    Ok(fields)
}

fn normalized_windows_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    value.trim_end_matches('\\').to_ascii_lowercase()
}

fn parse_u64_field(value: &str, field: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|error| format!("WinDirStat returned an invalid {field}: {error}"))
}

fn parse_hex_field(value: &str, field: &str) -> Result<u32, String> {
    u32::from_str_radix(value.trim_start_matches("0x"), 16)
        .map_err(|error| format!("WinDirStat returned an invalid {field}: {error}"))
}

#[cfg(target_os = "windows")]
fn parse_windirstat_report<R, F>(
    mut reader: R,
    root: &Path,
    mut emit_progress: F,
) -> Result<DriveScan, String>
where
    R: BufRead,
    F: FnMut(ScanProgress),
{
    const ITEM_DIRECTORY: u32 = 1 << 2;
    const ITEM_FILE: u32 = 1 << 3;
    const ITEM_DRIVE: u32 = 1 << 1;

    let started = std::time::Instant::now();
    let mut line = String::new();
    if reader
        .read_line(&mut line)
        .map_err(|error| error.to_string())?
        == 0
    {
        return Err("WinDirStat returned an empty report.".into());
    }
    let header = parse_csv_fields(line.trim_start_matches('\u{feff}'))?;
    let column = |name: &str| {
        header
            .iter()
            .position(|value| value == name)
            .ok_or_else(|| format!("WinDirStat report is missing the {name} column."))
    };
    let name_column = column("Name")?;
    let files_column = column("Files")?;
    let folders_column = column("Folders")?;
    let logical_column = column("Logical Size")?;
    let physical_column = column("Physical Size")?;
    let modified_column = column("Last Change")?;
    let type_column = column("WinDirStat Attributes")?;
    let required_column = *[
        name_column,
        files_column,
        folders_column,
        logical_column,
        physical_column,
        modified_column,
        type_column,
    ]
    .iter()
    .max()
    .unwrap_or(&0);

    let root_key = normalized_windows_path(root);
    let mut root_entries = Vec::new();
    let mut extensions: HashMap<String, (u64, u64, u64)> = HashMap::new();
    let mut directory_bytes = HashMap::new();
    let mut directory_allocated_bytes = HashMap::new();
    let mut total_bytes = None;
    let mut total_allocated_bytes = None;
    let mut files = 0_u64;
    let mut folders = 0_u64;
    let mut processed_files = 0_u64;
    let mut processed_folders = 0_u64;
    let mut large_old_files = Vec::new();
    let mut old_downloads = Vec::new();
    let downloads = downloads_root();
    let now_unix_ms = u64::try_from(OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000)
        .unwrap_or_default();

    loop {
        line.clear();
        if reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?
            == 0
        {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        let fields = parse_csv_fields(&line)?;
        if fields.len() <= required_column {
            return Err("WinDirStat returned a truncated report row.".into());
        }
        let path = PathBuf::from(&fields[name_column]);
        let path_key = normalized_windows_path(&path);
        let logical = parse_u64_field(&fields[logical_column], "logical size")?;
        let physical = parse_u64_field(&fields[physical_column], "physical size")?;
        let modified_unix_ms = parse_modified_unix_ms(&fields[modified_column]);
        let item_type = parse_hex_field(&fields[type_column], "item type")?;
        let is_directory = item_type & (ITEM_DIRECTORY | ITEM_DRIVE) != 0;
        let is_file = item_type & ITEM_FILE != 0;

        if path_key == root_key {
            total_bytes = Some(logical);
            total_allocated_bytes = Some(physical);
            files = parse_u64_field(&fields[files_column], "file count")?;
            folders = parse_u64_field(&fields[folders_column], "folder count")?;
        }
        if is_directory {
            directory_bytes.insert(path.clone(), logical);
            directory_allocated_bytes.insert(path.clone(), physical);
            if path_key != root_key {
                processed_folders = processed_folders.saturating_add(1);
            }
        } else if is_file {
            processed_files = processed_files.saturating_add(1);
            collect_review_file(
                &mut large_old_files,
                &mut old_downloads,
                downloads.as_deref(),
                &path,
                logical,
                physical,
                modified_unix_ms,
                now_unix_ms,
            );
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty())
                .map(|value| format!(".{}", value.to_ascii_lowercase()))
                .unwrap_or_else(|| "(none)".into());
            let total = extensions.entry(extension).or_default();
            total.0 = total.0.saturating_add(logical);
            total.1 = total.1.saturating_add(physical);
            total.2 = total.2.saturating_add(1);
        } else {
            continue;
        }

        let is_direct_child = path
            .parent()
            .is_some_and(|parent| normalized_windows_path(parent) == root_key);
        if path_key != root_key && is_direct_child {
            root_entries.push(DiskEntry {
                name: path
                    .file_name()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_else(|| fields[name_column].clone()),
                path: fields[name_column].clone(),
                bytes: logical,
                allocated_bytes: physical,
                is_directory,
            });
        }

        if (processed_files.saturating_add(processed_folders)) % 4_096 == 0 {
            emit_progress(ScanProgress {
                phase: ScanProgressPhase::Files,
                files: processed_files,
                folders: processed_folders,
                bytes: extensions.values().map(|value| value.0).sum(),
                current_path: fields[name_column].clone(),
                elapsed_ms: started.elapsed().as_millis() as u64,
                phase_completed: processed_files.saturating_add(processed_folders),
                phase_total: files.saturating_add(folders),
            });
        }
    }

    let total_bytes = total_bytes.ok_or_else(|| {
        format!(
            "WinDirStat report did not contain the scan root {}.",
            root.display()
        )
    })?;
    let total_allocated_bytes = total_allocated_bytes.unwrap_or_default();
    directory_bytes
        .entry(root.to_path_buf())
        .or_insert(total_bytes);
    directory_allocated_bytes
        .entry(root.to_path_buf())
        .or_insert(total_allocated_bytes);
    root_entries.sort_by_key(|entry| std::cmp::Reverse(entry.allocated_bytes));
    let mut extensions = extensions
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
        root_entries,
        extensions,
        files,
        folders,
        elapsed_ms: started.elapsed().as_millis() as u64,
        total_bytes,
        total_allocated_bytes,
        directory_bytes,
        directory_allocated_bytes,
        recommendations: build_review_categories(large_old_files, old_downloads),
    })
}

#[cfg(target_os = "windows")]
fn scan_with_windirstat<F>(root: &Path, mut emit_progress: F) -> Result<DriveScan, String>
where
    F: FnMut(ScanProgress),
{
    let started = std::time::Instant::now();
    let executable = find_windirstat_executable()
        .ok_or_else(|| "The managed WinDirStat scanner is not installed.".to_string())?;
    write_windirstat_settings(&executable)?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let report_path = env::temp_dir().join(format!(
        "kkterm-system-cleaner-windirstat-{}-{nonce}.csv",
        std::process::id()
    ));
    emit_progress(ScanProgress {
        phase: ScanProgressPhase::Metadata,
        files: 0,
        folders: 0,
        bytes: 0,
        current_path: root.to_string_lossy().into_owned(),
        elapsed_ms: 0,
        phase_completed: 0,
        phase_total: 0,
    });
    let argument_line = format!(
        "/saveto \"{}\" \"{}\"",
        report_path.to_string_lossy(),
        root.to_string_lossy()
    );
    let script = format!(
        "$p=Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode",
        powershell_literal(&executable.to_string_lossy()),
        powershell_literal(&argument_line),
    );
    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW);
    let status = command.status().map_err(|error| error.to_string())?;
    if !status.success() {
        let _ = fs::remove_file(&report_path);
        return Err(format!("WinDirStat exited with {status}."));
    }
    if !valid_mft_helper_file(&report_path, "kkterm-system-cleaner-windirstat-", ".csv") {
        return Err("WinDirStat did not create a valid scan report.".into());
    }
    let result = fs::File::open(&report_path)
        .map(BufReader::new)
        .map_err(|error| error.to_string())
        .and_then(|reader| parse_windirstat_report(reader, root, &mut emit_progress))
        .map(|mut scan| {
            scan.elapsed_ms = started.elapsed().as_millis() as u64;
            scan
        });
    let _ = fs::remove_file(report_path);
    result
}

#[cfg(target_os = "windows")]
pub fn run_mft_helper_from_args() -> Option<i32> {
    let args = env::args_os().collect::<Vec<_>>();
    if args.get(1).and_then(|value| value.to_str()) != Some("--system-cleaner-mft-scan") {
        return None;
    }
    let Some(root) = args.get(2).map(PathBuf::from) else {
        return Some(2);
    };
    let Some(output_path) = args.get(3).map(PathBuf::from) else {
        return Some(2);
    };
    let Some(progress_path) = args.get(4).map(PathBuf::from) else {
        return Some(2);
    };
    if !valid_mft_helper_file(&output_path, "kkterm-system-cleaner-mft-", ".bin")
        || !valid_mft_helper_file(
            &progress_path,
            "kkterm-system-cleaner-mft-progress-",
            ".jsonl",
        )
    {
        return Some(2);
    }
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        scan_raw_mft(&root, |progress| {
            let _ = write_mft_progress(&progress_path, &progress);
        })
    }))
    .map_err(|payload| {
        let detail = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("unknown panic");
        format!("Raw MFT parser panicked: {detail}")
    })
    .and_then(|result| result)
    .and_then(|scan| {
        let file = fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&output_path)
            .map_err(|error| error.to_string())?;
        let mut writer = std::io::BufWriter::new(file);
        bincode::serde::encode_into_std_write(&scan, &mut writer, bincode::config::standard())
            .map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())
    });
    if let Err(error) = &result {
        let _ = fs::write(&output_path, error);
    }
    Some(if result.is_ok() { 0 } else { 1 })
}

#[cfg(not(target_os = "windows"))]
pub fn run_mft_helper_from_args() -> Option<i32> {
    None
}

fn scan_drive(app: &AppHandle, root: &Path) -> Result<DriveScan, String> {
    #[cfg(target_os = "windows")]
    if let Ok(scan) = scan_with_windirstat(root, |progress| {
        let _ = app.emit("system-cleaner://scan-progress", progress);
    }) {
        let _ = app.emit(
            "system-cleaner://scan-progress",
            ScanProgress {
                phase: ScanProgressPhase::Files,
                files: scan.files,
                folders: scan.folders,
                bytes: scan.total_bytes,
                current_path: root.to_string_lossy().into_owned(),
                elapsed_ms: scan.elapsed_ms,
                phase_completed: scan.files.saturating_add(scan.folders),
                phase_total: scan.files.saturating_add(scan.folders),
            },
        );
        return Ok(scan);
    }

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

fn chromium_cache_targets(user_data: &Path) -> Vec<CleanupTarget> {
    let Ok(entries) = fs::read_dir(user_data) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_profile =
                name == "Default" || name == "Guest Profile" || name.starts_with("Profile ");
            let path = entry.path();
            let is_safe_directory = fs::symlink_metadata(&path)
                .is_ok_and(|metadata| metadata.is_dir() && !is_reparse_point(&metadata));
            (is_profile && is_safe_directory).then_some(path)
        })
        .flat_map(|profile| {
            ["Cache", "Code Cache", "GPUCache"]
                .into_iter()
                .map(move |name| CleanupTarget::DirectoryContents(profile.join(name)))
        })
        .collect()
}

fn firefox_cache_targets(profiles: &Path) -> Vec<CleanupTarget> {
    let Ok(entries) = fs::read_dir(profiles) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            fs::symlink_metadata(&path)
                .is_ok_and(|metadata| metadata.is_dir() && !is_reparse_point(&metadata))
                .then_some(CleanupTarget::DirectoryContents(path.join("cache2")))
        })
        .collect()
}

fn is_safe_cleanup_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_dir() && !is_reparse_point(&metadata))
}

fn cleanup_target_size(target: &CleanupTarget) -> u64 {
    match target {
        CleanupTarget::DirectoryContents(path) => is_safe_cleanup_directory(path)
            .then(|| directory_size(path))
            .unwrap_or(0),
        CleanupTarget::FilesWithPrefix { directory, prefix }
            if is_safe_cleanup_directory(directory) =>
        {
            fs::read_dir(directory)
                .into_iter()
                .flatten()
                .flatten()
                .filter(|entry| {
                    fs::symlink_metadata(entry.path())
                        .is_ok_and(|metadata| metadata.is_file() && !is_reparse_point(&metadata))
                        && entry
                            .file_name()
                            .to_string_lossy()
                            .to_ascii_lowercase()
                            .starts_with(prefix)
                })
                .filter_map(|entry| entry.metadata().ok().map(|metadata| metadata.len()))
                .fold(0_u64, u64::saturating_add)
        }
        CleanupTarget::FilesWithPrefix { .. } => 0,
    }
}

fn cleanup_location_size(location: &CleanupLocation) -> u64 {
    location
        .targets
        .iter()
        .map(cleanup_target_size)
        .fold(0_u64, u64::saturating_add)
}

fn remove_cleanup_entry(path: &Path) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.is_dir() && !is_reparse_point(&metadata) {
        let _ = fs::remove_dir_all(path);
    } else if metadata.is_dir() {
        let _ = fs::remove_dir(path);
    } else {
        let _ = fs::remove_file(path);
    }
}

fn clean_target(target: &CleanupTarget) {
    match target {
        CleanupTarget::DirectoryContents(path) => {
            if is_safe_cleanup_directory(path) {
                let Ok(entries) = fs::read_dir(path) else {
                    return;
                };
                for entry in entries.flatten() {
                    remove_cleanup_entry(&entry.path());
                }
            }
        }
        CleanupTarget::FilesWithPrefix { directory, prefix } => {
            if is_safe_cleanup_directory(directory) {
                let Ok(entries) = fs::read_dir(directory) else {
                    return;
                };
                for entry in entries.flatten().filter(|entry| {
                    fs::symlink_metadata(entry.path())
                        .is_ok_and(|metadata| metadata.is_file() && !is_reparse_point(&metadata))
                        && entry
                            .file_name()
                            .to_string_lossy()
                            .to_ascii_lowercase()
                            .starts_with(prefix)
                }) {
                    remove_cleanup_entry(&entry.path());
                }
            }
        }
    }
}

fn cleanup_locations() -> Vec<CleanupLocation> {
    let mut locations = Vec::new();
    if let Ok(path) = env::var("TEMP") {
        locations.push(CleanupLocation {
            id: "temp".into(),
            display_path: path.clone(),
            targets: vec![CleanupTarget::DirectoryContents(path.into())],
        });
    }
    if let Ok(path) = env::var("WINDIR") {
        let path = PathBuf::from(path).join("Temp");
        locations.push(CleanupLocation {
            id: "windows-temp".into(),
            display_path: path.to_string_lossy().into_owned(),
            targets: vec![CleanupTarget::DirectoryContents(path)],
        });
    }
    if let Ok(path) = env::var("LOCALAPPDATA") {
        let base = PathBuf::from(path);
        let edge_root = base.join("Microsoft/Edge/User Data");
        locations.push(CleanupLocation {
            id: "browser-cache".into(),
            display_path: edge_root.join("*/Cache").to_string_lossy().into_owned(),
            targets: chromium_cache_targets(&edge_root),
        });
        let chrome_root = base.join("Google/Chrome/User Data");
        locations.push(CleanupLocation {
            id: "chrome-cache".into(),
            display_path: chrome_root.join("*/Cache").to_string_lossy().into_owned(),
            targets: chromium_cache_targets(&chrome_root),
        });
        let firefox_root = base.join("Mozilla/Firefox/Profiles");
        locations.push(CleanupLocation {
            id: "firefox-cache".into(),
            display_path: firefox_root.join("*/cache2").to_string_lossy().into_owned(),
            targets: firefox_cache_targets(&firefox_root),
        });
        let shader_cache = base.join("D3DSCache");
        locations.push(CleanupLocation {
            id: "shader-cache".into(),
            display_path: shader_cache.to_string_lossy().into_owned(),
            targets: vec![CleanupTarget::DirectoryContents(shader_cache)],
        });
        let explorer_cache = base.join("Microsoft/Windows/Explorer");
        locations.push(CleanupLocation {
            id: "thumbnail-cache".into(),
            display_path: explorer_cache
                .join("thumbcache_*.db")
                .to_string_lossy()
                .into_owned(),
            targets: vec![CleanupTarget::FilesWithPrefix {
                directory: explorer_cache,
                prefix: "thumbcache_".into(),
            }],
        });
        let crash_dumps = base.join("CrashDumps");
        locations.push(CleanupLocation {
            id: "crash-dumps".into(),
            display_path: crash_dumps.to_string_lossy().into_owned(),
            targets: vec![CleanupTarget::DirectoryContents(crash_dumps)],
        });
        let error_reports = base.join("Microsoft/Windows/WER");
        locations.push(CleanupLocation {
            id: "error-reports".into(),
            display_path: error_reports.join("Report*").to_string_lossy().into_owned(),
            targets: vec![
                CleanupTarget::DirectoryContents(error_reports.join("ReportArchive")),
                CleanupTarget::DirectoryContents(error_reports.join("ReportQueue")),
            ],
        });
    }
    locations
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
pub async fn system_cleaner_scanner_status() -> Result<ScannerStatus, String> {
    #[cfg(not(target_os = "windows"))]
    return Ok(ScannerStatus {
        available: false,
        tool_id: "windirstat",
    });
    #[cfg(target_os = "windows")]
    Ok(ScannerStatus {
        available: find_windirstat_executable().is_some(),
        tool_id: STORAGE_SCANNER_TOOL_ID,
    })
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
                        || {
                            cleanup_locations()
                                .into_par_iter()
                                .map(|location| CleanupEntry {
                                    bytes: cleanup_location_size(&location),
                                    id: location.id,
                                    path: location.display_path,
                                })
                                .collect()
                        },
                        installed_apps,
                    )
                },
            );
            let drive_scan = drive_scan?;
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
pub async fn system_cleaner_clean(ids: Vec<String>) -> Result<u64, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        audit("cleanup.approved", json!({ "categories": &ids }));
        let mut freed = 0;
        for location in cleanup_locations()
            .into_iter()
            .filter(|location| ids.contains(&location.id))
        {
            let before = cleanup_location_size(&location);
            for target in &location.targets {
                clean_target(target);
            }
            freed += before.saturating_sub(cleanup_location_size(&location));
        }
        audit(
            "cleanup.completed",
            json!({ "categories": ids, "freedBytes": freed }),
        );
        Ok(freed)
    })
    .await
    .map_err(|error| error.to_string())?
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

    fn synthetic_mft_file(number: u64, attribute: &[u8]) -> (u64, Vec<u8>) {
        let attribute_offset = 48_usize;
        let used_size = attribute_offset + attribute.len();
        let mut record = vec![0_u8; 1024];
        record[..4].copy_from_slice(b"FILE");
        record[20..22].copy_from_slice(&(attribute_offset as u16).to_le_bytes());
        record[22..24].copy_from_slice(&1_u16.to_le_bytes());
        record[24..28].copy_from_slice(&(used_size as u32).to_le_bytes());
        let record_length = record.len() as u32;
        record[28..32].copy_from_slice(&record_length.to_le_bytes());
        record[attribute_offset..used_size].copy_from_slice(attribute);
        (number, record)
    }

    fn synthetic_sparse_data_attribute(cluster_size: u64, clusters: u16) -> Vec<u8> {
        let data_runs_offset = 66_usize;
        let mut attribute = vec![0_u8; data_runs_offset + 4];
        let logical_size = cluster_size * u64::from(clusters);
        attribute[..4]
            .copy_from_slice(&(ntfs_reader::api::NtfsAttributeType::Data as u32).to_le_bytes());
        let attribute_length = attribute.len() as u32;
        attribute[4..8].copy_from_slice(&attribute_length.to_le_bytes());
        attribute[8] = 1;
        attribute[9] = 1;
        attribute[10..12].copy_from_slice(&64_u16.to_le_bytes());
        attribute[32..34].copy_from_slice(&(data_runs_offset as u16).to_le_bytes());
        attribute[40..48].copy_from_slice(&logical_size.to_le_bytes());
        attribute[48..56].copy_from_slice(&logical_size.to_le_bytes());
        attribute[64..66].copy_from_slice(&[b'$', 0]);
        attribute[data_runs_offset] = 0x02;
        attribute[data_runs_offset + 1..data_runs_offset + 3]
            .copy_from_slice(&clusters.to_le_bytes());
        attribute
    }

    fn synthetic_resident_data_attribute(length: u32) -> Vec<u8> {
        let value_offset = 24_usize;
        let mut attribute = vec![0_u8; value_offset + length as usize];
        attribute[..4]
            .copy_from_slice(&(ntfs_reader::api::NtfsAttributeType::Data as u32).to_le_bytes());
        let attribute_length = attribute.len() as u32;
        attribute[4..8].copy_from_slice(&attribute_length.to_le_bytes());
        attribute[16..20].copy_from_slice(&length.to_le_bytes());
        attribute[20..22].copy_from_slice(&(value_offset as u16).to_le_bytes());
        attribute
    }

    fn synthetic_allocated_data_extent(
        cluster_size: u64,
        extent_clusters: u8,
        total_clusters: u64,
        lowest_vcn: u64,
    ) -> Vec<u8> {
        let data_runs_offset = 64_usize;
        let mut attribute = vec![0_u8; data_runs_offset + 4];
        attribute[..4]
            .copy_from_slice(&(ntfs_reader::api::NtfsAttributeType::Data as u32).to_le_bytes());
        let attribute_length = attribute.len() as u32;
        attribute[4..8].copy_from_slice(&attribute_length.to_le_bytes());
        attribute[8] = 1;
        attribute[16..24].copy_from_slice(&lowest_vcn.to_le_bytes());
        attribute[32..34].copy_from_slice(&(data_runs_offset as u16).to_le_bytes());
        let extent_size = cluster_size * u64::from(extent_clusters);
        attribute[40..48].copy_from_slice(&extent_size.to_le_bytes());
        attribute[48..56].copy_from_slice(&(cluster_size * total_clusters).to_le_bytes());
        attribute[data_runs_offset..data_runs_offset + 4].copy_from_slice(&[
            0x11,
            extent_clusters,
            1,
            0,
        ]);
        attribute
    }

    #[test]
    fn windirstat_report_preserves_physical_sizes_and_aggregates_extensions() {
        let report = concat!(
            "\"Name\",\"Files\",\"Folders\",\"Logical Size\",\"Physical Size\",\"Attributes\",\"Last Change\",\"WinDirStat Attributes\",\"Index\"\r\n",
            "\"C:\\scan\",2,1,1000,786432,\"\",2026-08-11T00:00:00Z,0x30000004,0x0\r\n",
            "\"C:\\scan\\nested\",1,0,800,524288,\"D\",2026-08-11T00:00:00Z,0x20000004,0x1\r\n",
            "\"C:\\scan\\nested\\large.bin\",0,0,800,524288,\"A\",2026-08-11T00:00:00Z,0x20000008,0x2\r\n",
            "\"C:\\scan\\root.txt\",0,0,200,262144,\"A\",2026-08-11T00:00:00Z,0x20000008,0x3\r\n",
        );

        let scan = parse_windirstat_report(
            std::io::Cursor::new(report.as_bytes()),
            Path::new(r"C:\scan"),
            |_| {},
        )
        .expect("WinDirStat report");

        assert_eq!(scan.total_bytes, 1000);
        assert_eq!(scan.total_allocated_bytes, 786_432);
        assert_eq!(scan.files, 2);
        assert_eq!(scan.folders, 1);
        assert_eq!(
            scan.directory_allocated_bytes
                .get(Path::new(r"C:\scan\nested")),
            Some(&524_288)
        );
        assert_eq!(scan.root_entries.len(), 2);
        assert_eq!(
            scan.extensions
                .iter()
                .find(|entry| entry.extension == ".bin")
                .map(|entry| entry.allocated_bytes),
            Some(524_288)
        );
        assert_eq!(
            scan.extensions
                .iter()
                .find(|entry| entry.extension == ".txt")
                .map(|entry| entry.allocated_bytes),
            Some(262_144)
        );
    }

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
    fn directory_size_counts_nested_files_without_recursion() {
        let root = tempfile::tempdir().expect("temporary scan root");
        let nested = root.path().join("one").join("two").join("three");
        fs::create_dir_all(&nested).expect("nested scan fixture");
        fs::write(root.path().join("root.bin"), [0_u8; 3]).expect("root fixture file");
        fs::write(nested.join("nested.bin"), [0_u8; 5]).expect("nested fixture file");

        assert_eq!(directory_size(root.path()), 8);
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
    fn mft_sizes_fall_back_to_filename_metadata_when_data_attributes_are_split() {
        let sizes = resolve_mft_sizes(
            MftSizeTotals::default(),
            MftSizeTotals {
                logical: 931,
                allocated: 1_400,
            },
            false,
            false,
        );

        assert_eq!(sizes.logical, 931);
        assert_eq!(sizes.allocated, 1_400);
    }

    #[test]
    fn mft_sizes_keep_authoritative_stream_values_when_present() {
        let sizes = resolve_mft_sizes(
            MftSizeTotals {
                logical: 536,
                allocated: 911,
            },
            MftSizeTotals {
                logical: 500,
                allocated: 900,
            },
            true,
            true,
        );

        assert_eq!(sizes.logical, 536);
        assert_eq!(sizes.allocated, 911);
    }

    #[test]
    fn sparse_data_runs_do_not_allocate_their_declared_volume_size() {
        let cluster_size = 262_144;
        let (number, record) =
            synthetic_mft_file(8, &synthetic_sparse_data_attribute(cluster_size, 1024));
        let file = ntfs_reader::file::NtfsFile::new(number, &record);

        let sizes = mft_record_sizes(&file, &[], None, false, cluster_size);

        assert_eq!(sizes.logical, 0);
        assert_eq!(sizes.allocated, 0);
    }

    #[test]
    fn resident_data_uses_mft_storage_without_file_cluster_allocation() {
        let (number, record) = synthetic_mft_file(44, &synthetic_resident_data_attribute(28));
        let file = ntfs_reader::file::NtfsFile::new(number, &record);

        let sizes = mft_record_sizes(&file, &[], None, false, 262_144);

        assert_eq!(sizes.logical, 28);
        assert_eq!(sizes.allocated, 0);
    }

    #[test]
    fn split_data_extents_contribute_all_physical_runs_once() {
        let cluster_size = 262_144;
        let (base_number, base_record) =
            synthetic_mft_file(42, &synthetic_allocated_data_extent(cluster_size, 4, 10, 0));
        let (extension_number, extension_record) =
            synthetic_mft_file(43, &synthetic_allocated_data_extent(cluster_size, 6, 10, 4));
        let base = ntfs_reader::file::NtfsFile::new(base_number, &base_record);
        let extension = ntfs_reader::file::NtfsFile::new(extension_number, &extension_record);

        let sizes = mft_record_sizes(&base, &[extension], None, false, cluster_size);

        assert_eq!(sizes.logical, 10 * cluster_size);
        assert_eq!(sizes.allocated, 10 * cluster_size);
    }

    #[test]
    fn allocation_unit_rounding_matches_large_cluster_volumes() {
        assert_eq!(round_to_allocation_unit(0, 262_144), 0);
        assert_eq!(round_to_allocation_unit(1, 262_144), 262_144);
        assert_eq!(round_to_allocation_unit(262_144, 262_144), 262_144);
        assert_eq!(round_to_allocation_unit(262_145, 262_144), 524_288);
    }

    #[test]
    fn prefix_cleanup_removes_only_allowlisted_files() {
        let root = tempfile::tempdir().expect("temporary cleanup root");
        let thumbnail = root.path().join("thumbcache_96.db");
        let icon = root.path().join("iconcache_96.db");
        fs::write(&thumbnail, [0_u8; 5]).expect("thumbnail fixture");
        fs::write(&icon, [0_u8; 7]).expect("icon fixture");
        let target = CleanupTarget::FilesWithPrefix {
            directory: root.path().to_path_buf(),
            prefix: "thumbcache_".into(),
        };

        assert_eq!(cleanup_target_size(&target), 5);
        clean_target(&target);

        assert!(!thumbnail.exists());
        assert!(icon.exists());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn directory_size_does_not_follow_directory_reparse_points() {
        let root = tempfile::tempdir().expect("temporary scan root");
        let outside = tempfile::tempdir().expect("temporary external root");
        fs::write(outside.path().join("outside.bin"), [0_u8; 11]).expect("external fixture file");
        let junction = root.path().join("junction");
        if std::os::windows::fs::symlink_dir(outside.path(), &junction).is_err() {
            return;
        }

        assert_eq!(directory_size(root.path()), 0);
        let cleanup_target = CleanupTarget::DirectoryContents(junction);
        assert_eq!(cleanup_target_size(&cleanup_target), 0);
        clean_target(&cleanup_target);
        assert!(outside.path().join("outside.bin").exists());
    }
}

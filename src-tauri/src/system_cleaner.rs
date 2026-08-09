use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::os::windows::{ffi::OsStrExt, fs::MetadataExt};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{OnceLock, RwLock},
};
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "windows")]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanerOverview {
    scan_root: String,
    total_bytes: u64,
    largest: Vec<DiskEntry>,
    cleanup: Vec<CleanupEntry>,
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
    files: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    files: u64,
    folders: u64,
    bytes: u64,
    current_path: String,
    elapsed_ms: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskEntry {
    name: String,
    path: String,
    bytes: u64,
    is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    path: String,
    parent_path: Option<String>,
    total_bytes: u64,
    entries: Vec<DiskEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupEntry {
    id: String,
    path: String,
    bytes: u64,
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
}

#[derive(Deserialize, Serialize)]
struct DriveScan {
    root_entries: Vec<DiskEntry>,
    extensions: Vec<ExtensionEntry>,
    files: u64,
    folders: u64,
    elapsed_ms: u64,
    total_bytes: u64,
    directory_bytes: HashMap<PathBuf, u64>,
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
    is_directory: bool,
}

static SCAN_CACHE: OnceLock<RwLock<Option<ScanCache>>> = OnceLock::new();

#[cfg(target_os = "windows")]
fn scan_directory_entries(path: &Path) -> Result<Vec<ScannedEntry>, String> {
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
        if name != "." && name != ".." && attributes & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
            entries.push(ScannedEntry {
                path: path.join(&name),
                name,
                bytes: ((find_data.nFileSizeHigh as u64) << 32) | find_data.nFileSizeLow as u64,
                is_directory: attributes & FILE_ATTRIBUTE_DIRECTORY != 0,
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
fn scan_directory_entries(path: &Path) -> Result<Vec<ScannedEntry>, String> {
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
                is_directory: metadata.is_dir(),
            })
        })
        .collect())
}

fn directory_size(path: &Path) -> u64 {
    let mut bytes = 0_u64;
    let mut pending = vec![path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = scan_directory_entries(&directory) else {
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
) -> Result<DirectoryListing, String> {
    let mut entries = scan_directory_entries(path)?
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
    let mut extension_totals: HashMap<String, (u64, u64)> = HashMap::new();
    let mut files = 0_u64;
    let mut folders = 0_u64;
    let mut bytes = 0_u64;
    let mut since_progress = 0_u16;

    while let Some(work) = pending.pop() {
        match work {
            ScanWork::Enter { path, parent } => {
                folders += 1;
                directory_bytes.entry(path.clone()).or_default();
                pending.push(ScanWork::Exit {
                    path: path.clone(),
                    parent,
                });
                let Ok(entries) = scan_directory_entries(&path) else {
                    continue;
                };
                for entry in entries {
                    let entry_path = entry.path;
                    if entry.is_directory {
                        pending.push(ScanWork::Enter {
                            path: entry_path,
                            parent: Some(path.clone()),
                        });
                    } else {
                        let size = entry.bytes;
                        files += 1;
                        bytes = bytes.saturating_add(size);
                        let directory_total = directory_bytes.entry(path.clone()).or_default();
                        *directory_total = directory_total.saturating_add(size);
                        let extension = entry_path
                            .extension()
                            .and_then(|value| value.to_str())
                            .filter(|value| !value.is_empty())
                            .map(|value| format!(".{}", value.to_ascii_lowercase()))
                            .unwrap_or_else(|| "(none)".into());
                        let total = extension_totals.entry(extension).or_default();
                        total.0 = total.0.saturating_add(size);
                        total.1 += 1;
                    }
                    since_progress = since_progress.saturating_add(1);
                    if since_progress >= 4_096 {
                        since_progress = 0;
                        emit_progress(ScanProgress {
                            files,
                            folders,
                            bytes,
                            current_path: path.to_string_lossy().into_owned(),
                            elapsed_ms: started.elapsed().as_millis() as u64,
                        });
                    }
                }
            }
            ScanWork::Exit { path, parent } => {
                let total = directory_bytes.get(&path).copied().unwrap_or_default();
                if let Some(parent) = parent {
                    let parent_total = directory_bytes.entry(parent).or_default();
                    *parent_total = parent_total.saturating_add(total);
                }
            }
        }
    }
    let root_listing = directory_entries(root, root, &directory_bytes)?;
    let mut extensions = extension_totals
        .into_iter()
        .map(|(extension, (bytes, files))| ExtensionEntry {
            extension,
            bytes,
            files,
        })
        .collect::<Vec<_>>();
    extensions.sort_by_key(|entry| std::cmp::Reverse(entry.bytes));
    extensions.truncate(100);
    Ok(DriveScan {
        root_entries: root_listing.entries,
        extensions,
        files,
        folders,
        elapsed_ms: started.elapsed().as_millis() as u64,
        total_bytes: directory_bytes.get(root).copied().unwrap_or_default(),
        directory_bytes,
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
fn load_mft_tolerating_bad_records(
    volume: ntfs_reader::volume::Volume,
) -> Result<ntfs_reader::mft::Mft, String> {
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
    let mut data = Vec::with_capacity(mft_attribute.value_length() as usize);
    mft_stream
        .read_to_end(&mut data)
        .map_err(|error| error.to_string())?;
    let max_record = data.len() as u64 / volume.file_record_size;
    let bitmap = vec![u8::MAX; max_record.div_ceil(8) as usize];

    for number in 0..max_record {
        let start = (number * volume.file_record_size) as usize;
        let end = start + volume.file_record_size as usize;
        if !fixup_mft_record(&mut data[start..end]) {
            data[start..start + 4].fill(0);
        }
    }

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
fn mft_logical_size(file: &ntfs_reader::file::NtfsFile<'_>) -> u64 {
    use ntfs_reader::api::NtfsAttributeType;

    let mut size = 0_u64;
    file.attributes(|attribute| {
        if attribute.header.type_id != NtfsAttributeType::Data as u32
            || attribute.header.name_length != 0
        {
            return;
        }
        let attribute_size = if attribute.header.is_non_resident == 0 {
            attribute
                .resident_header()
                .map(|header| header.value_length as u64)
        } else {
            attribute
                .nonresident_header()
                .map(|header| header.data_size)
        };
        size = size.max(attribute_size.unwrap_or_default());
    });
    size
}

#[cfg(target_os = "windows")]
fn scan_raw_mft(root: &Path) -> Result<DriveScan, String> {
    use ntfs_reader::volume::Volume;

    let started = std::time::Instant::now();
    let drive = root.to_string_lossy().chars().take(2).collect::<String>();
    if drive.len() != 2 || !drive.ends_with(':') {
        return Err("Raw MFT scan requires a drive root.".into());
    }
    let volume_path = format!(r"\\.\{drive}");
    let volume = Volume::new(&volume_path)
        .map_err(|error| format!("Could not open {volume_path}: {error}"))?;
    let mut mft = load_mft_tolerating_bad_records(volume)?;
    mft.volume.path = root.to_path_buf();

    let mut extension_totals: HashMap<String, (u64, u64)> = HashMap::new();
    let mut direct_directory_bytes: HashMap<u64, u64> = HashMap::new();
    let mut directories = HashMap::new();
    let mut root_entries = Vec::new();
    let mut files = 0_u64;
    let mut folders = 1_u64;
    for file in mft.files() {
        let Some(name_attribute) = file.get_best_file_name(&mft) else {
            continue;
        };
        let name = name_attribute.to_string();
        let parent = name_attribute.parent();

        if file.is_directory() {
            directories.insert(file.number(), (parent, name));
            folders += 1;
        } else {
            let bytes = mft_logical_size(&file);
            files += 1;
            let extension = Path::new(&name)
                .extension()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty())
                .map(|value| format!(".{}", value.to_ascii_lowercase()))
                .unwrap_or_else(|| "(none)".into());
            let extension_total = extension_totals.entry(extension).or_default();
            extension_total.0 = extension_total.0.saturating_add(bytes);
            extension_total.1 += 1;
            let total = direct_directory_bytes.entry(parent).or_default();
            *total = total.saturating_add(bytes);

            if parent == 5 {
                root_entries.push(DiskEntry {
                    name: name.clone(),
                    path: root.join(&name).to_string_lossy().into_owned(),
                    bytes,
                    is_directory: false,
                });
            }
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
    }

    let mut directory_bytes = HashMap::with_capacity(resolved_directories.len() + 1);
    directory_bytes.insert(
        root.to_path_buf(),
        direct_directory_bytes.get(&5).copied().unwrap_or_default(),
    );
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
                is_directory: true,
            });
        }
        directory_bytes.insert(path, bytes);
    }

    root_entries.sort_by_key(|entry| std::cmp::Reverse(entry.bytes));
    let mut extensions = extension_totals
        .into_iter()
        .map(|(extension, (bytes, files))| ExtensionEntry {
            extension,
            bytes,
            files,
        })
        .collect::<Vec<_>>();
    extensions.sort_by_key(|entry| std::cmp::Reverse(entry.bytes));
    extensions.truncate(100);
    let total_bytes = directory_bytes.get(root).copied().unwrap_or_default();

    Ok(DriveScan {
        root_entries,
        extensions,
        files,
        folders,
        elapsed_ms: started.elapsed().as_millis() as u64,
        total_bytes,
        directory_bytes,
    })
}

#[cfg(target_os = "windows")]
fn powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(target_os = "windows")]
fn elevated_mft_scan(root: &Path) -> Result<DriveScan, String> {
    let executable = env::current_exe().map_err(|error| error.to_string())?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let output_path = env::temp_dir().join(format!(
        "kkterm-system-cleaner-mft-{}-{nonce}.bin",
        std::process::id()
    ));
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output_path)
        .map_err(|error| error.to_string())?;

    let script = format!(
        "$p=Start-Process -FilePath {} -ArgumentList @('--system-cleaner-mft-scan',{}, {}) -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode",
        powershell_literal(&executable.to_string_lossy()),
        powershell_literal(&root.to_string_lossy()),
        powershell_literal(&output_path.to_string_lossy()),
    );
    let status = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .status();
    let result = match status {
        Ok(status) if status.success() => fs::File::open(&output_path)
            .map_err(|error| error.to_string())
            .and_then(|mut file| {
                bincode::serde::decode_from_std_read(&mut file, bincode::config::standard())
                    .map_err(|error| error.to_string())
            }),
        Ok(status) => Err(format!("Elevated MFT helper exited with {status}.")),
        Err(error) => Err(error.to_string()),
    };
    let _ = fs::remove_file(output_path);
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
    let output_parent_is_temp = output_path
        .parent()
        .and_then(|path| fs::canonicalize(path).ok())
        .zip(fs::canonicalize(env::temp_dir()).ok())
        .is_some_and(|(parent, temp)| parent == temp);
    let valid_output = output_parent_is_temp
        && output_path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| {
                name.starts_with("kkterm-system-cleaner-mft-") && name.ends_with(".bin")
            })
        && output_path.is_file();
    if !valid_output {
        return Some(2);
    }
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| scan_raw_mft(&root)))
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
    if let Ok(scan) = elevated_mft_scan(root) {
        let _ = app.emit(
            "system-cleaner://scan-progress",
            ScanProgress {
                files: scan.files,
                folders: scan.folders,
                bytes: scan.total_bytes,
                current_path: root.to_string_lossy().into_owned(),
                elapsed_ms: scan.elapsed_ms,
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

fn cleanup_locations() -> Vec<(String, PathBuf)> {
    let mut locations = Vec::new();
    if let Ok(path) = env::var("TEMP") {
        locations.push(("temp".into(), path.into()));
    }
    if let Ok(path) = env::var("LOCALAPPDATA") {
        let base = PathBuf::from(path);
        locations.push((
            "browser-cache".into(),
            base.join("Microsoft/Edge/User Data/Default/Cache"),
        ));
        locations.push((
            "thumbnail-cache".into(),
            base.join("Microsoft/Windows/Explorer"),
        ));
    }
    locations
}

fn installed_apps() -> Vec<InstalledApp> {
    let Ok(output) = Command::new("winget")
        .args([
            "list",
            "--accept-source-agreements",
            "--disable-interactivity",
        ])
        .output()
    else {
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
                                .map(|(id, path)| CleanupEntry {
                                    id,
                                    bytes: directory_size(&path),
                                    path: path.to_string_lossy().into_owned(),
                                })
                                .collect()
                        },
                        installed_apps,
                    )
                },
            );
            let drive_scan = drive_scan?;
            let (disk_capacity_bytes, disk_free_bytes) = disk_space(&root);
            let overview = CleanerOverview {
                scan_root: root.to_string_lossy().into_owned(),
                total_bytes: drive_scan.total_bytes,
                largest: drive_scan.root_entries,
                cleanup,
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
        directory_entries(&cache.root, &requested, &cache.directory_bytes)
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
        for (id, path) in cleanup_locations()
            .into_iter()
            .filter(|(id, _)| ids.contains(id))
        {
            let _ = id;
            let before = directory_size(&path);
            if let Ok(entries) = fs::read_dir(&path) {
                for entry in entries.flatten() {
                    let target = entry.path();
                    let _ = if target.is_dir() {
                        fs::remove_dir_all(target)
                    } else {
                        fs::remove_file(target)
                    };
                }
            }
            freed += before.saturating_sub(directory_size(&path));
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

        let listing = directory_entries(root.path(), &first, &scan.directory_bytes)
            .expect("cached directory listing");
        let nested_entry = listing
            .entries
            .iter()
            .find(|entry| entry.name == "nested")
            .expect("nested directory entry");
        assert!(nested_entry.is_directory);
        assert_eq!(nested_entry.bytes, 5);
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
    }
}

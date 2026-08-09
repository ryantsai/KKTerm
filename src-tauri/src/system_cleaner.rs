use rayon::prelude::*;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;
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

#[derive(Serialize)]
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

static SCAN_CACHE: OnceLock<RwLock<Option<ScanCache>>> = OnceLock::new();

fn directory_size(path: &Path) -> u64 {
    let mut bytes = 0_u64;
    let mut pending = vec![path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if is_reparse_point(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file() {
                bytes = bytes.saturating_add(metadata.len());
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
    let mut entries = fs::read_dir(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?
        .flatten()
        .filter_map(|entry| {
            let entry_path = entry.path();
            let metadata = fs::symlink_metadata(&entry_path).ok()?;
            if is_reparse_point(&metadata) || (!metadata.is_dir() && !metadata.is_file()) {
                return None;
            }
            let is_directory = metadata.is_dir();
            Some(DiskEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry_path.to_string_lossy().into_owned(),
                bytes: if is_directory {
                    directory_bytes
                        .get(&entry_path)
                        .copied()
                        .unwrap_or_default()
                } else {
                    metadata.len()
                },
                is_directory,
            })
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
                let Ok(entries) = fs::read_dir(&path) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    let Ok(metadata) = fs::symlink_metadata(&entry_path) else {
                        continue;
                    };
                    if is_reparse_point(&metadata) {
                        continue;
                    }
                    if metadata.is_dir() {
                        pending.push(ScanWork::Enter {
                            path: entry_path,
                            parent: Some(path.clone()),
                        });
                    } else if metadata.is_file() {
                        let size = metadata.len();
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
pub async fn system_cleaner_scan(app: AppHandle) -> Result<CleanerOverview, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let root = env::var("SystemDrive")
                .map(PathBuf::from)
                .map(|drive| drive.join("\\"))
                .map_err(|_| "Windows system drive is unavailable.")?;
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

use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanerOverview {
    scan_root: String,
    total_bytes: u64,
    largest: Vec<DiskEntry>,
    cleanup: Vec<CleanupEntry>,
    apps: Vec<InstalledApp>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskEntry {
    path: String,
    bytes: u64,
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

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| !entry.file_type().is_ok_and(|kind| kind.is_symlink()))
        .map(|entry| {
            let Ok(metadata) = entry.metadata() else {
                return 0;
            };
            if metadata.is_dir() {
                directory_size(&entry.path())
            } else {
                metadata.len()
            }
        })
        .sum()
}

fn child_sizes(path: &Path) -> Vec<DiskEntry> {
    let Ok(entries) = fs::read_dir(path) else {
        return Vec::new();
    };
    let mut result: Vec<_> = entries
        .flatten()
        .filter(|entry| !entry.file_type().is_ok_and(|kind| kind.is_symlink()))
        .map(|entry| {
            let path = entry.path();
            let bytes = entry
                .metadata()
                .map(|m| {
                    if m.is_dir() {
                        directory_size(&path)
                    } else {
                        m.len()
                    }
                })
                .unwrap_or(0);
            DiskEntry {
                path: path.to_string_lossy().into_owned(),
                bytes,
            }
        })
        .collect();
    result.sort_by_key(|entry| std::cmp::Reverse(entry.bytes));
    result.truncate(40);
    result
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
pub async fn system_cleaner_scan() -> Result<CleanerOverview, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let root = env::var("USERPROFILE")
                .map(PathBuf::from)
                .map_err(|_| "Windows user folder is unavailable.")?;
            let largest = child_sizes(&root);
            let total_bytes = largest.iter().map(|entry| entry.bytes).sum();
            let cleanup = cleanup_locations()
                .into_iter()
                .map(|(id, path)| CleanupEntry {
                    id,
                    bytes: directory_size(&path),
                    path: path.to_string_lossy().into_owned(),
                })
                .collect();
            Ok(CleanerOverview {
                scan_root: root.to_string_lossy().into_owned(),
                total_bytes,
                largest,
                cleanup,
                apps: installed_apps(),
            })
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

#[tauri::command]
pub async fn system_cleaner_clean(ids: Vec<String>) -> Result<u64, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
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
        let status = Command::new("winget")
            .args([
                "uninstall",
                "--id",
                &app_id,
                "--exact",
                "--interactive",
            ])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("winget exited with status {status}"))
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

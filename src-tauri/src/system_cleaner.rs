use rayon::prelude::*;
use serde::Serialize;
use serde_json::json;
#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

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

fn child_sizes(path: &Path) -> Vec<DiskEntry> {
    let Ok(entries) = fs::read_dir(path) else {
        return Vec::new();
    };
    let mut result: Vec<_> = entries
        .flatten()
        .filter(|entry| {
            fs::symlink_metadata(entry.path()).is_ok_and(|metadata| !is_reparse_point(&metadata))
        })
        .collect::<Vec<_>>()
        .into_par_iter()
        .map(|entry| {
            let path = entry.path();
            let bytes = fs::symlink_metadata(&path)
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
pub async fn system_cleaner_scan() -> Result<CleanerOverview, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("System Cleaner is available only on Windows.".into());
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let root = env::var("USERPROFILE")
                .map(PathBuf::from)
                .map_err(|_| "Windows user folder is unavailable.")?;
            let (largest, (cleanup, apps)) = rayon::join(
                || child_sizes(&root),
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
            let total_bytes = largest.iter().map(|entry| entry.bytes).sum();
            Ok(CleanerOverview {
                scan_root: root.to_string_lossy().into_owned(),
                total_bytes,
                largest,
                cleanup,
                apps,
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

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Runtime};

pub const PATHS_AVAILABLE_EVENT: &str = "kkterm://launch-paths-available";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPath {
    path: String,
    kind: LaunchPathKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum LaunchPathKind {
    File,
    Folder,
}

pub struct LaunchPathState {
    pending: Mutex<Vec<LaunchPath>>,
}

impl LaunchPathState {
    pub fn from_cli_invocation(args: &[String], cwd: &Path) -> Self {
        Self {
            pending: Mutex::new(resolve_cli_paths(args, cwd)),
        }
    }

    pub fn enqueue_cli_invocation<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        args: &[String],
        cwd: &Path,
    ) {
        let paths = resolve_cli_paths(args, cwd);
        if paths.is_empty() {
            return;
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.extend(paths);
        }
        let _ = app.emit(PATHS_AVAILABLE_EVENT, ());
    }

    fn take(&self) -> Vec<LaunchPath> {
        self.pending
            .lock()
            .map(|mut pending| std::mem::take(&mut *pending))
            .unwrap_or_default()
    }
}

#[tauri::command]
pub fn take_launch_paths(state: tauri::State<'_, LaunchPathState>) -> Vec<LaunchPath> {
    state.take()
}

fn resolve_cli_paths(args: &[String], cwd: &Path) -> Vec<LaunchPath> {
    let mut seen = HashSet::new();
    args.iter()
        .skip(1)
        .filter_map(|argument| resolve_path_argument(argument, cwd))
        .filter(|launch_path| seen.insert(launch_path.path.clone()))
        .collect()
}

fn resolve_path_argument(argument: &str, cwd: &Path) -> Option<LaunchPath> {
    let argument = argument.trim();
    if argument.is_empty() {
        return None;
    }
    let requested = PathBuf::from(argument);
    let requested = if requested.is_absolute() {
        requested
    } else {
        cwd.join(requested)
    };
    let canonical = requested.canonicalize().ok()?;
    let metadata = canonical.metadata().ok()?;
    let kind = if metadata.is_file() {
        LaunchPathKind::File
    } else if metadata.is_dir() {
        LaunchPathKind::Folder
    } else {
        return None;
    };
    Some(LaunchPath {
        path: platform_display_path(&canonical),
        kind,
    })
}

fn platform_display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(ordinary) = value.strip_prefix(r"\\?\") {
            return ordinary.to_string();
        }
    }
    value.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_files_and_folders_but_ignores_other_arguments() {
        let root = tempfile::tempdir().expect("temp root");
        let file = root.path().join("notes.txt");
        let folder = root.path().join("logs");
        std::fs::write(&file, "hello").expect("test file");
        std::fs::create_dir(&folder).expect("test folder");

        let paths = resolve_cli_paths(
            &[
                "kkterm".to_string(),
                "notes.txt".to_string(),
                "--not-a-path".to_string(),
                "logs".to_string(),
            ],
            root.path(),
        );

        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0].kind, LaunchPathKind::File);
        assert_eq!(paths[0].path, platform_display_path(&file.canonicalize().unwrap()));
        assert_eq!(paths[1].kind, LaunchPathKind::Folder);
        assert_eq!(
            paths[1].path,
            platform_display_path(&folder.canonicalize().unwrap())
        );
    }

    #[test]
    fn skips_the_program_argument_and_deduplicates_paths() {
        let root = tempfile::tempdir().expect("temp root");
        let file = root.path().join("same.txt");
        std::fs::write(&file, "hello").expect("test file");

        let paths = resolve_cli_paths(
            &[
                file.to_string_lossy().into_owned(),
                file.to_string_lossy().into_owned(),
                file.to_string_lossy().into_owned(),
            ],
            root.path(),
        );

        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].kind, LaunchPathKind::File);
    }
}

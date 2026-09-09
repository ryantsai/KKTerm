//! Mac App Store file grants. Paths in settings are hints, never authorization.
pub const ENABLED: bool = cfg!(all(target_os = "macos", feature = "mac-app-store"));

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAccessRequest {
    pub action: String,
    pub path: Option<String>,
    pub directory: Option<bool>,
    pub title: String,
}

#[tauri::command]
pub async fn app_store_file_access(
    app: tauri::AppHandle,
    request: FileAccessRequest,
) -> Result<Vec<String>, String> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let _ = send.send(native::handle_request(&handle, request));
        })
        .map_err(|error| error.to_string())?;
        receive.await.map_err(|error| error.to_string())?
    }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    {
        let _ = (
            app,
            request.action,
            request.path,
            request.directory,
            request.title,
        );
        Err("Mac App Store file access is unavailable in this build".into())
    }
}

#[cfg(all(target_os = "macos", feature = "mac-app-store"))]
pub use native::*;

#[cfg(all(target_os = "macos", feature = "mac-app-store"))]
mod native {
    use super::FileAccessRequest;
    use objc2::{ClassType, MainThreadMarker, rc::Retained, runtime::Bool};
    use objc2_app_kit::{NSOpenPanel, NSPasteboard, NSPasteboardNameDrag};
    use objc2_foundation::{
        NSArray, NSData, NSString, NSURL, NSURLBookmarkCreationOptions,
        NSURLBookmarkResolutionOptions,
    };
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        io::Write,
        path::{Path, PathBuf},
    };
    use tauri::AppHandle;

    // Kept outside SQLite/settings exports: grants belong to this installation.
    fn bookmark_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
        Ok(crate::app_paths::data_dir(app)?
            .join("sandbox-bookmarks")
            .join(format!(
                "{}.bookmark",
                Sha256::digest(key.as_bytes())
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            )))
    }

    pub struct Access {
        url: Retained<NSURL>,
        pub path: PathBuf,
    }

    impl Access {
        pub fn open(&self, containing_folder: bool) -> Result<(), String> {
            let workspace = objc2_app_kit::NSWorkspace::sharedWorkspace();
            if containing_folder && !self.path.is_dir() {
                workspace.activateFileViewerSelectingURLs(&NSArray::from_slice(&[&*self.url]));
                return Ok(());
            }
            if workspace.openURL(&self.url) {
                Ok(())
            } else {
                Err("macOS could not open the selected file or folder".into())
            }
        }
    }

    impl Drop for Access {
        fn drop(&mut self) {
            unsafe { self.url.stopAccessingSecurityScopedResource() };
        }
    }

    fn url_path(url: &NSURL) -> Result<PathBuf, String> {
        if !url.isFileURL() {
            return Err("Expected a local file URL".into());
        }
        url.path()
            .map(|path| PathBuf::from(path.to_string()))
            .ok_or_else(|| "File URL has no path".into())
    }

    fn remember(app: &AppHandle, key: &str, url: &NSURL) -> Result<(), String> {
        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                NSURLBookmarkCreationOptions::WithSecurityScope,
                None,
                None,
            )
            .map_err(|error| error.to_string())?;
        let target = bookmark_path(app, key)?;
        let parent = target.parent().ok_or("Bookmark directory is missing")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let mut temp =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        temp.write_all(&data.to_vec())
            .map_err(|error| error.to_string())?;
        temp.persist(target).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn restore(app: &AppHandle, key: &str) -> Result<Access, String> {
        let bytes = fs::read(bookmark_path(app, key)?).map_err(|error| error.to_string())?;
        let mut stale = Bool::NO;
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &NSData::with_bytes(&bytes),
                NSURLBookmarkResolutionOptions::WithSecurityScope
                    | NSURLBookmarkResolutionOptions::WithoutUI,
                None,
                &mut stale,
            )
        }
        .map_err(|error| error.to_string())?;
        let path = url_path(&url)?;
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return Err("Folder or file access must be granted again".into());
        }
        let access = Access { path, url };
        if stale.as_bool() {
            remember(app, key, &access.url)?;
        }
        let resolved_key = access.path.to_string_lossy();
        if resolved_key != key && (stale.as_bool() || !bookmark_path(app, &resolved_key)?.is_file())
        {
            remember(app, &resolved_key, &access.url)?;
        }
        Ok(access)
    }

    // Only a real native selection/drop supplies the URL used to create a grant.
    fn remember_selection(app: &AppHandle, url: &NSURL) -> Result<String, String> {
        let path = url_path(url)?.to_string_lossy().into_owned();
        remember(app, &path, url)?;
        Ok(path)
    }

    fn select(
        app: &AppHandle,
        path: Option<&str>,
        directory: Option<bool>,
        title: &str,
    ) -> Result<Option<String>, String> {
        let mtm = MainThreadMarker::new().ok_or("File selection requires the main thread")?;
        let panel = NSOpenPanel::openPanel(mtm);
        panel.setTitle(Some(&NSString::from_str(title)));
        panel.setCanChooseDirectories(directory != Some(false));
        panel.setCanChooseFiles(directory != Some(true));
        panel.setAllowsMultipleSelection(false);
        panel.setTreatsFilePackagesAsDirectories(false);
        if let Some(path) = path.filter(|path| !path.is_empty()) {
            let hint = NSURL::fileURLWithPath(&NSString::from_str(path));
            panel.setDirectoryURL(Some(&hint));
        }
        if panel.runModal() != 1 {
            return Ok(None);
        }
        let url = panel.URL().ok_or("No file was selected")?;
        remember_selection(app, &url).map(Some)
    }

    pub fn handle_request(
        app: &AppHandle,
        request: FileAccessRequest,
    ) -> Result<Vec<String>, String> {
        let path = request
            .path
            .as_deref()
            .filter(|path| !path.trim().is_empty());
        match request.action.as_str() {
            "select" => Ok(select(app, path, request.directory, &request.title)?
                .into_iter()
                .collect()),
            "authorize" => {
                let path = path.ok_or("A file path is required")?;
                if let Ok(access) = restore(app, path) {
                    if access.path.exists() {
                        return Ok(vec![access.path.to_string_lossy().into_owned()]);
                    }
                }
                // Imported/typed paths are hints. Selecting a different target is
                // allowed; callers must store/use the returned path, not the hint.
                let selected = select(app, Some(path), request.directory, &request.title)?;
                if let Some(selected) = &selected {
                    let access = restore(app, selected)?;
                    remember(app, path, &access.url)?;
                }
                Ok(selected.into_iter().collect())
            }
            "drop" => {
                // Read NSURL objects, not NSFilenamesPboardType strings, so the
                // system-provided sandbox extensions survive the native boundary.
                let pasteboard = NSPasteboard::pasteboardWithName(unsafe { NSPasteboardNameDrag });
                let objects = unsafe {
                    pasteboard.readObjectsForClasses_options(
                        &NSArray::from_slice(&[NSURL::class()]),
                        None,
                    )
                }
                .ok_or("The drop contains no local file URLs")?;
                let mut paths = Vec::new();
                for object in &objects {
                    let Some(url) = object.downcast_ref::<NSURL>() else {
                        continue;
                    };
                    let path = url_path(url)?.to_string_lossy().into_owned();
                    if remember_selection(app, url).is_ok() && restore(app, &path).is_ok() {
                        paths.push(path);
                    } else if let Some(selected) = select(app, Some(&path), None, &request.title)? {
                        paths.push(selected);
                    }
                }
                Ok(paths)
            }
            _ => Err("Unknown file access action".into()),
        }
    }

    pub fn download_access(
        app: &AppHandle,
        configured: &Path,
        title: &str,
    ) -> Result<Option<Access>, String> {
        let key = if configured.as_os_str().is_empty() {
            "url-download-default".to_owned()
        } else {
            configured.to_string_lossy().into_owned()
        };
        if let Ok(access) = restore(app, &key) {
            if access.path.is_dir() {
                return Ok(Some(access));
            }
        }
        use tauri::Manager;
        let hint = if configured.as_os_str().is_empty() {
            app.path().download_dir().ok()
        } else {
            Some(configured.to_path_buf())
        };
        let Some(path) = select(
            app,
            hint.as_deref().and_then(Path::to_str),
            Some(true),
            title,
        )?
        else {
            return Ok(None);
        };
        let access = restore(app, &path)?;
        remember(app, &key, &access.url)?;
        Ok(Some(access))
    }
}

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Runtime};
use windows_sys::Win32::{
    Foundation::{CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, WAIT_OBJECT_0},
    System::Threading::{
        CreateEventW, CreateMutexW, INFINITE, OpenMutexW, SYNCHRONIZATION_SYNCHRONIZE, SetEvent,
        WaitForSingleObject,
    },
};

static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub enum Claim {
    Primary(PortableInstanceGuard),
    Secondary,
}

pub struct PortableInstanceGuard {
    event: isize,
    mutex: isize,
    shutdown: Arc<AtomicBool>,
    listener: Mutex<Option<std::thread::JoinHandle<()>>>,
    request_dir: PathBuf,
    generation: String,
}

#[derive(Deserialize, Serialize)]
struct ActivationRequest {
    generation: String,
    args: Vec<String>,
    cwd: PathBuf,
}

// Windows kernel object handles may be waited and closed from different
// threads. The guard owns both handles and closes them exactly once.
unsafe impl Send for PortableInstanceGuard {}
unsafe impl Sync for PortableInstanceGuard {}

impl PortableInstanceGuard {
    pub fn start_activation_listener<R, F>(&self, app: AppHandle<R>, activate: F)
    where
        R: Runtime,
        F: Fn(&AppHandle<R>, Vec<String>, PathBuf) + Send + Sync + 'static,
    {
        let event = self.event;
        let shutdown = self.shutdown.clone();
        let request_dir = self.request_dir.clone();
        let generation = self.generation.clone();
        let activate = Arc::new(activate);
        let listener = std::thread::spawn(move || {
            loop {
                if unsafe { WaitForSingleObject(event as _, INFINITE) } != WAIT_OBJECT_0 {
                    break;
                }
                if shutdown.load(Ordering::Acquire) {
                    break;
                }
                let requests = take_activation_requests(&request_dir, &generation);
                let callback_app = app.clone();
                let callback = activate.clone();
                let _ = app.run_on_main_thread(move || {
                    if requests.is_empty() {
                        callback(&callback_app, Vec::new(), PathBuf::new());
                        return;
                    }
                    for request in requests {
                        callback(&callback_app, request.args, request.cwd);
                    }
                });
            }
        });
        if let Ok(mut active_listener) = self.listener.lock() {
            *active_listener = Some(listener);
        }
    }
}

impl Drop for PortableInstanceGuard {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        unsafe {
            SetEvent(self.event as _);
        }
        if let Ok(listener) = self.listener.get_mut()
            && let Some(listener) = listener.take()
        {
            let _ = listener.join();
        }
        unsafe {
            CloseHandle(self.event as _);
            CloseHandle(self.mutex as _);
        }
        if std::fs::read_to_string(self.request_dir.join("generation"))
            .is_ok_and(|generation| generation == self.generation)
        {
            let _ = std::fs::remove_file(self.request_dir.join("generation"));
        }
        remove_request_files(&self.request_dir);
        let _ = std::fs::remove_dir(&self.request_dir);
    }
}

pub fn claim(data_root: &Path, args: &[String], cwd: &Path) -> Result<Claim, String> {
    let identity = data_root_identity(data_root)?;
    let event_name = encode_wide(format!("Local\\KKTerm-portable-{identity}-event"));
    let mutex_name = encode_wide(format!("Local\\KKTerm-portable-{identity}-mutex"));
    let request_dir = std::env::temp_dir()
        .join("kkterm-portable-instance")
        .join(&identity);
    std::fs::create_dir_all(&request_dir).map_err(|error| {
        format!(
            "failed to create portable activation directory {}: {error}",
            request_dir.display()
        )
    })?;

    // Only clear a crashed generation when no primary owns the identity. This
    // avoids a third launcher deleting a live request while the primary drains.
    let existing_mutex =
        unsafe { OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, 0, mutex_name.as_ptr()) };
    if !existing_mutex.is_null() {
        unsafe { CloseHandle(existing_mutex) };
    } else {
        let _ = std::fs::remove_file(request_dir.join("generation"));
        remove_request_files(&request_dir);
    }

    // Create the auto-reset event before the mutex. If two processes race, a
    // signal from the loser remains pending until the winner starts listening.
    let event = unsafe { CreateEventW(std::ptr::null(), 0, 0, event_name.as_ptr()) };
    if event.is_null() {
        return Err(format!(
            "failed to create portable activation event: {}",
            std::io::Error::last_os_error()
        ));
    }

    let mutex = unsafe { CreateMutexW(std::ptr::null(), 0, mutex_name.as_ptr()) };
    if mutex.is_null() {
        unsafe { CloseHandle(event) };
        return Err(format!(
            "failed to create portable instance mutex: {}",
            std::io::Error::last_os_error()
        ));
    }

    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        let request_result = wait_for_generation(&request_dir).and_then(|generation| {
            write_activation_request(
                &request_dir,
                ActivationRequest {
                    generation,
                    args: args.to_vec(),
                    cwd: cwd.to_path_buf(),
                },
            )
        });
        if let Err(error) = request_result {
            unsafe {
                CloseHandle(event);
                CloseHandle(mutex);
            }
            return Err(error);
        }
        let signaled = unsafe { SetEvent(event) } != 0;
        unsafe {
            CloseHandle(event);
            CloseHandle(mutex);
        }
        if !signaled {
            return Err(format!(
                "failed to activate the running portable instance: {}",
                std::io::Error::last_os_error()
            ));
        }
        return Ok(Claim::Secondary);
    }

    let generation = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    if let Err(error) = std::fs::write(request_dir.join("generation"), &generation) {
        unsafe {
            CloseHandle(event);
            CloseHandle(mutex);
        }
        return Err(format!(
            "failed to publish portable instance generation in {}: {error}",
            request_dir.display()
        ));
    }

    Ok(Claim::Primary(PortableInstanceGuard {
        event: event as isize,
        mutex: mutex as isize,
        shutdown: Arc::new(AtomicBool::new(false)),
        listener: Mutex::new(None),
        request_dir,
        generation,
    }))
}

fn wait_for_generation(request_dir: &Path) -> Result<String, String> {
    for _ in 0..40 {
        if let Ok(generation) = std::fs::read_to_string(request_dir.join("generation"))
            && !generation.is_empty()
        {
            return Ok(generation);
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Err("the running portable instance did not publish its activation channel".to_string())
}

fn write_activation_request(
    request_dir: &Path,
    request: ActivationRequest,
) -> Result<(), String> {
    let sequence = REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let stem = format!("request-{}-{sequence}", std::process::id());
    let temporary_path = request_dir.join(format!("{stem}.tmp"));
    let request_path = request_dir.join(format!("{stem}.json"));
    let bytes = serde_json::to_vec(&request)
        .map_err(|error| format!("failed to encode portable activation request: {error}"))?;
    std::fs::write(&temporary_path, bytes).map_err(|error| {
        format!(
            "failed to write portable activation request {}: {error}",
            temporary_path.display()
        )
    })?;
    std::fs::rename(&temporary_path, &request_path).map_err(|error| {
        format!(
            "failed to publish portable activation request {}: {error}",
            request_path.display()
        )
    })
}

fn take_activation_requests(request_dir: &Path, generation: &str) -> Vec<ActivationRequest> {
    let mut paths = std::fs::read_dir(request_dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().is_some_and(|extension| extension == "json")
                && path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("request-"))
        })
        .collect::<Vec<_>>();
    paths.sort();

    paths
        .into_iter()
        .filter_map(|path| {
            let request = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<ActivationRequest>(&bytes).ok());
            let _ = std::fs::remove_file(path);
            request.filter(|request| request.generation == generation)
        })
        .collect()
}

fn remove_request_files(request_dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(request_dir) {
        for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
            if path.file_name().is_some_and(|name| {
                let name = name.to_string_lossy();
                name.starts_with("request-")
                    && (name.ends_with(".json") || name.ends_with(".tmp"))
            }) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

fn data_root_identity(data_root: &Path) -> Result<String, String> {
    let canonical = std::fs::canonicalize(data_root).map_err(|error| {
        format!(
            "failed to resolve portable data directory identity {}: {error}",
            data_root.display()
        )
    })?;
    let normalized = canonical.to_string_lossy().to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    Ok(digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn encode_wide(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value
        .as_ref()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_identity_is_stable_for_the_same_data_root() {
        let root = tempfile::tempdir().expect("portable root");
        let first = data_root_identity(root.path()).expect("first identity");
        let second = data_root_identity(root.path()).expect("second identity");

        assert_eq!(first, second);
        assert_eq!(first.len(), 16);
    }

    #[test]
    fn portable_identity_differs_between_data_roots() {
        let first_root = tempfile::tempdir().expect("first portable root");
        let second_root = tempfile::tempdir().expect("second portable root");

        assert_ne!(
            data_root_identity(first_root.path()).expect("first identity"),
            data_root_identity(second_root.path()).expect("second identity")
        );
    }

    #[test]
    fn second_claim_for_the_same_root_is_secondary_until_primary_drops() {
        let root = tempfile::tempdir().expect("portable root");
        let args = vec!["kkterm.exe".to_string()];
        let primary = match claim(root.path(), &args, root.path()).expect("primary claim") {
            Claim::Primary(guard) => guard,
            Claim::Secondary => panic!("first claim should be primary"),
        };

        assert!(matches!(
            claim(root.path(), &args, root.path()).expect("secondary claim"),
            Claim::Secondary
        ));
        drop(primary);
        assert!(matches!(
            claim(root.path(), &args, root.path()).expect("replacement primary claim"),
            Claim::Primary(_)
        ));
    }

    #[test]
    fn portable_activation_requests_round_trip_for_the_current_generation() {
        let request_dir = tempfile::tempdir().expect("request dir");
        write_activation_request(
            request_dir.path(),
            ActivationRequest {
                generation: "generation-a".to_string(),
                args: vec!["kkterm.exe".to_string(), "notes.txt".to_string()],
                cwd: PathBuf::from(r"C:\work"),
            },
        )
        .expect("write activation request");

        let requests = take_activation_requests(request_dir.path(), "generation-a");

        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].args[1], "notes.txt");
        assert_eq!(requests[0].cwd, PathBuf::from(r"C:\work"));
    }
}

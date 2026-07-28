#[cfg(target_os = "windows")]
use crate::windows_local_pty;
use crate::{secrets, serial, ssh, storage, telnet, x_server};
use encoding_rs::{Encoding, UTF_8};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    ffi::OsString,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    net::{IpAddr, TcpListener as StdTcpListener},
    path::{Path, PathBuf},
    process::Command as ProcessCommand,
    sync::{Arc, Mutex, RwLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use zip::{ZipWriter, write::SimpleFileOptions};

pub struct SessionManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    recordings: TerminalRecordingManager,
    ssh_context_cache: Mutex<HashMap<String, Result<String, String>>>,
    os_detect_cache: Mutex<HashMap<String, DetectedRemoteOs>>,
    ssh_port_forwards: Mutex<HashMap<String, SshPortForwardSession>>,
}

struct TerminalSession {
    transport: TerminalTransport,
    encoding: TerminalEncodingState,
}

struct SshPortForwardSession {
    forward_id: String,
    session_id: String,
    handle: ssh::NativeSshPortForwardHandle,
    mode: String,
    bind: String,
    bind_ip: Option<IpAddr>,
    local_port: u16,
}

impl Drop for SshPortForwardSession {
    fn drop(&mut self) {
        self.handle.stop(self.forward_id.clone());
    }
}

enum TerminalTransport {
    Pty {
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        child: Box<dyn Child + Send + Sync>,
    },
    NativeSsh(ssh::NativeSshTerminal),
    NativeTelnet(telnet::NativeTelnetTerminal),
    NativeSerial(serial::NativeSerialTerminal),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTerminalSessionRequest {
    pub session_id: Option<String>,
    pub title: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    pub host: String,
    pub user: String,
    pub port: Option<u16>,
    pub key_path: Option<String>,
    pub proxy_jump: Option<String>,
    pub ssh_socks_proxy: Option<String>,
    pub ssh_socks_proxy_username: Option<String>,
    pub ssh_socks_proxy_secret_owner_id: Option<String>,
    #[serde(default)]
    pub ssh_compression: Option<bool>,
    #[serde(default)]
    pub ssh_old_protocols: Option<bool>,
    pub auth_method: Option<String>,
    pub secret_owner_id: Option<String>,
    pub passphrase_owner_id: Option<String>,
    pub shell: Option<String>,
    pub serial_line: Option<String>,
    pub serial_speed: Option<u32>,
    pub initial_directory: Option<String>,
    #[serde(default)]
    pub environment_variables: Vec<ManagedTerminalEnvironmentVariable>,
    pub cols: Option<u16>,
    pub pixel_height: Option<u16>,
    pub pixel_width: Option<u16>,
    pub rows: Option<u16>,
    pub use_tmux: Option<bool>,
    pub tmux_session_id: Option<String>,
    pub use_psmux: Option<bool>,
    pub psmux_session_id: Option<String>,
    pub ssh_buffer_lines: Option<u32>,
    #[serde(default = "default_terminal_encoding")]
    pub text_encoding: String,
}

fn default_terminal_encoding() -> String {
    "utf-8".to_string()
}

#[derive(Clone)]
pub(crate) struct TerminalEncodingState(Arc<RwLock<String>>);

impl TerminalEncodingState {
    pub(crate) fn new(label: &str) -> Result<Self, String> {
        let normalized = terminal_encoding(label)?;
        Ok(Self(Arc::new(RwLock::new(
            normalized.name().to_ascii_lowercase(),
        ))))
    }
    fn label(&self) -> String {
        self.0
            .read()
            .map(|value| value.clone())
            .unwrap_or_else(|_| "utf-8".to_string())
    }
    fn set(&self, label: &str) -> Result<(), String> {
        let normalized = terminal_encoding(label)?.name().to_ascii_lowercase();
        *self
            .0
            .write()
            .map_err(|_| "terminal encoding lock is poisoned".to_string())? = normalized;
        Ok(())
    }
}

fn terminal_encoding(label: &str) -> Result<&'static Encoding, String> {
    Encoding::for_label(label.trim().as_bytes())
        .filter(|encoding| !matches!(encoding.name(), "UTF-16LE" | "UTF-16BE" | "replacement"))
        .ok_or_else(|| format!("unsupported terminal text encoding: {label}"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedTerminalEnvironmentVariable {
    pub name: String,
    pub value: String,
    pub source: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxConnectionRequest {
    pub host: String,
    pub user: String,
    pub port: Option<u16>,
    pub key_path: Option<String>,
    pub proxy_jump: Option<String>,
    pub ssh_socks_proxy: Option<String>,
    pub ssh_socks_proxy_username: Option<String>,
    pub ssh_socks_proxy_secret_owner_id: Option<String>,
    pub auth_method: Option<String>,
    pub secret_owner_id: Option<String>,
    pub passphrase_owner_id: Option<String>,
    pub ssh_compression: Option<bool>,
    #[serde(default)]
    pub ssh_old_protocols: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTmuxSessionRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub tmux_session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTmuxSessionRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub tmux_session_id: String,
    pub new_tmux_session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureTmuxPaneRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub tmux_session_id: String,
    pub buffer_lines: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxCurrentPathRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub tmux_session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTmuxSessionMouseRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub tmux_session_id: String,
    pub enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollTmuxPaneRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub tmux_session_id: String,
    pub lines: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSshPortForwardRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub session_id: Option<String>,
    pub forward_id: Option<String>,
    pub mode: Option<String>,
    pub bind: Option<String>,
    pub listen_port: Option<u16>,
    pub dest_host: Option<String>,
    pub dest_port: Option<u16>,
    pub remote_port: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseSshPortForwardRequest {
    pub forward_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLoopbackPort {
    pub port: u16,
    pub address: String,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTcpListener {
    pub address: String,
    pub port: u16,
}

/// Raw remote-OS facts gathered on first SSH connect for icon auto-detection.
/// The frontend maps these to a bundled distro/OS logo.
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedRemoteOs {
    pub id: Option<String>,
    pub id_like: Option<String>,
    pub kernel: Option<String>,
    pub model: Option<String>,
    pub app: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPortForwardStarted {
    pub forward_id: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub dest_host: String,
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSession {
    pub id: String,
    pub attached: bool,
    pub windows: u32,
    pub created: Option<u64>,
    pub last_attached: Option<u64>,
    pub path: Option<String>,
    pub internal_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchElevatedTerminalRequest {
    pub shell: String,
    pub initial_directory: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionStarted {
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    terminal_ready_ms: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    x11_forwarding_status: Option<ssh::NativeSshX11ForwardingStatus>,
}

impl TerminalSessionStarted {
    pub fn terminal_ready_ms(&self) -> Option<u128> {
        self.terminal_ready_ms
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub(crate) session_id: String,
    pub(crate) data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionEnded {
    pub(crate) session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTerminalRecordingRequest {
    pub session_id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub initial_buffer: String,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTerminalRecordingsRequest {
    pub connection_id: String,
    pub connection_name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRecordingInfo {
    pub session_id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub started_at_millis: u128,
    pub path: PathBuf,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRecordingEntry {
    pub file_name: String,
    pub path: PathBuf,
    pub size_bytes: u64,
    pub modified_at_millis: Option<u128>,
    pub started_at_millis: Option<u128>,
    pub duration_millis: Option<u128>,
    pub connection_id_fragment: String,
    pub connection_folder_label: String,
    pub ai_summary: Option<String>,
    pub ai_summary_preview: Option<String>,
    pub ai_summary_model: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRecordingSummaryInput {
    pub sample: String,
    pub preview: String,
    pub total_lines: usize,
    pub sampled_lines: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTerminalRecordingSummaryRequest {
    pub path: String,
    pub summary: String,
    pub preview: String,
    pub provider_kind: String,
    pub model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTerminalRecordingsRequest {
    pub paths: Vec<String>,
    pub destination: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTerminalRecordingsResult {
    pub destination: PathBuf,
    pub count: usize,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalRecordingSummaryCache {
    version: u8,
    size_bytes: u64,
    modified_at_millis: Option<u128>,
    summary: String,
    preview: String,
    provider_kind: String,
    model: String,
    generated_at_millis: u128,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputRequest {
    session_id: String,
    data: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeTerminalRequest {
    session_id: String,
    cols: u16,
    pixel_height: Option<u16>,
    pixel_width: Option<u16>,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTerminalEncodingRequest {
    session_id: String,
    encoding: String,
}

struct ActiveTerminalRecording {
    info: TerminalRecordingInfo,
    file: File,
    // Live output carries VT escape sequences (ConPTY repaints especially);
    // render them to plain text so the saved .txt stays human-readable.
    renderer: crate::vt_text::VtTextRenderer,
}

pub struct TerminalRecordingManager {
    #[cfg(test)]
    root: Option<PathBuf>,
    active: Mutex<HashMap<String, ActiveTerminalRecording>>,
}

impl TerminalRecordingManager {
    fn new() -> Self {
        Self {
            #[cfg(test)]
            root: None,
            active: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    fn new_for_root(root: PathBuf) -> Self {
        Self {
            root: Some(root),
            active: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    fn root(&self) -> Result<PathBuf, String> {
        self.root
            .clone()
            .ok_or_else(|| "terminal recordings root is not configured".to_string())
    }

    fn start_recording_at(
        &self,
        root: PathBuf,
        request: StartTerminalRecordingRequest,
    ) -> Result<TerminalRecordingInfo, String> {
        self.start_recording_with_root(root, request)
    }

    #[cfg(test)]
    fn start_recording(
        &self,
        request: StartTerminalRecordingRequest,
    ) -> Result<TerminalRecordingInfo, String> {
        self.start_recording_with_root(self.root()?, request)
    }

    fn start_recording_with_root(
        &self,
        root: PathBuf,
        request: StartTerminalRecordingRequest,
    ) -> Result<TerminalRecordingInfo, String> {
        let session_id = required_recording_part("session id", &request.session_id)?;
        let connection_id = required_recording_part("connection id", &request.connection_id)?;
        let mut active = self
            .active
            .lock()
            .map_err(|_| "terminal recording lock is poisoned".to_string())?;
        if active.contains_key(&session_id) {
            return Err("terminal recording is already active".to_string());
        }
        let connection_name = request.connection_name.trim().to_string();
        let started_at_millis = current_unix_millis();
        let folder = self.connection_folder_at(root, &connection_id, &connection_name)?;
        fs::create_dir_all(&folder).map_err(|error| {
            format!(
                "failed to create terminal recordings folder {}: {error}",
                folder.display()
            )
        })?;
        let file_name = format!(
            "{}--{}.txt",
            recording_timestamp_file_part(started_at_millis),
            recording_id_fragment(&session_id, 12)
        );
        let path = folder.join(file_name);
        let mut file = File::options()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| {
                format!(
                    "failed to create terminal recording {}: {error}",
                    path.display()
                )
            })?;
        if !request.initial_buffer.is_empty() {
            file.write_all(request.initial_buffer.as_bytes())
                .map_err(|error| format!("failed to write terminal recording prelude: {error}"))?;
            if !request.initial_buffer.ends_with('\n') {
                file.write_all(b"\n").map_err(|error| {
                    format!("failed to write terminal recording separator: {error}")
                })?;
            }
        }
        file.flush().map_err(|error| {
            format!(
                "failed to flush terminal recording {}: {error}",
                path.display()
            )
        })?;

        let info = TerminalRecordingInfo {
            session_id: session_id.clone(),
            connection_id,
            connection_name,
            started_at_millis,
            path,
        };
        active.insert(
            session_id,
            ActiveTerminalRecording {
                info: info.clone(),
                file,
                renderer: crate::vt_text::VtTextRenderer::new(
                    request.rows.unwrap_or(24),
                    request.cols.unwrap_or(80),
                ),
            },
        );
        Ok(info)
    }

    fn stop_recording(&self, session_id: String) -> Result<Option<TerminalRecordingInfo>, String> {
        let recording = self
            .active
            .lock()
            .map_err(|_| "terminal recording lock is poisoned".to_string())?
            .remove(&session_id);
        if let Some(mut recording) = recording {
            let tail = recording.renderer.finish();
            if !tail.is_empty() {
                recording.file.write_all(tail.as_bytes()).map_err(|error| {
                    format!(
                        "failed to write terminal recording {}: {error}",
                        recording.info.path.display()
                    )
                })?;
            }
            recording.file.flush().map_err(|error| {
                format!(
                    "failed to flush terminal recording {}: {error}",
                    recording.info.path.display()
                )
            })?;
            Ok(Some(recording.info))
        } else {
            Ok(None)
        }
    }

    fn record_output(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "terminal recording lock is poisoned".to_string())?;
        let Some(recording) = active.get_mut(session_id) else {
            return Ok(());
        };
        let rendered = recording.renderer.feed(data);
        if rendered.is_empty() {
            return Ok(());
        }
        recording
            .file
            .write_all(rendered.as_bytes())
            .map_err(|error| format!("failed to write terminal recording: {error}"))?;
        recording
            .file
            .flush()
            .map_err(|error| format!("failed to flush terminal recording: {error}"))
    }

    fn resize(&self, session_id: &str, rows: u16, cols: u16) {
        let Ok(mut active) = self.active.lock() else {
            return;
        };
        if let Some(recording) = active.get_mut(session_id) {
            recording.renderer.resize(rows, cols);
        }
    }

    fn list_recordings_at(
        &self,
        root: PathBuf,
        request: ListTerminalRecordingsRequest,
    ) -> Result<Vec<TerminalRecordingEntry>, String> {
        let mut recordings = Vec::new();
        for folder in self.connection_recording_folders(
            root,
            &request.connection_id,
            &request.connection_name,
        )? {
            let entries = match fs::read_dir(&folder) {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(format!(
                        "failed to read terminal recordings folder {}: {error}",
                        folder.display()
                    ));
                }
            };
            recordings.extend(
                entries
                    .filter_map(Result::ok)
                    .filter_map(|entry| terminal_recording_entry(entry.path()).ok()),
            );
        }
        recordings.sort_by(|left, right| right.file_name.cmp(&left.file_name));
        Ok(recordings)
    }

    fn connection_recording_folders(
        &self,
        root: PathBuf,
        connection_id: &str,
        connection_name: &str,
    ) -> Result<Vec<PathBuf>, String> {
        let current = self.connection_folder_at(root.clone(), connection_id, connection_name)?;
        let id_fragment = recording_connection_id_fragment(connection_id);
        let mut folders = vec![current.clone()];
        let groups = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(folders),
            Err(error) => {
                return Err(format!(
                    "failed to read terminal recordings root {}: {error}",
                    root.display()
                ));
            }
        };
        for group in groups
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
        {
            let children = match fs::read_dir(group.path()) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for child in children
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_dir())
            {
                let path = child.path();
                let name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("");
                if name.ends_with(&format!("--{id_fragment}")) && !folders.contains(&path) {
                    folders.push(path);
                }
            }
        }
        Ok(folders)
    }

    fn connection_folder_at(
        &self,
        root: PathBuf,
        connection_id: &str,
        connection_name: &str,
    ) -> Result<PathBuf, String> {
        let name = recording_slug(connection_name);
        Ok(root
            .join(&name)
            .join(recording_folder_name(connection_id, connection_name)))
    }
}

fn terminal_recording_entry(path: PathBuf) -> Result<TerminalRecordingEntry, String> {
    if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("txt") {
        return Err("not a terminal recording".to_string());
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("failed to read terminal recording metadata: {error}"))?;
    let modified_at_millis = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis());
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("recording.txt")
        .to_string();
    let started_at_millis = recording_started_at_millis(&file_name);
    let duration_millis = started_at_millis
        .zip(modified_at_millis)
        .map(|(started, modified)| modified.saturating_sub(started));
    let folder_name = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .unwrap_or("connection");
    let (connection_folder_label, connection_id_fragment) = folder_name
        .rsplit_once("--")
        .map(|(label, id)| (label.to_string(), id.to_string()))
        .unwrap_or_else(|| (folder_name.to_string(), String::new()));
    let cached_summary = read_terminal_recording_summary_cache(
        &path,
        metadata.len(),
        modified_at_millis,
    );
    Ok(TerminalRecordingEntry {
        file_name,
        path,
        size_bytes: metadata.len(),
        modified_at_millis,
        started_at_millis,
        duration_millis,
        connection_id_fragment,
        connection_folder_label,
        ai_summary: cached_summary.as_ref().map(|cache| cache.summary.clone()),
        ai_summary_preview: cached_summary.as_ref().map(|cache| cache.preview.clone()),
        ai_summary_model: cached_summary.map(|cache| cache.model),
    })
}

fn recording_started_at_millis(file_name: &str) -> Option<u128> {
    let stamp = file_name.get(..19)?;
    let year = stamp.get(0..4)?.parse::<i32>().ok()?;
    let month = stamp.get(4..6)?.parse::<u8>().ok()?;
    let day = stamp.get(6..8)?.parse::<u8>().ok()?;
    if stamp.get(8..9)? != "-" || stamp.get(15..16)? != "-" {
        return None;
    }
    let hour = stamp.get(9..11)?.parse::<u8>().ok()?;
    let minute = stamp.get(11..13)?.parse::<u8>().ok()?;
    let second = stamp.get(13..15)?.parse::<u8>().ok()?;
    let millisecond = stamp.get(16..19)?.parse::<u16>().ok()?;
    let month = time::Month::try_from(month).ok()?;
    let date = time::Date::from_calendar_date(year, month, day).ok()?;
    let time = time::Time::from_hms_milli(hour, minute, second, millisecond).ok()?;
    let offset = time::UtcOffset::current_local_offset().unwrap_or(time::UtcOffset::UTC);
    let millis = time::PrimitiveDateTime::new(date, time)
        .assume_offset(offset)
        .unix_timestamp_nanos()
        / 1_000_000;
    (millis >= 0).then_some(millis as u128)
}

fn terminal_recording_summary_cache_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("recording.txt");
    path.with_file_name(format!("{file_name}.kkterm-summary.json"))
}

fn read_terminal_recording_summary_cache(
    path: &Path,
    size_bytes: u64,
    modified_at_millis: Option<u128>,
) -> Option<TerminalRecordingSummaryCache> {
    let bytes = fs::read(terminal_recording_summary_cache_path(path)).ok()?;
    let cache = serde_json::from_slice::<TerminalRecordingSummaryCache>(&bytes).ok()?;
    (cache.version == 1
        && cache.size_bytes == size_bytes
        && cache.modified_at_millis == modified_at_millis
        && !cache.summary.trim().is_empty())
    .then_some(cache)
}

fn validate_terminal_recording_path(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve terminal recordings root: {error}"))?;
    let path = PathBuf::from(requested)
        .canonicalize()
        .map_err(|error| format!("failed to resolve terminal recording {requested}: {error}"))?;
    if !path.starts_with(&canonical_root) {
        return Err("terminal recording path must stay inside the recordings folder".to_string());
    }
    if path.extension().and_then(|value| value.to_str()) != Some("txt") || !path.is_file() {
        return Err("terminal recording must be a text file".to_string());
    }
    Ok(path)
}

pub(crate) fn list_all_terminal_recordings(
    root: PathBuf,
) -> Result<Vec<TerminalRecordingEntry>, String> {
    let mut recordings = Vec::new();
    let groups = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(recordings),
        Err(error) => {
            return Err(format!(
                "failed to read terminal recordings root {}: {error}",
                root.display()
            ));
        }
    };
    for group in groups
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
    {
        let folders = match fs::read_dir(group.path()) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for folder in folders
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
        {
            let entries = match fs::read_dir(folder.path()) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            recordings.extend(
                entries
                    .filter_map(Result::ok)
                    .filter_map(|entry| terminal_recording_entry(entry.path()).ok()),
            );
        }
    }
    recordings.sort_by(|left, right| {
        right
            .started_at_millis
            .or(right.modified_at_millis)
            .cmp(&left.started_at_millis.or(left.modified_at_millis))
            .then_with(|| right.file_name.cmp(&left.file_name))
    });
    Ok(recordings)
}

pub(crate) fn search_terminal_recordings(
    root: PathBuf,
    query: &str,
) -> Result<Vec<PathBuf>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    if query.contains(['\r', '\n']) {
        return Err("terminal recording search must stay on one line".to_string());
    }
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut ripgrep = ProcessCommand::new("rg");
    ripgrep.args([
        "--files-with-matches",
        "--ignore-case",
        "--fixed-strings",
        "--no-messages",
        "--color",
        "never",
        "--glob",
        "*.txt",
        "--",
        query,
    ]);
    ripgrep.arg(&root);
    hide_console_window(&mut ripgrep);
    if let Ok(output) = ripgrep.output()
        && (output.status.success() || output.status.code() == Some(1))
    {
        return recording_search_paths_from_output(&root, &output.stdout);
    }

    let mut fallback = if cfg!(windows) {
        let mut command = ProcessCommand::new("findstr");
        command.args(["/S", "/I", "/L", "/M", &format!("/C:{query}")]);
        command.arg(root.join("*.txt"));
        command
    } else {
        let mut command = ProcessCommand::new("grep");
        command.args(["-RIlF", "--include=*.txt", "--", query]);
        command.arg(&root);
        command
    };
    hide_console_window(&mut fallback);
    if let Ok(output) = fallback.output()
        && (output.status.success() || output.status.code() == Some(1))
    {
        return recording_search_paths_from_output(&root, &output.stdout);
    }

    // Last-resort correctness path for unusually minimal systems where neither
    // ripgrep nor the platform search command is available.
    native_terminal_recording_search(&root, query)
}

fn recording_search_paths_from_output(root: &Path, stdout: &[u8]) -> Result<Vec<PathBuf>, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve terminal recordings root: {error}"))?;
    let mut paths = Vec::new();
    for line in String::from_utf8_lossy(stdout).lines() {
        let candidate = PathBuf::from(line.trim());
        let candidate = if candidate.is_absolute() {
            candidate
        } else {
            root.join(candidate)
        };
        let Ok(candidate) = candidate.canonicalize() else {
            continue;
        };
        if candidate.starts_with(&canonical_root)
            && candidate.extension().and_then(|value| value.to_str()) == Some("txt")
            && !paths.contains(&candidate)
        {
            paths.push(candidate);
        }
    }
    Ok(paths)
}

fn native_terminal_recording_search(root: &Path, query: &str) -> Result<Vec<PathBuf>, String> {
    let needle = query.to_lowercase();
    let mut matches = Vec::new();
    for recording in list_all_terminal_recordings(root.to_path_buf())? {
        let mut file = match File::open(&recording.path) {
            Ok(file) => file,
            Err(_) => continue,
        };
        let mut text = String::new();
        if file.read_to_string(&mut text).is_ok() && text.to_lowercase().contains(&needle) {
            matches.push(recording.path);
        }
    }
    Ok(matches)
}

pub(crate) fn prepare_terminal_recording_summary(
    root: PathBuf,
    requested: &str,
) -> Result<TerminalRecordingSummaryInput, String> {
    const FIRST_LIMIT: usize = 24;
    const LAST_LIMIT: usize = 64;
    const SALIENT_LIMIT: usize = 96;
    const PERIODIC_LIMIT: usize = 48;
    const SAMPLE_BYTES_LIMIT: usize = 24 * 1024;

    let path = validate_terminal_recording_path(&root, requested)?;
    let file = File::open(&path)
        .map_err(|error| format!("failed to open terminal recording {}: {error}", path.display()))?;
    let mut first = Vec::new();
    let mut last = VecDeque::with_capacity(LAST_LIMIT);
    let mut salient = Vec::new();
    let mut periodic = Vec::new();
    let mut preview = String::new();
    let mut total_lines = 0usize;
    let mut bytes = Vec::new();
    let mut reader = BufReader::new(file);
    while reader
        .read_until(b'\n', &mut bytes)
        .map_err(|error| format!("failed to read terminal recording: {error}"))?
        > 0
    {
        total_lines += 1;
        let line = clean_terminal_recording_line(&String::from_utf8_lossy(&bytes));
        bytes.clear();
        if line.is_empty() {
            continue;
        }
        let numbered = (total_lines, line.clone());
        if first.len() < FIRST_LIMIT {
            first.push(numbered.clone());
        }
        if last.len() == LAST_LIMIT {
            last.pop_front();
        }
        last.push_back(numbered.clone());
        if salient.len() < SALIENT_LIMIT && terminal_recording_line_is_salient(&line) {
            salient.push(numbered.clone());
        }
        if periodic.len() < PERIODIC_LIMIT && total_lines % 200 == 0 {
            periodic.push(numbered);
        }
        if preview.is_empty() && terminal_recording_line_looks_like_command(&line) {
            preview = truncate_recording_line(&line, 180);
        }
    }

    if preview.is_empty() {
        preview = first
            .first()
            .map(|(_, line)| truncate_recording_line(line, 180))
            .unwrap_or_default();
    }

    let sections = [
        ("BEGINNING", first),
        ("COMMANDS AND IMPORTANT OUTPUT", salient),
        ("PERIODIC SAMPLES", periodic),
        ("ENDING", last.into_iter().collect()),
    ];
    let mut sample = String::new();
    let mut sampled_lines = 0usize;
    let mut seen = std::collections::HashSet::new();
    'sections: for (label, lines) in sections {
        let mut section_started = false;
        for (line_number, line) in lines {
            if !seen.insert(line_number) {
                continue;
            }
            let rendered = format!("{line_number}: {line}\n");
            let header = if section_started {
                String::new()
            } else {
                format!("\n[{label}]\n")
            };
            if sample.len() + header.len() + rendered.len() > SAMPLE_BYTES_LIMIT {
                break 'sections;
            }
            sample.push_str(&header);
            sample.push_str(&rendered);
            sampled_lines += 1;
            section_started = true;
        }
    }
    if sample.is_empty() {
        sample.push_str("[EMPTY RECORDING]\n");
    }
    Ok(TerminalRecordingSummaryInput {
        sample,
        preview,
        total_lines,
        sampled_lines,
    })
}

fn clean_terminal_recording_line(line: &str) -> String {
    let mut clean = String::with_capacity(line.len().min(520));
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    for next in chars.by_ref() {
                        if ('@'..='~').contains(&next) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    let mut previous_escape = false;
                    for next in chars.by_ref() {
                        if next == '\u{7}' || (previous_escape && next == '\\') {
                            break;
                        }
                        previous_escape = next == '\u{1b}';
                    }
                }
                _ => {}
            }
            continue;
        }
        if character == '\t' || !character.is_control() {
            clean.push(character);
        }
        if clean.chars().count() >= 500 {
            clean.push('…');
            break;
        }
    }
    clean.trim().to_string()
}

fn terminal_recording_line_looks_like_command(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("$ ")
        || trimmed.starts_with("# ")
        || trimmed.starts_with("> ")
        || trimmed.starts_with("% ")
        || trimmed
            .get(..3)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("PS "))
}

fn terminal_recording_line_is_salient(line: &str) -> bool {
    if terminal_recording_line_looks_like_command(line) {
        return true;
    }
    let lower = line.to_lowercase();
    [
        "error", "failed", "failure", "warning", "fatal", "panic", "exception",
        "traceback", "denied", "timeout", "timed out", "not found", "unhealthy",
        "restarted", "completed", "success", "changed", "created", "deleted",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn truncate_recording_line(line: &str, max_chars: usize) -> String {
    let mut value = line.chars().take(max_chars).collect::<String>();
    if line.chars().count() > max_chars {
        value.push('…');
    }
    value
}

pub(crate) fn save_terminal_recording_summary(
    root: PathBuf,
    request: SaveTerminalRecordingSummaryRequest,
) -> Result<(), String> {
    let path = validate_terminal_recording_path(&root, &request.path)?;
    let summary = request.summary.trim();
    if summary.is_empty() {
        return Err("terminal recording summary cannot be empty".to_string());
    }
    if summary.chars().count() > 4_000 {
        return Err("terminal recording summary is too long".to_string());
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("failed to read terminal recording metadata: {error}"))?;
    let modified_at_millis = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis());
    let cache = TerminalRecordingSummaryCache {
        version: 1,
        size_bytes: metadata.len(),
        modified_at_millis,
        summary: summary.to_string(),
        preview: truncate_recording_line(request.preview.trim(), 240),
        provider_kind: truncate_recording_line(request.provider_kind.trim(), 80),
        model: truncate_recording_line(request.model.trim(), 160),
        generated_at_millis: current_unix_millis(),
    };
    let bytes = serde_json::to_vec_pretty(&cache)
        .map_err(|error| format!("failed to serialize terminal recording summary: {error}"))?;
    let destination = terminal_recording_summary_cache_path(&path);
    let temporary = destination.with_extension("json.tmp");
    fs::write(&temporary, bytes)
        .map_err(|error| format!("failed to write terminal recording summary: {error}"))?;
    fs::rename(&temporary, &destination)
        .or_else(|_| {
            let _ = fs::remove_file(&destination);
            fs::rename(&temporary, &destination)
        })
        .map_err(|error| format!("failed to finalize terminal recording summary: {error}"))
}

pub(crate) fn export_terminal_recordings(
    root: PathBuf,
    request: ExportTerminalRecordingsRequest,
) -> Result<ExportTerminalRecordingsResult, String> {
    if request.paths.is_empty() {
        return Err("select at least one terminal recording to export".to_string());
    }
    if request.paths.len() > 2_000 {
        return Err("too many terminal recordings selected for one export".to_string());
    }
    let destination = PathBuf::from(request.destination.trim());
    if destination.as_os_str().is_empty() {
        return Err("terminal recording export destination is required".to_string());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "terminal recording export destination has no parent folder".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create terminal recording export folder: {error}"))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve terminal recordings root: {error}"))?;
    let sources = request
        .paths
        .iter()
        .map(|path| validate_terminal_recording_path(&root, path))
        .collect::<Result<Vec<_>, _>>()?;
    let temporary = destination.with_extension("zip.part");
    let file = File::create(&temporary)
        .map_err(|error| format!("failed to create terminal recording archive: {error}"))?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut archive_names = HashSet::new();
    for source in &sources {
        source
            .strip_prefix(&canonical_root)
            .map_err(|_| "terminal recording path escaped the recordings root".to_string())?;
        let archive_name = unique_terminal_recording_archive_name(source, &mut archive_names)?;
        archive
            .start_file(archive_name, options)
            .map_err(|error| format!("failed to add terminal recording to archive: {error}"))?;
        let mut source_file = File::open(source)
            .map_err(|error| format!("failed to open terminal recording for export: {error}"))?;
        std::io::copy(&mut source_file, &mut archive)
            .map_err(|error| format!("failed to write terminal recording archive: {error}"))?;
    }
    archive
        .finish()
        .map_err(|error| format!("failed to finalize terminal recording archive: {error}"))?;
    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("failed to replace terminal recording archive: {error}"))?;
    }
    fs::rename(&temporary, &destination)
        .map_err(|error| format!("failed to save terminal recording archive: {error}"))?;
    Ok(ExportTerminalRecordingsResult {
        destination,
        count: sources.len(),
    })
}

fn unique_terminal_recording_archive_name(
    source: &Path,
    used_names: &mut HashSet<String>,
) -> Result<String, String> {
    let file_name = source
        .file_name()
        .ok_or_else(|| "terminal recording path has no file name".to_string())?
        .to_string_lossy()
        .chars()
        .map(|character| match character {
            '/' | '\\' => '_',
            other => other,
        })
        .collect::<String>();
    if used_names.insert(file_name.to_lowercase()) {
        return Ok(file_name);
    }

    let file_name_path = Path::new(&file_name);
    let stem = file_name_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("recording");
    let extension = file_name_path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty());
    for suffix in 2_u32.. {
        let candidate = match extension {
            Some(extension) => format!("{stem} ({suffix}).{extension}"),
            None => format!("{stem} ({suffix})"),
        };
        if used_names.insert(candidate.to_lowercase()) {
            return Ok(candidate);
        }
    }
    unreachable!("terminal recording archive suffix range is unbounded")
}

pub(crate) fn terminal_recordings_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::app_paths::data_dir(app)?.join("terminal-recordings"))
}

pub(crate) fn emit_terminal_output(app: &AppHandle, session_id: &str, data: String) {
    if let Some(manager) = app.try_state::<SessionManager>() {
        let _ = manager.record_terminal_output(session_id, &data);
    }
    if let Some(tracker) =
        app.try_state::<std::sync::Arc<crate::watchdog::SessionActivityTracker>>()
    {
        tracker.record(session_id, data.as_bytes());
    }
    let _ = app.emit(
        "terminal-output",
        TerminalOutput {
            session_id: session_id.to_string(),
            data,
        },
    );
}

pub(crate) fn emit_terminal_session_ended(app: &AppHandle, session_id: &str) {
    let _ = app.emit(
        "terminal-session-ended",
        TerminalSessionEnded {
            session_id: session_id.to_string(),
        },
    );
}

pub(crate) struct TerminalOutputDecoder {
    state: TerminalEncodingState,
    label: String,
    decoder: encoding_rs::Decoder,
}

impl Default for TerminalOutputDecoder {
    fn default() -> Self {
        Self::new(TerminalEncodingState::new("utf-8").expect("UTF-8 exists"))
    }
}

impl TerminalOutputDecoder {
    pub(crate) fn new(state: TerminalEncodingState) -> Self {
        let label = state.label();
        let decoder = terminal_encoding(&label).unwrap_or(UTF_8).new_decoder();
        Self {
            state,
            label,
            decoder,
        }
    }

    fn sync_encoding(&mut self) {
        let label = self.state.label();
        if label != self.label {
            self.label = label;
            self.decoder = terminal_encoding(&self.label)
                .unwrap_or(UTF_8)
                .new_decoder();
        }
    }

    pub(crate) fn decode(&mut self, bytes: &[u8]) -> Option<String> {
        self.sync_encoding();
        let mut output = String::with_capacity(bytes.len() * 3 + 8);
        let _ = self.decoder.decode_to_string(bytes, &mut output, false);
        (!output.is_empty()).then_some(output)
    }

    pub(crate) fn finish_lossy(&mut self) -> Option<String> {
        self.sync_encoding();
        let mut output = String::with_capacity(8);
        let _ = self.decoder.decode_to_string(b"", &mut output, true);
        (!output.is_empty()).then_some(output)
    }
}

fn required_recording_part(label: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("terminal recording {label} is required"))
    } else {
        Ok(trimmed.to_string())
    }
}

fn recording_folder_name(connection_id: &str, connection_name: &str) -> String {
    format!(
        "{}--{}",
        recording_slug(connection_name),
        recording_connection_id_fragment(connection_id)
    )
}

fn recording_connection_id_fragment(value: &str) -> String {
    let normalized = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect::<String>();
    if let Some(rest) = normalized.strip_prefix("conn-") {
        let suffix = rest.chars().take(8).collect::<String>();
        if !suffix.is_empty() {
            return format!("conn-{suffix}");
        }
    }
    recording_id_fragment(&normalized, 8)
}

fn recording_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;
    for character in value.trim().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "connection".to_string()
    } else {
        slug
    }
}

fn recording_id_fragment(value: &str, max_len: usize) -> String {
    let fragment = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(max_len)
        .collect::<String>();
    if fragment.is_empty() {
        "session".to_string()
    } else {
        fragment
    }
}

fn current_unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn recording_timestamp_file_part(millis: u128) -> String {
    let seconds = (millis / 1_000) as i64;
    let offset = time::UtcOffset::current_local_offset().unwrap_or(time::UtcOffset::UTC);
    let timestamp = time::OffsetDateTime::from_unix_timestamp(seconds)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH)
        .to_offset(offset);
    let timestamp = timestamp
        .format(&time::macros::format_description!(
            "[year][month][day]-[hour][minute][second]"
        ))
        .unwrap_or_else(|_| millis.to_string());
    format!("{timestamp}-{:03}", millis % 1_000)
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            recordings: TerminalRecordingManager::new(),
            ssh_context_cache: Mutex::new(HashMap::new()),
            os_detect_cache: Mutex::new(HashMap::new()),
            ssh_port_forwards: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_terminal_recording(
        &self,
        root: PathBuf,
        request: StartTerminalRecordingRequest,
    ) -> Result<TerminalRecordingInfo, String> {
        let session_id = required_recording_part("session id", &request.session_id)?;
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?;
        if !sessions.contains_key(&session_id) {
            return Err("terminal session is not active".to_string());
        }
        self.recordings.start_recording_at(root, request)
    }

    pub fn stop_terminal_recording(
        &self,
        session_id: String,
    ) -> Result<Option<TerminalRecordingInfo>, String> {
        self.recordings.stop_recording(session_id)
    }

    pub fn list_terminal_recordings(
        &self,
        root: PathBuf,
        request: ListTerminalRecordingsRequest,
    ) -> Result<Vec<TerminalRecordingEntry>, String> {
        self.recordings.list_recordings_at(root, request)
    }

    pub fn terminal_recordings_folder(
        &self,
        root: PathBuf,
        request: ListTerminalRecordingsRequest,
    ) -> Result<PathBuf, String> {
        self.recordings
            .connection_folder_at(root, &request.connection_id, &request.connection_name)
    }

    pub fn record_terminal_output(&self, session_id: &str, data: &str) -> Result<(), String> {
        self.recordings.record_output(session_id, data)
    }

    pub fn start_terminal_session(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        mut request: StartTerminalSessionRequest,
    ) -> Result<TerminalSessionStarted, String> {
        resolve_terminal_socks_proxy(secrets, &mut request)?;
        let session_id = request
            .session_id
            .clone()
            .unwrap_or_else(|| make_session_id(&request.title));
        let encoding = TerminalEncodingState::new(&request.text_encoding)?;
        #[cfg(target_os = "windows")]
        let is_local_start = request.connection_type.trim().eq_ignore_ascii_case("local");
        let password = connection_password_for(secrets, &request);
        let mut managed_x_server_display = None;
        if request.connection_type.trim().eq_ignore_ascii_case("ssh") {
            let settings = app.state::<storage::Storage>().ssh_settings()?;
            if settings.managed_x_server_enabled() {
                let launch_result = x_server::launch_vcxsrv_if_needed(
                    settings.x_server_path(),
                    settings.x_server_display(),
                    Some(settings.x_server_args()),
                )?;
                managed_x_server_display = Some(launch_result.display);
            }
        }
        if request
            .connection_type
            .trim()
            .eq_ignore_ascii_case("telnet")
        {
            // A blank password is allowed: the user answers the remote login
            // prompt interactively in the terminal instead.
            let password = password.unwrap_or_default();
            let session = telnet::start_native_terminal(
                app,
                telnet::NativeTelnetTerminalRequest {
                    session_id: session_id.clone(),
                    host: request.host.clone(),
                    user: request.user.clone(),
                    port: request.port.unwrap_or(23),
                    password,
                    cols: request.cols.unwrap_or(80),
                    rows: request.rows.unwrap_or(24),
                    encoding: encoding.clone(),
                },
            )?;
            self.sessions
                .lock()
                .map_err(|_| "terminal session lock is poisoned".to_string())?
                .insert(
                    session_id.clone(),
                    TerminalSession {
                        transport: TerminalTransport::NativeTelnet(session),
                        encoding,
                    },
                );
            return Ok(TerminalSessionStarted {
                session_id,
                terminal_ready_ms: None,
                x11_forwarding_status: None,
            });
        }

        if request
            .connection_type
            .trim()
            .eq_ignore_ascii_case("serial")
        {
            let line = request
                .serial_line
                .clone()
                .unwrap_or_else(|| request.host.clone());
            let session = serial::start_native_terminal(
                app,
                serial::NativeSerialTerminalRequest {
                    session_id: session_id.clone(),
                    line,
                    speed: request
                        .serial_speed
                        .or(request.port.map(u32::from))
                        .unwrap_or(9600),
                    encoding: encoding.clone(),
                },
            )?;
            self.sessions
                .lock()
                .map_err(|_| "terminal session lock is poisoned".to_string())?
                .insert(
                    session_id.clone(),
                    TerminalSession {
                        transport: TerminalTransport::NativeSerial(session),
                        encoding,
                    },
                );
            return Ok(TerminalSessionStarted {
                session_id,
                terminal_ready_ms: None,
                x11_forwarding_status: None,
            });
        }

        let auth_method = ssh_auth_method_for(&request, password.as_deref())?;
        if uses_native_ssh(&request, password.as_deref(), &auth_method, true) {
            let known_hosts_path = ssh::app_known_hosts_path(&app)?;
            let passphrase = connection_passphrase_for(secrets, &request);
            let auth = native_ssh_auth_for(&request, password, passphrase, &auth_method)?;
            match ssh::start_native_terminal(
                app.clone(),
                ssh::NativeSshTerminalRequest {
                    session_id: session_id.clone(),
                    host: request.host.clone(),
                    user: request.user.clone(),
                    port: request.port.unwrap_or(22),
                    auth,
                    known_hosts_path,
                    cols: request.cols.unwrap_or(80),
                    pixel_height: request.pixel_height.unwrap_or(0),
                    pixel_width: request.pixel_width.unwrap_or(0),
                    rows: request.rows.unwrap_or(24),
                    initial_directory: request.initial_directory.clone(),
                    use_tmux: request.use_tmux.unwrap_or(false),
                    tmux_session_id: request.tmux_session_id.clone(),
                    tmux_history_limit: ssh_buffer_lines_for(request.ssh_buffer_lines),
                    x11_forwarding: managed_x_server_display
                        .map(|display| ssh::NativeSshX11Forwarding { display }),
                    socks_proxy: request.ssh_socks_proxy.clone(),
                    compression: request.ssh_compression.unwrap_or(true),
                    old_protocols: request.ssh_old_protocols.unwrap_or(false),
                    encoding: encoding.clone(),
                },
            ) {
                Ok(session) => {
                    let terminal_ready_ms = session.terminal_ready_ms();
                    let x11_forwarding_status = session.x11_forwarding_status();
                    self.sessions
                        .lock()
                        .map_err(|_| "terminal session lock is poisoned".to_string())?
                        .insert(
                            session_id.clone(),
                            TerminalSession {
                                transport: TerminalTransport::NativeSsh(session),
                                encoding,
                            },
                        );
                    return Ok(TerminalSessionStarted {
                        session_id,
                        terminal_ready_ms: Some(terminal_ready_ms),
                        x11_forwarding_status,
                    });
                }
                Err(error) if should_fallback_to_interactive_ssh(&error) => {
                    emit_terminal_output(
                        &app,
                        &session_id,
                        "\r\n[fallback: starting interactive ssh for username/password authentication]\r\n"
                            .to_string(),
                    );
                }
                Err(error) => return Err(error),
            }
        }

        #[cfg(target_os = "windows")]
        if is_local_start {
            let command = command_for(&request)?;
            let local_pty =
                windows_local_pty::spawn_local_shell(pty_size_for(&request), command)
                    .map_err(|error| format!("failed to start Windows local shell: {error}"))?;
            let session = TerminalSession {
                transport: TerminalTransport::Pty {
                    master: local_pty.master,
                    writer: local_pty.writer,
                    child: local_pty.child,
                },
                encoding: encoding.clone(),
            };
            self.sessions
                .lock()
                .map_err(|_| "terminal session lock is poisoned".to_string())?
                .insert(session_id.clone(), session);

            let output_session_id = session_id.clone();
            thread::spawn(move || {
                let mut reader = local_pty.reader;
                let mut buffer = [0_u8; 8192];
                let mut decoder = TerminalOutputDecoder::new(encoding);
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => {
                            if let Some(data) = decoder.finish_lossy() {
                                emit_terminal_output(&app, &output_session_id, data);
                            }
                            break;
                        }
                        Ok(count) => {
                            if let Some(data) = decoder.decode(&buffer[..count]) {
                                emit_terminal_output(&app, &output_session_id, data);
                            }
                        }
                        Err(error) => {
                            if let Some(data) = decoder.finish_lossy() {
                                emit_terminal_output(&app, &output_session_id, data);
                            }
                            emit_terminal_output(
                                &app,
                                &output_session_id,
                                format!("\r\n[session read error: {error}]\r\n"),
                            );
                            break;
                        }
                    }
                }
            });
            return Ok(TerminalSessionStarted {
                session_id,
                terminal_ready_ms: None,
                x11_forwarding_status: None,
            });
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(pty_size_for(&request))
            .map_err(|error| format!("failed to open PTY: {error}"))?;

        let command = command_for(&request)?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("failed to create PTY reader: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("failed to create PTY writer: {error}"))?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("failed to start terminal process: {error}"))?;
        drop(pair.slave);

        let session = TerminalSession {
            transport: TerminalTransport::Pty {
                master: pair.master,
                writer,
                child,
            },
            encoding: encoding.clone(),
        };
        self.sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?
            .insert(session_id.clone(), session);

        let output_session_id = session_id.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            let mut decoder = TerminalOutputDecoder::new(encoding);
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        if let Some(data) = decoder.finish_lossy() {
                            emit_terminal_output(&app, &output_session_id, data);
                        }
                        break;
                    }
                    Ok(count) => {
                        if let Some(data) = decoder.decode(&buffer[..count]) {
                            emit_terminal_output(&app, &output_session_id, data);
                        }
                    }
                    Err(error) => {
                        if let Some(data) = decoder.finish_lossy() {
                            emit_terminal_output(&app, &output_session_id, data);
                        }
                        emit_terminal_output(
                            &app,
                            &output_session_id,
                            format!("\r\n[session read error: {error}]\r\n"),
                        );
                        break;
                    }
                }
            }
        });

        Ok(TerminalSessionStarted {
            session_id,
            terminal_ready_ms: None,
            x11_forwarding_status: None,
        })
    }

    pub fn list_tmux_sessions(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: TmuxConnectionRequest,
    ) -> Result<Vec<TmuxSession>, String> {
        let output = run_tmux_command(app, secrets, &request, tmux_list_command())?;
        Ok(parse_tmux_sessions(&output))
    }

    pub fn close_tmux_session(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: CloseTmuxSessionRequest,
    ) -> Result<(), String> {
        let tmux_session_id = required_tmux_session_id(request.tmux_session_id)?;
        run_tmux_command(
            app,
            secrets,
            &request.connection,
            tmux_close_command(&tmux_session_id),
        )?;
        Ok(())
    }

    pub fn rename_tmux_session(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: RenameTmuxSessionRequest,
    ) -> Result<(), String> {
        let tmux_session_id = required_tmux_session_id(request.tmux_session_id)?;
        let new_tmux_session_id = required_tmux_session_id(request.new_tmux_session_id)?;
        run_tmux_command(
            app,
            secrets,
            &request.connection,
            tmux_rename_session_command(&tmux_session_id, &new_tmux_session_id),
        )?;
        Ok(())
    }

    pub fn set_tmux_session_mouse(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: SetTmuxSessionMouseRequest,
    ) -> Result<(), String> {
        let tmux_session_id = required_tmux_session_id(request.tmux_session_id)?;
        let mouse_value = if request.enabled { "on" } else { "off" };
        run_tmux_command(
            app,
            secrets,
            &request.connection,
            tmux_set_mouse_command(&tmux_session_id, mouse_value),
        )?;
        Ok(())
    }

    pub fn scroll_tmux_pane(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: ScrollTmuxPaneRequest,
    ) -> Result<(), String> {
        let tmux_session_id = required_tmux_session_id(request.tmux_session_id)?;
        let lines = request.lines.clamp(-200, 200);
        if lines == 0 {
            return Ok(());
        }
        run_tmux_command(
            app,
            secrets,
            &request.connection,
            tmux_scroll_pane_command(&tmux_session_id, lines),
        )?;
        Ok(())
    }

    pub fn capture_tmux_pane(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: CaptureTmuxPaneRequest,
    ) -> Result<String, String> {
        let tmux_session_id = required_tmux_session_id(request.tmux_session_id)?;
        run_tmux_command(
            app,
            secrets,
            &request.connection,
            tmux_capture_pane_command(&tmux_session_id, ssh_buffer_lines_for(request.buffer_lines)),
        )
    }

    pub fn tmux_current_path(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: TmuxCurrentPathRequest,
    ) -> Result<String, String> {
        let tmux_session_id = required_tmux_session_id(request.tmux_session_id)?;
        Ok(run_tmux_command(
            app,
            secrets,
            &request.connection,
            tmux_current_path_command(&tmux_session_id),
        )?
        .trim()
        .to_string())
    }

    pub fn inspect_ssh_system_context(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: TmuxConnectionRequest,
    ) -> Result<String, String> {
        let cache_key = ssh_system_context_cache_key(&request);
        if let Some(cached) = self
            .ssh_context_cache
            .lock()
            .map_err(|_| "SSH system context cache lock is poisoned".to_string())?
            .get(&cache_key)
            .cloned()
        {
            return cached;
        }

        let result = run_ssh_command(
            app,
            secrets,
            &request,
            ssh_system_context_command(),
            Some(Duration::from_secs(3)),
        );
        self.ssh_context_cache
            .lock()
            .map_err(|_| "SSH system context cache lock is poisoned".to_string())?
            .insert(cache_key, result.clone());
        result
    }

    pub fn detect_ssh_remote_os(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: TmuxConnectionRequest,
        session_id: Option<String>,
    ) -> Result<DetectedRemoteOs, String> {
        let cache_key = ssh_system_context_cache_key(&request);
        if let Some(cached) = self
            .os_detect_cache
            .lock()
            .map_err(|_| "OS detection cache lock is poisoned".to_string())?
            .get(&cache_key)
            .cloned()
        {
            return Ok(cached);
        }

        let output = self.run_ssh_probe_command(
            app,
            secrets,
            &request,
            session_id.as_deref(),
            remote_os_detect_command(),
            Duration::from_secs(3),
        )?;
        let detected = parse_detected_remote_os(&output);
        self.os_detect_cache
            .lock()
            .map_err(|_| "OS detection cache lock is poisoned".to_string())?
            .insert(cache_key, detected.clone());
        Ok(detected)
    }

    /// Runs a read-only probe command, preferring the live SSH Session named by
    /// `session_id` so no second connection (and no system `ssh` console window)
    /// is spawned. The live path also works for blank-password Connections that
    /// authenticate interactively, where the system `ssh` fallback cannot. When
    /// no live native Session is available it falls back to `run_ssh_command`.
    fn run_ssh_probe_command(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: &TmuxConnectionRequest,
        session_id: Option<&str>,
        command: String,
        fallback_timeout: Duration,
    ) -> Result<String, String> {
        if let Some(handle) = session_id.and_then(|id| self.ssh_command_handle(id)) {
            return handle.run(command, SSH_PROBE_LIVE_SESSION_TIMEOUT);
        }
        run_ssh_command(app, secrets, request, command, Some(fallback_timeout))
    }

    /// Clones a command handle out of a live native SSH Session without holding
    /// the session lock while a probe runs.
    fn ssh_command_handle(&self, session_id: &str) -> Option<ssh::NativeSshCommandHandle> {
        let sessions = self.sessions.lock().ok()?;
        match &sessions.get(session_id)?.transport {
            TerminalTransport::NativeSsh(terminal) => Some(terminal.command_handle()),
            _ => None,
        }
    }

    pub fn list_remote_loopback_ports(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: TmuxConnectionRequest,
        session_id: Option<String>,
        hide_common_ports: bool,
    ) -> Result<Vec<RemoteLoopbackPort>, String> {
        let output = self.run_ssh_probe_command(
            app,
            secrets,
            &request,
            session_id.as_deref(),
            remote_loopback_port_command(),
            Duration::from_secs(5),
        )?;
        Ok(filter_remote_loopback_ports(
            parse_remote_loopback_ports(&output),
            hide_common_ports,
        ))
    }

    pub fn list_remote_network_addresses(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: TmuxConnectionRequest,
        session_id: Option<String>,
    ) -> Result<Vec<String>, String> {
        let output = self.run_ssh_probe_command(
            app,
            secrets,
            &request,
            session_id.as_deref(),
            remote_network_address_command(),
            Duration::from_secs(5),
        )?;
        Ok(parse_remote_network_addresses(&output))
    }

    pub fn list_local_tcp_listeners(&self) -> Result<Vec<LocalTcpListener>, String> {
        let mut command = local_tcp_listener_command();
        hide_console_window(&mut command);
        command
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let output = run_command_with_timeout(command, Duration::from_secs(5))
            .map_err(|error| error.replace("system ssh", "local TCP listener discovery"))?;
        if !output.status.success() {
            return Err(format!(
                "local TCP listener discovery failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let stdout = String::from_utf8(output.stdout).map_err(|error| {
            format!("local TCP listener discovery returned invalid UTF-8: {error}")
        })?;
        Ok(parse_local_tcp_listeners(&stdout))
    }

    pub fn start_ssh_port_forward(
        &self,
        _app: AppHandle,
        _secrets: &secrets::Secrets,
        request: StartSshPortForwardRequest,
    ) -> Result<SshPortForwardStarted, String> {
        let mode = request.mode.as_deref().unwrap_or("L").to_uppercase();
        if !matches!(mode.as_str(), "L" | "R" | "D") {
            return Err("SSH port forward mode must be L, R, or D".to_string());
        }
        let dest_host = request
            .dest_host
            .clone()
            .unwrap_or_else(|| "127.0.0.1".to_string());
        let remote_port = request.remote_port.or(request.dest_port).unwrap_or(0);
        if mode != "D" && remote_port == 0 {
            return Err("destination port must be between 1 and 65535".to_string());
        }
        let forward_id = request.forward_id.clone().unwrap_or_else(|| {
            make_session_id(&format!(
                "ssh-forward-{}-{}",
                request.connection.host, remote_port
            ))
        });
        if let Some(existing) = self
            .ssh_port_forwards
            .lock()
            .map_err(|_| "SSH port forward lock is poisoned".to_string())?
            .get(&forward_id)
        {
            return Ok(SshPortForwardStarted {
                forward_id,
                local_port: existing.local_port,
                remote_port,
                dest_host,
                url: ssh_port_forward_url(&existing.bind, existing.local_port),
            });
        }

        let session_id = request
            .session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "ssh-port-forward-session-unavailable".to_string())?
            .to_string();
        let handle = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|_| "terminal session lock is poisoned".to_string())?;
            let session = sessions
                .get(&session_id)
                .ok_or_else(|| "ssh-port-forward-session-unavailable".to_string())?;
            match &session.transport {
                TerminalTransport::NativeSsh(session) => session.port_forward_handle(),
                _ => return Err("ssh-port-forward-session-unavailable".to_string()),
            }
        };
        let listen_port = request.listen_port.unwrap_or(0);
        if listen_port == 0 {
            return Err("listener port must be between 1 and 65535".to_string());
        }
        let bind = request
            .bind
            .as_deref()
            .unwrap_or(if mode == "R" { "0.0.0.0" } else { "127.0.0.1" })
            .trim()
            .to_string();
        let bind_ip =
            if mode == "R" {
                None
            } else {
                Some(bind.parse::<IpAddr>().map_err(|_| {
                    "local SSH forward bind address must be an IP address".to_string()
                })?)
            };
        if mode != "R"
            && self
                .ssh_port_forwards
                .lock()
                .map_err(|_| "SSH port forward lock is poisoned".to_string())?
                .values()
                .any(|existing| {
                    existing.mode != "R"
                        && existing.local_port == listen_port
                        && existing
                            .bind_ip
                            .zip(bind_ip)
                            .is_some_and(|(existing, candidate)| {
                                ssh_forward_bind_addresses_overlap(existing, candidate)
                            })
                })
        {
            return Err("ssh-port-forward-bind-conflict".to_string());
        }
        let listener = if let Some(bind_ip) = bind_ip {
            let listener = StdTcpListener::bind((bind_ip, listen_port)).map_err(|error| {
                if error.kind() == std::io::ErrorKind::AddrInUse {
                    "ssh-port-forward-bind-conflict".to_string()
                } else {
                    format!("failed to bind local port forward listener: {error}")
                }
            })?;
            listener.set_nonblocking(true).map_err(|error| {
                format!("failed to configure local port forward listener: {error}")
            })?;
            Some(listener)
        } else {
            None
        };
        let local_port = listener
            .as_ref()
            .and_then(|listener| listener.local_addr().ok())
            .map(|address| address.port())
            .unwrap_or(listen_port);
        let kind = match mode.as_str() {
            "L" => ssh::NativeSshPortForwardKind::Local {
                listener: listener.expect("local forwarding listener exists"),
                dest_host: dest_host.clone(),
                dest_port: remote_port,
            },
            "D" => ssh::NativeSshPortForwardKind::Dynamic {
                listener: listener.expect("dynamic forwarding listener exists"),
            },
            "R" => ssh::NativeSshPortForwardKind::Remote {
                bind: bind.clone(),
                listen_port,
                dest_host: dest_host.clone(),
                dest_port: remote_port,
            },
            _ => unreachable!(),
        };
        handle.start(forward_id.clone(), kind, Duration::from_secs(15))?;
        self.ssh_port_forwards
            .lock()
            .map_err(|_| "SSH port forward lock is poisoned".to_string())?
            .insert(
                forward_id.clone(),
                SshPortForwardSession {
                    forward_id: forward_id.clone(),
                    session_id,
                    handle,
                    mode: mode.clone(),
                    bind: bind.clone(),
                    bind_ip,
                    local_port,
                },
            );
        Ok(SshPortForwardStarted {
            forward_id,
            local_port,
            remote_port,
            dest_host,
            url: ssh_port_forward_url(&bind, local_port),
        })
    }

    pub fn close_ssh_port_forward(
        &self,
        request: CloseSshPortForwardRequest,
    ) -> Result<(), String> {
        self.ssh_port_forwards
            .lock()
            .map_err(|_| "SSH port forward lock is poisoned".to_string())?
            .remove(&request.forward_id);
        Ok(())
    }

    pub fn write_terminal_input(&self, request: TerminalInputRequest) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?;
        let session = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| "terminal session was not found".to_string())?;
        let input = String::from_utf8(request.data)
            .map_err(|_| "terminal input must be valid UTF-8".to_string())?;
        let encoding = terminal_encoding(&session.encoding.label())?;
        let (encoded, _, _) = encoding.encode(&input);
        let data = encoded.into_owned();
        match &mut session.transport {
            TerminalTransport::Pty { writer, .. } => {
                writer
                    .write_all(&data)
                    .map_err(|error| format!("failed to write terminal input: {error}"))?;
                writer
                    .flush()
                    .map_err(|error| format!("failed to flush terminal input: {error}"))
            }
            TerminalTransport::NativeSsh(session) => session.write_input(data),
            TerminalTransport::NativeTelnet(session) => session.write_input(data),
            TerminalTransport::NativeSerial(session) => session.write_input(data),
        }
    }

    pub fn set_terminal_encoding(&self, request: SetTerminalEncodingRequest) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| "terminal session was not found".to_string())?;
        session.encoding.set(&request.encoding)
    }

    pub fn resize_terminal(&self, request: ResizeTerminalRequest) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?;
        let session = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| "terminal session was not found".to_string())?;
        let result = match &mut session.transport {
            TerminalTransport::Pty { master, .. } => master
                .resize(resize_pty_size(&request))
                .map_err(|error| format!("failed to resize terminal: {error}")),
            TerminalTransport::NativeSsh(session) => session.resize(
                request.cols,
                request.rows,
                request.pixel_width.unwrap_or(0),
                request.pixel_height.unwrap_or(0),
            ),
            TerminalTransport::NativeTelnet(session) => session.resize(request.cols, request.rows),
            TerminalTransport::NativeSerial(_) => Ok(()),
        };
        if result.is_ok() {
            drop(sessions);
            self.recordings
                .resize(&request.session_id, request.rows, request.cols);
        }
        result
    }

    pub fn close_terminal_session(&self, session_id: String) -> Result<(), String> {
        self.ssh_port_forwards
            .lock()
            .map_err(|_| "SSH port forward lock is poisoned".to_string())?
            .retain(|_, forwarding| forwarding.session_id != session_id);
        let session = self
            .sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?
            .remove(&session_id);
        if let Some(mut session) = session {
            let _ = self.stop_terminal_recording(session_id.clone());
            match session.transport {
                TerminalTransport::Pty { ref mut child, .. } => {
                    let _ = child.kill();
                }
                TerminalTransport::NativeSsh(session) => session.close(),
                TerminalTransport::NativeTelnet(session) => session.close(),
                TerminalTransport::NativeSerial(session) => session.close(),
            }
        }
        Ok(())
    }
}

pub fn launch_elevated_terminal(request: LaunchElevatedTerminalRequest) -> Result<(), String> {
    let shell = normalize_elevated_shell(&request.shell)?;
    let initial_directory = request
        .initial_directory
        .as_deref()
        .map(str::trim)
        .filter(|directory| !directory.is_empty());
    launch_elevated_terminal_impl(shell, initial_directory)
}

pub fn is_app_elevated() -> bool {
    is_app_elevated_impl()
}

#[cfg(target_os = "windows")]
fn is_app_elevated_impl() -> bool {
    use windows_sys::Win32::UI::Shell::IsUserAnAdmin;

    unsafe { IsUserAnAdmin() != 0 }
}

#[cfg(not(target_os = "windows"))]
fn is_app_elevated_impl() -> bool {
    false
}

fn normalize_elevated_shell(shell: &str) -> Result<&'static str, String> {
    match shell.trim().to_lowercase().as_str() {
        "cmd.exe" => Ok("cmd.exe"),
        "powershell.exe" => Ok("powershell.exe"),
        "pwsh.exe" => Ok("pwsh.exe"),
        _ => Err(
            "elevated terminal shell must be Command Prompt, PowerShell, or PowerShell 7"
                .to_string(),
        ),
    }
}

#[cfg(target_os = "windows")]
fn launch_elevated_terminal_impl(
    shell: &str,
    initial_directory: Option<&str>,
) -> Result<(), String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let operation = wide_string("runas");
    let file = wide_string(shell);
    let directory = initial_directory.map(wide_string);
    let directory_ptr = directory.as_ref().map_or(null(), |value| value.as_ptr());
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            null(),
            directory_ptr,
            SW_SHOWNORMAL,
        )
    } as isize;

    if result <= 32 {
        return Err(format!("failed to launch elevated {shell}"));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_elevated_terminal_impl(
    _shell: &str,
    _initial_directory: Option<&str>,
) -> Result<(), String> {
    Err("elevated local terminals are only available on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn wide_string(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn pty_size_for(request: &StartTerminalSessionRequest) -> PtySize {
    PtySize {
        rows: request.rows.unwrap_or(24),
        cols: request.cols.unwrap_or(80),
        pixel_width: request.pixel_width.unwrap_or(0),
        pixel_height: request.pixel_height.unwrap_or(0),
    }
}

fn resize_pty_size(request: &ResizeTerminalRequest) -> PtySize {
    PtySize {
        rows: request.rows,
        cols: request.cols,
        pixel_width: request.pixel_width.unwrap_or(0),
        pixel_height: request.pixel_height.unwrap_or(0),
    }
}

fn uses_native_ssh(
    request: &StartTerminalSessionRequest,
    password: Option<&str>,
    auth_method: &SshAuthMethod,
    allow_interactive_password: bool,
) -> bool {
    // A SOCKS proxy no longer forces the system-ssh path: the native russh
    // transport dials through the proxy itself (see `ssh::connect_verified_client`).
    // ProxyJump still requires the system `ssh` client.
    request.connection_type.trim().eq_ignore_ascii_case("ssh")
        && ssh::can_start_native_terminal(
            match auth_method {
                SshAuthMethod::KeyFile => request.key_path.as_deref(),
                SshAuthMethod::Password | SshAuthMethod::Agent => None,
            },
            password,
            matches!(auth_method, SshAuthMethod::Agent),
            allow_interactive_password && matches!(auth_method, SshAuthMethod::Password),
            request.proxy_jump.as_deref(),
        )
}

/// The system `ssh` fallback (used for ProxyJump and keyboard-interactive
/// auth) cannot tunnel through a SOCKS proxy without an external `nc`/netcat
/// helper, which is not available on every platform. SOCKS is therefore handled
/// exclusively by the native russh transport; reaching this path with a SOCKS
/// proxy configured means it was combined with something the native transport
/// cannot do (e.g. ProxyJump), so we fail loudly instead of silently bypassing
/// the proxy.
fn reject_socks_proxy_on_system_ssh(ssh_socks_proxy: Option<&str>) -> Result<(), String> {
    if ssh_socks_proxy
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        return Err(
            "SOCKS proxy is handled by the native SSH transport and cannot be combined with \
             ProxyJump or the system ssh fallback"
                .to_string(),
        );
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SshAuthMethod {
    KeyFile,
    Password,
    Agent,
}

fn ssh_auth_method_for(
    request: &StartTerminalSessionRequest,
    password: Option<&str>,
) -> Result<SshAuthMethod, String> {
    match request
        .auth_method
        .as_deref()
        .map(str::trim)
        .filter(|method| !method.is_empty())
    {
        Some("keyFile") | Some("key-file") | Some("key") => Ok(SshAuthMethod::KeyFile),
        Some("password") => Ok(SshAuthMethod::Password),
        Some("agent") | Some("sshAgent") | Some("ssh-agent") => Ok(SshAuthMethod::Agent),
        Some(_) => Err("SSH auth method must be keyFile, password, or agent".to_string()),
        None if request
            .key_path
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty()) =>
        {
            Ok(SshAuthMethod::KeyFile)
        }
        None if password.is_some() => Ok(SshAuthMethod::Password),
        None => Ok(SshAuthMethod::Agent),
    }
}

fn native_ssh_auth_for(
    request: &StartTerminalSessionRequest,
    password: Option<String>,
    passphrase: Option<String>,
    auth_method: &SshAuthMethod,
) -> Result<ssh::NativeSshAuth, String> {
    match auth_method {
        SshAuthMethod::KeyFile => Ok(ssh::NativeSshAuth::KeyFile {
            key_path: request.key_path.clone().unwrap_or_default(),
            passphrase,
        }),
        SshAuthMethod::Password => Ok(ssh::NativeSshAuth::Password { password }),
        SshAuthMethod::Agent => Ok(ssh::NativeSshAuth::Agent),
    }
}

fn connection_passphrase_for(
    secrets: &secrets::Secrets,
    request: &StartTerminalSessionRequest,
) -> Option<String> {
    request.passphrase_owner_id.as_ref().and_then(|owner_id| {
        secrets
            .read_connection_passphrase(owner_id.clone())
            .ok()
            .flatten()
    })
}

fn should_fallback_to_interactive_ssh(error: &str) -> bool {
    let normalized = error.to_lowercase();
    normalized.contains("authentication")
        && !normalized.contains("host key")
        && !normalized.contains("known host")
}

fn connection_password_for(
    secrets: &secrets::Secrets,
    request: &StartTerminalSessionRequest,
) -> Option<String> {
    if request
        .connection_type
        .trim()
        .eq_ignore_ascii_case("telnet")
    {
        return request.secret_owner_id.as_ref().and_then(|owner_id| {
            secrets
                .read_connection_password(owner_id.clone())
                .ok()
                .flatten()
        });
    }

    if !request.connection_type.trim().eq_ignore_ascii_case("ssh") {
        return None;
    }
    if !matches!(
        ssh_auth_method_for(request, None),
        Ok(SshAuthMethod::Password)
    ) {
        return None;
    }
    if request
        .proxy_jump
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        return None;
    }
    if request
        .key_path
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        return None;
    }

    request.secret_owner_id.as_ref().and_then(|owner_id| {
        secrets
            .read_connection_password(owner_id.clone())
            .ok()
            .flatten()
    })
}

fn run_tmux_command(
    app: AppHandle,
    secrets: &secrets::Secrets,
    request: &TmuxConnectionRequest,
    command: String,
) -> Result<String, String> {
    run_ssh_command(app, secrets, request, command, None)
}

fn run_ssh_command(
    app: AppHandle,
    secrets: &secrets::Secrets,
    request: &TmuxConnectionRequest,
    command: String,
    timeout: Option<Duration>,
) -> Result<String, String> {
    let mut terminal_request = terminal_request_for_tmux(request);
    resolve_terminal_socks_proxy(secrets, &mut terminal_request)?;
    let password = connection_password_for(secrets, &terminal_request);
    let auth_method = ssh_auth_method_for(&terminal_request, password.as_deref())?;
    if uses_native_ssh(&terminal_request, password.as_deref(), &auth_method, false) {
        return ssh::run_remote_command(ssh::NativeSshCommandRequest {
            host: terminal_request.host.clone(),
            user: terminal_request.user.clone(),
            port: terminal_request.port.unwrap_or(22),
            auth: native_ssh_auth_for(
                &terminal_request,
                password,
                connection_passphrase_for(secrets, &terminal_request),
                &auth_method,
            )?,
            known_hosts_path: ssh::app_known_hosts_path(&app)?,
            command,
            timeout_seconds: timeout.map(|duration| duration.as_secs().max(1)),
            socks_proxy: terminal_request.ssh_socks_proxy.clone(),
            compression: terminal_request.ssh_compression.unwrap_or(true),
            old_protocols: terminal_request.ssh_old_protocols.unwrap_or(false),
        });
    }

    run_system_ssh_command(&terminal_request, command, timeout)
}

fn remote_loopback_port_command() -> String {
    "if command -v ss >/dev/null 2>&1; then ss -H -ltn; elif command -v netstat >/dev/null 2>&1; then netstat -ltn; elif command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP -sTCP:LISTEN; else printf 'KKTerm: no ss, netstat, or lsof available\\n' >&2; fi".to_string()
}

fn remote_network_address_command() -> String {
    "if command -v ip >/dev/null 2>&1; then ip -o addr show | awk '{print $4}'; elif command -v ifconfig >/dev/null 2>&1; then ifconfig | awk '/^[[:space:]]*inet / {print $2} /^[[:space:]]*inet6 / {print $2}'; elif command -v hostname >/dev/null 2>&1; then hostname -I; else printf 'KKTerm: no ip, ifconfig, or hostname address discovery available\\n' >&2; fi".to_string()
}

#[cfg(windows)]
fn local_tcp_listener_command() -> ProcessCommand {
    let mut command = ProcessCommand::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object { \"{0}`t{1}\" -f $_.LocalAddress, $_.LocalPort }",
    ]);
    command
}

#[cfg(not(windows))]
fn local_tcp_listener_command() -> ProcessCommand {
    let mut command = ProcessCommand::new("/bin/sh");
    command.args([
        "-lc",
        r#"if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP -sTCP:LISTEN -Fn | awk 'function emit(value) { port=value; sub(/^.*:/,"",port); address=value; sub(/:[^:]*$/,"",address); gsub(/^\[/,"",address); gsub(/\]$/,"",address); if (address=="*") address="0.0.0.0"; print address "\t" port } /^n/ { emit(substr($0,2)) }'
elif command -v ss >/dev/null 2>&1; then
  ss -H -ltn | awk 'function emit(value) { port=value; sub(/^.*:/,"",port); address=value; sub(/:[^:]*$/,"",address); gsub(/^\[/,"",address); gsub(/\]$/,"",address); if (address=="*") address="0.0.0.0"; print address "\t" port } { emit($4) }'
else
  exit 127
fi"#,
    ]);
    command
}

fn parse_local_tcp_listeners(output: &str) -> Vec<LocalTcpListener> {
    let mut listeners = std::collections::BTreeSet::new();
    for line in output.lines() {
        let Some((address, port)) = line.trim().split_once('\t') else {
            continue;
        };
        let address = address.trim().trim_matches(['[', ']']);
        let Ok(parsed_address) = address.parse::<IpAddr>() else {
            continue;
        };
        let Ok(port) = port.trim().parse::<u16>() else {
            continue;
        };
        if port > 0 {
            listeners.insert(LocalTcpListener {
                address: parsed_address.to_string(),
                port,
            });
        }
    }
    listeners.into_iter().collect()
}

fn parse_remote_network_addresses(output: &str) -> Vec<String> {
    let mut addresses = Vec::new();
    for token in output.split_whitespace() {
        let candidate = token
            .trim_matches(|character: char| {
                character == ',' || character == '"' || character == '\''
            })
            .split('/')
            .next()
            .unwrap_or_default()
            .split('%')
            .next()
            .unwrap_or_default();
        if candidate.parse::<IpAddr>().is_ok() && !addresses.iter().any(|entry| entry == candidate)
        {
            addresses.push(candidate.to_string());
        }
    }
    addresses
}

fn parse_remote_loopback_ports(output: &str) -> Vec<RemoteLoopbackPort> {
    let mut ports = BTreeMap::new();
    for line in output.lines() {
        for token in line.split_whitespace() {
            if let Some((address, port)) = parse_loopback_endpoint(token) {
                ports
                    .entry(port)
                    .or_insert(RemoteLoopbackPort { port, address });
            }
        }
    }
    ports.into_values().collect()
}

fn filter_remote_loopback_ports(
    ports: Vec<RemoteLoopbackPort>,
    hide_common_ports: bool,
) -> Vec<RemoteLoopbackPort> {
    if !hide_common_ports {
        return ports;
    }

    ports
        .into_iter()
        .filter(|entry| entry.port >= 1024 || entry.port == 80 || entry.port == 443)
        .collect()
}

fn parse_loopback_endpoint(token: &str) -> Option<(String, u16)> {
    let trimmed = token.trim_matches(|c: char| c == ',' || c == '"' || c == '\'');
    let normalized = trimmed
        .strip_prefix("TCP@")
        .or_else(|| trimmed.strip_prefix("TCP"))
        .unwrap_or(trimmed);
    let normalized = normalized
        .strip_prefix("http://")
        .or_else(|| normalized.strip_prefix("https://"))
        .unwrap_or(normalized);
    let (host, port) = split_host_port(normalized)?;
    let host = host.trim_matches(['[', ']']);
    if !is_loopback_host(host) {
        return None;
    }
    Some((host.to_string(), port))
}

fn split_host_port(value: &str) -> Option<(&str, u16)> {
    if let Some(closing) = value.find("]:") {
        let host = value.get(1..closing)?;
        let port = value.get(closing + 2..)?.parse().ok()?;
        return Some((host, port));
    }

    let (host, port) = value.rsplit_once(':')?;
    if port == "*" {
        return None;
    }
    Some((host, port.parse().ok()?))
}

fn is_loopback_host(host: &str) -> bool {
    let host = host.trim();
    host.eq_ignore_ascii_case("localhost")
        || host == "::1"
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn ssh_forward_bind_addresses_overlap(left: IpAddr, right: IpAddr) -> bool {
    match (left, right) {
        (IpAddr::V4(left), IpAddr::V4(right)) => {
            left == right || left.is_unspecified() || right.is_unspecified()
        }
        (IpAddr::V6(left), IpAddr::V6(right)) => {
            left == right || left.is_unspecified() || right.is_unspecified()
        }
        _ => false,
    }
}

fn ssh_port_forward_url(bind: &str, port: u16) -> String {
    let protocol = if matches!(port, 443 | 8443) {
        "https"
    } else {
        "http"
    };
    let host = match bind.trim() {
        "0.0.0.0" => "127.0.0.1".to_string(),
        "::" => "[::1]".to_string(),
        value if value.contains(':') && !value.starts_with('[') => format!("[{value}]"),
        "" => "127.0.0.1".to_string(),
        value => value.to_string(),
    };
    format!("{protocol}://{host}:{port}")
}

fn terminal_request_for_tmux(request: &TmuxConnectionRequest) -> StartTerminalSessionRequest {
    StartTerminalSessionRequest {
        session_id: None,
        title: "tmux".to_string(),
        connection_type: "ssh".to_string(),
        host: request.host.clone(),
        user: request.user.clone(),
        port: request.port,
        key_path: request.key_path.clone(),
        proxy_jump: request.proxy_jump.clone(),
        ssh_socks_proxy: request.ssh_socks_proxy.clone(),
        ssh_socks_proxy_username: request.ssh_socks_proxy_username.clone(),
        ssh_socks_proxy_secret_owner_id: request.ssh_socks_proxy_secret_owner_id.clone(),
        ssh_compression: request.ssh_compression,
        ssh_old_protocols: request.ssh_old_protocols,
        auth_method: request.auth_method.clone(),
        secret_owner_id: request.secret_owner_id.clone(),
        passphrase_owner_id: request.passphrase_owner_id.clone(),
        shell: None,
        serial_line: None,
        serial_speed: None,
        initial_directory: None,
        environment_variables: Vec::new(),
        cols: None,
        pixel_height: None,
        pixel_width: None,
        rows: None,
        use_tmux: None,
        tmux_session_id: None,
        use_psmux: None,
        psmux_session_id: None,
        ssh_buffer_lines: None,
        text_encoding: default_terminal_encoding(),
    }
}

fn resolve_terminal_socks_proxy(
    secrets: &secrets::Secrets,
    request: &mut StartTerminalSessionRequest,
) -> Result<(), String> {
    let has_proxy_jump = request
        .proxy_jump
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    request.ssh_socks_proxy = crate::resolve_ssh_socks_proxy(
        secrets,
        request.ssh_socks_proxy.take(),
        request.ssh_socks_proxy_username.take(),
        request.ssh_socks_proxy_secret_owner_id.take(),
        has_proxy_jump,
    )?;
    Ok(())
}

fn run_system_ssh_command(
    request: &StartTerminalSessionRequest,
    remote_command: String,
    timeout: Option<Duration>,
) -> Result<String, String> {
    let host = request.host.trim();
    if host.is_empty() {
        return Err("host is required for SSH sessions".to_string());
    }

    let mut command = ProcessCommand::new("ssh");
    command.arg("-T");
    command.arg("-o");
    command.arg("BatchMode=yes");
    if let Some(port) = request.port {
        command.arg("-p");
        command.arg(port.to_string());
    }
    if let Some(key_path) = request.key_path.as_ref().map(|value| value.trim()) {
        if !key_path.is_empty() {
            command.arg("-i");
            command.arg(key_path);
        }
    }
    if let Some(proxy_jump) = request.proxy_jump.as_ref().map(|value| value.trim()) {
        if !proxy_jump.is_empty() {
            command.arg("-J");
            command.arg(proxy_jump);
        }
    }
    reject_socks_proxy_on_system_ssh(request.ssh_socks_proxy.as_deref())?;

    let target = match request.user.trim() {
        "" => host.to_string(),
        user => format!("{user}@{host}"),
    };
    command.arg(target);
    command.arg(remote_command);
    hide_console_window(&mut command);

    let output = if let Some(timeout) = timeout {
        run_command_with_timeout(command, timeout)?
    } else {
        command
            .output()
            .map_err(|error| format!("failed to run system ssh: {error}"))?
    };
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("system ssh command failed: {stderr}"))
    }
}

/// Suppress the transient console window Windows shows when spawning the system
/// `ssh` client from a GUI process. No-op on other platforms.
fn hide_console_window(command: &mut ProcessCommand) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW — see Windows process creation flags.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

fn run_command_with_timeout(
    mut command: ProcessCommand,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to run system ssh: {error}"))?;
    let deadline = Instant::now() + timeout;
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("failed to wait for system ssh: {error}"))?
        {
            Some(_) => {
                return child
                    .wait_with_output()
                    .map_err(|error| format!("failed to collect system ssh output: {error}"));
            }
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "system ssh command timed out after {} seconds",
                    timeout.as_secs()
                ));
            }
            None => thread::sleep(Duration::from_millis(25)),
        }
    }
}

fn ssh_system_context_cache_key(request: &TmuxConnectionRequest) -> String {
    format!(
        "{}:{}:{}:{}",
        request.host.trim().to_ascii_lowercase(),
        request.port.unwrap_or(22),
        request
            .proxy_jump
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .to_ascii_lowercase(),
        request
            .ssh_socks_proxy
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .to_ascii_lowercase()
    )
}

fn tmux_list_command() -> String {
    "if command -v tmux >/dev/null 2>&1; then tmux list-sessions -F '#{session_name}\t#{session_attached}\t#{session_windows}\t#{session_created}\t#{session_last_attached}\t#{session_path}\t#{session_id}' 2>/dev/null || true; fi".to_string()
}

fn tmux_close_command(tmux_session_id: &str) -> String {
    format!(
        "if command -v tmux >/dev/null 2>&1; then tmux kill-session -t {}; fi",
        shell_single_quote(tmux_session_id)
    )
}

fn tmux_rename_session_command(tmux_session_id: &str, new_tmux_session_id: &str) -> String {
    format!(
        "if command -v tmux >/dev/null 2>&1; then tmux rename-session -t {} {}; fi",
        shell_single_quote(tmux_session_id),
        shell_single_quote(new_tmux_session_id)
    )
}

fn tmux_set_mouse_command(tmux_session_id: &str, mouse_value: &str) -> String {
    format!(
        "if command -v tmux >/dev/null 2>&1; then tmux set-option -t {} mouse {}; fi",
        shell_single_quote(tmux_session_id),
        mouse_value
    )
}

// A live-Session probe is queued behind authentication, so its wait spans an
// interactive (blank-password) login plus the bounded command run. Keep it
// generous enough for a person to type a password, but finite so an abandoned
// login cannot tie up the probe forever.
const SSH_PROBE_LIVE_SESSION_TIMEOUT: Duration = Duration::from_secs(25);

const DEFAULT_SSH_BUFFER_LINES: u32 = 5_000;

fn ssh_buffer_lines_for(value: Option<u32>) -> u32 {
    value
        .filter(|lines| (100..=100_000).contains(lines))
        .unwrap_or(DEFAULT_SSH_BUFFER_LINES)
}

fn tmux_scroll_pane_command(tmux_session_id: &str, lines: i32) -> String {
    let target = format!("{}:", shell_single_quote(tmux_session_id));
    let count = lines.unsigned_abs().max(1);
    if lines < 0 {
        return format!(
            "tmux copy-mode -e -t {target} \\; send-keys -X -t {target} -N {count} scroll-up"
        );
    }
    format!("tmux send-keys -X -t {target} -N {count} scroll-down 2>/dev/null || true")
}

fn tmux_capture_pane_command(tmux_session_id: &str, buffer_lines: u32) -> String {
    format!(
        "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux capture-pane -p -S -{} -t {}:",
        ssh_buffer_lines_for(Some(buffer_lines)),
        shell_single_quote(tmux_session_id),
    )
}

fn tmux_current_path_command(tmux_session_id: &str) -> String {
    format!(
        "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux display-message -p -t {}: '#{{pane_current_path}}'",
        shell_single_quote(tmux_session_id),
    )
}

fn remote_os_detect_command() -> String {
    // Lightweight, POSIX-sh probe: the os-release ID/ID_LIKE and kernel name pick
    // a bundled distro/OS logo for the common case. A device-tree MODEL catches
    // Raspberry Pi hardware (64-bit Pi OS reports ID=debian), and a few
    // distinctive markers identify appliance distributions (Proxmox, TrueNAS,
    // pfSense) that otherwise share a generic os-release / FreeBSD kernel.
    r#"if [ -r /etc/os-release ]; then
  . /etc/os-release
  printf 'ID=%s\n' "${ID:-}"
  printf 'ID_LIKE=%s\n' "${ID_LIKE:-}"
fi
printf 'KERNEL=%s\n' "$(uname -s 2>/dev/null)"
if [ -r /proc/device-tree/model ]; then
  printf 'MODEL=%s\n' "$(tr -d '\0' < /proc/device-tree/model 2>/dev/null)"
elif [ -r /sys/firmware/devicetree/base/model ]; then
  printf 'MODEL=%s\n' "$(tr -d '\0' < /sys/firmware/devicetree/base/model 2>/dev/null)"
fi
if [ -d /etc/pve ]; then
  printf 'APP=proxmox\n'
elif [ -r /etc/version ] && grep -qi truenas /etc/version 2>/dev/null; then
  printf 'APP=truenas\n'
elif [ -x /usr/local/sbin/pfSsh.php ]; then
  printf 'APP=pfsense\n'
fi
"#
    .to_string()
}

fn parse_detected_remote_os(output: &str) -> DetectedRemoteOs {
    let mut detected = DetectedRemoteOs::default();
    for line in output.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("ID=") {
            let value = value.trim().trim_matches('"');
            if !value.is_empty() {
                detected.id = Some(value.to_ascii_lowercase());
            }
        } else if let Some(value) = line.strip_prefix("ID_LIKE=") {
            let value = value.trim().trim_matches('"');
            if !value.is_empty() {
                detected.id_like = Some(value.to_ascii_lowercase());
            }
        } else if let Some(value) = line.strip_prefix("KERNEL=") {
            let value = value.trim();
            if !value.is_empty() {
                detected.kernel = Some(value.to_string());
            }
        } else if let Some(value) = line.strip_prefix("MODEL=") {
            let value = value.trim();
            if !value.is_empty() {
                detected.model = Some(value.to_string());
            }
        } else if let Some(value) = line.strip_prefix("APP=") {
            let value = value.trim();
            if !value.is_empty() {
                detected.app = Some(value.to_ascii_lowercase());
            }
        }
    }
    detected
}

fn ssh_system_context_command() -> String {
    r#"printf 'Hostname: '; hostname 2>/dev/null || printf 'unknown'; printf '\n'
printf 'User: '; whoami 2>/dev/null || printf 'unknown'; printf '\n'
printf 'Kernel: '; uname -srmo 2>/dev/null || uname -a 2>/dev/null || printf 'unknown'; printf '\n'
if [ -r /etc/os-release ]; then
  . /etc/os-release
  printf 'OS: %s\n' "${PRETTY_NAME:-${NAME:-unknown}}"
elif command -v lsb_release >/dev/null 2>&1; then
  printf 'OS: '; lsb_release -ds 2>/dev/null
else
  printf 'OS: unknown\n'
fi
if [ -r /etc/os-release ]; then
  printf '/etc/os-release:\n'
  sed 's/^/  /' /etc/os-release 2>/dev/null
fi
printf 'Architecture: '; uname -m 2>/dev/null || printf 'unknown'; printf '\n'
printf 'CPU: '
if command -v nproc >/dev/null 2>&1; then
  printf '%s cores' "$(nproc 2>/dev/null)"
else
  grep -c '^processor' /proc/cpuinfo 2>/dev/null | tr -d '\n' || printf 'unknown'
  printf ' cores'
fi
if [ -r /proc/cpuinfo ]; then
  cpu_model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ //')
  if [ -n "$cpu_model" ]; then printf ' (%s)' "$cpu_model"; fi
fi
printf '\n'
printf 'Memory: '
if command -v free >/dev/null 2>&1; then
  free -h 2>/dev/null | awk '/^Mem:/ {print $2 " total, " $7 " available"}'
elif [ -r /proc/meminfo ]; then
  awk '/MemTotal:/ {printf "%.1f GiB total\n", $2/1024/1024}' /proc/meminfo
else
  printf 'unknown\n'
fi
printf 'Disk: '
df -h / 2>/dev/null | awk 'NR==2 {print $2 " total, " $4 " available on /"}' || printf 'unknown\n'
printf 'Shell: %s\n' "${SHELL:-unknown}"
printf 'Uptime: '
uptime -p 2>/dev/null || uptime 2>/dev/null || printf 'unknown\n'
printf 'Package managers: '
found_pm=''
for pm in apt dnf yum pacman zypper apk brew snap flatpak; do
  if command -v "$pm" >/dev/null 2>&1; then
    if [ -n "$found_pm" ]; then printf ', '; fi
    printf '%s' "$pm"
    found_pm=1
  fi
done
if [ -z "$found_pm" ]; then printf 'unknown'; fi
printf '\n'
printf 'Runtimes: '
found_runtime=''
for runtime in node npm python3 python go rustc cargo docker podman kubectl; do
  if command -v "$runtime" >/dev/null 2>&1; then
    version=$("$runtime" --version 2>/dev/null | head -n 1)
    if [ -n "$found_runtime" ]; then printf '; '; fi
    printf '%s' "${version:-$runtime}"
    found_runtime=1
  fi
done
if [ -z "$found_runtime" ]; then printf 'none detected'; fi
printf '\n'"#
        .to_string()
}

fn required_tmux_session_id(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("tmux session id is required".to_string());
    }
    if trimmed
        .chars()
        .any(|char| char.is_whitespace() || char == ':' || char == ';' || char.is_control())
    {
        return Err(
            "tmux session id cannot contain whitespace, colons, semicolons, or control characters"
                .to_string(),
        );
    }
    Ok(trimmed.to_string())
}

fn parse_tmux_sessions(output: &str) -> Vec<TmuxSession> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let id = parts.next()?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let attached = parts
                .next()
                .and_then(|value| value.parse::<u32>().ok())
                .is_some_and(|count| count > 0);
            let windows = parts
                .next()
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(0);
            let created = parts.next().and_then(|value| value.parse::<u64>().ok());
            let last_attached = parts.next().and_then(|value| value.parse::<u64>().ok());
            let path = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let internal_id = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            Some(TmuxSession {
                id,
                attached,
                windows,
                created,
                last_attached,
                path,
                internal_id,
            })
        })
        .collect()
}

/// The native Windows tmux. psmux ships a tmux-compatible CLI (same
/// `list-sessions -F` format variables, `new-session`/`attach`/`rename-session`/
/// `kill-session`/`set-option`), so its session management mirrors the SSH tmux
/// path but runs as a one-shot local child process instead of over SSH.
const PSMUX_PROGRAM: &str = "psmux.exe";

/// psmux accepts the same `#{session_*}` format string as tmux, so its output is
/// parsed with [`parse_tmux_sessions`].
fn psmux_list_format() -> &'static str {
    "#{session_name}\t#{session_attached}\t#{session_windows}\t#{session_created}\t#{session_last_attached}\t#{session_path}\t#{session_id}"
}

fn is_powershell_family_program(program: &str) -> bool {
    let lower = program.to_ascii_lowercase();
    // Split on both separators explicitly: these are Windows program paths, and
    // std::path::Path only treats `\` as a separator on Windows hosts.
    let name = lower.rsplit(['/', '\\']).next().unwrap_or(lower.as_str());
    matches!(name, "powershell.exe" | "pwsh.exe" | "powershell" | "pwsh")
}

/// Builds `new-session -e NAME=<value>` arguments that refresh critical
/// environment variables into a freshly created psmux pane. A psmux server is
/// persistent and may otherwise leave new panes with the stale environment it
/// captured when the server started.
fn psmux_pane_environment_args(
    command: &CommandBuilder,
    managed_variables: &[ManagedTerminalEnvironmentVariable],
) -> Vec<OsString> {
    let mut names = vec!["PATH".to_string()];
    for variable in managed_variables {
        if !names
            .iter()
            .any(|name| name.eq_ignore_ascii_case(&variable.name))
        {
            names.push(variable.name.clone());
        }
    }

    let mut args = Vec::new();
    for name in names {
        let Some(value) = command.get_env(&name).filter(|value| !value.is_empty()) else {
            continue;
        };
        let mut entry = OsString::from(format!("{name}="));
        entry.push(value);
        args.push(OsString::from("-e"));
        args.push(entry);
    }
    args
}

fn psmux_session_id_for_launch(value: Option<&str>) -> Option<String> {
    let trimmed = value.map(str::trim).unwrap_or_default();
    if trimmed.is_empty() {
        return None;
    }
    required_tmux_session_id(trimmed.to_string()).ok()
}

/// Run a one-shot local `psmux.exe` command and capture stdout. psmux runs
/// natively on this machine, so unlike the SSH tmux path there is no SSH channel
/// — just a short-lived child process. A missing psmux binary is reported as an
/// error; an empty session list is normal and yields empty stdout.
fn run_psmux_command(args: &[&str]) -> Result<String, String> {
    if !local_shell_available(PSMUX_PROGRAM) {
        return Err("psmux is not installed".to_string());
    }
    let mut command = ProcessCommand::new(PSMUX_PROGRAM);
    command.args(args);
    command.stdin(std::process::Stdio::null());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    hide_console_window(&mut command);
    let output = run_command_with_timeout(command, Duration::from_secs(10))?;
    psmux_command_output(output.status.success(), &output.stdout, &output.stderr)
}

fn psmux_command_output(success: bool, stdout: &[u8], stderr: &[u8]) -> Result<String, String> {
    let stdout = String::from_utf8_lossy(stdout).to_string();
    if success {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(stderr);
    let detail = stderr.trim();
    Err(if detail.is_empty() {
        "psmux command failed".to_string()
    } else {
        format!("psmux command failed: {detail}")
    })
}

pub fn list_psmux_sessions() -> Result<Vec<TmuxSession>, String> {
    let output = run_psmux_command(&["list-sessions", "-F", psmux_list_format()])?;
    Ok(parse_tmux_sessions(&output))
}

pub fn close_psmux_session(psmux_session_id: String) -> Result<(), String> {
    let id = required_tmux_session_id(psmux_session_id)?;
    run_psmux_command(&["kill-session", "-t", &id])?;
    Ok(())
}

pub fn rename_psmux_session(
    psmux_session_id: String,
    new_psmux_session_id: String,
) -> Result<(), String> {
    let id = required_tmux_session_id(psmux_session_id)?;
    let new_id = required_tmux_session_id(new_psmux_session_id)?;
    run_psmux_command(&["rename-session", "-t", &id, &new_id])?;
    Ok(())
}

pub fn set_psmux_session_mouse(psmux_session_id: String, enabled: bool) -> Result<(), String> {
    let id = required_tmux_session_id(psmux_session_id)?;
    let mouse = if enabled { "on" } else { "off" };
    run_psmux_command(&["set-option", "-t", &id, "mouse", mouse])?;
    Ok(())
}

fn command_for(request: &StartTerminalSessionRequest) -> Result<CommandBuilder, String> {
    match request.connection_type.trim().to_lowercase().as_str() {
        "local" => {
            let program = request
                .shell
                .as_ref()
                .map(|shell| shell.trim())
                .filter(|shell| !shell.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| {
                    if cfg!(target_os = "windows") {
                        "powershell.exe".to_string()
                    } else {
                        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
                    }
                });
            let parsed = parse_local_shell_command_line(&program)?;
            let is_cmd = is_windows_cmd_shell(&parsed.program);
            let resolved_program = resolved_local_shell_program(parsed.program);
            // psmux session management wraps the chosen PowerShell shell in a
            // `psmux new-session -A -s <name>` (attach-or-create), mirroring the
            // SSH tmux launch path. It applies only to PowerShell/pwsh shells, and
            // silently falls back to the plain shell when psmux is not installed
            // or no session id was supplied.
            let psmux_session_id = request
                .use_psmux
                .unwrap_or(false)
                .then(|| psmux_session_id_for_launch(request.psmux_session_id.as_deref()))
                .flatten()
                .filter(|_| is_powershell_family_program(&resolved_program))
                .filter(|_| local_shell_available(PSMUX_PROGRAM));
            let mut command = if psmux_session_id.is_some() {
                CommandBuilder::new(resolved_local_shell_program(PSMUX_PROGRAM.to_string()))
            } else {
                CommandBuilder::new(resolved_program.clone())
            };
            sanitize_windows_local_environment(&mut command);
            sanitize_linux_appimage_environment(&mut command);
            set_terminal_environment(&mut command);
            set_macos_local_terminal_locale(&mut command, &request.text_encoding);
            apply_managed_terminal_environment(&mut command, &request.environment_variables)?;
            if let Some(session_id) = psmux_session_id {
                command.arg("new-session");
                command.arg("-A");
                command.arg("-s");
                command.arg(&session_id);
                // Push the effective launch environment across the psmux server
                // boundary. This uses the already-sanitized command environment
                // rather than KKTerm's stale long-lived process environment.
                for arg in psmux_pane_environment_args(&command, &request.environment_variables) {
                    command.arg(arg);
                }
                command.arg("--");
                command.arg(&resolved_program);
                for arg in &parsed.args {
                    command.arg(arg);
                }
            } else {
                if is_cmd {
                    command.arg("/D");
                }
                for arg in &parsed.args {
                    command.arg(arg);
                }
            }
            if let Some(directory) = initial_directory_for(request) {
                command.cwd(OsString::from(directory));
            }
            Ok(command)
        }
        "ssh" => {
            let host = request.host.trim();
            if host.is_empty() {
                return Err("host is required for SSH sessions".to_string());
            }

            let mut command = CommandBuilder::new("ssh");
            sanitize_linux_appimage_environment(&mut command);
            set_terminal_environment(&mut command);
            command.arg("-tt");
            if let Some(port) = request.port {
                command.arg("-p");
                command.arg(port.to_string());
            }
            if let Some(key_path) = request.key_path.as_ref().map(|value| value.trim()) {
                if !key_path.is_empty() {
                    command.arg("-i");
                    command.arg(key_path);
                }
            }
            if let Some(proxy_jump) = request.proxy_jump.as_ref().map(|value| value.trim()) {
                if !proxy_jump.is_empty() {
                    command.arg("-J");
                    command.arg(proxy_jump);
                }
            }
            reject_socks_proxy_on_system_ssh(request.ssh_socks_proxy.as_deref())?;

            let target = match request.user.trim() {
                "" => host.to_string(),
                user => format!("{user}@{host}"),
            };
            command.arg(target);
            if request.use_tmux.unwrap_or(false) {
                if let Some(tmux_session_id) = request
                    .tmux_session_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|session_id| !session_id.is_empty())
                {
                    command.arg(ssh::remote_tmux_resume_command(
                        initial_directory_for(request).as_deref(),
                        tmux_session_id,
                        ssh_buffer_lines_for(request.ssh_buffer_lines),
                    ));
                } else if let Some(directory) = initial_directory_for(request) {
                    command.arg(remote_shell_command_for_initial_directory(&directory));
                }
            } else if let Some(directory) = initial_directory_for(request) {
                command.arg(remote_shell_command_for_initial_directory(&directory));
            }
            Ok(command)
        }
        other => Err(format!(
            "{other} sessions do not have a terminal transport yet"
        )),
    }
}

fn set_terminal_environment(command: &mut CommandBuilder) {
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
}

fn set_macos_local_terminal_locale(command: &mut CommandBuilder, text_encoding: &str) {
    if cfg!(target_os = "macos")
        && let Some(locale) = macos_default_lc_ctype(text_encoding)
    {
        // Finder-launched apps do not receive Terminal.app's UTF-8 locale
        // environment. Without LC_CTYPE, zsh treats each UTF-8 input byte as a
        // separate character and renders sequences such as `<00ad>`. Only add
        // the UTF-8 locale when this Session's selected wire encoding is UTF-8;
        // legacy per-Pane encodings must keep their existing locale behavior.
        // Connection environment variables are applied afterwards and may
        // intentionally override this default.
        command.env("LC_CTYPE", locale);
    }
}

fn macos_default_lc_ctype(text_encoding: &str) -> Option<&'static str> {
    terminal_encoding(text_encoding)
        .is_ok_and(|encoding| encoding == UTF_8)
        .then_some("UTF-8")
}

fn apply_managed_terminal_environment(
    command: &mut CommandBuilder,
    variables: &[ManagedTerminalEnvironmentVariable],
) -> Result<(), String> {
    if variables.is_empty() {
        return Ok(());
    }
    let data_root = local_data_root()?;
    for variable in variables {
        let (name, value) = resolve_managed_terminal_environment(variable, &data_root)?;
        command.env(name, value);
    }
    Ok(())
}

fn local_data_root() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        return std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| "LOCALAPPDATA is unavailable for the CLI account profile".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(path) = std::env::var_os("XDG_DATA_HOME").filter(|value| !value.is_empty()) {
            return Ok(PathBuf::from(path));
        }
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join(".local").join("share"))
            .ok_or_else(|| "HOME is unavailable for the CLI account profile".to_string())
    }
}

fn resolve_managed_terminal_environment(
    variable: &ManagedTerminalEnvironmentVariable,
    data_root: &Path,
) -> Result<(String, OsString), String> {
    if !is_portable_environment_name(&variable.name) {
        return Err(format!(
            "invalid managed environment variable name: {}",
            variable.name
        ));
    }
    if variable.source == "literal" {
        if variable.value.contains(['\r', '\n', '\0']) {
            return Err(format!(
                "invalid managed environment variable value: {}",
                variable.name
            ));
        }
        return Ok((variable.name.clone(), OsString::from(&variable.value)));
    }
    if variable.source != "cliAccount" {
        return Err(format!(
            "unsupported managed environment source: {}",
            variable.source
        ));
    }

    let tool = match variable.name.as_str() {
        "CLAUDE_CONFIG_DIR" => "claude-code",
        "CODEX_HOME" => "codex",
        _ => {
            return Err(format!(
                "unsupported CLI account variable: {}",
                variable.name
            ));
        }
    };
    let normalized = variable.value.replace('\\', "/");
    let marker = format!("/cli-accounts/{tool}/");
    let label = normalized
        .split_once(&marker)
        .map(|(_, label)| label)
        .filter(|label| {
            !label.is_empty()
                && !label.contains('/')
                && label.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
                })
        })
        .ok_or_else(|| format!("invalid CLI account directory for {}", variable.name))?;
    let directory = data_root
        .join(if cfg!(target_os = "windows") {
            "KKTerm"
        } else {
            "kkterm"
        })
        .join("cli-accounts")
        .join(tool)
        .join(label);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create CLI account directory: {error}"))?;
    Ok((variable.name.clone(), directory.into_os_string()))
}

fn is_portable_environment_name(name: &str) -> bool {
    let mut characters = name.chars();
    matches!(characters.next(), Some(first) if first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

// Fallback-only curated allowlist, used by `sanitize_windows_local_environment`
// when `CreateEnvironmentBlock` is unavailable. The primary path now builds the
// child environment from the registry so user-defined variables flow through.
#[cfg(target_os = "windows")]
const WINDOWS_LOCAL_ENV_ALLOWLIST: &[&str] = &[
    "ALLUSERSPROFILE",
    "APPDATA",
    "CommonProgramFiles",
    "CommonProgramFiles(x86)",
    "ComSpec",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATH",
    "PATHEXT",
    "POSH_THEMES_PATH",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "PROCESSOR_LEVEL",
    "PROCESSOR_REVISION",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "PSModulePath",
    "PUBLIC",
    "SystemDrive",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "windir",
];

// Build the environment for a local Windows shell so it matches what the same
// shell would receive when launched directly from Explorer, including any
// user-defined variables (e.g. `ANTHROPIC_BASE_URL` set via `setx`).
//
// We deliberately do not inherit KKTerm's own process environment. A long-lived
// GUI process captures its environment block once at launch, so it misses later
// `setx` changes (Windows only refreshes the registry and broadcasts
// `WM_SETTINGCHANGE`; already-running processes keep their stale copy — see the
// `CreateEnvironmentBlock` docs), and it also carries WebView2/Tauri-injected
// noise that should not leak into the shell. Instead we ask Windows to compose a
// fresh block from the registry via `CreateEnvironmentBlock`, exactly as logon
// does (system then user variables, PATH concatenated, `%VARS%` expanded,
// volatile environment included). This is a strict superset of the historical
// allowlist plus the user's own variables, and it stays current after `setx`.
// The process-env allowlist remains only as a fallback if that API ever fails.
fn sanitize_windows_local_environment(command: &mut CommandBuilder) {
    #[cfg(target_os = "windows")]
    {
        command.env_clear();

        let registry_env = windows_user_environment_block();
        let mut inherited_module_path: Option<String> = None;

        if registry_env.is_empty() {
            // Fallback: CreateEnvironmentBlock was unavailable, so fall back to
            // the curated allowlist sourced from this process's environment.
            for key in WINDOWS_LOCAL_ENV_ALLOWLIST {
                if let Some(value) = std::env::var_os(key) {
                    if *key == "PSModulePath" {
                        inherited_module_path = Some(value.to_string_lossy().into_owned());
                    } else {
                        command.env(*key, value);
                    }
                }
            }
        } else {
            for (name, value) in registry_env {
                if name.eq_ignore_ascii_case("PSModulePath") {
                    inherited_module_path = Some(value);
                } else {
                    command.env(name, value);
                }
            }
        }

        // PowerShell module discovery still needs the (possibly OneDrive-)
        // redirected Documents module paths merged ahead of the inherited
        // PSModulePath; oh-my-posh's POSH_THEMES_PATH rides through normally.
        let inherited = inherited_module_path.unwrap_or_default();
        let merged = match windows_documents_folder_path() {
            Some(documents) => windows_powershell_module_path_for(&inherited, &documents),
            None => inherited,
        };
        if !merged.is_empty() {
            command.env("PSModulePath", merged);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Non-Windows shells inherit KKTerm's full environment (the convention
        // for every mainstream terminal); only explicit overrides are layered on.
        let _ = command;
    }
}

// When KKTerm runs from an AppImage, the AppRun wrapper and its bundled
// linuxdeploy GTK hook rewrite the environment so the app loads the bundled
// GTK/WebKit stack from the transient /tmp/.mount_* directory. Children that
// execute *host* binaries must not inherit those values: the bundled
// libraries come from the build host and mismatch the running system (e.g.
// systemd tools abort with `OPENSSL_3.4.0' not found` on Fedora 44, ssh
// silently uses the bundled libcrypto instead of the host's patched one).
// Variables the hook overwrites wholesale are dropped — the pre-AppImage
// value is unrecoverable and a plain desktop shell would not have them set —
// while prepended path lists are filtered entry-by-entry so any entries the
// user had before launch survive. No-op outside an AppImage (no APPDIR).
fn sanitize_linux_appimage_environment(command: &mut CommandBuilder) {
    #[cfg(target_os = "linux")]
    {
        let Some(appdir) = crate::linux_env::appimage_dir() else {
            return;
        };

        for name in crate::linux_env::APPIMAGE_OVERWRITTEN_VARS {
            command.env_remove(name);
        }

        for name in crate::linux_env::APPIMAGE_PREPENDED_PATH_VARS {
            let Ok(value) = std::env::var(name) else {
                continue;
            };
            match crate::linux_env::filter_appimage_path_list(&value, &appdir) {
                Some(kept) => command.env(name, kept),
                None => command.env_remove(name),
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = command;
    }
}

// Compose the current user's environment from the registry exactly as Windows
// does for a freshly launched shell, returning `(name, value)` pairs. Returns an
// empty vec on failure so the caller can fall back to the allowlist.
#[cfg(target_os = "windows")]
fn windows_user_environment_block() -> Vec<(String, String)> {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::TOKEN_QUERY;
    use windows_sys::Win32::System::Environment::{
        CreateEnvironmentBlock, DestroyEnvironmentBlock,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut entries = Vec::new();
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return entries;
        }

        // bInherit = FALSE (0): compose the block purely from the registry
        // without overlaying this process's (stale, WebView2-polluted) env.
        let mut block: *mut core::ffi::c_void = std::ptr::null_mut();
        let created = CreateEnvironmentBlock(&mut block, token, 0);
        CloseHandle(token);
        if created == 0 || block.is_null() {
            return entries;
        }

        // The block is a sequence of NUL-terminated UTF-16 `KEY=VALUE` strings
        // terminated by a final empty string (a double NUL).
        let mut cursor = block as *const u16;
        loop {
            let mut len = 0isize;
            while *cursor.offset(len) != 0 {
                len += 1;
            }
            if len == 0 {
                break;
            }
            let slice = std::slice::from_raw_parts(cursor, len as usize);
            if let Some(pair) = split_windows_environment_entry(&String::from_utf16_lossy(slice)) {
                entries.push(pair);
            }
            cursor = cursor.offset(len + 1);
        }

        DestroyEnvironmentBlock(block);
    }
    entries
}

// Split a `KEY=VALUE` environment entry, preserving the leading `=` on Windows
// drive pseudo-variables (e.g. `=C:=C:\dir`) instead of producing an empty name.
#[cfg(target_os = "windows")]
fn split_windows_environment_entry(entry: &str) -> Option<(String, String)> {
    let search_from = usize::from(entry.starts_with('='));
    let separator = entry[search_from..].find('=')? + search_from;
    let name = &entry[..separator];
    if name.is_empty() {
        return None;
    }
    Some((name.to_string(), entry[separator + 1..].to_string()))
}

#[cfg(target_os = "windows")]
fn windows_documents_folder_path() -> Option<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::SHGetKnownFolderPath;
    use windows_sys::core::GUID;

    const FOLDERID_DOCUMENTS: GUID = GUID {
        data1: 0xfdd39ad0,
        data2: 0x238f,
        data3: 0x46af,
        data4: [0xad, 0xb4, 0x6c, 0x85, 0x48, 0x03, 0x69, 0xc7],
    };

    unsafe {
        let mut raw_path = std::ptr::null_mut();
        if SHGetKnownFolderPath(&FOLDERID_DOCUMENTS, 0, std::ptr::null_mut(), &mut raw_path) < 0
            || raw_path.is_null()
        {
            return None;
        }

        let mut len = 0;
        while *raw_path.add(len) != 0 {
            len += 1;
        }
        let path = OsString::from_wide(std::slice::from_raw_parts(raw_path, len));
        CoTaskMemFree(raw_path.cast());

        if path.is_empty() {
            None
        } else {
            Some(PathBuf::from(path))
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_powershell_module_path_for(
    inherited: impl AsRef<std::ffi::OsStr>,
    documents: &Path,
) -> String {
    let mut entries = Vec::new();
    push_unique_module_path(
        &mut entries,
        documents.join("WindowsPowerShell").join("Modules"),
    );
    push_unique_module_path(&mut entries, documents.join("PowerShell").join("Modules"));

    for entry in inherited.as_ref().to_string_lossy().split(';') {
        push_unique_module_path(&mut entries, PathBuf::from(entry.trim()));
    }

    entries
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(";")
}

#[cfg(target_os = "windows")]
fn push_unique_module_path(entries: &mut Vec<PathBuf>, path: PathBuf) {
    if path.as_os_str().is_empty() {
        return;
    }

    let normalized = path.to_string_lossy().to_ascii_lowercase();
    if entries
        .iter()
        .any(|entry| entry.to_string_lossy().to_ascii_lowercase() == normalized)
    {
        return;
    }

    entries.push(path);
}

fn resolved_local_shell_program(program: String) -> String {
    if is_windows_cmd_shell(&program) {
        windows_cmd_program()
    } else {
        program
    }
}

struct LocalShellCommandLine {
    program: String,
    args: Vec<String>,
}

fn parse_local_shell_command_line(command_line: &str) -> Result<LocalShellCommandLine, String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = command_line.trim().chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match ch {
            '"' | '\'' => {
                if quote == Some(ch) {
                    quote = None;
                } else if quote.is_none() {
                    quote = Some(ch);
                } else {
                    current.push(ch);
                }
            }
            '\\' => {
                if matches!(chars.peek(), Some('"') | Some('\'')) {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else {
                    current.push(ch);
                }
            }
            ch if ch.is_whitespace() && quote.is_none() => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }

    if quote.is_some() {
        return Err("local shell command line has an unclosed quote".to_string());
    }

    if !current.is_empty() {
        parts.push(current);
    }

    let parts = normalize_unquoted_windows_exe_path_parts(parts);
    let program = parts
        .first()
        .cloned()
        .ok_or_else(|| "local shell command line is required".to_string())?;
    let args = parts.into_iter().skip(1).collect();

    Ok(LocalShellCommandLine { program, args })
}

fn normalize_unquoted_windows_exe_path_parts(parts: Vec<String>) -> Vec<String> {
    if parts.len() < 2 {
        return parts;
    }

    let mut program_parts = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        program_parts.push(part.as_str());
        let joined = program_parts.join(" ");
        if windows_executable_path_has_suffix(&joined) {
            let mut normalized = Vec::with_capacity(parts.len() - index);
            normalized.push(joined);
            normalized.extend(parts.iter().skip(index + 1).cloned());
            return normalized;
        }
    }

    parts
}

fn windows_executable_path_has_suffix(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    [".exe", ".cmd", ".bat", ".com"]
        .iter()
        .any(|suffix| normalized.ends_with(suffix))
}

fn is_windows_cmd_shell(program: &str) -> bool {
    let trimmed = program.trim();
    if trimmed.is_empty() {
        return false;
    }

    let normalized = trimmed.replace('/', "\\").to_ascii_lowercase();
    normalized == "cmd" || normalized == "cmd.exe" || normalized.ends_with("\\cmd.exe")
}

fn windows_cmd_program() -> String {
    std::env::var("ComSpec")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "cmd.exe".to_string())
}

/// Whether the given local shell program can be launched. Mirrors how
/// `command_for` would resolve the program: `cmd` maps to `ComSpec`, and a
/// bare program name (no path separator) is searched across `PATH` using
/// `PATHEXT`. An absolute or relative path is checked directly. The pwsh
/// pre-flight gate is Windows-only; on other platforms this always returns
/// true so callers spawn `$SHELL` unchanged.
pub fn local_shell_available(shell: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        let Ok(parsed) = parse_local_shell_command_line(shell) else {
            return false;
        };
        let resolved = resolved_local_shell_program(parsed.program);
        if resolved.is_empty() {
            return false;
        }
        let path = std::path::Path::new(&resolved);
        if resolved.contains('\\') || resolved.contains('/') || path.is_absolute() {
            return path.is_file();
        }
        let pathext =
            std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        let exts: Vec<String> = pathext
            .split(';')
            .map(str::trim)
            .filter(|ext| !ext.is_empty())
            .map(str::to_string)
            .collect();
        let path_var = match std::env::var_os("PATH") {
            Some(value) => value,
            None => return false,
        };
        for dir in std::env::split_paths(&path_var) {
            // Direct match (the program already carries an extension, e.g. "pwsh.exe").
            if dir.join(&resolved).is_file() {
                return true;
            }
            // Extension-completed match (e.g. "pwsh" + ".EXE").
            for ext in &exts {
                if dir.join(format!("{resolved}{ext}")).is_file() {
                    return true;
                }
            }
        }
        false
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = shell;
        true
    }
}

fn initial_directory_for(request: &StartTerminalSessionRequest) -> Option<String> {
    request
        .initial_directory
        .as_deref()
        .map(str::trim)
        .filter(|directory| !directory.is_empty() && *directory != "~")
        .map(str::to_string)
}

fn remote_shell_command_for_initial_directory(directory: &str) -> String {
    format!(
        "cd -- {} && exec \"${{SHELL:-sh}}\" -i",
        shell_single_quote(directory)
    )
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn make_session_id(title: &str) -> String {
    let slug = title
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!(
        "{}-{unique}",
        if slug.is_empty() { "session" } else { &slug }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_output_decoder_preserves_multibyte_chars_split_across_chunks() {
        let mut decoder = TerminalOutputDecoder::default();

        assert_eq!(
            decoder.decode(b"10.62 kB \xE2"),
            Some("10.62 kB ".to_string())
        );
        assert_eq!(
            decoder.decode(b"\x94\x82 gzip: 3.29 kB"),
            Some("\u{2502} gzip: 3.29 kB".to_string())
        );
        assert_eq!(decoder.finish_lossy(), None);
    }

    #[test]
    fn terminal_output_decoder_flushes_truncated_final_sequence_lossily() {
        let mut decoder = TerminalOutputDecoder::default();

        assert_eq!(decoder.decode(b"abc \xE2"), Some("abc ".to_string()));
        assert_eq!(decoder.finish_lossy(), Some("\u{FFFD}".to_string()));
    }

    #[test]
    fn terminal_output_decoder_switches_to_big5_for_live_session() {
        let state = TerminalEncodingState::new("utf-8").expect("UTF-8 encoding");
        let mut decoder = TerminalOutputDecoder::new(state.clone());
        state.set("big5").expect("Big5 encoding");
        let (bytes, _, had_errors) = encoding_rs::BIG5.encode("中文");
        assert!(!had_errors);
        assert_eq!(decoder.decode(&bytes), Some("中文".to_string()));
    }

    #[test]
    fn appimage_path_list_filter_keeps_user_entries_only() {
        use crate::linux_env::filter_appimage_path_list;

        let appdir = "/tmp/.mount_kktermXXXXXX";
        // AppRun prepends every bundled lib dir; user had one entry of their own.
        assert_eq!(
            filter_appimage_path_list(
                "/tmp/.mount_kktermXXXXXX/usr/lib/:/tmp/.mount_kktermXXXXXX/usr/lib64/:/opt/custom/lib:",
                appdir
            ),
            Some("/opt/custom/lib".to_string())
        );
        // Entirely AppImage-injected: nothing left, caller should unset.
        assert_eq!(
            filter_appimage_path_list("/tmp/.mount_kktermXXXXXX/usr/lib/:", appdir),
            None
        );
        // The GTK hook prepends to XDG_DATA_DIRS; system entries survive.
        assert_eq!(
            filter_appimage_path_list(
                "/tmp/.mount_kktermXXXXXX/usr/share:/usr/share:/usr/local/share",
                appdir
            ),
            Some("/usr/share:/usr/local/share".to_string())
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn allowlist_includes_posh_themes_path() {
        assert!(
            WINDOWS_LOCAL_ENV_ALLOWLIST.contains(&"POSH_THEMES_PATH"),
            "oh-my-posh theme loading needs POSH_THEMES_PATH passed through"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn environment_entry_splits_name_and_value() {
        assert_eq!(
            split_windows_environment_entry("ANTHROPIC_BASE_URL=https://x/y"),
            Some(("ANTHROPIC_BASE_URL".to_string(), "https://x/y".to_string()))
        );
        // Drive pseudo-variables keep their leading '='.
        assert_eq!(
            split_windows_environment_entry(r"=C:=C:\dir"),
            Some(("=C:".to_string(), r"C:\dir".to_string()))
        );
        // A value may itself contain '='.
        assert_eq!(
            split_windows_environment_entry("KEY=a=b"),
            Some(("KEY".to_string(), "a=b".to_string()))
        );
        assert_eq!(split_windows_environment_entry("=novalue"), None);
        assert_eq!(split_windows_environment_entry(""), None);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn powershell_module_path_includes_redirected_documents_modules() {
        let inherited =
            r"C:\Users\Example\Documents\WindowsPowerShell\Modules;C:\Windows\System32\Modules";
        let documents = PathBuf::from(r"C:\Users\Example\OneDrive\Documents");

        let merged = windows_powershell_module_path_for(inherited, &documents);

        assert!(merged.contains(r"C:\Users\Example\OneDrive\Documents\WindowsPowerShell\Modules"));
        assert!(merged.contains(r"C:\Users\Example\OneDrive\Documents\PowerShell\Modules"));
        assert!(merged.contains(r"C:\Users\Example\Documents\WindowsPowerShell\Modules"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn local_shell_available_resolves_known_and_unknown_programs() {
        // cmd.exe resolves via ComSpec on every Windows host.
        assert!(local_shell_available("cmd.exe"));
        // powershell.exe (5.1) ships in System32 and is on PATH everywhere.
        assert!(local_shell_available("powershell.exe"));
        // A bogus program name must not resolve.
        assert!(!local_shell_available("kkterm-no-such-shell.exe"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn local_shell_available_is_permissive_off_windows() {
        // The pwsh pre-flight gate is Windows-only; elsewhere this is a no-op.
        assert!(local_shell_available("anything"));
    }

    #[test]
    fn local_shell_command_line_splits_program_and_arguments() {
        let parsed =
            parse_local_shell_command_line(r#""C:\Program Files\Git\bin\bash.exe" --login -i"#)
                .expect("quoted command line parses");

        assert_eq!(parsed.program, r"C:\Program Files\Git\bin\bash.exe");
        assert_eq!(parsed.args, vec!["--login", "-i"]);
    }

    #[test]
    fn local_shell_command_line_keeps_unquoted_windows_exe_path_with_spaces() {
        let parsed = parse_local_shell_command_line(r"C:\Program Files\Git\git-bash.exe --cd=~")
            .expect("unquoted Windows exe path parses");

        assert_eq!(parsed.program, r"C:\Program Files\Git\git-bash.exe");
        assert_eq!(parsed.args, vec!["--cd=~"]);
    }

    #[test]
    fn local_shell_command_line_keeps_bare_program_without_arguments() {
        let parsed = parse_local_shell_command_line("pwsh.exe").expect("bare command parses");

        assert_eq!(parsed.program, "pwsh.exe");
        assert!(parsed.args.is_empty());
    }

    #[test]
    fn parse_detected_remote_os_reads_os_release_and_kernel() {
        let detected = parse_detected_remote_os("ID=ubuntu\nID_LIKE=debian\nKERNEL=Linux\n");
        assert_eq!(detected.id.as_deref(), Some("ubuntu"));
        assert_eq!(detected.id_like.as_deref(), Some("debian"));
        assert_eq!(detected.kernel.as_deref(), Some("Linux"));
    }

    #[test]
    fn parse_detected_remote_os_lowercases_ids_and_strips_quotes() {
        let detected = parse_detected_remote_os("ID=\"RHEL\"\nID_LIKE=\"fedora\"\nKERNEL=Linux\n");
        assert_eq!(detected.id.as_deref(), Some("rhel"));
        assert_eq!(detected.id_like.as_deref(), Some("fedora"));
    }

    #[test]
    fn parse_detected_remote_os_handles_kernel_only_output() {
        let detected = parse_detected_remote_os("KERNEL=Darwin\n");
        assert_eq!(detected.id, None);
        assert_eq!(detected.id_like, None);
        assert_eq!(detected.kernel.as_deref(), Some("Darwin"));
    }

    #[test]
    fn parse_detected_remote_os_reads_model_and_app_markers() {
        let detected = parse_detected_remote_os(
            "ID=debian\nKERNEL=Linux\nMODEL=Raspberry Pi 5 Model B Rev 1.0\n",
        );
        assert_eq!(
            detected.model.as_deref(),
            Some("Raspberry Pi 5 Model B Rev 1.0")
        );
        let appliance = parse_detected_remote_os("ID=debian\nKERNEL=Linux\nAPP=Proxmox\n");
        assert_eq!(appliance.app.as_deref(), Some("proxmox"));
    }

    fn local_request() -> StartTerminalSessionRequest {
        StartTerminalSessionRequest {
            session_id: None,
            title: "Local shell".to_string(),
            connection_type: "local".to_string(),
            host: "localhost".to_string(),
            user: String::new(),
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_secret_owner_id: None,
            ssh_compression: None,
            ssh_old_protocols: None,
            auth_method: None,
            secret_owner_id: None,
            passphrase_owner_id: None,
            shell: None,
            serial_line: None,
            serial_speed: None,
            initial_directory: None,
            environment_variables: Vec::new(),
            cols: None,
            pixel_height: None,
            pixel_width: None,
            rows: None,
            use_tmux: None,
            tmux_session_id: None,
            use_psmux: None,
            psmux_session_id: None,
            ssh_buffer_lines: None,
            text_encoding: default_terminal_encoding(),
        }
    }

    #[test]
    fn ssh_auth_method_prefers_explicit_agent_and_key_file() {
        let mut request = ssh_request();

        request.auth_method = Some("agent".to_string());
        assert!(matches!(
            ssh_auth_method_for(&request, None),
            Ok(SshAuthMethod::Agent)
        ));

        request.auth_method = Some("keyFile".to_string());
        request.key_path = Some("C:\\Users\\example\\.ssh\\id_ed25519".to_string());
        assert!(matches!(
            ssh_auth_method_for(&request, None),
            Ok(SshAuthMethod::KeyFile)
        ));
    }

    #[test]
    fn password_auth_requires_explicit_password_method_before_reading_keychain() {
        let mut request = ssh_request();
        request.auth_method = Some("password".to_string());
        assert!(matches!(
            ssh_auth_method_for(&request, Some("not-for-sqlite")),
            Ok(SshAuthMethod::Password)
        ));

        request.auth_method = Some("keyboardInteractive".to_string());
        assert!(ssh_auth_method_for(&request, None).is_err());
    }

    #[test]
    fn password_auth_without_stored_secret_uses_native_interactive_auth_even_with_key_path() {
        let mut request = ssh_request();
        request.auth_method = Some("password".to_string());
        request.key_path = Some("C:\\Users\\example\\.ssh\\id_ed25519".to_string());
        let auth_method = ssh_auth_method_for(&request, None).expect("auth method resolves");

        assert!(uses_native_ssh(&request, None, &auth_method, true));
        assert!(!uses_native_ssh(&request, None, &auth_method, false));
    }

    #[test]
    fn password_auth_ignores_stale_key_path_for_native_eligibility() {
        let mut request = ssh_request();
        request.auth_method = Some("password".to_string());
        request.key_path = Some("C:\\Users\\example\\.ssh\\id_ed25519".to_string());
        request.proxy_jump = Some("bastion".to_string());
        let auth_method = ssh_auth_method_for(&request, None).expect("auth method resolves");

        assert!(
            !uses_native_ssh(&request, None, &auth_method, true),
            "ProxyJump, not a stale key path, should be what disqualifies native SSH here"
        );
    }

    #[test]
    fn ssh_forward_bind_conflicts_follow_wildcard_and_address_family_rules() {
        let localhost_v4 = "127.0.0.1".parse::<IpAddr>().unwrap();
        let another_v4 = "127.0.0.2".parse::<IpAddr>().unwrap();
        let wildcard_v4 = "0.0.0.0".parse::<IpAddr>().unwrap();
        let localhost_v6 = "::1".parse::<IpAddr>().unwrap();
        let wildcard_v6 = "::".parse::<IpAddr>().unwrap();

        assert!(ssh_forward_bind_addresses_overlap(
            localhost_v4,
            localhost_v4
        ));
        assert!(ssh_forward_bind_addresses_overlap(
            localhost_v4,
            wildcard_v4
        ));
        assert!(ssh_forward_bind_addresses_overlap(
            localhost_v6,
            wildcard_v6
        ));
        assert!(!ssh_forward_bind_addresses_overlap(
            localhost_v4,
            another_v4
        ));
        assert!(!ssh_forward_bind_addresses_overlap(
            localhost_v4,
            wildcard_v6
        ));
    }

    #[test]
    fn native_auth_errors_fallback_to_interactive_ssh() {
        assert!(should_fallback_to_interactive_ssh(
            "SSH agent authentication was unavailable: Pageant agent failed to list SSH agent identities: early eof"
        ));
        assert!(should_fallback_to_interactive_ssh(
            "SSH key-file authentication failed: invalid key"
        ));
        assert!(should_fallback_to_interactive_ssh(
            "SSH password authentication failed: rejected"
        ));
        assert!(!should_fallback_to_interactive_ssh(
            "SSH host key for example.internal:22 changed"
        ));
        assert!(!should_fallback_to_interactive_ssh(
            "failed to open SSH channel"
        ));
    }

    fn ssh_request() -> StartTerminalSessionRequest {
        StartTerminalSessionRequest {
            session_id: None,
            title: "Test SSH".to_string(),
            connection_type: "ssh".to_string(),
            host: "example.internal".to_string(),
            user: "admin".to_string(),
            port: Some(22),
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_secret_owner_id: None,
            ssh_compression: None,
            ssh_old_protocols: None,
            auth_method: None,
            secret_owner_id: None,
            passphrase_owner_id: None,
            shell: None,
            serial_line: None,
            serial_speed: None,
            initial_directory: None,
            environment_variables: Vec::new(),
            cols: None,
            pixel_height: None,
            pixel_width: None,
            rows: None,
            use_tmux: None,
            tmux_session_id: None,
            use_psmux: None,
            psmux_session_id: None,
            ssh_buffer_lines: None,
            text_encoding: default_terminal_encoding(),
        }
    }

    #[test]
    fn remote_initial_directory_command_quotes_shell_path() {
        assert_eq!(
            remote_shell_command_for_initial_directory("/srv/releases"),
            "cd -- '/srv/releases' && exec \"${SHELL:-sh}\" -i"
        );
        assert_eq!(
            remote_shell_command_for_initial_directory("/srv/app's current"),
            "cd -- '/srv/app'\\''s current' && exec \"${SHELL:-sh}\" -i"
        );
    }

    #[test]
    fn terminal_commands_advertise_xterm_truecolor_capabilities() {
        let mut command = CommandBuilder::new("shell");
        set_terminal_environment(&mut command);

        assert_eq!(
            command.get_env("TERM").and_then(|value| value.to_str()),
            Some("xterm-256color")
        );
        assert_eq!(
            command
                .get_env("COLORTERM")
                .and_then(|value| value.to_str()),
            Some("truecolor")
        );
    }

    #[test]
    fn macos_local_utf8_locale_follows_the_terminal_encoding() {
        assert_eq!(macos_default_lc_ctype("utf-8"), Some("UTF-8"));
        assert_eq!(macos_default_lc_ctype("UTF8"), Some("UTF-8"));
        assert_eq!(macos_default_lc_ctype("big5"), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn connection_locale_override_wins_over_the_macos_utf8_default() {
        let mut request = local_request();
        request.environment_variables = vec![ManagedTerminalEnvironmentVariable {
            name: "LC_CTYPE".to_string(),
            value: "zh_TW.Big5".to_string(),
            source: "literal".to_string(),
        }];

        let command = command_for(&request).expect("local zsh command should build");
        assert_eq!(
            command.get_env("LC_CTYPE").and_then(|value| value.to_str()),
            Some("zh_TW.Big5")
        );
    }

    #[test]
    fn managed_cli_account_environment_is_resolved_and_created_before_spawn() {
        let root = tempfile::tempdir().expect("temporary data root");
        let variable = ManagedTerminalEnvironmentVariable {
            name: "CLAUDE_CONFIG_DIR".to_string(),
            value: "$env:LOCALAPPDATA\\KKTerm\\cli-accounts\\claude-code\\work".to_string(),
            source: "cliAccount".to_string(),
        };

        let resolved = resolve_managed_terminal_environment(&variable, root.path())
            .expect("managed environment resolves");
        // The app data folder name matches the resolver: "KKTerm" on Windows,
        // lowercase "kkterm" elsewhere.
        let expected = root
            .path()
            .join(if cfg!(target_os = "windows") {
                "KKTerm"
            } else {
                "kkterm"
            })
            .join("cli-accounts")
            .join("claude-code")
            .join("work");

        assert_eq!(
            resolved,
            (
                "CLAUDE_CONFIG_DIR".to_string(),
                expected.clone().into_os_string()
            )
        );
        assert!(
            expected.is_dir(),
            "account directory should exist before shell spawn"
        );
    }

    #[test]
    fn recognizes_cmd_shell_names_and_paths() {
        assert!(is_windows_cmd_shell("cmd"));
        assert!(is_windows_cmd_shell("cmd.exe"));
        assert!(is_windows_cmd_shell("C:/Windows/System32/cmd.exe"));
        assert!(is_windows_cmd_shell("C:\\Windows\\System32\\cmd.exe"));
        assert!(!is_windows_cmd_shell("powershell.exe"));
    }

    #[test]
    fn local_cmd_sessions_disable_command_processor_autorun() {
        let mut request = local_request();
        request.shell = Some("cmd.exe".to_string());

        let command = command_for(&request).expect("local cmd command should build");
        let argv = command
            .get_argv()
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(argv, vec![windows_cmd_program(), "/D".to_string()]);
    }

    #[test]
    fn terminal_pty_size_preserves_pixel_dimensions() {
        let mut request = ssh_request();
        request.cols = Some(132);
        request.rows = Some(43);
        request.pixel_width = Some(1200);
        request.pixel_height = Some(720);

        let size = pty_size_for(&request);

        assert_eq!(size.cols, 132);
        assert_eq!(size.rows, 43);
        assert_eq!(size.pixel_width, 1200);
        assert_eq!(size.pixel_height, 720);
    }

    #[test]
    fn tmux_capture_pane_command_targets_session_history() {
        assert_eq!(
            tmux_capture_pane_command("kkterm-test", 5_000),
            "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux capture-pane -p -S -5000 -t 'kkterm-test':"
        );
    }

    #[test]
    fn tmux_set_mouse_command_checks_tmux_availability() {
        assert_eq!(
            tmux_set_mouse_command("kkterm-test", "on"),
            "if command -v tmux >/dev/null 2>&1; then tmux set-option -t 'kkterm-test' mouse on; fi"
        );
    }

    #[test]
    fn tmux_scroll_pane_command_enters_copy_mode_for_wheel_up() {
        assert_eq!(
            tmux_scroll_pane_command("kkterm-test", -4),
            "tmux copy-mode -e -t 'kkterm-test': \\; send-keys -X -t 'kkterm-test': -N 4 scroll-up"
        );
    }

    #[test]
    fn tmux_scroll_pane_command_scrolls_down_only_in_copy_mode() {
        assert_eq!(
            tmux_scroll_pane_command("kkterm-test", 3),
            "tmux send-keys -X -t 'kkterm-test': -N 3 scroll-down 2>/dev/null || true"
        );
    }

    #[test]
    fn tmux_scroll_pane_command_quotes_session_id() {
        assert_eq!(
            tmux_scroll_pane_command("kkterm-test'quoted", -1),
            "tmux copy-mode -e -t 'kkterm-test'\\''quoted': \\; send-keys -X -t 'kkterm-test'\\''quoted': -N 1 scroll-up"
        );
    }

    #[test]
    fn tmux_capture_pane_command_quotes_session_id() {
        assert_eq!(
            tmux_capture_pane_command("kkterm-test'quoted", 5_000),
            "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux capture-pane -p -S -5000 -t 'kkterm-test'\\''quoted':"
        );
    }

    #[test]
    fn tmux_capture_pane_command_uses_requested_history_limit() {
        assert_eq!(
            tmux_capture_pane_command("kkterm-test", 12_000),
            "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux capture-pane -p -S -12000 -t 'kkterm-test':"
        );
    }

    #[test]
    fn tmux_current_path_command_targets_active_pane_path() {
        assert_eq!(
            tmux_current_path_command("kkterm-test"),
            "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux display-message -p -t 'kkterm-test': '#{pane_current_path}'"
        );
    }

    #[test]
    fn tmux_current_path_command_quotes_session_id() {
        assert_eq!(
            tmux_current_path_command("kkterm-test'quoted"),
            "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux display-message -p -t 'kkterm-test'\\''quoted': '#{pane_current_path}'"
        );
    }

    #[test]
    fn recording_folder_name_keeps_connection_name_and_id_fragment() {
        assert_eq!(
            recording_folder_name("conn-1234567890abcdef", "Prod / East: SSH"),
            "prod-east-ssh--conn-12345678"
        );
        assert_eq!(
            recording_folder_name("quick-connection", "   "),
            "connection--quick-co"
        );
    }

    #[test]
    fn terminal_recording_writes_initial_buffer_then_live_output() {
        let root = temp_recording_root("initial-buffer");
        let manager = TerminalRecordingManager::new_for_root(root.clone());
        let started = manager
            .start_recording(StartTerminalRecordingRequest {
                session_id: "session-123".to_string(),
                connection_id: "conn-1234567890abcdef".to_string(),
                connection_name: "Prod East".to_string(),
                initial_buffer: "existing line\n".to_string(),
                rows: None,
                cols: None,
            })
            .expect("recording starts");

        manager
            .record_output("session-123", "new line\r\n")
            .expect("live output records");
        let stopped = manager
            .stop_recording("session-123".to_string())
            .expect("recording stops")
            .expect("recording existed");

        assert_eq!(started.path, stopped.path);
        let text = std::fs::read_to_string(&stopped.path).expect("recording file reads");
        assert_eq!(text, "existing line\nnew line\n");
        assert!(
            stopped
                .path
                .starts_with(root.join("prod-east").join("prod-east--conn-12345678"))
        );
    }

    #[test]
    fn terminal_recording_renders_escape_sequences_to_plain_text() {
        let root = temp_recording_root("conpty-garble");
        let manager = TerminalRecordingManager::new_for_root(root);
        let started = manager
            .start_recording(StartTerminalRecordingRequest {
                session_id: "session-123".to_string(),
                connection_id: "conn-456".to_string(),
                connection_name: "Local".to_string(),
                initial_buffer: String::new(),
                rows: Some(24),
                cols: Some(80),
            })
            .expect("recording starts");

        // ConPTY-style stream: mode sets, title, clear, repaint with erases.
        manager
            .record_output(
                "session-123",
                "\x1b[?9001h\x1b[?1004h\x1b[?25l\x1b[2J\x1b[m\x1b[HWindows PowerShell\r\n\
                 \x1b]0;C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\x07\
                 \x1b[HWindows PowerShell\x1b[K\r\n\x1b[KPS C:\\Users\\ryan> \x1b[?25h",
            )
            .expect("live output records");
        manager
            .stop_recording("session-123".to_string())
            .expect("recording stops")
            .expect("recording existed");

        let text = std::fs::read_to_string(&started.path).expect("recording file reads");
        assert_eq!(text, "Windows PowerShell\nPS C:\\Users\\ryan>\n");
    }

    #[test]
    fn terminal_recording_rejects_duplicate_start_without_truncating_output() {
        let root = temp_recording_root("duplicate-start");
        let manager = TerminalRecordingManager::new_for_root(root);
        let started = manager
            .start_recording(StartTerminalRecordingRequest {
                session_id: "session-123".to_string(),
                connection_id: "conn-456".to_string(),
                connection_name: "Production".to_string(),
                initial_buffer: "existing output".to_string(),
                rows: None,
                cols: None,
            })
            .expect("first recording starts");

        let duplicate = manager.start_recording(StartTerminalRecordingRequest {
            session_id: "session-123".to_string(),
            connection_id: "conn-456".to_string(),
            connection_name: "Production".to_string(),
            initial_buffer: "replacement output".to_string(),
            rows: None,
            cols: None,
        });

        assert!(matches!(
            duplicate,
            Err(ref message) if message == "terminal recording is already active"
        ));
        manager
            .record_output("session-123", "live output\n")
            .expect("live output writes");
        manager
            .stop_recording("session-123".to_string())
            .expect("recording stops")
            .expect("recording existed");
        let text = std::fs::read_to_string(&started.path).expect("recording file reads");
        assert_eq!(text, "existing output\nlive output\n");
    }

    #[test]
    fn universal_recording_index_search_summary_cache_and_export_share_safe_paths() {
        let root = temp_recording_root("browser");
        let manager = TerminalRecordingManager::new_for_root(root.clone());
        let started = manager
            .start_recording(StartTerminalRecordingRequest {
                session_id: "session-browser".to_string(),
                connection_id: "conn-1234567890abcdef".to_string(),
                connection_name: "Prod East".to_string(),
                initial_buffer: "$ sudo systemctl restart nginx\r\n".to_string(),
                rows: Some(24),
                cols: Some(80),
            })
            .expect("recording starts");
        for index in 0..500 {
            manager
                .record_output(
                    "session-browser",
                    &format!(
                        "line {index}\r\n{}",
                        if index == 410 {
                            "ERROR upstream timed out\r\n"
                        } else {
                            ""
                        }
                    ),
                )
                .expect("recording output appends");
        }
        manager
            .stop_recording("session-browser".to_string())
            .expect("recording stops");

        let indexed = list_all_terminal_recordings(root.clone()).expect("universal index loads");
        assert_eq!(indexed.len(), 1);
        assert_eq!(indexed[0].connection_id_fragment, "conn-12345678");
        assert_eq!(indexed[0].connection_folder_label, "prod-east");
        assert!(indexed[0].started_at_millis.is_some());

        let matches = search_terminal_recordings(root.clone(), "upstream timed out")
            .expect("command-based search succeeds");
        assert_eq!(matches.len(), 1);

        let summary_input = prepare_terminal_recording_summary(
            root.clone(),
            started.path.to_string_lossy().as_ref(),
        )
        .expect("summary input is prepared");
        assert_eq!(summary_input.total_lines, 502);
        assert!(summary_input.sample.len() <= 24 * 1024);
        assert!(summary_input.sample.contains("systemctl restart nginx"));
        assert!(summary_input.sample.contains("ERROR upstream timed out"));

        save_terminal_recording_summary(
            root.clone(),
            SaveTerminalRecordingSummaryRequest {
                path: started.path.to_string_lossy().to_string(),
                summary: "Restarted nginx; a later upstream timeout remained visible.".to_string(),
                preview: summary_input.preview,
                provider_kind: "openai".to_string(),
                model: "test-model".to_string(),
            },
        )
        .expect("summary cache saves");
        let cached = list_all_terminal_recordings(root.clone()).expect("cached index loads");
        assert_eq!(
            cached[0].ai_summary.as_deref(),
            Some("Restarted nginx; a later upstream timeout remained visible.")
        );
        assert_eq!(cached[0].ai_summary_model.as_deref(), Some("test-model"));

        let destination = root.join("export.zip");
        let exported = export_terminal_recordings(
            root.clone(),
            ExportTerminalRecordingsRequest {
                paths: vec![started.path.to_string_lossy().to_string()],
                destination: destination.to_string_lossy().to_string(),
            },
        )
        .expect("recording archive exports");
        assert_eq!(exported.count, 1);
        let file = File::open(&destination).expect("archive opens");
        let archive = zip::ZipArchive::new(file).expect("archive is valid");
        assert_eq!(archive.len(), 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn terminal_recording_export_is_flat_and_suffixes_duplicate_file_names() {
        let root = temp_recording_root("flat-export");
        let first_folder = root.join("group-a").join("connection-a");
        let second_folder = root.join("group-b").join("connection-b");
        fs::create_dir_all(&first_folder).expect("first recording folder exists");
        fs::create_dir_all(&second_folder).expect("second recording folder exists");
        let first = first_folder.join("session.log.txt");
        let second = second_folder.join("session.log.txt");
        fs::write(&first, "first").expect("first recording writes");
        fs::write(&second, "second").expect("second recording writes");
        let destination = root.join("export.zip");

        export_terminal_recordings(
            root.clone(),
            ExportTerminalRecordingsRequest {
                paths: vec![
                    first.to_string_lossy().to_string(),
                    second.to_string_lossy().to_string(),
                ],
                destination: destination.to_string_lossy().to_string(),
            },
        )
        .expect("recording archive exports");

        let file = File::open(&destination).expect("archive opens");
        let mut archive = zip::ZipArchive::new(file).expect("archive is valid");
        let names = (0..archive.len())
            .map(|index| {
                archive
                    .by_index(index)
                    .expect("archive entry opens")
                    .name()
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["session.log.txt", "session.log (2).txt"]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn session_manager_rejects_recording_after_session_closes() {
        let root = temp_recording_root("closed-session");
        let manager = SessionManager::new();

        let result = manager.start_terminal_recording(
            root.clone(),
            StartTerminalRecordingRequest {
                session_id: "closed-session".to_string(),
                connection_id: "conn-456".to_string(),
                connection_name: "Production".to_string(),
                initial_buffer: String::new(),
                rows: None,
                cols: None,
            },
        );

        assert!(matches!(
            result,
            Err(ref message) if message == "terminal session is not active"
        ));
        assert!(!root.exists());
    }

    #[test]
    fn tmux_rename_session_command_quotes_old_and_new_session_ids() {
        assert_eq!(
            tmux_rename_session_command("kkterm-test'old", "kkterm-test'new"),
            "if command -v tmux >/dev/null 2>&1; then tmux rename-session -t 'kkterm-test'\\''old' 'kkterm-test'\\''new'; fi"
        );
    }

    #[test]
    fn required_tmux_session_id_rejects_tmux_target_delimiters() {
        assert!(required_tmux_session_id("has space".to_string()).is_err());
        assert!(required_tmux_session_id("has:colon".to_string()).is_err());
        assert!(required_tmux_session_id("has:semicolon".to_string()).is_err());
    }

    #[test]
    fn psmux_wrapping_targets_only_powershell_family_shells() {
        // psmux session management mirrors SSH tmux but applies only to the
        // PowerShell family; cmd / bash / wsl shells are launched plainly.
        assert!(is_powershell_family_program("powershell.exe"));
        assert!(is_powershell_family_program("pwsh.exe"));
        assert!(is_powershell_family_program(
            r"C:\Program Files\PowerShell\7\pwsh.exe"
        ));
        assert!(!is_powershell_family_program("cmd.exe"));
        assert!(!is_powershell_family_program("bash.exe"));
        assert!(!is_powershell_family_program("wsl.exe"));
    }

    #[test]
    fn psmux_session_id_for_launch_validates_and_trims() {
        assert_eq!(
            psmux_session_id_for_launch(Some("  cockpit001  ")).as_deref(),
            Some("cockpit001")
        );
        assert_eq!(psmux_session_id_for_launch(None), None);
        assert_eq!(psmux_session_id_for_launch(Some("   ")), None);
        // tmux/psmux target delimiters are rejected, matching the SSH path.
        assert_eq!(psmux_session_id_for_launch(Some("has:colon")), None);
    }

    #[test]
    fn psmux_pane_environment_refreshes_current_path() {
        let mut command = CommandBuilder::new("psmux.exe");
        command.env("PATH", "C:\\a;C:\\b");

        // A stale psmux server would otherwise leave the pane with an outdated
        // PATH; `new-session -e PATH=...` pins the effective launch PATH so
        // tools like `claude` stay discoverable.
        let args = psmux_pane_environment_args(&command, &[])
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(args, vec!["-e".to_string(), "PATH=C:\\a;C:\\b".to_string()]);

        // No PATH (or an empty one) means nothing to refresh.
        let mut empty_command = CommandBuilder::new("psmux.exe");
        empty_command.env_clear();
        assert!(psmux_pane_environment_args(&empty_command, &[]).is_empty());
        command.env("PATH", OsString::new());
        assert!(psmux_pane_environment_args(&command, &[]).is_empty());
    }

    #[test]
    fn psmux_pane_environment_refreshes_managed_cli_account_vars() {
        let mut command = CommandBuilder::new("psmux.exe");
        command.env("PATH", "C:\\Windows\\System32");
        command.env(
            "CODEX_HOME",
            "C:\\Users\\example\\AppData\\Local\\KKTerm\\cli-accounts\\codex\\work",
        );
        command.env(
            "CLAUDE_CONFIG_DIR",
            "C:\\Users\\example\\AppData\\Local\\KKTerm\\cli-accounts\\claude-code\\work",
        );
        let variables = vec![
            ManagedTerminalEnvironmentVariable {
                name: "CODEX_HOME".to_string(),
                value: "$env:LOCALAPPDATA\\KKTerm\\cli-accounts\\codex\\work".to_string(),
                source: "cliAccount".to_string(),
            },
            ManagedTerminalEnvironmentVariable {
                name: "CODEX_HOME".to_string(),
                value: "$env:LOCALAPPDATA\\KKTerm\\cli-accounts\\codex\\work".to_string(),
                source: "cliAccount".to_string(),
            },
            ManagedTerminalEnvironmentVariable {
                name: "CLAUDE_CONFIG_DIR".to_string(),
                value: "$env:LOCALAPPDATA\\KKTerm\\cli-accounts\\claude-code\\work".to_string(),
                source: "cliAccount".to_string(),
            },
        ];

        let args = psmux_pane_environment_args(&command, &variables)
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            vec![
                "-e".to_string(),
                "PATH=C:\\Windows\\System32".to_string(),
                "-e".to_string(),
                "CODEX_HOME=C:\\Users\\example\\AppData\\Local\\KKTerm\\cli-accounts\\codex\\work"
                    .to_string(),
                "-e".to_string(),
                "CLAUDE_CONFIG_DIR=C:\\Users\\example\\AppData\\Local\\KKTerm\\cli-accounts\\claude-code\\work"
                    .to_string(),
            ]
        );
    }

    #[test]
    fn psmux_command_output_rejects_failed_commands() {
        assert_eq!(
            psmux_command_output(false, b"", b"can't find session: missing"),
            Err("psmux command failed: can't find session: missing".to_string())
        );
        assert_eq!(
            psmux_command_output(false, b"", b"  "),
            Err("psmux command failed".to_string())
        );
        assert_eq!(
            psmux_command_output(true, b"session output\n", b"ignored warning"),
            Ok("session output\n".to_string())
        );
    }

    #[test]
    fn parses_loopback_ports_from_ss_output() {
        let output = "\
LISTEN 0 4096 127.0.0.1:3000 0.0.0.0:*
LISTEN 0 4096 0.0.0.0:8080 0.0.0.0:*
LISTEN 0 4096 [::1]:9090 [::]:*
";

        let ports = parse_remote_loopback_ports(output);

        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].port, 3000);
        assert_eq!(ports[1].port, 9090);
    }

    #[test]
    fn parses_loopback_ports_from_lsof_output() {
        let output = "\
COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
node 123 user 21u IPv4 0x0 0t0 TCP 127.0.0.1:5173 (LISTEN)
python 124 user 22u IPv4 0x0 0t0 TCP TCP@localhost:8000 (LISTEN)
";

        let ports = parse_remote_loopback_ports(output);

        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].port, 5173);
        assert_eq!(ports[1].port, 8000);
    }

    #[test]
    fn parses_remote_network_addresses_from_probe_output() {
        let output = "127.0.0.1/8\n10.0.0.42/24\nfe80::1234%eth0/64\n::1/128\ninvalid\n";

        assert_eq!(
            parse_remote_network_addresses(output),
            vec![
                "127.0.0.1".to_string(),
                "10.0.0.42".to_string(),
                "fe80::1234".to_string(),
                "::1".to_string(),
            ]
        );
    }

    #[test]
    fn parses_local_tcp_listener_endpoints() {
        let output = "127.0.0.1\t1420\n0.0.0.0\t3000\n::1\t8443\ninvalid\tvalue\n";

        assert_eq!(
            parse_local_tcp_listeners(output),
            vec![
                LocalTcpListener {
                    address: "0.0.0.0".into(),
                    port: 3000,
                },
                LocalTcpListener {
                    address: "127.0.0.1".into(),
                    port: 1420,
                },
                LocalTcpListener {
                    address: "::1".into(),
                    port: 8443,
                },
            ]
        );
    }

    #[test]
    fn local_tcp_listener_parser_deduplicates() {
        assert_eq!(
            parse_local_tcp_listeners("127.0.0.1\t3000\n127.0.0.1\t3000\n").len(),
            1
        );
    }

    #[test]
    fn filters_common_loopback_ports_except_web_ports() {
        let ports = vec![
            RemoteLoopbackPort {
                port: 22,
                address: "127.0.0.1".to_string(),
            },
            RemoteLoopbackPort {
                port: 53,
                address: "127.0.0.1".to_string(),
            },
            RemoteLoopbackPort {
                port: 80,
                address: "127.0.0.1".to_string(),
            },
            RemoteLoopbackPort {
                port: 443,
                address: "127.0.0.1".to_string(),
            },
            RemoteLoopbackPort {
                port: 1023,
                address: "127.0.0.1".to_string(),
            },
            RemoteLoopbackPort {
                port: 3000,
                address: "127.0.0.1".to_string(),
            },
        ];

        let filtered = filter_remote_loopback_ports(ports, true);

        assert_eq!(
            filtered.iter().map(|entry| entry.port).collect::<Vec<_>>(),
            vec![80, 443, 3000]
        );
    }

    fn temp_recording_root(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "kkterm-recordings-{name}-{}-{unique}",
            std::process::id()
        ))
    }
}

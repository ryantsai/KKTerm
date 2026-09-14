use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;
#[cfg(not(target_os = "macos"))]
use tauri::{PhysicalPosition, Position, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::installer::detect::github_release_install_dir;

#[cfg(target_os = "windows")]
mod windows;

enum RecordingBackend {
    Ffmpeg(Child),
    #[cfg(target_os = "windows")]
    Windows(windows::NativeRecording),
}

impl RecordingBackend {
    fn pause(&mut self, paused: bool) -> Result<(), String> {
        match self {
            Self::Ffmpeg(child) => set_process_paused(child.id(), paused),
            #[cfg(target_os = "windows")]
            Self::Windows(recording) => {
                recording.pause(paused);
                Ok(())
            }
        }
    }

    fn abort(&mut self) {
        match self {
            Self::Ffmpeg(child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            #[cfg(target_os = "windows")]
            Self::Windows(recording) => {
                let _ = recording.finish();
            }
        }
    }

    fn finish(self) -> Result<(), String> {
        match self {
            Self::Ffmpeg(mut child) => {
                if let Some(stdin) = child.stdin.as_mut() {
                    // Even if FFmpeg already exited, collect stderr and reap it.
                    let _ = stdin.write_all(b"q\n");
                }
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("failed to finish FFmpeg: {e}"))?;
                if output.status.success() {
                    return Ok(());
                }
                let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
                Err(if message.is_empty() {
                    "FFmpeg recording failed".to_string()
                } else {
                    message
                })
            }
            #[cfg(target_os = "windows")]
            Self::Windows(mut recording) => recording.finish(),
        }
    }
}

const TOOL_ID: &str = "ffmpeg";
pub const RECORDING_STARTED_EVENT: &str = "kkterm://video-recording-started";
pub const RECORDING_COMPLETED_EVENT: &str = "kkterm://video-recording-completed";
#[cfg(not(target_os = "macos"))]
const CONTROLS_WINDOW_LABEL: &str = "video-recording-controls";
#[cfg(not(target_os = "macos"))]
const CONTROLS_WINDOW_ROUTE: &str = "index.html#/video-recording-controls";
#[cfg(not(target_os = "macos"))]
const CONTROLS_WIDTH: i32 = 124;
#[cfg(not(target_os = "macos"))]
const CONTROLS_HEIGHT: i32 = 42;
#[cfg(not(target_os = "macos"))]
const CONTROLS_TARGET_INSET: i32 = 10;

#[derive(Default)]
pub struct VideoRecordingState {
    active: Mutex<Option<ActiveRecording>>,
    finalizing: AtomicBool,
}

impl Drop for VideoRecordingState {
    fn drop(&mut self) {
        if let Ok(active) = self.active.get_mut()
            && let Some(recording) = active.as_mut()
        {
            recording.backend.abort();
        }
    }
}

struct ActiveRecording {
    backend: RecordingBackend,
    path: PathBuf,
    started_at: u128,
    paused_at: Option<u128>,
    paused_duration_ms: u128,
    mode: String,
    format: String,
    width: Option<u32>,
    height: Option<u32>,
}

#[cfg(not(target_os = "macos"))]
#[derive(Clone, Copy)]
struct RecordingTarget {
    x: i32,
    y: i32,
    width: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDependencyStatus {
    available: bool,
    source: Option<String>,
    tool_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartVideoRecordingRequest {
    mode: String,
    #[serde(default = "default_frame_rate")]
    frame_rate: u32,
    use_directx: bool,
    minimize_window: bool,
}

fn default_frame_rate() -> u32 {
    30
}

fn capture_frame_rate(frame_rate: u32, format: &str) -> Result<u32, String> {
    if !matches!(frame_rate, 30 | 60 | 120) {
        return Err("video frame rate must be 30, 60, or 120".to_string());
    }
    // GIF export is capped at 15 fps; capturing more only wastes resources.
    Ok(if format == "gif" { 15 } else { frame_rate })
}

fn add_h264_encoder_args(command: &mut Command, encoder: &str) {
    command.args(["-c:v", encoder]);
    match encoder {
        "h264_nvenc" => {
            command.args(["-preset", "p1", "-rc", "vbr", "-cq", "23", "-b:v", "0"]);
        }
        "h264_qsv" => {
            command.args(["-preset", "veryfast", "-global_quality", "23"]);
        }
        "h264_amf" => {
            command.args([
                "-quality", "speed", "-rc", "cqp", "-qp_i", "23", "-qp_p", "23",
            ]);
        }
        "h264_videotoolbox" => {
            command.args(["-allow_sw", "0", "-b:v", "20M"]);
        }
        _ => {
            command.args(["-preset", "veryfast", "-crf", "23"]);
        }
    }
}

fn select_h264_encoder(program: &str, width: u32, height: u32, frame_rate: u32) -> &'static str {
    // A compiled-in encoder is not proof of working hardware/drivers. Encode a
    // few synthetic frames at the target dimensions/rate before selecting it.
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["h264_nvenc", "h264_qsv", "h264_amf"]
    } else if cfg!(target_os = "macos") {
        &["h264_videotoolbox"]
    } else {
        &["h264_nvenc", "h264_qsv"]
    };
    for &encoder in candidates {
        let mut probe = Command::new(program);
        probe.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-f",
            "lavfi",
            "-i",
            &format!(
                "color=size={}x{}:rate={frame_rate}",
                width.max(2),
                height.max(2)
            ),
            "-frames:v",
            "3",
        ]);
        add_mp4_encoding_args(&mut probe, encoder);
        probe.args(["-f", "null", "-"]);
        let Ok(mut child) = hide_window(&mut probe)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        else {
            continue;
        };
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if status.success() {
                        return encoder;
                    }
                    break;
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
            }
        }
    }
    "libx264"
}

fn add_mp4_encoding_args(command: &mut Command, encoder: &str) {
    command.args(["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]);
    add_h264_encoder_args(command, encoder);
    command.args(["-pix_fmt", "yuv420p", "-movflags", "+faststart"]);
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRecordingSession {
    path: String,
    file_name: String,
    started_at: u128,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedVideoRecording {
    path: String,
    file_name: String,
    started_at: u128,
    duration_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRecordingStatus {
    active: bool,
    paused: bool,
    file_name: Option<String>,
    started_at: Option<u128>,
    elapsed_ms: u128,
    mode: Option<String>,
    format: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimVideoRequest {
    source_path: String,
    start_seconds: f64,
    end_seconds: f64,
}

fn hide_window(command: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    command
}

fn find_in_dir(dir: &Path, target: &str, depth: u32) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let mut dirs = Vec::new();
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path);
        } else if path.file_name().and_then(|name| name.to_str()) == Some(target) {
            return Some(path);
        }
    }
    dirs.into_iter()
        .find_map(|dir| find_in_dir(&dir, target, depth - 1))
}

fn resolve_binary(name: &str) -> Option<(String, &'static str)> {
    let executable = if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    if let Some(path) = find_in_dir(&github_release_install_dir(TOOL_ID), &executable, 4) {
        return Some((path.to_string_lossy().into_owned(), "installer"));
    }
    let found_on_path = hide_window(Command::new(name).arg("-version"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .is_some();
    if found_on_path {
        return Some((name.to_string(), "path"));
    }
    #[cfg(target_os = "macos")]
    for prefix in [Path::new("/opt/homebrew"), Path::new("/usr/local")] {
        let candidate = prefix.join("bin").join(&executable);
        if candidate.is_file() {
            return Some((candidate.to_string_lossy().into_owned(), "brew"));
        }
    }
    None
}

fn resolve_ffmpeg() -> Option<(String, &'static str)> {
    // The sandboxed Mac App Store build cannot reach `/opt/homebrew` or
    // `/usr/local`, and has no Install Helper to manage a private copy, so no
    // FFmpeg is reachable there at all. Report it missing instead of probing
    // paths that always fail; the Screenshots Module hides video recording for
    // this build. Every other build keeps the full search.
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    {
        return None;
    }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    resolve_binary("ffmpeg")
}

#[cfg(target_os = "macos")]
fn macos_screen_input(program: &str) -> Result<String, String> {
    let mut command = Command::new(program);
    command.args([
        "-hide_banner",
        "-f",
        "avfoundation",
        "-list_devices",
        "true",
        "-i",
        "",
    ]);
    let output = command
        .output()
        .map_err(|error| format!("failed to list FFmpeg capture devices: {error}"))?;
    let devices = String::from_utf8_lossy(&output.stderr);
    for line in devices
        .lines()
        .filter(|line| line.contains("Capture screen"))
    {
        if let Some(open) = line.rfind('[')
            && let Some(close) = line[open + 1..].find(']')
        {
            let index = &line[open + 1..open + 1 + close];
            if index.chars().all(|character| character.is_ascii_digit()) {
                return Ok(format!("{index}:none"));
            }
        }
    }
    Err("FFmpeg could not find a macOS screen capture device".to_string())
}

pub fn dependency_status() -> VideoDependencyStatus {
    match resolve_ffmpeg() {
        Some((_, source)) => VideoDependencyStatus {
            available: true,
            source: Some(source.to_string()),
            tool_id: TOOL_ID.to_string(),
        },
        None => VideoDependencyStatus {
            available: false,
            source: None,
            tool_id: TOOL_ID.to_string(),
        },
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn expanded_folder(value: &str) -> PathBuf {
    let value = value.trim();
    if let Some(rest) = value.strip_prefix("%USERPROFILE%") {
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            return PathBuf::from(home).join(rest.trim_start_matches(['\\', '/']));
        }
    }
    PathBuf::from(value)
}

fn add_encoding_args(command: &mut Command, format: &str) -> Result<&'static str, String> {
    match format {
        "mp4" => {
            add_mp4_encoding_args(command, "libx264");
            Ok("mp4")
        }
        "webm" => {
            command.args([
                "-c:v",
                "libvpx-vp9",
                "-deadline",
                "realtime",
                "-cpu-used",
                "5",
                "-crf",
                "32",
                "-b:v",
                "0",
            ]);
            Ok("webm")
        }
        "gif" => {
            command.args(["-filter_complex", "[0:v]fps=15,scale='min(1280,iw)':-2:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"]);
            Ok("gif")
        }
        _ => Err("video format must be mp4, webm, or gif".to_string()),
    }
}

#[cfg_attr(target_os = "macos", allow(unused_variables))]
pub fn start(
    app: &tauri::AppHandle,
    state: &VideoRecordingState,
    request: StartVideoRecordingRequest,
    folder_path: &str,
    format: &str,
) -> Result<VideoRecordingSession, String> {
    let frame_rate = capture_frame_rate(request.frame_rate, format)?;
    let frame_rate_arg = frame_rate.to_string();
    let mut active = state
        .active
        .lock()
        .map_err(|_| "video recorder state is unavailable")?;
    if active.is_some() || state.finalizing.load(Ordering::Acquire) {
        return Err("a video recording is already active".to_string());
    }
    let (program, _) = resolve_ffmpeg().ok_or_else(|| "FFmpeg is not installed".to_string())?;
    let folder = expanded_folder(folder_path);
    fs::create_dir_all(&folder)
        .map_err(|error| format!("failed to create recording folder: {error}"))?;
    let started_at = now_millis();
    let extension = match format {
        "webm" => "webm",
        "gif" => "gif",
        _ => "mp4",
    };
    let file_name = format!("KKTerm-video-{started_at}.{extension}");
    let path = folder.join(&file_name);
    let mut command = Command::new(&program);
    command.args(["-hide_banner", "-loglevel", "error", "-y"]);

    #[cfg(target_os = "windows")]
    let (width, height, recording_target);
    let mut backend = None;
    #[cfg(not(target_os = "windows"))]
    let (width, height) = (None, None);
    #[cfg(target_os = "windows")]
    {
        let rect = crate::screenshot::select_recording_rect(
            app,
            &request.mode,
            request.use_directx,
            request.minimize_window,
        )?;
        (width, height, recording_target) = (
            Some(rect.width as u32),
            Some(rect.height as u32),
            Some(RecordingTarget {
                x: rect.x,
                y: rect.y,
                width: rect.width,
            }),
        );
        if format == "mp4" {
            match windows::NativeRecording::start(&rect, frame_rate, &path) {
                Ok(recording) => backend = Some(RecordingBackend::Windows(recording)),
                Err(error) => {
                    eprintln!("Native video startup unavailable; falling back to GDI: {error}");
                    // Native startup has joined its workers before returning an
                    // error, so no native writer can race the fallback.
                    let _ = fs::remove_file(&path);
                }
            }
        }
        command.args([
            "-f",
            "gdigrab",
            "-framerate",
            &frame_rate_arg,
            "-offset_x",
            &rect.x.to_string(),
            "-offset_y",
            &rect.y.to_string(),
            "-video_size",
            &format!("{}x{}", rect.width, rect.height),
            "-i",
            "desktop",
        ]);
    }
    #[cfg(target_os = "macos")]
    {
        if request.mode != "fullscreen" {
            return Err(
                "window and region video recording are not yet available on macOS".to_string(),
            );
        }
        let input = macos_screen_input(command.get_program().to_string_lossy().as_ref())?;
        command.args([
            "-f",
            "avfoundation",
            "-framerate",
            &frame_rate_arg,
            "-capture_cursor",
            "1",
            "-i",
            &input,
        ]);
    }
    #[cfg(target_os = "linux")]
    {
        if request.mode != "fullscreen" {
            return Err(
                "window and region video recording require a fullscreen capture on Linux"
                    .to_string(),
            );
        }
        let display = std::env::var("DISPLAY").map_err(|_| {
            "FFmpeg X11 recording requires DISPLAY; native Wayland capture is not yet available"
                .to_string()
        })?;
        command.args([
            "-f",
            "x11grab",
            "-framerate",
            &frame_rate_arg,
            "-i",
            &display,
        ]);
    }

    if backend.is_none() {
        if format == "mp4" {
            let encoder = select_h264_encoder(
                &program,
                width.unwrap_or(1920),
                height.unwrap_or(1080),
                frame_rate,
            );
            add_mp4_encoding_args(&mut command, encoder);
        } else {
            add_encoding_args(&mut command, format)?;
        }
        // Keep the file's nominal rate explicit; overloaded capture may duplicate
        // frames, so this is a target rate, not a throughput guarantee.
        command.args(["-r", &frame_rate_arg, "-fps_mode", "cfr"]);
        command
            .arg(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        hide_window(&mut command);
        let child = command
            .spawn()
            .map_err(|error| format!("failed to start FFmpeg: {error}"))?;
        backend = Some(RecordingBackend::Ffmpeg(child));
    }
    let started_at = now_millis();
    *active = Some(ActiveRecording {
        backend: backend.expect("recording backend was initialized"),
        path: path.clone(),
        started_at,
        paused_at: None,
        paused_duration_ms: 0,
        mode: request.mode,
        format: extension.to_string(),
        width,
        height,
    });
    // Creating the controls WebView loads frontend code that immediately asks
    // for recording status. Release the state lock first so that request cannot
    // deadlock WebView creation and leave FFmpeg running without controls.
    // macOS has no controls WebView; recording controls live in the main window.
    drop(active);
    #[cfg(not(target_os = "macos"))]
    {
        #[cfg(target_os = "windows")]
        let target = recording_target;
        #[cfg(not(target_os = "windows"))]
        let target = None;
        if let Err(error) = show_controls_window(app, target) {
            if let Ok(mut active) = state.active.lock()
                && let Some(mut recording) = active.take()
            {
                recording.backend.abort();
            }
            let _ = fs::remove_file(&path);
            return Err(error);
        }
    }
    Ok(VideoRecordingSession {
        path: path.to_string_lossy().into_owned(),
        file_name,
        started_at,
    })
}

#[cfg(not(target_os = "macos"))]
fn controls_position(target: RecordingTarget) -> PhysicalPosition<i32> {
    PhysicalPosition::new(
        target.x + (target.width - CONTROLS_WIDTH) / 2,
        target.y + CONTROLS_TARGET_INSET,
    )
}

#[cfg(not(target_os = "macos"))]
fn position_controls_window(window: &tauri::WebviewWindow, target: Option<RecordingTarget>) {
    if let Some(target) = target {
        let _ = window.set_position(Position::Physical(controls_position(target)));
        return;
    }
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let position = PhysicalPosition::new(
            monitor_position.x + (monitor_size.width as i32 - CONTROLS_WIDTH) / 2,
            monitor_position.y + CONTROLS_TARGET_INSET,
        );
        let _ = window.set_position(Position::Physical(position));
    }
}

#[cfg(not(target_os = "macos"))]
fn show_controls_window(
    app: &tauri::AppHandle,
    target: Option<RecordingTarget>,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(CONTROLS_WINDOW_LABEL) {
        position_controls_window(&existing, target);
        existing.show().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        app,
        CONTROLS_WINDOW_LABEL,
        WebviewUrl::App(CONTROLS_WINDOW_ROUTE.into()),
    )
    .title("KKTerm recording controls")
    .inner_size(CONTROLS_WIDTH as f64, CONTROLS_HEIGHT as f64)
    .always_on_top(true)
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .skip_taskbar(true)
    .center()
    .visible(false)
    .build()
    .map_err(|error| format!("failed to create recording controls: {error}"))?;
    let _ = window.set_content_protected(true);
    position_controls_window(&window, target);
    window
        .show()
        .map_err(|error| format!("failed to show recording controls: {error}"))?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn close_controls_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(CONTROLS_WINDOW_LABEL) {
        let _ = window.close();
    }
}

pub fn status(state: &VideoRecordingState) -> Result<VideoRecordingStatus, String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "video recorder state is unavailable")?;
    let Some(recording) = active.as_ref() else {
        return Ok(VideoRecordingStatus {
            active: false,
            paused: false,
            file_name: None,
            started_at: None,
            elapsed_ms: 0,
            mode: None,
            format: None,
            width: None,
            height: None,
        });
    };
    let end = recording.paused_at.unwrap_or_else(now_millis);
    Ok(VideoRecordingStatus {
        active: true,
        paused: recording.paused_at.is_some(),
        file_name: recording
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string),
        started_at: Some(recording.started_at),
        elapsed_ms: end
            .saturating_sub(recording.started_at)
            .saturating_sub(recording.paused_duration_ms),
        mode: Some(recording.mode.clone()),
        format: Some(recording.format.clone()),
        width: recording.width,
        height: recording.height,
    })
}

#[cfg(target_os = "windows")]
fn set_process_paused(pid: u32, paused: bool) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenProcess, PROCESS_SUSPEND_RESUME},
    };
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtSuspendProcess(process: windows_sys::Win32::Foundation::HANDLE) -> i32;
        fn NtResumeProcess(process: windows_sys::Win32::Foundation::HANDLE) -> i32;
    }
    let handle = unsafe { OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid) };
    if handle.is_null() {
        return Err("failed to open FFmpeg for pause control".to_string());
    }
    let status = unsafe {
        if paused {
            NtSuspendProcess(handle)
        } else {
            NtResumeProcess(handle)
        }
    };
    unsafe { CloseHandle(handle) };
    if status < 0 {
        Err("FFmpeg rejected the pause control".to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn set_process_paused(pid: u32, paused: bool) -> Result<(), String> {
    let signal = if paused { "-STOP" } else { "-CONT" };
    let status = Command::new("kill")
        .args([signal, &pid.to_string()])
        .status()
        .map_err(|error| format!("failed to control FFmpeg: {error}"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| "FFmpeg rejected the pause control".to_string())
}

pub fn set_paused(state: &VideoRecordingState, paused: bool) -> Result<(), String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "video recorder state is unavailable")?;
    let recording = active
        .as_mut()
        .ok_or_else(|| "no video recording is active".to_string())?;
    if paused == recording.paused_at.is_some() {
        return Ok(());
    }
    recording.backend.pause(paused)?;
    if paused {
        recording.paused_at = Some(now_millis());
    } else if let Some(paused_at) = recording.paused_at.take() {
        recording.paused_duration_ms = recording
            .paused_duration_ms
            .saturating_add(now_millis().saturating_sub(paused_at));
    }
    Ok(())
}

#[cfg_attr(target_os = "macos", allow(unused_variables))]
pub fn stop(
    app: &tauri::AppHandle,
    state: &VideoRecordingState,
) -> Result<CompletedVideoRecording, String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "video recorder state is unavailable")?;
    let mut recording = active
        .take()
        .ok_or_else(|| "no video recording is active".to_string())?;
    state.finalizing.store(true, Ordering::Release);
    struct Finalizing<'a>(&'a AtomicBool);
    impl Drop for Finalizing<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _finalizing = Finalizing(&state.finalizing);
    if let Some(paused_at) = recording.paused_at.take() {
        recording.backend.pause(false)?;
        recording.paused_duration_ms = recording
            .paused_duration_ms
            .saturating_add(now_millis().saturating_sub(paused_at));
    }
    drop(active);
    let stopped_at = now_millis();
    let result = recording.backend.finish();
    #[cfg(not(target_os = "macos"))]
    close_controls_window(app);
    result?;
    let file_name = recording
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("recording")
        .to_string();
    Ok(CompletedVideoRecording {
        path: recording.path.to_string_lossy().into_owned(),
        file_name,
        started_at: recording.started_at,
        duration_ms: stopped_at
            .saturating_sub(recording.started_at)
            .saturating_sub(recording.paused_duration_ms),
    })
}

pub fn probe_video(path: &Path) -> Option<(u32, u32, u128)> {
    let (program, _) = resolve_binary("ffprobe")?;
    let output = hide_window(Command::new(program).args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:format=duration",
        "-of",
        "json",
    ]))
    .arg(path)
    .output()
    .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let stream = value.get("streams")?.as_array()?.first()?;
    let width = stream.get("width")?.as_u64()? as u32;
    let height = stream.get("height")?.as_u64()? as u32;
    let duration = value
        .get("format")?
        .get("duration")?
        .as_str()?
        .parse::<f64>()
        .ok()?;
    Some((width, height, (duration * 1000.0).round().max(0.0) as u128))
}

pub fn write_video_thumbnail(source: &Path, target: &Path) -> Result<(), String> {
    let (program, _) = resolve_ffmpeg().ok_or_else(|| "FFmpeg is not installed".to_string())?;
    let result = hide_window(Command::new(program).args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        "0.1",
        "-i",
    ]))
    .arg(source)
    .args([
        "-frames:v",
        "1",
        "-vf",
        "scale=320:320:force_original_aspect_ratio=decrease",
    ])
    .arg(target)
    .output()
    .map_err(|error| format!("failed to create video thumbnail: {error}"))?;
    result
        .status
        .success()
        .then_some(())
        .ok_or_else(|| String::from_utf8_lossy(&result.stderr).trim().to_string())
}

fn recording_path(path: String, folder_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("the recording file no longer exists".to_string());
    }
    let folder = expanded_folder(folder_path)
        .canonicalize()
        .map_err(|error| format!("failed to resolve recording folder: {error}"))?;
    let path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve recording path: {error}"))?;
    if !path.starts_with(folder) {
        return Err("the recording is outside the Screenshots folder".to_string());
    }
    Ok(path)
}

pub fn allow_preview(
    app: &tauri::AppHandle,
    path: String,
    folder_path: &str,
) -> Result<String, String> {
    let path = recording_path(path, folder_path)?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| format!("failed to allow recording preview: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn trim(request: TrimVideoRequest, folder_path: &str) -> Result<String, String> {
    if !request.start_seconds.is_finite()
        || !request.end_seconds.is_finite()
        || request.start_seconds < 0.0
        || request.end_seconds <= request.start_seconds
    {
        return Err("the trim range is invalid".to_string());
    }
    let source = recording_path(request.source_path, folder_path)?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("recording");
    let output = source.with_file_name(format!(
        "{stem}-trimmed-{}.{}",
        now_millis(),
        if extension == "webm" {
            "webm"
        } else if extension == "gif" {
            "gif"
        } else {
            "mp4"
        }
    ));
    let (program, _) = resolve_ffmpeg().ok_or_else(|| "FFmpeg is not installed".to_string())?;
    let mut command = Command::new(program);
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            &request.start_seconds.to_string(),
            "-t",
            &(request.end_seconds - request.start_seconds).to_string(),
            "-i",
        ])
        .arg(&source);
    add_encoding_args(&mut command, &extension)?;
    let result = hide_window(&mut command)
        .arg(&output)
        .output()
        .map_err(|error| format!("failed to run FFmpeg: {error}"))?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).trim().to_string());
    }
    Ok(output.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_rates_validate_requests_and_cap_gif_capture() {
        for rate in [30, 60, 120] {
            assert_eq!(capture_frame_rate(rate, "mp4"), Ok(rate));
            assert_eq!(capture_frame_rate(rate, "webm"), Ok(rate));
            assert_eq!(capture_frame_rate(rate, "gif"), Ok(15));
        }
        for rate in [0, 15, 24, 59, 121, u32::MAX] {
            assert!(capture_frame_rate(rate, "mp4").is_err());
        }
        let legacy: StartVideoRecordingRequest = serde_json::from_value(serde_json::json!({
            "mode": "fullscreen", "useDirectx": false, "minimizeWindow": false,
        }))
        .unwrap();
        assert_eq!(legacy.frame_rate, 30);
    }

    #[test]
    fn unavailable_encoder_probe_falls_back_to_software() {
        assert_eq!(
            select_h264_encoder("kkterm-nonexistent-ffmpeg", 1920, 1080, 120),
            "libx264"
        );
    }

    #[test]
    #[ignore = "requires installed FFmpeg and a desktop capture environment"]
    fn hardware_recording_smoke() {
        let (program, _) = resolve_ffmpeg().expect("FFmpeg installed");
        for rate in [30, 60, 120] {
            let encoder = select_h264_encoder(&program, 1920, 1080, rate);
            let path = std::env::temp_dir()
                .join(format!("kkterm-video-smoke-{}-{rate}.mp4", now_millis()));
            let mut command = Command::new(&program);
            command.args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-f",
                "lavfi",
                "-i",
                &format!("testsrc2=size=1920x1080:rate={rate}"),
                "-t",
                "2",
            ]);
            add_mp4_encoding_args(&mut command, encoder);
            command
                .args(["-r", &rate.to_string(), "-fps_mode", "cfr"])
                .arg(&path);
            let output = hide_window(&mut command).output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            let (probe, _) = resolve_binary("ffprobe").expect("ffprobe installed");
            let output = hide_window(
                Command::new(probe)
                    .args([
                        "-v",
                        "error",
                        "-select_streams",
                        "v:0",
                        "-count_frames",
                        "-show_entries",
                        "stream=r_frame_rate,nb_read_frames,width,height",
                        "-of",
                        "json",
                    ])
                    .arg(&path),
            )
            .output()
            .unwrap();
            let metadata: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
            let stream = &metadata["streams"][0];
            assert_eq!(stream["r_frame_rate"], format!("{rate}/1"));
            assert_eq!(stream["nb_read_frames"], (rate * 2).to_string());
            assert_eq!(stream["width"], 1920);
            assert_eq!(stream["height"], 1080);
            fs::remove_file(path).unwrap();
            eprintln!("verified {rate} fps MP4 using {encoder}");
        }
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn recording_controls_are_centered_near_the_target_top_edge() {
        let position = controls_position(RecordingTarget {
            x: 100,
            y: 200,
            width: 1000,
        });

        assert_eq!((position.x, position.y), (538, 210));
    }
}

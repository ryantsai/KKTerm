use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::installer::detect::github_release_install_dir;

const TOOL_ID: &str = "ffmpeg";

#[derive(Default)]
pub struct VideoRecordingState {
    active: Mutex<Option<ActiveRecording>>,
}

impl Drop for VideoRecordingState {
    fn drop(&mut self) {
        if let Ok(active) = self.active.get_mut()
            && let Some(recording) = active.as_mut()
        {
            if let Some(stdin) = recording.child.stdin.as_mut() {
                let _ = stdin.write_all(b"q\n");
            }
            let _ = recording.child.kill();
            let _ = recording.child.wait();
        }
    }
}

struct ActiveRecording {
    child: Child,
    path: PathBuf,
    started_at: u128,
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
    use_directx: bool,
    minimize_window: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRecordingSession {
    path: String,
    file_name: String,
    started_at: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedVideoRecording {
    path: String,
    file_name: String,
    started_at: u128,
    duration_ms: u128,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimVideoRequest {
    source_path: String,
    start_seconds: f64,
    end_seconds: f64,
}

fn executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
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

fn resolve_ffmpeg() -> Option<(String, &'static str)> {
    if let Some(path) = find_in_dir(&github_release_install_dir(TOOL_ID), executable_name(), 4) {
        return Some((path.to_string_lossy().into_owned(), "installer"));
    }
    hide_window(Command::new("ffmpeg").arg("-version"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .map(|_| ("ffmpeg".to_string(), "path"))
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
            command.args([
                "-vf",
                "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ]);
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

pub fn start(
    app: &tauri::AppHandle,
    state: &VideoRecordingState,
    request: StartVideoRecordingRequest,
    folder_path: &str,
    format: &str,
) -> Result<VideoRecordingSession, String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "video recorder state is unavailable")?;
    if active.is_some() {
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
    let mut command = Command::new(program);
    command.args(["-hide_banner", "-loglevel", "error", "-y"]);

    #[cfg(target_os = "windows")]
    {
        let rect = crate::screenshot::select_recording_rect(
            app,
            &request.mode,
            request.use_directx,
            request.minimize_window,
        )?;
        command.args([
            "-f",
            "gdigrab",
            "-framerate",
            "30",
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
            "30",
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
        command.args(["-f", "x11grab", "-framerate", "30", "-i", &display]);
    }

    add_encoding_args(&mut command, format)?;
    command
        .arg(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_window(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("failed to start FFmpeg: {error}"))?;
    *active = Some(ActiveRecording {
        child,
        path: path.clone(),
        started_at,
    });
    Ok(VideoRecordingSession {
        path: path.to_string_lossy().into_owned(),
        file_name,
        started_at,
    })
}

pub fn stop(state: &VideoRecordingState) -> Result<CompletedVideoRecording, String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "video recorder state is unavailable")?;
    let mut recording = active
        .take()
        .ok_or_else(|| "no video recording is active".to_string())?;
    if let Some(stdin) = recording.child.stdin.as_mut() {
        stdin
            .write_all(b"q\n")
            .map_err(|error| format!("failed to stop FFmpeg: {error}"))?;
    }
    let output = recording
        .child
        .wait_with_output()
        .map_err(|error| format!("failed to finish FFmpeg: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "FFmpeg recording failed".to_string()
        } else {
            message
        });
    }
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
        duration_ms: now_millis().saturating_sub(recording.started_at),
    })
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

use std::{
    env, fs,
    path::{Path, PathBuf},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureScreenshotRequest {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotDataUrlRequest {
    data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantScreenshot {
    data_url: String,
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredScreenshot {
    id: String,
    path: String,
    file_name: String,
    thumbnail_data_url: String,
    width: u32,
    height: u32,
    file_size_bytes: u64,
    captured_at: u128,
    kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullScreenshot {
    id: String,
    file_name: String,
    data_url: String,
    width: u32,
    height: u32,
}

/// How captures are written into the library folder. Built from the persisted
/// `ScreenshotSettings` by the command layer.
#[derive(Clone)]
pub struct LibrarySaveOptions {
    pub folder_path: String,
    pub format: String,
    pub jpeg_quality: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListScreenshotsRequest {
    offset: Option<usize>,
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListScreenshotsResponse {
    screenshots: Vec<StoredScreenshot>,
    total: usize,
    has_more: bool,
}

#[cfg(target_os = "windows")]
pub fn capture_rect_to_clipboard(
    app: &tauri::AppHandle,
    request: CaptureScreenshotRequest,
    use_directx: bool,
) -> Result<(), String> {
    let target = capture_target(app, request)?;
    platform::capture_screen_rect_to_clipboard(
        target.owner_hwnd,
        target.x,
        target.y,
        target.width,
        target.height,
        use_directx,
    )
}

#[cfg(target_os = "windows")]
pub fn write_data_url_to_clipboard(
    app: &tauri::AppHandle,
    request: ScreenshotDataUrlRequest,
) -> Result<(), String> {
    let (_, encoded) = request
        .data_url
        .split_once(",")
        .filter(|(header, _)| header.starts_with("data:image/") && header.ends_with(";base64"))
        .ok_or_else(|| "stitched screenshot is not a base64 image data URL".to_string())?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("failed to decode stitched screenshot: {error}"))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| format!("failed to read stitched screenshot: {error}"))?
        .to_rgba8();
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to resolve window handle: {error}"))?;
    platform::write_rgba_to_clipboard(hwnd.0, image.as_raw(), image.width(), image.height())
}

#[cfg(target_os = "windows")]
pub fn capture_rect_for_assistant(
    app: &tauri::AppHandle,
    request: CaptureScreenshotRequest,
    use_directx: bool,
) -> Result<AssistantScreenshot, String> {
    let target = capture_target(app, request)?;
    let dib = platform::capture_screen_rect_to_dib(
        target.x,
        target.y,
        target.width,
        target.height,
        use_directx,
    )?;
    let result = platform::dib_to_jpeg_data_url(&dib, target.width as u32, target.height as u32)?;
    Ok(AssistantScreenshot {
        data_url: result.data_url,
        width: result.width,
        height: result.height,
    })
}

#[cfg(target_os = "windows")]
pub fn capture_fullscreen_for_assistant(use_directx: bool) -> Result<AssistantScreenshot, String> {
    let target = platform::virtual_screen_rect();
    let dib = platform::capture_screen_rect_to_dib(
        target.x,
        target.y,
        target.width,
        target.height,
        use_directx,
    )?;
    let result = platform::dib_to_jpeg_data_url(&dib, target.width as u32, target.height as u32)?;
    Ok(AssistantScreenshot {
        data_url: result.data_url,
        width: result.width,
        height: result.height,
    })
}

#[cfg(target_os = "windows")]
pub fn capture_rect_to_library(
    app: &tauri::AppHandle,
    request: CaptureScreenshotRequest,
    kind: String,
    options: LibrarySaveOptions,
    use_directx: bool,
) -> Result<StoredScreenshot, String> {
    let target = capture_target(app, request)?;
    let dib = platform::capture_screen_rect_to_dib(
        target.x,
        target.y,
        target.width,
        target.height,
        use_directx,
    )?;
    save_dib_to_library(
        &dib,
        target.width as u32,
        target.height as u32,
        kind,
        &options,
    )
}

#[cfg(target_os = "windows")]
pub fn capture_fullscreen_to_library(
    app: &tauri::AppHandle,
    kind: String,
    options: LibrarySaveOptions,
    use_directx: bool,
) -> Result<StoredScreenshot, String> {
    let _guard = MinimizedCaptureWindow::new(app)?;
    let target = platform::virtual_screen_rect();
    let dib = platform::capture_screen_rect_to_dib(
        target.x,
        target.y,
        target.width,
        target.height,
        use_directx,
    )?;
    save_dib_to_library(
        &dib,
        target.width as u32,
        target.height as u32,
        kind,
        &options,
    )
}

#[cfg(target_os = "windows")]
pub fn capture_active_window_to_library(
    app: &tauri::AppHandle,
    kind: String,
    options: LibrarySaveOptions,
    use_directx: bool,
) -> Result<StoredScreenshot, String> {
    let _guard = MinimizedCaptureWindow::new(app)?;
    let screen = platform::virtual_screen_rect();
    let screen_dib = platform::capture_screen_rect_to_dib(
        screen.x,
        screen.y,
        screen.width,
        screen.height,
        use_directx,
    )?;
    let windows = platform::enumerate_window_rects(&screen);
    let target = platform::select_window_rect(&screen_dib, &screen, windows)?
        .ok_or_else(|| "screenshot capture canceled".to_string())?;
    let dib = platform::crop_dib(&screen_dib, screen.width, screen.height, &screen, &target)?;
    save_dib_to_library(
        &dib,
        target.width as u32,
        target.height as u32,
        kind,
        &options,
    )
}

#[cfg(target_os = "windows")]
pub fn capture_interactive_region_to_library(
    app: &tauri::AppHandle,
    kind: String,
    options: LibrarySaveOptions,
    use_directx: bool,
) -> Result<StoredScreenshot, String> {
    let _guard = MinimizedCaptureWindow::new(app)?;
    let screen = platform::virtual_screen_rect();
    let screen_dib = platform::capture_screen_rect_to_dib(
        screen.x,
        screen.y,
        screen.width,
        screen.height,
        use_directx,
    )?;
    let target = platform::select_region_rect(&screen_dib, &screen)?
        .ok_or_else(|| "screenshot capture canceled".to_string())?;
    let dib = platform::crop_dib(&screen_dib, screen.width, screen.height, &screen, &target)?;
    save_dib_to_library(
        &dib,
        target.width as u32,
        target.height as u32,
        kind,
        &options,
    )
}

#[cfg(target_os = "windows")]
struct CaptureTarget {
    owner_hwnd: windows_sys::Win32::Foundation::HWND,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[cfg(target_os = "windows")]
struct MinimizedCaptureWindow {
    window: tauri::WebviewWindow,
    was_minimized: bool,
    was_visible: bool,
}

#[cfg(target_os = "windows")]
impl MinimizedCaptureWindow {
    fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window is not available".to_string())?;
        let was_minimized = window.is_minimized().unwrap_or(false);
        let was_visible = window.is_visible().unwrap_or(true);
        // A window already hidden to the tray must stay hidden: skip the
        // minimize/settle dance entirely so the capture never restores it.
        if was_visible {
            window
                .minimize()
                .map_err(|error| format!("failed to minimize window before screenshot: {error}"))?;
            thread::sleep(std::time::Duration::from_millis(350));
        }
        Ok(Self {
            window,
            was_minimized,
            was_visible,
        })
    }
}

#[cfg(target_os = "windows")]
impl Drop for MinimizedCaptureWindow {
    fn drop(&mut self) {
        if !self.was_visible {
            return;
        }
        let _ = self.window.show();
        if !self.was_minimized {
            let _ = self.window.unminimize();
            let _ = self.window.set_focus();
        }
    }
}

#[cfg(target_os = "windows")]
fn capture_target(
    app: &tauri::AppHandle,
    request: CaptureScreenshotRequest,
) -> Result<CaptureTarget, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let inner_position = window
        .inner_position()
        .map_err(|error| format!("failed to resolve window position: {error}"))?;
    let scale_factor = window
        .scale_factor()
        .map_err(|error| format!("failed to resolve window scale factor: {error}"))?;
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to resolve window handle: {error}"))?;

    let x = inner_position.x + (request.x * scale_factor).round() as i32;
    let y = inner_position.y + (request.y * scale_factor).round() as i32;
    let width = (request.width * scale_factor).round().max(1.0) as i32;
    let height = (request.height * scale_factor).round().max(1.0) as i32;

    Ok(CaptureTarget {
        owner_hwnd: hwnd.0,
        x,
        y,
        width,
        height,
    })
}

#[cfg(not(target_os = "windows"))]
pub fn capture_rect_to_clipboard(
    _app: &tauri::AppHandle,
    _request: CaptureScreenshotRequest,
    _use_directx: bool,
) -> Result<(), String> {
    Err("screenshot capture is currently available on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn write_data_url_to_clipboard(
    _app: &tauri::AppHandle,
    _request: ScreenshotDataUrlRequest,
) -> Result<(), String> {
    Err("screenshot clipboard is currently available on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn capture_rect_for_assistant(
    app: &tauri::AppHandle,
    request: CaptureScreenshotRequest,
    _use_directx: bool,
) -> Result<AssistantScreenshot, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let (rgba, win_width, win_height) = capture_window_rgba(&window)?;
    // The request rect is in logical pixels relative to the webview content
    // (inner) area. xcap captures the whole outer window in physical pixels, so
    // offset the crop by the decoration delta and scale the logical rect.
    let inner = window
        .inner_position()
        .map_err(|error| format!("failed to resolve window position: {error}"))?;
    let outer = window
        .outer_position()
        .map_err(|error| format!("failed to resolve window position: {error}"))?;
    let off_x = (inner.x - outer.x).max(0) as u32;
    let off_y = (inner.y - outer.y).max(0) as u32;
    let x = off_x + (request.x * scale).round().max(0.0) as u32;
    let y = off_y + (request.y * scale).round().max(0.0) as u32;
    let width = (request.width * scale).round().max(1.0) as u32;
    let height = (request.height * scale).round().max(1.0) as u32;
    let (cropped, cw, ch) = crop_rgba(&rgba, win_width, win_height, x, y, width, height)?;
    rgba_to_jpeg_assistant(&cropped, cw, ch)
}

#[cfg(not(target_os = "windows"))]
pub fn capture_fullscreen_for_assistant(_use_directx: bool) -> Result<AssistantScreenshot, String> {
    Err("screenshot capture is currently available on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn capture_rect_to_library(
    _app: &tauri::AppHandle,
    _request: CaptureScreenshotRequest,
    _kind: String,
    _options: LibrarySaveOptions,
    _use_directx: bool,
) -> Result<StoredScreenshot, String> {
    Err("screenshot capture is currently available on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn capture_fullscreen_to_library(
    _app: &tauri::AppHandle,
    _kind: String,
    _options: LibrarySaveOptions,
    _use_directx: bool,
) -> Result<StoredScreenshot, String> {
    Err("screenshot capture is currently available on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn capture_active_window_to_library(
    _app: &tauri::AppHandle,
    _kind: String,
    _options: LibrarySaveOptions,
    _use_directx: bool,
) -> Result<StoredScreenshot, String> {
    Err("screenshot capture is currently available on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn capture_interactive_region_to_library(
    _app: &tauri::AppHandle,
    _kind: String,
    _options: LibrarySaveOptions,
    _use_directx: bool,
) -> Result<StoredScreenshot, String> {
    Err("screenshot capture is currently available on Windows".to_string())
}

// ---------------------------------------------------------------------------
// Universal in-app window capture (built-in MCP `kkterm.app.*` tools).
//
// Enumerates and captures KKTerm's own OS windows (the main window plus owned
// overlays such as the URL WebView2, RDP, and VNC surfaces). On Windows this
// reuses the native screen-rect capture so GPU/WebView2 content is preserved;
// on macOS/Linux it uses the cross-platform `xcap` crate. These run in-process
// (no frontend bridge), so they work regardless of the webview's current state.
// ---------------------------------------------------------------------------

/// One KKTerm-owned window, addressed by its stable Tauri window label (`id`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppWindowInfo {
    id: String,
    title: String,
    kind: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    visible: bool,
    minimized: bool,
    focused: bool,
}

/// Friendly window kind derived from the Tauri window label.
fn app_window_kind(label: &str) -> &'static str {
    let lower = label.to_ascii_lowercase();
    if lower == "main" {
        "main"
    } else if lower.contains("url") || lower.contains("webview") {
        "urlOverlay"
    } else if lower.contains("rdp") || lower.contains("vnc") || lower.contains("remote") {
        "remoteDesktop"
    } else {
        "overlay"
    }
}

/// List KKTerm's own windows (label, title, kind, bounds, visibility). Safe.
pub fn list_app_windows(app: &tauri::AppHandle) -> Result<Vec<AppWindowInfo>, String> {
    let mut windows: Vec<AppWindowInfo> = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| {
            let position = window.outer_position().ok();
            let size = window.outer_size().ok();
            AppWindowInfo {
                kind: app_window_kind(&label).to_string(),
                id: label,
                title: window.title().unwrap_or_default(),
                x: position.map(|p| p.x).unwrap_or(0),
                y: position.map(|p| p.y).unwrap_or(0),
                width: size.map(|s| s.width).unwrap_or(0),
                height: size.map(|s| s.height).unwrap_or(0),
                visible: window.is_visible().unwrap_or(false),
                minimized: window.is_minimized().unwrap_or(false),
                focused: window.is_focused().unwrap_or(false),
            }
        })
        .collect();
    windows.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(windows)
}

/// Capture one KKTerm window by its label to a JPEG data URL. Dangerous: the
/// image may include sensitive terminal / remote-desktop / URL content.
pub fn capture_app_window(
    app: &tauri::AppHandle,
    window_id: &str,
    use_directx: bool,
) -> Result<AssistantScreenshot, String> {
    let window = app
        .get_webview_window(window_id)
        .ok_or_else(|| format!("KKTerm window '{window_id}' was not found"))?;
    capture_webview_window(&window, use_directx)
}

#[cfg(target_os = "windows")]
fn capture_webview_window(
    window: &tauri::WebviewWindow,
    use_directx: bool,
) -> Result<AssistantScreenshot, String> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to resolve window handle: {error}"))?;
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd.0, &mut rect) } == 0 {
        return Err("failed to resolve window bounds".to_string());
    }
    let width = (rect.right - rect.left).max(1);
    let height = (rect.bottom - rect.top).max(1);
    let dib =
        platform::capture_screen_rect_to_dib(rect.left, rect.top, width, height, use_directx)?;
    let result = platform::dib_to_jpeg_data_url(&dib, width as u32, height as u32)?;
    Ok(AssistantScreenshot {
        data_url: result.data_url,
        width: result.width,
        height: result.height,
    })
}

#[cfg(not(target_os = "windows"))]
fn capture_webview_window(
    window: &tauri::WebviewWindow,
    _use_directx: bool,
) -> Result<AssistantScreenshot, String> {
    let (rgba, width, height) = capture_window_rgba(window)?;
    rgba_to_jpeg_assistant(&rgba, width, height)
}

/// Capture the physical pixels of a Tauri window via xcap, returning RGBA8
/// bytes plus dimensions. macOS requires the Screen Recording permission.
#[cfg(not(target_os = "windows"))]
fn capture_window_rgba(window: &tauri::WebviewWindow) -> Result<(Vec<u8>, u32, u32), String> {
    let xcap_window = find_xcap_window(window)?;
    if xcap_window.is_minimized().unwrap_or(false) {
        return Err("window is minimized and cannot be captured".to_string());
    }
    let image = xcap_window.capture_image().map_err(|error| {
        format!(
            "failed to capture window (on macOS, grant KKTerm the Screen Recording permission): {error}"
        )
    })?;
    let width = image.width();
    let height = image.height();
    Ok((image.into_raw(), width, height))
}

/// Match a Tauri window to its xcap window by process id, then title, then
/// bounds, falling back to the sole window when there is exactly one.
#[cfg(not(target_os = "windows"))]
fn find_xcap_window(window: &tauri::WebviewWindow) -> Result<xcap::Window, String> {
    let pid = std::process::id();
    let mut own: Vec<xcap::Window> = xcap::Window::all()
        .map_err(|error| format!("failed to enumerate windows: {error}"))?
        .into_iter()
        .filter(|candidate| {
            candidate
                .pid()
                .map(|candidate_pid| candidate_pid == pid)
                .unwrap_or(false)
        })
        .collect();
    if own.is_empty() {
        return Err("no KKTerm windows were found to capture".to_string());
    }

    let title = window.title().unwrap_or_default();
    let position = window.outer_position().ok();
    let size = window.outer_size().ok();
    let index = own
        .iter()
        .position(|candidate| {
            !title.is_empty()
                && candidate
                    .title()
                    .map(|value| value == title)
                    .unwrap_or(false)
        })
        .or_else(|| {
            let (position, size) = (position?, size?);
            own.iter().position(|candidate| {
                candidate
                    .x()
                    .map(|value| value == position.x)
                    .unwrap_or(false)
                    && candidate
                        .y()
                        .map(|value| value == position.y)
                        .unwrap_or(false)
                    && candidate
                        .width()
                        .map(|value| value == size.width)
                        .unwrap_or(false)
                    && candidate
                        .height()
                        .map(|value| value == size.height)
                        .unwrap_or(false)
            })
        })
        .or_else(|| if own.len() == 1 { Some(0) } else { None })
        .ok_or_else(|| "could not match the requested KKTerm window for capture".to_string())?;
    Ok(own.swap_remove(index))
}

/// Crop an RGBA8 buffer to a sub-rectangle, clamped to the source bounds.
#[cfg(not(target_os = "windows"))]
fn crop_rgba(
    rgba: &[u8],
    src_width: u32,
    src_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<(Vec<u8>, u32, u32), String> {
    let expected = src_width as usize * src_height as usize * 4;
    if rgba.len() < expected {
        return Err("captured window image data is incomplete".to_string());
    }
    if x >= src_width || y >= src_height {
        return Err("screenshot region is outside the captured window".to_string());
    }
    let copy_w = width.min(src_width - x);
    let copy_h = height.min(src_height - y);
    let src_stride = src_width as usize * 4;
    let mut out = Vec::with_capacity(copy_w as usize * copy_h as usize * 4);
    for row in 0..copy_h as usize {
        let start = (y as usize + row) * src_stride + x as usize * 4;
        out.extend_from_slice(&rgba[start..start + copy_w as usize * 4]);
    }
    Ok((out, copy_w, copy_h))
}

/// Encode an RGBA8 buffer to a JPEG data URL `AssistantScreenshot`.
#[cfg(not(target_os = "windows"))]
fn rgba_to_jpeg_assistant(
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Result<AssistantScreenshot, String> {
    use image::{ColorType, ImageEncoder, codecs::jpeg::JpegEncoder};

    let expected = width as usize * height as usize * 4;
    if rgba.len() < expected {
        return Err("captured window image data is incomplete".to_string());
    }
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for pixel in rgba[..expected].chunks_exact(4) {
        rgb.push(pixel[0]);
        rgb.push(pixel[1]);
        rgb.push(pixel[2]);
    }
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 90)
        .write_image(&rgb, width, height, ColorType::Rgb8.into())
        .map_err(|error| format!("failed to encode JPEG: {error}"))?;
    Ok(AssistantScreenshot {
        data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)),
        width,
        height,
    })
}

const THUMBS_DIR_NAME: &str = ".kkterm-thumbs";
const THUMB_LONG_EDGE: u32 = 320;

pub fn list_library_screenshots(
    request: ListScreenshotsRequest,
    folder_path: String,
) -> Result<ListScreenshotsResponse, String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    let mut paths = Vec::new();
    for entry in fs::read_dir(&folder)
        .map_err(|error| format!("failed to read screenshots folder: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read screenshots folder entry: {error}"))?;
        let path = entry.path();
        if !is_supported_image_path(&path) {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(system_time_to_millis)
            .unwrap_or(0);
        paths.push((modified, path));
    }
    paths.sort_by(|a, b| b.0.cmp(&a.0));

    let total = paths.len();
    let offset = request.offset.unwrap_or(0).min(total);
    let limit = request.limit.unwrap_or(60).clamp(1, 200);
    let screenshots = paths
        .into_iter()
        .skip(offset)
        .take(limit)
        .filter_map(|(_, path)| stored_screenshot_from_path(&folder, path).ok())
        .collect::<Vec<_>>();
    let has_more = offset + screenshots.len() < total;

    Ok(ListScreenshotsResponse {
        screenshots,
        total,
        has_more,
    })
}

/// Resolves a library screenshot id to its canonical on-disk path with the
/// same traversal guards as every other id-based operation.
pub fn library_screenshot_path(id: &str, folder_path: &str) -> Result<PathBuf, String> {
    let folder = ensure_screenshots_folder(folder_path)?;
    screenshot_path_from_id(&folder, id)
}

pub fn read_library_screenshot(id: String, folder_path: String) -> Result<FullScreenshot, String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    let path = screenshot_path_from_id(&folder, &id)?;
    let bytes = fs::read(&path).map_err(|error| format!("failed to load screenshot: {error}"))?;
    let (width, height) = image::image_dimensions(&path)
        .map_err(|error| format!("failed to read screenshot: {error}"))?;
    let mime_type = mime_type_for_path(&path);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "screenshot file name is not valid UTF-8".to_string())?
        .to_string();
    Ok(FullScreenshot {
        id,
        file_name,
        data_url: format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)),
        width,
        height,
    })
}

pub fn rename_library_screenshot(
    id: String,
    new_name: String,
    folder_path: String,
) -> Result<StoredScreenshot, String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    let path = screenshot_path_from_id(&folder, &id)?;
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .ok_or_else(|| "screenshot has no file extension".to_string())?;

    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("screenshot name must not be empty".to_string());
    }
    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || trimmed.contains("..")
        || trimmed.starts_with('.')
    {
        return Err("screenshot name contains unsupported characters".to_string());
    }
    let target_name = if trimmed
        .to_ascii_lowercase()
        .ends_with(&format!(".{extension}"))
    {
        trimmed.to_string()
    } else {
        format!("{trimmed}.{extension}")
    };
    let target = folder.join(&target_name);
    if target.exists() {
        return Err("a screenshot with that name already exists".to_string());
    }
    fs::rename(&path, &target).map_err(|error| format!("failed to rename screenshot: {error}"))?;
    remove_thumbnail_for(&folder, &id);
    stored_screenshot_from_path(&folder, target)
}

#[cfg(target_os = "windows")]
pub fn copy_library_screenshot_to_clipboard(
    app: &tauri::AppHandle,
    id: String,
    folder_path: String,
) -> Result<(), String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    let path = screenshot_path_from_id(&folder, &id)?;
    let image = image::open(&path)
        .map_err(|error| format!("failed to read screenshot: {error}"))?
        .to_rgba8();
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to resolve window handle: {error}"))?;
    platform::write_rgba_to_clipboard(hwnd.0, image.as_raw(), image.width(), image.height())
}

#[cfg(not(target_os = "windows"))]
pub fn copy_library_screenshot_to_clipboard(
    _app: &tauri::AppHandle,
    _id: String,
    _folder_path: String,
) -> Result<(), String> {
    Err("screenshot clipboard is currently available on Windows".to_string())
}

pub fn delete_library_screenshot(id: String, folder_path: String) -> Result<(), String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    let path = screenshot_path_from_id(&folder, &id)?;
    fs::remove_file(&path).map_err(|error| format!("failed to delete screenshot: {error}"))?;
    remove_thumbnail_for(&folder, &id);
    Ok(())
}

pub fn clear_library_screenshots(folder_path: String) -> Result<(), String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    for entry in fs::read_dir(&folder)
        .map_err(|error| format!("failed to read screenshots folder: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read screenshots folder entry: {error}"))?;
        let path = entry.path();
        if is_supported_image_path(&path) {
            let _ = fs::remove_file(path);
        }
    }
    let _ = fs::remove_dir_all(folder.join(THUMBS_DIR_NAME));
    Ok(())
}

#[cfg(target_os = "windows")]
fn save_dib_to_library(
    dib: &[u8],
    width: u32,
    height: u32,
    kind: String,
    options: &LibrarySaveOptions,
) -> Result<StoredScreenshot, String> {
    let folder = ensure_screenshots_folder(&options.folder_path)?;
    let (bytes, extension) = if options.format == "jpeg" {
        (
            platform::dib_to_jpeg_bytes_with_quality(dib, width, height, options.jpeg_quality)?,
            "jpg",
        )
    } else {
        (platform::dib_to_png_bytes(dib, width, height)?, "png")
    };
    let captured_at = now_millis();
    let normalized_kind = normalize_kind(&kind);
    let file_name = format!("KKTerm-{normalized_kind}-{captured_at}.{extension}");
    let path = folder.join(file_name);
    fs::write(&path, bytes).map_err(|error| format!("failed to save screenshot: {error}"))?;
    stored_screenshot_from_path(&folder, path)
}

fn ensure_screenshots_folder(folder_path: &str) -> Result<PathBuf, String> {
    let folder = expand_user_profile(folder_path);
    fs::create_dir_all(&folder)
        .map_err(|error| format!("failed to create screenshots folder: {error}"))?;
    Ok(folder)
}

fn expand_user_profile(path: &str) -> PathBuf {
    let trimmed = path.trim();
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from);
    if let Some(rest) = trimmed.strip_prefix("%USERPROFILE%") {
        if let Some(home) = home {
            return home.join(rest.trim_start_matches(['\\', '/']));
        }
    }
    PathBuf::from(trimmed)
}

fn stored_screenshot_from_path(
    screenshots_folder: &Path,
    path: PathBuf,
) -> Result<StoredScreenshot, String> {
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("failed to read screenshot metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("screenshot path is not a file".to_string());
    }

    let (width, height) = image::image_dimensions(&path)
        .map_err(|error| format!("failed to read screenshot: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "screenshot file name is not valid UTF-8".to_string())?
        .to_string();
    let captured_at = metadata
        .modified()
        .ok()
        .and_then(system_time_to_millis)
        .unwrap_or_else(now_millis);
    let canonical_folder = screenshots_folder
        .canonicalize()
        .map_err(|error| format!("failed to resolve screenshots folder: {error}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve screenshot path: {error}"))?;
    let relative = canonical_path
        .strip_prefix(&canonical_folder)
        .map_err(|_| "screenshot is outside the screenshots folder".to_string())?;
    let id = relative.to_string_lossy().replace('\\', "/");
    let kind = kind_from_file_name(&file_name);
    let thumbnail_data_url = ensure_thumbnail_data_url(screenshots_folder, &path, &file_name)?;

    Ok(StoredScreenshot {
        id,
        path: path.to_string_lossy().to_string(),
        file_name,
        thumbnail_data_url,
        width,
        height,
        file_size_bytes: metadata.len(),
        captured_at,
        kind,
    })
}

/// Returns the cached thumbnail for a library image as a JPEG data URL,
/// regenerating it when the source file is newer than the cache entry. The
/// cache lives in a hidden `.kkterm-thumbs` subfolder so gallery listings do
/// not decode and base64 every full-size capture.
fn ensure_thumbnail_data_url(
    folder: &Path,
    path: &Path,
    file_name: &str,
) -> Result<String, String> {
    let thumbs_dir = folder.join(THUMBS_DIR_NAME);
    let thumb_path = thumbs_dir.join(format!("{file_name}.thumb.jpg"));
    let source_modified = fs::metadata(path).ok().and_then(|meta| meta.modified().ok());
    let thumb_fresh = match (fs::metadata(&thumb_path), source_modified) {
        (Ok(thumb_meta), Some(source_modified)) => thumb_meta
            .modified()
            .map(|thumb_modified| thumb_modified >= source_modified)
            .unwrap_or(false),
        _ => false,
    };

    if !thumb_fresh {
        fs::create_dir_all(&thumbs_dir)
            .map_err(|error| format!("failed to create thumbnail folder: {error}"))?;
        let image =
            image::open(path).map_err(|error| format!("failed to read screenshot: {error}"))?;
        let thumbnail = image.thumbnail(THUMB_LONG_EDGE, THUMB_LONG_EDGE).to_rgb8();
        let mut jpeg = Vec::new();
        {
            use image::{ColorType, ImageEncoder, codecs::jpeg::JpegEncoder};
            JpegEncoder::new_with_quality(&mut jpeg, 80)
                .write_image(
                    thumbnail.as_raw(),
                    thumbnail.width(),
                    thumbnail.height(),
                    ColorType::Rgb8.into(),
                )
                .map_err(|error| format!("failed to encode thumbnail: {error}"))?;
        }
        fs::write(&thumb_path, &jpeg)
            .map_err(|error| format!("failed to save thumbnail: {error}"))?;
        return Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)));
    }

    let bytes = fs::read(&thumb_path)
        .map_err(|error| format!("failed to load thumbnail: {error}"))?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

fn remove_thumbnail_for(folder: &Path, id: &str) {
    let _ = fs::remove_file(
        folder
            .join(THUMBS_DIR_NAME)
            .join(format!("{id}.thumb.jpg")),
    );
}

fn screenshot_path_from_id(folder: &Path, id: &str) -> Result<PathBuf, String> {
    if id.contains("..") || id.contains('\\') || id.contains('/') {
        return Err("invalid screenshot id".to_string());
    }
    let path = folder.join(id);
    let canonical_folder = folder
        .canonicalize()
        .map_err(|error| format!("failed to resolve screenshots folder: {error}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve screenshot path: {error}"))?;
    if !canonical_path.starts_with(&canonical_folder) {
        return Err("screenshot path is outside the screenshots folder".to_string());
    }
    Ok(canonical_path)
}

fn is_supported_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png"
            )
        })
        .unwrap_or(false)
}

fn mime_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        _ => "image/jpeg",
    }
}

fn normalize_kind(kind: &str) -> &'static str {
    match kind {
        "region" => "region",
        "fullscreen" => "fullscreen",
        "window" => "window",
        _ => "screenshot",
    }
}

fn kind_from_file_name(file_name: &str) -> String {
    let lower = file_name.to_ascii_lowercase();
    if lower.contains("-region-") {
        "region".to_string()
    } else if lower.contains("-fullscreen-") {
        "fullscreen".to_string()
    } else if lower.contains("-window-") {
        "window".to_string()
    } else {
        "screenshot".to_string()
    }
}

fn now_millis() -> u128 {
    system_time_to_millis(SystemTime::now()).unwrap_or(0)
}

fn system_time_to_millis(time: SystemTime) -> Option<u128> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

#[cfg(target_os = "windows")]
mod platform {
    use std::{ffi::c_void, mem, ptr};

    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use image::{ColorType, ImageEncoder, codecs::jpeg::JpegEncoder};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture, VK_ESCAPE};
    use windows_sys::Win32::{
        Foundation::{GlobalFree, HANDLE, HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::{
            BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BeginPaint, BitBlt, CAPTUREBLT,
            CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DIB_RGB_COLORS, DeleteDC,
            DeleteObject, EndPaint, FillRect, FrameRect, GetDC, GetDIBits, HBITMAP, HBRUSH, HDC,
            HGDIOBJ, InvalidateRect, PAINTSTRUCT, ReleaseDC, SRCCOPY, SelectObject,
            SetDIBitsToDevice,
        },
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
            Ole::CF_DIB,
        },
        UI::WindowsAndMessaging::{
            CREATESTRUCTW, CS_HREDRAW, CS_VREDRAW, CreateWindowExW, DefWindowProcW, DestroyWindow,
            DispatchMessageW, EnumWindows, GWLP_USERDATA, GetMessageW, GetSystemMetrics,
            GetWindowLongPtrW, GetWindowRect, IDC_CROSS, IsWindowVisible, LoadCursorW, MSG,
            PostQuitMessage, RegisterClassW, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
            SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SW_SHOW, SetWindowLongPtrW, ShowWindow,
            TranslateMessage, WM_CREATE, WM_DESTROY, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP,
            WM_MOUSEMOVE, WM_NCCREATE, WM_PAINT, WNDCLASSW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
            WS_POPUP,
        },
    };

    pub struct ScreenRect {
        pub x: i32,
        pub y: i32,
        pub width: i32,
        pub height: i32,
    }

    pub fn virtual_screen_rect() -> ScreenRect {
        let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) }.max(1);
        let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) }.max(1);
        ScreenRect {
            x: unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) },
            y: unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) },
            width,
            height,
        }
    }

    pub fn enumerate_window_rects(screen: &ScreenRect) -> Vec<ScreenRect> {
        unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> i32 {
            unsafe {
                let state = &mut *(lparam as *mut WindowEnumeration);
                if IsWindowVisible(hwnd) == 0 {
                    return 1;
                }

                let mut rect: RECT = mem::zeroed();
                if GetWindowRect(hwnd, &mut rect) == 0 {
                    return 1;
                }

                let Some(rect) = screen_rect_from_rect(rect) else {
                    return 1;
                };
                if rect.width < 80 || rect.height < 60 || !rect_intersects(&rect, state.screen) {
                    return 1;
                }

                state
                    .windows
                    .push(clamp_rect_to_screen(&rect, state.screen));
                1
            }
        }

        let mut state = WindowEnumeration {
            screen,
            windows: Vec::new(),
        };
        unsafe {
            let _ = EnumWindows(Some(enum_window), &mut state as *mut _ as LPARAM);
        }
        state.windows
    }

    pub fn select_window_rect(
        dib: &[u8],
        screen: &ScreenRect,
        windows: Vec<ScreenRect>,
    ) -> Result<Option<ScreenRect>, String> {
        run_selection_overlay(dib, screen, SelectionMode::Window { windows })
    }

    pub fn select_region_rect(
        dib: &[u8],
        screen: &ScreenRect,
    ) -> Result<Option<ScreenRect>, String> {
        run_selection_overlay(dib, screen, SelectionMode::Region)
    }

    pub fn crop_dib(
        dib: &[u8],
        source_width: i32,
        source_height: i32,
        source_screen: &ScreenRect,
        target: &ScreenRect,
    ) -> Result<Vec<u8>, String> {
        if target.width <= 0 || target.height <= 0 {
            return Err("screenshot region must have a positive size".to_string());
        }

        let header_size = mem::size_of::<BITMAPINFOHEADER>();
        let source_width = source_width.max(1) as usize;
        let source_height = source_height.max(1) as usize;
        let target_width = target.width.max(1) as usize;
        let target_height = target.height.max(1) as usize;
        let expected_len = header_size + source_width * source_height * 4;
        if dib.len() < expected_len {
            return Err("captured screenshot image data is incomplete".to_string());
        }

        let offset_x = (target.x - source_screen.x).max(0) as usize;
        let offset_y = (target.y - source_screen.y).max(0) as usize;
        if offset_x >= source_width || offset_y >= source_height {
            return Err("screenshot selection is outside the captured screen".to_string());
        }

        let copy_width = target_width.min(source_width - offset_x);
        let copy_height = target_height.min(source_height - offset_y);
        let mut cropped = vec![0u8; header_size + copy_width * copy_height * 4];
        cropped[..header_size].copy_from_slice(&dib[..header_size]);
        unsafe {
            let header = cropped.as_mut_ptr() as *mut BITMAPINFOHEADER;
            (*header).biWidth = copy_width as i32;
            (*header).biHeight = -(copy_height as i32);
            (*header).biSizeImage = (copy_width * copy_height * 4) as u32;
        }

        let source_pixels = &dib[header_size..expected_len];
        let target_pixels = &mut cropped[header_size..];
        for row in 0..copy_height {
            let source_start = ((offset_y + row) * source_width + offset_x) * 4;
            let source_end = source_start + copy_width * 4;
            let target_start = row * copy_width * 4;
            target_pixels[target_start..target_start + copy_width * 4]
                .copy_from_slice(&source_pixels[source_start..source_end]);
        }

        Ok(cropped)
    }

    pub fn capture_screen_rect_to_clipboard(
        owner_hwnd: HWND,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        use_directx: bool,
    ) -> Result<(), String> {
        let dib = capture_screen_rect_to_dib(x, y, width, height, use_directx)?;
        unsafe { write_dib_to_clipboard(owner_hwnd, &dib) }
    }

    pub fn write_rgba_to_clipboard(
        owner_hwnd: HWND,
        rgba: &[u8],
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        let expected = width as usize * height as usize * 4;
        if width == 0 || height == 0 || rgba.len() < expected {
            return Err("stitched screenshot image data is incomplete".to_string());
        }
        let header_size = mem::size_of::<BITMAPINFOHEADER>();
        let mut dib = vec![0u8; header_size + expected];
        unsafe {
            let header = dib.as_mut_ptr() as *mut BITMAPINFOHEADER;
            (*header).biSize = header_size as u32;
            (*header).biWidth = width as i32;
            (*header).biHeight = -(height as i32);
            (*header).biPlanes = 1;
            (*header).biBitCount = 32;
            (*header).biCompression = BI_RGB;
            (*header).biSizeImage = expected as u32;
        }
        for (source, target) in rgba[..expected]
            .chunks_exact(4)
            .zip(dib[header_size..].chunks_exact_mut(4))
        {
            target.copy_from_slice(&[source[2], source[1], source[0], source[3]]);
        }
        unsafe { write_dib_to_clipboard(owner_hwnd, &dib) }
    }

    pub fn capture_screen_rect_to_dib(
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        use_directx: bool,
    ) -> Result<Vec<u8>, String> {
        if use_directx {
            match capture_screen_rect_to_dib_dxgi(x, y, width, height) {
                Ok(dib) => return Ok(dib),
                Err(error) => {
                    eprintln!("DXGI screenshot capture fell back to GDI: {error}");
                }
            }
        }
        capture_screen_rect_to_dib_gdi(x, y, width, height)
    }

    fn capture_screen_rect_to_dib_gdi(
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<Vec<u8>, String> {
        if width <= 0 || height <= 0 {
            return Err("screenshot region must have a positive size".to_string());
        }

        unsafe {
            let screen_dc = ScreenDc::new()?;
            let memory_dc = MemoryDc::new(screen_dc.0)?;
            let bitmap = Bitmap::new(screen_dc.0, width, height)?;
            let previous = SelectObject(memory_dc.0, bitmap.0 as HGDIOBJ);
            if previous.is_null() {
                return Err("failed to select screenshot bitmap".to_string());
            }

            let copied = BitBlt(
                memory_dc.0,
                0,
                0,
                width,
                height,
                screen_dc.0,
                x,
                y,
                SRCCOPY | CAPTUREBLT,
            );
            let _ = SelectObject(memory_dc.0, previous);
            if copied == 0 {
                return Err("failed to capture screenshot region".to_string());
            }

            bitmap_to_dib(screen_dc.0, bitmap.0, width, height)
        }
    }

    fn capture_screen_rect_to_dib_dxgi(
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<Vec<u8>, String> {
        if width <= 0 || height <= 0 {
            return Err("screenshot region must have a positive size".to_string());
        }

        directx::capture_screen_rect_to_dib(x, y, width, height)
    }

    fn bgra_pixels_to_dib(pixels: &[u8], width: i32, height: i32) -> Result<Vec<u8>, String> {
        let stride = ((width * 32 + 31) / 32) * 4;
        let image_size = (stride * height) as usize;
        let header_size = mem::size_of::<BITMAPINFOHEADER>();
        let expected_len = image_size;
        if pixels.len() < expected_len {
            return Err("captured screenshot image data is incomplete".to_string());
        }

        let mut dib = vec![0u8; header_size + image_size];
        unsafe {
            let header = dib.as_mut_ptr() as *mut BITMAPINFOHEADER;
            (*header).biSize = header_size as u32;
            (*header).biWidth = width;
            (*header).biHeight = -height;
            (*header).biPlanes = 1;
            (*header).biBitCount = 32;
            (*header).biCompression = BI_RGB;
            (*header).biSizeImage = image_size as u32;

            dib[header_size..header_size + image_size].copy_from_slice(&pixels[..expected_len]);
        }
        Ok(dib)
    }

    mod directx {
        use std::slice;

        use windows::{
            Win32::{
                Foundation::HMODULE,
                Graphics::{
                    Direct3D::{
                        D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1,
                    },
                    Direct3D11::{
                        D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_FLAG, D3D11_MAP_READ,
                        D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
                        D3D11_USAGE_STAGING, D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext,
                        ID3D11Texture2D,
                    },
                    Dxgi::{
                        Common::{
                            DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_MODE_ROTATION_IDENTITY,
                            DXGI_SAMPLE_DESC,
                        },
                        CreateDXGIFactory1, DXGI_OUTDUPL_FRAME_INFO, IDXGIAdapter, IDXGIAdapter1,
                        IDXGIFactory1, IDXGIOutput, IDXGIOutput1, IDXGIResource,
                    },
                },
            },
            core::Interface,
        };

        use super::bgra_pixels_to_dib;

        const DXGI_FRAME_ATTEMPTS: usize = 4;
        const DXGI_FRAME_TIMEOUT_MS: u32 = 80;

        pub fn capture_screen_rect_to_dib(
            x: i32,
            y: i32,
            width: i32,
            height: i32,
        ) -> Result<Vec<u8>, String> {
            unsafe {
                let factory: IDXGIFactory1 = CreateDXGIFactory1()
                    .map_err(|error| format!("failed to create DXGI factory: {error}"))?;
                let output = find_output_for_rect(&factory, x, y, width, height)?;
                log_dxgi(&format!(
                    "output rect=({}, {})-({}, {}), rotation={}, request=({}, {}, {}, {})",
                    output.left,
                    output.top,
                    output.right,
                    output.bottom,
                    output.rotation,
                    x,
                    y,
                    width,
                    height
                ));
                capture_output_rect(output, x, y, width, height)
            }
        }

        struct DxgiOutputTarget {
            adapter: IDXGIAdapter1,
            output: IDXGIOutput,
            left: i32,
            top: i32,
            right: i32,
            bottom: i32,
            rotation: i32,
        }

        unsafe fn find_output_for_rect(
            factory: &IDXGIFactory1,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
        ) -> Result<DxgiOutputTarget, String> {
            unsafe {
                let right = x
                    .checked_add(width)
                    .ok_or_else(|| "screenshot region is too wide".to_string())?;
                let bottom = y
                    .checked_add(height)
                    .ok_or_else(|| "screenshot region is too tall".to_string())?;
                let mut adapter_index = 0;
                while let Ok(adapter) = factory.EnumAdapters1(adapter_index) {
                    let mut output_index = 0;
                    while let Ok(output) = adapter.EnumOutputs(output_index) {
                        let desc = output
                            .GetDesc()
                            .map_err(|error| format!("failed to read DXGI output: {error}"))?;
                        let rect = desc.DesktopCoordinates;
                        if x >= rect.left
                            && y >= rect.top
                            && right <= rect.right
                            && bottom <= rect.bottom
                        {
                            return Ok(DxgiOutputTarget {
                                adapter,
                                output,
                                left: rect.left,
                                top: rect.top,
                                right: rect.right,
                                bottom: rect.bottom,
                                rotation: desc.Rotation.0,
                            });
                        }
                        output_index += 1;
                    }
                    adapter_index += 1;
                }

                Err(
                    "screenshot region spans multiple outputs or no matching DXGI output was found"
                        .to_string(),
                )
            }
        }

        unsafe fn capture_output_rect(
            target: DxgiOutputTarget,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
        ) -> Result<Vec<u8>, String> {
            unsafe {
                let adapter: IDXGIAdapter = target
                    .adapter
                    .cast()
                    .map_err(|error| format!("failed to use DXGI adapter: {error}"))?;
                let output1: IDXGIOutput1 = target
                    .output
                    .cast()
                    .map_err(|error| format!("failed to use DXGI output duplication: {error}"))?;
                let (device, context) = create_device(&adapter)?;
                let duplication = output1
                    .DuplicateOutput(&device)
                    .map_err(|error| format!("failed to duplicate DXGI output: {error}"))?;

                for attempt in 1..=DXGI_FRAME_ATTEMPTS {
                    let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
                    let mut resource: Option<IDXGIResource> = None;
                    duplication
                        .AcquireNextFrame(DXGI_FRAME_TIMEOUT_MS, &mut frame_info, &mut resource)
                        .map_err(|error| format!("failed to acquire DXGI frame: {error}"))?;
                    let _frame_guard = FrameGuard {
                        duplication: duplication.clone(),
                    };
                    let frame = DxgiFrameStats::from_frame_info(&frame_info);
                    log_dxgi(&format!(
                        "frame attempt {attempt}/{DXGI_FRAME_ATTEMPTS}: last_present={}, last_mouse={}, accumulated={}, metadata={}, protected={}",
                        frame.last_present_time,
                        frame.last_mouse_update_time,
                        frame.accumulated_frames,
                        frame.total_metadata_buffer_size,
                        frame.protected_content_masked_out
                    ));
                    if !frame_has_desktop_update(&frame) {
                        continue;
                    }

                    let resource =
                        resource.ok_or_else(|| "DXGI frame resource is empty".to_string())?;
                    let desktop_texture: ID3D11Texture2D = resource
                        .cast()
                        .map_err(|error| format!("failed to read DXGI frame texture: {error}"))?;

                    return copy_desktop_texture_to_dib(
                        &device,
                        &context,
                        &desktop_texture,
                        &target,
                        x,
                        y,
                        width,
                        height,
                    );
                }

                Err(format!(
                    "DXGI did not acquire a desktop image update after {DXGI_FRAME_ATTEMPTS} attempts"
                ))
            }
        }

        unsafe fn copy_desktop_texture_to_dib(
            device: &ID3D11Device,
            context: &ID3D11DeviceContext,
            desktop_texture: &ID3D11Texture2D,
            target: &DxgiOutputTarget,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
        ) -> Result<Vec<u8>, String> {
            unsafe {
                let mut texture_desc = D3D11_TEXTURE2D_DESC::default();
                desktop_texture.GetDesc(&mut texture_desc);
                log_dxgi(&format!(
                    "texture desc: width={}, height={}, mip_levels={}, array_size={}, format={:?}, usage={:?}, bind_flags={}, cpu_access={}, misc={}",
                    texture_desc.Width,
                    texture_desc.Height,
                    texture_desc.MipLevels,
                    texture_desc.ArraySize,
                    texture_desc.Format,
                    texture_desc.Usage,
                    texture_desc.BindFlags,
                    texture_desc.CPUAccessFlags,
                    texture_desc.MiscFlags
                ));

                let geometry = DxgiCopyGeometry {
                    source_left: (x - target.left) as u32,
                    source_top: (y - target.top) as u32,
                    source_right: (x - target.left + width) as u32,
                    source_bottom: (y - target.top + height) as u32,
                };
                validate_copy_geometry(
                    geometry,
                    texture_desc.Width,
                    texture_desc.Height,
                    target.rotation,
                )?;

                let copy_texture = create_staging_texture(device, width as u32, height as u32)?;
                let source_box = D3D11_BOX {
                    left: geometry.source_left,
                    top: geometry.source_top,
                    front: 0,
                    right: geometry.source_right,
                    bottom: geometry.source_bottom,
                    back: 1,
                };
                context.CopySubresourceRegion(
                    &copy_texture,
                    0,
                    0,
                    0,
                    0,
                    desktop_texture,
                    0,
                    Some(&source_box),
                );

                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                context
                    .Map(&copy_texture, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                    .map_err(|error| format!("failed to map DXGI screenshot texture: {error}"))?;
                let _map_guard = MapGuard {
                    context: context.clone(),
                    texture: copy_texture.clone(),
                };
                log_dxgi(&format!("mapped row pitch: {}", mapped.RowPitch));

                let row_bytes = width as usize * 4;
                let mut pixels = vec![0u8; row_bytes * height as usize];
                for row in 0..height as usize {
                    let source = (mapped.pData as *const u8).add(row * mapped.RowPitch as usize);
                    let source = slice::from_raw_parts(source, row_bytes);
                    let target_start = row * row_bytes;
                    pixels[target_start..target_start + row_bytes].copy_from_slice(source);
                }
                log_dxgi(&format!(
                    "first non-black pixel sample: {:?}",
                    sample_non_black_pixel(&pixels, width as u32, height as u32)
                ));

                bgra_pixels_to_dib(&pixels, width, height)
            }
        }

        unsafe fn create_device(
            adapter: &IDXGIAdapter,
        ) -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
            unsafe {
                let preferred = [D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0];
                create_device_with_feature_levels(adapter, &preferred).or_else(|_| {
                    let fallback = [D3D_FEATURE_LEVEL_11_0];
                    create_device_with_feature_levels(adapter, &fallback)
                })
            }
        }

        unsafe fn create_device_with_feature_levels(
            adapter: &IDXGIAdapter,
            feature_levels: &[windows::Win32::Graphics::Direct3D::D3D_FEATURE_LEVEL],
        ) -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
            unsafe {
                let mut device = None;
                let mut context = None;
                D3D11CreateDevice(
                    adapter,
                    D3D_DRIVER_TYPE_UNKNOWN,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_FLAG(0),
                    Some(feature_levels),
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    None,
                    Some(&mut context),
                )
                .map_err(|error| format!("failed to create D3D11 device: {error}"))?;

                Ok((
                    device.ok_or_else(|| "D3D11 device is empty".to_string())?,
                    context.ok_or_else(|| "D3D11 device context is empty".to_string())?,
                ))
            }
        }

        unsafe fn create_staging_texture(
            device: &ID3D11Device,
            width: u32,
            height: u32,
        ) -> Result<ID3D11Texture2D, String> {
            unsafe {
                let desc = D3D11_TEXTURE2D_DESC {
                    Width: width.max(1),
                    Height: height.max(1),
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    SampleDesc: DXGI_SAMPLE_DESC {
                        Count: 1,
                        Quality: 0,
                    },
                    Usage: D3D11_USAGE_STAGING,
                    BindFlags: 0,
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    MiscFlags: 0,
                };
                let mut texture = None;
                device
                    .CreateTexture2D(&desc, None, Some(&mut texture))
                    .map_err(|error| format!("failed to create D3D11 staging texture: {error}"))?;
                texture.ok_or_else(|| "D3D11 staging texture is empty".to_string())
            }
        }

        #[derive(Clone, Copy, Debug, Eq, PartialEq)]
        struct DxgiFrameStats {
            last_present_time: i64,
            last_mouse_update_time: i64,
            accumulated_frames: u32,
            total_metadata_buffer_size: u32,
            protected_content_masked_out: bool,
        }

        impl DxgiFrameStats {
            fn from_frame_info(frame_info: &DXGI_OUTDUPL_FRAME_INFO) -> Self {
                Self {
                    last_present_time: frame_info.LastPresentTime,
                    last_mouse_update_time: frame_info.LastMouseUpdateTime,
                    accumulated_frames: frame_info.AccumulatedFrames,
                    total_metadata_buffer_size: frame_info.TotalMetadataBufferSize,
                    protected_content_masked_out: frame_info.ProtectedContentMaskedOut.as_bool(),
                }
            }
        }

        fn frame_has_desktop_update(frame: &DxgiFrameStats) -> bool {
            frame.last_present_time != 0
                || frame.accumulated_frames > 0
                || frame.total_metadata_buffer_size > 0
        }

        #[derive(Clone, Copy, Debug)]
        struct DxgiCopyGeometry {
            source_left: u32,
            source_top: u32,
            source_right: u32,
            source_bottom: u32,
        }

        fn validate_copy_geometry(
            geometry: DxgiCopyGeometry,
            texture_width: u32,
            texture_height: u32,
            rotation: i32,
        ) -> Result<(), String> {
            if rotation != DXGI_MODE_ROTATION_IDENTITY.0 {
                return Err(format!(
                    "DXGI output is rotated ({rotation}); falling back to GDI"
                ));
            }
            if geometry.source_left >= geometry.source_right
                || geometry.source_top >= geometry.source_bottom
            {
                return Err("DXGI screenshot source box is empty".to_string());
            }
            if geometry.source_right > texture_width || geometry.source_bottom > texture_height {
                return Err(format!(
                    "DXGI screenshot source box is outside texture bounds: box=({}, {})-({}, {}), texture={}x{}",
                    geometry.source_left,
                    geometry.source_top,
                    geometry.source_right,
                    geometry.source_bottom,
                    texture_width,
                    texture_height
                ));
            }
            Ok(())
        }

        #[derive(Clone, Copy, Debug, Eq, PartialEq)]
        struct DxgiPixelSample {
            x: u32,
            y: u32,
            b: u8,
            g: u8,
            r: u8,
            a: u8,
        }

        fn sample_non_black_pixel(
            pixels: &[u8],
            width: u32,
            height: u32,
        ) -> Option<DxgiPixelSample> {
            let expected_len = width as usize * height as usize * 4;
            if pixels.len() < expected_len {
                return None;
            }
            pixels[..expected_len]
                .chunks_exact(4)
                .enumerate()
                .find_map(|(index, bgra)| {
                    if bgra[0] == 0 && bgra[1] == 0 && bgra[2] == 0 {
                        return None;
                    }
                    Some(DxgiPixelSample {
                        x: (index as u32) % width,
                        y: (index as u32) / width,
                        b: bgra[0],
                        g: bgra[1],
                        r: bgra[2],
                        a: bgra[3],
                    })
                })
        }

        #[cfg(debug_assertions)]
        fn log_dxgi(message: &str) {
            eprintln!("DXGI screenshot capture: {message}");
        }

        #[cfg(not(debug_assertions))]
        fn log_dxgi(_message: &str) {}

        struct FrameGuard {
            duplication: windows::Win32::Graphics::Dxgi::IDXGIOutputDuplication,
        }

        impl Drop for FrameGuard {
            fn drop(&mut self) {
                unsafe {
                    let _ = self.duplication.ReleaseFrame();
                }
            }
        }

        struct MapGuard {
            context: ID3D11DeviceContext,
            texture: ID3D11Texture2D,
        }

        impl Drop for MapGuard {
            fn drop(&mut self) {
                unsafe {
                    self.context.Unmap(&self.texture, 0);
                }
            }
        }

        #[cfg(test)]
        mod tests {
            use super::*;

            #[test]
            fn dxgi_rejects_pointer_only_frame() {
                let frame = DxgiFrameStats {
                    last_present_time: 0,
                    last_mouse_update_time: 12,
                    accumulated_frames: 0,
                    total_metadata_buffer_size: 0,
                    protected_content_masked_out: false,
                };

                assert!(!frame_has_desktop_update(&frame));
            }

            #[test]
            fn dxgi_accepts_desktop_frame() {
                let frame = DxgiFrameStats {
                    last_present_time: 15,
                    last_mouse_update_time: 0,
                    accumulated_frames: 1,
                    total_metadata_buffer_size: 16,
                    protected_content_masked_out: false,
                };

                assert!(frame_has_desktop_update(&frame));
            }

            #[test]
            fn dxgi_rejects_rotated_output_before_copy() {
                let geometry = DxgiCopyGeometry {
                    source_left: 0,
                    source_top: 0,
                    source_right: 100,
                    source_bottom: 80,
                };

                let error = validate_copy_geometry(geometry, 100, 80, 2)
                    .expect_err("rotation should fall back to GDI");

                assert!(error.contains("rotated"));
            }

            #[test]
            fn dxgi_rejects_source_box_outside_texture_before_copy() {
                let geometry = DxgiCopyGeometry {
                    source_left: 20,
                    source_top: 10,
                    source_right: 140,
                    source_bottom: 90,
                };

                let error = validate_copy_geometry(geometry, 100, 80, 1)
                    .expect_err("invalid source box should fall back to GDI");

                assert!(error.contains("outside"));
            }

            #[test]
            fn dxgi_samples_first_non_black_pixel() {
                let mut pixels = vec![0u8; 4 * 3];
                pixels[8] = 12;
                pixels[9] = 34;
                pixels[10] = 56;
                pixels[11] = 255;

                let sample = sample_non_black_pixel(&pixels, 3, 1);

                assert_eq!(
                    sample,
                    Some(DxgiPixelSample {
                        x: 2,
                        y: 0,
                        b: 12,
                        g: 34,
                        r: 56,
                        a: 255,
                    })
                );
            }

            #[test]
            fn dxgi_reports_no_non_black_pixel_for_black_frame() {
                let pixels = vec![0u8; 4 * 3];

                assert_eq!(sample_non_black_pixel(&pixels, 3, 1), None);
            }
        }
    }

    pub struct JpegResult {
        pub data_url: String,
        pub width: u32,
        pub height: u32,
    }

    pub fn dib_to_jpeg_data_url(dib: &[u8], width: u32, height: u32) -> Result<JpegResult, String> {
        let jpeg = dib_to_jpeg_bytes(dib, width, height)?;
        Ok(JpegResult {
            data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)),
            width,
            height,
        })
    }

    pub fn dib_to_jpeg_bytes(dib: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
        dib_to_jpeg_bytes_with_quality(dib, width, height, 90)
    }

    pub fn dib_to_jpeg_bytes_with_quality(
        dib: &[u8],
        width: u32,
        height: u32,
        quality: u8,
    ) -> Result<Vec<u8>, String> {
        let rgb = dib_to_rgb(dib, width, height)?;
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, quality.clamp(1, 100))
            .write_image(&rgb, width, height, ColorType::Rgb8.into())
            .map_err(|error| format!("failed to encode JPEG: {error}"))?;
        Ok(jpeg)
    }

    pub fn dib_to_png_bytes(dib: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
        use image::codecs::png::PngEncoder;

        let rgb = dib_to_rgb(dib, width, height)?;
        let mut png = Vec::new();
        PngEncoder::new(&mut png)
            .write_image(&rgb, width, height, ColorType::Rgb8.into())
            .map_err(|error| format!("failed to encode PNG: {error}"))?;
        Ok(png)
    }

    // GDI/DXGI captures leave the DIB alpha channel undefined (often zero), so
    // encoders must drop it instead of trusting it — an as-is RGBA encode would
    // produce a fully transparent PNG.
    fn dib_to_rgb(dib: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
        let header_size = mem::size_of::<BITMAPINFOHEADER>();
        let expected_len = header_size + width as usize * height as usize * 4;
        if dib.len() < expected_len {
            return Err("captured screenshot image data is incomplete".to_string());
        }

        let pixels = &dib[header_size..expected_len];
        let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
        for bgra in pixels.chunks_exact(4) {
            rgb.push(bgra[2]);
            rgb.push(bgra[1]);
            rgb.push(bgra[0]);
        }
        Ok(rgb)
    }

    unsafe fn bitmap_to_dib(
        screen_dc: HDC,
        bitmap: HBITMAP,
        width: i32,
        height: i32,
    ) -> Result<Vec<u8>, String> {
        unsafe {
            let stride = ((width * 32 + 31) / 32) * 4;
            let image_size = (stride * height) as usize;
            let header_size = mem::size_of::<BITMAPINFOHEADER>();
            let mut dib = vec![0u8; header_size + image_size];

            let header = dib.as_mut_ptr() as *mut BITMAPINFOHEADER;
            (*header).biSize = header_size as u32;
            (*header).biWidth = width;
            (*header).biHeight = -height;
            (*header).biPlanes = 1;
            (*header).biBitCount = 32;
            (*header).biCompression = BI_RGB;
            (*header).biSizeImage = image_size as u32;

            let info = dib.as_mut_ptr() as *mut BITMAPINFO;
            let bits = dib.as_mut_ptr().add(header_size) as *mut c_void;
            let lines = GetDIBits(
                screen_dc,
                bitmap,
                0,
                height as u32,
                bits,
                info,
                DIB_RGB_COLORS,
            );
            if lines == 0 {
                return Err("failed to encode screenshot for clipboard".to_string());
            }

            Ok(dib)
        }
    }

    unsafe fn write_dib_to_clipboard(owner: HWND, dib: &[u8]) -> Result<(), String> {
        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE, dib.len());
            if handle.is_null() {
                return Err("failed to allocate clipboard image memory".to_string());
            }

            let target = GlobalLock(handle);
            if target.is_null() {
                let _ = GlobalFree(handle);
                return Err("failed to lock clipboard image memory".to_string());
            }
            ptr::copy_nonoverlapping(dib.as_ptr(), target as *mut u8, dib.len());
            let _ = GlobalUnlock(handle);

            if OpenClipboard(owner) == 0 {
                let _ = GlobalFree(handle);
                return Err("failed to open clipboard".to_string());
            }
            let clipboard = ClipboardGuard;

            if EmptyClipboard() == 0 {
                let _ = GlobalFree(handle);
                return Err("failed to clear clipboard".to_string());
            }
            if SetClipboardData(CF_DIB as u32, handle as HANDLE).is_null() {
                let _ = GlobalFree(handle);
                return Err("failed to write screenshot to clipboard".to_string());
            }

            mem::forget(clipboard);
            let _ = CloseClipboard();
            Ok(())
        }
    }

    enum SelectionMode {
        Window { windows: Vec<ScreenRect> },
        Region,
    }

    struct WindowEnumeration<'a> {
        screen: &'a ScreenRect,
        windows: Vec<ScreenRect>,
    }

    struct SelectionOverlay<'a> {
        dib: &'a [u8],
        screen: ScreenRect,
        mode: SelectionMode,
        result: Option<ScreenRect>,
        hover: Option<ScreenRect>,
        drag_start: Option<(i32, i32)>,
        drag_current: Option<(i32, i32)>,
    }

    fn run_selection_overlay(
        dib: &[u8],
        screen: &ScreenRect,
        mode: SelectionMode,
    ) -> Result<Option<ScreenRect>, String> {
        unsafe {
            let class_name = wide_null("KKTermScreenshotSelection");
            let cursor = LoadCursorW(ptr::null_mut(), IDC_CROSS);
            let wnd_class = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(selection_wnd_proc),
                hInstance: ptr::null_mut(),
                hCursor: cursor,
                lpszClassName: class_name.as_ptr(),
                ..mem::zeroed()
            };
            let _ = RegisterClassW(&wnd_class);

            let mut overlay = Box::new(SelectionOverlay {
                dib,
                screen: ScreenRect {
                    x: screen.x,
                    y: screen.y,
                    width: screen.width,
                    height: screen.height,
                },
                mode,
                result: None,
                hover: None,
                drag_start: None,
                drag_current: None,
            });
            let overlay_ptr = overlay.as_mut() as *mut SelectionOverlay;
            let hwnd = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                class_name.as_ptr(),
                class_name.as_ptr(),
                WS_POPUP,
                screen.x,
                screen.y,
                screen.width,
                screen.height,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                overlay_ptr.cast(),
            );
            if hwnd.is_null() {
                return Err("failed to create screenshot selection overlay".to_string());
            }

            ShowWindow(hwnd, SW_SHOW);
            let _ = InvalidateRect(hwnd, ptr::null(), 1);

            let mut message: MSG = mem::zeroed();
            while GetMessageW(&mut message, ptr::null_mut(), 0, 0) > 0 {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }

            Ok(overlay.result)
        }
    }

    unsafe extern "system" fn selection_wnd_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        unsafe {
            if message == WM_NCCREATE {
                let create = lparam as *const CREATESTRUCTW;
                let overlay = (*create).lpCreateParams as *mut SelectionOverlay;
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, overlay as isize);
                return DefWindowProcW(hwnd, message, wparam, lparam);
            }

            let overlay = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut SelectionOverlay;
            if overlay.is_null() {
                return DefWindowProcW(hwnd, message, wparam, lparam);
            }
            let overlay = &mut *overlay;

            match message {
                WM_CREATE => 0,
                WM_MOUSEMOVE => {
                    let point = message_point(lparam, &overlay.screen);
                    match &overlay.mode {
                        SelectionMode::Window { windows } => {
                            overlay.hover = windows
                                .iter()
                                .find(|rect| rect_contains(rect, point.0, point.1))
                                .map(copy_rect);
                        }
                        SelectionMode::Region => {
                            if overlay.drag_start.is_some() {
                                overlay.drag_current = Some(point);
                            }
                        }
                    }
                    let _ = InvalidateRect(hwnd, ptr::null(), 0);
                    0
                }
                WM_LBUTTONDOWN => {
                    let point = message_point(lparam, &overlay.screen);
                    match overlay.mode {
                        SelectionMode::Window { .. } => {
                            if let Some(rect) = overlay.hover.as_ref() {
                                overlay.result = Some(copy_rect(rect));
                                DestroyWindow(hwnd);
                            }
                        }
                        SelectionMode::Region => {
                            overlay.drag_start = Some(point);
                            overlay.drag_current = Some(point);
                            SetCapture(hwnd);
                        }
                    }
                    0
                }
                WM_LBUTTONUP => {
                    if matches!(overlay.mode, SelectionMode::Region) {
                        let point = message_point(lparam, &overlay.screen);
                        let _ = ReleaseCapture();
                        if let Some(start) = overlay.drag_start {
                            let rect = rect_from_points(start, point);
                            if rect.width >= 4 && rect.height >= 4 {
                                overlay.result = Some(clamp_rect_to_screen(&rect, &overlay.screen));
                            }
                        }
                        DestroyWindow(hwnd);
                    }
                    0
                }
                WM_KEYDOWN => {
                    if wparam == VK_ESCAPE as usize {
                        DestroyWindow(hwnd);
                        return 0;
                    }
                    DefWindowProcW(hwnd, message, wparam, lparam)
                }
                WM_PAINT => {
                    paint_selection_overlay(hwnd, overlay);
                    0
                }
                WM_DESTROY => {
                    PostQuitMessage(0);
                    0
                }
                _ => DefWindowProcW(hwnd, message, wparam, lparam),
            }
        }
    }

    unsafe fn paint_selection_overlay(hwnd: HWND, overlay: &SelectionOverlay<'_>) {
        unsafe {
            let mut paint: PAINTSTRUCT = mem::zeroed();
            let hdc = BeginPaint(hwnd, &mut paint);
            if hdc.is_null() {
                return;
            }

            let header_size = mem::size_of::<BITMAPINFOHEADER>();
            if overlay.dib.len() >= header_size {
                let info = overlay.dib.as_ptr() as *const BITMAPINFO;
                let bits = overlay.dib.as_ptr().add(header_size) as *const c_void;
                let _ = SetDIBitsToDevice(
                    hdc,
                    0,
                    0,
                    overlay.screen.width as u32,
                    overlay.screen.height as u32,
                    0,
                    0,
                    0,
                    overlay.screen.height as u32,
                    bits,
                    info,
                    DIB_RGB_COLORS,
                );
            }

            let selected = match overlay.mode {
                SelectionMode::Window { .. } => overlay.hover.as_ref().map(copy_rect),
                SelectionMode::Region => overlay
                    .drag_start
                    .zip(overlay.drag_current)
                    .map(|(start, current)| rect_from_points(start, current)),
            };
            let selected = selected
                .as_ref()
                .map(|rect| clamp_rect_to_screen(rect, &overlay.screen));
            dim_outside_rect(hdc, &overlay.screen, selected.as_ref());
            if let Some(rect) = selected {
                frame_rect(
                    hdc,
                    &screen_to_overlay_rect(&rect, &overlay.screen),
                    0x00ff_ffff,
                );
                let inner = inset_rect(&screen_to_overlay_rect(&rect, &overlay.screen), 1);
                frame_rect(hdc, &inner, 0x0000_78ff);
            }

            EndPaint(hwnd, &paint);
        }
    }

    unsafe fn dim_outside_rect(hdc: HDC, screen: &ScreenRect, selected: Option<&ScreenRect>) {
        unsafe {
            let brush = Brush::new(0x0000_0000);
            let Some(selected) = selected else {
                return;
            };

            let selected = screen_to_overlay_rect(selected, screen);
            for rect in outside_rects(screen.width, screen.height, &selected) {
                let _ = FillRect(hdc, &rect, brush.0);
            }
        }
    }

    unsafe fn frame_rect(hdc: HDC, rect: &RECT, color: u32) {
        unsafe {
            let brush = Brush::new(color);
            let _ = FrameRect(hdc, rect, brush.0);
        }
    }

    fn outside_rects(width: i32, height: i32, selected: &RECT) -> [RECT; 4] {
        [
            RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: selected.top.max(0),
            },
            RECT {
                left: 0,
                top: selected.bottom.min(height),
                right: width,
                bottom: height,
            },
            RECT {
                left: 0,
                top: selected.top.max(0),
                right: selected.left.max(0),
                bottom: selected.bottom.min(height),
            },
            RECT {
                left: selected.right.min(width),
                top: selected.top.max(0),
                right: width,
                bottom: selected.bottom.min(height),
            },
        ]
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn message_point(lparam: LPARAM, screen: &ScreenRect) -> (i32, i32) {
        let x = (lparam as u32 & 0xffff) as i16 as i32 + screen.x;
        let y = ((lparam as u32 >> 16) & 0xffff) as i16 as i32 + screen.y;
        (x, y)
    }

    fn screen_rect_from_rect(rect: RECT) -> Option<ScreenRect> {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return None;
        }
        Some(ScreenRect {
            x: rect.left,
            y: rect.top,
            width,
            height,
        })
    }

    fn rect_from_points(start: (i32, i32), end: (i32, i32)) -> ScreenRect {
        let x = start.0.min(end.0);
        let y = start.1.min(end.1);
        ScreenRect {
            x,
            y,
            width: (start.0 - end.0).abs(),
            height: (start.1 - end.1).abs(),
        }
    }

    fn rect_contains(rect: &ScreenRect, x: i32, y: i32) -> bool {
        x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
    }

    fn rect_intersects(rect: &ScreenRect, screen: &ScreenRect) -> bool {
        rect.x < screen.x + screen.width
            && rect.x + rect.width > screen.x
            && rect.y < screen.y + screen.height
            && rect.y + rect.height > screen.y
    }

    fn clamp_rect_to_screen(rect: &ScreenRect, screen: &ScreenRect) -> ScreenRect {
        let left = rect.x.max(screen.x);
        let top = rect.y.max(screen.y);
        let right = (rect.x + rect.width).min(screen.x + screen.width);
        let bottom = (rect.y + rect.height).min(screen.y + screen.height);
        ScreenRect {
            x: left,
            y: top,
            width: (right - left).max(1),
            height: (bottom - top).max(1),
        }
    }

    fn screen_to_overlay_rect(rect: &ScreenRect, screen: &ScreenRect) -> RECT {
        RECT {
            left: rect.x - screen.x,
            top: rect.y - screen.y,
            right: rect.x - screen.x + rect.width,
            bottom: rect.y - screen.y + rect.height,
        }
    }

    fn inset_rect(rect: &RECT, amount: i32) -> RECT {
        RECT {
            left: rect.left + amount,
            top: rect.top + amount,
            right: rect.right - amount,
            bottom: rect.bottom - amount,
        }
    }

    fn copy_rect(rect: &ScreenRect) -> ScreenRect {
        ScreenRect {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
        }
    }

    struct Brush(HBRUSH);

    impl Brush {
        unsafe fn new(color: u32) -> Self {
            unsafe { Self(CreateSolidBrush(color)) }
        }
    }

    impl Drop for Brush {
        fn drop(&mut self) {
            unsafe {
                let _ = DeleteObject(self.0 as HGDIOBJ);
            }
        }
    }

    struct ScreenDc(HDC);

    impl ScreenDc {
        unsafe fn new() -> Result<Self, String> {
            unsafe {
                let hdc = GetDC(ptr::null_mut());
                if hdc.is_null() {
                    return Err("failed to get screen device context".to_string());
                }
                Ok(Self(hdc))
            }
        }
    }

    impl Drop for ScreenDc {
        fn drop(&mut self) {
            unsafe {
                let _ = ReleaseDC(ptr::null_mut(), self.0);
            }
        }
    }

    struct MemoryDc(HDC);

    impl MemoryDc {
        unsafe fn new(screen_dc: HDC) -> Result<Self, String> {
            unsafe {
                let hdc = CreateCompatibleDC(screen_dc);
                if hdc.is_null() {
                    return Err("failed to create screenshot device context".to_string());
                }
                Ok(Self(hdc))
            }
        }
    }

    impl Drop for MemoryDc {
        fn drop(&mut self) {
            unsafe {
                let _ = DeleteDC(self.0);
            }
        }
    }

    struct Bitmap(HBITMAP);

    impl Bitmap {
        unsafe fn new(screen_dc: HDC, width: i32, height: i32) -> Result<Self, String> {
            unsafe {
                let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
                if bitmap.is_null() {
                    return Err("failed to create screenshot bitmap".to_string());
                }
                Ok(Self(bitmap))
            }
        }
    }

    impl Drop for Bitmap {
        fn drop(&mut self) {
            unsafe {
                let _ = DeleteObject(self.0 as HGDIOBJ);
            }
        }
    }

    struct ClipboardGuard;

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_window_kind_maps_labels() {
        assert_eq!(app_window_kind("main"), "main");
        assert_eq!(app_window_kind("MAIN"), "main");
        assert_eq!(app_window_kind("url-overlay-3"), "urlOverlay");
        assert_eq!(app_window_kind("webview2-1"), "urlOverlay");
        assert_eq!(app_window_kind("rdp-session-2"), "remoteDesktop");
        assert_eq!(app_window_kind("vnc-1"), "remoteDesktop");
        assert_eq!(app_window_kind("something-else"), "overlay");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn crop_rgba_extracts_subrect() {
        // 3x2 RGBA image; each pixel is (col, row, 0, 255).
        let mut src = Vec::new();
        for row in 0..2u8 {
            for col in 0..3u8 {
                src.extend_from_slice(&[col, row, 0, 255]);
            }
        }
        let (out, w, h) = crop_rgba(&src, 3, 2, 1, 0, 2, 2).unwrap();
        assert_eq!((w, h), (2, 2));
        // Top-left of the crop is the pixel at column 1, row 0.
        assert_eq!(&out[0..4], &[1, 0, 0, 255]);
        // Bottom-right is column 2, row 1.
        assert_eq!(&out[out.len() - 4..], &[2, 1, 0, 255]);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn crop_rgba_clamps_to_source_bounds() {
        let src = vec![0u8; 2 * 2 * 4];
        // Requesting a larger-than-source region clamps to the remaining pixels.
        let (_, w, h) = crop_rgba(&src, 2, 2, 1, 1, 10, 10).unwrap();
        assert_eq!((w, h), (1, 1));
        // Origin outside the source is an error.
        assert!(crop_rgba(&src, 2, 2, 2, 0, 1, 1).is_err());
    }
}

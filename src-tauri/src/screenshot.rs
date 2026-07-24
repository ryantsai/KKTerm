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
    has_draft: bool,
    width: u32,
    height: u32,
    file_size_bytes: u64,
    captured_at: u128,
    created_at: u128,
    modified_at: u128,
    taken_at: Option<u128>,
    kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotCaptureResult {
    stored_screenshot: Option<StoredScreenshot>,
    copied_to_clipboard: bool,
    open_in_editor: bool,
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
    pub quality: u8,
    pub capture_mode: String,
    pub open_in_editor_after_capture: bool,
    pub border_enabled: bool,
    pub border_width: u32,
    pub border_style: String,
    pub border_color: String,
    pub include_cursor: bool,
}

/// Parses a `#RRGGBB` border color, falling back to black.
fn parse_border_color(value: &str) -> (u8, u8, u8) {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() == 6 {
        if let Ok(rgb) = u32::from_str_radix(hex, 16) {
            return (
                ((rgb >> 16) & 0xFF) as u8,
                ((rgb >> 8) & 0xFF) as u8,
                (rgb & 0xFF) as u8,
            );
        }
    }
    (0, 0, 0)
}

/// Draws an inset border into a 4-bytes-per-pixel buffer. `color` is given in
/// the buffer's own channel order, so the same routine serves RGBA and BGRA.
fn apply_border_pixels(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    thickness: u32,
    style: &str,
    color: [u8; 4],
) {
    if width == 0 || height == 0 || pixels.len() < width as usize * height as usize * 4 {
        return;
    }
    let t = thickness
        .max(1)
        .min(width.div_ceil(2))
        .min(height.div_ceil(2));
    let (dash_on, dash_off) = match style {
        "dashed" => ((t * 4).max(8), (t * 2).max(4)),
        "dotted" => (t.max(2), t.max(2)),
        _ => (1, 0),
    };
    let on = |along: u32| dash_off == 0 || along % (dash_on + dash_off) < dash_on;
    let mut set = |x: u32, y: u32| {
        let index = (y as usize * width as usize + x as usize) * 4;
        pixels[index..index + 4].copy_from_slice(&color);
    };
    for y in (0..t.min(height)).chain(height.saturating_sub(t)..height) {
        for x in 0..width {
            if on(x) {
                set(x, y);
            }
        }
    }
    for y in t.min(height)..height.saturating_sub(t) {
        for x in (0..t.min(width)).chain(width.saturating_sub(t)..width) {
            if on(y) {
                set(x, y);
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListScreenshotsRequest {
    offset: Option<usize>,
    limit: Option<usize>,
    sort_by: Option<String>,
    sort_direction: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeScreenshotsRequest {
    ids: Vec<String>,
    mode: String,
    width: Option<u32>,
    height: Option<u32>,
    percentage: Option<u16>,
    preserve_aspect_ratio: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertScreenshotsRequest {
    ids: Vec<String>,
    format: String,
    quality: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEditedScreenshotRequest {
    id: String,
    data_url: String,
    save_as_copy: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveScreenshotDraftRequest {
    id: String,
    draft_json: String,
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
) -> Result<ScreenshotCaptureResult, String> {
    let target = capture_target(app, request)?;
    let mut dib = platform::capture_screen_rect_to_dib(
        target.x,
        target.y,
        target.width,
        target.height,
        use_directx,
    )?;
    if options.include_cursor {
        platform::draw_cursor_on_dib(&mut dib, target.x, target.y);
    }
    deliver_dib(
        app,
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
    minimize_window: bool,
) -> Result<ScreenshotCaptureResult, String> {
    let _guard = MinimizedCaptureWindow::new(app, minimize_window)?;
    let target = platform::virtual_screen_rect();
    let mut dib = platform::capture_screen_rect_to_dib(
        target.x,
        target.y,
        target.width,
        target.height,
        use_directx,
    )?;
    if options.include_cursor {
        platform::draw_cursor_on_dib(&mut dib, target.x, target.y);
    }
    deliver_dib(
        app,
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
    minimize_window: bool,
) -> Result<ScreenshotCaptureResult, String> {
    let _guard = MinimizedCaptureWindow::new(app, minimize_window)?;
    let screen = platform::virtual_screen_rect();
    let mut screen_dib = platform::capture_screen_rect_to_dib(
        screen.x,
        screen.y,
        screen.width,
        screen.height,
        use_directx,
    )?;
    if options.include_cursor {
        platform::draw_cursor_on_dib(&mut screen_dib, screen.x, screen.y);
    }
    let windows = platform::enumerate_window_rects(&screen);
    let target = platform::select_window_rect(&screen_dib, &screen, windows)?
        .ok_or_else(|| "screenshot capture canceled".to_string())?;
    let dib = platform::crop_dib(&screen_dib, screen.width, screen.height, &screen, &target)?;
    deliver_dib(
        app,
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
    minimize_window: bool,
) -> Result<ScreenshotCaptureResult, String> {
    let _guard = MinimizedCaptureWindow::new(app, minimize_window)?;
    let screen = platform::virtual_screen_rect();
    let mut screen_dib = platform::capture_screen_rect_to_dib(
        screen.x,
        screen.y,
        screen.width,
        screen.height,
        use_directx,
    )?;
    if options.include_cursor {
        platform::draw_cursor_on_dib(&mut screen_dib, screen.x, screen.y);
    }
    let target = platform::select_region_rect(&screen_dib, &screen)?
        .ok_or_else(|| "screenshot capture canceled".to_string())?;
    let dib = platform::crop_dib(&screen_dib, screen.width, screen.height, &screen, &target)?;
    deliver_dib(
        app,
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

struct MinimizedCaptureWindow {
    window: tauri::WebviewWindow,
    was_minimized: bool,
    was_visible: bool,
    did_minimize: bool,
}

impl MinimizedCaptureWindow {
    fn new(app: &tauri::AppHandle, minimize_window: bool) -> Result<Self, String> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window is not available".to_string())?;
        let was_minimized = window.is_minimized().unwrap_or(false);
        let was_visible = window.is_visible().unwrap_or(true);
        // A window already hidden to the tray must stay hidden: skip the
        // minimize/settle dance entirely so the capture never restores it.
        if was_visible && minimize_window {
            window
                .minimize()
                .map_err(|error| format!("failed to minimize window before screenshot: {error}"))?;
            thread::sleep(std::time::Duration::from_millis(350));
        }
        Ok(Self {
            window,
            was_minimized,
            was_visible,
            did_minimize: was_visible && minimize_window,
        })
    }
}

impl Drop for MinimizedCaptureWindow {
    fn drop(&mut self) {
        if !self.was_visible || !self.did_minimize {
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
    app: &tauri::AppHandle,
    request: CaptureScreenshotRequest,
    _use_directx: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let (rgba, win_width, win_height) = capture_window_rgba(&window)?;
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
    let (cropped, width, height) = crop_rgba(&rgba, win_width, win_height, x, y, width, height)?;
    write_rgba_to_clipboard(&cropped, width, height)
}

#[cfg(not(target_os = "windows"))]
pub fn write_data_url_to_clipboard(
    _app: &tauri::AppHandle,
    request: ScreenshotDataUrlRequest,
) -> Result<(), String> {
    let (_, encoded) = request
        .data_url
        .split_once(",")
        .filter(|(header, _)| header.starts_with("data:image/") && header.ends_with(";base64"))
        .ok_or_else(|| "screenshot is not a base64 image data URL".to_string())?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("failed to decode screenshot: {error}"))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| format!("failed to read screenshot: {error}"))?
        .to_rgba8();
    write_rgba_to_clipboard(image.as_raw(), image.width(), image.height())
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
    let region = capture_engine::capture_virtual_screen()?;
    rgba_to_jpeg_assistant(&region.rgba, region.width, region.height)
}

#[cfg(not(target_os = "windows"))]
pub fn capture_rect_to_library(
    app: &tauri::AppHandle,
    request: CaptureScreenshotRequest,
    kind: String,
    options: LibrarySaveOptions,
    _use_directx: bool,
) -> Result<ScreenshotCaptureResult, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let (rgba, win_width, win_height) = capture_window_rgba(&window)?;
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
    let (cropped, width, height) = crop_rgba(&rgba, win_width, win_height, x, y, width, height)?;
    deliver_rgba(&cropped, width, height, kind, &options)
}

#[cfg(not(target_os = "windows"))]
pub fn capture_fullscreen_to_library(
    app: &tauri::AppHandle,
    kind: String,
    options: LibrarySaveOptions,
    _use_directx: bool,
    minimize_window: bool,
) -> Result<ScreenshotCaptureResult, String> {
    let _guard = MinimizedCaptureWindow::new(app, minimize_window)?;
    let region = capture_engine::capture_virtual_screen()?;
    deliver_rgba(&region.rgba, region.width, region.height, kind, &options)
}

#[cfg(not(target_os = "windows"))]
pub fn capture_active_window_to_library(
    app: &tauri::AppHandle,
    kind: String,
    options: LibrarySaveOptions,
    _use_directx: bool,
    minimize_window: bool,
) -> Result<ScreenshotCaptureResult, String> {
    let _guard = MinimizedCaptureWindow::new(app, minimize_window)?;
    #[cfg(target_os = "macos")]
    let image = capture_macos_selection(true)?;
    #[cfg(target_os = "linux")]
    let image = capture_focused_window_image()?;
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    return Err("window screenshot capture is unavailable on this platform".to_string());
    deliver_rgba(
        image.as_raw(),
        image.width(),
        image.height(),
        kind,
        &options,
    )
}

#[cfg(not(target_os = "windows"))]
pub fn capture_interactive_region_to_library(
    app: &tauri::AppHandle,
    kind: String,
    options: LibrarySaveOptions,
    _use_directx: bool,
    minimize_window: bool,
) -> Result<ScreenshotCaptureResult, String> {
    let _guard = MinimizedCaptureWindow::new(app, minimize_window)?;
    #[cfg(target_os = "macos")]
    let image = capture_macos_selection(false)?;
    #[cfg(target_os = "linux")]
    let image = capture_linux_region_selection()?;
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    return Err("region screenshot capture is unavailable on this platform".to_string());
    deliver_rgba(
        image.as_raw(),
        image.width(),
        image.height(),
        kind,
        &options,
    )
}

#[cfg(not(target_os = "windows"))]
fn write_rgba_to_clipboard(rgba: &[u8], width: u32, height: u32) -> Result<(), String> {
    let expected = width as usize * height as usize * 4;
    if rgba.len() < expected {
        return Err("captured screenshot image data is incomplete".to_string());
    }
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("failed to open the image clipboard: {error}"))?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: std::borrow::Cow::Borrowed(&rgba[..expected]),
        })
        .map_err(|error| format!("failed to copy screenshot to the clipboard: {error}"))
}

fn save_rgba_to_library(
    rgba: &[u8],
    width: u32,
    height: u32,
    kind: String,
    options: &LibrarySaveOptions,
) -> Result<StoredScreenshot, String> {
    let expected = width as usize * height as usize * 4;
    if rgba.len() < expected {
        return Err("captured screenshot image data is incomplete".to_string());
    }
    let image = image::RgbaImage::from_raw(width, height, rgba[..expected].to_vec())
        .ok_or_else(|| "failed to build the captured screenshot image".to_string())?;
    let folder = ensure_screenshots_folder(&options.folder_path)?;
    let captured_at = now_millis();
    let normalized_kind = normalize_kind(&kind);
    let extension = if options.format == "jpeg" {
        "jpg"
    } else {
        "png"
    };
    let path = folder.join(format!(
        "KKTerm-{normalized_kind}-{captured_at}.{extension}"
    ));
    write_dynamic_image(
        &image::DynamicImage::ImageRgba8(image),
        &path,
        &options.format,
        options.quality,
    )?;
    stored_screenshot_from_path(&folder, path)
}

pub fn deliver_data_url_to_library(
    app: &tauri::AppHandle,
    request: ScreenshotDataUrlRequest,
    kind: String,
    options: LibrarySaveOptions,
) -> Result<ScreenshotCaptureResult, String> {
    let (_, encoded) = request
        .data_url
        .split_once(",")
        .filter(|(header, _)| header.starts_with("data:image/") && header.ends_with(";base64"))
        .ok_or_else(|| "screenshot is not a base64 image data URL".to_string())?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("failed to decode screenshot: {error}"))?;
    let mut image = image::load_from_memory(&bytes)
        .map_err(|error| format!("failed to read screenshot: {error}"))?
        .to_rgba8();
    let width = image.width();
    let height = image.height();

    if options.border_enabled {
        let (r, g, b) = parse_border_color(&options.border_color);
        apply_border_pixels(
            image.as_mut(),
            width,
            height,
            options.border_width,
            &options.border_style,
            [r, g, b, 0xFF],
        );
    }

    let copy_to_clipboard = options.capture_mode != "folder";
    let save_to_folder = options.capture_mode != "clipboard";
    if copy_to_clipboard {
        #[cfg(target_os = "windows")]
        {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "main window is not available".to_string())?;
            let hwnd = window
                .hwnd()
                .map_err(|error| format!("failed to resolve window handle: {error}"))?;
            platform::write_rgba_to_clipboard(hwnd.0, image.as_raw(), width, height)?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = app;
            write_rgba_to_clipboard(image.as_raw(), width, height)?;
        }
    }

    let stored_screenshot = if save_to_folder {
        Some(save_rgba_to_library(
            image.as_raw(),
            width,
            height,
            kind,
            &options,
        )?)
    } else {
        None
    };
    Ok(ScreenshotCaptureResult {
        open_in_editor: stored_screenshot.is_some() && options.open_in_editor_after_capture,
        stored_screenshot,
        copied_to_clipboard: copy_to_clipboard,
    })
}

#[cfg(not(target_os = "windows"))]
fn deliver_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    kind: String,
    options: &LibrarySaveOptions,
) -> Result<ScreenshotCaptureResult, String> {
    let bordered;
    let rgba = if options.border_enabled {
        let (r, g, b) = parse_border_color(&options.border_color);
        let mut copy = rgba.to_vec();
        apply_border_pixels(
            &mut copy,
            width,
            height,
            options.border_width,
            &options.border_style,
            [r, g, b, 0xFF],
        );
        bordered = copy;
        &bordered[..]
    } else {
        rgba
    };
    let copy_to_clipboard = options.capture_mode != "folder";
    let save_to_folder = options.capture_mode != "clipboard";

    if copy_to_clipboard {
        write_rgba_to_clipboard(rgba, width, height)?;
    }
    let stored_screenshot = if save_to_folder {
        Some(save_rgba_to_library(rgba, width, height, kind, options)?)
    } else {
        None
    };
    Ok(ScreenshotCaptureResult {
        open_in_editor: stored_screenshot.is_some() && options.open_in_editor_after_capture,
        stored_screenshot,
        copied_to_clipboard: copy_to_clipboard,
    })
}

#[cfg(target_os = "macos")]
fn capture_macos_selection(window_only: bool) -> Result<image::RgbaImage, String> {
    let temp = tempfile::tempdir()
        .map_err(|error| format!("failed to create screenshot workspace: {error}"))?;
    let path = temp.path().join("selection.png");
    let mut command = std::process::Command::new("/usr/sbin/screencapture");
    command.args(["-i", "-x"]);
    command.arg(if window_only { "-w" } else { "-s" });
    let status = command
        .arg(&path)
        .status()
        .map_err(|error| format!("failed to start the macOS screenshot selector: {error}"))?;
    if !status.success() || !path.is_file() {
        return Err("screenshot capture canceled".to_string());
    }
    image::open(&path)
        .map(|image| image.to_rgba8())
        .map_err(|error| format!("failed to read selected screenshot: {error}"))
}

#[cfg(target_os = "linux")]
fn capture_focused_window_image() -> Result<image::RgbaImage, String> {
    let own_pid = std::process::id();
    let windows =
        xcap::Window::all().map_err(|error| format!("failed to enumerate windows: {error}"))?;
    let usable = |window: &&xcap::Window| {
        window.pid().map(|pid| pid != own_pid).unwrap_or(false)
            && !window.is_minimized().unwrap_or(true)
            && window.width().unwrap_or(0) > 1
            && window.height().unwrap_or(0) > 1
    };
    let window = windows
        .iter()
        .filter(usable)
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.iter().filter(usable).next())
        .ok_or_else(|| "no desktop window is available to capture".to_string())?;
    window
        .capture_image()
        .map_err(|error| format!("failed to capture the selected window: {error}"))
}

#[cfg(target_os = "linux")]
fn capture_linux_region_selection() -> Result<image::RgbaImage, String> {
    use std::io::ErrorKind;

    if let Some(image) = capture_linux_portal_region_selection()? {
        return Ok(image);
    }

    let temp = tempfile::tempdir()
        .map_err(|error| format!("failed to create screenshot workspace: {error}"))?;
    let path = temp.path().join("selection.png");

    let load_if_selected = |status: std::process::ExitStatus| {
        if !status.success() || !path.is_file() {
            return Err("screenshot capture canceled".to_string());
        }
        image::open(&path)
            .map(|image| image.to_rgba8())
            .map_err(|error| format!("failed to read selected screenshot: {error}"))
    };

    match std::process::Command::new("gnome-screenshot")
        .args(["--area", "--file"])
        .arg(&path)
        .status()
    {
        Ok(status) => return load_if_selected(status),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to start the region selector: {error}")),
    }

    match std::process::Command::new("spectacle")
        .args(["--region", "--background", "--nonotify", "--output"])
        .arg(&path)
        .status()
    {
        Ok(status) => return load_if_selected(status),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to start the region selector: {error}")),
    }

    match std::process::Command::new("slurp").output() {
        Ok(selection) => {
            if !selection.status.success() {
                return Err("screenshot capture canceled".to_string());
            }
            let geometry = String::from_utf8(selection.stdout)
                .map_err(|error| format!("region selector returned invalid geometry: {error}"))?;
            let status = std::process::Command::new("grim")
                .args(["--geometry", geometry.trim()])
                .arg(&path)
                .status()
                .map_err(|error| format!("failed to capture the selected region: {error}"))?;
            return load_if_selected(status);
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to start the region selector: {error}")),
    }

    match std::process::Command::new("scrot")
        .arg("--select")
        .arg(&path)
        .status()
    {
        Ok(status) => load_if_selected(status),
        Err(error) if error.kind() == ErrorKind::NotFound => Err(
            "no supported region selector was found (install gnome-screenshot, Spectacle, grim with slurp, or scrot)"
                .to_string(),
        ),
        Err(error) => Err(format!("failed to start the region selector: {error}")),
    }
}

#[cfg(target_os = "linux")]
#[derive(zbus::zvariant::DeserializeDict, zbus::zvariant::Type, Debug)]
#[zvariant(signature = "dict")]
struct PortalScreenshotResponse {
    uri: String,
}

#[cfg(target_os = "linux")]
fn capture_linux_portal_region_selection() -> Result<Option<image::RgbaImage>, String> {
    use std::collections::HashMap;
    use zbus::{
        blocking::{Connection, Proxy},
        zvariant::Value,
    };

    let connection = match Connection::session() {
        Ok(connection) => connection,
        Err(_) => return Ok(None),
    };
    let unique_identifier = match connection.unique_name() {
        Some(name) => name.trim_start_matches(':').replace('.', "_"),
        None => return Ok(None),
    };
    let handle_token = format!("kkterm_{}", now_millis());
    let request_path =
        format!("/org/freedesktop/portal/desktop/request/{unique_identifier}/{handle_token}");
    let request = match Proxy::new(
        &connection,
        "org.freedesktop.portal.Desktop",
        request_path,
        "org.freedesktop.portal.Request",
    ) {
        Ok(request) => request,
        Err(_) => return Ok(None),
    };
    let mut responses = match request.receive_signal("Response") {
        Ok(responses) => responses,
        Err(_) => return Ok(None),
    };
    let portal = match Proxy::new(
        &connection,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Screenshot",
    ) {
        Ok(portal) => portal,
        Err(_) => return Ok(None),
    };
    let mut options: HashMap<&str, Value<'_>> = HashMap::new();
    options.insert("handle_token", Value::from(&handle_token));
    options.insert("modal", Value::from(true));
    options.insert("interactive", Value::from(true));
    if portal.call_method("Screenshot", &("", options)).is_err() {
        return Ok(None);
    }

    let message = responses
        .next()
        .ok_or_else(|| "the desktop screenshot portal did not respond".to_string())?;
    let (response_code, response): (u32, PortalScreenshotResponse) =
        message
            .body()
            .deserialize()
            .map_err(|error| format!("failed to read the desktop screenshot response: {error}"))?;
    if response_code == 1 {
        return Err("screenshot capture canceled".to_string());
    }
    if response_code != 0 {
        return Ok(None);
    }

    let url = url::Url::parse(&response.uri)
        .map_err(|error| format!("desktop screenshot portal returned an invalid URI: {error}"))?;
    let path = url
        .to_file_path()
        .map_err(|_| "desktop screenshot portal returned a non-file URI".to_string())?;
    let image = image::open(&path)
        .map(|image| image.to_rgba8())
        .map_err(|error| format!("failed to read selected screenshot: {error}"))?;
    let _ = fs::remove_file(path);
    Ok(Some(image))
}

// ---------------------------------------------------------------------------
// Cross-platform screen-region capture engine (xcap).
//
// The default capture engine on every platform: Windows Graphics Capture on
// Windows (xcap's `wgc` feature), ScreenCaptureKit on macOS, and X11/Wayland
// on Linux. Coordinates are the monitor coordinate space reported by
// `xcap::Monitor` — physical virtual-desktop pixels on Windows. Requests that
// span multiple monitors are composed monitor by monitor; Windows keeps its
// GDI path as the fallback when this engine errors.
// ---------------------------------------------------------------------------

mod capture_engine {
    pub struct RegionImage {
        pub rgba: Vec<u8>,
        pub width: u32,
        pub height: u32,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    impl Rect {
        fn width(&self) -> u32 {
            (self.right - self.left) as u32
        }

        fn height(&self) -> u32 {
            (self.bottom - self.top) as u32
        }
    }

    fn intersect(a: Rect, b: Rect) -> Option<Rect> {
        let rect = Rect {
            left: a.left.max(b.left),
            top: a.top.max(b.top),
            right: a.right.min(b.right),
            bottom: a.bottom.min(b.bottom),
        };
        (rect.left < rect.right && rect.top < rect.bottom).then_some(rect)
    }

    #[cfg(any(not(target_os = "windows"), test))]
    fn union(a: Rect, b: Rect) -> Rect {
        Rect {
            left: a.left.min(b.left),
            top: a.top.min(b.top),
            right: a.right.max(b.right),
            bottom: a.bottom.max(b.bottom),
        }
    }

    fn monitor_rect(monitor: &xcap::Monitor) -> Result<Rect, String> {
        let read = |error: xcap::XCapError| format!("failed to read monitor bounds: {error}");
        let left = monitor.x().map_err(read)?;
        let top = monitor.y().map_err(read)?;
        let width = monitor.width().map_err(read)? as i32;
        let height = monitor.height().map_err(read)? as i32;
        Ok(Rect {
            left,
            top,
            right: left + width,
            bottom: top + height,
        })
    }

    /// Scale a captured monitor image to the size its monitor rect promised
    /// when they disagree (e.g. macOS returns physical pixels for logical
    /// monitor coordinates). No-op on Windows, where both are physical.
    fn ensure_size(image: image::RgbaImage, width: u32, height: u32) -> image::RgbaImage {
        if image.width() == width && image.height() == height {
            image
        } else {
            image::imageops::resize(&image, width, height, image::imageops::FilterType::Triangle)
        }
    }

    /// Capture an arbitrary screen rect in monitor coordinates via xcap.
    pub fn capture_region_rgba(
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<RegionImage, String> {
        if width <= 0 || height <= 0 {
            return Err("screenshot region must have a positive size".to_string());
        }
        let request = Rect {
            left: x,
            top: y,
            right: x
                .checked_add(width)
                .ok_or_else(|| "screenshot region is too wide".to_string())?,
            bottom: y
                .checked_add(height)
                .ok_or_else(|| "screenshot region is too tall".to_string())?,
        };
        let monitors = xcap::Monitor::all()
            .map_err(|error| format!("failed to enumerate monitors: {error}"))?;

        // A request that is exactly one whole monitor keeps the monitor's
        // native capture resolution (full detail on scaled displays).
        for monitor in &monitors {
            if monitor_rect(monitor).ok() == Some(request) {
                let image = monitor
                    .capture_image()
                    .map_err(|error| format!("failed to capture monitor: {error}"))?;
                return Ok(RegionImage {
                    width: image.width(),
                    height: image.height(),
                    rgba: image.into_raw(),
                });
            }
        }

        let canvas_width = request.width() as usize;
        let canvas_stride = canvas_width * 4;
        let mut canvas = vec![0u8; canvas_stride * request.height() as usize];
        let mut covered = false;
        for monitor in &monitors {
            let Ok(rect) = monitor_rect(monitor) else {
                continue;
            };
            let Some(overlap) = intersect(rect, request) else {
                continue;
            };
            let image = monitor
                .capture_region(
                    (overlap.left - rect.left) as u32,
                    (overlap.top - rect.top) as u32,
                    overlap.width(),
                    overlap.height(),
                )
                .map_err(|error| format!("failed to capture monitor region: {error}"))?;
            let image = ensure_size(image, overlap.width(), overlap.height());
            let pixels = image.into_raw();
            let row_bytes = overlap.width() as usize * 4;
            let dst_x = (overlap.left - request.left) as usize;
            let dst_y = (overlap.top - request.top) as usize;
            for row in 0..overlap.height() as usize {
                let src_start = row * row_bytes;
                let dst_start = (dst_y + row) * canvas_stride + dst_x * 4;
                canvas[dst_start..dst_start + row_bytes]
                    .copy_from_slice(&pixels[src_start..src_start + row_bytes]);
            }
            covered = true;
        }
        if !covered {
            return Err("screenshot region does not intersect any display".to_string());
        }
        Ok(RegionImage {
            rgba: canvas,
            width: request.width(),
            height: request.height(),
        })
    }

    /// Capture the union of all monitors (the virtual screen).
    #[cfg(not(target_os = "windows"))]
    pub fn capture_virtual_screen() -> Result<RegionImage, String> {
        let monitors = xcap::Monitor::all()
            .map_err(|error| format!("failed to enumerate monitors: {error}"))?;
        let bounds = monitors
            .iter()
            .filter_map(|monitor| monitor_rect(monitor).ok())
            .reduce(union)
            .ok_or_else(|| "no display is available to capture".to_string())?;
        capture_region_rgba(
            bounds.left,
            bounds.top,
            bounds.width() as i32,
            bounds.height() as i32,
        )
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn intersect_returns_overlap() {
            let a = Rect {
                left: 0,
                top: 0,
                right: 100,
                bottom: 80,
            };
            let b = Rect {
                left: 60,
                top: 40,
                right: 200,
                bottom: 200,
            };

            assert_eq!(
                intersect(a, b),
                Some(Rect {
                    left: 60,
                    top: 40,
                    right: 100,
                    bottom: 80,
                })
            );
        }

        #[test]
        fn intersect_rejects_disjoint_rects() {
            let a = Rect {
                left: 0,
                top: 0,
                right: 100,
                bottom: 80,
            };
            let b = Rect {
                left: 100,
                top: 0,
                right: 200,
                bottom: 80,
            };

            assert_eq!(intersect(a, b), None);
        }

        #[test]
        fn union_spans_both_rects() {
            let a = Rect {
                left: -1920,
                top: 0,
                right: 0,
                bottom: 1080,
            };
            let b = Rect {
                left: 0,
                top: 0,
                right: 3840,
                bottom: 2160,
            };

            assert_eq!(
                union(a, b),
                Rect {
                    left: -1920,
                    top: 0,
                    right: 3840,
                    bottom: 2160,
                }
            );
        }
    }
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
const DRAFTS_DIR_NAME: &str = ".kkterm-drafts";
const THUMB_LONG_EDGE: u32 = 320;
const MAX_DRAFT_BYTES: usize = 10 * 1024 * 1024;

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
    let sort_by = request.sort_by.as_deref().unwrap_or("date");
    paths.sort_by(|a, b| {
        let ordering = match sort_by {
            "name" => file_name_sort_key(&a.1).cmp(&file_name_sort_key(&b.1)),
            "type" => file_type_sort_key(&a.1)
                .cmp(&file_type_sort_key(&b.1))
                .then_with(|| file_name_sort_key(&a.1).cmp(&file_name_sort_key(&b.1))),
            _ => a.0.cmp(&b.0),
        };
        if request.sort_direction.as_deref() == Some("asc") {
            ordering
        } else {
            ordering.reverse()
        }
    });

    let total = paths.len();
    let offset = request.offset.unwrap_or(0).min(total);
    let limit = request.limit.unwrap_or(60).clamp(1, 200);
    let has_more = offset + limit < total;
    let screenshots = paths
        .into_iter()
        .skip(offset)
        .take(limit)
        .filter_map(|(_, path)| stored_screenshot_from_path(&folder, path).ok())
        .collect::<Vec<_>>();

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

pub fn read_library_screenshot_draft(
    id: String,
    folder_path: String,
) -> Result<Option<String>, String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    screenshot_path_from_id(&folder, &id)?;
    let path = screenshot_draft_path(&folder, &id);
    match fs::read_to_string(path) {
        Ok(draft) => Ok(Some(draft)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("failed to load screenshot draft: {error}")),
    }
}

pub fn save_library_screenshot_draft(
    request: SaveScreenshotDraftRequest,
    folder_path: String,
) -> Result<(), String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    screenshot_path_from_id(&folder, &request.id)?;
    if request.draft_json.len() > MAX_DRAFT_BYTES {
        return Err("screenshot draft exceeds the 10 MB limit".to_string());
    }
    let value: serde_json::Value = serde_json::from_str(&request.draft_json)
        .map_err(|error| format!("screenshot draft is not valid JSON: {error}"))?;
    if !value.is_object() {
        return Err("screenshot draft must be a JSON object".to_string());
    }
    let drafts = folder.join(DRAFTS_DIR_NAME);
    fs::create_dir_all(&drafts)
        .map_err(|error| format!("failed to create screenshot draft folder: {error}"))?;
    let target = screenshot_draft_path(&folder, &request.id);
    let temporary = drafts.join(format!("{}.{}.tmp", request.id, now_millis()));
    fs::write(&temporary, request.draft_json)
        .map_err(|error| format!("failed to write screenshot draft: {error}"))?;
    if target.exists() {
        fs::remove_file(&target)
            .map_err(|error| format!("failed to replace screenshot draft: {error}"))?;
    }
    fs::rename(&temporary, &target)
        .map_err(|error| format!("failed to finish screenshot draft save: {error}"))
}

pub fn delete_library_screenshot_draft(id: String, folder_path: String) -> Result<(), String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    screenshot_path_from_id(&folder, &id)?;
    remove_draft_for(&folder, &id);
    Ok(())
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
    let old_draft = screenshot_draft_path(&folder, &id);
    if old_draft.is_file() {
        let new_id = target_name.replace('\\', "/");
        let new_draft = screenshot_draft_path(&folder, &new_id);
        let _ = fs::remove_file(&new_draft);
        if let Err(error) = fs::rename(old_draft, new_draft) {
            let _ = fs::rename(&target, &path);
            return Err(format!("failed to rename screenshot draft: {error}"));
        }
    }
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
    id: String,
    folder_path: String,
) -> Result<(), String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    let path = screenshot_path_from_id(&folder, &id)?;
    let image = image::open(path)
        .map_err(|error| format!("failed to read screenshot: {error}"))?
        .to_rgba8();
    write_rgba_to_clipboard(image.as_raw(), image.width(), image.height())
}

pub fn delete_library_screenshot(id: String, folder_path: String) -> Result<(), String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    let path = screenshot_path_from_id(&folder, &id)?;
    fs::remove_file(&path).map_err(|error| format!("failed to delete screenshot: {error}"))?;
    remove_thumbnail_for(&folder, &id);
    remove_draft_for(&folder, &id);
    Ok(())
}

pub fn delete_library_screenshots(ids: Vec<String>, folder_path: String) -> Result<(), String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    let paths = ids
        .iter()
        .map(|id| screenshot_path_from_id(&folder, id).map(|path| (id, path)))
        .collect::<Result<Vec<_>, _>>()?;
    for (id, path) in paths {
        fs::remove_file(&path).map_err(|error| format!("failed to delete screenshot: {error}"))?;
        remove_thumbnail_for(&folder, id);
        remove_draft_for(&folder, id);
    }
    Ok(())
}

pub fn resize_library_screenshots(
    request: ResizeScreenshotsRequest,
    folder_path: String,
) -> Result<Vec<StoredScreenshot>, String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    let paths = request
        .ids
        .iter()
        .map(|id| screenshot_path_from_id(&folder, id))
        .collect::<Result<Vec<_>, _>>()?;
    let mut created = Vec::with_capacity(paths.len());
    for path in paths {
        let image = image::open(&path)
            .map_err(|error| format!("failed to read screenshot for resize: {error}"))?;
        let (width, height) = resolve_resize_dimensions(&request, image.width(), image.height())?;
        let resized = image.resize_exact(width, height, image::imageops::FilterType::Lanczos3);
        let format = image_format_for_path(&path)
            .ok_or_else(|| "screenshot format is not supported for resize".to_string())?;
        let target = unique_library_output_path(&folder, &path, "resized", format);
        write_dynamic_image(&resized, &target, format, 90)?;
        created.push(stored_screenshot_from_path(&folder, target)?);
    }
    Ok(created)
}

pub fn convert_library_screenshots(
    request: ConvertScreenshotsRequest,
    folder_path: String,
) -> Result<Vec<StoredScreenshot>, String> {
    let format = match request.format.as_str() {
        "png" => "png",
        "jpeg" => "jpeg",
        "webp" => "webp",
        "gif" => "gif",
        _ => return Err("screenshot output format must be PNG, JPEG, WebP, or GIF".to_string()),
    };
    if !(1..=100).contains(&request.quality) {
        return Err("screenshot output quality must be between 1 and 100".to_string());
    }
    let folder = ensure_screenshots_folder(&folder_path)?;
    let paths = request
        .ids
        .iter()
        .map(|id| screenshot_path_from_id(&folder, id))
        .collect::<Result<Vec<_>, _>>()?;
    let mut created = Vec::with_capacity(paths.len());
    for path in paths {
        let image = image::open(&path)
            .map_err(|error| format!("failed to read screenshot for conversion: {error}"))?;
        let target = unique_library_output_path(&folder, &path, "converted", format);
        write_dynamic_image(&image, &target, format, request.quality)?;
        created.push(stored_screenshot_from_path(&folder, target)?);
    }
    Ok(created)
}

pub fn save_edited_library_screenshot(
    request: SaveEditedScreenshotRequest,
    folder_path: String,
) -> Result<StoredScreenshot, String> {
    let folder = ensure_screenshots_folder(&folder_path)?;
    let source = screenshot_path_from_id(&folder, &request.id)?;
    let (_, encoded) = request
        .data_url
        .split_once(',')
        .filter(|(header, _)| header.starts_with("data:image/") && header.ends_with(";base64"))
        .ok_or_else(|| "edited screenshot is not a base64 image data URL".to_string())?;
    if encoded.len() > 140_000_000 {
        return Err("edited screenshot exceeds the 100 MB input limit".to_string());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("failed to decode edited screenshot: {error}"))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| format!("failed to read edited screenshot: {error}"))?;
    let format = image_format_for_path(&source)
        .ok_or_else(|| "screenshot format is not supported for save".to_string())?;
    let target = if request.save_as_copy {
        unique_library_output_path(&folder, &source, "edited", format)
    } else {
        source
    };
    write_dynamic_image(&image, &target, format, 90)?;
    if !request.save_as_copy {
        remove_thumbnail_for(&folder, &request.id);
        remove_draft_for(&folder, &request.id);
    }
    stored_screenshot_from_path(&folder, target)
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
    let _ = fs::remove_dir_all(folder.join(DRAFTS_DIR_NAME));
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
            platform::dib_to_jpeg_bytes_with_quality(dib, width, height, options.quality)?,
            "jpg",
        )
    } else {
        (
            platform::dib_to_png_bytes_with_quality(dib, width, height, options.quality)?,
            "png",
        )
    };
    let captured_at = now_millis();
    let normalized_kind = normalize_kind(&kind);
    let file_name = format!("KKTerm-{normalized_kind}-{captured_at}.{extension}");
    let path = folder.join(file_name);
    fs::write(&path, bytes).map_err(|error| format!("failed to save screenshot: {error}"))?;
    stored_screenshot_from_path(&folder, path)
}

#[cfg(target_os = "windows")]
fn deliver_dib(
    app: &tauri::AppHandle,
    dib: &[u8],
    width: u32,
    height: u32,
    kind: String,
    options: &LibrarySaveOptions,
) -> Result<ScreenshotCaptureResult, String> {
    let bordered;
    let dib = if options.border_enabled {
        let mut copy = dib.to_vec();
        platform::apply_border_to_dib(
            &mut copy,
            width,
            height,
            options.border_width,
            &options.border_style,
            parse_border_color(&options.border_color),
        );
        bordered = copy;
        &bordered[..]
    } else {
        dib
    };
    let copy_to_clipboard = options.capture_mode != "folder";
    let save_to_folder = options.capture_mode != "clipboard";

    if copy_to_clipboard {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window is not available".to_string())?;
        let hwnd = window
            .hwnd()
            .map_err(|error| format!("failed to resolve window handle: {error}"))?;
        platform::copy_dib_to_clipboard(hwnd.0, dib)?;
    }

    let stored_screenshot = if save_to_folder {
        Some(save_dib_to_library(dib, width, height, kind, options)?)
    } else {
        None
    };

    Ok(ScreenshotCaptureResult {
        open_in_editor: stored_screenshot.is_some() && options.open_in_editor_after_capture,
        stored_screenshot,
        copied_to_clipboard: copy_to_clipboard,
    })
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
    let created_at = metadata
        .created()
        .ok()
        .and_then(system_time_to_millis)
        .unwrap_or(captured_at);
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(system_time_to_millis)
        .unwrap_or(captured_at);
    let taken_at = taken_at_from_file_name(&file_name);
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
    let has_draft = screenshot_draft_path(screenshots_folder, &id).is_file();

    Ok(StoredScreenshot {
        id,
        path: path.to_string_lossy().to_string(),
        file_name,
        thumbnail_data_url,
        has_draft,
        width,
        height,
        file_size_bytes: metadata.len(),
        captured_at: taken_at.unwrap_or(captured_at),
        created_at,
        modified_at,
        taken_at,
        kind,
    })
}

fn file_name_sort_key(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn file_type_sort_key(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn taken_at_from_file_name(file_name: &str) -> Option<u128> {
    file_name.split(['-', '.']).find_map(|part| {
        (part.len() >= 10)
            .then(|| part.parse::<u128>().ok())
            .flatten()
    })
}

fn validate_batch_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 || width > 16_384 || height > 16_384 {
        return Err("screenshot dimensions must be between 1 and 16,384 pixels".to_string());
    }
    if u64::from(width) * u64::from(height) > 100_000_000 {
        return Err("resized screenshots must not exceed 100 megapixels".to_string());
    }
    Ok(())
}

fn resolve_resize_dimensions(
    request: &ResizeScreenshotsRequest,
    source_width: u32,
    source_height: u32,
) -> Result<(u32, u32), String> {
    if source_width == 0 || source_height == 0 {
        return Err("source screenshot dimensions are invalid".to_string());
    }
    let dimensions = match request.mode.as_str() {
        "exact" => match (request.width, request.height) {
            (Some(width), Some(height)) if request.preserve_aspect_ratio => {
                if u64::from(width) * u64::from(source_height)
                    <= u64::from(height) * u64::from(source_width)
                {
                    (width, scale_dimension(source_height, width, source_width))
                } else {
                    (scale_dimension(source_width, height, source_height), height)
                }
            }
            (Some(width), Some(height)) => (width, height),
            (Some(width), None) => (width, scale_dimension(source_height, width, source_width)),
            (None, Some(height)) => (scale_dimension(source_width, height, source_height), height),
            (None, None) => {
                return Err("enter a screenshot width, height, or both".to_string());
            }
        },
        "percentage" => {
            let percentage = request
                .percentage
                .filter(|percentage| (1..=500).contains(percentage))
                .ok_or_else(|| {
                    "screenshot resize percentage must be between 1 and 500".to_string()
                })?;
            (
                scale_dimension(source_width, u32::from(percentage), 100),
                scale_dimension(source_height, u32::from(percentage), 100),
            )
        }
        _ => return Err("screenshot resize mode must be exact or percentage".to_string()),
    };
    validate_batch_dimensions(dimensions.0, dimensions.1)?;
    Ok(dimensions)
}

fn scale_dimension(value: u32, numerator: u32, denominator: u32) -> u32 {
    let scaled = (u64::from(value) * u64::from(numerator) + u64::from(denominator) / 2)
        / u64::from(denominator);
    scaled.max(1).min(u64::from(u32::MAX)) as u32
}

fn unique_library_output_path(folder: &Path, source: &Path, suffix: &str, format: &str) -> PathBuf {
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Screenshot");
    let extension = output_extension(format);
    for index in 0..u32::MAX {
        let numbered = if index == 0 {
            format!("{stem}-{suffix}.{extension}")
        } else {
            format!("{stem}-{suffix}-{index}.{extension}")
        };
        let candidate = folder.join(numbered);
        if !candidate.exists() {
            return candidate;
        }
    }
    folder.join(format!("{stem}-{suffix}-{}.{}", now_millis(), extension))
}

fn write_dynamic_image(
    image: &image::DynamicImage,
    path: &Path,
    format: &str,
    quality: u8,
) -> Result<(), String> {
    use image::{ColorType, ImageEncoder};

    let mut bytes = Vec::new();
    match format {
        "jpeg" => {
            let rgb = image.to_rgb8();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality.clamp(1, 100))
                .write_image(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    ColorType::Rgb8.into(),
                )
                .map_err(|error| format!("failed to encode JPEG screenshot: {error}"))?;
        }
        "webp" => {
            let rgba = image.to_rgba8();
            let encoded = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height())
                .encode(f32::from(quality.clamp(1, 100)));
            bytes.extend_from_slice(&encoded);
        }
        "gif" => {
            let rgba = image.to_rgba8();
            let mut encoder = image::codecs::gif::GifEncoder::new_with_speed(
                &mut bytes,
                gif_speed_for_quality(quality),
            );
            encoder
                .encode(
                    rgba.as_raw(),
                    rgba.width(),
                    rgba.height(),
                    ColorType::Rgba8.into(),
                )
                .map_err(|error| format!("failed to encode GIF screenshot: {error}"))?;
        }
        _ => {
            let rgba = image.to_rgba8();
            image::codecs::png::PngEncoder::new(&mut bytes)
                .write_image(
                    rgba.as_raw(),
                    rgba.width(),
                    rgba.height(),
                    ColorType::Rgba8.into(),
                )
                .map_err(|error| format!("failed to encode PNG screenshot: {error}"))?;
        }
    }
    fs::write(path, bytes).map_err(|error| format!("failed to save screenshot: {error}"))
}

fn gif_speed_for_quality(quality: u8) -> i32 {
    30 - (i32::from(quality.clamp(1, 100)) - 1) * 29 / 99
}

fn output_extension(format: &str) -> &'static str {
    match format {
        "jpeg" => "jpg",
        "webp" => "webp",
        "gif" => "gif",
        _ => "png",
    }
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
    let source_modified = fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok());
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

    let bytes =
        fs::read(&thumb_path).map_err(|error| format!("failed to load thumbnail: {error}"))?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

fn remove_thumbnail_for(folder: &Path, id: &str) {
    let _ = fs::remove_file(folder.join(THUMBS_DIR_NAME).join(format!("{id}.thumb.jpg")));
}

fn screenshot_draft_path(folder: &Path, id: &str) -> PathBuf {
    folder.join(DRAFTS_DIR_NAME).join(format!("{id}.json"))
}

fn remove_draft_for(folder: &Path, id: &str) {
    let _ = fs::remove_file(screenshot_draft_path(folder, id));
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
                "gif" | "jpg" | "jpeg" | "png" | "webp"
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
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/jpeg",
    }
}

fn image_format_for_path(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("png"),
        Some("jpg" | "jpeg") => Some("jpeg"),
        Some("webp") => Some("webp"),
        Some("gif") => Some("gif"),
        _ => None,
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
            AC_SRC_OVER, AlphaBlend, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION,
            BeginPaint, BitBlt, CAPTUREBLT, CreateCompatibleBitmap, CreateCompatibleDC,
            CreateDIBSection, CreateSolidBrush, DIB_RGB_COLORS, DeleteDC, DeleteObject, EndPaint,
            FillRect, FrameRect, GdiFlush, GetDC, GetDIBits, HBITMAP, HBRUSH, HDC, HGDIOBJ,
            InvalidateRect, PAINTSTRUCT, ReleaseDC, SRCCOPY, SelectObject, SetDIBitsToDevice,
        },
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
            Ole::CF_DIB,
        },
        UI::{
            Controls::{
                BPBF_COMPATIBLEBITMAP, BeginBufferedPaint, BufferedPaintInit, BufferedPaintUnInit,
                EndBufferedPaint,
            },
            WindowsAndMessaging::{
                CREATESTRUCTW, CS_HREDRAW, CS_VREDRAW, CreateWindowExW, DefWindowProcW,
                DestroyWindow, DispatchMessageW, EnumWindows, GWLP_USERDATA, GetMessageW,
                GetSystemMetrics, GetWindowLongPtrW, GetWindowRect, IDC_CROSS, IsWindowVisible,
                LoadCursorW, MSG, PostQuitMessage, RegisterClassW, SM_CXVIRTUALSCREEN,
                SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SW_SHOW,
                SetWindowLongPtrW, ShowWindow, TranslateMessage, WM_CREATE, WM_DESTROY, WM_KEYDOWN,
                WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_NCCREATE, WM_PAINT, WNDCLASSW,
                WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
            },
        },
    };

    const SCREENSHOT_DIM_ALPHA: u8 = 112;

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
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
        copy_dib_to_clipboard(owner_hwnd, &dib)
    }

    pub fn copy_dib_to_clipboard(owner_hwnd: HWND, dib: &[u8]) -> Result<(), String> {
        unsafe { write_dib_to_clipboard(owner_hwnd, dib) }
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
            match capture_screen_rect_to_dib_xcap(x, y, width, height) {
                Ok(dib) => return Ok(dib),
                Err(error) => {
                    eprintln!("xcap screen capture fell back to GDI: {error}");
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

    fn capture_screen_rect_to_dib_xcap(
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<Vec<u8>, String> {
        let region = super::capture_engine::capture_region_rgba(x, y, width, height)?;
        if region.width != width as u32 || region.height != height as u32 {
            return Err(format!(
                "xcap returned a {}x{} image for a {}x{} request",
                region.width, region.height, width, height
            ));
        }
        let mut bgra = region.rgba;
        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
        bgra_pixels_to_dib(&bgra, width, height)
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

    /// Draws the configured inset border into a captured DIB's BGRA pixels.
    pub fn apply_border_to_dib(
        dib: &mut [u8],
        width: u32,
        height: u32,
        thickness: u32,
        style: &str,
        rgb: (u8, u8, u8),
    ) {
        let header_size = mem::size_of::<BITMAPINFOHEADER>();
        if dib.len() < header_size {
            return;
        }
        super::apply_border_pixels(
            &mut dib[header_size..],
            width,
            height,
            thickness,
            style,
            [rgb.2, rgb.1, rgb.0, 0xFF],
        );
    }

    /// Draws the current mouse cursor into a captured screen DIB at its
    /// on-screen position. Best effort: any failure leaves the capture as-is.
    pub fn draw_cursor_on_dib(dib: &mut [u8], origin_x: i32, origin_y: i32) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CURSOR_SHOWING, CURSORINFO, DI_NORMAL, DrawIconEx, GetCursorInfo, GetIconInfo, ICONINFO,
        };

        let header_size = mem::size_of::<BITMAPINFOHEADER>();
        if dib.len() < header_size {
            return;
        }
        unsafe {
            let (width, height) = {
                let header = dib.as_ptr() as *const BITMAPINFOHEADER;
                ((*header).biWidth, -(*header).biHeight)
            };
            if width <= 0 || height <= 0 {
                return;
            }
            let image_size = width as usize * height as usize * 4;
            if dib.len() < header_size + image_size {
                return;
            }

            let mut cursor: CURSORINFO = mem::zeroed();
            cursor.cbSize = mem::size_of::<CURSORINFO>() as u32;
            if GetCursorInfo(&mut cursor) == 0 || (cursor.flags & CURSOR_SHOWING) == 0 {
                return;
            }
            let mut icon: ICONINFO = mem::zeroed();
            if GetIconInfo(cursor.hCursor, &mut icon) == 0 {
                return;
            }
            let hotspot_x = icon.xHotspot as i32;
            let hotspot_y = icon.yHotspot as i32;
            if !icon.hbmMask.is_null() {
                let _ = DeleteObject(icon.hbmMask as HGDIOBJ);
            }
            if !icon.hbmColor.is_null() {
                let _ = DeleteObject(icon.hbmColor as HGDIOBJ);
            }

            let Ok(screen_dc) = ScreenDc::new() else {
                return;
            };
            let Ok(memory_dc) = MemoryDc::new(screen_dc.0) else {
                return;
            };
            let mut info: BITMAPINFO = mem::zeroed();
            info.bmiHeader.biSize = mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = width;
            info.bmiHeader.biHeight = -height;
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB;
            let mut bits: *mut c_void = ptr::null_mut();
            let section = CreateDIBSection(
                memory_dc.0,
                &info,
                DIB_RGB_COLORS,
                &mut bits,
                ptr::null_mut(),
                0,
            );
            if section.is_null() || bits.is_null() {
                if !section.is_null() {
                    let _ = DeleteObject(section as HGDIOBJ);
                }
                return;
            }
            let section = Bitmap(section);
            let previous = SelectObject(memory_dc.0, section.0 as HGDIOBJ);
            if previous.is_null() {
                return;
            }
            let pixels = std::slice::from_raw_parts_mut(bits as *mut u8, image_size);
            pixels.copy_from_slice(&dib[header_size..header_size + image_size]);
            let drawn = DrawIconEx(
                memory_dc.0,
                cursor.ptScreenPos.x - hotspot_x - origin_x,
                cursor.ptScreenPos.y - hotspot_y - origin_y,
                cursor.hCursor,
                0,
                0,
                0,
                ptr::null_mut(),
                DI_NORMAL,
            );
            let _ = GdiFlush();
            if drawn != 0 {
                dib[header_size..header_size + image_size].copy_from_slice(pixels);
            }
            let _ = SelectObject(memory_dc.0, previous);
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

    pub fn dib_to_png_bytes_with_quality(
        dib: &[u8],
        width: u32,
        height: u32,
        quality: u8,
    ) -> Result<Vec<u8>, String> {
        use image::codecs::png::{CompressionType, FilterType, PngEncoder};

        let rgb = dib_to_rgb(dib, width, height)?;
        let mut png = Vec::new();
        let compression_level = 1 + ((quality.clamp(1, 100) as u16 - 1) * 8 / 99) as u8;
        PngEncoder::new_with_quality(
            &mut png,
            CompressionType::Level(compression_level),
            FilterType::Adaptive,
        )
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

            let buffered_paint_initialized = BufferedPaintInit() >= 0;
            ShowWindow(hwnd, SW_SHOW);
            let _ = InvalidateRect(hwnd, ptr::null(), 1);

            let mut message: MSG = mem::zeroed();
            while GetMessageW(&mut message, ptr::null_mut(), 0, 0) > 0 {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            if buffered_paint_initialized {
                let _ = BufferedPaintUnInit();
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
                    let mut should_repaint = false;
                    match &overlay.mode {
                        SelectionMode::Window { windows } => {
                            let next_hover = windows
                                .iter()
                                .find(|rect| rect_contains(rect, point.0, point.1))
                                .map(copy_rect);
                            if overlay.hover != next_hover {
                                overlay.hover = next_hover;
                                should_repaint = true;
                            }
                        }
                        SelectionMode::Region => {
                            if overlay.drag_start.is_some() {
                                let next_point = Some(point);
                                if overlay.drag_current != next_point {
                                    overlay.drag_current = next_point;
                                    should_repaint = true;
                                }
                            }
                        }
                    }
                    if should_repaint {
                        let _ = InvalidateRect(hwnd, ptr::null(), 0);
                    }
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
                            let _ = InvalidateRect(hwnd, ptr::null(), 0);
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

            let paint_bounds = RECT {
                left: 0,
                top: 0,
                right: overlay.screen.width,
                bottom: overlay.screen.height,
            };
            let mut buffered_dc = ptr::null_mut();
            let paint_buffer = BeginBufferedPaint(
                hdc,
                &paint_bounds,
                BPBF_COMPATIBLEBITMAP,
                ptr::null(),
                &mut buffered_dc,
            );
            let render_dc = if paint_buffer != 0 && !buffered_dc.is_null() {
                buffered_dc
            } else {
                hdc
            };

            let header_size = mem::size_of::<BITMAPINFOHEADER>();
            if overlay.dib.len() >= header_size {
                let info = overlay.dib.as_ptr() as *const BITMAPINFO;
                let bits = overlay.dib.as_ptr().add(header_size) as *const c_void;
                let _ = SetDIBitsToDevice(
                    render_dc,
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
            dim_outside_rect(render_dc, &overlay.screen, selected.as_ref());
            if let Some(rect) = selected {
                frame_rect(
                    render_dc,
                    &screen_to_overlay_rect(&rect, &overlay.screen),
                    0x00ff_ffff,
                );
                let inner = inset_rect(&screen_to_overlay_rect(&rect, &overlay.screen), 1);
                frame_rect(render_dc, &inner, 0x0000_78ff);
            }

            if paint_buffer != 0 {
                let _ = EndBufferedPaint(paint_buffer, 1);
            }

            EndPaint(hwnd, &paint);
        }
    }

    unsafe fn dim_outside_rect(hdc: HDC, screen: &ScreenRect, selected: Option<&ScreenRect>) {
        unsafe {
            let Some(selected) = selected else {
                return;
            };

            let Ok(dim_dc) = MemoryDc::new(hdc) else {
                return;
            };
            let Ok(dim_bitmap) = Bitmap::new(hdc, 1, 1) else {
                return;
            };
            let previous = SelectObject(dim_dc.0, dim_bitmap.0 as HGDIOBJ);
            if previous.is_null() {
                return;
            }
            let pixel = RECT {
                left: 0,
                top: 0,
                right: 1,
                bottom: 1,
            };
            let black = Brush::new(0x0000_0000);
            let _ = FillRect(dim_dc.0, &pixel, black.0);
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: SCREENSHOT_DIM_ALPHA,
                AlphaFormat: 0,
            };
            let selected = screen_to_overlay_rect(selected, screen);
            for rect in outside_rects(screen.width, screen.height, &selected) {
                let width = rect.right - rect.left;
                let height = rect.bottom - rect.top;
                if width > 0 && height > 0 {
                    let _ = AlphaBlend(
                        hdc, rect.left, rect.top, width, height, dim_dc.0, 0, 0, 1, 1, blend,
                    );
                }
            }
            let _ = SelectObject(dim_dc.0, previous);
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

    #[test]
    fn library_copy_names_preserve_original_capture_time() {
        assert_eq!(
            taken_at_from_file_name("KKTerm-region-1723456789012-edited.png"),
            Some(1_723_456_789_012)
        );
        assert_eq!(taken_at_from_file_name("external-image.png"), None);
    }

    #[test]
    fn batch_resize_dimensions_are_bounded() {
        assert!(validate_batch_dimensions(1920, 1080).is_ok());
        assert!(validate_batch_dimensions(0, 1080).is_err());
        assert!(validate_batch_dimensions(16_385, 1080).is_err());
        assert!(validate_batch_dimensions(16_384, 16_384).is_err());
    }

    #[test]
    fn batch_resize_resolves_single_dimensions_and_percentages_per_image() {
        let width_only = ResizeScreenshotsRequest {
            ids: Vec::new(),
            mode: "exact".to_string(),
            width: Some(1024),
            height: None,
            percentage: None,
            preserve_aspect_ratio: false,
        };
        assert_eq!(
            resolve_resize_dimensions(&width_only, 1920, 1080),
            Ok((1024, 576))
        );

        let height_only = ResizeScreenshotsRequest {
            width: None,
            height: Some(720),
            ..width_only
        };
        assert_eq!(
            resolve_resize_dimensions(&height_only, 1920, 1080),
            Ok((1280, 720))
        );

        let percentage = ResizeScreenshotsRequest {
            mode: "percentage".to_string(),
            width: None,
            height: None,
            percentage: Some(50),
            ..height_only
        };
        assert_eq!(
            resolve_resize_dimensions(&percentage, 1920, 1080),
            Ok((960, 540))
        );
        assert_eq!(
            resolve_resize_dimensions(&percentage, 800, 1200),
            Ok((400, 600))
        );
    }

    #[test]
    fn batch_conversion_encodes_all_supported_formats() {
        let folder = tempfile::tempdir().expect("temp folder");
        let image = image::DynamicImage::new_rgba8(2, 2);
        for format in ["png", "jpeg", "webp", "gif"] {
            let path = folder
                .path()
                .join(format!("output.{}", output_extension(format)));
            write_dynamic_image(&image, &path, format, 80).expect("encode image");
            assert_eq!(
                image::image_dimensions(path).expect("read dimensions"),
                (2, 2)
            );
        }
        assert_eq!(gif_speed_for_quality(1), 30);
        assert_eq!(gif_speed_for_quality(100), 1);
    }

    #[test]
    fn screenshot_drafts_follow_library_items() {
        let folder = tempfile::tempdir().expect("temp folder");
        let folder_path = folder.path().to_string_lossy().to_string();
        image::DynamicImage::new_rgba8(2, 2)
            .save(folder.path().join("capture.png"))
            .expect("save source image");

        save_library_screenshot_draft(
            SaveScreenshotDraftRequest {
                id: "capture.png".to_string(),
                draft_json: r#"{"version":1,"annotations":[]}"#.to_string(),
            },
            folder_path.clone(),
        )
        .expect("save draft");
        assert_eq!(
            read_library_screenshot_draft("capture.png".to_string(), folder_path.clone())
                .expect("read draft")
                .as_deref(),
            Some(r#"{"version":1,"annotations":[]}"#)
        );

        let listed = list_library_screenshots(
            ListScreenshotsRequest {
                offset: None,
                limit: None,
                sort_by: None,
                sort_direction: None,
            },
            folder_path.clone(),
        )
        .expect("list screenshots");
        assert!(listed.screenshots[0].has_draft);

        let renamed = rename_library_screenshot(
            "capture.png".to_string(),
            "renamed".to_string(),
            folder_path.clone(),
        )
        .expect("rename screenshot");
        assert!(renamed.has_draft);
        assert_eq!(
            read_library_screenshot_draft(renamed.id.clone(), folder_path.clone())
                .expect("read renamed draft")
                .as_deref(),
            Some(r#"{"version":1,"annotations":[]}"#)
        );

        delete_library_screenshot(renamed.id.clone(), folder_path).expect("delete screenshot");
        assert!(!screenshot_draft_path(folder.path(), &renamed.id).exists());
    }

    #[test]
    fn apply_border_pixels_draws_inset_solid_border() {
        let (width, height) = (5u32, 4u32);
        let mut pixels = vec![9u8; (width * height * 4) as usize];
        apply_border_pixels(&mut pixels, width, height, 1, "solid", [1, 2, 3, 255]);

        let pixel = |x: u32, y: u32| {
            let index = ((y * width + x) * 4) as usize;
            &pixels[index..index + 4]
        };
        assert_eq!(pixel(0, 0), &[1, 2, 3, 255]);
        assert_eq!(pixel(4, 0), &[1, 2, 3, 255]);
        assert_eq!(pixel(0, 3), &[1, 2, 3, 255]);
        assert_eq!(pixel(4, 3), &[1, 2, 3, 255]);
        assert_eq!(pixel(2, 0), &[1, 2, 3, 255]);
        assert_eq!(pixel(0, 2), &[1, 2, 3, 255]);
        // The interior stays untouched and the image size does not change.
        assert_eq!(pixel(2, 2), &[9, 9, 9, 9]);
        assert_eq!(pixels.len(), (width * height * 4) as usize);
    }

    #[test]
    fn apply_border_pixels_clamps_thickness_and_skips_gaps_when_dotted() {
        // A thickness beyond half the image must not panic or over-run.
        let mut tiny = vec![0u8; 3 * 3 * 4];
        apply_border_pixels(&mut tiny, 3, 3, 64, "solid", [255, 255, 255, 255]);
        assert!(
            tiny.chunks_exact(4)
                .all(|pixel| pixel == [255, 255, 255, 255])
        );

        // A dotted border leaves gaps along the top edge.
        let mut dotted = vec![0u8; 16 * 4 * 4];
        apply_border_pixels(&mut dotted, 16, 4, 1, "dotted", [255, 255, 255, 255]);
        let top: Vec<u8> = (0..16u32).map(|x| dotted[(x * 4) as usize]).collect();
        assert!(top.contains(&255));
        assert!(top.contains(&0));
    }

    #[test]
    fn parse_border_color_reads_hex_and_falls_back_to_black() {
        assert_eq!(parse_border_color("#ff8001"), (255, 128, 1));
        assert_eq!(parse_border_color("00ff00"), (0, 255, 0));
        assert_eq!(parse_border_color("not-a-color"), (0, 0, 0));
    }

    #[test]
    fn edited_screenshot_save_overwrites_or_creates_a_copy_as_requested() {
        use image::{ColorType, ImageEncoder};

        fn png_data_url(width: u32, height: u32) -> String {
            let image = image::RgbaImage::new(width, height);
            let mut bytes = Vec::new();
            image::codecs::png::PngEncoder::new(&mut bytes)
                .write_image(image.as_raw(), width, height, ColorType::Rgba8.into())
                .expect("encode PNG data URL");
            format!("data:image/png;base64,{}", STANDARD.encode(bytes))
        }

        let folder = tempfile::tempdir().expect("temp folder");
        let source = folder.path().join("source.png");
        write_dynamic_image(&image::DynamicImage::new_rgba8(2, 2), &source, "png", 90)
            .expect("write source");

        let copy = save_edited_library_screenshot(
            SaveEditedScreenshotRequest {
                id: "source.png".to_string(),
                data_url: png_data_url(4, 3),
                save_as_copy: true,
            },
            folder.path().to_string_lossy().into_owned(),
        )
        .expect("save edited copy");
        assert_ne!(copy.id, "source.png");
        assert_eq!(
            image::image_dimensions(&source).expect("source dimensions"),
            (2, 2)
        );
        assert_eq!(
            image::image_dimensions(folder.path().join(&copy.id)).expect("copy dimensions"),
            (4, 3),
        );

        let saved = save_edited_library_screenshot(
            SaveEditedScreenshotRequest {
                id: "source.png".to_string(),
                data_url: png_data_url(5, 2),
                save_as_copy: false,
            },
            folder.path().to_string_lossy().into_owned(),
        )
        .expect("overwrite source");
        assert_eq!(saved.id, "source.png");
        assert_eq!(
            image::image_dimensions(source).expect("saved dimensions"),
            (5, 2)
        );
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

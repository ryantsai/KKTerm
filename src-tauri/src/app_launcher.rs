use crate::storage;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::SystemTime;
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
use tauri_plugin_opener::OpenerExt;

const FALLBACK_ICON_DATA_URL: &str = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20x='5'%20y='5'%20width='22'%20height='22'%20rx='5'%20fill='%23eef3fb'%20stroke='%2395a3b8'/%3E%3Cpath%20d='M11%2012h10M11%2016h10M11%2020h6'%20stroke='%23516275'%20stroke-width='2'%20stroke-linecap='round'/%3E%3C/svg%3E";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherLaunchMode {
    Normal,
    Admin,
    DifferentUser,
    OpenFolder,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AppLauncherLaunchPlan {
    pub target: String,
    pub parameters: Option<String>,
    pub working_directory: Option<String>,
    pub operation: Option<&'static str>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareAppLauncherEntryRequest {
    path: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchAppLauncherEntryRequest {
    path: String,
    arguments: Option<String>,
    working_directory: Option<String>,
    mode: AppLauncherLaunchMode,
}

pub fn prepare_entry(
    _app: &tauri::AppHandle,
    request: PrepareAppLauncherEntryRequest,
) -> PreparedAppLauncherEntry {
    let path = request.path.trim().to_string();
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    let access = crate::app_store_files::restore(_app, &path).ok();
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    let path = access.as_ref()
        .map(|access| access.path.to_string_lossy().into_owned())
        .unwrap_or(path);
    let metadata = std::fs::metadata(&path).ok();
    let exists = metadata.is_some();
    let file_kind = match metadata.as_ref() {
        Some(metadata) if metadata.is_dir() => AppLauncherFileKind::Folder,
        Some(_) => AppLauncherFileKind::File,
        None => AppLauncherFileKind::Missing,
    };
    PreparedAppLauncherEntry {
        name: storage::app_launcher_name_from_path(&path),
        exists,
        runnable: is_runnable_path(&path),
        icon_data_url: icon_data_url_for_path(&path),
        extension: path_extension(&path),
        size_bytes: metadata
            .as_ref()
            .filter(|metadata| metadata.is_file())
            .map(|metadata| metadata.len()),
        modified_at_unix_ms: metadata
            .and_then(|metadata| metadata.modified().ok())
            .and_then(system_time_to_unix_ms),
        file_kind,
        path,
    }
}

pub fn launch_entry(
    app: tauri::AppHandle,
    request: LaunchAppLauncherEntryRequest,
) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    let _access = crate::app_store_files::restore(&app, &request.path)?;
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    let _working_access = request.working_directory.as_deref()
        .filter(|path| !path.trim().is_empty())
        .map(|path| crate::app_store_files::restore(&app, path)).transpose()?;
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    let request = LaunchAppLauncherEntryRequest {
        path: _access.path.to_string_lossy().into_owned(),
        working_directory: _working_access.as_ref().map(|access| access.path.to_string_lossy().into_owned()),
        ..request
    };
    let plan = plan_launch_with_options(
        &request.path,
        request.arguments.as_deref(),
        request.working_directory.as_deref(),
        request.mode,
    )?;
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    if plan.operation.is_none() && plan.parameters.is_none() && plan.working_directory.is_none() {
        // Pass the scoped NSURL directly to Launch Services. A spawned `open`
        // helper does not preserve the original system-provided URL object.
        return _access.open(request.mode == AppLauncherLaunchMode::OpenFolder);
    }
    launch_plan(app, plan)
}

#[cfg(test)]
pub fn plan_launch(
    path: &str,
    mode: AppLauncherLaunchMode,
) -> Result<AppLauncherLaunchPlan, String> {
    plan_launch_with_options(path, None, None, mode)
}

fn plan_launch_with_options(
    path: &str,
    arguments: Option<&str>,
    working_directory: Option<&str>,
    mode: AppLauncherLaunchMode,
) -> Result<AppLauncherLaunchPlan, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("App Launcher path is required".to_string());
    }

    if mode == AppLauncherLaunchMode::OpenFolder {
        let target_folder = containing_folder_for_launcher_path(path)?;
        return Ok(AppLauncherLaunchPlan {
            target: target_folder,
            parameters: None,
            working_directory: None,
            operation: None,
        });
    }

    let runnable = is_runnable_path(path);
    if mode != AppLauncherLaunchMode::Normal && !runnable {
        return Err(
            "Admin and alternate-user launch are only available for runnable files".to_string(),
        );
    }

    let operation = match mode {
        AppLauncherLaunchMode::Normal => None,
        AppLauncherLaunchMode::Admin => Some("runas"),
        AppLauncherLaunchMode::DifferentUser => Some("runasuser"),
        AppLauncherLaunchMode::OpenFolder => None,
    };
    let arguments = arguments.map(str::trim).filter(|value| !value.is_empty());
    let working_directory = working_directory
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    // Windows routes PowerShell scripts and shell-associated documents through
    // native shims (powershell.exe / explorer.exe). macOS and Linux have no such
    // executables: they open the path through the OS default handler in
    // `launch_plan`, so they must not inject those Windows-only targets — doing so
    // made the macOS launcher try to spawn explorer.exe (issue #466).
    #[cfg(target_os = "windows")]
    {
        if is_powershell_script(path) {
            let parameters = Some(match arguments {
                Some(arguments) => {
                    format!("-File \"{}\" {arguments}", path.replace('"', "\\\""))
                }
                None => format!("-File \"{}\"", path.replace('"', "\\\"")),
            });
            return Ok(AppLauncherLaunchPlan {
                target: "powershell.exe".to_string(),
                parameters,
                working_directory,
                operation,
            });
        }

        if mode == AppLauncherLaunchMode::Normal && !runnable {
            return Ok(AppLauncherLaunchPlan {
                target: "explorer.exe".to_string(),
                parameters: Some(path.to_string()),
                working_directory,
                operation,
            });
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if mode == AppLauncherLaunchMode::Normal && !runnable {
            return Ok(AppLauncherLaunchPlan {
                target: path.to_string(),
                parameters: None,
                working_directory: None,
                operation,
            });
        }
    }

    Ok(AppLauncherLaunchPlan {
        target: path.to_string(),
        parameters: arguments.map(ToOwned::to_owned),
        working_directory,
        operation,
    })
}

fn launch_plan(app: tauri::AppHandle, plan: AppLauncherLaunchPlan) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        launch_plan_windows(plan)
    }

    #[cfg(target_os = "linux")]
    {
        let _ = app;
        launch_plan_linux(plan)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        if plan.operation.is_some() {
            return Err(
                "Admin and alternate-user launch are only available on Windows".to_string(),
            );
        }
        if plan.parameters.is_none() && plan.working_directory.is_none() {
            return app
                .opener()
                .open_path(plan.target, None::<&str>)
                .map_err(|error| format!("failed to open launcher entry: {error}"));
        }
        let mut command = std::process::Command::new(&plan.target);
        if let Some(parameters) = plan.parameters {
            command.arg(parameters);
        }
        if let Some(working_directory) = plan.working_directory {
            command.current_dir(working_directory);
        }
        command
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("failed to launch {}: {error}", plan.target))
    }
}

// Launch everything through host processes with the AppImage environment
// scrubbed. The opener plugin spawns xdg-open with KKTerm's own environment;
// inside an AppImage the rewritten XDG_DATA_DIRS/GIO variables break MIME and
// .desktop-database resolution, so xdg-open's generic fallback opened every
// entry — files, folders, even executables — in the default browser. Runnable
// files execute directly, .desktop entries launch the app they describe via
// `gio launch` (GLib ships with every GTK desktop KKTerm runs on), and
// everything else opens through the desktop's default handler via xdg-open.
#[cfg(target_os = "linux")]
fn launch_plan_linux(plan: AppLauncherLaunchPlan) -> Result<(), String> {
    if plan.operation.is_some() {
        return Err("Admin and alternate-user launch are only available on Windows".to_string());
    }

    if is_runnable_path(&plan.target) {
        let mut command = match plan.parameters.as_deref() {
            // `sh -c` makes $0 the target and applies shell quoting to the
            // arguments string, matching how a terminal would parse it.
            Some(parameters) => {
                let mut command = std::process::Command::new("/bin/sh");
                command
                    .arg("-c")
                    .arg(format!("exec \"$0\" {parameters}"))
                    .arg(&plan.target);
                command
            }
            None => std::process::Command::new(&plan.target),
        };
        if let Some(working_directory) = plan.working_directory.as_deref() {
            command.current_dir(working_directory);
        }
        return crate::linux_env::spawn_detached_host_process(command)
            .map_err(|error| format!("failed to launch {}: {error}", plan.target));
    }

    if path_extension(&plan.target).as_deref() == Some("desktop") {
        // A .desktop file is an application definition: launch the app it
        // describes instead of opening the file itself in a text editor.
        let mut command = std::process::Command::new("gio");
        command.arg("launch").arg(&plan.target);
        return crate::linux_env::spawn_detached_host_process(command)
            .map_err(|error| format!("failed to launch desktop entry {}: {error}", plan.target));
    }

    let mut command = std::process::Command::new("xdg-open");
    command.arg(&plan.target);
    match crate::linux_env::spawn_detached_host_process(command) {
        Ok(()) => Ok(()),
        // xdg-utils missing (minimal installs): fall back to GLib's opener.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut command = std::process::Command::new("gio");
            command.arg("open").arg(&plan.target);
            crate::linux_env::spawn_detached_host_process(command)
                .map_err(|error| format!("failed to open {}: {error}", plan.target))
        }
        Err(error) => Err(format!("failed to open {}: {error}", plan.target)),
    }
}

#[cfg(target_os = "windows")]
fn launch_plan_windows(plan: AppLauncherLaunchPlan) -> Result<(), String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    if plan.operation.is_none() && plan.target.eq_ignore_ascii_case("explorer.exe") {
        let mut command = std::process::Command::new(&plan.target);
        if let Some(parameters) = plan.parameters.as_deref() {
            command.arg(parameters);
        }
        if let Some(working_directory) = plan.working_directory.as_deref() {
            command.current_dir(working_directory);
        }
        return command
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("failed to launch {}: {error}", plan.target));
    }

    let operation = plan.operation.map(wide_string);
    let target = wide_string(&plan.target);
    let parameters = plan.parameters.as_ref().map(|value| wide_string(value));
    let working_directory = plan
        .working_directory
        .as_ref()
        .map(|value| wide_string(value));
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            operation
                .as_ref()
                .map(|value| value.as_ptr())
                .unwrap_or(null()),
            target.as_ptr(),
            parameters
                .as_ref()
                .map(|value| value.as_ptr())
                .unwrap_or(null()),
            working_directory
                .as_ref()
                .map(|value| value.as_ptr())
                .unwrap_or(null()),
            SW_SHOWNORMAL,
        )
    } as isize;

    if result <= 32 {
        return Err(format!("failed to launch {}", plan.target));
    }

    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedAppLauncherEntry {
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub runnable: bool,
    pub icon_data_url: Option<String>,
    pub file_kind: AppLauncherFileKind,
    pub extension: Option<String>,
    pub size_bytes: Option<u64>,
    pub modified_at_unix_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherFileKind {
    File,
    Folder,
    Missing,
}

fn icon_data_url_for_path(path: &str) -> Option<String> {
    native_icon_data_url(path).or_else(|| Some(FALLBACK_ICON_DATA_URL.to_string()))
}

#[cfg(target_os = "windows")]
fn native_icon_data_url(path: &str) -> Option<String> {
    high_quality_shell_icon(path)
        .or_else(|| legacy_shell_icon(path))
        .and_then(|(icon, size)| icon_handle_to_data_url(icon, size))
}

#[cfg(target_os = "windows")]
type WindowsIconHandle = windows_sys::Win32::UI::WindowsAndMessaging::HICON;

#[cfg(target_os = "windows")]
fn high_quality_shell_icon(path: &str) -> Option<(WindowsIconHandle, i32)> {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::UI::Controls::{
        ILD_TRANSPARENT, ImageList_GetIcon, ImageList_GetIconSize,
    };
    use windows_sys::Win32::UI::Shell::{
        IUnknown_AtomicRelease, SHFILEINFOW, SHGFI_SYSICONINDEX, SHGetFileInfoW, SHGetImageList,
        SHIL_EXTRALARGE, SHIL_JUMBO,
    };

    const IID_IIMAGELIST: windows_sys::core::GUID =
        windows_sys::core::GUID::from_u128(0x46eb5926_582e_4017_9fdf_e8998daa0950);

    let wide_path = wide_string(path);
    let mut shell_info: SHFILEINFOW = unsafe { zeroed() };
    let info_result = unsafe {
        SHGetFileInfoW(
            wide_path.as_ptr(),
            0,
            &mut shell_info,
            size_of::<SHFILEINFOW>() as u32,
            SHGFI_SYSICONINDEX,
        )
    };
    if info_result == 0 || shell_info.iIcon < 0 {
        return None;
    }

    for image_list_kind in [SHIL_JUMBO, SHIL_EXTRALARGE] {
        let mut image_list: *mut c_void = std::ptr::null_mut();
        let result =
            unsafe { SHGetImageList(image_list_kind as i32, &IID_IIMAGELIST, &mut image_list) };
        if result < 0 || image_list.is_null() {
            continue;
        }

        let image_list_handle = image_list as isize;
        let icon =
            unsafe { ImageList_GetIcon(image_list_handle, shell_info.iIcon, ILD_TRANSPARENT) };
        let mut width = 0;
        let mut height = 0;
        let has_size =
            unsafe { ImageList_GetIconSize(image_list_handle, &mut width, &mut height) } != 0;
        unsafe {
            IUnknown_AtomicRelease(&mut image_list);
        }
        if icon.is_null() {
            continue;
        }
        let fallback_size = if image_list_kind == SHIL_JUMBO {
            256
        } else {
            48
        };
        let icon_size = if has_size {
            width.max(height).clamp(32, 256)
        } else {
            fallback_size
        };
        return Some((icon, icon_size));
    }

    None
}

#[cfg(target_os = "windows")]
fn legacy_shell_icon(path: &str) -> Option<(WindowsIconHandle, i32)> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::UI::Shell::{SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGetFileInfoW};

    let wide_path = wide_string(path);
    let mut shell_info: SHFILEINFOW = unsafe { zeroed() };
    let info_result = unsafe {
        SHGetFileInfoW(
            wide_path.as_ptr(),
            0,
            &mut shell_info,
            size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if info_result == 0 || shell_info.hIcon.is_null() {
        return None;
    }

    Some((shell_info.hIcon, 32))
}

#[cfg(target_os = "windows")]
fn icon_handle_to_data_url(icon: WindowsIconHandle, icon_size: i32) -> Option<String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use image::{ColorType, ImageEncoder, codecs::png::PngEncoder};
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::ptr::null_mut;
    use windows_sys::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleBitmap, CreateCompatibleDC,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{DI_NORMAL, DestroyIcon, DrawIconEx};

    if icon.is_null() || icon_size <= 0 {
        return None;
    }

    let screen_hdc = unsafe { GetDC(null_mut()) };
    if screen_hdc.is_null() {
        unsafe {
            DestroyIcon(icon);
        }
        return None;
    }
    let hdc = unsafe { CreateCompatibleDC(screen_hdc) };
    if hdc.is_null() {
        unsafe {
            ReleaseDC(null_mut(), screen_hdc);
            DestroyIcon(icon);
        }
        return None;
    }
    let bitmap = unsafe { CreateCompatibleBitmap(screen_hdc, icon_size, icon_size) };
    if bitmap.is_null() {
        unsafe {
            DeleteDC(hdc);
            ReleaseDC(null_mut(), screen_hdc);
            DestroyIcon(icon);
        }
        return None;
    }
    let previous = unsafe { SelectObject(hdc, bitmap) };
    let drawn = unsafe {
        DrawIconEx(
            hdc,
            0,
            0,
            icon,
            icon_size,
            icon_size,
            0,
            null_mut(),
            DI_NORMAL,
        )
    };
    if drawn == 0 {
        unsafe {
            SelectObject(hdc, previous);
            DeleteObject(bitmap);
            DeleteDC(hdc);
            ReleaseDC(null_mut(), screen_hdc);
            DestroyIcon(icon);
        }
        return None;
    }

    let mut bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: icon_size,
            biHeight: -icon_size,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [unsafe { zeroed() }],
    };
    let mut bgra = vec![0u8; (icon_size * icon_size * 4) as usize];
    let read = unsafe {
        GetDIBits(
            hdc,
            bitmap,
            0,
            icon_size as u32,
            bgra.as_mut_ptr().cast::<c_void>(),
            &mut bitmap_info,
            DIB_RGB_COLORS,
        )
    };

    unsafe {
        SelectObject(hdc, previous);
        DeleteObject(bitmap);
        DeleteDC(hdc);
        ReleaseDC(null_mut(), screen_hdc);
        DestroyIcon(icon);
    }

    if read == 0 {
        return None;
    }

    let mut rgba = bgra;
    for pixel in rgba.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        if pixel[3] == 0 && (pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0) {
            pixel[3] = 255;
        }
    }
    let (rgba, png_width, png_height) =
        trim_icon_transparent_padding(&rgba, icon_size as u32, icon_size as u32)?;
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(&rgba, png_width, png_height, ColorType::Rgba8.into())
        .ok()?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

// Render the Finder icon for any path (apps, folders, files) via NSWorkspace.
// Off the main thread is fine here: `iconForFile:` and the bitmap export do not
// touch the AppKit run loop. Returns None on any failure so the caller falls
// back to the generic icon.
#[cfg(target_os = "macos")]
fn native_icon_data_url(path: &str) -> Option<String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSSize, NSString};

    if path.is_empty() {
        return None;
    }

    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let ns_path = NSString::from_str(path);
        let image = workspace.iconForFile(&ns_path);
        // Default icon size is 32pt; request a crisp 128pt so the launcher grid
        // shows a sharp icon. NSImage picks the closest representation.
        image.setSize(NSSize::new(128.0, 128.0));

        let tiff = image.TIFFRepresentation()?;
        let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
        let properties = NSDictionary::new();
        let png =
            bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)?;
        let bytes = png.to_vec();
        if bytes.is_empty() {
            return None;
        }
        Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
    }
}

// Resolve the themed icon for any path on Linux/BSD via GIO, then render it to
// a PNG through gdk-pixbuf. Deliberately avoids GTK's main-thread-only
// `IconTheme`: GIO, gdk-pixbuf and the freedesktop-icons resolver are all
// thread-safe, so this is safe from the worker thread that runs `prepare_entry`.
// Best-effort — any failure returns None and the caller falls back to the
// generic icon.
#[cfg(all(unix, not(target_os = "macos")))]
fn native_icon_data_url(path: &str) -> Option<String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use gio::prelude::*;

    let info = gio::File::for_path(path)
        .query_info(
            "standard::icon",
            gio::FileQueryInfoFlags::NONE,
            gio::Cancellable::NONE,
        )
        .ok()?;
    let icon_path = resolve_themed_icon_path(&info.icon()?)?;

    // gdk-pixbuf handles both raster (PNG/XPM) and SVG icons via the system
    // image loaders, scaling to a crisp 128px for the launcher grid.
    let pixbuf = gdk_pixbuf::Pixbuf::from_file_at_size(&icon_path, 128, 128).ok()?;
    let png = pixbuf.save_to_bufferv("png", &[]).ok()?;
    if png.is_empty() {
        return None;
    }
    Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn resolve_themed_icon_path(icon: &gio::Icon) -> Option<std::path::PathBuf> {
    use gio::prelude::*;
    use glib::prelude::*;

    // A FileIcon already points at a concrete file (thumbnails, or apps whose
    // .desktop entry uses an absolute Icon= path).
    if let Some(file_icon) = icon.downcast_ref::<gio::FileIcon>() {
        return file_icon.file().path();
    }

    // A ThemedIcon yields candidate names to resolve against the active icon
    // theme, most-specific first.
    let themed = icon.downcast_ref::<gio::ThemedIcon>()?;
    let theme = active_icon_theme_name();
    for name in themed.names() {
        let mut lookup = freedesktop_icons::lookup(name.as_str()).with_size(128);
        if let Some(theme) = theme.as_deref() {
            lookup = lookup.with_theme(theme);
        }
        if let Some(found) = lookup.with_cache().find() {
            return Some(found);
        }
    }
    None
}

// Best-effort read of the desktop's configured icon theme via GSettings. Absent
// the GNOME schema (some KDE/minimal setups) we return None and let the resolver
// fall back through hicolor.
#[cfg(all(unix, not(target_os = "macos")))]
fn active_icon_theme_name() -> Option<String> {
    use gio::prelude::*;

    let source = gio::SettingsSchemaSource::default()?;
    source.lookup("org.gnome.desktop.interface", true)?;
    let settings = gio::Settings::new("org.gnome.desktop.interface");
    let name = settings.string("icon-theme").to_string();
    if name.is_empty() { None } else { Some(name) }
}

#[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    all(unix, not(target_os = "macos"))
)))]
fn native_icon_data_url(_path: &str) -> Option<String> {
    None
}

#[cfg(not(target_os = "linux"))]
fn is_runnable_path(path: &str) -> bool {
    matches!(
        path_extension(path).as_deref(),
        Some("exe" | "lnk" | "bat" | "cmd" | "ps1")
    )
}

// On Linux "runnable" means the target itself can be executed: a regular file
// with any execute bit set (ELF binaries, scripts, AppImages). Windows-style
// extensions are meaningless here; everything else opens through the desktop's
// default handler. `.desktop` entries are excluded even though desktops mark
// trusted ones executable — they are application definitions to launch via
// `gio launch`, not programs to exec.
#[cfg(target_os = "linux")]
fn is_runnable_path(path: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;

    if path_extension(path).as_deref() == Some("desktop") {
        return false;
    }
    std::fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_powershell_script(path: &str) -> bool {
    path_extension(path).as_deref() == Some("ps1")
}

fn path_extension(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_lowercase())
}

fn containing_folder_for_launcher_path(path: &str) -> Result<String, String> {
    let path = Path::new(path);
    if path.is_dir() {
        return Ok(path.to_string_lossy().to_string());
    }
    path.parent()
        .map(|parent| parent.to_string_lossy().to_string())
        .filter(|parent| !parent.trim().is_empty())
        .ok_or_else(|| "Could not determine the launcher entry folder".to_string())
}

fn system_time_to_unix_ms(time: SystemTime) -> Option<u64> {
    let millis = time
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_millis();
    u64::try_from(millis).ok()
}

#[cfg(test)]
fn rgba_has_visible_pixels(rgba: &[u8]) -> bool {
    rgba.chunks_exact(4).any(icon_pixel_is_visible)
}

#[cfg(any(target_os = "windows", test))]
fn trim_icon_transparent_padding(
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Option<(Vec<u8>, u32, u32)> {
    if width == 0 || height == 0 || rgba.len() != (width as usize * height as usize * 4) {
        return None;
    }

    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0;
    let mut max_y = 0;
    let mut has_visible_pixel = false;

    for y in 0..height {
        for x in 0..width {
            let index = ((y * width + x) * 4) as usize;
            if icon_pixel_is_visible(&rgba[index..index + 4]) {
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
                has_visible_pixel = true;
            }
        }
    }

    if !has_visible_pixel {
        return None;
    }

    let cropped_width = max_x - min_x + 1;
    let cropped_height = max_y - min_y + 1;
    let mut cropped = Vec::with_capacity((cropped_width * cropped_height * 4) as usize);
    for y in min_y..=max_y {
        let start = ((y * width + min_x) * 4) as usize;
        let end = start + (cropped_width * 4) as usize;
        cropped.extend_from_slice(&rgba[start..end]);
    }

    Some((cropped, cropped_width, cropped_height))
}

#[cfg(any(target_os = "windows", test))]
fn icon_pixel_is_visible(pixel: &[u8]) -> bool {
    pixel[3] > 0 && (pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0)
}

#[cfg(target_os = "windows")]
fn wide_string(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn launch_plan_allows_normal_for_arbitrary_files() {
        let plan = plan_launch("C:\\Docs\\notes.txt", AppLauncherLaunchMode::Normal)
            .expect("normal launches can open associated files");

        // Windows shells the document through explorer.exe; macOS and Linux open
        // the path itself via the OS default handler.
        #[cfg(target_os = "windows")]
        {
            assert_eq!(plan.target, "explorer.exe");
            assert_eq!(plan.parameters.as_deref(), Some("C:\\Docs\\notes.txt"));
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(plan.target, "C:\\Docs\\notes.txt");
            assert_eq!(plan.parameters, None);
        }
        assert_eq!(plan.operation, None);
    }

    #[test]
    fn launch_plan_opens_office_documents_through_default_handler() {
        let plan = plan_launch("C:\\Docs\\budget.xlsx", AppLauncherLaunchMode::Normal)
            .expect("office documents open through their shell association");

        #[cfg(target_os = "windows")]
        {
            assert_eq!(plan.target, "explorer.exe");
            assert_eq!(plan.parameters.as_deref(), Some("C:\\Docs\\budget.xlsx"));
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(plan.target, "C:\\Docs\\budget.xlsx");
            assert_eq!(plan.parameters, None);
        }
        assert_eq!(plan.operation, None);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn launch_plan_opens_associated_files_through_default_handler_even_with_extra_fields() {
        let plan = plan_launch_with_options(
            "/Users/example/Documents/budget.xlsx",
            Some("--ignored-by-default-handler"),
            Some("/Users/example/Documents"),
            AppLauncherLaunchMode::Normal,
        )
        .expect("associated files should still open through the OS default handler");

        assert_eq!(plan.target, "/Users/example/Documents/budget.xlsx");
        assert_eq!(plan.parameters, None);
        assert_eq!(plan.working_directory, None);
        assert_eq!(plan.operation, None);
    }

    #[test]
    fn launch_plan_opens_folders_through_default_handler() {
        let plan = plan_launch(
            "C:\\Users\\example\\Documents",
            AppLauncherLaunchMode::Normal,
        )
        .expect("folders open in the OS file manager");

        #[cfg(target_os = "windows")]
        {
            assert_eq!(plan.target, "explorer.exe");
            assert_eq!(
                plan.parameters.as_deref(),
                Some("C:\\Users\\example\\Documents")
            );
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(plan.target, "C:\\Users\\example\\Documents");
            assert_eq!(plan.parameters, None);
        }
        assert_eq!(plan.operation, None);
    }

    // On Linux runnable is decided by the execute bit, not the extension, so
    // these Windows-shaped paths are not runnable there (covered by the
    // Linux-specific tests below).
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn launch_plan_limits_admin_to_runnable_files() {
        let plan = plan_launch("C:\\Tools\\script.ps1", AppLauncherLaunchMode::Admin)
            .expect("scripts can use admin launch");

        // Only Windows wraps the script in powershell.exe; the admin verb itself
        // is rejected later by `launch_plan` on other platforms.
        #[cfg(target_os = "windows")]
        assert_eq!(plan.target, "powershell.exe");
        #[cfg(not(target_os = "windows"))]
        assert_eq!(plan.target, "C:\\Tools\\script.ps1");
        assert_eq!(plan.operation, Some("runas"));

        let error = plan_launch("C:\\Docs\\notes.txt", AppLauncherLaunchMode::Admin)
            .expect_err("documents cannot use admin launch");
        assert!(error.contains("only available for runnable files"));
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn launch_plan_uses_windows_runasuser_verb_for_alternate_user() {
        let plan = plan_launch("C:\\Tools\\tool.exe", AppLauncherLaunchMode::DifferentUser)
            .expect("executables can use alternate-user launch");

        assert_eq!(plan.target, "C:\\Tools\\tool.exe");
        assert_eq!(plan.operation, Some("runasuser"));
    }

    #[cfg(target_os = "linux")]
    fn write_temp_file(dir: &std::path::Path, name: &str, mode: u32) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = dir.join(name);
        std::fs::write(&path, "#!/bin/sh\n").expect("write temp file");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode))
            .expect("set permissions");
        path
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_runnable_detection_uses_executable_bit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = write_temp_file(dir.path(), "tool", 0o755);
        let notes = write_temp_file(dir.path(), "notes.txt", 0o644);
        // Desktops mark trusted .desktop entries executable; they must still
        // launch through `gio launch`, not be exec'd as programs.
        let desktop_entry = write_temp_file(dir.path(), "app.desktop", 0o755);

        assert!(is_runnable_path(&tool.to_string_lossy()));
        assert!(!is_runnable_path(&notes.to_string_lossy()));
        assert!(!is_runnable_path(&desktop_entry.to_string_lossy()));
        assert!(!is_runnable_path(&dir.path().to_string_lossy()));
        assert!(!is_runnable_path("/nonexistent/path"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_launch_plan_keeps_arguments_for_executables() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = write_temp_file(dir.path(), "tool", 0o755);
        let tool_path = tool.to_string_lossy().to_string();
        let dir_path = dir.path().to_string_lossy().to_string();

        let plan = plan_launch_with_options(
            &tool_path,
            Some("--flag value"),
            Some(&dir_path),
            AppLauncherLaunchMode::Normal,
        )
        .expect("executables launch directly with their arguments");

        assert_eq!(plan.target, tool_path);
        assert_eq!(plan.parameters.as_deref(), Some("--flag value"));
        assert_eq!(plan.working_directory.as_deref(), Some(dir_path.as_str()));
        assert_eq!(plan.operation, None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_launch_plan_limits_admin_to_executable_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = write_temp_file(dir.path(), "tool", 0o755);
        let notes = write_temp_file(dir.path(), "notes.txt", 0o644);

        // Planning accepts the admin verb for executables; `launch_plan`
        // rejects the verb itself off Windows.
        let plan = plan_launch(&tool.to_string_lossy(), AppLauncherLaunchMode::Admin)
            .expect("executables can plan an admin launch");
        assert_eq!(plan.operation, Some("runas"));

        let error = plan_launch(&notes.to_string_lossy(), AppLauncherLaunchMode::Admin)
            .expect_err("documents cannot use admin launch");
        assert!(error.contains("only available for runnable files"));
    }

    #[test]
    fn launch_plan_open_folder_uses_containing_folder() {
        // Build the path from components so the parent-folder logic is
        // exercised with native separators on every OS.
        let folder = PathBuf::from("Tools");
        let exe = folder.join("tool.exe");

        let plan = plan_launch(&exe.to_string_lossy(), AppLauncherLaunchMode::OpenFolder)
            .expect("open folder should target the parent folder");

        assert_eq!(plan.target, folder.to_string_lossy());
        assert_eq!(plan.parameters, None);
        assert_eq!(plan.operation, None);
    }

    #[test]
    fn visible_icon_pixels_reject_all_transparent_images() {
        assert!(!rgba_has_visible_pixels(&[0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(rgba_has_visible_pixels(&[0, 0, 0, 0, 12, 34, 56, 255]));
    }

    #[test]
    fn icon_bitmap_trimming_removes_transparent_padding() {
        let rgba = [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //
            0, 0, 0, 0, 20, 40, 60, 255, 21, 41, 61, 255, //
            0, 0, 0, 0, 22, 42, 62, 255, 23, 43, 63, 255, //
        ];

        let (trimmed, width, height) =
            trim_icon_transparent_padding(&rgba, 3, 3).expect("visible icon pixels");

        assert_eq!((width, height), (2, 2));
        assert_eq!(
            trimmed,
            vec![
                20, 40, 60, 255, 21, 41, 61, 255, //
                22, 42, 62, 255, 23, 43, 63, 255,
            ]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn native_icon_data_url_extracts_visible_windows_app_icon() {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let notepad = std::path::Path::new(&system_root)
            .join("System32")
            .join("notepad.exe");
        if !notepad.exists() {
            return;
        }

        let icon_data_url = native_icon_data_url(&notepad.to_string_lossy())
            .expect("notepad icon should be extractable");

        assert!(icon_data_url.starts_with("data:image/png;base64,"));
    }
}

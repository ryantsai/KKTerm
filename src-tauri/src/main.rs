// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    apply_linux_gpu_workarounds();
    #[cfg(target_os = "windows")]
    apply_embedded_webview2_runtime();

    kkterm_lib::run()
}

/// WebKitGTK's DMA-BUF renderer silently produces a blank window under
/// virtualized graphics stacks (confirmed on Fedora/Ubuntu VMs: the process
/// and WebKitWebProcess stay alive, nothing crashes, but nothing renders).
/// Disabling it costs a rendering fast path, so it's only applied when a
/// hypervisor is actually detected, not unconditionally. Must run before
/// Tauri/GTK/WebKit touch the display (see docs/RELEASE.md, Linux AppImage notes).
#[cfg(target_os = "linux")]
fn apply_linux_gpu_workarounds() {
    // When running from an AppImage, AppRun points LD_LIBRARY_PATH at the
    // bundled libs; host binaries like systemd-detect-virt must not load
    // those (e.g. bundled libcrypto.so.3 lacks the host's OPENSSL_3.4.0
    // symbols on Fedora 44, so the loader aborts and detection reports
    // "not a VM").
    let running_in_vm = std::process::Command::new("systemd-detect-virt")
        .args(["--vm", "--quiet"])
        .env_remove("LD_LIBRARY_PATH")
        .status()
        .map(|status| status.success())
        .unwrap_or(false);

    if running_in_vm {
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

/// MSIX (Microsoft Store) packages embed a WebView2 Fixed Version runtime in a
/// sibling `WebView2Runtime` folder (see scripts/package-msix.ps1). wry creates
/// the WebView2 environment with a null browser folder, so the WebView2 loader
/// honors the WEBVIEW2_BROWSER_EXECUTABLE_FOLDER environment variable. Point it
/// at the embedded runtime before the first WebView2 environment is created;
/// other install modes have no such folder, so nothing changes for them.
#[cfg(target_os = "windows")]
fn apply_embedded_webview2_runtime() {
    if std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_some() {
        return;
    }

    let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
    else {
        return;
    };

    let runtime_dir = exe_dir.join("WebView2Runtime");
    if runtime_dir.join("msedgewebview2.exe").is_file() {
        unsafe {
            std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", runtime_dir);
        }
    }
}

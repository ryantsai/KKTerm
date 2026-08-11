// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(exit_code) = kkterm_lib::run_system_cleaner_helper_if_requested() {
        std::process::exit(exit_code);
    }

    #[cfg(target_os = "linux")]
    apply_linux_gpu_workarounds();

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

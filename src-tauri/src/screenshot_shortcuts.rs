//! Global capture hotkeys for the Screenshots Module. Shortcuts are stored in
//! `ScreenshotSettings`, registered from Rust at startup and on every settings
//! save, and fire a frontend event instead of capturing directly so tray,
//! hotkey, and in-app captures all share the same frontend command path
//! (Status Bar notices, library refresh).

use std::str::FromStr;

use tauri::Emitter;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::storage::ScreenshotSettings;

/// Emitted with a `"region" | "window" | "fullscreen"` payload when a capture
/// hotkey (or tray capture item) fires. The frontend invokes the matching
/// library capture command; the webview stays alive while hidden to the tray,
/// so this works without restoring the window.
pub const CAPTURE_EVENT: &str = "kkterm://capture-screenshot";

fn parse(label: &str, accelerator: &str) -> Result<Shortcut, String> {
    Shortcut::from_str(accelerator)
        .map_err(|_| format!("the {label} capture shortcut '{accelerator}' is not a valid key combination"))
}

fn entries(settings: &ScreenshotSettings) -> [(bool, &str, &'static str, &'static str); 3] {
    [
        (
            settings.region_shortcut_enabled(),
            settings.region_shortcut(),
            "region",
            "region",
        ),
        (
            settings.window_shortcut_enabled(),
            settings.window_shortcut(),
            "window",
            "window",
        ),
        (
            settings.fullscreen_shortcut_enabled(),
            settings.fullscreen_shortcut(),
            "fullscreen",
            "fullscreen",
        ),
    ]
}

/// Validates every enabled shortcut string without touching OS registration
/// state, so invalid combinations are rejected before settings persist.
pub fn validate(settings: &ScreenshotSettings) -> Result<(), String> {
    for (enabled, accelerator, _, label) in entries(settings) {
        if enabled && !accelerator.is_empty() {
            parse(label, accelerator)?;
        }
    }
    Ok(())
}

/// Re-registers the capture hotkeys from settings, dropping every previously
/// registered shortcut first. Registration failures (typically another app
/// holding the key) are reported without stopping the remaining shortcuts.
pub fn apply(app: &tauri::AppHandle, settings: &ScreenshotSettings) -> Result<(), String> {
    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|error| format!("failed to reset capture shortcuts: {error}"))?;

    let mut errors = Vec::new();
    for (enabled, accelerator, mode, label) in entries(settings) {
        if !enabled || accelerator.is_empty() {
            continue;
        }
        let shortcut = parse(label, accelerator)?;
        let register_result = manager.on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app.emit(CAPTURE_EVENT, mode);
            }
        });
        if let Err(error) = register_result {
            errors.push(format!("{label} ({accelerator}): {error}"));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "failed to register capture shortcuts — {}",
            errors.join("; ")
        ))
    }
}

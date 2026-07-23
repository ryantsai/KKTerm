use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{PhysicalSize, Runtime, Size, Window};
#[cfg(target_os = "windows")]
use tauri::{PhysicalPosition, Position};

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{HWND, RECT},
    UI::WindowsAndMessaging::{
        GetSystemMetrics, GetWindowRect, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    },
};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

const DEFAULT_WIDTH: u32 = 1360;
const DEFAULT_HEIGHT: u32 = 860;
const MIN_WIDTH: u32 = 1120;
const MIN_HEIGHT: u32 = 720;
const MAX_WIDTH: u32 = 10_000;
const MAX_HEIGHT: u32 = 10_000;
const RECOVERY_X: i32 = 0;
const RECOVERY_Y: i32 = 0;
const RECOVERY_WIDTH: u32 = 1440;
const RECOVERY_HEIGHT: u32 = 940;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct WindowRect {
    pub(crate) left: i32,
    pub(crate) top: i32,
    pub(crate) right: i32,
    pub(crate) bottom: i32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RecoveryBounds {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MainWindowSettings {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) maximized: bool,
}

impl MainWindowSettings {
    fn default_normal() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            maximized: false,
        }
    }
}

pub(crate) struct MainWindowState {
    settings: Mutex<MainWindowSettings>,
}

impl MainWindowState {
    pub(crate) fn new(settings: MainWindowSettings) -> Self {
        Self {
            settings: Mutex::new(settings),
        }
    }

    pub(crate) fn update_normal_size(&self, size: PhysicalSize<u32>) {
        if let Ok(mut settings) = self.settings.lock() {
            if let Ok(next) = validate_main_window_settings(MainWindowSettings {
                width: size.width,
                height: size.height,
                maximized: settings.maximized,
            }) {
                settings.width = next.width;
                settings.height = next.height;
            }
        }
    }

    pub(crate) fn snapshot_for_window<R: Runtime>(&self, window: &Window<R>) -> MainWindowSettings {
        let mut settings = self
            .settings
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_else(|_| MainWindowSettings::default_normal());

        let maximized = window.is_maximized().unwrap_or(settings.maximized);
        settings.maximized = maximized;

        if !maximized {
            if let Ok(size) = window.inner_size() {
                if let Ok(next) = validate_main_window_settings(MainWindowSettings {
                    width: size.width,
                    height: size.height,
                    maximized,
                }) {
                    settings = next;
                }
            }
        }

        settings
    }
}

pub(crate) fn restore_main_window(
    window: &Window,
    settings: Option<MainWindowSettings>,
) -> MainWindowSettings {
    let settings = settings.unwrap_or_else(|| {
        window
            .inner_size()
            .ok()
            .and_then(|size| {
                validate_main_window_settings(MainWindowSettings {
                    width: size.width,
                    height: size.height,
                    maximized: window.is_maximized().unwrap_or(false),
                })
                .ok()
            })
            .unwrap_or_else(MainWindowSettings::default_normal)
    });

    let _ = window.set_size(Size::Physical(PhysicalSize::new(
        settings.width,
        settings.height,
    )));
    let _ = recover_if_offscreen(window);

    if settings.maximized {
        let _ = window.maximize();
    }

    settings
}

pub(crate) fn validate_main_window_settings(
    mut settings: MainWindowSettings,
) -> Result<MainWindowSettings, String> {
    settings.width = settings.width.clamp(MIN_WIDTH, MAX_WIDTH);
    settings.height = settings.height.clamp(MIN_HEIGHT, MAX_HEIGHT);
    Ok(settings)
}

pub(crate) fn recovery_bounds_for_offscreen_window(
    window_rect: WindowRect,
    desktop_rect: WindowRect,
) -> Option<RecoveryBounds> {
    let overlaps_desktop = window_rect.left < desktop_rect.right
        && window_rect.right > desktop_rect.left
        && window_rect.top < desktop_rect.bottom
        && window_rect.bottom > desktop_rect.top;

    if overlaps_desktop {
        None
    } else {
        Some(RecoveryBounds {
            x: RECOVERY_X,
            y: RECOVERY_Y,
            width: RECOVERY_WIDTH,
            height: RECOVERY_HEIGHT,
        })
    }
}

pub(crate) fn recover_if_offscreen<R: Runtime>(window: &Window<R>) -> Option<RecoveryBounds> {
    recover_if_offscreen_impl(window)
}

#[cfg(target_os = "windows")]
fn recover_if_offscreen_impl<R: Runtime>(window: &Window<R>) -> Option<RecoveryBounds> {
    let handle = window.hwnd().ok()?;
    let mut rect = RECT::default();
    unsafe {
        GetWindowRect(HWND(handle.0), &mut rect).ok()?;
    }

    let desktop = WindowRect {
        left: unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) },
        top: unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) },
        right: unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) }
            + unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) }.max(1),
        bottom: unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) }
            + unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) }.max(1),
    };
    let window_rect = WindowRect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    };

    let recovery = recovery_bounds_for_offscreen_window(window_rect, desktop)?;
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(
        recovery.x, recovery.y,
    )));
    let _ = window.set_size(Size::Physical(PhysicalSize::new(
        recovery.width,
        recovery.height,
    )));
    Some(recovery)
}

#[cfg(not(target_os = "windows"))]
fn recover_if_offscreen_impl<R: Runtime>(_window: &Window<R>) -> Option<RecoveryBounds> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_window_size_to_supported_range() {
        let settings = validate_main_window_settings(MainWindowSettings {
            width: 200,
            height: 50,
            maximized: true,
        })
        .expect("settings are normalized");

        assert_eq!(
            settings,
            MainWindowSettings {
                width: MIN_WIDTH,
                height: MIN_HEIGHT,
                maximized: true,
            }
        );
    }

    #[test]
    fn recovers_window_when_rect_is_fully_offscreen() {
        let recovery = recovery_bounds_for_offscreen_window(
            WindowRect {
                left: -21333,
                top: -21333,
                right: -21175,
                bottom: -21307,
            },
            WindowRect {
                left: 0,
                top: 0,
                right: 2560,
                bottom: 1440,
            },
        );

        assert_eq!(
            recovery,
            Some(RecoveryBounds {
                x: 0,
                y: 0,
                width: 1440,
                height: 940,
            })
        );
    }

    #[test]
    fn keeps_window_when_rect_still_overlaps_desktop() {
        let recovery = recovery_bounds_for_offscreen_window(
            WindowRect {
                left: -50,
                top: 20,
                right: 600,
                bottom: 500,
            },
            WindowRect {
                left: 0,
                top: 0,
                right: 2560,
                bottom: 1440,
            },
        );

        assert_eq!(recovery, None);
    }
}

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use tauri::{LogicalSize, PhysicalPosition, Position};
use tauri::{PhysicalSize, Runtime, Size, Window};

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{HWND, RECT},
    UI::WindowsAndMessaging::{
        GetSystemMetrics, GetWindowRect, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    },
};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

// Unit contract for this module. Every size constant below is in **logical**
// pixels, matching the `inner_size`/`min_inner_size` passed to the main-window
// builder in `lib.rs` (Tauri's builder takes logical pixels). Persisted
// `MainWindowSettings` are in **physical** pixels, because they come from
// `Window::inner_size`. The two only line up at 100% display scaling, so any
// comparison between them must go through the window's scale factor.
//
// This matters because tao applies `set_size` verbatim on Windows and enforces
// the minimum only in `WM_GETMINMAXINFO`, i.e. when the user drags the frame.
// A physical size below the scaled minimum therefore survives startup, renders
// a cramped layout, and then snaps to the minimum the moment the window is
// dragged.
const DEFAULT_WIDTH: u32 = 1360;
const DEFAULT_HEIGHT: u32 = 860;
const MIN_WIDTH: u32 = 1120;
const MIN_HEIGHT: u32 = 720;
const RECOVERY_WIDTH: u32 = 1440;
const RECOVERY_HEIGHT: u32 = 940;
// Physical-pixel sanity ceiling for persisted sizes.
const MAX_WIDTH: u32 = 10_000;
const MAX_HEIGHT: u32 = 10_000;
const RECOVERY_X: i32 = 0;
const RECOVERY_Y: i32 = 0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct WindowRect {
    pub(crate) left: i32,
    pub(crate) top: i32,
    pub(crate) right: i32,
    pub(crate) bottom: i32,
}

/// `x`/`y` are physical pixels on the Windows virtual desktop; `width`/`height`
/// are logical pixels, like every other size constant in this module.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RecoveryBounds {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// Persisted main-window geometry. `width`/`height` are **physical** pixels.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MainWindowSettings {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) maximized: bool,
}

impl MainWindowSettings {
    fn default_normal(scale_factor: f64) -> Self {
        Self {
            width: to_physical(DEFAULT_WIDTH, scale_factor),
            height: to_physical(DEFAULT_HEIGHT, scale_factor),
            maximized: false,
        }
    }
}

/// Converts a logical constant to physical pixels. Rounds up so the result is
/// never a pixel short of the `ptMinTrackSize` tao reports to Windows, which
/// rounds the same conversion to nearest.
fn to_physical(logical: u32, scale_factor: f64) -> u32 {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    ((f64::from(logical) * scale).ceil() as u32).max(1)
}

fn window_scale_factor<R: Runtime>(window: &Window<R>) -> f64 {
    window.scale_factor().unwrap_or(1.0)
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
        // Windows reports `Resized(0x0)` while the window is minimized, and tao
        // clears its MAXIMIZED flag before dispatching that event, so the
        // caller's `is_maximized` guard does not filter it out. Recording it
        // would replace the size the user actually chose.
        if size.width == 0 || size.height == 0 {
            return;
        }
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
            .unwrap_or_else(|_| MainWindowSettings::default_normal(window_scale_factor(window)));

        let maximized = window.is_maximized().unwrap_or(settings.maximized);
        settings.maximized = maximized;

        if !maximized {
            // A minimized window reports a zero client rect; keep the tracked
            // size instead of persisting the placeholder over it.
            if let Some(size) = window
                .inner_size()
                .ok()
                .filter(|size| size.width > 0 && size.height > 0)
            {
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
    let scale_factor = window_scale_factor(window);
    let settings = settings.unwrap_or_else(|| {
        window
            .inner_size()
            .ok()
            .filter(|size| size.width > 0 && size.height > 0)
            .and_then(|size| {
                validate_main_window_settings(MainWindowSettings {
                    width: size.width,
                    height: size.height,
                    maximized: window.is_maximized().unwrap_or(false),
                })
                .ok()
            })
            .unwrap_or_else(|| MainWindowSettings::default_normal(scale_factor))
    });
    // `set_size` is applied verbatim, so anything below the scaled minimum would
    // survive startup as an undersized window that only snaps back when the user
    // drags it. Builds before this fix clamped against the logical minimum as if
    // it were physical, so stored sizes on a scaled display can sit well under
    // the real floor; raise them here.
    let settings = enforce_minimum_size(settings, scale_factor);

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

/// Unit-independent sanity range for a persisted physical size. The minimum is
/// deliberately not applied here: it is logical, so it depends on the display
/// scale factor and belongs in `enforce_minimum_size`, which has a window.
pub(crate) fn validate_main_window_settings(
    mut settings: MainWindowSettings,
) -> Result<MainWindowSettings, String> {
    settings.width = settings.width.clamp(1, MAX_WIDTH);
    settings.height = settings.height.clamp(1, MAX_HEIGHT);
    Ok(settings)
}

/// Raises a physical size to the window's real minimum, which is the logical
/// `min_inner_size` scaled by `scale_factor`.
pub(crate) fn enforce_minimum_size(
    mut settings: MainWindowSettings,
    scale_factor: f64,
) -> MainWindowSettings {
    settings.width = settings.width.max(to_physical(MIN_WIDTH, scale_factor));
    settings.height = settings.height.max(to_physical(MIN_HEIGHT, scale_factor));
    settings
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
    let _ = window.set_size(Size::Logical(LogicalSize::new(
        f64::from(recovery.width),
        f64::from(recovery.height),
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
    fn validation_caps_absurd_sizes_without_applying_the_logical_minimum() {
        let settings = validate_main_window_settings(MainWindowSettings {
            width: 200,
            height: 99_999,
            maximized: true,
        })
        .expect("settings are normalized");

        // 200 physical is below the logical minimum but only a scale factor can
        // say by how much, so validation leaves it to `enforce_minimum_size`.
        assert_eq!(
            settings,
            MainWindowSettings {
                width: 200,
                height: MAX_HEIGHT,
                maximized: true,
            }
        );
    }

    #[test]
    fn enforces_minimum_against_the_scaled_logical_floor() {
        // The size a pre-fix build persisted on a 150% display: exactly the
        // logical minimum stored as physical pixels, i.e. two thirds of the
        // real floor. Restoring it verbatim produced an undersized window that
        // snapped to the minimum on the first drag.
        let settings = enforce_minimum_size(
            MainWindowSettings {
                width: 1120,
                height: 720,
                maximized: false,
            },
            1.5,
        );

        assert_eq!(
            settings,
            MainWindowSettings {
                width: 1680,
                height: 1080,
                maximized: false,
            }
        );
    }

    #[test]
    fn enforces_minimum_without_shrinking_a_larger_window() {
        let settings = enforce_minimum_size(
            MainWindowSettings {
                width: 2400,
                height: 1500,
                maximized: false,
            },
            1.5,
        );

        assert_eq!(
            settings,
            MainWindowSettings {
                width: 2400,
                height: 1500,
                maximized: false,
            }
        );
    }

    #[test]
    fn logical_to_physical_never_rounds_below_the_enforced_minimum() {
        // tao rounds the same conversion to nearest when it answers
        // WM_GETMINMAXINFO, so rounding up here can never land under it.
        assert_eq!(to_physical(MIN_WIDTH, 1.0), MIN_WIDTH);
        assert_eq!(to_physical(MIN_WIDTH, 1.25), 1400);
        assert_eq!(to_physical(MIN_HEIGHT, 1.25), 900);
        assert_eq!(to_physical(MIN_HEIGHT, 1.75), 1260);
        // A bogus scale factor falls back to 1.0 rather than collapsing to zero.
        assert_eq!(to_physical(MIN_WIDTH, 0.0), MIN_WIDTH);
        assert_eq!(to_physical(MIN_WIDTH, f64::NAN), MIN_WIDTH);
    }

    #[test]
    fn tracked_size_survives_a_minimize_report() {
        let state = MainWindowState::new(MainWindowSettings {
            width: 2400,
            height: 1500,
            maximized: false,
        });

        // Windows reports a zero client area while the window is minimized.
        state.update_normal_size(PhysicalSize::new(0, 0));

        let tracked = state.settings.lock().expect("tracked settings").clone();
        assert_eq!(
            tracked,
            MainWindowSettings {
                width: 2400,
                height: 1500,
                maximized: false,
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

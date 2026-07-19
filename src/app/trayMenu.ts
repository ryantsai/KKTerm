import { invokeCommand, isTauriRuntime } from "../lib/tauri";
import type { Connection } from "../types";

const TRAY_RECENT_LIMIT = 3;

/**
 * Pushes the localized tray-menu snapshot to the backend. The Rust tray has no i18n, so the
 * frontend owns every translated label. Best-effort: failures are swallowed so a missing tray
 * never blocks the app.
 */
export async function pushTrayMenu(
  recentConnections: Connection[],
  labels: {
    dontSleep: string;
    exit: string;
    captureRegion: string;
    captureWindow: string;
    captureFullscreen: string;
  },
) {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await invokeCommand("update_tray_menu", {
      snapshot: {
        recentConnections: recentConnections
          .slice(0, TRAY_RECENT_LIMIT)
          .map((connection) => ({ id: connection.id, label: connection.name })),
        dontSleepLabel: labels.dontSleep,
        exitLabel: labels.exit,
        captureRegionLabel: labels.captureRegion,
        captureWindowLabel: labels.captureWindow,
        captureFullscreenLabel: labels.captureFullscreen,
      },
    });
  } catch {
    // Tray menu is a convenience surface; ignore push failures.
  }
}

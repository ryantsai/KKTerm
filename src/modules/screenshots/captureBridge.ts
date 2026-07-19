// Shared capture entry point for the Screenshots Module. The header buttons,
// the tray capture items, and the global capture hotkeys all end up in
// `performLibraryCapture`, so every path gets the same Status Bar notices and
// library refresh. Tray/hotkey requests arrive as a backend event because the
// webview keeps running while the window is hidden to the tray.
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { useScreenshotsStore } from "./state";

export type ScreenshotCaptureMode = "region" | "window" | "fullscreen";

// Keep in sync with `screenshot_shortcuts::CAPTURE_EVENT` in the backend.
const CAPTURE_EVENT = "kkterm://capture-screenshot";

function isCaptureMode(value: unknown): value is ScreenshotCaptureMode {
  return value === "region" || value === "window" || value === "fullscreen";
}

export async function performLibraryCapture(mode: ScreenshotCaptureMode, t: TFunction) {
  const notify = useWorkspaceStore.getState().showStatusBarNotice;
  if (!isTauriRuntime()) {
    notify(t("screenshots.requiresRuntime"), { tone: "warning" });
    return;
  }
  if (useScreenshotsStore.getState().captureInFlight) {
    return;
  }
  useScreenshotsStore.getState().setCaptureInFlight(true);
  try {
    const screenshot =
      mode === "region"
        ? await invokeCommand("capture_interactive_region_screenshot_to_library", {
            kind: "region",
          })
        : mode === "window"
          ? await invokeCommand("capture_active_window_screenshot_to_library", {
              kind: "window",
            })
          : await invokeCommand("capture_fullscreen_screenshot_to_library", {
              kind: "fullscreen",
            });
    useScreenshotsStore.getState().prepend(screenshot);
    notify(t("screenshots.captureSaved", { name: screenshot.fileName }), {
      tone: "success",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Backing out of the region/window picker is a silent non-event.
    if (!message.toLowerCase().includes("canceled")) {
      notify(t("screenshots.captureError", { message }), { tone: "error" });
    }
  } finally {
    useScreenshotsStore.getState().setCaptureInFlight(false);
  }
}

/** App-wide listener for tray-item and global-hotkey capture requests. */
export function useScreenshotCaptureBridge() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const unlisten = listen<string>(CAPTURE_EVENT, (event) => {
      if (isCaptureMode(event.payload)) {
        void performLibraryCapture(event.payload, tRef.current);
      }
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);
}

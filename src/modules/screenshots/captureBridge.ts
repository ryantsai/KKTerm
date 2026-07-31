// Shared capture entry point for the Screenshots Module. The header buttons,
// the tray capture items, and the global capture hotkeys all end up in
// `performScreenshotCapture`, so every path gets the same Status Bar notices and
// library refresh. Tray/hotkey requests arrive as a backend event because the
// webview keeps running while the window is hidden to the tray.
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  invokeCommand,
  isTauriRuntime,
  type ScreenshotCaptureResult,
} from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { readCaptureDelay } from "./captureDelay";
import { useScreenshotsStore } from "./state";

export type ScreenshotCaptureMode = "region" | "window" | "fullscreen";
type ScreenshotCaptureRequest = {
  mode: ScreenshotCaptureMode;
  source: "shortcut" | "tray";
};

// Keep in sync with `screenshot_shortcuts::CAPTURE_EVENT` in the backend.
const CAPTURE_EVENT = "kkterm://capture-screenshot";

function isCaptureMode(value: unknown): value is ScreenshotCaptureMode {
  return value === "region" || value === "window" || value === "fullscreen";
}

function isCaptureRequest(value: unknown): value is ScreenshotCaptureRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ScreenshotCaptureRequest>;
  return isCaptureMode(candidate.mode)
    && (candidate.source === "shortcut" || candidate.source === "tray");
}

export function finishScreenshotCapture(result: ScreenshotCaptureResult, t: TFunction) {
  if (result.storedScreenshot) {
    useScreenshotsStore.getState().prepend(result.storedScreenshot);
    if (result.openInEditor) {
      useScreenshotsStore.getState().requestEditor(result.storedScreenshot.id);
    }
  }
  const message = result.storedScreenshot && result.copiedToClipboard
    ? t("screenshots.captureSavedAndCopied", { name: result.storedScreenshot.fileName })
    : result.storedScreenshot
      ? t("screenshots.captureSaved", { name: result.storedScreenshot.fileName })
      : t("screenshots.captureCopied");
  useWorkspaceStore.getState().showStatusBarNotice(message, { tone: "success" });
}

export async function performScreenshotCapture(
  mode: ScreenshotCaptureMode,
  t: TFunction,
  delaySeconds = 0,
  minimizeWindow = false,
) {
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
    if (delaySeconds > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, delaySeconds * 1000);
      });
    }
    const result =
      mode === "region"
        ? await invokeCommand("capture_interactive_region_screenshot_to_library", {
            kind: "region",
            minimizeWindow,
          })
        : mode === "window"
          ? await invokeCommand("capture_active_window_screenshot_to_library", {
              kind: "window",
              minimizeWindow,
            })
          : await invokeCommand("capture_fullscreen_screenshot_to_library", {
              kind: "fullscreen",
              minimizeWindow,
            });
    finishScreenshotCapture(result, t);
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
    const unlisten = listen<ScreenshotCaptureRequest>(CAPTURE_EVENT, (event) => {
      if (isCaptureRequest(event.payload)) {
        const delaySeconds = event.payload.source === "shortcut" ? readCaptureDelay() : 0;
        void performScreenshotCapture(event.payload.mode, tRef.current, delaySeconds);
      }
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);
}

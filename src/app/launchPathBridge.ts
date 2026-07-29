import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { invokeCommand, isTauriRuntime } from "../lib/tauri";
import { useScreenshotsStore } from "../modules/screenshots/state";
import { useWorkspaceStore } from "../store";

const SCREENSHOT_EDITOR_IMAGE_EXTENSIONS = new Set([
  "gif",
  "jpg",
  "jpeg",
  "png",
  "webp",
]);

export function isScreenshotEditorImagePath(path: string) {
  const fileName = path.split(/[/\\]/).pop() ?? path;
  const separator = fileName.lastIndexOf(".");
  return separator >= 0
    && SCREENSHOT_EDITOR_IMAGE_EXTENSIONS.has(
      fileName.slice(separator + 1).toLowerCase(),
    );
}

export function useLaunchPathBridge({
  openScreenshots,
  openWorkspace,
}: {
  openScreenshots: () => void;
  openWorkspace: () => void;
}) {
  const openScreenshotsRef = useRef(openScreenshots);
  const openWorkspaceRef = useRef(openWorkspace);
  openScreenshotsRef.current = openScreenshots;
  openWorkspaceRef.current = openWorkspace;

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let stopListening: (() => void) | undefined;

    const drainLaunchPaths = async () => {
      try {
        const paths = await invokeCommand("take_launch_paths", undefined);
        if (paths.length === 0) {
          return;
        }
        const store = useWorkspaceStore.getState();
        for (const path of paths) {
          if (path.kind === "file" && isScreenshotEditorImagePath(path.path)) {
            const screenshot = await invokeCommand("read_ephemeral_screenshot", {
              path: path.path,
            });
            useScreenshotsStore.getState().requestEphemeralEditor(screenshot);
            openScreenshotsRef.current();
            continue;
          }
          openWorkspaceRef.current();
          store.openEphemeralPath(path);
        }
      } catch (error) {
        useWorkspaceStore.getState().showStatusBarNotice(
          error instanceof Error ? error.message : String(error),
          { tone: "error" },
        );
      }
    };

    void listen("kkterm://launch-paths-available", () => {
      void drainLaunchPaths();
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      stopListening = unlisten;
      void drainLaunchPaths();
    });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);
}

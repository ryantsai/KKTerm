import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "../../lib/tauri";
import {
  PROGRESS_EVENT_NAME,
  type InstallOptions,
  type ProgressEvent,
} from "./types";

export type TerminalProgressEvent = Extract<
  ProgressEvent,
  { kind: "completed" | "failed" | "cancelled" }
>;

export function isTerminalProgressEvent(
  event: ProgressEvent,
): event is TerminalProgressEvent {
  return (
    event.kind === "completed" ||
    event.kind === "failed" ||
    event.kind === "cancelled"
  );
}

export async function installRecipeAndWait(
  toolId: string,
  options?: InstallOptions,
  onProgress?: (event: ProgressEvent) => void,
): Promise<TerminalProgressEvent> {
  const waiter = waitForTerminalProgress(toolId, onProgress);
  await waiter.ready;
  try {
    await invokeCommand("installer_install_recipe", { toolId, options });
  } catch (error) {
    waiter.cancel();
    throw error;
  }
  return waiter.done;
}

export async function uninstallRecipeAndWait(
  toolId: string,
  onProgress?: (event: ProgressEvent) => void,
): Promise<TerminalProgressEvent> {
  const waiter = waitForTerminalProgress(toolId, onProgress);
  await waiter.ready;
  try {
    await invokeCommand("installer_uninstall_recipe", { toolId });
  } catch (error) {
    waiter.cancel();
    throw error;
  }
  return waiter.done;
}

function waitForTerminalProgress(
  toolId: string,
  onProgress?: (event: ProgressEvent) => void,
) {
  let unlisten: (() => void) | undefined;
  let resolveTerminalEvent!: (event: TerminalProgressEvent) => void;
  const done = new Promise<TerminalProgressEvent>((resolve) => {
    resolveTerminalEvent = resolve;
  });
  const ready = listen<ProgressEvent>(PROGRESS_EVENT_NAME, (event) => {
    const payload = event.payload;
    if (!("toolId" in payload) || payload.toolId !== toolId) return;
    onProgress?.(payload);
    if (!isTerminalProgressEvent(payload)) return;
    unlisten?.();
    resolveTerminalEvent(payload);
  }).then((u) => {
    unlisten = u;
  });
  return {
    ready,
    done,
    cancel: () => unlisten?.(),
  };
}

import type { TFunction } from "i18next";
import { showNativeContextMenu, type NativeContextMenuItem } from "../lib/nativeContextMenu";
import { invokeCommand } from "../lib/tauri";
import {
  formatShutdownTimerDuration,
  shutdownTimerDelaysMinutes,
  type ShutdownTimerStatus,
} from "./shutdownTimerModel";

type ShutdownTimerMenuOptions = {
  cancelOnly?: boolean;
  language: string;
  onError: (error: unknown) => void;
  position: { x: number; y: number };
  t: TFunction;
};

export async function showShutdownTimerMenu({
  cancelOnly = false,
  language,
  onError,
  position,
  t,
}: ShutdownTimerMenuOptions) {
  let status: ShutdownTimerStatus | null;
  try {
    status = await invokeCommand("get_shutdown_timer_status");
  } catch (error) {
    onError(error);
    return;
  }

  const items: NativeContextMenuItem[] = cancelOnly
    ? []
    : shutdownTimerDelaysMinutes.map((delayMinutes) => ({
        kind: "item" as const,
        label: t("app.shutdownTimerAfter", {
          duration: formatShutdownTimerDuration(delayMinutes, language),
        }),
        action: () => {
          void invokeCommand("schedule_shutdown_timer", { delayMinutes }).catch(onError);
        },
      }));

  if (status) {
    if (items.length > 0) {
      items.push({ kind: "separator" });
    }
    items.push({
      kind: "item",
      label: t("app.shutdownTimerCancel"),
      action: () => {
        void invokeCommand("cancel_shutdown_timer").catch(onError);
      },
    });
  }

  await showNativeContextMenu(items, position);
}

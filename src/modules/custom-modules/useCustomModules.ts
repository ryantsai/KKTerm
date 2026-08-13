import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { CustomModuleDestination, InstalledCustomModule } from "./types";

export const CUSTOM_MODULES_CHANGED_EVENT = "kkterm:custom-modules-changed";

type DownloadProgress = {
  moduleId: string;
  kind: "started" | "progress" | "finished" | "cancelled" | "failed";
  downloaded?: number;
  total?: number | null;
};

export function customModuleDestinations(modules: InstalledCustomModule[]) {
  return modules.flatMap<CustomModuleDestination>((module) =>
    module.enabled && module.railVisible && module.health === "ready"
      ? module.modules
          .filter((contribution) => contribution.railVisible)
          .map((contribution) => ({
            moduleId: module.id,
            contributionId: contribution.id,
            title: contribution.title,
            icon: contribution.icon,
            iconDataUrl: module.iconDataUrls?.[contribution.id],
          }))
      : [],
  );
}

export function customModuleDestinationKey(destination: CustomModuleDestination) {
  return `custom:${destination.moduleId}:${destination.contributionId}`;
}

export function useCustomModules() {
  const { t } = useTranslation();
  const translationRef = useRef(t);
  translationRef.current = t;
  const showStatusBarProgress = useWorkspaceStore((state) => state.showStatusBarProgress);
  const updateStatusBarProgress = useWorkspaceStore((state) => state.updateStatusBarProgress);
  const clearStatusBarNotice = useWorkspaceStore((state) => state.clearStatusBarNotice);
  const [modules, setModules] = useState<InstalledCustomModule[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!isTauriRuntime()) {
      setModules([]);
      setLoaded(true);
      return;
    }
    try {
      const next = await invokeCommand("list_custom_modules");
      setModules(next);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload().catch(() => setModules([]));
    const handleChange = () => void reload().catch(() => setModules([]));
    window.addEventListener(CUSTOM_MODULES_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(CUSTOM_MODULES_CHANGED_EVENT, handleChange);
  }, [reload]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const noticeIds = new Map<string, number>();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<DownloadProgress>("custom-modules://progress", ({ payload }) => {
      if (disposed) return;
      if (payload.kind === "started") {
        const noticeId = showStatusBarProgress(
          translationRef.current("settings.customModulesDownloading"),
          {
            progress: 0,
            cancelLabel: translationRef.current("settings.customModulesDownloadCancel"),
            onCancel: () => {
              void invokeCommand("cancel_custom_module_download", { moduleId: payload.moduleId });
            },
          },
        );
        noticeIds.set(payload.moduleId, noticeId);
        return;
      }
      const noticeId = noticeIds.get(payload.moduleId);
      if (noticeId === undefined) return;
      if (payload.kind === "progress" && payload.total && payload.total > 0) {
        updateStatusBarProgress(
          noticeId,
          Math.min(100, Math.round(((payload.downloaded ?? 0) / payload.total) * 100)),
        );
      } else if (
        payload.kind === "finished"
        || payload.kind === "cancelled"
        || payload.kind === "failed"
      ) {
        clearStatusBarNotice(noticeId);
        noticeIds.delete(payload.moduleId);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
      for (const noticeId of noticeIds.values()) clearStatusBarNotice(noticeId);
    };
  }, [clearStatusBarNotice, showStatusBarProgress, updateStatusBarProgress]);

  return { modules, loaded, reload };
}

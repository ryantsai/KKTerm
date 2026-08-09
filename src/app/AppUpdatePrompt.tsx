import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Download, ExternalLink } from "../lib/reicon";
import { useTranslation } from "react-i18next";
import {
  checkForAppUpdate,
  isAppUpdateDownloadCancelled,
  isDebugBuild,
  openReleaseDownloadPage,
  startAppUpdateDownload,
  type AppUpdate,
} from "../lib/appUpdates";
import { shouldRunStartupUpdateCheck } from "../lib/appUpdatesModel";
import { readLastUpdateCheckAt, recordUpdateCheckedNow } from "../lib/lastUpdateCheck";
import { invokeCommand, isTauriRuntime, openExternalUrl } from "../lib/tauri";
import { useWorkspaceStore } from "../store";
import { LegacyDialogActions } from "./ui/dialog";

export const CHECK_FOR_APP_UPDATES_EVENT = "kkterm:check-for-updates";
const APP_UPDATE_INSTALL_DELAY_MS = 3_000;

export function AppUpdatePrompt({
  settingsReady,
}: {
  settingsReady: boolean;
}) {
  const { t } = useTranslation();
  const autoUpdateChecksEnabled = useWorkspaceStore(
    (state) => state.generalSettings.autoUpdateChecksEnabled,
  );
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const showStatusBarProgress = useWorkspaceStore((state) => state.showStatusBarProgress);
  const updateStatusBarProgress = useWorkspaceStore((state) => state.updateStatusBarProgress);
  const clearStatusBarNotice = useWorkspaceStore((state) => state.clearStatusBarNotice);
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const startupCheckedRef = useRef(false);

  async function runUpdateCheck(source: "startup" | "manual") {
    if (!isTauriRuntime()) {
      if (source === "manual") {
        showStatusBarNotice(t("settings.updateChecksRequireRuntime"), {
          tone: "warning",
        });
      }
      return;
    }

    if (checking) {
      return;
    }

    setChecking(true);
    if (source === "manual") {
      showStatusBarNotice(t("settings.checkingForUpdates"));
    }

    try {
      const availableUpdate = await checkForAppUpdate();
      if (availableUpdate) {
        setUpdate(availableUpdate);
        return;
      }

      if (source === "manual") {
        showStatusBarNotice(t("settings.updateNoUpdates"), { tone: "success" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Startup checks fail silently to avoid alarming users with transient
      // network errors; the manual check shows the error in the status bar.
      if (source === "manual") {
        showStatusBarNotice(t("settings.updateCheckFailed", { message }), {
          tone: "error",
        });
      }
    } finally {
      recordUpdateCheckedNow();
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!settingsReady) {
      return;
    }

    if (
      !shouldRunStartupUpdateCheck({
        autoUpdateChecksEnabled,
        hasCheckedThisLaunch: startupCheckedRef.current,
        isTauriRuntime: isTauriRuntime(),
        lastCheckedAt: readLastUpdateCheckAt(),
      })
    ) {
      return;
    }

    startupCheckedRef.current = true;
    void (async () => {
      // Skip startup checks in debug builds so dev launches don't surface the
      // update prompt. Manual checks from Settings → About still run.
      if (await isDebugBuild()) {
        return;
      }
      await runUpdateCheck("startup");
    })();
    // runUpdateCheck is recreated each render; gate the startup check on settings readiness only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUpdateChecksEnabled, settingsReady]);

  useEffect(() => {
    if (!settingsReady || !isTauriRuntime()) {
      return;
    }
    void invokeCommand("take_portable_update_error")
      .then((message) => {
        if (message) {
          showStatusBarNotice(t("settings.updateDownloadFailed", { message }), {
            tone: "error",
          });
        }
      })
      .catch(() => undefined);
  }, [settingsReady, showStatusBarNotice, t]);

  useEffect(() => {
    const handleManualCheck = () => void runUpdateCheck("manual");
    window.addEventListener(CHECK_FOR_APP_UPDATES_EVENT, handleManualCheck);
    return () => {
      window.removeEventListener(CHECK_FOR_APP_UPDATES_EVENT, handleManualCheck);
    };
  });

  const renderedUpdateBody = useMemo(() => {
    if (!update?.body) {
      return "";
    }
    try {
      const html = marked.parse(update.body, { async: false }) as string;
      return DOMPurify.sanitize(html);
    } catch {
      return "";
    }
  }, [update?.body]);

  const canDownloadAndInstall =
    update?.installStrategy === "tauri-updater" || Boolean(update?.installer);
  const portableUpdate = update?.installStrategy === "portable-self-update";

  function handleUpdateNotesClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as Element | null)?.closest("a");
    if (!link) {
      return;
    }

    const href = link.getAttribute("href");
    const externalUrl = safeExternalUrl(href);
    event.preventDefault();
    event.stopPropagation();
    if (externalUrl) {
      void openExternalUrl(externalUrl);
    }
  }

  async function handleDownloadAndInstall() {
    if (!update || installing) {
      return;
    }

    setInstalling(true);
    let progressNoticeId: number | null = null;
    let cancelled = false;
    try {
      const task = await startAppUpdateDownload(update, (progress) => {
        if (progressNoticeId !== null) {
          updateStatusBarProgress(progressNoticeId, progress);
        }
      });
      progressNoticeId = showStatusBarProgress(t("settings.updateDownloading"), {
        progress: 0,
        ...(task.canCancel
          ? {
              cancelLabel: t("settings.updateDownloadCancel"),
              onCancel: () => {
                cancelled = true;
                void task.cancel();
              },
            }
          : {}),
      });
      setUpdate(null);
      await task.completion;
      if (cancelled) {
        return;
      }
      updateStatusBarProgress(progressNoticeId, 100);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, APP_UPDATE_INSTALL_DELAY_MS);
      });
      clearStatusBarNotice(progressNoticeId);
      await task.install();
    } catch (error) {
      if (progressNoticeId !== null) {
        clearStatusBarNotice(progressNoticeId);
      }
      if (cancelled || isAppUpdateDownloadCancelled(error)) {
        setInstalling(false);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("settings.updateDownloadFailed", { message }), {
        tone: "error",
      });
      setInstalling(false);
    }
  }

  if (!update) {
    return null;
  }

  return (
    <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
      <div
        aria-label={t("settings.updatePromptLabel")}
        aria-modal="true"
        className="connection-dialog settings-reset-dialog app-update-dialog"
        role="dialog"
      >
        <header className="connection-dialog-header compact">
          <div>
            <p className="panel-label">{t("settings.softwareUpdates")}</p>
            <h2>
              {portableUpdate
                ? t("settings.portableUpdateAvailableTitle")
                : t("settings.updateAvailableTitle")}
            </h2>
          </div>
        </header>
        <p className="field-hint">
          {t("settings.updateAvailableBody", {
            currentVersion: update.currentVersion,
            version: update.version,
          })}
        </p>
        {portableUpdate ? (
          <p className="field-hint">{t("settings.portableUpdateInstructions")}</p>
        ) : null}
        {renderedUpdateBody ? (
          <div
            className="app-update-notes"
            aria-label={t("settings.updateNotes")}
            dangerouslySetInnerHTML={{ __html: renderedUpdateBody }}
            onClick={handleUpdateNotesClick}
          />
        ) : null}
        <LegacyDialogActions
          extraLeft={<button
            className="toolbar-button"
            onClick={() => {
              void openReleaseDownloadPage(update);
              setUpdate(null);
            }}
            type="button"
          >
            <ExternalLink size={15} />
            {t("settings.updateOpenDownloadPage")}
          </button>}
          primary={canDownloadAndInstall ? (
            <button
              className="approve-button"
              disabled={installing}
              onClick={() => void handleDownloadAndInstall()}
              type="button"
            >
              <Download size={15} />
              {installing
                ? t("settings.updateDownloading")
                : portableUpdate
                  ? t("settings.portableUpdateDownload")
                  : t("settings.updateDownloadAndInstall")}
            </button>
          ) : null}
          cancel={<button
            className="toolbar-button"
            disabled={installing}
            onClick={() => setUpdate(null)}
            type="button"
          >
            {t("settings.updateLater")}
          </button>}
        />
      </div>
    </div>
  );
}

function safeExternalUrl(href: string | null) {
  if (!href) {
    return undefined;
  }
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

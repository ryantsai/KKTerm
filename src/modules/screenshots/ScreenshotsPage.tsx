// Screenshots Module page. Library-first: shows captured screenshots from the
// configured folder (newest first) in thumbnail / list / details views, with
// capture actions in the Module header. Captures also arrive from the tray
// menu and the global hotkeys through `captureBridge`; every mutation reports
// through the Status Bar per the app-wide notification invariant.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  FolderOpen,
  LayoutGrid,
  List as ListIcon,
  Monitor,
  RefreshCw,
  Rows3,
  Scan,
  Trash2,
} from "../../lib/reicon";
import {
  ModuleHeader,
  ModuleHeaderDivider,
  ModuleHeaderLead,
  ModuleHeaderSpacer,
  ModuleHeaderTitle,
  ModuleIconTile,
} from "../../app/ModuleHeader";
import { ScreenshotsModuleIcon } from "../../app/moduleIdentityIcons";
import {
  Actions,
  Btn,
  ConfirmSheet,
  DialogShell,
  Field,
  Sheet,
  TextInput,
} from "../../app/ui/dialog";
import { nativeMenuIcons } from "../../lib/nativeMenuIcons";
import { showNativeContextMenu } from "../../lib/nativeContextMenu";
import { invokeCommand, isTauriRuntime, type StoredScreenshot } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { performLibraryCapture, type ScreenshotCaptureMode } from "./captureBridge";
import { LibraryView, type ScreenshotsViewMode } from "./LibraryView";
import { ScreenshotViewer } from "./ScreenshotViewer";
import { useScreenshotsStore } from "./state";
import "./screenshots.css";

const VIEW_MODE_STORAGE_KEY = "kkterm.screenshotsViewMode.v1";

function readViewMode(): ScreenshotsViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === "list" || stored === "details" ? stored : "thumbnails";
  } catch {
    return "thumbnails";
  }
}

export function ScreenshotsPage({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const screenshots = useScreenshotsStore((state) => state.screenshots);
  const total = useScreenshotsStore((state) => state.total);
  const hasMore = useScreenshotsStore((state) => state.hasMore);
  const loaded = useScreenshotsStore((state) => state.loaded);
  const loading = useScreenshotsStore((state) => state.loading);
  const listError = useScreenshotsStore((state) => state.error);
  const captureInFlight = useScreenshotsStore((state) => state.captureInFlight);
  const refresh = useScreenshotsStore((state) => state.refresh);
  const loadMore = useScreenshotsStore((state) => state.loadMore);

  const [viewMode, setViewMode] = useState<ScreenshotsViewMode>(readViewMode);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<StoredScreenshot | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<StoredScreenshot | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  // Refresh on every activation so captures from other paths and external
  // folder changes show up; thumbnails are cached so re-listing stays cheap.
  useEffect(() => {
    if (active && isTauriRuntime()) {
      void refresh();
    }
  }, [active, refresh]);

  const viewerIndex = viewerId
    ? screenshots.findIndex((screenshot) => screenshot.id === viewerId)
    : -1;
  const viewerScreenshot = viewerIndex >= 0 ? screenshots[viewerIndex] : null;

  function changeViewMode(next: ScreenshotsViewMode) {
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // Persisting the view preference is best-effort.
    }
  }

  function notifyError(error: unknown) {
    showStatusBarNotice(
      error instanceof Error ? error.message : String(error),
      { tone: "error" },
    );
  }

  async function copyScreenshot(screenshot: StoredScreenshot) {
    try {
      await invokeCommand("copy_stored_screenshot_to_clipboard", { id: screenshot.id });
      showStatusBarNotice(t("screenshots.copied"), { tone: "success" });
    } catch (error) {
      notifyError(error);
    }
  }

  function openExternal(screenshot: StoredScreenshot) {
    invokeCommand("open_screenshot_file", { id: screenshot.id }).catch(notifyError);
  }

  function revealScreenshot(screenshot: StoredScreenshot) {
    invokeCommand("reveal_screenshot", { id: screenshot.id }).catch(notifyError);
  }

  function startRename(screenshot: StoredScreenshot) {
    setRenameTarget(screenshot);
    setRenameValue(screenshot.fileName);
  }

  async function submitRename() {
    if (!renameTarget) {
      return;
    }
    try {
      const updated = await invokeCommand("rename_screenshot", {
        id: renameTarget.id,
        newName: renameValue,
      });
      useScreenshotsStore.getState().replace(renameTarget.id, updated);
      if (viewerId === renameTarget.id) {
        setViewerId(updated.id);
      }
      setRenameTarget(null);
      showStatusBarNotice(t("screenshots.renamed"), { tone: "success" });
    } catch (error) {
      notifyError(error);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    try {
      await invokeCommand("delete_screenshot", { id: deleteTarget.id });
      useScreenshotsStore.getState().remove(deleteTarget.id);
      if (viewerId === deleteTarget.id) {
        setViewerId(null);
      }
      setDeleteTarget(null);
      showStatusBarNotice(t("screenshots.deleted"), { tone: "success" });
    } catch (error) {
      setDeleteTarget(null);
      notifyError(error);
    }
  }

  async function confirmClearAll() {
    try {
      await invokeCommand("clear_screenshots", undefined);
      useScreenshotsStore.getState().clear();
      setViewerId(null);
      setClearConfirmOpen(false);
      showStatusBarNotice(t("screenshots.cleared"), { tone: "success" });
    } catch (error) {
      setClearConfirmOpen(false);
      notifyError(error);
    }
  }

  function openItemMenu(screenshot: StoredScreenshot, x: number, y: number) {
    void showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("common.open"),
          action: () => setViewerId(screenshot.id),
        },
        {
          kind: "item",
          label: t("screenshots.menu.openExternal"),
          action: () => openExternal(screenshot),
        },
        {
          kind: "item",
          label: t("screenshots.menu.copy"),
          iconSvg: nativeMenuIcons.copy,
          action: () => void copyScreenshot(screenshot),
        },
        {
          kind: "item",
          label: t("screenshots.menu.reveal"),
          iconSvg: nativeMenuIcons.folderOpen,
          action: () => revealScreenshot(screenshot),
        },
        { kind: "separator" },
        {
          kind: "item",
          label: t("screenshots.menu.rename"),
          iconSvg: nativeMenuIcons.pencil,
          action: () => startRename(screenshot),
        },
        {
          kind: "item",
          label: t("common.delete"),
          iconSvg: nativeMenuIcons.trash,
          action: () => setDeleteTarget(screenshot),
        },
      ],
      { x, y },
    );
  }

  function capture(mode: ScreenshotCaptureMode) {
    void performLibraryCapture(mode, t);
  }

  const runtimeAvailable = isTauriRuntime();

  return (
    <section
      className="screenshots-page"
      aria-label={t("screenshots.title")}
      data-active={active ? "true" : "false"}
    >
      <ModuleHeader className="screenshots-module-header">
        <ModuleHeaderLead>
          <ModuleIconTile module="screenshots">
            <ScreenshotsModuleIcon size={16} aria-hidden="true" />
          </ModuleIconTile>
          <ModuleHeaderTitle as="span">{t("screenshots.title")}</ModuleHeaderTitle>
        </ModuleHeaderLead>
        <ModuleHeaderDivider />
        <span className="screenshots-count">
          {t("screenshots.totalCount", { count: total })}
        </span>
        <ModuleHeaderSpacer />
        <div
          className="screenshots-segmented"
          role="tablist"
          data-tutorial-id="screenshots.viewSwitch"
        >
          <button
            type="button"
            className={viewMode === "thumbnails" ? "active" : ""}
            onClick={() => changeViewMode("thumbnails")}
            title={t("screenshots.view.thumbnails")}
            aria-label={t("screenshots.view.thumbnails")}
            aria-selected={viewMode === "thumbnails"}
          >
            <LayoutGrid size={15} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            onClick={() => changeViewMode("list")}
            title={t("screenshots.view.list")}
            aria-label={t("screenshots.view.list")}
            aria-selected={viewMode === "list"}
          >
            <ListIcon size={15} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className={viewMode === "details" ? "active" : ""}
            onClick={() => changeViewMode("details")}
            title={t("screenshots.view.details")}
            aria-label={t("screenshots.view.details")}
            aria-selected={viewMode === "details"}
          >
            <Rows3 size={15} strokeWidth={1.9} />
          </button>
        </div>
        <button
          type="button"
          className="screenshots-button"
          onClick={() => void refresh()}
          disabled={loading || !runtimeAvailable}
        >
          <RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />
          {t("common.refresh")}
        </button>
        <button
          type="button"
          className="screenshots-button"
          onClick={() => invokeCommand("open_screenshots_folder", undefined).catch(notifyError)}
          disabled={!runtimeAvailable}
        >
          <FolderOpen size={14} strokeWidth={1.9} aria-hidden="true" />
          {t("screenshots.openFolder")}
        </button>
        <button
          type="button"
          className="screenshots-button"
          onClick={() => setClearConfirmOpen(true)}
          disabled={!runtimeAvailable || screenshots.length === 0}
        >
          <Trash2 size={14} strokeWidth={1.9} aria-hidden="true" />
          {t("screenshots.clearAll")}
        </button>
        <ModuleHeaderDivider />
        <button
          type="button"
          className="screenshots-button"
          data-tutorial-id="screenshots.captureWindow"
          onClick={() => capture("window")}
          disabled={captureInFlight || !runtimeAvailable}
        >
          <AppWindow size={14} strokeWidth={1.9} aria-hidden="true" />
          {t("screenshots.captureWindow")}
        </button>
        <button
          type="button"
          className="screenshots-button"
          data-tutorial-id="screenshots.captureFullscreen"
          onClick={() => capture("fullscreen")}
          disabled={captureInFlight || !runtimeAvailable}
        >
          <Monitor size={14} strokeWidth={1.9} aria-hidden="true" />
          {t("screenshots.captureFullscreen")}
        </button>
        <button
          type="button"
          className="screenshots-button primary"
          data-tutorial-id="screenshots.captureRegion"
          onClick={() => capture("region")}
          disabled={captureInFlight || !runtimeAvailable}
        >
          <Scan size={14} strokeWidth={2} aria-hidden="true" />
          {t("screenshots.captureRegion")}
        </button>
      </ModuleHeader>
      <div className="screenshots-content">
        {!runtimeAvailable ? (
          <p className="screenshots-hint">{t("screenshots.requiresRuntime")}</p>
        ) : listError ? (
          <p className="screenshots-hint">
            {t("screenshots.loadError", { message: listError })}
          </p>
        ) : screenshots.length === 0 && loaded && !loading ? (
          <div className="screenshots-empty">
            <ScreenshotsModuleIcon size={34} aria-hidden="true" />
            <h2>{t("screenshots.emptyTitle")}</h2>
            <p>{t("screenshots.emptyBody")}</p>
          </div>
        ) : (
          <>
            <LibraryView
              screenshots={screenshots}
              viewMode={viewMode}
              onOpen={(screenshot) => setViewerId(screenshot.id)}
              onItemMenu={openItemMenu}
            />
            {hasMore ? (
              <div className="screenshots-load-more">
                <button
                  type="button"
                  className="screenshots-button"
                  onClick={() => void loadMore()}
                  disabled={loading}
                >
                  {t("screenshots.loadMore")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {viewerScreenshot ? (
        <ScreenshotViewer
          screenshot={viewerScreenshot}
          hasPrevious={viewerIndex > 0}
          hasNext={viewerIndex < screenshots.length - 1}
          onNavigate={(direction) => {
            const next = screenshots[viewerIndex + direction];
            if (next) {
              setViewerId(next.id);
            }
          }}
          onCopy={() => void copyScreenshot(viewerScreenshot)}
          onOpenExternal={() => openExternal(viewerScreenshot)}
          onReveal={() => revealScreenshot(viewerScreenshot)}
          onDelete={() => setDeleteTarget(viewerScreenshot)}
          onClose={() => setViewerId(null)}
        />
      ) : null}
      {renameTarget ? (
        <DialogShell onBackdrop={() => setRenameTarget(null)}>
          <Sheet
            width={420}
            title={t("screenshots.renameTitle")}
            ariaLabel={t("screenshots.renameTitle")}
            footer={
              <Actions
                cancel={
                  <Btn onClick={() => setRenameTarget(null)}>{t("common.cancel")}</Btn>
                }
                primary={
                  <Btn kind="primary" onClick={() => void submitRename()}>
                    {t("screenshots.menu.rename")}
                  </Btn>
                }
              />
            }
          >
            <Field label={t("screenshots.renameLabel")}>
              <TextInput
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitRename();
                  }
                }}
              />
            </Field>
          </Sheet>
        </DialogShell>
      ) : null}
      {deleteTarget ? (
        <ConfirmSheet
          tone="danger"
          title={t("screenshots.deleteTitle")}
          message={t("screenshots.deleteMessage", { name: deleteTarget.fileName })}
          confirmLabel={t("common.delete")}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
      {clearConfirmOpen ? (
        <ConfirmSheet
          tone="danger"
          title={t("screenshots.clearAllTitle")}
          message={t("screenshots.clearAllMessage")}
          confirmLabel={t("screenshots.clearAllConfirm")}
          onConfirm={() => void confirmClearAll()}
          onCancel={() => setClearConfirmOpen(false)}
        />
      ) : null}
    </section>
  );
}

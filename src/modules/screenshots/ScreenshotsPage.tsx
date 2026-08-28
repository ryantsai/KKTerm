// Screenshots Module page. Library-first: thumbnail and details views share
// sorting, grouping, multi-selection, native item menus, and non-destructive
// batch operations. Capture entry points stay routed through captureBridge.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Clock,
  FolderOpen,
  LayoutGrid,
  Monitor,
  RefreshCw,
  Rows3,
  Scan,
  Square,
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
import {
  invokeCommand,
  isTauriRuntime,
  type CompletedVideoRecording,
  type StoredScreenshot,
  type VideoRecordingSession,
} from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { performScreenshotCapture, type ScreenshotCaptureMode } from "./captureBridge";
import {
  LibraryView,
  type ScreenshotSelectionModifiers,
  type ScreenshotsViewMode,
} from "./LibraryView";
import {
  ConvertScreenshotsDialog,
  ResizeScreenshotsDialog,
} from "./ScreenshotBatchDialogs";
import { ScreenshotEditor } from "./ScreenshotEditor";
import { VideoDependencyDialog } from "./VideoDependencyDialog";
import type { ScreenshotGroupBy } from "./libraryModel";
import { screenshotDragItems, startScreenshotDrag } from "./nativeScreenshotDrag";
import {
  useScreenshotsStore,
  type ScreenshotSortBy,
  type ScreenshotSortDirection,
} from "./state";
import {
  CAPTURE_DELAYS,
  readCaptureDelay,
  writeCaptureDelay,
} from "./captureDelay";
import "./screenshots.css";

const VIEW_MODE_STORAGE_KEY = "kkterm.screenshotsViewMode.v2";
const SORT_STORAGE_KEY = "kkterm.screenshotsSort.v1";
const GROUP_STORAGE_KEY = "kkterm.screenshotsGroup.v1";
const VideoEditor = lazy(() => import("./VideoEditor").then((module) => ({
  default: module.VideoEditor,
})));

function readViewMode(): ScreenshotsViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "details" ? "details" : "thumbnails";
  } catch {
    return "thumbnails";
  }
}

function readSort(): { by: ScreenshotSortBy; direction: ScreenshotSortDirection } {
  try {
    const parsed = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? "null") as {
      by?: string;
      direction?: string;
    } | null;
    return {
      by: parsed?.by === "name" || parsed?.by === "type" ? parsed.by : "date",
      direction: parsed?.direction === "asc" ? "asc" : "desc",
    };
  } catch {
    return { by: "date", direction: "desc" };
  }
}

function readGroupBy(): ScreenshotGroupBy {
  try {
    const value = localStorage.getItem(GROUP_STORAGE_KEY);
    return value === "name"
      || value === "date"
      || value === "type"
      || value === "size"
      || value === "dateCreated"
      || value === "dateModified"
      || value === "dateTaken"
      || value === "dimensions"
      ? value
      : "date";
  } catch {
    return "date";
  }
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Module preferences are best-effort.
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
  const editorRequestId = useScreenshotsStore((state) => state.editorRequestId);
  const ephemeralEditorQueue = useScreenshotsStore(
    (state) => state.ephemeralEditorQueue,
  );
  const refresh = useScreenshotsStore((state) => state.refresh);
  const loadMore = useScreenshotsStore((state) => state.loadMore);
  const setSortInStore = useScreenshotsStore((state) => state.setSort);

  const initialSort = useRef(readSort());
  const [viewMode, setViewMode] = useState<ScreenshotsViewMode>(readViewMode);
  const [sortBy, setSortBy] = useState<ScreenshotSortBy>(initialSort.current.by);
  const [sortDirection, setSortDirection] = useState<ScreenshotSortDirection>(
    initialSort.current.direction,
  );
  const [groupBy, setGroupBy] = useState<ScreenshotGroupBy>(readGroupBy);
  const [captureDelay, setCaptureDelay] = useState(readCaptureDelay);
  const [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [dependencyDialogOpen, setDependencyDialogOpen] = useState(false);
  const [recording, setRecording] = useState<VideoRecordingSession | null>(null);
  const [completedRecording, setCompletedRecording] = useState<CompletedVideoRecording | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const lastCompletedPathRef = useRef<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionAnchorRef = useRef<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [pendingEditorRequestId, setPendingEditorRequestId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<StoredScreenshot | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTargets, setDeleteTargets] = useState<StoredScreenshot[]>([]);
  const [resizeTargets, setResizeTargets] = useState<StoredScreenshot[]>([]);
  const [convertTargets, setConvertTargets] = useState<StoredScreenshot[]>([]);

  useEffect(() => {
    if (!active || !isTauriRuntime()) {
      return;
    }
    const store = useScreenshotsStore.getState();
    if (store.sortBy !== sortBy || store.sortDirection !== sortDirection) {
      void setSortInStore(sortBy, sortDirection);
    } else {
      void refresh();
    }
  }, [active, refresh, setSortInStore, sortBy, sortDirection]);

  useEffect(() => {
    const available = new Set(screenshots.map((screenshot) => screenshot.id));
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [screenshots]);

  useEffect(() => {
    if (!editorRequestId || !screenshots.some((screenshot) => screenshot.id === editorRequestId)) {
      return;
    }
    setSelectedIds(new Set([editorRequestId]));
    if (viewerId && viewerId !== editorRequestId) {
      setPendingEditorRequestId(editorRequestId);
    } else {
      setViewerId(editorRequestId);
    }
    useScreenshotsStore.getState().clearEditorRequest();
  }, [editorRequestId, screenshots, viewerId]);

  useEffect(() => {
    const next = ephemeralEditorQueue[0];
    if (!next || viewerId === next.id) {
      return;
    }
    if (viewerId) {
      setPendingEditorRequestId(next.id);
    } else {
      setViewerId(next.id);
    }
  }, [ephemeralEditorQueue, viewerId]);

  const selectedScreenshots = useMemo(
    () => screenshots.filter((screenshot) => selectedIds.has(screenshot.id)),
    [screenshots, selectedIds],
  );
  const viewerIndex = viewerId
    ? screenshots.findIndex((screenshot) => screenshot.id === viewerId)
    : -1;
  const ephemeralViewer = viewerId
    ? ephemeralEditorQueue.find((screenshot) => screenshot.id === viewerId) ?? null
    : null;
  const libraryViewer = viewerIndex >= 0 ? screenshots[viewerIndex] : null;
  const viewerScreenshot = ephemeralViewer
    ?? libraryViewer;
  const viewerVideo: CompletedVideoRecording | null = libraryViewer?.mediaType === "video"
    ? {
        path: libraryViewer.path,
        fileName: libraryViewer.fileName,
        startedAt: libraryViewer.takenAt ?? libraryViewer.capturedAt,
        durationMs: libraryViewer.durationMs ?? 0,
      }
    : null;

  const notifyError = useCallback((error: unknown) => {
    showStatusBarNotice(
      error instanceof Error ? error.message : String(error),
      { tone: "error" },
    );
  }, [showStatusBarNotice]);

  const handleRecordingCompleted = useCallback((completed: CompletedVideoRecording) => {
    setRecording(null);
    setCompletedRecording(completed);
    void useScreenshotsStore.getState().refresh();
    if (lastCompletedPathRef.current !== completed.path) {
      lastCompletedPathRef.current = completed.path;
      showStatusBarNotice(t("screenshots.video.recordingSaved", { name: completed.fileName }), {
        tone: "success",
      });
    }
  }, [showStatusBarNotice, t]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen<CompletedVideoRecording>(
      "kkterm://video-recording-completed",
      (event) => handleRecordingCompleted(event.payload),
    );
    return () => { void unlisten.then((dispose) => dispose()); };
  }, [handleRecordingCompleted]);

  function changeViewMode(next: ScreenshotsViewMode) {
    setViewMode(next);
    persist(VIEW_MODE_STORAGE_KEY, next);
  }

  function changeSortBy(next: ScreenshotSortBy) {
    setSortBy(next);
    persist(SORT_STORAGE_KEY, JSON.stringify({ by: next, direction: sortDirection }));
  }

  function toggleSortDirection() {
    const next = sortDirection === "asc" ? "desc" : "asc";
    setSortDirection(next);
    persist(SORT_STORAGE_KEY, JSON.stringify({ by: sortBy, direction: next }));
  }

  function changeGroupBy(next: ScreenshotGroupBy) {
    setGroupBy(next);
    persist(GROUP_STORAGE_KEY, next);
  }

  function changeCaptureDelay(next: number) {
    setCaptureDelay(next);
    writeCaptureDelay(next);
  }

  async function copyScreenshot(screenshot: StoredScreenshot) {
    try {
      await invokeCommand("copy_stored_screenshot_to_clipboard", { id: screenshot.id });
      showStatusBarNotice(t("screenshots.copied"), { tone: "success" });
    } catch (error) {
      notifyError(error);
    }
  }

  async function copyEditedScreenshot(dataUrl: string) {
    try {
      await invokeCommand("write_screenshot_data_url_to_clipboard", { request: { dataUrl } });
      showStatusBarNotice(t("screenshots.copied"), { tone: "success" });
    } catch (error) {
      notifyError(error);
    }
  }

  function dragScreenshot(screenshot: StoredScreenshot) {
    const items = screenshotDragItems(screenshots, screenshot, selectedIds);
    if (!selectedIds.has(screenshot.id)) {
      setSelectedIds(new Set([screenshot.id]));
      selectionAnchorRef.current = screenshot.id;
    }
    void startScreenshotDrag(items, screenshot).catch(notifyError);
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
      setSelectedIds((current) => {
        if (!current.has(renameTarget.id)) {
          return current;
        }
        const next = new Set(current);
        next.delete(renameTarget.id);
        next.add(updated.id);
        return next;
      });
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
    if (deleteTargets.length === 0) {
      return;
    }
    const ids = deleteTargets.map((screenshot) => screenshot.id);
    try {
      await invokeCommand("delete_screenshots", { ids });
      ids.forEach((id) => useScreenshotsStore.getState().remove(id));
      if (viewerId && ids.includes(viewerId)) {
        setViewerId(null);
      }
      setSelectedIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteTargets([]);
      showStatusBarNotice(
        ids.length === 1
          ? t("screenshots.deleted")
          : t("screenshots.batch.deleted", { count: ids.length }),
        { tone: "success" },
      );
    } catch (error) {
      setDeleteTargets([]);
      notifyError(error);
    }
  }

  function handleSelect(
    screenshot: StoredScreenshot,
    index: number,
    modifiers: ScreenshotSelectionModifiers,
  ) {
    setSelectedIds((current) => {
      if (modifiers.range && selectionAnchorRef.current) {
        const anchorIndex = screenshots.findIndex(
          (candidate) => candidate.id === selectionAnchorRef.current,
        );
        if (anchorIndex >= 0) {
          const next = modifiers.additive ? new Set(current) : new Set<string>();
          const [start, end] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
          screenshots.slice(start, end + 1).forEach((candidate) => next.add(candidate.id));
          return next;
        }
      }
      selectionAnchorRef.current = screenshot.id;
      if (modifiers.additive) {
        const next = new Set(current);
        if (next.has(screenshot.id)) {
          next.delete(screenshot.id);
        } else {
          next.add(screenshot.id);
        }
        return next;
      }
      return new Set([screenshot.id]);
    });
  }

  function openItemMenu(screenshot: StoredScreenshot, x: number, y: number) {
    const targets = selectedIds.has(screenshot.id) && selectedScreenshots.length > 0
      ? selectedScreenshots
      : [screenshot];
    if (!selectedIds.has(screenshot.id)) {
      setSelectedIds(new Set([screenshot.id]));
      selectionAnchorRef.current = screenshot.id;
    }
    const single = targets.length === 1 ? targets[0] : null;
    const imageTargets = targets.every((target) => target.mediaType === "image");
    void showNativeContextMenu(
      [
        ...(single ? [
          {
            kind: "item" as const,
            label: t("common.open"),
            iconSvg: nativeMenuIcons.scanLine,
            action: () => setViewerId(single.id),
          },
          {
            kind: "item" as const,
            label: t("screenshots.menu.openExternal"),
            iconSvg: nativeMenuIcons.arrowUp,
            action: () => openExternal(single),
          },
          ...(single.mediaType === "image" ? [{
            kind: "item" as const,
            label: t("screenshots.menu.copy"),
            iconSvg: nativeMenuIcons.copy,
            action: () => void copyScreenshot(single),
          }] : []),
          {
            kind: "item" as const,
            label: t("screenshots.menu.reveal"),
            iconSvg: nativeMenuIcons.folderOpen,
            action: () => revealScreenshot(single),
          },
          {
            kind: "item" as const,
            label: t("screenshots.menu.rename"),
            iconSvg: nativeMenuIcons.pencil,
            action: () => startRename(single),
          },
          { kind: "separator" as const },
        ] : []),
        ...(imageTargets ? [{
          kind: "item",
          label: t("screenshots.batch.resize", { count: targets.length }),
          iconSvg: nativeMenuIcons.columns,
          action: () => setResizeTargets(targets),
        } as const,
        {
          kind: "item",
          label: t("screenshots.batch.convert", { count: targets.length }),
          iconSvg: nativeMenuIcons.saveAs,
          action: () => setConvertTargets(targets),
        } as const,
        { kind: "separator" as const }] : []),
        {
          kind: "item",
          label: targets.length === 1
            ? t("common.delete")
            : t("screenshots.batch.delete", { count: targets.length }),
          iconSvg: nativeMenuIcons.trash,
          action: () => setDeleteTargets(targets),
        },
      ],
      { x, y },
    );
  }

  async function chooseMediaKind(next: "image" | "video") {
    if (next === "image") {
      setMediaKind("image");
      return;
    }
    try {
      const status = await invokeCommand("video_dependency_status", undefined);
      if (status.available) {
        setMediaKind("video");
      } else {
        setDependencyDialogOpen(true);
      }
    } catch (error) {
      notifyError(error);
    }
  }

  async function capture(mode: ScreenshotCaptureMode) {
    if (mediaKind === "image") {
      void performScreenshotCapture(mode, t, captureDelay, true);
      return;
    }
    setVideoBusy(true);
    try {
      if (captureDelay > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, captureDelay * 1000));
      }
      const session = await invokeCommand("start_video_recording", {
        request: {
          mode,
          useDirectx: useWorkspaceStore.getState().generalSettings.useDirectxScreenCapture,
          minimizeWindow: true,
        },
      });
      setRecording(session);
      showStatusBarNotice(t("screenshots.video.recordingStarted"), { tone: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("canceled")) notifyError(error);
    } finally {
      setVideoBusy(false);
    }
  }

  async function stopRecording() {
    setVideoBusy(true);
    try {
      const completed = await invokeCommand("stop_video_recording", undefined);
      handleRecordingCompleted(completed);
    } catch (error) {
      notifyError(error);
    } finally {
      setVideoBusy(false);
    }
  }

  function finishBatch(created: StoredScreenshot[]) {
    useScreenshotsStore.getState().addMany(created);
    setSelectedIds(new Set(created.map((screenshot) => screenshot.id)));
    setResizeTargets([]);
    setConvertTargets([]);
    showStatusBarNotice(t("screenshots.batch.created", { count: created.length }), {
      tone: "success",
    });
  }

  const runtimeAvailable = isTauriRuntime();
  const directionLabel = sortDirection === "asc"
    ? t("screenshots.sort.ascending")
    : t("screenshots.sort.descending");

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
          {selectedIds.size > 0
            ? t("screenshots.selectedCount", { count: selectedIds.size })
            : t("screenshots.totalCount", { count: total })}
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
            className={viewMode === "details" ? "active" : ""}
            onClick={() => changeViewMode("details")}
            title={t("screenshots.view.details")}
            aria-label={t("screenshots.view.details")}
            aria-selected={viewMode === "details"}
          >
            <Rows3 size={15} strokeWidth={1.9} />
          </button>
        </div>
        <label className="screenshots-toolbar-select">
          <span>{t("screenshots.sort.label")}</span>
          <select
            value={sortBy}
            onChange={(event) => changeSortBy(event.currentTarget.value as ScreenshotSortBy)}
          >
            <option value="name">{t("screenshots.details.name")}</option>
            <option value="date">{t("screenshots.sort.date")}</option>
            <option value="type">{t("screenshots.details.type")}</option>
          </select>
        </label>
        <button
          type="button"
          className="screenshots-icon-button"
          title={directionLabel}
          aria-label={directionLabel}
          onClick={toggleSortDirection}
        >
          {sortDirection === "asc"
            ? <ArrowUp size={14} aria-hidden="true" />
            : <ArrowDown size={14} aria-hidden="true" />}
        </button>
        <label className="screenshots-toolbar-select">
          <span>{t("screenshots.group.label")}</span>
          <select
            value={groupBy}
            onChange={(event) => changeGroupBy(event.currentTarget.value as ScreenshotGroupBy)}
          >
            <option value="none">{t("screenshots.group.none")}</option>
            <option value="name">{t("screenshots.details.name")}</option>
            <option value="date">{t("screenshots.sort.date")}</option>
            <option value="type">{t("screenshots.details.type")}</option>
            <option value="size">{t("screenshots.details.size")}</option>
            <option value="dateCreated">{t("screenshots.group.dateCreated")}</option>
            <option value="dateModified">{t("screenshots.group.dateModified")}</option>
            <option value="dateTaken">{t("screenshots.group.dateTaken")}</option>
            <option value="dimensions">{t("screenshots.details.dimensions")}</option>
          </select>
        </label>
        <button
          type="button"
          className="screenshots-icon-button"
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          onClick={() => void refresh()}
          disabled={loading || !runtimeAvailable}
        >
          <RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="screenshots-icon-button"
          title={t("screenshots.openFolder")}
          aria-label={t("screenshots.openFolder")}
          onClick={() => invokeCommand("open_screenshots_folder", undefined).catch(notifyError)}
          disabled={!runtimeAvailable}
        >
          <FolderOpen size={14} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <label className="screenshots-delay-select" title={t("screenshots.delay.label")}>
          <Clock size={14} aria-hidden="true" />
          <select
            aria-label={t("screenshots.delay.label")}
            value={captureDelay}
            disabled={captureInFlight}
            onChange={(event) => changeCaptureDelay(Number(event.currentTarget.value))}
          >
            {CAPTURE_DELAYS.map((delay) => (
              <option key={delay} value={delay}>
                {delay === 0
                  ? t("screenshots.delay.instant")
                  : t("screenshots.delay.seconds", { count: delay })}
              </option>
            ))}
          </select>
        </label>
        <label
          className="screenshots-delay-select screenshots-media-select"
          title={t("screenshots.mediaType")}
        >
          <select
            aria-label={t("screenshots.mediaType")}
            value={mediaKind}
            disabled={Boolean(recording) || videoBusy}
            onChange={(event) => void chooseMediaKind(
              event.currentTarget.value === "video" ? "video" : "image",
            )}
          >
            <option value="image">{t("screenshots.mediaImage")}</option>
            <option value="video">{t("screenshots.mediaVideo")}</option>
          </select>
        </label>
        {recording ? (
          <button
            type="button"
            className="screenshots-button screenshots-stop-button"
            disabled={videoBusy}
            onClick={() => void stopRecording()}
          >
            <Square size={12} fill="currentColor" aria-hidden="true" />
            {t("screenshots.video.stop")}
          </button>
        ) : null}
        <button
          type="button"
          className="screenshots-button"
          data-tutorial-id="screenshots.captureWindow"
          onClick={() => void capture("window")}
          disabled={captureInFlight || videoBusy || Boolean(recording) || !runtimeAvailable}
        >
          <AppWindow size={14} strokeWidth={1.9} aria-hidden="true" />
          <span className="screenshots-capture-label">{t("screenshots.captureWindow")}</span>
        </button>
        <button
          type="button"
          className="screenshots-button"
          data-tutorial-id="screenshots.captureFullscreen"
          onClick={() => void capture("fullscreen")}
          disabled={captureInFlight || videoBusy || Boolean(recording) || !runtimeAvailable}
        >
          <Monitor size={14} strokeWidth={1.9} aria-hidden="true" />
          <span className="screenshots-capture-label">{t("screenshots.captureFullscreen")}</span>
        </button>
        <button
          type="button"
          className="screenshots-button primary"
          data-tutorial-id="screenshots.captureRegion"
          onClick={() => void capture("region")}
          disabled={captureInFlight || videoBusy || Boolean(recording) || !runtimeAvailable}
        >
          <Scan size={14} strokeWidth={2} aria-hidden="true" />
          <span className="screenshots-capture-label">{t("screenshots.captureRegion")}</span>
        </button>
      </ModuleHeader>
      <div
        className="screenshots-content"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedIds(new Set());
          }
        }}
      >
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
              groupBy={groupBy}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onOpen={(screenshot) => setViewerId(screenshot.id)}
              onItemMenu={openItemMenu}
              onItemDragStart={dragScreenshot}
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
      {dependencyDialogOpen ? (
        <VideoDependencyDialog
          onClose={() => setDependencyDialogOpen(false)}
          onReady={() => {
            setDependencyDialogOpen(false);
            setMediaKind("video");
          }}
        />
      ) : null}
      {completedRecording || viewerVideo ? (
        <Suspense fallback={null}>
          <VideoEditor
            recording={completedRecording ?? viewerVideo!}
            onClose={() => {
              if (completedRecording) setCompletedRecording(null);
              else setViewerId(null);
            }}
            onSaved={(path) => {
              setCompletedRecording(null);
              setViewerId(null);
              void useScreenshotsStore.getState().refresh();
              showStatusBarNotice(t("screenshots.video.exportSaved", { path }), { tone: "success" });
            }}
            onError={notifyError}
          />
        </Suspense>
      ) : null}
      {viewerScreenshot && !viewerVideo ? (
        <ScreenshotEditor
          screenshot={viewerScreenshot}
          ephemeralSource={ephemeralViewer ?? undefined}
          hasPrevious={!ephemeralViewer && viewerIndex > 0}
          hasNext={!ephemeralViewer && viewerIndex < screenshots.length - 1}
          onNavigate={(direction) => {
            const next = screenshots[viewerIndex + direction];
            if (next) {
              setViewerId(next.id);
            }
          }}
          onCopyEdited={(dataUrl) => void copyEditedScreenshot(dataUrl)}
          onOpenExternal={libraryViewer
            ? () => openExternal(libraryViewer)
            : undefined}
          onReveal={libraryViewer
            ? () => revealScreenshot(libraryViewer)
            : undefined}
          onDelete={libraryViewer
            ? () => setDeleteTargets([libraryViewer])
            : undefined}
          onError={notifyError}
          onClose={() => {
            if (ephemeralViewer) {
              useScreenshotsStore.getState().finishEphemeralEditor(ephemeralViewer.id);
            }
            if (pendingEditorRequestId) {
              setViewerId(pendingEditorRequestId);
              setPendingEditorRequestId(null);
            } else {
              setViewerId(null);
            }
          }}
          requestedScreenshotId={ephemeralViewer ? null : pendingEditorRequestId}
          onRequestedScreenshotReady={(id) => {
            setPendingEditorRequestId(null);
            setSelectedIds(new Set([id]));
            setViewerId(id);
          }}
          onDraftChanged={(id, hasDraft) => {
            useScreenshotsStore.getState().setDraftState(id, hasDraft);
          }}
          onExported={(fileName) => {
            void useScreenshotsStore.getState().refresh();
            showStatusBarNotice(t("screenshots.captureSaved", { name: fileName }), {
              tone: "success",
            });
          }}
          onEphemeralSaved={(fileName) => {
            showStatusBarNotice(t("screenshots.captureSaved", { name: fileName }), {
              tone: "success",
            });
          }}
          onSaved={(saved, navigateDirection) => {
            const navigationTarget = navigateDirection
              ? screenshots[viewerIndex + navigateDirection]
              : null;
            const store = useScreenshotsStore.getState();
            if (libraryViewer) {
              store.replace(libraryViewer.id, saved);
            }
            setSelectedIds(new Set([navigationTarget?.id ?? saved.id]));
            setViewerId(navigationTarget?.id ?? saved.id);
            showStatusBarNotice(t("screenshots.captureSaved", { name: saved.fileName }), {
              tone: "success",
            });
          }}
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
                cancel={<Btn onClick={() => setRenameTarget(null)}>{t("common.cancel")}</Btn>}
                primary={
                  <Btn kind="primary" icon="pencil" onClick={() => void submitRename()}>
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
      {deleteTargets.length > 0 ? (
        <ConfirmSheet
          tone="danger"
          title={deleteTargets.length === 1
            ? t("screenshots.deleteTitle")
            : t("screenshots.batch.deleteTitle", { count: deleteTargets.length })}
          message={deleteTargets.length === 1
            ? t("screenshots.deleteMessage", { name: deleteTargets[0].fileName })
            : t("screenshots.batch.deleteMessage", { count: deleteTargets.length })}
          confirmLabel={t("common.delete")}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTargets([])}
        />
      ) : null}
      {resizeTargets.length > 0 ? (
        <ResizeScreenshotsDialog
          screenshots={resizeTargets}
          onComplete={finishBatch}
          onError={notifyError}
          onClose={() => setResizeTargets([])}
        />
      ) : null}
      {convertTargets.length > 0 ? (
        <ConvertScreenshotsDialog
          screenshots={convertTargets}
          onComplete={finishBatch}
          onError={notifyError}
          onClose={() => setConvertTargets([])}
        />
      ) : null}
    </section>
  );
}

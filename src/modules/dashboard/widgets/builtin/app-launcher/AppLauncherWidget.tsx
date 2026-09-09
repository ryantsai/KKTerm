import {
  ArrowDown,
  ArrowUp,
  AppWindow,
  FilePlus,
  FolderPlus,
  LayoutGrid,
  LayoutList,
  Plus,
  TableProperties,
  X,
} from "../../../../../lib/reicon";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  DragEvent,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { LegacyDialogActions } from "../../../../../app/ui/dialog";
import { selectAppLauncherFile, selectAppLauncherFolder, isTauriRuntime, invokeCommand, authorizeAppStorePath } from "../../../../../lib/tauri";
import { isWindowsPlatform } from "../../../../../lib/platform";
import { useWorkspaceStore } from "../../../../../store";
import { useDashboardStore } from "../../../state/dashboardStore";
import { showNativeContextMenu, type NativeContextMenuItem } from "../../../../../lib/nativeContextMenu";
import { nativeMenuIcons } from "../../../../../lib/nativeMenuIcons";
import type { DashboardWidgetInstance } from "../../../types";
import type {
  AppLauncherEntry,
  AppLauncherLaunchMode,
  AppLauncherSettings,
  AppLauncherSortField,
  AppLauncherSortState,
  AppLauncherViewMode,
  PreparedAppLauncherEntry,
} from "../../../../../types";
import {
  appLauncherNameFromPath,
  isRunnablePath,
  launchAppLauncherEntry,
  parseAppLauncherSettingsJson,
  prepareAppLauncherEntry,
  reorderAppLauncherEntries,
  serializeAppLauncherSettings,
} from "./storage";

type ReorderPlacement = "before" | "after";

type EntryDraft = {
  id: string;
  name: string;
  path: string;
  arguments: string;
  workingDirectory: string;
  iconDataUrl: string;
  createdAt: string;
};

type MenuState = {
  entry: AppLauncherEntry;
  prepared?: PreparedAppLauncherEntry;
  x: number;
  y: number;
};

type AddMenuState = {
  x: number;
  y: number;
};

type ReorderTarget = {
  id: string;
  placement: ReorderPlacement;
};

type PointerReorderState = {
  entryId: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
};

const APP_LAUNCHER_VIEW_MODES: AppLauncherViewMode[] = ["icons", "list", "details"];
const APP_LAUNCHER_DETAILS_COLUMNS: AppLauncherSortField[] = [
  "name",
  "type",
  "size",
  "modified",
  "path",
];

export function AppLauncherWidget({ instance }: { instance: DashboardWidgetInstance }) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const updateInstance = useDashboardStore((state) => state.updateInstance);
  const editMode = useDashboardStore((state) => state.editMode);
  const [settings, setSettings] = useState<AppLauncherSettings>(() =>
    parseAppLauncherSettingsJson(instance.settingsValuesJson),
  );
  const [preparedById, setPreparedById] = useState<Record<string, PreparedAppLauncherEntry>>({});
  const [dialogDraft, setDialogDraft] = useState<EntryDraft | null>(null);
  const [addMenuState, setAddMenuState] = useState<AddMenuState | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const macAppStoreBuild = useWorkspaceStore((state) => state.appModeInfo.macAppStoreBuild === true);
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const draggedEntryIdRef = useRef<string | null>(null);
  const pointerReorderRef = useRef<PointerReorderState | null>(null);
  const suppressNextLaunchRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSettings(parseAppLauncherSettingsJson(instance.settingsValuesJson));
  }, [instance.settingsValuesJson]);

  useEffect(() => {
    if (editMode) {
      return;
    }
    draggedEntryIdRef.current = null;
    setDraggedEntryId(null);
    setReorderTarget(null);
  }, [editMode]);

  useEffect(() => {
    let disposed = false;
    async function refreshEntries() {
      const pairs = await Promise.all(
        settings.entries.map(async (entry) => {
          try {
            return [entry.id, await prepareAppLauncherEntry(entry.path)] as const;
          } catch {
            return [
              entry.id,
              {
                name: entry.name,
                path: entry.path,
                exists: false,
                runnable: isRunnablePath(entry.path),
                iconDataUrl: entry.iconDataUrl ?? null,
                fileKind: "missing",
                extension: extensionFromPath(entry.path),
                sizeBytes: null,
                modifiedAtUnixMs: null,
              },
            ] as const;
          }
        }),
      );
      if (!disposed) {
        setPreparedById(Object.fromEntries(pairs));
      }
    }
    void refreshEntries();
    return () => {
      disposed = true;
    };
  }, [settings.entries]);

  useEffect(() => {
    if (!addMenuState) {
      return;
    }
    function closeMenu(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && addMenuRef.current?.contains(target)) {
        return;
      }
      setAddMenuState(null);
    }
    function closeMenuOnKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setAddMenuState(null);
      }
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeMenuOnKey);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeMenuOnKey);
    };
  }, [addMenuState]);

  useLayoutEffect(() => {
    const node = addMenuRef.current;
    if (!node || !addMenuState) {
      return;
    }
    const bounds = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(addMenuState.x, window.innerWidth - bounds.width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(addMenuState.y, window.innerHeight - bounds.height - 8))}px`;
  }, [addMenuState]);

  function openAddMenuFromElement(element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    setAddMenuState({ x: bounds.left, y: bounds.bottom + 4 });
  }

  async function addAppEntry() {
    let selectedPath: string | null = null;
    if (isTauriRuntime()) {
      try {
        selectedPath = await selectAppLauncherFile({
          allFilesFilterName: t("appLauncher.allFilesFilter"),
          filterName: t("appLauncher.fileFilter"),
          kind: "app",
          title: t("appLauncher.selectAppTitle"),
        });
      } catch (error) {
        showStatusBarNotice(
          t("appLauncher.selectError", { message: errorMessage(error) }),
          { tone: "error" },
        );
        openDraftDialog();
        return;
      }
      if (!selectedPath) {
        return;
      }
    }

    await saveSelectedPath(selectedPath);
  }

  async function addFileEntry() {
    let selectedPath: string | null = null;
    if (isTauriRuntime()) {
      try {
        selectedPath = await selectAppLauncherFile({
          allFilesFilterName: t("appLauncher.allFilesFilter"),
          filterName: t("appLauncher.fileFilter"),
          kind: "file",
          title: t("appLauncher.selectFileTitle"),
        });
      } catch (error) {
        showStatusBarNotice(
          t("appLauncher.selectError", { message: errorMessage(error) }),
          { tone: "error" },
        );
        openDraftDialog();
        return;
      }
      if (!selectedPath) {
        return;
      }
    }

    await saveSelectedPath(selectedPath);
  }

  async function saveSelectedPath(selectedPath: string | null) {
    try {
      const prepared = selectedPath ? await prepareAppLauncherEntry(selectedPath) : undefined;
      if (selectedPath) {
        await saveDraft(createDraft(prepared?.path ?? selectedPath, prepared));
        return;
      }
      openDraftDialog();
    } catch (error) {
      showStatusBarNotice(
        t("appLauncher.selectError", { message: errorMessage(error) }),
        { tone: "error" },
      );
      openDraftDialog(selectedPath ?? "");
    }
  }

  async function addFolderEntry() {
    let selectedPath: string | null = null;
    if (isTauriRuntime()) {
      try {
        selectedPath = await selectAppLauncherFolder({
          title: t("appLauncher.selectFolderTitle"),
        });
      } catch (error) {
        showStatusBarNotice(
          t("appLauncher.selectError", { message: errorMessage(error) }),
          { tone: "error" },
        );
        openDraftDialog();
        return;
      }
      if (!selectedPath) {
        return;
      }
    }

    await saveSelectedPath(selectedPath);
  }

  function openDraftDialog(path = "", prepared?: PreparedAppLauncherEntry) {
    setDialogDraft(createDraft(path, prepared));
  }

  function createDraft(path: string, prepared?: PreparedAppLauncherEntry): EntryDraft {
    const now = new Date().toISOString();
    return {
      id: `app-launcher-${Date.now()}`,
      name: prepared?.name ?? "",
      path,
      arguments: "",
      workingDirectory: "",
      iconDataUrl: prepared?.iconDataUrl ?? "",
      createdAt: now,
    };
  }

  function editEntry(entry: AppLauncherEntry) {
    setDialogDraft({
      id: entry.id,
      name: entry.name,
      path: entry.path,
      arguments: entry.arguments ?? "",
      workingDirectory: entry.workingDirectory ?? "",
      iconDataUrl: entry.iconDataUrl ?? "",
      createdAt: entry.createdAt,
    });
  }

  async function saveDraft(draft: EntryDraft) {
    let authorizedPath: string | null;
    try {
      authorizedPath = await authorizeAppStorePath(draft.path.trim());
    } catch (error) {
      showStatusBarNotice(t("appLauncher.selectError", { message: errorMessage(error) }), { tone: "error" });
      return;
    }
    if (!authorizedPath) return;
    const now = new Date().toISOString();
    const nextEntry: AppLauncherEntry = {
      id: draft.id,
      name: draft.name.trim(),
      path: authorizedPath,
      arguments: optionalText(draft.arguments),
      workingDirectory: optionalText(draft.workingDirectory),
      iconDataUrl: optionalText(draft.iconDataUrl),
      railPinned: false,
      createdAt: draft.createdAt,
      updatedAt: now,
    };
    const exists = settings.entries.some((entry) => entry.id === draft.id);
    const nextSettings = {
      ...settings,
      entries: exists
        ? settings.entries.map((entry) => (entry.id === draft.id ? nextEntry : entry))
        : [...settings.entries, nextEntry],
    };
    try {
      await saveSettings(nextSettings);
      setDialogDraft(null);
      showStatusBarNotice(t("appLauncher.savedStatus", { name: nextEntry.name }), {
        tone: "success",
      });
    } catch (error) {
      showStatusBarNotice(
        t("appLauncher.saveError", { message: errorMessage(error) }),
        { tone: "error" },
      );
    }
  }

  async function removeEntry(entry: AppLauncherEntry) {
    try {
      await saveSettings({
        ...settings,
        entries: settings.entries.filter((candidate) => candidate.id !== entry.id),
      });
      showStatusBarNotice(t("appLauncher.removedStatus", { name: entry.name }), {
        tone: "info",
      });
    } catch (error) {
      showStatusBarNotice(
        t("appLauncher.saveError", { message: errorMessage(error) }),
        { tone: "error" },
      );
    }
  }

  async function saveDroppedPaths(paths: string[]) {
    const uniquePaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    if (uniquePaths.length === 0) {
      return;
    }

    try {
      const now = new Date().toISOString();
      const droppedEntries = await Promise.all(
        uniquePaths.map(async (path, index) => {
          let prepared: PreparedAppLauncherEntry | undefined;
          try {
            prepared = await prepareAppLauncherEntry(path);
          } catch {
            prepared = undefined;
          }
          const entryPath = prepared?.path ?? path;
          const entryName = prepared?.name ?? appLauncherNameFromPath(entryPath);
          return {
            id: `app-launcher-${Date.now()}-${index}`,
            name: entryName,
            path: entryPath,
            arguments: null,
            workingDirectory: null,
            iconDataUrl: prepared?.iconDataUrl ?? null,
            railPinned: false,
            createdAt: now,
            updatedAt: now,
          } satisfies AppLauncherEntry;
        }),
      );
      await saveSettings({ ...settings, entries: [...settings.entries, ...droppedEntries] });
      const lastEntry = droppedEntries[droppedEntries.length - 1];
      if (lastEntry) {
        showStatusBarNotice(t("appLauncher.savedStatus", { name: lastEntry.name }), {
          tone: "success",
        });
      }
    } catch (error) {
      showStatusBarNotice(
        t("appLauncher.saveError", { message: errorMessage(error) }),
        { tone: "error" },
      );
    }
  }

  async function saveReorderedEntry(
    draggedId: string,
    targetId: string,
    placement: ReorderPlacement,
  ) {
    const nextEntries = reorderAppLauncherEntries(settings.entries, draggedId, targetId, placement);
    if (nextEntries === settings.entries) {
      return;
    }
    try {
      await saveSettings({ ...settings, entries: nextEntries });
    } catch (error) {
      showStatusBarNotice(
        t("appLauncher.saveError", { message: errorMessage(error) }),
        { tone: "error" },
      );
    }
  }

  function handleEntryPointerDown(event: ReactPointerEvent<HTMLDivElement>, entryId: string) {
    if (
      !editMode ||
      settings.viewMode !== "icons" ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest(".app-launcher-tile-remove")
    ) {
      return;
    }
    pointerReorderRef.current = {
      entryId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleEntryPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pointerState = pointerReorderRef.current;
    if (!editMode || !pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const moved = Math.abs(event.clientX - pointerState.startX) + Math.abs(event.clientY - pointerState.startY);
    if (!pointerState.active && moved < 4) {
      return;
    }
    if (!pointerState.active) {
      pointerState.active = true;
      suppressNextLaunchRef.current = true;
      draggedEntryIdRef.current = pointerState.entryId;
      setDraggedEntryId(pointerState.entryId);
    }

    const targetTile = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>(".app-launcher-tile[data-app-launcher-entry-id]");
    const targetId = targetTile?.dataset.appLauncherEntryId;
    if (!targetTile || !targetId || targetId === pointerState.entryId) {
      setReorderTarget(null);
      return;
    }
    setReorderTarget({
      id: targetId,
      placement: reorderPlacementFromPoint(event.clientX, event.clientY, targetTile, settings.viewMode),
    });
  }

  function finishPointerReorder(event: ReactPointerEvent<HTMLDivElement>) {
    const pointerState = pointerReorderRef.current;
    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }
    pointerReorderRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const target = reorderTarget;
    setReorderTarget(null);
    draggedEntryIdRef.current = null;
    setDraggedEntryId(null);
    window.setTimeout(() => {
      suppressNextLaunchRef.current = false;
    }, 0);
    if (!editMode || !pointerState.active || !target || target.id === pointerState.entryId) {
      return;
    }
    event.preventDefault();
    void saveReorderedEntry(pointerState.entryId, target.id, target.placement);
  }

  function handleBrowserDragOver(event: DragEvent<HTMLDivElement>) {
    // During dragover WebKit protects file contents; inspect types so Finder
    // folder drops are accepted before the drop event exposes the payload.
    const hasPayload = macAppStoreBuild
      ? Array.from(event.dataTransfer.types).includes("Files")
      : hasBrowserDropPayload(event);
    if (draggedEntryId || (isTauriRuntime() && !macAppStoreBuild) || !hasPayload) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTarget(true);
  }

  function handleBrowserDrop(event: DragEvent<HTMLDivElement>) {
    if (draggedEntryId || (isTauriRuntime() && !macAppStoreBuild)) {
      return;
    }
    event.preventDefault();
    setIsDropTarget(false);
    if (macAppStoreBuild) {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      void invokeCommand("app_store_file_access", { request: { action: "drop", title: t("appLauncher.grantAccess") } })
        .then(saveDroppedPaths)
        .catch((error: unknown) => showStatusBarNotice(
          t("appLauncher.selectError", { message: errorMessage(error) }), { tone: "error" },
        ));
      return;
    }
    const paths = pathsFromBrowserDrop(event);
    void saveDroppedPaths(paths);
  }

  async function saveSettings(nextSettings: AppLauncherSettings) {
    const normalized = parseAppLauncherSettingsJson(serializeAppLauncherSettings(nextSettings));
    setSettings(normalized);
    await updateInstance(instance.id, {
      settingsValuesJson: serializeAppLauncherSettings(normalized),
    });
  }

  async function saveViewMode(viewMode: AppLauncherViewMode) {
    if (viewMode === settings.viewMode) {
      return;
    }
    try {
      await saveSettings({ ...settings, viewMode });
    } catch (error) {
      showStatusBarNotice(
        t("appLauncher.saveError", { message: errorMessage(error) }),
        { tone: "error" },
      );
    }
  }

  async function saveSort(field: AppLauncherSortField) {
    if (settings.viewMode === "icons") {
      return;
    }
    const sortKey = settings.viewMode === "list" ? "listSort" : "detailsSort";
    const currentSort = settings[sortKey];
    const nextSort: AppLauncherSortState = {
      field,
      direction:
        currentSort.field === field && currentSort.direction === "asc" ? "desc" : "asc",
    };
    try {
      await saveSettings({ ...settings, [sortKey]: nextSort });
    } catch (error) {
      showStatusBarNotice(
        t("appLauncher.saveError", { message: errorMessage(error) }),
        { tone: "error" },
      );
    }
  }

  const sortedEntries = useMemo(
    () => sortedAppLauncherEntries(settings.entries, settings, preparedById),
    [preparedById, settings],
  );

  async function launch(entry: AppLauncherEntry, mode: AppLauncherLaunchMode) {
    if (editMode || suppressNextLaunchRef.current) {
      return;
    }
    try {
      if (!await launchAppLauncherEntry(entry, mode)) return;
      showStatusBarNotice(t("appLauncher.launchStatus", { name: entry.name }), {
        tone: "success",
      });
    } catch (error) {
      showStatusBarNotice(
        t("appLauncher.launchError", { message: errorMessage(error) }),
        { tone: "error" },
      );
    }
  }

  function openEntryContextMenu(state: MenuState) {
    const runnable = state.prepared?.runnable ?? isRunnablePath(state.entry.path);
    const items: NativeContextMenuItem[] = [
      {
        kind: "item",
        label: t("appLauncher.runNormal"),
        iconSvg: nativeMenuIcons.play,
        action: () => void launch(state.entry, "normal"),
      },
    ];
    if (isWindowsPlatform()) {
      items.push(
        {
          kind: "item",
          label: t("appLauncher.runAdmin"),
          iconSvg: nativeMenuIcons.shield,
          disabled: !runnable,
          action: () => void launch(state.entry, "admin"),
        },
        {
          kind: "item",
          label: t("appLauncher.runAsUser"),
          iconSvg: nativeMenuIcons.userRound,
          disabled: !runnable,
          action: () => void launch(state.entry, "differentUser"),
        },
      );
    }
    items.push(
      {
        kind: "item",
        label: t("appLauncher.openFolder"),
        iconSvg: nativeMenuIcons.folderOpen,
        action: () => void launch(state.entry, "openFolder"),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: t("appLauncher.edit"),
        iconSvg: nativeMenuIcons.pencil,
        action: () => editEntry(state.entry),
      },
      {
        kind: "item",
        label: t("appLauncher.remove"),
        iconSvg: nativeMenuIcons.trash,
        action: () => void removeEntry(state.entry),
      },
    );
    void showNativeContextMenu(items, { x: state.x, y: state.y });
  }

  return (
    <div
      className={`dashboard-widget-body app-launcher-widget app-launcher-widget-${settings.viewMode}${isDropTarget ? " is-drop-target" : ""}${editMode && settings.viewMode === "icons" ? " is-managing" : ""}${addMenuState ? " is-adding" : ""}`}
      onDragLeave={() => setIsDropTarget(false)}
      onDragOver={handleBrowserDragOver}
      onDrop={handleBrowserDrop}
      ref={rootRef}
    >
      <div className="app-launcher-widget-toolbar">
        <AppLauncherViewModeControl
          onChange={(viewMode) => void saveViewMode(viewMode)}
          value={settings.viewMode}
        />
        <button
          className="secondary-button app-launcher-add"
          aria-label={t("common.add")}
          onClick={(event) => openAddMenuFromElement(event.currentTarget)}
          type="button"
        >
          <Plus size={14} />
        </button>
      </div>
      {settings.entries.length > 0 ? (
        <div
          className="app-launcher-tile-grid"
          aria-label={t("appLauncher.entriesLabel")}
          data-view-mode={settings.viewMode}
        >
          {settings.viewMode === "list" ? (
            <AppLauncherSortableHeader
              fields={["name"]}
              onSort={(field) => void saveSort(field)}
              sort={settings.listSort}
              viewMode={settings.viewMode}
            />
          ) : null}
          {settings.viewMode === "details" ? (
            <AppLauncherSortableHeader
              fields={APP_LAUNCHER_DETAILS_COLUMNS}
              onSort={(field) => void saveSort(field)}
              sort={settings.detailsSort}
              viewMode={settings.viewMode}
            />
          ) : null}
          {sortedEntries.map((entry) => (
            <AppLauncherTile
              entry={entry}
              editMode={editMode}
              key={entry.id}
              isDragging={draggedEntryId === entry.id}
              reorderPlacement={
                reorderTarget?.id === entry.id && draggedEntryId !== entry.id
                  ? reorderTarget.placement
                  : null
              }
              onLaunch={launch}
              onMenu={openEntryContextMenu}
              onPointerCancelEntry={finishPointerReorder}
              onPointerDownEntry={handleEntryPointerDown}
              onPointerMoveEntry={handleEntryPointerMove}
              onPointerUpEntry={finishPointerReorder}
              onRemove={removeEntry}
              prepared={preparedById[entry.id]}
              showFileExtensions={settings.showFileExtensions}
              viewMode={settings.viewMode}
            />
          ))}
        </div>
      ) : (
        <div className="app-launcher-widget-empty">
          <AppWindow size={24} />
          <h4>{t("appLauncher.emptyTitle")}</h4>
          <p>{t("appLauncher.emptyHint")}</p>
        </div>
      )}
      {dialogDraft
        ? createAppLauncherPortal(
            <AppLauncherDialog
              draft={dialogDraft}
              onClose={() => setDialogDraft(null)}
              onSave={saveDraft}
              onUpdate={setDialogDraft}
            />,
          )
        : null}
      {addMenuState
        ? createAppLauncherPortal(
            <AppLauncherAddMenu
              menuRef={addMenuRef}
              onAddApp={addAppEntry}
              onAddFile={addFileEntry}
              onAddFolder={addFolderEntry}
              onClose={() => setAddMenuState(null)}
            />,
          )
        : null}
    </div>
  );
}

function reorderPlacementFromPoint(
  clientX: number,
  clientY: number,
  target: HTMLElement,
  viewMode: AppLauncherViewMode,
): ReorderPlacement {
  const bounds = target.getBoundingClientRect();
  if (viewMode !== "icons") {
    return clientY >= bounds.top + bounds.height / 2 ? "after" : "before";
  }
  return clientX >= bounds.left + bounds.width / 2 ? "after" : "before";
}

function AppLauncherViewModeControl({
  onChange,
  value,
}: {
  onChange: (viewMode: AppLauncherViewMode) => void;
  value: AppLauncherViewMode;
}) {
  const { t } = useTranslation();
  return (
    <div className="app-launcher-view-mode" aria-label={t("appLauncher.viewModeLabel")} role="group">
      {APP_LAUNCHER_VIEW_MODES.map((viewMode) => (
        <button
          aria-label={viewModeLabel(t, viewMode)}
          aria-pressed={value === viewMode}
          className={value === viewMode ? "active" : ""}
          key={viewMode}
          onClick={() => onChange(viewMode)}
          type="button"
        >
          {viewMode === "icons" ? <LayoutGrid size={14} /> : null}
          {viewMode === "list" ? <LayoutList size={14} /> : null}
          {viewMode === "details" ? <TableProperties size={14} /> : null}
        </button>
      ))}
    </div>
  );
}

function viewModeLabel(
  t: ReturnType<typeof useTranslation>["t"],
  viewMode: AppLauncherViewMode,
) {
  if (viewMode === "list") {
    return t("appLauncher.listView");
  }
  if (viewMode === "details") {
    return t("appLauncher.detailsView");
  }
  return t("appLauncher.iconView");
}

function AppLauncherSortableHeader({
  fields,
  onSort,
  sort,
  viewMode,
}: {
  fields: AppLauncherSortField[];
  onSort: (field: AppLauncherSortField) => void;
  sort: AppLauncherSortState;
  viewMode: "list" | "details";
}) {
  const { t } = useTranslation();
  return (
    <div className={`app-launcher-${viewMode}-header app-launcher-sort-header`}>
      {fields.map((field) => (
        <button
          aria-label={sortHeaderLabel(t, field)}
          className={sort.field === field ? "active" : ""}
          key={field}
          onClick={() => onSort(field)}
          type="button"
        >
          <span>{sortHeaderLabel(t, field)}</span>
          {sort.field === field ? (
            <span className="app-launcher-sort-indicator" aria-hidden="true">
              {sort.direction === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function sortHeaderLabel(
  t: ReturnType<typeof useTranslation>["t"],
  field: AppLauncherSortField,
) {
  if (field === "path") {
    return t("appLauncher.detailsPathColumn");
  }
  if (field === "type") {
    return t("appLauncher.detailsTypeColumn");
  }
  if (field === "size") {
    return t("appLauncher.detailsSizeColumn");
  }
  if (field === "modified") {
    return t("appLauncher.detailsModifiedColumn");
  }
  return t("appLauncher.detailsNameColumn");
}

function AppLauncherTile({
  entry,
  editMode,
  isDragging,
  reorderPlacement,
  onLaunch,
  onMenu,
  onPointerCancelEntry,
  onPointerDownEntry,
  onPointerMoveEntry,
  onPointerUpEntry,
  onRemove,
  prepared,
  showFileExtensions,
  viewMode,
}: {
  entry: AppLauncherEntry;
  editMode: boolean;
  isDragging: boolean;
  reorderPlacement: ReorderPlacement | null;
  prepared?: PreparedAppLauncherEntry;
  showFileExtensions: boolean;
  viewMode: AppLauncherViewMode;
  onLaunch: (entry: AppLauncherEntry, mode: AppLauncherLaunchMode) => Promise<void>;
  onMenu: (state: MenuState) => void;
  onPointerCancelEntry: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerDownEntry: (event: ReactPointerEvent<HTMLDivElement>, entryId: string) => void;
  onPointerMoveEntry: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUpEntry: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onRemove: (entry: AppLauncherEntry) => Promise<void>;
}) {
  const { t } = useTranslation();
  const missing = prepared?.exists === false;
  const iconDataUrl = prepared?.iconDataUrl ?? entry.iconDataUrl;

  function openMenuFromElement(element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    onMenu({ entry, prepared, x: bounds.left, y: bounds.bottom + 4 });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (editMode) {
      return;
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      openMenuFromElement(event.currentTarget);
    }
  }

  return (
    <div
      aria-label={editMode ? entry.name : undefined}
      className={`app-launcher-tile ${missing ? "missing" : ""}${isDragging ? " is-reordering" : ""}${reorderPlacement ? ` is-reorder-${reorderPlacement}` : ""}`}
      data-app-launcher-entry-id={entry.id}
      draggable={false}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!editMode) {
          onMenu({ entry, prepared, x: event.clientX, y: event.clientY });
        }
      }}
      onPointerCancel={onPointerCancelEntry}
      onPointerDown={(event) => onPointerDownEntry(event, entry.id)}
      onPointerMove={onPointerMoveEntry}
      onPointerUp={onPointerUpEntry}
    >
      {editMode ? (
        <button
          className="app-launcher-tile-remove"
          aria-label={t("appLauncher.remove")}
          draggable={false}
          onClick={(event) => {
            event.stopPropagation();
            void onRemove(entry);
          }}
          type="button"
        >
          <X size={12} />
        </button>
      ) : null}
      {editMode ? (
        <div className="app-launcher-tile-launch" aria-hidden="true">
          <AppLauncherTileContent
            entry={entry}
            iconDataUrl={iconDataUrl}
            prepared={prepared}
            showFileExtensions={showFileExtensions}
            viewMode={viewMode}
          />
        </div>
      ) : (
        <button
          className="app-launcher-tile-launch"
          aria-label={t("appLauncher.launchApp", { name: entry.name })}
          onClick={() => void onLaunch(entry, "normal")}
          onKeyDown={handleKeyDown}
          type="button"
        >
          <AppLauncherTileContent
            entry={entry}
            iconDataUrl={iconDataUrl}
            prepared={prepared}
            showFileExtensions={showFileExtensions}
            viewMode={viewMode}
          />
        </button>
      )}
    </div>
  );
}

function AppLauncherTileContent({
  entry,
  iconDataUrl,
  prepared,
  showFileExtensions,
  viewMode,
}: {
  entry: AppLauncherEntry;
  iconDataUrl: string | null | undefined;
  prepared?: PreparedAppLauncherEntry;
  showFileExtensions: boolean;
  viewMode: AppLauncherViewMode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <span className="app-launcher-tile-icon" aria-hidden="true">
        {iconDataUrl ? (
          <img alt="" draggable={false} src={iconDataUrl} />
        ) : (
          <AppWindow size={20} />
        )}
      </span>
      <span className="app-launcher-tile-label">
        {entryDisplayName(entry, prepared, showFileExtensions)}
      </span>
      {viewMode === "details" ? (
        <>
          <span className="app-launcher-tile-type">{fileTypeLabel(t, entry, prepared)}</span>
          <span className="app-launcher-tile-size">{formatFileSize(t, prepared?.sizeBytes)}</span>
          <span className="app-launcher-tile-modified">
            {formatModifiedTime(t, prepared?.modifiedAtUnixMs)}
          </span>
          <span className="app-launcher-tile-path">{entry.path}</span>
        </>
      ) : null}
    </>
  );
}

function AppLauncherDialog({
  draft,
  onClose,
  onSave,
  onUpdate,
}: {
  draft: EntryDraft;
  onClose: () => void;
  onSave: (draft: EntryDraft) => Promise<void>;
  onUpdate: (draft: EntryDraft) => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const canSave = draft.name.trim() && draft.path.trim();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave || saving) {
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop app-launcher-dialog-backdrop">
      <form className="app-launcher-dialog" onSubmit={(event) => void handleSubmit(event)}>
        <header>
          <div>
            <p className="panel-label">{t("appLauncher.dialogLabel")}</p>
            <h2>{t("appLauncher.dialogTitle")}</h2>
          </div>
        </header>
        <label className="app-launcher-field">
          <span>{t("appLauncher.name")}</span>
          <input
            value={draft.name}
            onChange={(event) => onUpdate({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="app-launcher-field">
          <span>{t("appLauncher.path")}</span>
          <input
            value={draft.path}
            onChange={(event) => onUpdate({ ...draft, path: event.target.value })}
          />
        </label>
        <label className="app-launcher-field">
          <span>{t("appLauncher.arguments")}</span>
          <input
            placeholder={t("appLauncher.argumentsPlaceholder")}
            value={draft.arguments}
            onChange={(event) => onUpdate({ ...draft, arguments: event.target.value })}
          />
        </label>
        <label className="app-launcher-field">
          <span>{t("appLauncher.workingDirectory")}</span>
          <input
            placeholder={t("appLauncher.workingDirectoryPlaceholder")}
            value={draft.workingDirectory}
            onChange={(event) => onUpdate({ ...draft, workingDirectory: event.target.value })}
          />
        </label>
        <LegacyDialogActions
          className="app-launcher-dialog-actions"
          cancel={<button className="secondary-button" onClick={onClose} type="button">
            {t("common.cancel")}
          </button>}
          primary={<button className="primary-button" disabled={!canSave || saving} type="submit">
            {t("common.save")}
          </button>}
        />
      </form>
    </div>
  );
}

function AppLauncherAddMenu({
  menuRef,
  onAddApp,
  onAddFile,
  onAddFolder,
  onClose,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  onAddApp: () => Promise<void>;
  onAddFile: () => Promise<void>;
  onAddFolder: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      ref={menuRef}
      className="terminal-menu app-launcher-menu app-launcher-add-menu"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      role="menu"
    >
      <MenuButton
        icon={<AppWindow size={14} />}
        label={t("appLauncher.addMenuApp")}
        onClick={() => {
          onClose();
          void onAddApp();
        }}
      />
      <MenuButton
        icon={<FilePlus size={14} />}
        label={t("appLauncher.addMenuFile")}
        onClick={() => {
          onClose();
          void onAddFile();
        }}
      />
      <MenuButton
        icon={<FolderPlus size={14} />}
        label={t("appLauncher.addMenuFolder")}
        onClick={() => {
          onClose();
          void onAddFolder();
        }}
      />
    </div>
  );
}

function MenuButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="terminal-menu-item"
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function sortedAppLauncherEntries(
  entries: AppLauncherEntry[],
  settings: AppLauncherSettings,
  preparedById: Record<string, PreparedAppLauncherEntry>,
) {
  if (settings.viewMode === "icons") {
    return entries;
  }
  const sort = settings.viewMode === "list" ? settings.listSort : settings.detailsSort;
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const compared = compareEntries(a.entry, b.entry, sort.field, preparedById);
      if (compared !== 0) {
        return sort.direction === "asc" ? compared : -compared;
      }
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

function compareEntries(
  a: AppLauncherEntry,
  b: AppLauncherEntry,
  field: AppLauncherSortField,
  preparedById: Record<string, PreparedAppLauncherEntry>,
) {
  const preparedA = preparedById[a.id];
  const preparedB = preparedById[b.id];
  if (field === "size") {
    return compareNullableNumbers(preparedA?.sizeBytes ?? null, preparedB?.sizeBytes ?? null);
  }
  if (field === "modified") {
    return compareNullableNumbers(
      preparedA?.modifiedAtUnixMs ?? null,
      preparedB?.modifiedAtUnixMs ?? null,
    );
  }
  return compareStrings(
    sortStringValue(a, field, preparedA),
    sortStringValue(b, field, preparedB),
  );
}

function sortStringValue(
  entry: AppLauncherEntry,
  field: AppLauncherSortField,
  prepared?: PreparedAppLauncherEntry,
) {
  if (field === "path") {
    return entry.path;
  }
  if (field === "type") {
    return `${prepared?.fileKind ?? "missing"}:${prepared?.extension ?? ""}`;
  }
  return entry.name;
}

function entryDisplayName(
  entry: AppLauncherEntry,
  prepared: PreparedAppLauncherEntry | undefined,
  showFileExtensions: boolean,
) {
  if (!showFileExtensions || prepared?.fileKind === "folder") {
    return entry.name;
  }
  const filename = entry.path.trim().replace(/\\/g, "/").split("/").filter(Boolean).pop();
  if (!filename || !filename.includes(".")) {
    return entry.name;
  }
  const extension = extensionFromPath(entry.path);
  if (!extension) {
    return entry.name;
  }
  const filenameWithoutExtension = filename.slice(0, filename.length - (extension.length + 1));
  return entry.name.localeCompare(filenameWithoutExtension, undefined, { sensitivity: "accent" }) === 0
    ? filename
    : entry.name;
}

function compareStrings(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function compareNullableNumbers(a: number | null, b: number | null) {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a - b;
}

function fileTypeLabel(
  t: ReturnType<typeof useTranslation>["t"],
  entry: AppLauncherEntry,
  prepared?: PreparedAppLauncherEntry,
) {
  if (prepared?.fileKind === "folder") {
    return t("appLauncher.folderType");
  }
  const extension = prepared?.extension ?? extensionFromPath(entry.path);
  if (extension) {
    return t("appLauncher.fileTypeWithExtension", { extension: extension.toUpperCase() });
  }
  if (prepared?.fileKind === "missing") {
    return t("appLauncher.unknownFileType");
  }
  return t("appLauncher.fileType");
}

function formatFileSize(t: ReturnType<typeof useTranslation>["t"], bytes?: number | null) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) {
    return t("appLauncher.notAvailable");
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatModifiedTime(t: ReturnType<typeof useTranslation>["t"], unixMs?: number | null) {
  if (typeof unixMs !== "number" || !Number.isFinite(unixMs)) {
    return t("appLauncher.notAvailable");
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(unixMs));
}

function extensionFromPath(path: string) {
  const filename = path.trim().replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex > 0 && dotIndex < filename.length - 1
    ? filename.slice(dotIndex + 1).toLowerCase()
    : null;
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function hasBrowserDropPayload(event: DragEvent<HTMLElement>) {
  return event.dataTransfer.files.length > 0 || event.dataTransfer.getData("text/plain").trim().length > 0;
}

function pathsFromBrowserDrop(event: DragEvent<HTMLElement>) {
  const filePaths = Array.from(event.dataTransfer.files)
    .map((file) => filePathFromBrowserFile(file))
    .filter(Boolean);
  const textPaths = event.dataTransfer
    .getData("text/plain")
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter(Boolean);
  return [...filePaths, ...textPaths];
}

function filePathFromBrowserFile(file: File) {
  const candidate = file as File & { path?: unknown; webkitRelativePath?: string };
  if (typeof candidate.path === "string" && candidate.path.trim()) {
    return candidate.path;
  }
  if (candidate.webkitRelativePath) {
    return candidate.webkitRelativePath;
  }
  return file.name;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createAppLauncherPortal(node: ReactNode) {
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}

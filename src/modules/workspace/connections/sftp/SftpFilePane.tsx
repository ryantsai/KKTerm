// SFTP file pane — Apple/Finder symmetric dual-pane presentation.
// Breadcrumb navigation + List/Gallery views, sortable columns, inline rename,
// editable path with recent-paths history, drag-to-transfer. All data flows in
// through props; this file owns only local view/sort/edit UI state.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { DIcon } from "../../../../app/ui/dialog";
import { GitIcon } from "../../../git/GitIcon";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import type { LocalPlacesListing } from "../../../../lib/tauri";
import type { FileEntry } from "../../../../types";
import { SharedBackgroundPopover } from "../../../dashboard/edit/SharedBackgroundPopover";
import { loadBackgroundImage } from "../../../dashboard/state/persistence";
import type { DashboardBackground } from "../../../dashboard/types";
import { ExplorerSidebar } from "./ExplorerSidebar";
import { SftpBackgroundLayer } from "./SftpBackgroundLayer";
import { FileThumbnail, fileThumbnails } from "./FileThumbnail";
import { formatFileSize, joinLocalPath } from "./format";
import { writeConnectionPathsDrag } from "../connectionPathsDrag";
import type { FilePaneSide, LocalFavorite } from "./types";

type SortKey = "name" | "size" | "date";
type SortState = { key: SortKey; dir: "asc" | "desc" };
type ViewMode = "list" | "gallery";

const LIST_GRID = "minmax(0,1fr) 88px 128px";
export const FILE_PANE_ZOOM_MIN = 0.8;
export const FILE_PANE_ZOOM_MAX = 1.6;
export const FILE_PANE_ZOOM_STEP = 0.1;
export const FILE_PANE_ZOOM_DEFAULT = 1;

export function FilePane({
  side,
  title,
  path,
  files,
  isLoading = false,
  status = "",
  selectedNames,
  onRefresh,
  onGoUp,
  onCreateFolder,
  onRenameSelected,
  onDeleteSelected,
  onOpenFolder,
  onOpenFile,
  onOpenTerminalHere,
  onOpenGit,
  onPathSubmit,
  recentPaths = [],
  onSelectionChange,
  onContextMenuRequest,
  onDropTransfer,
  renameRequest,
  enableSidebar = false,
  sidebarCollapsed = false,
  onToggleSidebar,
  places = null,
  favorites = [],
  onAddFavorite,
  onRemoveFavorite,
  onReorderFavorites,
  onOpenFavoriteFile,
  enableSearch = false,
  showFooter = false,
  availableBytes,
  zoom = FILE_PANE_ZOOM_DEFAULT,
  onZoomChange,
  background = null,
  onBackgroundChange,
  backgroundActive = false,
}: {
  side: FilePaneSide;
  title: string;
  path: string;
  files: FileEntry[];
  isLoading?: boolean;
  status?: string;
  selectedNames: string[];
  onRefresh?: () => void;
  onGoUp?: () => void;
  onCreateFolder?: () => void;
  onRenameSelected?: (currentName: string, newName: string) => void | Promise<void>;
  onDeleteSelected?: () => void;
  onOpenFolder?: (folderName: string) => void;
  onOpenFile?: (fileName: string) => void;
  onOpenTerminalHere?: () => void;
  /** Open the Git Browser for this pane's directory; shown only when the
   * directory is inside a git repository (File Explorer local pane). */
  onOpenGit?: () => void;
  onPathSubmit?: (path: string) => void | Promise<void>;
  recentPaths?: string[];
  onSelectionChange?: (fileNames: string[]) => void;
  onContextMenuRequest?: (side: FilePaneSide, fileNames: string[], event: ReactMouseEvent) => void;
  onDropTransfer?: (targetSide: FilePaneSide, fileNames: string[]) => void;
  renameRequest?: { side: FilePaneSide; name: string; requestId: number };
  enableSidebar?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  places?: LocalPlacesListing | null;
  favorites?: LocalFavorite[];
  onAddFavorite?: (place: { label: string; path: string; icon: string; kind?: "file" | "folder" }) => void;
  onRemoveFavorite?: (id: string) => void;
  onReorderFavorites?: (next: LocalFavorite[]) => void;
  onOpenFavoriteFile?: (path: string) => void;
  enableSearch?: boolean;
  showFooter?: boolean;
  availableBytes?: number;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  background?: DashboardBackground | null;
  onBackgroundChange?: (background: DashboardBackground | null) => void;
  backgroundActive?: boolean;
}) {
  const { t } = useTranslation();
  const pathSuggestionsId = useId();
  const viewOptionsRef = useRef<HTMLDivElement | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [backgroundPopoverOpen, setBackgroundPopoverOpen] = useState(false);
  const enableViewOptions = Boolean(onZoomChange || onBackgroundChange);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameCanceledRef = useRef(false);
  const lastSelectedNameRef = useRef<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pathDraft, setPathDraft] = useState(path);
  const [editingPath, setEditingPath] = useState(false);
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [view, setView] = useState<ViewMode>("list");
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [search, setSearch] = useState("");

  // A fresh directory listing also invalidates failed previews and same-second edits.
  useEffect(() => { if (side === "local") fileThumbnails.clear(); }, [files, side]);

  const selectedNameSet = useMemo(() => new Set(selectedNames), [selectedNames]);
  const sortedFiles = useMemo(() => sortFileEntries(files, sort), [files, sort]);
  const query = search.trim().toLocaleLowerCase();
  const visibleFiles = useMemo(
    () => (query ? sortedFiles.filter((file) => file.name.toLocaleLowerCase().includes(query)) : sortedFiles),
    [query, sortedFiles],
  );
  const crumbs = useMemo(() => buildCrumbs(side, path), [side, path]);
  const pathSuggestions = useMemo(
    () => buildFolderPathSuggestions({ side, currentPath: path, draft: pathDraft, files }),
    [files, path, pathDraft, side],
  );

  useEffect(() => {
    setPathDraft(path);
    setEditingPath(false);
    setSearch("");
  }, [path]);

  useEffect(() => {
    if (!viewMenuOpen) {
      return;
    }
    function onDoc(event: MouseEvent) {
      if (viewOptionsRef.current && !viewOptionsRef.current.contains(event.target as Node)) {
        setViewMenuOpen(false);
      }
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setViewMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [viewMenuOpen]);

  useEffect(() => {
    if (!editingName) {
      return;
    }
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [editingName]);

  useEffect(() => {
    if (editingName && !files.some((file) => file.name === editingName)) {
      setEditingName(null);
      setRenameDraft("");
    }
  }, [editingName, files]);

  useEffect(() => {
    if (!renameRequest || renameRequest.side !== side || isLoading) {
      return;
    }
    const requestedFile = files.find((file) => file.name === renameRequest.name);
    if (!requestedFile || !onRenameSelected) {
      return;
    }
    onSelectionChange?.([requestedFile.name]);
    renameCanceledRef.current = false;
    setEditingName(requestedFile.name);
    setRenameDraft(requestedFile.name);
  }, [files, isLoading, onRenameSelected, onSelectionChange, renameRequest, side]);

  function selectFile(fileName: string, event?: ReactMouseEvent | KeyboardEvent<HTMLDivElement>) {
    if (isLoading) {
      return;
    }
    if (event?.shiftKey && lastSelectedNameRef.current) {
      const currentIndex = visibleFiles.findIndex((file) => file.name === fileName);
      const lastIndex = visibleFiles.findIndex((file) => file.name === lastSelectedNameRef.current);
      if (currentIndex >= 0 && lastIndex >= 0) {
        const [start, end] = currentIndex < lastIndex ? [currentIndex, lastIndex] : [lastIndex, currentIndex];
        onSelectionChange?.(visibleFiles.slice(start, end + 1).map((file) => file.name));
        return;
      }
    }
    if (event?.ctrlKey || event?.metaKey) {
      const nextNames = selectedNames.includes(fileName)
        ? selectedNames.filter((name) => name !== fileName)
        : [...selectedNames, fileName];
      lastSelectedNameRef.current = fileName;
      onSelectionChange?.(nextNames);
      return;
    }
    lastSelectedNameRef.current = fileName;
    onSelectionChange?.([fileName]);
  }

  async function commitRename() {
    if (!editingName) {
      return;
    }
    if (renameCanceledRef.current) {
      renameCanceledRef.current = false;
      return;
    }
    const nextName = renameDraft.trim();
    const currentName = editingName;
    if (!nextName || nextName === currentName) {
      setEditingName(null);
      setRenameDraft("");
      return;
    }
    await onRenameSelected?.(currentName, nextName);
    setEditingName(null);
    setRenameDraft("");
  }

  function cancelRename() {
    renameCanceledRef.current = true;
    setEditingName(null);
    setRenameDraft("");
  }

  async function commitPathDraft(value = pathDraft) {
    const nextPath = value.trim();
    setEditingPath(false);
    if (!nextPath || nextPath === path || isLoading) {
      setPathDraft(path);
      return;
    }
    setRecentMenuOpen(false);
    await onPathSubmit?.(nextPath);
  }

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  function navigateToCrumb(crumbPath: string) {
    if (isLoading || !onPathSubmit || crumbPath === path) {
      return;
    }
    void onPathSubmit(crumbPath);
  }

  function handleDragStart(fileName: string, event: ReactDragEvent<HTMLDivElement>) {
    if (isLoading || editingName === fileName) {
      event.preventDefault();
      return;
    }
    const names = selectedNames.includes(fileName) ? selectedNames : [fileName];
    onSelectionChange?.(names);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-kkterm-sftp-items", JSON.stringify({ side, names }));
    // The local pane (File Explorer Connection or the SFTP local side) browses
    // real filesystem paths, so it can also seed Connections when dropped on the
    // Connection Tree. Remote paths aren't local-loadable, so only the local side
    // carries them.
    if (side === "local") {
      writeConnectionPathsDrag(
        event.dataTransfer,
        names.map((name) => joinLocalPath(path, name)),
      );
    }
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("application/x-kkterm-sftp-items")) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTarget(true);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDropTarget(false);
    try {
      const payload = JSON.parse(event.dataTransfer.getData("application/x-kkterm-sftp-items")) as {
        side?: FilePaneSide;
        names?: string[];
      };
      if (payload.side && payload.side !== side && payload.names?.length) {
        onDropTransfer?.(side, payload.names);
      }
    } catch {
      return;
    }
  }

  function renderRowName(file: FileEntry) {
    if (editingName === file.name) {
      return (
        <input
          aria-label={t("sftp.renameFileAria", { name: file.name })}
          className="sftp-rename-input"
          {...technicalInputProps}
          onBlur={() => void commitRename()}
          onChange={(event) => setRenameDraft(event.currentTarget.value)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelRename();
            }
          }}
          ref={renameInputRef}
          value={renameDraft}
        />
      );
    }
    return <span>{file.name}</span>;
  }

  function rowHandlers(file: FileEntry, isSelected: boolean) {
    return {
      draggable: !isLoading && editingName !== file.name,
      onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
        if (!isLoading) {
          selectFile(file.name, event);
        }
      },
      onDoubleClick: () => {
        if (isLoading) {
          return;
        }
        if (file.kind === "folder") {
          onOpenFolder?.(file.name);
        } else if (file.kind === "file") {
          onOpenFile?.(file.name);
        }
      },
      onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => {
        if (isLoading) {
          return;
        }
        event.stopPropagation();
        const names = isSelected ? selectedNames : [file.name];
        onContextMenuRequest?.(side, names, event);
      },
      onDragStart: (event: ReactDragEvent<HTMLDivElement>) => handleDragStart(file.name, event),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if ((event.key === "Enter" || event.key === " ") && !isLoading) {
          event.preventDefault();
          selectFile(file.name, event);
          if (event.key === "Enter" && file.kind === "folder") {
            onOpenFolder?.(file.name);
          } else if (event.key === "Enter" && file.kind === "file") {
            onOpenFile?.(file.name);
          }
        }
      },
    };
  }

  const isEmpty = !isLoading && !status && sortedFiles.length === 0;
  const isNoResults = !isLoading && !status && sortedFiles.length > 0 && visibleFiles.length === 0;
  const folderCount = useMemo(() => files.filter((file) => file.kind === "folder").length, [files]);

  return (
    <section
      className="sftp-pane"
      data-sftp-pane-side={side}
      data-tutorial-id={side === "local" ? "sftp.localPane" : "sftp.remotePane"}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setRecentMenuOpen(false);
        }
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const isTextInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          !isTextInput &&
          onDeleteSelected &&
          !editingName &&
          !editingPath &&
          selectedNames.length > 0 &&
          !isLoading
        ) {
          event.preventDefault();
          onDeleteSelected();
        }
      }}
    >
      <div className="sftp-pane-head">
        {enableSidebar ? (
          <button
            className={`sftp-icon-btn${sidebarCollapsed ? "" : " active"}`}
            aria-label={sidebarCollapsed ? t("sftp.sidebar.show") : t("sftp.sidebar.hide")}
            aria-pressed={!sidebarCollapsed}
            onClick={onToggleSidebar}
            title={sidebarCollapsed ? t("sftp.sidebar.show") : t("sftp.sidebar.hide")}
            type="button"
          >
            <DIcon name="sidebar" size={16} />
          </button>
        ) : null}
        <span className="sftp-pane-label">
          <DIcon name={side === "local" ? "drive" : "server"} size={13} />
          {title}
        </span>
        {editingPath ? (
          <div className="sftp-path-edit">
            <input
              aria-label={t("sftp.pathInputAria", { pane: title.toLowerCase() })}
              className="sftp-path-input"
              autoFocus
              {...technicalInputProps}
              disabled={!onPathSubmit || isLoading}
              list={pathSuggestions.length > 0 ? pathSuggestionsId : undefined}
              onBlur={() => commitPathDraft()}
              onChange={(event) => setPathDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitPathDraft(event.currentTarget.value);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setPathDraft(path);
                  setEditingPath(false);
                }
              }}
              value={pathDraft}
            />
            {pathSuggestions.length > 0 ? (
              <datalist id={pathSuggestionsId}>
                {pathSuggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            ) : null}
          </div>
        ) : (
          <div
            className="sftp-crumbs"
            onDoubleClick={() => {
              if (onPathSubmit && !isLoading) {
                setPathDraft(path);
                setEditingPath(true);
              }
            }}
            title={t("sftp.editPathTitle")}
          >
            <button
              className={`sftp-crumb${crumbs.items.length === 0 ? " current" : ""}`}
              onClick={() => navigateToCrumb(crumbs.rootPath)}
              title={crumbs.rootLabel}
              type="button"
            >
              <span className="gl">
                <DIcon name={side === "local" ? "home" : "server"} size={14} />
              </span>
              <span className="sftp-crumb-text">{crumbs.rootLabel}</span>
            </button>
            {crumbs.items.map((crumb, index) => (
              <span className="sftp-crumb-seg" key={crumb.path}>
                <span className="sftp-crumb-sep">
                  <DIcon name="chevright" size={13} />
                </span>
                <button
                  className={`sftp-crumb${index === crumbs.items.length - 1 ? " current" : ""}`}
                  onClick={() => navigateToCrumb(crumb.path)}
                  title={crumb.name}
                  type="button"
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="sftp-pane-head-actions">
          {onOpenGit ? (
            <button
              className="sftp-icon-btn"
              aria-label={t("git.openBrowser")}
              disabled={isLoading}
              onClick={onOpenGit}
              title={t("git.openBrowser")}
              type="button"
            >
              <GitIcon name="branch" size={16} />
            </button>
          ) : null}
          {onOpenTerminalHere ? (
            <button
              className="sftp-icon-btn"
              aria-label={t("sftp.openTerminalHereAria", { pane: title.toLowerCase() })}
              disabled={isLoading}
              onClick={onOpenTerminalHere}
              title={t("sftp.openTerminalHereAria", { pane: title.toLowerCase() })}
              type="button"
            >
              <DIcon name="terminal" size={16} />
            </button>
          ) : null}
          <button
            className="sftp-icon-btn"
            aria-label={t("sftp.openParentFolderAria", { pane: title.toLowerCase() })}
            disabled={!onGoUp || isLoading}
            onClick={onGoUp}
            title={t("sftp.openParentFolderAria", { pane: title.toLowerCase() })}
            type="button"
          >
            <DIcon name="up" size={16} />
          </button>
          {onCreateFolder ? (
            <button
              className="sftp-icon-btn"
              aria-label={t("sftp.createFolderAria", { pane: title.toLowerCase() })}
              disabled={isLoading}
              onClick={onCreateFolder}
              title={t("sftp.createFolderAria", { pane: title.toLowerCase() })}
              type="button"
            >
              <DIcon name="newfolder" size={16} />
            </button>
          ) : null}
          <div className="sftp-recent-wrap">
            <button
              aria-expanded={recentMenuOpen}
              aria-label={t("sftp.recentPathsAria", { pane: title.toLowerCase() })}
              className="sftp-icon-btn"
              disabled={recentPaths.length === 0 || isLoading || !onPathSubmit}
              onClick={() => setRecentMenuOpen((open) => !open)}
              title={t("sftp.recentPathsAria", { pane: title.toLowerCase() })}
              type="button"
            >
              <DIcon name="clock" size={15} />
            </button>
            {recentMenuOpen && recentPaths.length > 0 ? (
              <div className="sftp-recent-menu" role="menu">
                {recentPaths.map((recentPath) => (
                  <button
                    key={recentPath}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void commitPathDraft(recentPath)}
                    role="menuitem"
                    title={recentPath}
                    type="button"
                  >
                    <bdi dir="ltr">{recentPath}</bdi>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="sftp-icon-btn"
            aria-label={t("sftp.refreshFilesAria", { pane: title.toLowerCase() })}
            disabled={!onRefresh || isLoading}
            onClick={onRefresh}
            title={t("sftp.refreshFilesAria", { pane: title.toLowerCase() })}
            type="button"
          >
            <DIcon name="refresh" size={15} />
          </button>
          <ViewSeg value={view} onChange={setView} t={t} />
          {enableSearch ? (
            <div className="sftp-search">
              <DIcon name="search" size={13} />
              <input
                aria-label={t("sftp.searchAria")}
                {...technicalInputProps}
                onChange={(event) => setSearch(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setSearch("");
                  }
                }}
                placeholder={t("sftp.searchPlaceholder")}
                type="text"
                value={search}
              />
              {search ? (
                <button
                  className="sftp-search-clear"
                  aria-label={t("sftp.searchClear")}
                  onClick={() => setSearch("")}
                  title={t("sftp.searchClear")}
                  type="button"
                >
                  <DIcon name="close" size={10} />
                </button>
              ) : null}
            </div>
          ) : null}
          {enableViewOptions ? (
            <div className="sftp-viewopts-wrap" ref={viewOptionsRef}>
              <button
                aria-expanded={viewMenuOpen}
                aria-label={t("sftp.viewOptions")}
                className={`sftp-icon-btn${viewMenuOpen ? " active" : ""}`}
                onClick={() => setViewMenuOpen((open) => !open)}
                title={t("sftp.viewOptions")}
                type="button"
              >
                <DIcon name="menu" size={16} />
              </button>
              {viewMenuOpen ? (
                <div className="sftp-viewopts-menu" role="menu">
                  {onZoomChange ? (
                    <div className="sftp-viewopts-zoom">
                      <span className="sftp-viewopts-label">{t("sftp.zoom")}</span>
                      <div className="sftp-viewopts-zoom-row">
                        <DIcon name="gallery" size={13} />
                        <input
                          aria-label={t("sftp.zoomAria")}
                          max={FILE_PANE_ZOOM_MAX}
                          min={FILE_PANE_ZOOM_MIN}
                          onChange={(event) => onZoomChange(Number(event.currentTarget.value))}
                          step={FILE_PANE_ZOOM_STEP}
                          type="range"
                          value={zoom}
                        />
                        <DIcon name="gallery" size={18} />
                      </div>
                    </div>
                  ) : null}
                  {onBackgroundChange ? (
                    <button
                      className="sftp-viewopts-item"
                      onClick={() => {
                        setViewMenuOpen(false);
                        setBackgroundPopoverOpen(true);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <DIcon name="palette" size={15} />
                      <span>{t("sftp.background")}</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {backgroundPopoverOpen && onBackgroundChange ? (
        <SharedBackgroundPopover
          background={background}
          className="sftp-bg-popover"
          defaultHintKey="sftp.backgroundDefaultHint"
          onBackgroundChange={onBackgroundChange}
          onClose={() => setBackgroundPopoverOpen(false)}
          onLoadBackgroundImage={async (file) => { await loadBackgroundImage(file); }}
          titleKey="dashboard.changeBackground"
        />
      ) : null}

      <div className="sftp-pane-body">
        {enableSidebar ? (
          <ExplorerSidebar
            collapsed={sidebarCollapsed}
            currentPath={path}
            places={places}
            favorites={favorites}
            onNavigate={(target) => void onPathSubmit?.(target)}
            onOpenFavorite={(favorite) => {
              if (favorite.kind === "file") {
                onOpenFavoriteFile?.(favorite.path);
              } else {
                void onPathSubmit?.(favorite.path);
              }
            }}
            onAddFavorite={(place) => onAddFavorite?.(place)}
            onAddFavoritesFromNames={(names) => {
              for (const name of names) {
                const entry = files.find((file) => file.name === name);
                if (!entry) {
                  continue;
                }
                onAddFavorite?.({
                  label: entry.name,
                  path: joinLocalPath(path, entry.name),
                  icon: entry.kind === "folder" ? "folder" : "file",
                  kind: entry.kind === "folder" ? "folder" : "file",
                });
              }
            }}
            onRemoveFavorite={(id) => onRemoveFavorite?.(id)}
            onReorderFavorites={(next) => onReorderFavorites?.(next)}
          />
        ) : null}
        <div className="sftp-pane-content">
          <SftpBackgroundLayer active={backgroundActive} background={background} />
          {view === "list" ? (
            <ListColumnHeader sort={sort} onSort={toggleSort} t={t} />
          ) : null}

          <div
            className={`sftp-file-body sftp-view-${view}${isDropTarget ? " drop-target" : ""}`}
            style={{ "--sftp-zoom": zoom } as CSSProperties}
            onContextMenu={(event) => onContextMenuRequest?.(side, selectedNames, event)}
            onDragLeave={() => setIsDropTarget(false)}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {isLoading ? <div className="sftp-empty">{t("sftp.loading")}</div> : null}
            {!isLoading && status ? <div className="sftp-empty">{status}</div> : null}
            {isEmpty ? (
              <div className="sftp-empty">
                <DIcon name="info" size={22} />
                <span>{t("sftp.noFiles")}</span>
              </div>
            ) : null}
            {isNoResults ? (
              <div className="sftp-empty">
                <DIcon name="search" size={22} />
                <span>{t("sftp.searchNoResults", { query: search.trim() })}</span>
              </div>
            ) : null}

            {!isLoading && !status && view === "list"
              ? visibleFiles.map((file) => {
                  const isSelected = selectedNameSet.has(file.name);
                  const handlers = rowHandlers(file, isSelected);
                  return (
                    <div
                      className={`sftp-row${isSelected ? " sel" : ""}`}
                      key={file.name}
                      role="button"
                      tabIndex={isLoading ? -1 : 0}
                      title={file.kind === "folder" ? t("sftp.doubleClickToOpenFile", { name: file.name }) : file.name}
                      style={{ gridTemplateColumns: LIST_GRID }}
                      {...handlers}
                    >
                      <div className="nm">
                        <span className="sftp-row-glyph">
                          <FileThumbnail entry={file} path={side === "local" ? joinLocalPath(path, file.name) : undefined} size={20} />
                        </span>
                        {renderRowName(file)}
                      </div>
                      <div className="num">{file.size}</div>
                      <div className="num">{file.modified}</div>
                    </div>
                  );
                })
              : null}

            {!isLoading && !status && view === "gallery" ? (
              <div className="sftp-gallery-grid">
                {visibleFiles.map((file) => {
                  const isSelected = selectedNameSet.has(file.name);
                  const handlers = rowHandlers(file, isSelected);
                  return (
                    <div
                      className={`sftp-tile${isSelected ? " sel" : ""}`}
                      key={file.name}
                      role="button"
                      tabIndex={isLoading ? -1 : 0}
                      title={file.kind === "folder" ? t("sftp.doubleClickToOpenFile", { name: file.name }) : file.name}
                      {...handlers}
                    >
                      <span className="sftp-tile-ico">
                        <FileThumbnail entry={file} path={side === "local" ? joinLocalPath(path, file.name) : undefined} size={52} />
                      </span>
                      <span className="sftp-tile-cap">{renderRowName(file)}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {showFooter ? (
        <div className="sftp-pane-foot">
          <span>{t("sftp.itemsCount", { count: files.length })}</span>
          {folderCount > 0 ? (
            <>
              <span className="dot" />
              <span>{t("sftp.foldersCount", { count: folderCount })}</span>
            </>
          ) : null}
          {availableBytes !== undefined ? (
            <>
              <span className="sftp-pane-foot-spacer" />
              <span>{t("sftp.availableSpace", { size: formatFileSize(availableBytes) })}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ViewSeg({
  value,
  onChange,
  t,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="sftp-segmented" role="tablist" aria-label={t("sftp.viewMode")}>
      {(["list", "gallery"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={value === mode}
          className={value === mode ? "active" : ""}
          onClick={() => onChange(mode)}
          title={t(mode === "list" ? "sftp.listView" : "sftp.galleryView")}
        >
          <DIcon name={mode} size={15} />
        </button>
      ))}
    </div>
  );
}

function ListColumnHeader({
  sort,
  onSort,
  t,
}: {
  sort: SortState;
  onSort: (key: SortKey) => void;
  t: (key: string) => string;
}) {
  const Head = ({ k, label, cls }: { k: SortKey; label: string; cls?: string }) => (
    <button className={cls} onClick={() => onSort(k)} type="button">
      {label}
      {sort.key === k ? (
        <span className="sftp-sort-ind">
          <DIcon name={sort.dir === "asc" ? "arrowup" : "arrowdown"} size={12} />
        </span>
      ) : null}
    </button>
  );
  return (
    <div className="sftp-col-head" style={{ gridTemplateColumns: LIST_GRID }}>
      <Head k="name" label={t("sftp.name")} />
      <Head k="size" label={t("sftp.size")} cls="num" />
      <Head k="date" label={t("sftp.date")} cls="num" />
    </div>
  );
}

function sortFileEntries(files: FileEntry[], sort: SortState) {
  const sorted = [...files].sort((left, right) => {
    if (left.kind === "folder" && right.kind !== "folder") {
      return -1;
    }
    if (left.kind !== "folder" && right.kind === "folder") {
      return 1;
    }
    if (sort.key !== "name") {
      const primary =
        sort.key === "size"
          ? (left.sizeBytes ?? -1) - (right.sizeBytes ?? -1)
          : (left.modifiedTimestamp ?? 0) - (right.modifiedTimestamp ?? 0);
      if (primary !== 0) {
        return sort.dir === "asc" ? primary : -primary;
      }
    }
    const byName = left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    // Size/date ties remain name-ascending regardless of primary direction.
    return sort.key === "name" && sort.dir === "desc" ? -byName : byName;
  });
  return sorted;
}

type Crumb = { name: string; path: string };
function buildCrumbs(side: FilePaneSide, path: string): { rootLabel: string; rootPath: string; items: Crumb[] } {
  if (!path || path === ".") {
    return { rootLabel: side === "local" ? "/" : "/", rootPath: path || "/", items: [] };
  }
  const isWindows = side === "local" && (path.includes("\\") || /^[A-Za-z]:/.test(path));
  if (isWindows) {
    const normalized = path.replace(/\//g, "\\");
    const parts = normalized.split("\\").filter(Boolean);
    const drive = parts[0] ?? "";
    const rootPath = `${drive}\\`;
    let accumulator = rootPath;
    const items: Crumb[] = parts.slice(1).map((name) => {
      const current = accumulator.endsWith("\\") ? `${accumulator}${name}` : `${accumulator}\\${name}`;
      accumulator = `${current}\\`;
      return { name, path: current };
    });
    return { rootLabel: drive || "\\", rootPath, items };
  }
  const parts = path.split("/").filter(Boolean);
  let accumulator = "";
  const items: Crumb[] = parts.map((name) => {
    accumulator = `${accumulator}/${name}`;
    return { name, path: accumulator };
  });
  return { rootLabel: "/", rootPath: "/", items };
}

function buildFolderPathSuggestions({
  side,
  currentPath,
  draft,
  files,
}: {
  side: FilePaneSide;
  currentPath: string;
  draft: string;
  files: FileEntry[];
}) {
  const folders = files.filter((file) => file.kind === "folder");
  if (folders.length === 0 || (side === "local" && !/[\\/]/.test(currentPath))) {
    return [];
  }
  const separator = side === "local" && (currentPath || draft).includes("\\") ? "\\" : "/";
  const splitPattern = side === "local" ? /[\\/]/ : /\//;
  const parts = draft.split(splitPattern);
  const typedName = parts[parts.length - 1] ?? "";
  const typedParent = parts.length > 1 ? draft.slice(0, draft.length - typedName.length) : "";
  const parentPath = typedParent || appendSeparator(currentPath, separator);
  const normalizedTypedName = typedName.toLocaleLowerCase();
  return folders
    .filter((folder) => folder.name.toLocaleLowerCase().startsWith(normalizedTypedName))
    .slice(0, 8)
    .map((folder) => `${parentPath}${folder.name}${separator}`);
}

function appendSeparator(path: string, separator: string) {
  if (!path) {
    return "";
  }
  if (path.endsWith("/") || path.endsWith("\\")) {
    return path;
  }
  return `${path}${separator}`;
}

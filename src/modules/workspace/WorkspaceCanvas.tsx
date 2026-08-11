import { connectionTypeForTab } from "./connections/utils";
import {
  dispatchConnectionTabContextMenu,
  isConnectionTabContextMenuConnection,
} from "./connections/connectionTabContextMenu";
import { ftpBrowserCommands, localBrowserCommands } from "../../lib/fileBrowserCommands";
import { TerminalWorkspace } from "./connections/terminal/TerminalWorkspace";
import { TerminalRecordingsDialog } from "./connections/terminal/TerminalRecordingsDialog";
import { ConnectionIcon } from "./connections/ConnectionIcon";
import { ConnectionTypeGlyph } from "./connections/ConnectionGlyph";
import { CONNECTION_CREATION_OPTIONS } from "./connections/ConnectionMenus";
import {
  requestConnectionNewTab,
  requestImportConnections,
  requestNewConnection,
} from "./connections/connectionSidebarState";
import { ChevronLeft, ChevronRight, Download, Plus, Terminal, X } from "../../lib/reicon";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { isWindowsPlatform } from "../../lib/platform";
import { invokeCommand } from "../../lib/tauri";
import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "../../store";
import { activeConnectionForNewTab, workspaceShortcutFromKeyboardEvent } from "./keymap";
import type { WorkspaceTab } from "../../types";

const SftpWorkspace = lazy(() =>
  import("./connections/sftp/SftpWorkspace").then(({ SftpWorkspace }) => ({
    default: SftpWorkspace,
  })),
);
const FileViewerWorkspace = lazy(() =>
  import("./connections/file-viewer/FileViewerWorkspace").then(({ FileViewerWorkspace }) => ({
    default: FileViewerWorkspace,
  })),
);
const WebViewWorkspace = lazy(() =>
  import("./connections/webview/WebViewWorkspace").then(({ WebViewWorkspace }) => ({
    default: WebViewWorkspace,
  })),
);
const RemoteDesktopWorkspace = lazy(() =>
  import("./connections/remote-desktop/RemoteDesktopWorkspace").then(({ RemoteDesktopWorkspace }) => ({
    default: RemoteDesktopWorkspace,
  })),
);
const GitBrowser = lazy(() =>
  import("../git/GitBrowser").then(({ GitBrowser }) => ({
    default: GitBrowser,
  })),
);
const CompareViewer = lazy(() =>
  import("../compare/CompareViewer").then(({ CompareViewer }) => ({
    default: CompareViewer,
  })),
);
const FolderCompareView = lazy(() =>
  import("../compare/FolderCompareView").then(({ FolderCompareView }) => ({
    default: FolderCompareView,
  })),
);

function tabDisplayTitle(tab: WorkspaceTab) {
  return tab.displayTitle?.trim() || tab.title;
}

function tabWorkspaceId(tab: WorkspaceTab) {
  return tab.workspaceId ?? DEFAULT_WORKSPACE_ID;
}

function WorkspaceEmptyState() {
  const { t } = useTranslation();

  return (
    <section className="empty-workspace" data-tutorial-id="workspace.emptyState">
      <Terminal size={28} />
      <h2>{t("workspace.noActiveSession")}</h2>
      <p>{t("workspace.openFromTree")}</p>
      <div className="empty-workspace-connection-links">
        {CONNECTION_CREATION_OPTIONS.map(({ labelKey, type }) => (
          <button
            className="empty-workspace-connection-link"
            key={type}
            onClick={() => requestNewConnection(type, { openAfterCreate: true })}
            type="button"
          >
            <ConnectionTypeGlyph size={15} type={type} />
            <span>{t(labelKey)}</span>
          </button>
        ))}
        <button
          className="empty-workspace-connection-link empty-workspace-connection-link--import"
          onClick={requestImportConnections}
          type="button"
        >
          <Download size={15} />
          <span>{t("workspace.importConnections")}</span>
        </button>
      </div>
    </section>
  );
}

function DockableWorkspaceTab({
  children,
  isActive,
  tab,
}: {
  children: ReactNode;
  isActive: boolean;
  tab: WorkspaceTab;
}) {
  return (
    <div
      className={isActive ? "workspace-dockable-tab active" : "workspace-dockable-tab"}
      data-dock-pane-id={tab.panes[0]?.id ?? tab.id}
      data-dock-tab-id={tab.id}
    >
      {children}
    </div>
  );
}

export function TabStrip() {
  const { t } = useTranslation();
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const renameTab = useWorkspaceStore((state) => state.renameTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const moveTab = useWorkspaceStore((state) => state.moveTab);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameCanceledRef = useRef(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const visibleTabs = tabs.filter((tab) => tabWorkspaceId(tab) === activeWorkspaceId);

  const updateScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    updateScroll();
    const observer = new ResizeObserver(updateScroll);
    observer.observe(el);
    el.addEventListener("scroll", updateScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", updateScroll);
    };
  }, [visibleTabs.length, updateScroll]);

  useEffect(() => {
    if (!editingTabId) {
      return;
    }
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [editingTabId]);

  function scrollLeft() {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    el.scrollBy({ left: -200, behavior: "smooth" });
  }

  function scrollRight() {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    el.scrollBy({ left: 200, behavior: "smooth" });
  }

  function handleTabContextMenu(tab: (typeof tabs)[number], event: ReactMouseEvent<HTMLElement>) {
    if (!isConnectionTabContextMenuConnection(tab.connection) || tab.sshPortForwardSessionId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    activateTab(tab.id);
    dispatchConnectionTabContextMenu({
      connection: tab.connection,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function startRenamingTab(tab: WorkspaceTab) {
    renameCanceledRef.current = false;
    activateTab(tab.id);
    setEditingTabId(tab.id);
    setRenameDraft(tabDisplayTitle(tab));
  }

  function finishRenamingTab(tabId: string) {
    if (renameCanceledRef.current) {
      renameCanceledRef.current = false;
      return;
    }
    const nextTitle = renameDraft.trim();
    if (nextTitle) {
      void renameTab(tabId, nextTitle);
    }
    setEditingTabId(null);
    setRenameDraft("");
  }

  function cancelRenamingTab() {
    renameCanceledRef.current = true;
    setEditingTabId(null);
    setRenameDraft("");
  }

  function handleRenameSubmit(tabId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    finishRenamingTab(tabId);
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRenamingTab();
    }
  }

  function handleTabMouseDown(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 1) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function handleOpenFile() {
    void invokeCommand("open_launch_file_picker", undefined);
  }

  function handleTabAuxClick(tabId: string, event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 1) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeTab(tabId);
  }

  return (
    <div className="tab-strip" aria-label={t("workspace.tabs")} data-tutorial-id="workspace.tabStrip">
      {canScrollLeft ? (
        <button
          aria-label={t("workspace.scrollTabsLeft")}
          className="tab-scroll-arrow tab-scroll-left"
          onClick={scrollLeft}
          type="button"
        >
          <ChevronLeft size={16} />
        </button>
      ) : null}
      <div className="tab-scroll-container" ref={scrollRef}>
        {visibleTabs.map((tab) => {
          const displayTitle = tabDisplayTitle(tab);
          const isRenaming = editingTabId === tab.id;
          return (
            <div
              className={`tab${tab.id === activeTabId ? " active" : ""}${draggedTabId === tab.id ? " dragging" : ""}`}
              draggable={!isRenaming}
              key={tab.id}
              onAuxClick={(event) => handleTabAuxClick(tab.id, event)}
              onContextMenu={(event) => handleTabContextMenu(tab, event)}
              onDragEnd={() => setDraggedTabId(null)}
              onDragOver={(event) => {
                if (draggedTabId && draggedTabId !== tab.id) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDragStart={(event) => {
                setDraggedTabId(tab.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", tab.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedTabId && draggedTabId !== tab.id) {
                  moveTab(draggedTabId, tab.id);
                }
                setDraggedTabId(null);
              }}
              onMouseDown={handleTabMouseDown}
            >
              {isRenaming ? (
                <form
                  className="tab-rename-form"
                  onSubmit={(event) => handleRenameSubmit(tab.id, event)}
                >
                  <ConnectionIcon
                    iconBackgroundColor={connectionTypeForTab(tab).iconBackgroundColor}
                    iconColor={connectionTypeForTab(tab).iconColor}
                    iconDataUrl={connectionTypeForTab(tab).iconDataUrl}
                    localShell={connectionTypeForTab(tab).localShell}
                    size={14}
                    type={connectionTypeForTab(tab).type}
                  />
                  <input
                    aria-label={t("workspace.renameTab", { title: displayTitle })}
                    className="tab-rename-input"
                    onBlur={() => finishRenamingTab(tab.id)}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    ref={renameInputRef}
                    value={renameDraft}
                  />
                </form>
              ) : (
                <button
                  className="tab-button"
                  onClick={() => activateTab(tab.id)}
                  onDoubleClick={() => startRenamingTab(tab)}
                  type="button"
                >
                  <ConnectionIcon
                    iconBackgroundColor={connectionTypeForTab(tab).iconBackgroundColor}
                    iconColor={connectionTypeForTab(tab).iconColor}
                    iconDataUrl={connectionTypeForTab(tab).iconDataUrl}
                    localShell={connectionTypeForTab(tab).localShell}
                    size={14}
                    type={connectionTypeForTab(tab).type}
                  />
                  <span>{displayTitle}</span>
                </button>
              )}
              <button
                aria-label={t("workspace.closeTab", { title: displayTitle })}
                className="tab-close-button"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                title={t("workspace.closeTab", { title: displayTitle })}
                type="button"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
      {canScrollRight ? (
        <button
          aria-label={t("workspace.scrollTabsRight")}
          className="tab-scroll-arrow tab-scroll-right"
          onClick={scrollRight}
          type="button"
        >
          <ChevronRight size={16} />
        </button>
      ) : null}
      {isWindowsPlatform() ? (
        <button
          aria-label={t("app.openFile")}
          className="tab-open-path-button"
          onClick={handleOpenFile}
          title={t("app.openFile")}
          type="button"
        >
          <Plus size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function WorkspaceCanvas({
  onOpenAssistant = () => undefined,
  workspaceActive = true,
}: {
  onOpenAssistant?: () => void;
  workspaceActive?: boolean;
} = {}) {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const localTerminalPopup = useWorkspaceStore((state) => state.localTerminalPopup);
  const closeLocalTerminalPopup = useWorkspaceStore((state) => state.closeLocalTerminalPopup);
  const gitBrowser = useWorkspaceStore((state) => state.gitBrowser);
  const closeGitBrowser = useWorkspaceStore((state) => state.closeGitBrowser);
  const compareView = useWorkspaceStore((state) => state.compareView);
  const closeCompareView = useWorkspaceStore((state) => state.closeCompareView);
  const folderCompareView = useWorkspaceStore((state) => state.folderCompareView);
  const closeFolderCompareView = useWorkspaceStore((state) => state.closeFolderCompareView);
  // The toolbar close button only earns its place when the tab strip is hidden;
  // otherwise the tab strip's own close button already covers it.
  const hideTopTabButtons = useWorkspaceStore((state) => state.generalSettings.hideTopTabButtons);
  const visibleTabs = tabs.filter((tab) => tabWorkspaceId(tab) === activeWorkspaceId);
  const showEmptyState = tabs.length === 0 || (!hideTopTabButtons && visibleTabs.length === 0);

  useEffect(() => {
    if (!localTerminalPopup) {
      return;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeLocalTerminalPopup();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeLocalTerminalPopup, localTerminalPopup]);

  useEffect(() => {
    if (!workspaceActive) {
      return;
    }
    // Capture phase so Tab shortcuts win over xterm.js and other focused
    // surfaces; stopPropagation keeps the handled key out of the terminal.
    const handleShortcutKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Remote Desktop surfaces forward raw keys to the remote host. Block
      // shortcuts whenever a Settings or dialog backdrop is mounted as focus
      // can still be parked on a Workspace control behind a modal.
      if (target?.closest(".rdp-canvas-view, .vnc-display")) {
        return;
      }
      if (document.querySelector(".settings-backdrop, .dialog-backdrop, .kk-dlg-backdrop")) {
        return;
      }
      const state = useWorkspaceStore.getState();
      const action = workspaceShortcutFromKeyboardEvent(
        event,
        state.generalSettings.workspaceShortcuts,
        "workspace",
      );
      if (!action) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      switch (action) {
        case "newTab": {
          const connection = activeConnectionForNewTab(state.tabs, state.activeTabId);
          if (connection) {
            requestConnectionNewTab(connection);
          }
          break;
        }
        case "closeTab":
          if (state.activeTabId) {
            state.closeTab(state.activeTabId);
          }
          break;
        case "nextTab":
        case "previousTab": {
          const workspaceTabs = state.tabs.filter(
            (tab) => tabWorkspaceId(tab) === state.activeWorkspaceId,
          );
          if (workspaceTabs.length < 2) {
            break;
          }
          const index = workspaceTabs.findIndex((tab) => tab.id === state.activeTabId);
          const step = action === "nextTab" ? 1 : -1;
          const nextTab =
            workspaceTabs[(index + step + workspaceTabs.length) % workspaceTabs.length];
          state.activateTab(nextTab.id);
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleShortcutKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleShortcutKeyDown, { capture: true });
  }, [workspaceActive]);

  const terminalPopup = localTerminalPopup
    ? createPortal(
        <div
          className="dialog-backdrop connection-dialog-backdrop sftp-popup-dialog-backdrop"
          role="presentation"
        >
          <section
            aria-label={localTerminalPopup.title}
            aria-modal="true"
            className="connection-dialog sftp-popup-dialog local-terminal-popup-dialog"
            role="dialog"
          >
            <div className="sftp-popup-dialog-body local-terminal-popup-dialog-body">
              <TerminalWorkspace
                allowPaneLayoutControls={false}
                isActive={true}
                onClose={closeLocalTerminalPopup}
                showSftpButton={false}
                trackConnectionSession={false}
                tab={localTerminalPopup}
              />
            </div>
          </section>
        </div>,
        document.body,
      )
    : null;

  // The Git Browser is an app-window overlay (portalled to document.body) so it
  // floats above workspace chrome and native surfaces, per the overlay rule.
  const gitBrowserOverlay = gitBrowser
    ? createPortal(
        <Suspense fallback={null}>
          <GitBrowser target={gitBrowser} onClose={closeGitBrowser} />
        </Suspense>,
        document.body,
      )
    : null;

  // The File Compare overlay floats above workspace chrome and native surfaces,
  // same as the Git Browser, per the overlay rule.
  const compareOverlay = compareView
    ? createPortal(
        <Suspense fallback={null}>
          <CompareViewer view={compareView} onClose={closeCompareView} />
        </Suspense>,
        document.body,
      )
    : null;

  // The Folder Compare overlay (Beyond Compare-style directory diff) floats
  // above workspace chrome the same way, per the overlay rule.
  const folderCompareOverlay = folderCompareView
    ? createPortal(
        <Suspense fallback={null}>
          <FolderCompareView view={folderCompareView} onClose={closeFolderCompareView} />
        </Suspense>,
        document.body,
      )
    : null;

  if (tabs.length === 0) {
    return (
      <>
        <div className="workspace-canvas" data-dock-empty-canvas data-tutorial-id="workspace.canvas">
          <WorkspaceEmptyState />
        </div>
        {terminalPopup}
        {gitBrowserOverlay}
        {compareOverlay}
        {folderCompareOverlay}
        <TerminalRecordingsDialog />
      </>
    );
  }

  return (
    <Suspense fallback={null}>
      <div
        className="workspace-canvas"
        data-dock-empty-canvas={showEmptyState ? "" : undefined}
        data-tutorial-id="workspace.canvas"
      >
      {showEmptyState ? (
        <WorkspaceEmptyState />
      ) : null}
      {tabs.map((tab) => {
        const tabIsActive = workspaceActive && tab.id === activeTabId;
        if (tab.kind === "sftp") {
          return (
            <DockableWorkspaceTab isActive={tabIsActive} key={tab.id} tab={tab}>
              <SftpWorkspace
                isActive={tabIsActive}
                onClose={hideTopTabButtons ? () => closeTab(tab.id) : undefined}
                tab={tab}
              />
            </DockableWorkspaceTab>
          );
        }
        if (tab.kind === "ftp") {
          const connection = tab.connection;
          const ftpOptions = connection?.ftpOptions ?? {
            protocol: "ftp" as const,
            mode: "passive" as const,
            transferType: "binary" as const,
            utf8: true,
            showHidden: false,
            ignoreCertErrors: false,
          };
          // Route plain FTP / FTPS through the same SftpWorkspace, parameterized
          // with the FTP transport adapter so the UI is identical to the
          // SSH-launched SFTP browser. The adapter disables features the FTP
          // protocol can't support (e.g. POSIX permissions editor).
          const commands = connection
            ? ftpBrowserCommands(connection, ftpOptions)
            : undefined;
          return (
            <DockableWorkspaceTab isActive={tabIsActive} key={tab.id} tab={tab}>
              <SftpWorkspace
                commands={commands}
                isActive={tabIsActive}
                onClose={hideTopTabButtons ? () => closeTab(tab.id) : undefined}
                tab={tab}
              />
            </DockableWorkspaceTab>
          );
        }
        if (tab.kind === "localFiles") {
          // Local File Explorer reuses the SFTP browser surface driven by the
          // local-filesystem adapter (no network session).
          return (
            <DockableWorkspaceTab isActive={tabIsActive} key={tab.id} tab={tab}>
              <SftpWorkspace
                commands={localBrowserCommands()}
                inline={tab.ephemeral}
                isActive={tabIsActive}
                onClose={hideTopTabButtons ? () => closeTab(tab.id) : undefined}
                tab={tab}
              />
            </DockableWorkspaceTab>
          );
        }
        if (tab.kind === "fileViewer") {
          // Document Connection: open a single local file in the universal
          // viewer / light editor (no network session).
          return (
            <DockableWorkspaceTab isActive={tabIsActive} key={tab.id} tab={tab}>
              <FileViewerWorkspace
                isActive={tabIsActive}
                onClose={hideTopTabButtons ? () => closeTab(tab.id) : undefined}
                tab={tab}
              />
            </DockableWorkspaceTab>
          );
        }
        if (tab.kind === "webview") {
          return (
            <DockableWorkspaceTab isActive={tabIsActive} key={tab.id} tab={tab}>
              <WebViewWorkspace
                isActive={tabIsActive}
                onClose={hideTopTabButtons ? () => closeTab(tab.id) : undefined}
                onOpenAssistant={onOpenAssistant}
                tab={tab}
              />
            </DockableWorkspaceTab>
          );
        }
        if (tab.kind === "remoteDesktop") {
          return (
            <DockableWorkspaceTab isActive={tabIsActive} key={tab.id} tab={tab}>
              <RemoteDesktopWorkspace
                isActive={tabIsActive}
                onOpenAssistant={onOpenAssistant}
                tab={tab}
              />
            </DockableWorkspaceTab>
          );
        }
        return (
          <TerminalWorkspace
            isActive={tabIsActive}
            key={tab.id}
            onOpenAssistant={onOpenAssistant}
            tab={tab}
          />
        );
        })}
      </div>
      {terminalPopup}
      {gitBrowserOverlay}
      {compareOverlay}
      {folderCompareOverlay}
      <TerminalRecordingsDialog />
    </Suspense>
  );
}

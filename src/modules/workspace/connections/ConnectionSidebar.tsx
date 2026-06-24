import { ConnectionGlyph, connectionSubtitle, connectionTypeSubtitle } from "./ConnectionGlyph";
import { ConnectionIconBackgroundPicker } from "./ConnectionIconBackgroundPicker";
import { ConnectionIconPicker } from "./ConnectionIconPicker";
import { ConnectionIcon, connectionIconSrcForConnection } from "./ConnectionIcon";
import { AddConnectionMenu, QuickConnectMenu } from "./ConnectionMenus";
import { FtpConnectionFields, FtpConnectionOptions } from "./connection-dialog/FtpConnectionFields";
import { LocalConnectionFields } from "./connection-dialog/LocalConnectionFields";
import { defaultWslConnectionName, distroFromWslShell } from "./connection-dialog/wslLocalShell";
import { LocalFilesConnectionFields } from "./connection-dialog/LocalFilesConnectionFields";
import { FileViewConnectionFields } from "./connection-dialog/FileViewConnectionFields";
import { RdpConnectionFields, RdpConnectionOptions } from "./connection-dialog/RdpConnectionFields";
import { SerialConnectionFields } from "./connection-dialog/SerialConnectionFields";
import { SshConnectionFields, SshConnectionOptions } from "./connection-dialog/SshConnectionFields";
import { writeSshApplyStartupToExistingTmux } from "./connection-dialog/sshStartupScript";
import { TelnetConnectionFields } from "./connection-dialog/TelnetConnectionFields";
import { UrlConnectionFields, UrlConnectionOptions } from "./connection-dialog/UrlConnectionFields";
import { parseUrlProxyDraft, type UrlProxyMode } from "./webview/urlProxy";
import { VncConnectionFields, VncConnectionOptions } from "./connection-dialog/VncConnectionFields";
import { ImportDialog } from "./ImportDialog";
import {
  isChildConnectionRowActive,
  loadStoredChildConnections,
  persistStoredChildConnections,
  syncChildConnectionsFromTabs,
} from "./childConnections";
import {
  resolveDefaultTerminalAppearance,
  supportsTerminalAppearanceDefaults,
} from "./terminalAppearanceDefaults";
import { elevatedLocalShellAction, findMatchingConnection, nextQuickConnectName, quickConnectRecentLabel } from "./quickConnectMenuModel";
import {
  CONNECTION_TAB_CONTEXT_MENU_EVENT,
  type ConnectionTabContextMenuDetail,
} from "./connectionTabContextMenu";
import { buildFileViewConnectionDraftFromPath } from "./fileViewConnectionDraft";
import { buildLocalFilesConnectionDraftFromPath } from "./localFilesConnectionDraft";
import { dragHasConnectionPaths, readConnectionPathsDrag } from "./connectionPathsDrag";
import {
  connectionRequestNeedsCredentialStoreUnlock,
  shouldDeleteSshSocksProxySecret,
} from "./credentialUnlockPreflight";
import { confirmTrustedSshHostKey, connectionPasswordOwnerId, connectionSshSocksProxyPasswordOwnerId, defaultPortForConnectionType, connectionTypeLabel, ftpPortForProtocolSelection, isRemoteDesktopConnectionType, localShellOptionsForPlatform, resolveSshSocksProxyRequest, uniqueRuntimeId, type LocalShellOption } from "./utils";
import { RECENT_CONNECTION_LIMIT, loadCollapsedFolderIds, loadRecentConnectionIds, notifyConnectionTreeInvalidated, saveCollapsedFolderIds, saveRecentConnectionIds } from "./connectionSidebarState";
import { collectConnectionFolderIds, countConnections, countFolders, filterConnectedConnections, filterConnectionTree, findConnectionInTree, flattenConnections, flattenFolders, visibleFlatConnections as flattenVisibleConnections, withLiveConnectionStatuses } from "./treeUtils";
import { WorkspaceIcon } from "../workspaceIcons";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, CircleDot, Folder, FolderPlus, KeyRound, LayoutDashboard, List, Maximize2, Minimize2, PanelsTopLeft, PanelRight, Pencil, Pin, PinOff, Play, Plus, Radio, RotateCcw, Save, Search, Settings, SquarePlus, Trash2, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ModuleHeader,
  ModuleHeaderLead,
  ModuleHeaderTitle,
  ModuleIconTile,
} from "../../../app/ModuleHeader";
import i18next from "../../../i18n/config";
import { ariaExpanded, dialogButtonAria } from "../../../lib/aria";
import { requestCredentialUnlock } from "../../../lib/credentialUnlock";
import { nativeMenuIcons } from "../../../lib/nativeMenuIcons";
import { lockOsIconAutoDetect } from "../../../lib/osIcons";
import { showNativeContextMenu, type NativeContextMenuItem } from "../../../lib/nativeContextMenu";
import { confirmNativeDialog, invokeCommand, isCredentialUnlockRequiredError, isTauriRuntime, selectAppLauncherFolder, selectFileViewPath, selectKeyFile, type TmuxSession } from "../../../lib/tauri";
import { connectionTree } from "../../../app-defaults";
import { DeleteConfirmationDialog } from "../../../app/DeleteConfirmationDialog";
import { DialogPortal } from "../../../app/DialogPortal";
import { LegacyDialogActions } from "../../../app/ui/dialog";
import { pushTrayMenu } from "../../../app/trayMenu";
import { CHILD_CONNECTION_CLOSED_EVENT, DEFAULT_WORKSPACE_ID, appendTmuxSessionId, useWorkspaceStore } from "../../../store";
import type { Connection, ConnectionFolder, ConnectionStatus, ConnectionTree, ConnectionType, CreateConnectionRequest, RdpSettings, SplitDirection, SshCompressionMode, SshSettings, StoredCredentialSummary, UpdateConnectionRequest, VncSettings, WorkspaceChildConnection, WorkspaceTab } from "../../../types";

// Pointer travel (px, either axis) before a press is treated as a drag rather
// than a click. Kept above ordinary click jitter so selecting a row never
// requires a second click.
const DRAG_START_THRESHOLD_PX = 8;
const WORKSPACE_HEADER_ICON_SIZE = 16;
const WORKSPACE_HEADER_ICON_SHELL_SIZE = 26;

type DraggedTreeItem =
  | { kind: "folder"; folderId: string }
  | { kind: "connection"; connectionId: string };

type TreeDropTarget =
  | { kind: "root"; targetIndex: number }
  | { kind: "folder"; folderId: string; targetIndex: number }
  | {
      kind: "connection";
      folderId?: string;
      connectionId: string;
      targetIndex: number;
    };

type TreeDragPreview = {
  kind: "folder" | "connection";
  title: string;
  subtitle?: string;
  connectionType?: ConnectionType;
  connectionStatus?: ConnectionStatus;
  connectionCount?: number;
  iconDataUrl?: string | null;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
};

// A docking target on the Workspace Canvas resolved while dragging a Connection
// out of the tree: either split a specific pane in a direction, or open as a new
// Tab on an empty canvas. `rect` is the target's viewport bounds for the overlay.
type DockRect = { left: number; top: number; width: number; height: number };
type CanvasDropZone =
  | {
      kind: "split";
      tabId: string;
      paneId: string;
      direction: SplitDirection;
      rect: DockRect;
    }
  | { kind: "empty"; rect: DockRect };

// Pick the edge of `bounds` nearest the pointer using normalized distances, so
// dropping near a corner snaps to the closer axis (VS-style docking).
function nearestEdgeDirection(bounds: DOMRect, x: number, y: number): SplitDirection {
  const nx = (x - bounds.left) / bounds.width;
  const ny = (y - bounds.top) / bounds.height;
  const distances: Array<[SplitDirection, number]> = [
    ["left", nx],
    ["right", 1 - nx],
    ["up", ny],
    ["down", 1 - ny],
  ];
  return distances.reduce((nearest, entry) => (entry[1] < nearest[1] ? entry : nearest))[0];
}

function normalizeLocalPathForNameComparison(path: string) {
  return path.trim().replace(/[\\/]+$/g, "");
}

function localFilesDefaultNameForDirectory(directory: string, t: TFunction, homeDirectory = "") {
  const normalized = normalizeLocalPathForNameComparison(directory);
  const normalizedHome = normalizeLocalPathForNameComparison(homeDirectory);
  if (!normalized || (normalizedHome && normalized.toLocaleLowerCase() === normalizedHome.toLocaleLowerCase())) {
    return t("connections.homeDirectory");
  }
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || t("connections.localFiles");
}

function fileViewDefaultNameForPath(filePath: string, t: TFunction) {
  const normalized = normalizeLocalPathForNameComparison(filePath);
  if (!normalized) {
    return t("connections.fileView");
  }
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || t("connections.fileView");
}

function connectionTreeDisplayName(connection: Connection, t: TFunction) {
  if (
    connection.type === "localFiles" &&
    !connection.localStartupDirectory?.trim() &&
    ["File Explorer", t("connections.localFiles")].includes(connection.name.trim())
  ) {
    return t("connections.homeDirectory");
  }
  return connection.name;
}

type PendingFolderDraft = {
  parentFolderId?: string;
};

type TreeContextMenuState =
  | {
      kind: "tree";
      x: number;
      y: number;
    }
  | {
      kind: "folder";
      folder: ConnectionFolder;
      x: number;
      y: number;
    }
  | {
      kind: "connection";
      connection: Connection;
      folderId?: string;
      x: number;
      y: number;
    };

type EditConnectionState = {
  connection: Connection;
  folderId?: string;
};

type InlineRenameTarget =
  | { kind: "connection"; id: string }
  | { kind: "folder"; id: string };

type DeleteTarget =
  | { kind: "connection"; connection: Connection }
  | { kind: "folder"; folder: ConnectionFolder };

type TransferSshPublicKeyDialogState = {
  connection: Connection;
  keyPath?: string;
};

type ConnectionDialogRequest = CreateConnectionRequest & {
  iconDataUrl?: string | null;
  iconBackgroundColor?: string | null;
  password?: string;
  passwordCredentialId?: string;
  keyPassphrase?: string;
  sshSocksProxyPassword?: string;
  urlCredentialUsername?: string;
  urlPassword?: string;
  // UI-only: persisted client-side (localStorage) after the Connection id is known,
  // never sent to the backend create/update request.
  sshStartupScriptApplyToExistingTmux?: boolean;
};

type ChildConnectionPropertiesState = {
  child: WorkspaceChildConnection;
  connection: Connection;
};

type FolderIconDialogState = {
  folder: ConnectionFolder;
};

export function ConnectionSidebar({
  onExternalOpenConnection,
  onTogglePanel,
}: {
  onExternalOpenConnection?: () => void;
  onTogglePanel?: () => void;
}) {
  const { i18n, t } = useTranslation();
  const query = useWorkspaceStore((state) => state.query);
  const setQuery = useWorkspaceStore((state) => state.setQuery);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore((state) =>
    state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId),
  );
  const panelTitle =
    activeWorkspace?.isDefault || activeWorkspaceId === DEFAULT_WORKSPACE_ID
      ? t("workspace.defaultWorkspaceTitle")
      : activeWorkspace?.name || t("connections.title");
  const workspaceHeaderTileClassName =
    activeWorkspace?.isDefault || activeWorkspaceId === DEFAULT_WORKSPACE_ID
      ? undefined
      : "sidebar-workspace-custom-icon-tile";
  // Keep the search input bound to `query` for instant typing, but drive the
  // expensive full-tree filter off a deferred value so large trees don't
  // re-filter on every keystroke.
  const deferredQuery = useDeferredValue(query);
  const openConnection = useWorkspaceStore((state) => state.openConnection);
  const openConnectionInNewTab = useWorkspaceStore((state) => state.openConnectionInNewTab);
  const openChildConnectionInNewTab = useWorkspaceStore((state) => state.openChildConnectionInNewTab);
  const openChildConnectionLayout = useWorkspaceStore((state) => state.openChildConnectionLayout);
  const openConnectionsInPanorama = useWorkspaceStore((state) => state.openConnectionsInPanorama);
  const updateOpenChildConnectionMetadata = useWorkspaceStore((state) => state.updateOpenChildConnectionMetadata);
  const refreshOpenConnectionMetadata = useWorkspaceStore((state) => state.refreshOpenConnectionMetadata);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const closeChildConnection = useWorkspaceStore((state) => state.closeChildConnection);
  const setFocusedPane = useWorkspaceStore((state) => state.setFocusedPane);
  const maximizeChildConnectionPane = useWorkspaceStore((state) => state.maximizeChildConnectionPane);
  const addConnectionToTerminalPane = useWorkspaceStore((state) => state.addConnectionToTerminalPane);
  const saveConnectionLayout = useWorkspaceStore((state) => state.saveConnectionLayout);
  const resetConnectionLayout = useWorkspaceStore((state) => state.resetConnectionLayout);
  const activeSessionCounts = useWorkspaceStore((state) => state.activeSessionCounts);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const setGeneralSettings = useWorkspaceStore((state) => state.setGeneralSettings);
  const sshSettings = useWorkspaceStore((state) => state.sshSettings);
  const terminalSettings = useWorkspaceStore((state) => state.terminalSettings);
  const rdpSettings = useWorkspaceStore((state) => state.rdpSettings);
  const vncSettings = useWorkspaceStore((state) => state.vncSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [tree, setTree] = useState<ConnectionTree>(connectionTree);
  const [formMode, setFormMode] = useState<"save" | "quick" | null>(null);
  const [newConnectionType, setNewConnectionType] = useState<ConnectionType | null>(null);
  const [formError, setFormError] = useState("");
  const [treeError, setTreeError] = useState("");
  const [addConnectionMenuOpen, setAddConnectionMenuOpen] = useState(false);
  const [quickConnectMenuOpen, setQuickConnectMenuOpen] = useState(false);
  const [recentConnectionIds, setRecentConnectionIds] = useState(loadRecentConnectionIds);
  const [dropTarget, setDropTarget] = useState("");
  // Highlight shown while an OS file/folder is dragged over the tree, before it
  // is dropped to create a Document/File Explorer Connection.
  const [externalFileDropActive, setExternalFileDropActive] = useState(false);
  const [dragPreview, setDragPreview] = useState<TreeDragPreview | null>(null);
  const [draggedSourceId, setDraggedSourceId] = useState("");
  const [canvasDropZone, setCanvasDropZone] = useState<CanvasDropZone | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(loadCollapsedFolderIds);
  const [pendingFolderDraft, setPendingFolderDraft] = useState<PendingFolderDraft | null>(null);
  const [inlineRenameTarget, setInlineRenameTarget] = useState<InlineRenameTarget | null>(null);
  const [inlineChildRenameTarget, setInlineChildRenameTarget] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const [childConnections, setChildConnections] = useState<WorkspaceChildConnection[]>(loadStoredChildConnections);
  const [childProperties, setChildProperties] = useState<ChildConnectionPropertiesState | null>(null);
  const [folderIconDialog, setFolderIconDialog] = useState<FolderIconDialogState | null>(null);
  const [editConnection, setEditConnection] = useState<EditConnectionState | null>(null);
  const [transferSshPublicKeyDialog, setTransferSshPublicKeyDialog] =
    useState<TransferSshPublicKeyDialogState | null>(null);
  const [transferSshPublicKeyError, setTransferSshPublicKeyError] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<DeleteTarget | null>(null);
  // Ephemeral filter: only show connections with a live session. Not persisted
  // because "currently connected" is meaningless across restarts.
  const [showConnectedOnly, setShowConnectedOnly] = useState(false);
  const showAllConnections = generalSettings.showAllConnectionsInTree;
  const showChildTabsInTree = generalSettings.hideTopTabButtons;
  const reusableChildIconDataUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const connection of flattenConnections(tree)) {
      if (connection.iconDataUrl) {
        urls.add(connection.iconDataUrl);
      }
    }
    for (const { folder } of flattenFolders(tree.folders)) {
      if (folder.iconDataUrl) {
        urls.add(folder.iconDataUrl);
      }
    }
    for (const child of childConnections) {
      if (child.iconDataUrl) {
        urls.add(child.iconDataUrl);
      }
    }
    return [...urls];
  }, [childConnections, tree]);
  const addConnectionRef = useRef<HTMLDivElement | null>(null);
  const quickConnectRef = useRef<HTMLDivElement | null>(null);
  const treeListRef = useRef<HTMLDivElement | null>(null);
  const draggedItemRef = useRef<DraggedTreeItem | null>(null);
  const pointerDragTargetRef = useRef<TreeDropTarget | null>(null);
  const canvasDropTargetRef = useRef<CanvasDropZone | null>(null);
  const pointerDragListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    stop: (event: PointerEvent) => void;
  } | null>(null);
  const suppressTreeClickRef = useRef(false);

  useEffect(() => {
    const handleTreeInvalidated = () => {
      void reloadConnectionGroups();
    };
    window.addEventListener("kkterm:connection-tree-invalidated", handleTreeInvalidated);
    const unlistenPromise = isTauriRuntime()
      ? listen("connection-tree-changed", handleTreeInvalidated)
      : Promise.resolve(() => {});
    return () => {
      window.removeEventListener("kkterm:connection-tree-invalidated", handleTreeInvalidated);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // The tree always reflects the active Workspace. Reload whenever it changes
  // (initial mount included) so activating a Tab from another Workspace in the
  // activity rail — which switches Workspaces without touching the tree — still
  // updates the tree, rather than relying solely on the invalidation event.
  useEffect(() => {
    void reloadConnectionGroups();
  }, [activeWorkspaceId]);

  useEffect(() => {
    persistStoredChildConnections(childConnections);
  }, [childConnections]);

  useEffect(() => {
    function handleChildConnectionClosed(event: Event) {
      const detail = (event as CustomEvent<{ childConnectionId?: string }>).detail;
      if (!detail?.childConnectionId) {
        return;
      }
      setChildConnections((current) =>
        current.filter((child) => child.id !== detail.childConnectionId),
      );
    }

    window.addEventListener(CHILD_CONNECTION_CLOSED_EVENT, handleChildConnectionClosed);
    return () =>
      window.removeEventListener(CHILD_CONNECTION_CLOSED_EVENT, handleChildConnectionClosed);
  }, []);

  useEffect(() => {
    if (!showChildTabsInTree) {
      return;
    }
    setChildConnections((current) => syncChildConnectionsFromTabs(current, tabs));
  }, [showChildTabsInTree, tabs]);

  useEffect(() => {
    function handleConnectionTabContextMenu(event: Event) {
      const detail = (event as CustomEvent<ConnectionTabContextMenuDetail>).detail;
      if (!detail?.connection) {
        return;
      }
      void openTreeContextMenu({
        kind: "connection",
        connection: detail.connection,
        x: detail.x,
        y: detail.y,
      });
    }

    window.addEventListener(CONNECTION_TAB_CONTEXT_MENU_EVENT, handleConnectionTabContextMenu);
    return () => {
      window.removeEventListener(CONNECTION_TAB_CONTEXT_MENU_EVENT, handleConnectionTabContextMenu);
    };
  });

  useEffect(() => {
    saveCollapsedFolderIds(collapsedFolderIds);
  }, [collapsedFolderIds]);

  useEffect(() => {
    if (!quickConnectMenuOpen && !addConnectionMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const quickConnectNode = quickConnectRef.current;
      const addConnectionNode = addConnectionRef.current;
      if (quickConnectNode && !quickConnectNode.contains(target)) {
        setQuickConnectMenuOpen(false);
      }
      if (addConnectionNode && !addConnectionNode.contains(target)) {
        setAddConnectionMenuOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuickConnectMenuOpen(false);
        setAddConnectionMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [addConnectionMenuOpen, quickConnectMenuOpen]);

  useEffect(
    () => () => {
      removePointerDragListeners();
    },
    [],
  );


  async function reloadConnectionGroups() {
    try {
      setTree(
        await invokeCommand("list_connection_tree", {
          workspaceId: useWorkspaceStore.getState().activeWorkspaceId,
        }),
      );
    } catch {
      setTree(connectionTree);
    }
  }

  async function handleConnectionSaved() {
    await reloadConnectionGroups();
    notifyConnectionTreeInvalidated();
    setFormMode(null);
    setNewConnectionType(null);
    setFormError("");
    setTreeError("");
  }

  function showConnectionSuccessStatus(message: string) {
    showStatusBarNotice(message, {
      tone: "success",
    });
  }

  function quickConnectionCreateRequest(connection: Connection): CreateConnectionRequest {
    return {
      name: connection.name,
      host: connection.host,
      user: connection.user,
      type: connection.type,
      workspaceId: useWorkspaceStore.getState().activeWorkspaceId,
      port: connection.port,
      keyPath: connection.keyPath,
      proxyJump: connection.proxyJump,
      sshSocksProxy: connection.sshSocksProxy,
      sshSocksProxyUsername: connection.sshSocksProxyUsername,
      sshSocksProxyInheritDefaults: connection.sshSocksProxyInheritDefaults,
      authMethod: connection.authMethod,
      localShell: connection.localShell,
      localStartupDirectory: connection.localStartupDirectory,
      localStartupScript: connection.localStartupScript,
      url: connection.url,
      dataPartition: connection.dataPartition,
      urlProxy: connection.urlProxy,
      urlProxyInheritDefaults: connection.urlProxyInheritDefaults,
      useTmuxSessions: connection.useTmuxSessions,
    };
  }

  // Quick Connect persists its target as a saved connection (reusing an identical
  // existing one when present), then opens it — so the sidebar tree only ever
  // holds real database connections. Throws on backend failure; callers route the
  // error to the appropriate surface. Returns the opened connection.
  async function quickConnect(
    candidate: Connection,
    creds?: { password?: string; passwordCredentialId?: string | null; keyPassphrase?: string; sshSocksProxyPassword?: string },
  ): Promise<Connection> {
    if (!isTauriRuntime()) {
      openConnection(candidate);
      rememberConnection(candidate);
      return candidate;
    }

    let currentConnections = flattenConnections(treeRef.current);
    try {
      const freshTree = await invokeCommand("list_connection_tree", {
        workspaceId: useWorkspaceStore.getState().activeWorkspaceId,
      });
      currentConnections = flattenConnections(freshTree);
    } catch {
      // Fall back to the last rendered tree; create_connection will still report
      // any backend error.
    }

    const existing = findMatchingConnection(currentConnections, candidate);
    if (existing) {
      let connection = existing;
      if (creds?.password) {
        connection = await createConnectionPasswordCredential(connection.id, creds.password);
        await reloadConnectionGroups();
      } else if (creds?.passwordCredentialId) {
        connection = await assignConnectionPasswordCredential(connection.id, creds.passwordCredentialId);
        await reloadConnectionGroups();
      }
      await saveSshSocksProxyPassword(connection, creds?.sshSocksProxyPassword);
      await saveConnectionPassphrase(connection, creds?.keyPassphrase);
      openConnection(connection);
      rememberConnection(connection);
      return connection;
    }

    const createRequest = quickConnectionCreateRequest({
      ...candidate,
      name: nextQuickConnectName(currentConnections, candidate.name),
    });
    let connection = await invokeCommand("create_connection", {
      request: createRequest,
    });
    if (creds?.password) {
      connection = await createConnectionPasswordCredential(connection.id, creds.password);
    } else if (creds?.passwordCredentialId) {
      connection = await assignConnectionPasswordCredential(connection.id, creds.passwordCredentialId);
    }
    await saveSshSocksProxyPassword(connection, creds?.sshSocksProxyPassword);
    await saveConnectionPassphrase(connection, creds?.keyPassphrase);
    await reloadConnectionGroups();
    notifyConnectionTreeInvalidated();
    openConnection(connection);
    rememberConnection(connection);
    return connection;
  }

  function handleNewConnectionTypeSelected(connectionType: ConnectionType) {
    if (connectionType === "fileView") {
      void handleNewFileViewConnectionSelected();
      return;
    }
    setAddConnectionMenuOpen(false);
    setQuickConnectMenuOpen(false);
    setFormError("");
    setTreeError("");
    setNewConnectionType(connectionType);
    setFormMode("save");
  }

  async function handleNewFileViewConnectionSelected() {
    setAddConnectionMenuOpen(false);
    setQuickConnectMenuOpen(false);
    setFormError("");
    const selectedPath = await selectFileViewPath({
      title: t("connections.fileViewPickerTitle"),
    });
    if (!selectedPath) {
      return;
    }

    try {
      const { iconDataUrl, ...request } = buildFileViewConnectionDraftFromPath(selectedPath, {
        workspaceId: useWorkspaceStore.getState().activeWorkspaceId,
      });
      const connection = await invokeCommand("create_connection", {
        request,
      });
      await saveConnectionIconPresentation(connection, iconDataUrl, null);
      await handleConnectionSaved();
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }

  // HTML5 drag from a File Explorer Connection pane (real local paths) over the
  // tree: highlight while the drag carries droppable paths. The native Tauri
  // drag-drop handler is disabled app-wide (required for HTML5 DnD on Windows),
  // so OS file drops never raise Tauri drag events and are handled here instead.
  function handleTreePathsDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!dragHasConnectionPaths(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setExternalFileDropActive(true);
  }

  function handleTreePathsDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    // Ignore moves between descendant rows; only clear when the pointer actually
    // leaves the tree list.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setExternalFileDropActive(false);
  }

  function handleTreePathsDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!dragHasConnectionPaths(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    setExternalFileDropActive(false);
    const paths = readConnectionPathsDrag(event.dataTransfer);
    if (paths.length > 0) {
      void handleExternalPathsDropped(paths);
    }
  }

  // Create a Connection per dropped path: folders become File Explorer
  // Connections with default settings (named after the last folder segment),
  // files become Document Connections — matching the Add Connection flows.
  async function handleExternalPathsDropped(paths: string[]) {
    if (!isTauriRuntime()) {
      return;
    }
    const uniquePaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    if (uniquePaths.length === 0) {
      return;
    }

    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    let created = 0;
    for (const path of uniquePaths) {
      try {
        const prepared = await invokeCommand("prepare_app_launcher_entry", { request: { path } });
        if (prepared.fileKind === "missing") {
          continue;
        }
        if (prepared.fileKind === "folder") {
          await invokeCommand("create_connection", {
            request: buildLocalFilesConnectionDraftFromPath(prepared.path, { workspaceId }),
          });
        } else {
          const { iconDataUrl, ...request } = buildFileViewConnectionDraftFromPath(prepared.path, {
            workspaceId,
          });
          const connection = await invokeCommand("create_connection", { request });
          await saveConnectionIconPresentation(connection, iconDataUrl, null);
        }
        created += 1;
      } catch (error) {
        setTreeError(error instanceof Error ? error.message : String(error));
      }
    }

    if (created > 0) {
      await reloadConnectionGroups();
      notifyConnectionTreeInvalidated();
    }
  }

  function handleQuickSshRequested() {
    setAddConnectionMenuOpen(false);
    setQuickConnectMenuOpen(false);
    setFormError("");
    setNewConnectionType("ssh");
    setFormMode("quick");
  }

  function handleImportRequested() {
    setAddConnectionMenuOpen(false);
    setFormError("");
    setNewConnectionType(null);
    setImportDialogOpen(true);
  }

  function rememberConnection(connection: Connection) {
    setRecentConnectionIds((currentIds) => {
      const nextIds = [
        connection.id,
        ...currentIds.filter((connectionId) => connectionId !== connection.id),
      ].slice(0, RECENT_CONNECTION_LIMIT);
      saveRecentConnectionIds(nextIds);
      return nextIds;
    });
  }

  function handleOpenConnection(connection: Connection, options?: { forceNewTab?: boolean }) {
    rememberConnection(connection);
    if (options?.forceNewTab) {
      void handleOpenConnectionInNewTab(connection);
      return;
    }
    const children = childrenForConnection(connection.id);
    if (children.length > 0) {
      openChildConnectionLayout(connection, children);
      return;
    }
    openConnection(connection);
  }

  function openTabsForConnection(connectionId: string) {
    return showChildTabsInTree
      ? tabs.filter((tab) => {
          const tabWorkspaceId = tab.workspaceId ?? DEFAULT_WORKSPACE_ID;
          return tab.connection?.id === connectionId && tabWorkspaceId === activeWorkspaceId;
        })
      : [];
  }

  function childrenForConnection(connectionId: string) {
    return showChildTabsInTree
      ? childConnections.filter((child) => {
          const childWorkspaceId = child.workspaceId ?? DEFAULT_WORKSPACE_ID;
          return child.parentConnectionId === connectionId && childWorkspaceId === activeWorkspaceId;
        })
      : [];
  }

  function updateChildConnection(child: WorkspaceChildConnection) {
    setChildConnections((current) =>
      current.map((entry) => (entry.id === child.id ? child : entry)),
    );
    updateOpenChildConnectionMetadata(child);
  }

  async function createChildConnection(connection: Connection) {
    const existing = childConnections.filter((child) => child.parentConnectionId === connection.id);
    const appearance = supportsTerminalAppearanceDefaults(connection.type)
      ? resolveDefaultTerminalAppearance(connection.type, sshSettings, terminalSettings)
      : null;
    const tmuxSessionId =
      connection.type === "ssh" && connection.useTmuxSessions !== false
        ? (await preferredTmuxSessionIdForNewTab(connection)) ?? appendTmuxSessionId(connection)
        : connection.type === "local" && connection.usePsmuxSessions === true
          ? appendTmuxSessionId(connection)
          : undefined;
    const name = tmuxSessionId || `${connection.name}#${existing.length + 1}`;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${connection.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const child: WorkspaceChildConnection = {
      id,
      workspaceId: activeWorkspaceId,
      parentConnectionId: connection.id,
      name,
      tmuxSessionId,
      cwd: connection.type === "local" ? connection.localStartupDirectory?.trim() || "." : "~",
      terminalOpacity: appearance?.terminalOpacity,
      terminalBackground: appearance?.terminalBackground,
    };
    setChildConnections((current) => [...current, child]);
    return child;
  }

  async function handleOpenConnectionInNewTab(connection: Connection) {
    rememberConnection(connection);
    if (showChildTabsInTree) {
      const child = await createChildConnection(connection);
      openChildConnectionInNewTab(connection, child);
      return;
    }
    const tmuxSessionId = await preferredTmuxSessionIdForNewTab(connection);
    const appearance = supportsTerminalAppearanceDefaults(connection.type)
      ? resolveDefaultTerminalAppearance(connection.type, sshSettings, terminalSettings)
      : null;
    openConnectionInNewTab(connection, {
      tmuxSessionId,
      terminalOpacity: appearance?.terminalOpacity,
      terminalBackground: appearance?.terminalBackground,
    });
  }

  function handleOpenChildConnection(connection: Connection, child: WorkspaceChildConnection) {
    const existingChildLocation = tabs.flatMap((tab) =>
      (tab.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWorkspaceId
        ? tab.panes
            .filter((pane) => pane.childConnectionId === child.id)
            .map((pane) => ({ tab, pane }))
        : [],
    )[0];
    if (existingChildLocation) {
      if (existingChildLocation.tab.childConnectionGroupParentId) {
        maximizeChildConnectionPane(existingChildLocation.tab.id, existingChildLocation.pane.id);
      } else {
        activateTab(existingChildLocation.tab.id);
        setFocusedPane(existingChildLocation.tab.id, existingChildLocation.pane.id);
      }
      onExternalOpenConnection?.();
      return;
    }
    rememberConnection(connection);
    openChildConnectionInNewTab(connection, child);
  }

  function handleRenameChildConnection(child: WorkspaceChildConnection, name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return false;
    }
    updateChildConnection({ ...child, name: trimmedName });
    return true;
  }

  function handleCloseChildConnection(childConnectionId: string) {
    closeChildConnection(childConnectionId);
    setChildConnections((current) =>
      current.filter((child) => child.id !== childConnectionId),
    );
  }

  async function handleChildContextMenu(
    connection: Connection,
    child: WorkspaceChildConnection,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    await showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("connections.rename"),
          iconSvg: nativeMenuIcons.pencil,
          action: () => setInlineChildRenameTarget(child.id),
        },
        {
          kind: "item",
          label: t("connections.properties"),
          iconSvg: nativeMenuIcons.settings,
          action: () => setChildProperties({ child, connection }),
        },
        {
          kind: "separator",
        },
        {
          kind: "item",
          label: t("common.close"),
          iconSvg: nativeMenuIcons.x,
          action: () => handleCloseChildConnection(child.id),
        },
      ],
      { x: event.clientX, y: event.clientY },
    );
  }

  async function preferredTmuxSessionIdForNewTab(connection: Connection) {
    if (connection.type !== "ssh" || connection.useTmuxSessions === false) {
      return undefined;
    }

    try {
      const openSessionIds = openTmuxSessionIdsForConnection(connection.id);
      const sessions = await invokeCommand("list_tmux_sessions", {
        request: {
          host: connection.host,
          user: connection.user,
          port: connection.port,
          keyPath: connection.keyPath,
          proxyJump: connection.proxyJump,
          ...resolveSshSocksProxyRequest(connection, sshSettings),
          authMethod: connection.authMethod,
          secretOwnerId: connectionPasswordOwnerId(connection),
        },
      });
      return newestUnattachedTmuxSession(sessions, openSessionIds)?.id;
    } catch {
      return undefined;
    }
  }

  function openTmuxSessionIdsForConnection(connectionId: string) {
    const sessionIds = new Set<string>();
    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (pane.connection?.id === connectionId && "tmuxSessionId" in pane && pane.tmuxSessionId) {
          sessionIds.add(pane.tmuxSessionId);
        }
      }
    }
    for (const child of childConnections) {
      if (child.parentConnectionId === connectionId && child.tmuxSessionId) {
        sessionIds.add(child.tmuxSessionId);
      }
    }
    return sessionIds;
  }

  async function updatePinnedRailConnections(
    nextPinnedConnectionIds: string[],
    successMessage: string,
  ) {
    const previousSettings = generalSettings;
    const nextSettings = {
      ...previousSettings,
      pinnedConnectionIds: nextPinnedConnectionIds,
    };
    setGeneralSettings(nextSettings);
    try {
      const saved = isTauriRuntime()
        ? await invokeCommand("update_general_settings", { request: nextSettings })
        : nextSettings;
      setGeneralSettings(saved);
      showStatusBarNotice(successMessage, { tone: "success" });
    } catch (error) {
      setGeneralSettings(previousSettings);
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("connections.pinRailError", { message }), {
        tone: "error",
      });
    }
  }

  async function handleToggleShowAllConnections() {
    const previousSettings = generalSettings;
    const nextSettings = {
      ...previousSettings,
      showAllConnectionsInTree: !previousSettings.showAllConnectionsInTree,
    };
    setGeneralSettings(nextSettings);
    try {
      const saved = isTauriRuntime()
        ? await invokeCommand("update_general_settings", { request: nextSettings })
        : nextSettings;
      setGeneralSettings(saved);
    } catch (error) {
      setGeneralSettings(previousSettings);
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleToggleRailPin(connection: Connection) {
    if (generalSettings.pinnedConnectionIds.includes(connection.id)) {
      await updatePinnedRailConnections(
        generalSettings.pinnedConnectionIds.filter((connectionId) => connectionId !== connection.id),
        t("connections.unpinnedFromRailStatus", { name: connection.name }),
      );
      return;
    }

    await updatePinnedRailConnections(
      [
        ...generalSettings.pinnedConnectionIds.filter((connectionId) => connectionId !== connection.id),
        connection.id,
      ],
      t("connections.pinnedToRailStatus", { name: connection.name }),
    );
  }

  async function addConnectionToPaneWithChildMode(
    tabId: string,
    connection: Connection,
    direction: SplitDirection,
    targetPaneId?: string,
  ) {
    rememberConnection(connection);
    if (!showChildTabsInTree) {
      addConnectionToTerminalPane(tabId, connection, direction, targetPaneId);
      return;
    }
    const child = await createChildConnection(connection);
    addConnectionToTerminalPane(tabId, connection, direction, targetPaneId, {
      childConnectionId: child.id,
      cwd: child.cwd,
      iconBackgroundColor: child.iconBackgroundColor,
      iconDataUrl: child.iconDataUrl,
      fontSize: child.fontSize,
      terminalOpacity: child.terminalOpacity,
      terminalBackground: child.terminalBackground,
      title: child.tmuxSessionId ?? child.name,
      toolbarTitle: child.name,
      tmuxSessionId: child.tmuxSessionId,
    });
  }

  async function handleAddConnectionToFocusedPane(connection: Connection, direction: SplitDirection) {
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (!supportsAddConnectionToTab(activeTab)) {
      handleOpenConnection(connection);
      return;
    }
    await addConnectionToPaneWithChildMode(activeTab.id, connection, direction);
  }

  async function handleTransferSshPublicKey(username: string, password: string) {
    if (!transferSshPublicKeyDialog) {
      return;
    }
    const { connection, keyPath } = transferSshPublicKeyDialog;
    setTreeError("");
    setTransferSshPublicKeyError("");
    if (connection.proxyJump?.trim()) {
      setTransferSshPublicKeyError(t("connections.transferSshPublicKeyProxyJumpUnsupported"));
      return;
    }
    try {
      const hostKeyPreview = await invokeCommand("inspect_ssh_host_key", {
        request: {
          host: connection.host,
          port: connection.port,
          ...resolveSshSocksProxyRequest(connection, sshSettings),
        },
      });
      await confirmTrustedSshHostKey(hostKeyPreview);
      const result = await invokeCommand("transfer_ssh_public_key", {
        request: {
          host: connection.host,
          port: connection.port,
          username,
          password,
          keyPath,
          proxyJump: connection.proxyJump,
          ...resolveSshSocksProxyRequest(connection, sshSettings),
        },
      });
      setTransferSshPublicKeyDialog(null);
      showConnectionSuccessStatus(t("connections.transferSshPublicKeyComplete", { path: result.publicKeyPath }));
    } catch (error) {
      setTransferSshPublicKeyError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleQuickLocalShell(option: LocalShellOption) {
    setQuickConnectMenuOpen(false);
    const appearance = resolveDefaultTerminalAppearance("local", sshSettings, terminalSettings);
    const connection: Connection = {
      id: uniqueRuntimeId("quick"),
      name: option.label,
      host: "localhost",
      user: "local",
      type: "local",
      localShell: option.value,
      terminalOpacity: appearance.terminalOpacity,
      terminalBackground: appearance.terminalBackground,
      status: "idle",
    };
    void quickConnect(connection).catch((error) => {
      setTreeError(error instanceof Error ? error.message : String(error));
    });
  }

  function handleQuickSsh(connection: Connection) {
    setQuickConnectMenuOpen(false);
    void quickConnect(connection).catch((error) => {
      setTreeError(error instanceof Error ? error.message : String(error));
    });
  }

  async function handleQuickAdminShell(option: LocalShellOption) {
    if (!option.value) {
      return;
    }

    setTreeError("");
    setQuickConnectMenuOpen(false);
    try {
      const isAppElevated = await invokeCommand("is_app_elevated", undefined).catch(() => false);
      const action = elevatedLocalShellAction({
        adminLabel: t("connections.admin"),
        isAppElevated,
        option,
      });

      if (action.mode === "external") {
        await invokeCommand("launch_elevated_terminal", { request: { shell: action.shell } });
        return;
      }

      const appearance = resolveDefaultTerminalAppearance("local", sshSettings, terminalSettings);
      await quickConnect({
        id: uniqueRuntimeId("quick"),
        name: action.name,
        host: "localhost",
        user: "local",
        type: "local",
        localShell: action.shell,
        terminalOpacity: appearance.terminalOpacity,
        terminalBackground: appearance.terminalBackground,
        status: "idle",
      });
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }

  async function storeUrlPassword(connectionId: string, password: string) {
    if (!isTauriRuntime()) {
      return;
    }

    await invokeCommand("store_secret", {
      request: {
        kind: "urlPassword",
        ownerId: connectionId,
        secret: password,
      },
    });
  }

  async function upsertUrlCredential(connectionId: string, username: string) {
    if (!isTauriRuntime()) {
      return;
    }

    await invokeCommand("upsert_url_credential", {
      request: {
        connectionId,
        username,
      },
    });
  }

  async function createConnectionPasswordCredential(connectionId: string, password: string) {
    return invokeCommand("create_connection_password_credential", {
      request: {
        connectionId,
        secret: password,
      },
    });
  }

  async function assignConnectionPasswordCredential(connectionId: string, credentialId: string) {
    return invokeCommand("assign_connection_password_credential", {
      request: {
        connectionId,
        credentialId,
      },
    });
  }

  async function ensureCredentialStoreReadyForConnectionRequest(
    request: ConnectionDialogRequest,
    existingConnection?: Connection,
  ) {
    let needsUnlock = connectionRequestNeedsCredentialStoreUnlock(request);
    if (existingConnection && request.type === "ssh") {
      const presence = await invokeCommand("secret_exists", {
        request: {
          kind: "sshSocksProxyPassword",
          ownerId: connectionSshSocksProxyPasswordOwnerId(existingConnection),
        },
      });
      needsUnlock ||= shouldDeleteSshSocksProxySecret({
        ...request,
        existingSecretExists: presence.exists,
      });
    }
    if (!needsUnlock || !isTauriRuntime()) {
      return true;
    }
    const status = await invokeCommand("credential_secret_store_status", undefined);
    if (status.selectedStore !== "file" || status.unlocked) {
      return true;
    }
    return requestCredentialUnlock();
  }

  function showConnectionFormError(error: unknown) {
    if (isCredentialUnlockRequiredError(error)) {
      return;
    }
    setFormError(error instanceof Error ? error.message : String(error));
  }

  async function saveSshSocksProxyPassword(connection: Connection, password?: string) {
    if (!isTauriRuntime() || connection.type !== "ssh") {
      return;
    }
    const ownerId = connectionSshSocksProxyPasswordOwnerId(connection);
    const hasPerConnectionAuth =
      connection.sshSocksProxyInheritDefaults === false &&
      Boolean(connection.sshSocksProxy?.trim()) &&
      Boolean(connection.sshSocksProxyUsername?.trim());
    if (hasPerConnectionAuth && password) {
      await invokeCommand("store_secret", {
        request: {
          kind: "sshSocksProxyPassword",
          ownerId,
          secret: password,
        },
      });
      return;
    }
    if (!hasPerConnectionAuth) {
      const presence = await invokeCommand("secret_exists", {
        request: {
          kind: "sshSocksProxyPassword",
          ownerId,
        },
      });
      if (!presence.exists) {
        return;
      }
      await invokeCommand("delete_secret", {
        request: {
          kind: "sshSocksProxyPassword",
          ownerId,
        },
      });
    }
  }

  async function saveConnectionPassphrase(connection: Connection, keyPassphrase?: string) {
    if (!isTauriRuntime() || connection.type !== "ssh" || !keyPassphrase) {
      return;
    }
    await invokeCommand("store_secret", {
      request: {
        kind: "connectionPassphrase",
        ownerId: connection.id,
        secret: keyPassphrase,
      },
    });
  }

  async function handleConnectionSubmit(request: ConnectionDialogRequest) {
    setFormError("");
    const { iconDataUrl, iconBackgroundColor, password, passwordCredentialId, keyPassphrase, sshSocksProxyPassword, urlCredentialUsername, urlPassword, sshStartupScriptApplyToExistingTmux, ...connectionRequest } = request;
    const appearance = supportsTerminalAppearanceDefaults(connectionRequest.type)
      ? resolveDefaultTerminalAppearance(connectionRequest.type, sshSettings, terminalSettings)
      : null;
    if (formMode === "save") {
      try {
        if (!(await ensureCredentialStoreReadyForConnectionRequest(request))) {
          return;
        }
        let connection = await invokeCommand("create_connection", {
          request: {
            ...connectionRequest,
            workspaceId: useWorkspaceStore.getState().activeWorkspaceId,
          },
        });
        if (appearance) {
          const updated = await invokeCommand("update_connection_terminal_appearance", {
            connectionId: connection.id,
            terminalOpacity: appearance.terminalOpacity,
            terminalBackground: appearance.terminalBackground,
          });
          connection = updated ?? {
            ...connection,
            terminalOpacity: appearance.terminalOpacity,
            terminalBackground: appearance.terminalBackground,
          };
        }
        connection = await saveConnectionIconPresentation(connection, iconDataUrl, iconBackgroundColor);
        if (password) {
          connection = await createConnectionPasswordCredential(connection.id, password);
        } else if (passwordCredentialId) {
          connection = await assignConnectionPasswordCredential(connection.id, passwordCredentialId);
        }
        await saveSshSocksProxyPassword(connection, sshSocksProxyPassword);
        await saveConnectionPassphrase(connection, keyPassphrase);
        if (connection.type === "url" && urlCredentialUsername && urlPassword) {
          await storeUrlPassword(connection.id, urlPassword);
          await upsertUrlCredential(connection.id, urlCredentialUsername);
        }
        if (connection.type === "ssh") {
          writeSshApplyStartupToExistingTmux(connection.id, Boolean(sshStartupScriptApplyToExistingTmux));
        }
        await handleConnectionSaved();
      } catch (error) {
        showConnectionFormError(error);
      }
      return;
    }

    const candidate: Connection = {
      id: uniqueRuntimeId("quick"),
      name:
        connectionRequest.name ||
        connectionRequest.host ||
        connectionRequest.url ||
        i18next.t("connections.quickSessionFallbackName"),
      host: connectionRequest.host ?? "",
      user: connectionRequest.user ?? "",
      port: connectionRequest.port,
      keyPath: connectionRequest.keyPath,
      proxyJump: connectionRequest.proxyJump,
      sshSocksProxy: connectionRequest.sshSocksProxy,
      sshSocksProxyUsername: connectionRequest.sshSocksProxyUsername,
      sshSocksProxyInheritDefaults: connectionRequest.sshSocksProxyInheritDefaults,
      authMethod: connectionRequest.authMethod,
      type: connectionRequest.type,
      localShell: connectionRequest.localShell,
      localStartupDirectory: connectionRequest.localStartupDirectory,
      localStartupScript: connectionRequest.localStartupScript,
      serialLine: connectionRequest.serialLine,
      serialSpeed: connectionRequest.serialSpeed,
      url: connectionRequest.url,
      dataPartition: connectionRequest.dataPartition,
      urlProxy: connectionRequest.urlProxy,
      urlProxyInheritDefaults: connectionRequest.urlProxyInheritDefaults,
      useTmuxSessions: connectionRequest.useTmuxSessions,
      terminalOpacity: appearance?.terminalOpacity,
      terminalBackground: appearance?.terminalBackground,
      fileViewOpenExternal: connectionRequest.fileViewOpenExternal,
      status: "idle",
    };

    try {
      if (!(await ensureCredentialStoreReadyForConnectionRequest(request))) {
        return;
      }
      await quickConnect(candidate, { password, passwordCredentialId, keyPassphrase, sshSocksProxyPassword });
      setFormMode(null);
      setNewConnectionType(null);
      setFormError("");
    } catch (error) {
      showConnectionFormError(error);
    }
  }

  async function handleConnectionUpdate(request: ConnectionDialogRequest) {
    if (!editConnection) {
      return;
    }

    setFormError("");
    const currentConnection = findConnectionInTree(treeRef.current, editConnection.connection.id);
    if (!currentConnection) {
      setFormError(t("connections.connectionNotFound"));
      return;
    }
    const { iconDataUrl, iconBackgroundColor, password, passwordCredentialId, keyPassphrase, sshSocksProxyPassword, urlCredentialUsername, urlPassword, sshStartupScriptApplyToExistingTmux, ...connectionRequest } = request;
    const updateRequest: UpdateConnectionRequest = {
      ...connectionRequest,
      id: currentConnection.connection.id,
      type: currentConnection.connection.type,
    };

    try {
      if (!(await ensureCredentialStoreReadyForConnectionRequest(request, currentConnection.connection))) {
        return;
      }
      let connection = await invokeCommand("update_connection", {
        request: updateRequest,
      });
      connection = await saveConnectionIconPresentation(connection, iconDataUrl, iconBackgroundColor);
      if (password) {
        connection = await createConnectionPasswordCredential(connection.id, password);
      } else if (passwordCredentialId) {
        connection = await assignConnectionPasswordCredential(connection.id, passwordCredentialId);
      }
      await saveSshSocksProxyPassword(connection, sshSocksProxyPassword);
      await saveConnectionPassphrase(connection, keyPassphrase);
      if (connection.type === "url" && urlPassword) {
        await storeUrlPassword(connection.id, urlPassword);
      }
      if (connection.type === "url" && urlCredentialUsername) {
        await upsertUrlCredential(connection.id, urlCredentialUsername);
      }
      if (connection.type === "ssh") {
        writeSshApplyStartupToExistingTmux(connection.id, Boolean(sshStartupScriptApplyToExistingTmux));
      }
      refreshOpenConnectionMetadata({
        ...connection,
        hasPassword: connection.hasPassword || Boolean(password) || Boolean(passwordCredentialId) || Boolean(connection.passwordCredentialId),
        passwordCredentialId: connection.passwordCredentialId ?? passwordCredentialId ?? currentConnection.connection.passwordCredentialId,
        urlCredentialUsername:
          connection.type === "url" && urlCredentialUsername
            ? urlCredentialUsername
            : connection.urlCredentialUsername,
        hasUrlCredential:
          connection.hasUrlCredential ||
          (connection.type === "url" && Boolean(urlCredentialUsername && urlPassword)),
      });
      await reloadConnectionGroups();
      notifyConnectionTreeInvalidated();
      setEditConnection(null);
    } catch (error) {
      showConnectionFormError(error);
    }
  }

  function handleCreateFolder(parentFolderId?: string) {
    setTreeError("");
    if (parentFolderId) {
      setCollapsedFolderIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(parentFolderId);
        return nextIds;
      });
    }
    setPendingFolderDraft({ parentFolderId });
  }

  function handleCancelPendingFolder() {
    setPendingFolderDraft(null);
  }

  async function handleCommitPendingFolder(name: string, parentFolderId?: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      handleCancelPendingFolder();
      return;
    }

    setPendingFolderDraft(null);
    await createFolder(trimmedName, parentFolderId);
  }

  async function createFolder(name: string, parentFolderId?: string) {
    if (!name) {
      return;
    }

    try {
      setTreeError("");
      await invokeCommand("create_connection_folder", {
        request: {
          name,
          parentFolderId,
          workspaceId: useWorkspaceStore.getState().activeWorkspaceId,
        },
      });
      await reloadConnectionGroups();
      notifyConnectionTreeInvalidated();
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }

  async function commitFolderRename(folder: ConnectionFolder, name: string) {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === folder.name) {
      setInlineRenameTarget(null);
      return true;
    }

    try {
      setTreeError("");
      await invokeCommand("rename_connection_folder", {
        request: { id: folder.id, name: trimmedName },
      });
      setInlineRenameTarget(null);
      await reloadConnectionGroups();
      notifyConnectionTreeInvalidated();
      return true;
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function saveConnectionIconDataUrl(
    connection: Connection,
    iconDataUrl: string | null | undefined,
  ) {
    const normalizedIconDataUrl = iconDataUrl ?? null;
    if ((connection.iconDataUrl ?? null) === normalizedIconDataUrl) {
      return connection;
    }
    // A deliberate icon change (including a reset to default) opts this
    // Connection out of SSH remote-OS auto-detection so it never overrides the
    // user's choice on later connects.
    lockOsIconAutoDetect(connection.id);
    const updated = await invokeCommand("update_connection_icon_data_url", {
      connectionId: connection.id,
      iconDataUrl: normalizedIconDataUrl,
    });
    return updated ?? { ...connection, iconDataUrl: normalizedIconDataUrl };
  }

  async function saveConnectionIconPresentation(
    connection: Connection,
    iconDataUrl: string | null | undefined,
    iconBackgroundColor: string | null | undefined,
  ) {
    const updatedConnection = await saveConnectionIconDataUrl(connection, iconDataUrl);
    const normalizedIconBackgroundColor = iconBackgroundColor ?? null;
    if ((updatedConnection.iconBackgroundColor ?? null) === normalizedIconBackgroundColor) {
      return updatedConnection;
    }
    const updated = await invokeCommand("update_connection_icon_background_color", {
      connectionId: updatedConnection.id,
      iconBackgroundColor: normalizedIconBackgroundColor,
    });
    return updated ?? { ...updatedConnection, iconBackgroundColor: normalizedIconBackgroundColor };
  }

  async function handleDeleteFolder(folder: ConnectionFolder) {
    try {
      setTreeError("");
      await invokeCommand("delete_connection_folder", {
        folderId: folder.id,
      });
      await reloadConnectionGroups();
      notifyConnectionTreeInvalidated();
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSaveFolderIcon(folder: ConnectionFolder, iconDataUrl: string | null) {
    try {
      setTreeError("");
      await invokeCommand("update_connection_folder_icon_data_url", {
        folderId: folder.id,
        iconDataUrl,
      });
      await reloadConnectionGroups();
      notifyConnectionTreeInvalidated();
      setFolderIconDialog(null);
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }

  async function commitConnectionRename(connection: Connection, name: string) {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === connection.name) {
      setInlineRenameTarget(null);
      return true;
    }

    if (connection.id.startsWith("quick-")) {
      // Non-persisted runtime connection: no database row to rename. Quick
      // Connect now persists connections, so this is defensive — it prevents
      // the backend "connection was not found" error from recurring here.
      setInlineRenameTarget(null);
      return true;
    }

    try {
      setTreeError("");
      const renamedConnection = await invokeCommand("rename_connection", {
        request: { id: connection.id, name: trimmedName },
      });
      refreshOpenConnectionMetadata(renamedConnection);
      setInlineRenameTarget(null);
      await reloadConnectionGroups();
      notifyConnectionTreeInvalidated();
      return true;
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function handleMoveFolder(
    folderId: string,
    parentFolderId: string | undefined,
    targetIndex: number,
  ) {
    try {
      setTreeError("");
      setTree(
        await invokeCommand("move_connection_folder", {
          request: { id: folderId, parentFolderId, targetIndex },
        }),
      );
      notifyConnectionTreeInvalidated();
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleMoveConnection(
    connectionId: string,
    folderId: string | undefined,
    targetIndex: number,
  ) {
    try {
      setTreeError("");
      setTree(
        await invokeCommand("move_connection", {
          request: { id: connectionId, folderId, targetIndex },
        }),
      );
      notifyConnectionTreeInvalidated();
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDeleteConnection(connection: Connection) {
    try {
      setTreeError("");
      await invokeCommand("delete_connection", {
        connectionId: connection.id,
      });
      closeOpenTabsForConnection(connection.id);
      await reloadConnectionGroups();
      notifyConnectionTreeInvalidated();
      showConnectionSuccessStatus(t("connections.deleteConnectionComplete", { name: connection.name }));
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }

  const treeWithLiveStatuses = useMemo(
    () => withLiveConnectionStatuses(tree, activeSessionCounts),
    [activeSessionCounts, tree],
  );

  const filteredTree = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return treeWithLiveStatuses;
    }

    return filterConnectionTree(treeWithLiveStatuses, normalizedQuery);
  }, [deferredQuery, treeWithLiveStatuses]);
  // The tree actually rendered: the search-filtered tree, optionally narrowed to
  // connected-only by the "Show Connected" filter. Both the folder view and the
  // "Hide Folders" flat view read from this so the two filters compose.
  const displayTree = useMemo(
    () => (showConnectedOnly ? filterConnectedConnections(filteredTree) : filteredTree),
    [filteredTree, showConnectedOnly],
  );
  const quickConnectShellOptions = useMemo(
    () => localShellOptionsForPlatform(terminalSettings.customShells),
    // localShellOptionsForPlatform resolves labels via i18next.t, so recompute on language change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n.language, terminalSettings.customShells],
  );
  const recentConnections = useMemo(() => {
    const connectionsById = new Map(
      flattenConnections(treeWithLiveStatuses).map((connection) => [connection.id, connection]),
    );
    return recentConnectionIds
      .map((connectionId) => connectionsById.get(connectionId))
      .filter((connection): connection is Connection => Boolean(connection))
      .slice(0, RECENT_CONNECTION_LIMIT);
  }, [recentConnectionIds, treeWithLiveStatuses]);

  // Tray menu only needs id+name, which don't change on session-count updates.
  // Depending on `recentConnections` directly fires an extra Tauri IPC on every
  // status change because `withLiveConnectionStatuses` shallow-clones every node.
  const trayMenuSignature = useMemo(
    () =>
      recentConnections.map((connection) => `${connection.id}\u0000${connection.name}`).join("\u0001"),
    [recentConnections],
  );
  useEffect(() => {
    void pushTrayMenu(recentConnections, {
      dontSleep: t("app.trayDontSleep"),
      exit: t("app.trayExit"),
    });
    // recentConnections is intentionally read fresh; we only resync when the
    // stable id/name signature or translations change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trayMenuSignature, t]);

  // Hold the latest tree in a ref so the Tauri listeners can be registered once
  // instead of resubscribing on every activeSessionCounts change.
  const treeRef = useRef(treeWithLiveStatuses);
  treeRef.current = treeWithLiveStatuses;
  const handleOpenConnectionRef = useRef(handleOpenConnection);
  handleOpenConnectionRef.current = handleOpenConnection;
  const onExternalOpenConnectionRef = useRef(onExternalOpenConnection);
  onExternalOpenConnectionRef.current = onExternalOpenConnection;

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const openConnectionById = (connectionId: string) => {
      const connection = flattenConnections(treeRef.current).find(
        (candidate) => candidate.id === connectionId,
      );
      if (connection) {
        onExternalOpenConnectionRef.current?.();
        handleOpenConnectionRef.current(connection);
      }
    };
    const unlistenTrayPromise = listen<string>("kkterm://tray-open-connection", (event) => {
      openConnectionById(event.payload);
    });
    const unlistenAssistantPromise = listen<string>("assistant-open-connection", (event) => {
      openConnectionById(event.payload);
    });
    return () => {
      void unlistenTrayPromise.then((unlisten) => unlisten());
      void unlistenAssistantPromise.then((unlisten) => unlisten());
    };
  }, []);

  const isTreeFiltered = deferredQuery.trim().length > 0 || showConnectedOnly;
  const visibleCollapsedFolderIds = useMemo(
    () => (isTreeFiltered ? new Set<string>() : collapsedFolderIds),
    [collapsedFolderIds, isTreeFiltered],
  );
  const visibleFlatConnectionRows = useMemo(() => {
    if (!showAllConnections) {
      return [];
    }

    return flattenVisibleConnections(displayTree);
  }, [displayTree, showAllConnections]);
  const hasWorkspaceFolders = treeWithLiveStatuses.folders.length > 0;
  const hasWorkspaceConnections = flattenConnections(treeWithLiveStatuses).length > 0;


  function menuPositionFromElement(element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.left,
      y: bounds.bottom,
    };
  }

  function buildAddConnectionMenuItems(): NativeContextMenuItem[] {
    const connectionTypes: ConnectionType[] = [
      "local",
      "ssh",
      "telnet",
      "serial",
      "url",
      "rdp",
      "vnc",
      "ftp",
      "localFiles",
      "fileView",
    ];
    return [
      ...connectionTypes.map((connectionType) => ({
        kind: "item" as const,
        label: connectionType === "ssh" ? t("connections.ssh") : connectionTypeLabel(connectionType),
        iconSrc: connectionIconSrcForConnection({ type: connectionType }),
        action:
          connectionType === "fileView"
            ? handleNewFileViewConnectionSelected
            : () => handleNewConnectionTypeSelected(connectionType),
      })),
      { kind: "separator" as const },
      {
        kind: "item" as const,
        label: t("connections.import.tileTitle"),
        iconSvg: nativeMenuIcons.download,
        action: handleImportRequested,
      },
    ];
  }

  function buildQuickConnectMenuItems(): NativeContextMenuItem[] {
    return [
      {
        kind: "item",
        label: t("connections.ssh"),
        iconSrc: connectionIconSrcForConnection({ type: "ssh" }),
        action: handleQuickSshRequested,
      },
      ...quickConnectShellOptions.map((option) =>
        option.canElevate
          ? {
              kind: "submenu" as const,
              label: option.label,
              iconSrc: connectionIconSrcForConnection({
                localShell: option.value,
                type: "local",
              }),
              items: [
                {
                  kind: "item" as const,
                  label: t("connections.normal"),
                  iconSrc: connectionIconSrcForConnection({
                    localShell: option.value,
                    type: "local",
                  }),
                  action: () => handleQuickLocalShell(option),
                },
                {
                  kind: "item" as const,
                  label: t("connections.admin"),
                  iconSrc: connectionIconSrcForConnection({
                    localShell: option.value,
                    type: "local",
                  }),
                  action: () => void handleQuickAdminShell(option),
                },
              ],
            }
          : {
              kind: "item" as const,
              label: option.label,
              iconSrc: connectionIconSrcForConnection({
                localShell: option.value,
                type: "local",
              }),
              action: () => handleQuickLocalShell(option),
            },
      ),
      { kind: "separator" as const },
      ...(recentConnections.length > 0
        ? recentConnections.map((connection) => ({
            kind: "item" as const,
            label: quickConnectRecentLabel(connection),
            iconSrc: connectionIconSrcForConnection(connection),
            action: () => {
              setQuickConnectMenuOpen(false);
              handleOpenConnection(connection);
            },
          }))
        : [
            {
              kind: "item" as const,
              label: t("connections.noRecent"),
              disabled: true,
              action: () => undefined,
            },
          ]),
    ];
  }

  async function handleAddConnectionButtonClick(event: ReactMouseEvent<HTMLButtonElement>) {
    setQuickConnectMenuOpen(false);
    const opened = await showNativeContextMenu(
      buildAddConnectionMenuItems(),
      menuPositionFromElement(event.currentTarget),
    );
    if (opened) {
      setAddConnectionMenuOpen(false);
      return;
    }
    setAddConnectionMenuOpen((isOpen) => !isOpen);
  }

  async function handleQuickConnectButtonClick(event: ReactMouseEvent<HTMLButtonElement>) {
    setAddConnectionMenuOpen(false);
    const opened = await showNativeContextMenu(
      buildQuickConnectMenuItems(),
      menuPositionFromElement(event.currentTarget),
    );
    if (opened) {
      setQuickConnectMenuOpen(false);
      return;
    }
    setQuickConnectMenuOpen((isOpen) => !isOpen);
  }

  function handleDragEnd() {
    draggedItemRef.current = null;
    pointerDragTargetRef.current = null;
    canvasDropTargetRef.current = null;
    setDragPreview(null);
    setDraggedSourceId("");
    setDropTarget("");
    setCanvasDropZone(null);
  }

  function handleTreeClickCapture(event: ReactMouseEvent) {
    if (!suppressTreeClickRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressTreeClickRef.current = false;
  }

  function handleTreeContextMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    void openTreeContextMenu({
      kind: "tree",
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handleConnectionContextMenu(
    connection: Connection,
    folderId: string | undefined,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    void openTreeContextMenu({
      kind: "connection",
      connection,
      folderId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handleFolderContextMenu(folder: ConnectionFolder, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    void openTreeContextMenu({
      kind: "folder",
      folder,
      x: event.clientX,
      y: event.clientY,
    });
  }

  async function openTreeContextMenu(menu: TreeContextMenuState) {
    const opened = await showNativeContextMenu(buildTreeContextMenuItems(menu), {
      x: menu.x,
      y: menu.y,
    });
    if (!opened) {
      setTreeContextMenu(menu);
    }
  }

  function buildTreeContextMenuItems(menu: TreeContextMenuState): NativeContextMenuItem[] {
    if (menu.kind === "tree") {
      return [
        {
          kind: "submenu",
          label: t("connections.newConnection"),
          iconSvg: nativeMenuIcons.plus,
          items: buildAddConnectionMenuItems(),
        },
        {
          kind: "item",
          label: t("connections.newFolder"),
          iconSvg: nativeMenuIcons.folderPlus,
          action: handleTreeMenuCreateFolder,
        },
      ];
    }

    const items: NativeContextMenuItem[] = [];
    const canOpenNewTab =
      menu.kind !== "connection" || !showChildTabsInTree || isTerminalConnectionType(menu.connection.type);
    if (menu.kind === "connection") {
      items.push(
        {
          kind: "item",
          label: t("workspace.newTab"),
          disabled: !canOpenNewTab,
          iconSvg: nativeMenuIcons.squarePlus,
          action: () => handleTreeMenuOpenNewTab(menu),
        },
        { kind: "separator" },
      );
    }
    items.push(
      {
        kind: "item",
        label: t("connections.rename"),
        iconSvg: nativeMenuIcons.pencil,
        action: () => void handleTreeMenuRename(menu),
      },
      {
        kind: "item",
        label: t("connections.delete"),
        iconSvg: nativeMenuIcons.trash,
        action: () => void handleTreeMenuDelete(menu),
      },
    );

    if (menu.kind !== "connection") {
      items.splice(1, 0, {
        kind: "item",
        label: t("connections.changeIcon"),
        iconSvg: nativeMenuIcons.pencil,
        action: () => setFolderIconDialog({ folder: menu.folder }),
      });
      const folderHasOpenConnection = flattenConnections({
        connections: menu.folder.connections,
        folders: menu.folder.folders,
      }).some((connection) => (activeSessionCounts[connection.id] ?? 0) > 0);
      items.unshift(
        {
          kind: "submenu",
          label: t("connections.openAllInFolder"),
          iconSvg: nativeMenuIcons.folderOpen,
          disabled: countConnections(menu.folder) === 0,
          items: [
            {
              kind: "item",
              label: t("connections.openAllInTabs"),
              iconSvg: nativeMenuIcons.squarePlus,
              action: () => handleTreeMenuOpenAllInFolder(menu, "tabs"),
            },
            {
              kind: "item",
              label: t("connections.openAllInPanorama"),
              iconSvg: nativeMenuIcons.layoutDashboard,
              action: () => handleTreeMenuOpenAllInFolder(menu, "panorama"),
            },
          ],
        },
        {
          kind: "item",
          label: t("connections.closeAllInFolder"),
          iconSvg: nativeMenuIcons.x,
          disabled: !folderHasOpenConnection,
          action: () => handleTreeMenuCloseAllInFolder(menu),
        },
        { kind: "separator" },
      );
      return items;
    }

    const isPinned = generalSettings.pinnedConnectionIds.includes(menu.connection.id);
    const isConnected = (activeSessionCounts[menu.connection.id] ?? 0) > 0;
    const canAddToPane = supportsAddConnectionToTab(tabs.find((tab) => tab.id === activeTabId));
    items.push(
      { kind: "separator" },
      {
        kind: "item",
        label: t(isPinned ? "connections.unpinFromRail" : "connections.pinToRail"),
        iconSvg: isPinned ? nativeMenuIcons.pinOff : nativeMenuIcons.pin,
        action: () => void handleTreeMenuToggleRailPin(menu),
      },
    );

    if (isConnected) {
      items.push({
        kind: "item",
        label: t("connections.closeConnection"),
        iconSvg: nativeMenuIcons.x,
        action: () => handleTreeMenuCloseConnection(menu),
      });
    }

    items.push({
      kind: "submenu",
      label: t("connections.addTo"),
      iconSvg: nativeMenuIcons.panelRight,
      items: [
        {
          kind: "item",
          label: `${t("workspace.newTab")}\t${t("connections.newTabShortcut")}`,
          iconSvg: nativeMenuIcons.squarePlus,
          disabled: !canOpenNewTab,
          action: () => handleTreeMenuOpenNewTab(menu),
        },
        ...(canAddToPane
          ? [
              { kind: "separator" as const },
              {
                kind: "item" as const,
                label: t("connections.left"),
                iconSvg: nativeMenuIcons.arrowLeft,
                action: () => void handleTreeMenuAddToPane(menu, "left"),
              },
              {
                kind: "item" as const,
                label: t("connections.right"),
                iconSvg: nativeMenuIcons.arrowRight,
                action: () => void handleTreeMenuAddToPane(menu, "right"),
              },
              {
                kind: "item" as const,
                label: t("connections.lower"),
                iconSvg: nativeMenuIcons.arrowDown,
                action: () => void handleTreeMenuAddToPane(menu, "down"),
              },
              {
                kind: "item" as const,
                label: t("connections.upper"),
                iconSvg: nativeMenuIcons.arrowUp,
                action: () => void handleTreeMenuAddToPane(menu, "up"),
              },
            ]
          : []),
      ],
    });

    if (supportsSavedConnectionLayout(menu.connection.type)) {
      items.push({
        kind: "submenu",
        label: t("connections.layout"),
        iconSvg: nativeMenuIcons.layoutDashboard,
        items: [
          {
            kind: "item",
            label: t("common.save"),
            iconSvg: nativeMenuIcons.save,
            action: () => handleTreeMenuSaveLayout(menu),
          },
          {
            kind: "item",
            label: t("common.reset"),
            iconSvg: nativeMenuIcons.rotateCcw,
            action: () => handleTreeMenuResetLayout(menu),
          },
        ],
      });
    }

    if (menu.connection.type === "ssh") {
      items.push({
        kind: "item",
        label: t("connections.transferSshPublicKey"),
        iconSvg: nativeMenuIcons.keyRound,
        action: () => handleTreeMenuTransferSshPublicKey(menu),
      });
    }

    items.push({
      kind: "item",
      label: t("connections.properties"),
      iconSvg: nativeMenuIcons.settings,
      action: () => handleTreeMenuProperties(menu),
    });
    return items;
  }

  function handleTreeMenuCreateConnection() {
    setTreeContextMenu(null);
    setQuickConnectMenuOpen(false);
    setAddConnectionMenuOpen(true);
  }

  function handleTreeMenuCreateFolder() {
    setTreeContextMenu(null);
    handleCreateFolder();
  }

  async function handleTreeMenuDelete(menu: TreeContextMenuState) {
    setTreeContextMenu(null);
    let target: DeleteTarget | null = null;
    if (menu.kind === "connection") {
      target = { kind: "connection", connection: menu.connection };
    } else if (menu.kind === "folder") {
      target = { kind: "folder", folder: menu.folder };
    }

    if (!target) {
      return;
    }

    let confirmed: boolean | null;
    try {
      confirmed = await confirmNativeDialog(deleteConfirmationMessage(t, target), {
        kind: "warning",
        title: deleteConfirmationTitle(t, target),
      });
    } catch {
      confirmed = null;
    }
    if (confirmed === true) {
      if (target.kind === "connection") {
        await handleDeleteConnection(target.connection);
      } else {
        await handleDeleteFolder(target.folder);
      }
      return;
    }

    if (confirmed === null) {
      setConfirmDeleteTarget(target);
    }
  }

  function handleTreeMenuProperties(menu: TreeContextMenuState) {
    setTreeContextMenu(null);
    if (menu.kind === "connection") {
      const currentConnection = findConnectionInTree(treeRef.current, menu.connection.id);
      setFormError("");
      setEditConnection(currentConnection ?? { connection: menu.connection, folderId: menu.folderId });
    }
  }

  function handleTreeMenuCloseConnection(menu: TreeContextMenuState) {
    setTreeContextMenu(null);
    if (menu.kind !== "connection") {
      return;
    }
    closeOpenTabsForConnection(menu.connection.id);
  }

  function closeOpenTabsForConnection(connectionId: string) {
    for (const tab of tabs) {
      const matchingPaneIds = tab.panes
        .filter((pane) => pane.connection?.id === connectionId)
        .map((pane) => pane.id);
      if (matchingPaneIds.length === 0) {
        if (tab.connection?.id === connectionId) {
          closeTab(tab.id);
        }
        continue;
      }
      if (matchingPaneIds.length === tab.panes.length) {
        closeTab(tab.id);
        continue;
      }
      for (const paneId of matchingPaneIds) {
        closePane(tab.id, paneId);
      }
    }
  }

  function handleTreeMenuRename(menu: TreeContextMenuState) {
    setTreeContextMenu(null);
    setPendingFolderDraft(null);
    setTreeError("");
    if (menu.kind === "connection") {
      setInlineRenameTarget({ kind: "connection", id: menu.connection.id });
    } else if (menu.kind === "folder") {
      setInlineRenameTarget({ kind: "folder", id: menu.folder.id });
    }
  }

  async function handleTreeMenuAddToPane(menu: TreeContextMenuState, direction: SplitDirection) {
    setTreeContextMenu(null);
    if (menu.kind === "connection") {
      await handleAddConnectionToFocusedPane(menu.connection, direction);
    }
  }

  function handleTreeMenuOpenNewTab(menu: TreeContextMenuState) {
    setTreeContextMenu(null);
    if (menu.kind === "connection") {
      void handleOpenConnectionInNewTab(menu.connection);
    }
  }

  function findOpenTabForConnection(connectionId: string) {
    return tabs.find(
      (tab) =>
        tab.connection?.id === connectionId ||
        tab.panes.some((pane) => pane.connection?.id === connectionId),
    );
  }

  // Opens every connection in the folder (recursively, child folders included).
  // "tabs" gives each its own Tab via the standard open path so per-type handling
  // applies; "panorama" lays unopened Connections out as split Panes inside one
  // Tab. Existing Sessions stay where they are and are reused rather than rebuilt.
  function handleTreeMenuOpenAllInFolder(menu: TreeContextMenuState, mode: "tabs" | "panorama") {
    setTreeContextMenu(null);
    if (menu.kind !== "folder") {
      return;
    }
    const folderConnections = flattenConnections({
      connections: menu.folder.connections,
      folders: menu.folder.folders,
    });
    if (mode === "panorama") {
      openConnectionPanorama(folderConnections, menu.folder.name);
      return;
    }
    for (const connection of folderConnections) {
      const existingTab = findOpenTabForConnection(connection.id);
      if (existingTab) {
        activateTab(existingTab.id);
      } else {
        openConnection(connection);
      }
    }
  }

  function openConnectionPanorama(connections: Connection[], title: string) {
    const unopenedConnections = connections.filter(
      (connection) => !findOpenTabForConnection(connection.id),
    );
    if (unopenedConnections.length > 0) {
      openConnectionsInPanorama(unopenedConnections, { title });
      return;
    }
    const existingTab = connections
      .map((connection) => findOpenTabForConnection(connection.id))
      .find((tab) => Boolean(tab));
    if (existingTab) {
      activateTab(existingTab.id);
    }
  }

  function handleOpenRootPanorama() {
    openConnectionPanorama(flattenConnections(treeWithLiveStatuses), panelTitle);
  }

  // Closes every open Tab and Pane for every connection in the folder (child
  // folders included). Mirrors the per-connection close action.
  function handleTreeMenuCloseAllInFolder(menu: TreeContextMenuState) {
    setTreeContextMenu(null);
    if (menu.kind !== "folder") {
      return;
    }
    const folderConnections = flattenConnections({
      connections: menu.folder.connections,
      folders: menu.folder.folders,
    });
    for (const connection of folderConnections) {
      closeOpenTabsForConnection(connection.id);
    }
  }

  function handleTreeMenuSaveLayout(menu: TreeContextMenuState) {
    setTreeContextMenu(null);
    if (menu.kind === "connection") {
      saveConnectionLayout(menu.connection.id);
    }
  }

  function handleTreeMenuResetLayout(menu: TreeContextMenuState) {
    setTreeContextMenu(null);
    if (menu.kind === "connection") {
      resetConnectionLayout(menu.connection.id);
    }
  }

  async function handleTreeMenuToggleRailPin(menu: TreeContextMenuState) {
    setTreeContextMenu(null);
    if (menu.kind === "connection") {
      await handleToggleRailPin(menu.connection);
    }
  }

  function handleTreeMenuTransferSshPublicKey(menu: TreeContextMenuState) {
    setTreeContextMenu(null);
    if (menu.kind === "connection" && menu.connection.type === "ssh") {
      setTreeError("");
      setTransferSshPublicKeyDialog({
        connection: menu.connection,
        keyPath: menu.connection.keyPath ?? sshSettings.defaultKeyPath,
      });
      setTransferSshPublicKeyError("");
    }
  }

  function handleToggleFolder(folderId: string) {
    setCollapsedFolderIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(folderId)) {
        nextIds.delete(folderId);
      } else {
        nextIds.add(folderId);
      }
      return nextIds;
    });
  }

  function handleExpandAllFolders() {
    setCollapsedFolderIds(new Set());
    setTreeContextMenu(null);
  }

  function handleCollapseAllFolders() {
    setCollapsedFolderIds(new Set(collectConnectionFolderIds(treeWithLiveStatuses.folders)));
    setTreeContextMenu(null);
  }

  // Resolve a docking target on the Workspace Canvas from the element under the
  // pointer. Only the active Tab's panes are dockable; everything else falls
  // back to the empty-canvas drop when present.
  function canvasDropZoneFromElement(
    element: Element | null,
    pointerX: number,
    pointerY: number,
  ): CanvasDropZone | null {
    const paneEl = element?.closest<HTMLElement>("[data-dock-pane-id]");
    if (paneEl) {
      const paneId = paneEl.dataset.dockPaneId;
      const tabId = paneEl.dataset.dockTabId;
      if (!paneId || !tabId || tabId !== activeTabId) {
        return null;
      }
      const bounds = paneEl.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        return null;
      }
      return {
        kind: "split",
        tabId,
        paneId,
        direction: nearestEdgeDirection(bounds, pointerX, pointerY),
        rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
      };
    }

    const emptyEl = element?.closest<HTMLElement>("[data-dock-empty-canvas]");
    if (emptyEl) {
      const bounds = emptyEl.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        return null;
      }
      return {
        kind: "empty",
        rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
      };
    }

    return null;
  }

  async function completeCanvasDrop(connectionId: string, zone: CanvasDropZone) {
    const found = findConnectionInTree(treeRef.current, connectionId);
    if (!found) {
      return;
    }
    const connection = found.connection;
    rememberConnection(connection);
    if (zone.kind === "split") {
      await addConnectionToPaneWithChildMode(zone.tabId, connection, zone.direction, zone.paneId);
      return;
    }
    handleOpenConnection(connection);
  }

  // Whether a drop of `item` onto `target` would actually move anything.
  // Mirrors the no-op guards in completeTreeDrop so the click that follows a
  // same-row release is preserved (the user was clicking, not reordering).
  function treeDropMovesItem(item: DraggedTreeItem, target: TreeDropTarget) {
    if (item.kind === "folder") {
      if (target.kind === "connection") {
        return false;
      }
      return !(target.kind === "folder" && item.folderId === target.folderId);
    }
    return !(target.kind === "connection" && item.connectionId === target.connectionId);
  }

  function completeTreeDrop(item: DraggedTreeItem, target: TreeDropTarget) {
    if (item.kind === "folder") {
      if (target.kind === "connection") {
        return;
      }

      if (target.kind === "folder" && item.folderId === target.folderId) {
        return;
      }

      void handleMoveFolder(
        item.folderId,
        target.kind === "folder" ? target.folderId : undefined,
        target.targetIndex,
      );
      return;
    }

    if (item.kind === "connection") {
      if (target.kind === "connection" && item.connectionId === target.connectionId) {
        return;
      }

      void handleMoveConnection(
        item.connectionId,
        target.kind === "root" ? undefined : target.folderId,
        target.targetIndex,
      );
    }
  }

  function removePointerDragListeners() {
    const listeners = pointerDragListenersRef.current;
    if (!listeners) {
      return;
    }

    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.stop);
    window.removeEventListener("pointercancel", listeners.stop);
    pointerDragListenersRef.current = null;
  }

  function treeDropTargetFromElement(element: Element | null, item: DraggedTreeItem, pointerY: number) {
    const row = element?.closest<HTMLElement>("[data-tree-drop-kind]");
    if (!row) {
      return null;
    }

    if (row.dataset.treeDropKind === "root") {
      return {
        kind: "root",
        targetIndex:
          item.kind === "connection"
            ? Number(row.dataset.connectionCount ?? 0)
            : Number(row.dataset.folderCount ?? 0),
      } satisfies TreeDropTarget;
    }

    if (row.dataset.treeDropKind === "folder") {
      const folderId = row.dataset.folderId;
      if (!folderId) {
        return null;
      }

      if (item.kind === "folder") {
        const siblingParentFolderId = row.dataset.parentFolderId;
        const siblingFolderIndex = Number(row.dataset.folderIndex ?? 0);
        const bounds = row.getBoundingClientRect();
        const offsetY = pointerY - bounds.top;
        const edgeDropHeight = Math.min(8, bounds.height * 0.28);
        if (offsetY >= edgeDropHeight && offsetY <= bounds.height - edgeDropHeight) {
          return {
            kind: "folder",
            folderId,
            targetIndex: Number(row.dataset.folderCount ?? 0),
          } satisfies TreeDropTarget;
        }

        const insertAfter = offsetY > bounds.height / 2;
        if (siblingParentFolderId) {
          return {
            kind: "folder",
            folderId: siblingParentFolderId,
            targetIndex: siblingFolderIndex + (insertAfter ? 1 : 0),
          } satisfies TreeDropTarget;
        }
        return {
          kind: "root",
          targetIndex: siblingFolderIndex + (insertAfter ? 1 : 0),
        } satisfies TreeDropTarget;
      }

      const connectionCount = Number(row.dataset.connectionCount ?? 0);
      return {
        kind: "folder",
        folderId,
        targetIndex: connectionCount,
      } satisfies TreeDropTarget;
    }

    const folderId = row.dataset.folderId;
    const connectionId = row.dataset.connectionId;
    if (!connectionId) {
      return null;
    }

    return {
      kind: "connection",
      folderId: folderId || undefined,
      connectionId,
      targetIndex: Number(row.dataset.connectionIndex ?? 0),
    } satisfies TreeDropTarget;
  }

  function treeDropTargetId(target: TreeDropTarget) {
    if (target.kind === "root") {
      return "root";
    }

    return target.kind === "folder" ? `folder-${target.folderId}` : `connection-${target.connectionId}`;
  }

  function treeItemId(item: DraggedTreeItem) {
    return item.kind === "folder" ? `folder-${item.folderId}` : `connection-${item.connectionId}`;
  }

  function handlePointerDragStart(
    event: ReactPointerEvent<HTMLElement>,
    item: DraggedTreeItem,
    preview: Omit<TreeDragPreview, "x" | "y" | "offsetX" | "offsetY" | "width">,
  ) {
    if (isTreeFiltered || showAllConnections || inlineRenameTarget || event.button !== 0) {
      return;
    }

    removePointerDragListeners();
    const sourceBounds = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const offsetX = startX - sourceBounds.left;
    const offsetY = startY - sourceBounds.top;
    const previewWidth = Math.min(sourceBounds.width, 320);
    const pointerId = event.pointerId;
    let dragStarted = false;
    pointerDragTargetRef.current = null;

    const updateDragPreview = (pointerEvent: PointerEvent) => {
      setDragPreview((currentPreview) =>
        currentPreview
          ? { ...currentPreview, x: pointerEvent.clientX, y: pointerEvent.clientY }
          : null,
      );
    };

    const startDrag = (pointerEvent: PointerEvent) => {
      if (dragStarted) {
        return;
      }

      dragStarted = true;
      draggedItemRef.current = item;
      // Note: the click is NOT suppressed here. Showing the drag preview is
      // cheap and reversible, but swallowing the click is not — a press that
      // jitters past the threshold and releases on the same row must still
      // select/open. We only suppress in `stop`, and only when the gesture
      // actually produced a reorder or canvas dock (see below).
      setDraggedSourceId(treeItemId(item));
      setDragPreview({
        ...preview,
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        offsetX,
        offsetY,
        width: previewWidth,
      });
      setDropTarget("");
    };
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }

      if (!dragStarted) {
        const xMovement = Math.abs(pointerEvent.clientX - startX);
        const yMovement = Math.abs(pointerEvent.clientY - startY);
        // 8px of slop (the conventional drag threshold) so ordinary click
        // jitter doesn't start a drag and flicker the preview.
        if (xMovement < DRAG_START_THRESHOLD_PX && yMovement < DRAG_START_THRESHOLD_PX) {
          return;
        }

        startDrag(pointerEvent);
      }

      pointerEvent.preventDefault();
      updateDragPreview(pointerEvent);
      const element = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
      const target = treeDropTargetFromElement(element, item, pointerEvent.clientY);
      pointerDragTargetRef.current = target;
      setDropTarget(target ? treeDropTargetId(target) : "");

      // Reordering inside the tree takes precedence; only when the pointer is
      // off the tree does a Connection dock onto the Workspace Canvas.
      const canvasZone =
        target || item.kind !== "connection"
          ? null
          : canvasDropZoneFromElement(element, pointerEvent.clientX, pointerEvent.clientY);
      canvasDropTargetRef.current = canvasZone;
      setCanvasDropZone(canvasZone);
    };
    const stop = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }

      if (!dragStarted) {
        removePointerDragListeners();
        return;
      }

      pointerEvent.preventDefault();
      const target = pointerDragTargetRef.current;
      const canvasZone = canvasDropTargetRef.current;
      const dragged = draggedItemRef.current;
      removePointerDragListeners();
      handleDragEnd();
      const didCanvasDrop = Boolean(canvasZone && dragged?.kind === "connection");
      const didTreeDrop = Boolean(
        !didCanvasDrop && target && dragged && treeDropMovesItem(dragged, target),
      );
      if (didCanvasDrop && dragged?.kind === "connection" && canvasZone) {
        void completeCanvasDrop(dragged.connectionId, canvasZone);
      } else if (didTreeDrop && target && dragged) {
        completeTreeDrop(dragged, target);
      }
      // Only swallow the upcoming click when the gesture actually relocated the
      // item. A press that crossed the drag threshold but released on the same
      // row (or off any valid target) is a click — let it select/open.
      if (didCanvasDrop || didTreeDrop) {
        suppressTreeClickRef.current = true;
        window.setTimeout(() => {
          suppressTreeClickRef.current = false;
        }, 0);
      }
    };

    pointerDragListenersRef.current = { move, stop };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  const dragDisabled = isTreeFiltered || showAllConnections || Boolean(inlineRenameTarget);

  function handleHeaderDoubleClick(event: ReactMouseEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("button, a, input, textarea, select")) {
      return;
    }
    onTogglePanel?.();
  }

  return (
    <aside className="connection-sidebar" data-tutorial-id="connections.panel">
      <ModuleHeader className="sidebar-header" onDoubleClick={handleHeaderDoubleClick}>
        <ModuleHeaderLead className="sidebar-title">
          <ModuleIconTile className={workspaceHeaderTileClassName} module="workspace">
            {activeWorkspace?.isDefault || activeWorkspaceId === DEFAULT_WORKSPACE_ID ? (
              <LayoutDashboard aria-hidden="true" size={16} />
            ) : (
              <WorkspaceIcon
                color={activeWorkspace?.iconColor}
                icon={activeWorkspace?.icon}
                name={activeWorkspace?.name || panelTitle}
                size={WORKSPACE_HEADER_ICON_SIZE}
                shellSize={WORKSPACE_HEADER_ICON_SHELL_SIZE}
              />
            )}
          </ModuleIconTile>
          <ModuleHeaderTitle>{panelTitle}</ModuleHeaderTitle>
          <div className="sidebar-actions">
            <div className="add-connection-anchor" ref={addConnectionRef}>
              <button
                {...dialogButtonAria(addConnectionMenuOpen)}
                className="icon-button"
                data-tutorial-id="connections.addConnection"
                aria-label={t("connections.addConnection")}
                title={t("connections.addConnection")}
                onClick={(event) => void handleAddConnectionButtonClick(event)}
                type="button"
              >
                <Plus size={16} />
              </button>
              {addConnectionMenuOpen ? (
                <AddConnectionMenu
                  onImportRequested={handleImportRequested}
                  onSelectType={handleNewConnectionTypeSelected}
                />
              ) : null}
            </div>
          </div>
        </ModuleHeaderLead>
      </ModuleHeader>

      <div className="connection-sidebar-subheader">
        <span>{t("connections.title")}</span>
        <div
          className="tree-folder-controls"
          aria-label={t("connections.folderTreeControls")}
          data-tutorial-id="connections.folderControls"
        >
          <button
            aria-label={t("connections.panoramaView")}
            className="tree-folder-control"
            disabled={!hasWorkspaceConnections}
            onClick={handleOpenRootPanorama}
            title={t("connections.panoramaView")}
            type="button"
          >
            <PanelsTopLeft size={13} />
          </button>
          <button
            aria-label={t("connections.newFolder")}
            className="tree-folder-control"
            onClick={() => void handleCreateFolder()}
            title={t("connections.newFolder")}
            type="button"
          >
            <FolderPlus size={12} />
          </button>
          {hasWorkspaceFolders ? (
            <>
              <button
                aria-label={t("connections.collapseAll")}
                className="tree-folder-control"
                onClick={handleCollapseAllFolders}
                title={t("connections.collapseAll")}
                type="button"
              >
                <Minimize2 size={13} />
              </button>
              <button
                aria-label={t("connections.expandAll")}
                className="tree-folder-control"
                onClick={handleExpandAllFolders}
                title={t("connections.expandAll")}
                type="button"
              >
                <Maximize2 size={13} />
              </button>
            </>
          ) : null}
          <button
            aria-pressed={showConnectedOnly}
            aria-label={t("connections.showConnected")}
            className={`tree-folder-control${showConnectedOnly ? " active" : ""}`}
            onClick={() => setShowConnectedOnly((previous) => !previous)}
            title={t("connections.showConnected")}
            type="button"
          >
            <CircleDot size={13} />
          </button>
          {hasWorkspaceFolders ? (
            <button
              aria-pressed={showAllConnections}
              aria-label={t("connections.hideFolders")}
              className={`tree-folder-control${showAllConnections ? " active" : ""}`}
              onClick={() => void handleToggleShowAllConnections()}
              title={t("connections.hideFolders")}
              type="button"
            >
              <List size={13} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="connection-search-row">
        <label className="search-box" data-tutorial-id="connections.search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("connections.searchPlaceholder")}
          />
        </label>

        <div className="quick-connect-anchor" ref={quickConnectRef}>
          <button
            {...dialogButtonAria(quickConnectMenuOpen)}
            aria-label={t("connections.quickConnect")}
            className="quick-connect quick-connect-icon-only"
            data-tutorial-id="connections.quickConnect"
            onClick={(event) => void handleQuickConnectButtonClick(event)}
            title={t("connections.quickConnect")}
            type="button"
          >
            <Play size={15} />
          </button>
          {quickConnectMenuOpen ? (
            <QuickConnectMenu
              recentConnections={recentConnections}
              shellOptions={quickConnectShellOptions}
              sshSettings={sshSettings}
              onOpenConnection={(connection) => {
                setQuickConnectMenuOpen(false);
                handleOpenConnection(connection);
              }}
              onOpenElevatedShell={(option) => void handleQuickAdminShell(option)}
              onOpenLocalShell={handleQuickLocalShell}
              onOpenSsh={handleQuickSsh}
            />
          ) : null}
        </div>
      </div>
      {treeError ? <p className="form-error tree-error">{treeError}</p> : null}

      <div
        ref={treeListRef}
        className={`tree-list ${dropTarget === "root" ? "drop-target" : ""}${externalFileDropActive ? " external-drop-target" : ""}`}
        aria-label={t("connections.connectionTree")}
        data-tutorial-id="connections.tree"
        data-connection-count={displayTree.connections.length}
        data-folder-count={displayTree.folders.length}
        data-tree-drop-kind="root"
        onContextMenu={handleTreeContextMenu}
        onDragOver={handleTreePathsDragOver}
        onDragLeave={handleTreePathsDragLeave}
        onDrop={handleTreePathsDrop}
      >
        {/* In "Hide Folders" mode the flat list below already includes these
            root connections (flattenConnections starts at the root), so render
            them here only in the normal/folder view to avoid duplicates. */}
        {!showAllConnections &&
          displayTree.connections.map((connection, connectionIndex) => (
          <ConnectionRowWithChildTabs
            activeTabId={activeTabId}
            childTabs={openTabsForConnection(connection.id)}
            childConnections={childrenForConnection(connection.id)}
            connection={connection}
            key={connection.id}
            connectionIndex={connectionIndex}
            dragDisabled={dragDisabled}
            folderId={undefined}
            isRenaming={inlineRenameTarget?.kind === "connection" && inlineRenameTarget.id === connection.id}
            isDraggingSource={draggedSourceId === `connection-${connection.id}`}
            isDropTarget={dropTarget === `connection-${connection.id}`}
            isSelected={selectedConnectionId === connection.id}
            onChildContextMenu={handleChildContextMenu}
            onCancelRename={() => setInlineRenameTarget(null)}
            onClickCapture={handleTreeClickCapture}
            onCloseChildTab={handleCloseChildConnection}
            onCommitRename={(name) => commitConnectionRename(connection, name)}
            onOpenChildConnection={handleOpenChildConnection}
            onRenameChildConnection={handleRenameChildConnection}
            inlineChildRenameTarget={inlineChildRenameTarget}
            onStartChildRename={setInlineChildRenameTarget}
            onCancelChildRename={() => setInlineChildRenameTarget(null)}
            onContextMenu={(event) => handleConnectionContextMenu(connection, undefined, event)}
            onSelect={() => setSelectedConnectionId(connection.id)}
            onOpen={(event) => {
              setSelectedConnectionId(connection.id);
              if (event.ctrlKey) {
                handleOpenConnection(connection, { forceNewTab: true });
                return;
              }
              handleOpenConnection(connection);
            }}
            onPointerDragStart={(event) =>
              handlePointerDragStart(
                event,
                { kind: "connection", connectionId: connection.id },
                {
                  kind: "connection",
                  title: connection.name,
                  subtitle: connection.host,
                  connectionType: connection.type,
                  connectionStatus: connection.status,
                },
              )
            }
          />
        ))}
        {pendingFolderDraft && !pendingFolderDraft.parentFolderId ? (
          <NewFolderDraftRow
            level={0}
            onCancel={handleCancelPendingFolder}
            onCommit={(name) => void handleCommitPendingFolder(name)}
          />
        ) : null}
        {showAllConnections
          ? visibleFlatConnectionRows.map((connection, connectionIndex) => (
              <ConnectionRowWithChildTabs
                activeTabId={activeTabId}
                childTabs={openTabsForConnection(connection.id)}
                childConnections={childrenForConnection(connection.id)}
                connection={connection}
                key={connection.id}
                connectionIndex={connectionIndex}
                dragDisabled
                isRenaming={inlineRenameTarget?.kind === "connection" && inlineRenameTarget.id === connection.id}
                isDraggingSource={false}
                isDropTarget={false}
                isSelected={selectedConnectionId === connection.id}
                onChildContextMenu={handleChildContextMenu}
                onCancelRename={() => setInlineRenameTarget(null)}
                onClickCapture={handleTreeClickCapture}
                onCloseChildTab={handleCloseChildConnection}
                onCommitRename={(name) => commitConnectionRename(connection, name)}
                onOpenChildConnection={handleOpenChildConnection}
                onRenameChildConnection={handleRenameChildConnection}
                inlineChildRenameTarget={inlineChildRenameTarget}
                onStartChildRename={setInlineChildRenameTarget}
                onCancelChildRename={() => setInlineChildRenameTarget(null)}
                onSelect={() => setSelectedConnectionId(connection.id)}
                onOpen={(event) => {
                  setSelectedConnectionId(connection.id);
                  if (event.ctrlKey) {
                    handleOpenConnection(connection, { forceNewTab: true });
                    return;
                  }
                  handleOpenConnection(connection);
                }}
                onContextMenu={(event) => handleConnectionContextMenu(connection, undefined, event)}
                onPointerDragStart={() => {}}
              />
            ))
          : displayTree.folders.map((folder, folderIndex) => (
              <ConnectionFolderNode
                dragDisabled={dragDisabled}
                draggedSourceId={draggedSourceId}
                dropTarget={dropTarget}
                folder={folder}
                collapsedFolderIds={visibleCollapsedFolderIds}
                key={folder.id}
                level={0}
                parentFolderId={undefined}
                folderIndex={folderIndex}
                onClickCapture={handleTreeClickCapture}
                pendingFolderDraft={pendingFolderDraft}
                selectedConnectionId={selectedConnectionId}
                inlineRenameTarget={inlineRenameTarget}
                onCancelPendingFolder={handleCancelPendingFolder}
                onCommitPendingFolder={handleCommitPendingFolder}
                onCancelRename={() => setInlineRenameTarget(null)}
                onCommitConnectionRename={commitConnectionRename}
                onCommitFolderRename={commitFolderRename}
                onContextMenu={handleFolderContextMenu}
                onConnectionContextMenu={handleConnectionContextMenu}
                onSelectConnection={(connection) => setSelectedConnectionId(connection.id)}
                onCreateFolder={handleCreateFolder}
                activeTabId={activeTabId}
                childTabsForConnection={openTabsForConnection}
                childConnectionsForConnection={childrenForConnection}
                onChildContextMenu={handleChildContextMenu}
                onCloseChildTab={handleCloseChildConnection}
                onOpenChildConnection={handleOpenChildConnection}
                onRenameChildConnection={handleRenameChildConnection}
                inlineChildRenameTarget={inlineChildRenameTarget}
                onStartChildRename={setInlineChildRenameTarget}
                onCancelChildRename={() => setInlineChildRenameTarget(null)}
                onOpenConnection={(connection, event) => {
                  if (event.ctrlKey) {
                    handleOpenConnection(connection, { forceNewTab: true });
                    return;
                  }
                  handleOpenConnection(connection);
                }}
                onPointerDragStart={handlePointerDragStart}
                onToggleFolder={isTreeFiltered ? undefined : handleToggleFolder}
              />
            ))}
        {dragPreview ? (
          <div
            className={`tree-root-drop-target${dropTarget === "root" ? " drop-target" : ""}`}
            data-connection-count={displayTree.connections.length}
            data-folder-count={displayTree.folders.length}
            data-tree-drop-kind="root"
            role="presentation"
          >
            {t("connections.root")}
          </div>
        ) : null}
      </div>

      {treeContextMenu ? (
        <TreeContextMenu
          menu={treeContextMenu}
          canAddToPane={supportsAddConnectionToTab(tabs.find((tab) => tab.id === activeTabId))}
          canOpenNewTab={
            treeContextMenu.kind !== "connection" ||
            !showChildTabsInTree ||
            isTerminalConnectionType(treeContextMenu.connection.type)
          }
          isPinned={
            treeContextMenu.kind === "connection" &&
            generalSettings.pinnedConnectionIds.includes(treeContextMenu.connection.id)
          }
          onClose={() => setTreeContextMenu(null)}
          onCreateConnection={handleTreeMenuCreateConnection}
          onCreateFolder={handleTreeMenuCreateFolder}
          onDelete={() => void handleTreeMenuDelete(treeContextMenu)}
          onChangeIcon={() => {
            if (treeContextMenu.kind === "folder") {
              setFolderIconDialog({ folder: treeContextMenu.folder });
            }
            setTreeContextMenu(null);
          }}
          onProperties={() => handleTreeMenuProperties(treeContextMenu)}
          onRename={() => void handleTreeMenuRename(treeContextMenu)}
          onAddToPane={(direction) => void handleTreeMenuAddToPane(treeContextMenu, direction)}
          onOpenNewTab={() => handleTreeMenuOpenNewTab(treeContextMenu)}
          onSaveLayout={() => handleTreeMenuSaveLayout(treeContextMenu)}
          onResetLayout={() => handleTreeMenuResetLayout(treeContextMenu)}
          onToggleRailPin={() => void handleTreeMenuToggleRailPin(treeContextMenu)}
          onTransferSshPublicKey={() => handleTreeMenuTransferSshPublicKey(treeContextMenu)}
        />
      ) : null}

      {dragPreview ? <TreeDragPreview preview={dragPreview} /> : null}

      <DockOverlay zone={canvasDropZone} />

      {formMode ? (
        <ConnectionDialog
          error={formError}
          initialConnectionType={newConnectionType ?? undefined}
          tree={tree}
          mode={formMode}
          sshSettings={sshSettings}
          rdpSettings={rdpSettings}
          vncSettings={vncSettings}
          onGeneratedSshKey={(generated) =>
            showConnectionSuccessStatus(
              t("settings.sshKeyGenerated", {
                privateKeyPath: generated.privateKeyPath,
                publicKeyPath: generated.publicKeyPath,
              }),
            )
          }
          onCancel={() => {
            setFormMode(null);
            setNewConnectionType(null);
            setFormError("");
          }}
          onSubmit={handleConnectionSubmit}
        />
      ) : null}
      {importDialogOpen ? (
        <ImportDialog
          tree={tree}
          sshSettings={sshSettings}
          onClose={() => setImportDialogOpen(false)}
          onImported={({ count, source }) => {
            setImportDialogOpen(false);
            void reloadConnectionGroups();
            showConnectionSuccessStatus(
              t(
                source === "scan"
                  ? "connections.import.importScanComplete"
                  : source === "bookmarks"
                    ? "connections.import.importBookmarksComplete"
                    : "connections.import.importFileComplete",
                { count },
              ),
            );
          }}
        />
      ) : null}
      {editConnection ? (
        <ConnectionDialog
          error={formError}
          initialConnection={editConnection.connection}
          initialFolderId={editConnection.folderId}
          tree={tree}
          mode="edit"
          sshSettings={sshSettings}
          rdpSettings={rdpSettings}
          vncSettings={vncSettings}
          onGeneratedSshKey={(generated) =>
            showConnectionSuccessStatus(
              t("settings.sshKeyGenerated", {
                privateKeyPath: generated.privateKeyPath,
                publicKeyPath: generated.publicKeyPath,
              }),
            )
          }
          onCancel={() => {
            setEditConnection(null);
            setFormError("");
          }}
          onSubmit={handleConnectionUpdate}
        />
      ) : null}
      {folderIconDialog ? (
        <FolderIconDialog
          customIconDataUrls={reusableChildIconDataUrls}
          error={treeError}
          folder={folderIconDialog.folder}
          onCancel={() => {
            setFolderIconDialog(null);
            setTreeError("");
          }}
          onSubmit={(iconDataUrl) => void handleSaveFolderIcon(folderIconDialog.folder, iconDataUrl)}
        />
      ) : null}
      {confirmDeleteTarget ? (
        <ConfirmDeleteDialog
          onCancel={() => setConfirmDeleteTarget(null)}
          onConfirm={() => {
            const target = confirmDeleteTarget;
            setConfirmDeleteTarget(null);
            if (target.kind === "connection") {
              void handleDeleteConnection(target.connection);
            } else {
              void handleDeleteFolder(target.folder);
            }
          }}
          target={confirmDeleteTarget}
        />
      ) : null}
      {transferSshPublicKeyDialog ? (
        <TransferSshPublicKeyDialog
          connection={transferSshPublicKeyDialog.connection}
          error={transferSshPublicKeyError}
          onCancel={() => setTransferSshPublicKeyDialog(null)}
          onSubmit={(username, password) => void handleTransferSshPublicKey(username, password)}
        />
      ) : null}
      {childProperties ? (
        <ChildConnectionPropertiesDialog
          customIconDataUrls={reusableChildIconDataUrls}
          state={childProperties}
          onCancel={() => setChildProperties(null)}
          onSave={(child) => {
            updateChildConnection(child);
            setChildProperties(null);
          }}
        />
      ) : null}
    </aside>
  );
}

function ChildConnectionPropertiesDialog({
  customIconDataUrls,
  state,
  onCancel,
  onSave,
}: {
  customIconDataUrls: string[];
  state: ChildConnectionPropertiesState;
  onCancel: () => void;
  onSave: (child: WorkspaceChildConnection) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(state.child.name);
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(state.child.iconDataUrl ?? null);
  const [iconBackgroundColor, setIconBackgroundColor] = useState<string | null>(
    state.child.iconBackgroundColor ?? null,
  );
  const trimmedName = name.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName) {
      return;
    }
    onSave({
      ...state.child,
      name: trimmedName,
      iconDataUrl,
      iconBackgroundColor,
    });
  }

  return (
    <DialogPortal>
    <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
      <form className="connection-dialog child-connection-properties-dialog" onSubmit={handleSubmit}>
        <header className="connection-dialog-header compact">
          <div>
            <p className="panel-label">{t("connections.childConnectionProperties")}</p>
          </div>
        </header>
        <div className="connection-type-summary">
          <ConnectionIconPicker
            customIconDataUrls={customIconDataUrls}
            iconBackgroundColor={iconBackgroundColor}
            iconDataUrl={iconDataUrl}
            localShell={state.connection.localShell}
            onChange={setIconDataUrl}
            type={state.connection.type}
          />
          <span>
            <strong>{state.connection.name}</strong>
            <small>{connectionSubtitle(state.connection)}</small>
          </span>
          <ConnectionIconBackgroundPicker
            color={iconBackgroundColor}
            onChange={setIconBackgroundColor}
          />
        </div>
        <div className="connection-dialog-fields">
          <label>
            <span>{t("connections.nameOptional")}</span>
            <input
              autoFocus
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder={t("connections.connectionName")}
              value={name}
            />
          </label>
        </div>
        <LegacyDialogActions
          primary={<button className="approve-button" disabled={!trimmedName} type="submit">
            {t("common.save")}
          </button>}
          cancel={<button className="toolbar-button" onClick={onCancel} type="button">
            {t("common.cancel")}
          </button>}
        />
      </form>
    </div>
    </DialogPortal>
  );
}

function FolderIconDialog({
  customIconDataUrls,
  error,
  folder,
  onCancel,
  onSubmit,
}: {
  customIconDataUrls: string[];
  error: string;
  folder: ConnectionFolder;
  onCancel: () => void;
  onSubmit: (iconDataUrl: string | null) => void;
}) {
  const { t } = useTranslation();
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(folder.iconDataUrl ?? null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(iconDataUrl);
  }

  return (
    <DialogPortal>
    <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
      <form className="connection-dialog child-connection-properties-dialog" onSubmit={handleSubmit}>
        <header className="connection-dialog-header compact">
          <div>
            <h2>{t("connections.changeIcon")}</h2>
          </div>
        </header>
        <div className="connection-type-summary">
          <ConnectionIconPicker
            customIconDataUrls={customIconDataUrls}
            iconDataUrl={iconDataUrl}
            onChange={setIconDataUrl}
            type="localFiles"
          />
          <span>
            <strong>{folder.name}</strong>
          </span>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <LegacyDialogActions
          primary={<button className="approve-button" type="submit">
            <Check size={15} />
            {t("common.save")}
          </button>}
          cancel={<button className="toolbar-button" onClick={onCancel} type="button">
            {t("common.cancel")}
          </button>}
        />
      </form>
    </div>
    </DialogPortal>
  );
}

function ConnectionFolderNode({
  activeTabId,
  childConnectionsForConnection,
  childTabsForConnection,
  collapsedFolderIds,
  dragDisabled,
  draggedSourceId,
  dropTarget,
  folder,
  level,
  parentFolderId,
  folderIndex,
  selectedConnectionId,
  onClickCapture,
  onCreateFolder,
  onOpenConnection,
  onSelectConnection,
  onPointerDragStart,
  onToggleFolder,
  onCancelPendingFolder,
  onCommitPendingFolder,
  onConnectionContextMenu,
  onContextMenu,
  inlineRenameTarget,
  pendingFolderDraft,
  onCancelRename,
  onCommitConnectionRename,
  onCommitFolderRename,
  onChildContextMenu,
  onCloseChildTab,
  onOpenChildConnection,
  onRenameChildConnection,
  inlineChildRenameTarget,
  onStartChildRename,
  onCancelChildRename,
}: {
  activeTabId: string;
  childConnectionsForConnection: (connectionId: string) => WorkspaceChildConnection[];
  childTabsForConnection: (connectionId: string) => WorkspaceTab[];
  collapsedFolderIds: Set<string>;
  dragDisabled: boolean;
  draggedSourceId: string;
  dropTarget: string;
  folder: ConnectionFolder;
  level: number;
  parentFolderId?: string;
  folderIndex: number;
  selectedConnectionId: string | null;
  onClickCapture: (event: ReactMouseEvent) => void;
  onCreateFolder: (parentFolderId?: string) => void | Promise<void>;
  onOpenConnection: (connection: Connection, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSelectConnection: (connection: Connection) => void;
  onPointerDragStart: (
    event: ReactPointerEvent<HTMLElement>,
    item: DraggedTreeItem,
    preview: Omit<TreeDragPreview, "x" | "y" | "offsetX" | "offsetY" | "width">,
  ) => void;
  onToggleFolder?: (folderId: string) => void;
  onCancelPendingFolder: () => void;
  onCommitPendingFolder: (name: string, parentFolderId?: string) => void | Promise<void>;
  inlineRenameTarget: InlineRenameTarget | null;
  onCancelRename: () => void;
  onCommitConnectionRename: (connection: Connection, name: string) => Promise<boolean>;
  onCommitFolderRename: (folder: ConnectionFolder, name: string) => Promise<boolean>;
  onChildContextMenu: (
    connection: Connection,
    child: WorkspaceChildConnection,
    event: ReactMouseEvent<HTMLElement>,
  ) => void | Promise<void>;
  onCloseChildTab: (childConnectionId: string) => void;
  onOpenChildConnection: (connection: Connection, child: WorkspaceChildConnection) => void;
  onRenameChildConnection: (child: WorkspaceChildConnection, name: string) => boolean;
  inlineChildRenameTarget: string | null;
  onStartChildRename: (childConnectionId: string) => void;
  onCancelChildRename: () => void;
  onConnectionContextMenu: (
    connection: Connection,
    folderId: string | undefined,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onContextMenu: (folder: ConnectionFolder, event: ReactMouseEvent<HTMLElement>) => void;
  pendingFolderDraft: PendingFolderDraft | null;
}) {
  const { t } = useTranslation();
  const connectionCount = countConnections(folder);
  const folderCount = countFolders(folder.folders);
  const isCollapsed = collapsedFolderIds.has(folder.id);
  const isRenamingFolder = inlineRenameTarget?.kind === "folder" && inlineRenameTarget.id === folder.id;
  const groupRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    groupRef.current?.style.setProperty("--tree-level-indent", `${level * 14}px`);
  }, [level]);

  return (
    <section className="tree-group" ref={groupRef}>
      <div
        className={`tree-folder-row ${dragDisabled ? "" : "can-drag"} ${
          dropTarget === `folder-${folder.id}` ? "drop-target" : ""
        } ${draggedSourceId === `folder-${folder.id}` ? "dragging-source" : ""}`}
        data-connection-count={folder.connections.length}
        data-folder-count={folder.folders.length}
        data-folder-id={folder.id}
        data-parent-folder-id={parentFolderId ?? ""}
        data-folder-index={folderIndex}
        data-tree-drop-kind="folder"
        onClickCapture={onClickCapture}
        onContextMenu={(event) => onContextMenu(folder, event)}
        onPointerDown={(event) =>
          onPointerDragStart(
            event,
            { kind: "folder", folderId: folder.id },
            {
              kind: "folder",
              title: folder.name,
              connectionCount,
              iconDataUrl: folder.iconDataUrl,
            },
          )
        }
      >
        <div className="tree-folder">
          <button
            {...ariaExpanded(!isCollapsed)}
            aria-label={`${isCollapsed ? t("connections.expand") : t("connections.collapse")} ${folder.name}`}
            className="tree-disclosure"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleFolder?.(folder.id);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title={isCollapsed ? t("connections.expandFolder") : t("connections.collapseFolder")}
            type="button"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
          <ConnectionIcon iconDataUrl={folder.iconDataUrl} size={18} type="localFiles" />
          {isRenamingFolder ? (
            <InlineTreeRenameInput
              ariaLabel={t("connections.renameFolder")}
              initialName={folder.name}
              onCancel={onCancelRename}
              onCommit={(name) => onCommitFolderRename(folder, name)}
            />
          ) : (
            <span>{folder.name}</span>
          )}
          <small>{connectionCount + folderCount}</small>
        </div>
        <span className="folder-actions">
          <button
            className="row-action"
            aria-label={`${t("connections.newSubfolderIn")} ${folder.name}`}
            onClick={() => void onCreateFolder(folder.id)}
          >
            <FolderPlus size={12} />
          </button>
        </span>
      </div>
      {!isCollapsed ? (
        <>
          {folder.connections.length > 0 ? (
            <div className="tree-folder-connections">
              {folder.connections.map((connection, connectionIndex) => (
                <ConnectionRowWithChildTabs
                  activeTabId={activeTabId}
                  childConnections={childConnectionsForConnection(connection.id)}
                  childTabs={childTabsForConnection(connection.id)}
                  connection={connection}
                  connectionIndex={connectionIndex}
                  dragDisabled={dragDisabled}
                  folderId={folder.id}
                  isRenaming={inlineRenameTarget?.kind === "connection" && inlineRenameTarget.id === connection.id}
                  isDraggingSource={draggedSourceId === `connection-${connection.id}`}
                  isDropTarget={dropTarget === `connection-${connection.id}`}
                  isSelected={selectedConnectionId === connection.id}
                  key={connection.id}
                  onChildContextMenu={onChildContextMenu}
                  onCancelRename={onCancelRename}
                  onCancelChildRename={onCancelChildRename}
                  onClickCapture={onClickCapture}
                  onCloseChildTab={onCloseChildTab}
                  onCommitRename={(name) => onCommitConnectionRename(connection, name)}
                  onOpenChildConnection={onOpenChildConnection}
                  onRenameChildConnection={onRenameChildConnection}
                  inlineChildRenameTarget={inlineChildRenameTarget}
                  onStartChildRename={onStartChildRename}
                  onSelect={() => onSelectConnection(connection)}
                  onOpen={(event) => {
                    onSelectConnection(connection);
                    onOpenConnection(connection, event);
                  }}
                  onContextMenu={(event) => onConnectionContextMenu(connection, folder.id, event)}
                  onPointerDragStart={(event) =>
                    onPointerDragStart(
                      event,
                      { kind: "connection", connectionId: connection.id },
                      {
                        kind: "connection",
                        title: connection.name,
                        subtitle: connection.host,
                        connectionType: connection.type,
                        connectionStatus: connection.status,
                      },
                    )
                  }
                />
              ))}
            </div>
          ) : null}
          {pendingFolderDraft?.parentFolderId === folder.id ? (
            <NewFolderDraftRow
              level={level + 1}
              onCancel={onCancelPendingFolder}
              onCommit={(name) => void onCommitPendingFolder(name, folder.id)}
            />
          ) : null}
          {folder.folders.map((childFolder, childFolderIndex) => (
            <ConnectionFolderNode
              collapsedFolderIds={collapsedFolderIds}
              dragDisabled={dragDisabled}
              draggedSourceId={draggedSourceId}
              dropTarget={dropTarget}
              folder={childFolder}
              key={childFolder.id}
              level={level + 1}
              parentFolderId={folder.id}
              folderIndex={childFolderIndex}
              selectedConnectionId={selectedConnectionId}
              activeTabId={activeTabId}
              childConnectionsForConnection={childConnectionsForConnection}
              childTabsForConnection={childTabsForConnection}
              onClickCapture={onClickCapture}
              pendingFolderDraft={pendingFolderDraft}
              inlineRenameTarget={inlineRenameTarget}
              onCancelPendingFolder={onCancelPendingFolder}
              onCommitPendingFolder={onCommitPendingFolder}
              onCancelRename={onCancelRename}
              onCommitConnectionRename={onCommitConnectionRename}
              onCommitFolderRename={onCommitFolderRename}
              onChildContextMenu={onChildContextMenu}
              onCloseChildTab={onCloseChildTab}
              onOpenChildConnection={onOpenChildConnection}
              onRenameChildConnection={onRenameChildConnection}
              inlineChildRenameTarget={inlineChildRenameTarget}
              onStartChildRename={onStartChildRename}
              onCancelChildRename={onCancelChildRename}
              onConnectionContextMenu={onConnectionContextMenu}
              onContextMenu={onContextMenu}
              onCreateFolder={onCreateFolder}
              onOpenConnection={onOpenConnection}
              onSelectConnection={onSelectConnection}
              onPointerDragStart={onPointerDragStart}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </>
      ) : null}
    </section>
  );
}

function NewFolderDraftRow({
  level,
  onCancel,
  onCommit,
}: {
  level: number;
  onCancel: () => void;
  onCommit: (name: string) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isSettledRef = useRef(false);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    groupRef.current?.style.setProperty("--tree-level-indent", `${level * 14}px`);
  }, [level]);

  const settle = (name: string) => {
    if (isSettledRef.current) {
      return;
    }

    isSettledRef.current = true;
    if (!name.trim()) {
      onCancel();
      return;
    }

    void onCommit(name);
  };

  return (
    <div className="tree-group pending-folder-group" ref={groupRef}>
      <div className="tree-folder-row pending-folder-row">
        <div className="tree-folder pending-folder">
          <ChevronDown size={12} />
          <Folder size={13} />
          <input
            aria-label={t("connections.newFolderName")}
            className="pending-folder-input"
            onBlur={(event) => settle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                settle(event.currentTarget.value);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                isSettledRef.current = true;
                onCancel();
              }
            }}
            ref={inputRef}
          />
        </div>
      </div>
    </div>
  );
}

function isTerminalConnectionType(type: ConnectionType) {
  return type === "local" || type === "ssh" || type === "telnet" || type === "serial";
}

function supportsSavedConnectionLayout(type: ConnectionType) {
  return isTerminalConnectionType(type) || type === "url";
}

function supportsAddConnectionToTab(tab: WorkspaceTab | undefined): tab is WorkspaceTab {
  return Boolean(
    tab &&
      (tab.kind === "terminal" ||
        tab.kind === "webview" ||
        tab.kind === "sftp" ||
        tab.kind === "ftp" ||
        tab.kind === "localFiles" ||
        tab.kind === "remoteDesktop"),
  );
}

function InlineTreeRenameInput({
  ariaLabel,
  initialName,
  onCancel,
  onCommit,
}: {
  ariaLabel: string;
  initialName: string;
  onCancel: () => void;
  onCommit: (name: string) => Promise<boolean>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isSettlingRef = useRef(false);
  const [draft, setDraft] = useState(initialName);

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function settle(name: string) {
    if (isSettlingRef.current) {
      return;
    }

    isSettlingRef.current = true;
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === initialName) {
      onCancel();
      return;
    }

    const committed = await onCommit(trimmedName);
    if (!committed) {
      isSettlingRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    onCancel();
  }

  return (
    <input
      aria-label={ariaLabel}
      className="tree-rename-input"
      onBlur={(event) => void settle(event.currentTarget.value)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void settle(event.currentTarget.value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          isSettlingRef.current = true;
          onCancel();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      ref={inputRef}
      value={draft}
    />
  );
}

function TreeContextMenu({
  menu,
  canAddToPane,
  canOpenNewTab,
  isPinned,
  onClose,
  onCreateConnection,
  onCreateFolder,
  onChangeIcon,
  onDelete,
  onProperties,
  onRename,
  onAddToPane,
  onOpenNewTab,
  onSaveLayout,
  onResetLayout,
  onToggleRailPin,
  onTransferSshPublicKey,
}: {
  menu: TreeContextMenuState;
  canAddToPane: boolean;
  canOpenNewTab: boolean;
  isPinned: boolean;
  onClose: () => void;
  onCreateConnection: () => void;
  onCreateFolder: () => void;
  onChangeIcon: () => void;
  onDelete: () => void;
  onProperties: () => void;
  onRename: () => void;
  onAddToPane: (direction: SplitDirection) => void;
  onOpenNewTab: () => void;
  onSaveLayout: () => void;
  onResetLayout: () => void;
  onToggleRailPin: () => void;
  onTransferSshPublicKey: () => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = () => onClose();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) {
      return;
    }

    const bounds = node.getBoundingClientRect();
    const sidebarBounds = node.closest(".connection-sidebar")?.getBoundingClientRect();
    const minLeft = sidebarBounds ? sidebarBounds.left + 8 : 8;
    const maxLeft = sidebarBounds
      ? sidebarBounds.right - bounds.width - 8
      : window.innerWidth - bounds.width - 8;
    const left = Math.min(menu.x, maxLeft);
    const top = Math.min(menu.y, window.innerHeight - bounds.height - 8);
    node.style.left = `${Math.max(minLeft, left)}px`;
    node.style.top = `${Math.max(8, top)}px`;
  }, [menu.x, menu.y]);

  return (
    <div
      className="tree-context-menu"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      ref={menuRef}
      role="menu"
    >
      {menu.kind === "tree" ? (
        <>
          <button onClick={onCreateConnection} role="menuitem" type="button">
            <SquarePlus className="menu-item-icon" size={15} />
            <span>{t("connections.newConnection")}</span>
          </button>
          <button onClick={onCreateFolder} role="menuitem" type="button">
            <FolderPlus className="menu-item-icon" size={15} />
            <span>{t("connections.newFolder")}</span>
          </button>
        </>
      ) : null}
      {menu.kind === "connection" ? (
        <button disabled={!canOpenNewTab} onClick={onOpenNewTab} role="menuitem" type="button">
          <SquarePlus className="menu-item-icon" size={15} />
          <span>{t("workspace.newTab")}</span>
        </button>
      ) : null}
      {menu.kind !== "tree" ? (
        <>
          <button onClick={onRename} role="menuitem" type="button">
            <Pencil className="menu-item-icon" size={15} />
            <span>{t("connections.rename")}</span>
          </button>
          {menu.kind === "folder" ? (
            <button onClick={onChangeIcon} role="menuitem" type="button">
              <Pencil className="menu-item-icon" size={15} />
              <span>{t("connections.changeIcon")}</span>
            </button>
          ) : null}
          <button onClick={onDelete} role="menuitem" type="button">
            <Trash2 className="menu-item-icon" size={15} />
            <span>{t("connections.delete")}</span>
          </button>
        </>
      ) : null}
      {menu.kind === "connection" ? (
        <>
          <button onClick={onToggleRailPin} role="menuitem" type="button">
            {isPinned ? (
              <PinOff className="menu-item-icon" size={15} />
            ) : (
              <Pin className="menu-item-icon" size={15} />
            )}
            <span>{t(isPinned ? "connections.unpinFromRail" : "connections.pinToRail")}</span>
          </button>
          <div className="tree-context-submenu" role="none">
            <button aria-haspopup="menu" className="tree-submenu-trigger" role="menuitem" type="button">
              <PanelRight className="menu-item-icon" size={15} />
              <span>{t("connections.addTo")}</span>
              <ChevronRight className="menu-item-chevron" size={13} />
            </button>
            <div className="tree-context-submenu-menu" role="menu" aria-label={t("connections.addToPane")}>
              <button disabled={!canOpenNewTab} onClick={onOpenNewTab} role="menuitem" type="button">
                <SquarePlus className="menu-item-icon" size={15} />
                <span>{t("workspace.newTab")}</span>
                <small className="menu-shortcut">{t("connections.newTabShortcut")}</small>
              </button>
              {canAddToPane ? (
                <>
                  <button onClick={() => onAddToPane("left")} role="menuitem" type="button">
                    <ArrowLeft className="menu-item-icon" size={15} />
                    <span>{t("connections.left")}</span>
                  </button>
                  <button onClick={() => onAddToPane("right")} role="menuitem" type="button">
                    <ArrowRight className="menu-item-icon" size={15} />
                    <span>{t("connections.right")}</span>
                  </button>
                  <button onClick={() => onAddToPane("down")} role="menuitem" type="button">
                    <ArrowDown className="menu-item-icon" size={15} />
                    <span>{t("connections.lower")}</span>
                  </button>
                  <button onClick={() => onAddToPane("up")} role="menuitem" type="button">
                    <ArrowUp className="menu-item-icon" size={15} />
                    <span>{t("connections.upper")}</span>
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {supportsSavedConnectionLayout(menu.connection.type) ? (
            <div className="tree-context-submenu" role="none">
              <button aria-haspopup="menu" className="tree-submenu-trigger" role="menuitem" type="button">
                <LayoutDashboard className="menu-item-icon" size={15} />
                <span>{t("connections.layout")}</span>
                <ChevronRight className="menu-item-chevron" size={13} />
              </button>
              <div className="tree-context-submenu-menu" role="menu" aria-label={t("connections.layout")}>
                <button onClick={onSaveLayout} role="menuitem" type="button">
                  <Save className="menu-item-icon" size={15} />
                  <span>{t("common.save")}</span>
                </button>
                <button onClick={onResetLayout} role="menuitem" type="button">
                  <RotateCcw className="menu-item-icon" size={15} />
                  <span>{t("common.reset")}</span>
                </button>
              </div>
            </div>
          ) : null}
          {menu.connection.type === "ssh" ? (
            <button onClick={onTransferSshPublicKey} role="menuitem" type="button">
              <KeyRound className="menu-item-icon" size={15} />
              <span>{t("connections.transferSshPublicKey")}</span>
            </button>
          ) : null}
          <button onClick={onProperties} role="menuitem" type="button">
            <Settings className="menu-item-icon" size={15} />
            <span>{t("connections.properties")}</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

function supportsConnectionPasswordCredential(type: ConnectionType | "") {
  return type === "ssh" || type === "telnet" || type === "rdp" || type === "vnc" || type === "ftp";
}

function ConnectionDialog({
  error,
  initialConnection,
  initialConnectionType,
  initialFolderId,
  tree,
  mode,
  rdpSettings,
  sshSettings,
  vncSettings,
  onGeneratedSshKey,
  onCancel,
  onSubmit,
}: {
  error: string;
  initialConnection?: Connection;
  initialConnectionType?: ConnectionType;
  initialFolderId?: string;
  tree: ConnectionTree;
  mode: "save" | "quick" | "edit";
  rdpSettings: RdpSettings;
  sshSettings: SshSettings;
  vncSettings: VncSettings;
  onGeneratedSshKey?: (generated: { privateKeyPath: string; publicKeyPath: string }) => void;
  onCancel: () => void;
  onSubmit: (request: ConnectionDialogRequest) => void | Promise<void>;
}) {
  const { i18n, t } = useTranslation();
  const terminalSettings = useWorkspaceStore((state) => state.terminalSettings);
  const urlSettings = useWorkspaceStore((state) => state.urlSettings);
  const connectionType = initialConnection?.type ?? initialConnectionType ?? "";
  const [authMethod, setAuthMethod] = useState<"keyFile" | "password" | "agent">(
    initialConnection?.authMethod ?? "keyFile",
  );
  const [ftpProtocol, setFtpProtocol] = useState<"ftp" | "ftps" | "sftp">(
    initialConnection?.ftpOptions?.protocol ?? "sftp",
  );
  const [keyPath, setKeyPath] = useState(
    initialConnection?.keyPath ?? sshSettings.defaultKeyPath ?? "",
  );
  const [localStartupDirectory, setLocalStartupDirectory] = useState(
    initialConnection?.localStartupDirectory ?? "",
  );
  const [fileViewOpenExternal, setFileViewOpenExternal] = useState(
    Boolean(initialConnection?.fileViewOpenExternal),
  );
  const [localFilesNameDraft, setLocalFilesNameDraft] = useState(initialConnection?.name ?? "");
  const [localFilesNameEdited, setLocalFilesNameEdited] = useState(Boolean(initialConnection?.name));
  const [localFilesHomeDirectory, setLocalFilesHomeDirectory] = useState("");
  const [keyEmailDialogOpen, setKeyEmailDialogOpen] = useState(false);
  const [keyEmailDraft, setKeyEmailDraft] = useState("");
  const [keyGenerationPassphrase, setKeyGenerationPassphrase] = useState("");
  const [keyGenerationPassphraseConfirm, setKeyGenerationPassphraseConfirm] = useState("");
  const [keyPassphraseDraft, setKeyPassphraseDraft] = useState("");
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [keyGenerationError, setKeyGenerationError] = useState("");
  const [hasStoredConnectionPassword, setHasStoredConnectionPassword] = useState(
    Boolean(initialConnection?.hasPassword || initialConnection?.passwordCredentialId),
  );
  const [hasStoredConnectionPassphrase, setHasStoredConnectionPassphrase] = useState(false);
  const [hasStoredUrlPassword, setHasStoredUrlPassword] = useState(
    Boolean(initialConnection?.hasUrlCredential),
  );
  const [portDraft, setPortDraft] = useState(
    String(
      initialConnection?.port ??
      (connectionType === "ftp"
        ? ftpPortForProtocolSelection(initialConnection?.ftpOptions?.protocol ?? "sftp", "")
        : connectionType
          ? defaultPortForConnectionType(connectionType, sshSettings)
          : ""),
    ),
  );
  const [passwordCredentials, setPasswordCredentials] = useState<StoredCredentialSummary[]>([]);
  const [selectedPasswordCredentialId, setSelectedPasswordCredentialId] = useState(
    initialConnection?.passwordCredentialId ?? "",
  );
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(initialConnection?.iconDataUrl ?? null);
  const [iconManuallyChanged, setIconManuallyChanged] = useState(false);
  const [iconBackgroundColor, setIconBackgroundColor] = useState<string | null>(
    initialConnection?.iconBackgroundColor ?? null,
  );
  const [rdpInheritsSettingsDefaults, setRdpInheritsSettingsDefaults] = useState(
    initialConnection?.rdpOptions?.inheritDefaults ?? true,
  );
  const [sshSocksProxyInheritsSettingsDefaults, setSshSocksProxyInheritsSettingsDefaults] = useState(
    initialConnection?.sshSocksProxyInheritDefaults ?? true,
  );
  const [vncInheritsSettingsDefaults, setVncInheritsSettingsDefaults] = useState(
    initialConnection?.vncOptions?.inheritDefaults ?? true,
  );
  const usesSshDefaults = connectionType === "ssh";
  const isTelnetConnection = connectionType === "telnet";
  const isFtpConnection = connectionType === "ftp";
  const usesRemoteDesktopFields = connectionType
    ? isRemoteDesktopConnectionType(connectionType)
    : false;
  const folderOptions = useMemo(() => flattenFolders(tree.folders), [tree.folders]);
  const reusableIconDataUrls = useMemo(() => {
    const urls = flattenConnections(tree)
      .map((connection) => connection.iconDataUrl)
      .filter((url): url is string => Boolean(url));
    if (initialConnection?.iconDataUrl) {
      urls.unshift(initialConnection.iconDataUrl);
    }
    return Array.from(new Set(urls));
  }, [initialConnection?.iconDataUrl, tree]);
  const localShellOptions = useMemo(
    () => localShellOptionsForPlatform(terminalSettings.customShells),
    // localShellOptionsForPlatform resolves labels via i18next.t, so recompute on language change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n.language, terminalSettings.customShells],
  );
  const isEditMode = mode === "edit";
  const canUseSavedPasswordCredential = mode !== "quick" && supportsConnectionPasswordCredential(connectionType);
  const matchingPasswordCredentials = useMemo(
    () =>
      passwordCredentials.filter(
        (credential) =>
          credential.kind === "connectionPassword" &&
          credential.exists &&
          credential.connectionType === connectionType,
      ),
    [connectionType, passwordCredentials],
  );
  const usesTwoColumnOptions =
    connectionType === "ssh" ||
    connectionType === "rdp" ||
    connectionType === "vnc" ||
    connectionType === "ftp" ||
    connectionType === "url";

  useEffect(() => {
    if (!isEditMode || !initialConnection || !isTauriRuntime()) {
      return;
    }

    let disposed = false;
    const secretKind = initialConnection.type === "url" ? "urlPassword" : "connectionPassword";
    const ownerId = initialConnection.type === "url"
      ? initialConnection.id
      : connectionPasswordOwnerId(initialConnection);

    void invokeCommand("secret_exists", {
      request: {
        kind: secretKind,
        ownerId,
      },
    })
      .then((presence) => {
        if (disposed) {
          return;
        }
        if (initialConnection.type === "url") {
          setHasStoredUrlPassword(presence.exists);
        } else {
          setHasStoredConnectionPassword(presence.exists);
        }
      })
      .catch(() => undefined);

    if (initialConnection.type === "ssh") {
      void invokeCommand("secret_exists", {
        request: { kind: "connectionPassphrase", ownerId: initialConnection.id },
      })
        .then((presence) => {
          if (!disposed) {
            setHasStoredConnectionPassphrase(presence.exists);
          }
        })
        .catch(() => undefined);
    }

    return () => {
      disposed = true;
    };
  }, [initialConnection, isEditMode]);

  useEffect(() => {
    if (!canUseSavedPasswordCredential || !isTauriRuntime()) {
      setPasswordCredentials([]);
      return;
    }

    let disposed = false;
    void invokeCommand("list_stored_credentials", undefined)
      .then((credentials) => {
        if (!disposed) {
          setPasswordCredentials(credentials);
        }
      })
      .catch(() => {
        if (!disposed) {
          setPasswordCredentials([]);
        }
      });

    return () => {
      disposed = true;
    };
  }, [canUseSavedPasswordCredential, connectionType]);

  useEffect(() => {
    if (connectionType !== "localFiles" || !isTauriRuntime()) {
      setLocalFilesHomeDirectory("");
      return;
    }

    let disposed = false;
    void invokeCommand("list_local_places", undefined)
      .then((places) => {
        if (!disposed) {
          setLocalFilesHomeDirectory(places.home?.path ?? "");
        }
      })
      .catch(() => {
        if (!disposed) {
          setLocalFilesHomeDirectory("");
        }
      });

    return () => {
      disposed = true;
    };
  }, [connectionType]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connectionType) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const selectedLocalShell = String(
      form.get("localShell") ??
        initialConnection?.localShell ??
        localShellOptions[0]?.value ??
        "",
    );
    const selectedLocalShellLabel =
      localShellOptions.find((option) => (option.value ?? "") === selectedLocalShell)?.label ??
      t("connections.localTerminal");
    const selectedWslConnectionName = defaultWslConnectionName(distroFromWslShell(selectedLocalShell));
    const rawUrl = String(form.get("url") ?? "").trim();
    const serialLine = String(form.get("serialLine") ?? "COM1").trim() || "COM1";
    const host =
      connectionType === "local" ||
      connectionType === "localFiles" ||
      connectionType === "fileView"
        ? "localhost"
        : connectionType === "serial"
          ? serialLine
        : connectionType === "url"
          ? rawUrl
          : String(form.get("host") ?? "").trim();
    const requestedName = String(form.get("name") ?? "").trim();
    const name =
      connectionType === "local"
        ? requestedName || selectedWslConnectionName || selectedLocalShellLabel
        : connectionType === "localFiles"
          ? requestedName || localFilesDefaultNameForDirectory(localStartupDirectory, t, localFilesHomeDirectory)
        : connectionType === "fileView"
          ? requestedName || fileViewDefaultNameForPath(localStartupDirectory, t)
        : connectionType === "serial"
          ? requestedName || serialLine
        : requestedName || host;
    const ftpProtocolSelection = String(form.get("ftpProtocol") ?? "sftp");
    const ftpTlsModeSelection = String(form.get("ftpTlsMode") ?? "explicit");
    const rawPortValue = String(form.get("port") ?? "").trim();
    const portValue =
      connectionType === "ftp"
        ? String(ftpPortForProtocolSelection(ftpProtocolSelection, rawPortValue, ftpTlsModeSelection))
        : rawPortValue;
    const password = String(form.get("password") ?? "");
    const keyPassphrase = String(form.get("keyPassphrase") ?? "");
    const passwordCredentialId = password ? "" : String(form.get("passwordCredentialId") ?? "").trim();
    const keyPath = String(form.get("keyPath") ?? "").trim();
    const formProxyJump = String(form.get("proxyJump") ?? "").trim();
    const formSshSocksProxy = String(form.get("sshSocksProxy") ?? "").trim();
    const formSshSocksProxyUsername = String(form.get("sshSocksProxyUsername") ?? "").trim();
    const sshSocksProxyPassword = String(form.get("sshSocksProxyPassword") ?? "");
    // Historical field name; in the SSH dialog this is the Default Options mode for proxy and tmux controls.
    const sshUsesDefaultOptions = form.get("sshSocksProxyInheritDefaults") === "on";
    const proxyJump =
      usesSshDefaults && sshUsesDefaultOptions ? (sshSettings.defaultProxyJump ?? "").trim() : formProxyJump;
    const sshSocksProxy =
      usesSshDefaults && sshUsesDefaultOptions ? (sshSettings.defaultSshSocksProxy ?? "").trim() : formSshSocksProxy;
    const sshSocksProxyUsername =
      usesSshDefaults && sshUsesDefaultOptions
        ? (sshSettings.defaultSshSocksProxyUsername ?? "").trim()
        : formSshSocksProxyUsername;
    const useTmuxSessions =
      usesSshDefaults && sshUsesDefaultOptions
        ? sshSettings.defaultUseTmuxSessions
        : form.get("useTmuxSessions") === "on";
    // Compression follows the shared inherit toggle: inheriting stores no
    // override (undefined) so the connection tracks the global default; an
    // explicit choice persists "off"/"fast".
    const formSshCompression = String(form.get("sshCompression") ?? "");
    const sshCompression =
      usesSshDefaults && !sshUsesDefaultOptions && (formSshCompression === "off" || formSshCompression === "fast")
        ? (formSshCompression as SshCompressionMode)
        : undefined;
    const usePsmuxSessions = connectionType === "local" && form.get("usePsmuxSessions") === "on";
    const inheritRdpDefaults = form.get("rdpInheritDefaults") === "on";
    const inheritVncDefaults = form.get("vncInheritDefaults") === "on";
    const urlProxyInheritDefaults = form.get("urlProxyInheritDefaults") === "on";
    const urlProxyMode = String(form.get("urlProxyMode") ?? "direct") as UrlProxyMode;
    const urlProxy = connectionType === "url" && !urlProxyInheritDefaults
      ? parseUrlProxyDraft(
          urlProxyMode,
          String(form.get("urlProxyHost") ?? ""),
          String(form.get("urlProxyPort") ?? ""),
        )
      : undefined;
    const dataPartition =
      connectionType === "url"
        ? (urlProxyInheritDefaults
            ? urlSettings.defaultDataPartition
            : String(form.get("dataPartition") ?? "")
          )?.trim() || undefined
        : undefined;

    void onSubmit({
      name,
      host,
      user:
        connectionType === "local" ||
        connectionType === "localFiles" ||
        connectionType === "fileView"
          ? "local"
          : connectionType === "serial"
            ? ""
          : connectionType === "url"
            ? initialConnection?.user ?? "web"
            : String(form.get("user") ?? "").trim(),
      type: connectionType,
      folderId: String(form.get("folderId") ?? "").trim() || undefined,
      port: portValue ? Number(portValue) : undefined,
      keyPath: usesSshDefaults && authMethod === "keyFile" ? keyPath || undefined : undefined,
      proxyJump: usesSshDefaults ? proxyJump || undefined : undefined,
      sshSocksProxy: usesSshDefaults ? sshSocksProxy || undefined : undefined,
      sshSocksProxyUsername: usesSshDefaults ? sshSocksProxyUsername || undefined : undefined,
      sshSocksProxyInheritDefaults: usesSshDefaults ? sshUsesDefaultOptions : undefined,
      sshCompression: usesSshDefaults ? sshCompression : undefined,
      sshSocksProxyPassword: usesSshDefaults && !sshUsesDefaultOptions ? sshSocksProxyPassword || undefined : undefined,
      authMethod: usesSshDefaults ? authMethod : undefined,
      keyPassphrase: usesSshDefaults && authMethod === "keyFile" ? keyPassphrase || undefined : undefined,
      useTmuxSessions: usesSshDefaults ? useTmuxSessions : undefined,
      usePsmuxSessions: connectionType === "local" ? usePsmuxSessions : undefined,
      localShell: connectionType === "local" ? selectedLocalShell || undefined : undefined,
      localStartupDirectory:
        connectionType === "local" || connectionType === "localFiles"
          ? String(form.get("localStartupDirectory") ?? "").trim() || undefined
          : connectionType === "fileView"
            ? localStartupDirectory.trim() || undefined
            : undefined,
      localStartupScript:
        connectionType === "local" || connectionType === "ssh"
          ? String(form.get("localStartupScript") ?? "").trim() || undefined
          : undefined,
      sshStartupScriptApplyToExistingTmux:
        connectionType === "ssh" ? form.get("sshStartupScriptApplyToExistingTmux") === "on" : undefined,
      fileViewOpenExternal:
        connectionType === "fileView" ? form.get("fileViewOpenExternal") === "on" : undefined,
      serialLine: connectionType === "serial" ? serialLine : undefined,
      serialSpeed:
        connectionType === "serial"
          ? Number(String(form.get("serialSpeed") ?? "9600").trim() || "9600")
          : undefined,
      url: connectionType === "url" ? rawUrl : undefined,
      dataPartition:
        connectionType === "url" ? dataPartition : undefined,
      urlProxy: connectionType === "url" ? urlProxy : undefined,
      urlProxyInheritDefaults: connectionType === "url" ? urlProxyInheritDefaults : undefined,
      rdpOptions:
        connectionType === "rdp"
          ? {
              inheritDefaults: inheritRdpDefaults,
              colorDepth: inheritRdpDefaults
                ? rdpSettings.colorDepth
                : Number(String(form.get("rdpColorDepth") ?? rdpSettings.colorDepth)) as RdpSettings["colorDepth"],
              redirectClipboard: inheritRdpDefaults
                ? rdpSettings.redirectClipboard
                : form.get("rdpRedirectClipboard") === "on",
              redirectDrives: inheritRdpDefaults
                ? rdpSettings.redirectDrives
                : form.get("rdpRedirectDrives") === "on",
              bitmapCache: inheritRdpDefaults
                ? rdpSettings.bitmapCache
                : form.get("rdpBitmapCache") === "on",
              performanceProfile: String(
                inheritRdpDefaults
                  ? rdpSettings.performanceProfile
                  : form.get("rdpPerformanceProfile") ?? rdpSettings.performanceProfile,
              ) as RdpSettings["performanceProfile"],
              remoteResolution: String(
                inheritRdpDefaults
                  ? rdpSettings.remoteResolution
                  : form.get("rdpRemoteResolution") ?? rdpSettings.remoteResolution,
              ) as RdpSettings["remoteResolution"],
              viewMode: String(
                inheritRdpDefaults
                  ? rdpSettings.viewMode
                  : form.get("rdpViewMode") ?? rdpSettings.viewMode,
              ) as RdpSettings["viewMode"],
            }
          : undefined,
      vncOptions:
        connectionType === "vnc"
          ? {
              inheritDefaults: inheritVncDefaults,
              sharedSession: inheritVncDefaults
                ? vncSettings.sharedSession
                : form.get("vncSharedSession") === "on",
              viewOnly: inheritVncDefaults
                ? vncSettings.viewOnly
                : form.get("vncViewOnly") === "on",
              colorLevel: String(
                inheritVncDefaults ? vncSettings.colorLevel : form.get("vncColorLevel") ?? vncSettings.colorLevel,
              ) as VncSettings["colorLevel"],
              preferredEncoding: String(
                inheritVncDefaults
                  ? vncSettings.preferredEncoding
                  : form.get("vncPreferredEncoding") ?? vncSettings.preferredEncoding,
              ) as VncSettings["preferredEncoding"],
              viewMode: String(
                inheritVncDefaults ? vncSettings.viewMode : form.get("vncViewMode") ?? vncSettings.viewMode,
              ) as VncSettings["viewMode"],
            }
          : undefined,
      ftpOptions:
        connectionType === "ftp"
          ? {
              protocol: String(form.get("ftpProtocol") ?? "sftp") as "sftp" | "ftp" | "ftps",
              mode: String(form.get("ftpMode") ?? "passive") as "passive" | "active",
              tlsMode:
                form.get("ftpProtocol") === "ftps"
                  ? (String(form.get("ftpTlsMode") ?? "explicit") as "explicit" | "implicit")
                  : undefined,
              transferType: String(form.get("ftpTransferType") ?? "binary") as
                | "binary"
                | "ascii",
              utf8: form.get("ftpUtf8") === "on",
              showHidden: form.get("ftpShowHidden") === "on",
              ignoreCertErrors: form.get("ftpIgnoreCertErrors") === "on",
              connectTimeoutSecs:
                Number(String(form.get("ftpConnectTimeoutSecs") ?? "30")) || 30,
              keepaliveSecs:
                Number(String(form.get("ftpKeepaliveSecs") ?? "0")) || undefined,
            }
          : undefined,
      password:
        isTelnetConnection
          ? password
          : usesSshDefaults && authMethod === "password"
          ? password
          : usesRemoteDesktopFields
            ? password || undefined
            : isFtpConnection
              ? password || undefined
              : undefined,
      passwordCredentialId: canUseSavedPasswordCredential ? passwordCredentialId || undefined : undefined,
      urlCredentialUsername:
        connectionType === "url"
          ? String(form.get("urlCredentialUsername") ?? "").trim() || undefined
          : undefined,
      urlPassword: connectionType === "url" ? String(form.get("urlPassword") ?? "") || undefined : undefined,
      iconDataUrl: mode === "quick" ? undefined : iconDataUrl,
      iconBackgroundColor: mode === "quick" ? undefined : iconBackgroundColor,
    });
  }

  async function handleBrowseKeyFile() {
    const selectedPath = await selectKeyFile(keyPath || sshSettings.defaultKeyPath);
    if (selectedPath) {
      setKeyPath(selectedPath);
    }
  }

  async function handleBrowseLocalStartupDirectory() {
    const selectedPath = await selectAppLauncherFolder({
      title: t("connections.localStartupDirectoryPickerTitle"),
    });
    if (selectedPath) {
      setLocalStartupDirectory(selectedPath);
    }
  }

  function handleLocalFilesNameChange(value: string) {
    setLocalFilesNameDraft(value);
    setLocalFilesNameEdited(Boolean(value.trim()));
  }

  async function handleBrowseFileViewPath() {
    const selectedPath = await selectFileViewPath({
      title: t("connections.fileViewPickerTitle"),
      defaultPath: localStartupDirectory || undefined,
    });
    if (selectedPath) {
      setLocalStartupDirectory(selectedPath);
    }
  }

  function handleOpenKeyEmailDialog() {
    setKeyGenerationError("");
    setKeyEmailDraft("");
    setKeyGenerationPassphrase("");
    setKeyGenerationPassphraseConfirm("");
    setKeyEmailDialogOpen(true);
  }

  function handleFtpProtocolChange(protocol: "ftp" | "ftps" | "sftp") {
    setFtpProtocol(protocol);
    if (protocol === "sftp") {
      setPortDraft("22");
    }
  }

  const handleIconDataUrlChange = useCallback((nextIconDataUrl: string | null) => {
    setIconManuallyChanged(true);
    setIconDataUrl(nextIconDataUrl);
  }, []);

  const handleWslDistroIconChange = useCallback(
    (nextIconDataUrl: string | null) => {
      if (mode === "save" && !iconManuallyChanged) {
        setIconDataUrl(nextIconDataUrl);
      }
    },
    [iconManuallyChanged, mode],
  );

  async function handleGenerateKeyPair(emailInput: string) {
    const email = emailInput.trim();
    if (!email) {
      return;
    }
    try {
      setIsGeneratingKey(true);
      setKeyGenerationError("");
      const generated = await invokeCommand("generate_ssh_key_pair", {
        request: { email, passphrase: keyGenerationPassphrase || undefined },
      });
      setKeyPath(generated.privateKeyPath);
      setKeyPassphraseDraft(keyGenerationPassphrase);
      onGeneratedSshKey?.(generated);
      setKeyEmailDialogOpen(false);
      setKeyEmailDraft("");
    } catch (generateError) {
      setKeyGenerationError(generateError instanceof Error ? generateError.message : String(generateError));
    } finally {
      setIsGeneratingKey(false);
    }
  }

  function renderConnectionTypeFields() {
    const localFilesNameValue = isEditMode || localFilesNameEdited
      ? localFilesNameDraft
      : localFilesDefaultNameForDirectory(localStartupDirectory, t, localFilesHomeDirectory);

    switch (connectionType) {
      case "local":
        return (
          <LocalConnectionFields
            initialConnection={initialConnection}
            localShellOptions={localShellOptions}
            localStartupDirectory={localStartupDirectory}
            onWslDistroIconChange={handleWslDistroIconChange}
            onBrowseLocalStartupDirectory={() => void handleBrowseLocalStartupDirectory()}
            onLocalStartupDirectoryChange={setLocalStartupDirectory}
          />
        );
      case "localFiles":
        return (
          <LocalFilesConnectionFields
            localStartupDirectory={localStartupDirectory}
            nameValue={localFilesNameValue}
            onBrowseLocalStartupDirectory={() => void handleBrowseLocalStartupDirectory()}
            onLocalStartupDirectoryChange={setLocalStartupDirectory}
            onNameChange={handleLocalFilesNameChange}
          />
        );
      case "fileView":
        return (
          <FileViewConnectionFields
            filePath={localStartupDirectory}
            nameValue={
              isEditMode || localFilesNameEdited
                ? localFilesNameDraft
                : fileViewDefaultNameForPath(localStartupDirectory, t)
            }
            openExternal={fileViewOpenExternal}
            onBrowseFilePath={() => void handleBrowseFileViewPath()}
            onFilePathChange={setLocalStartupDirectory}
            onNameChange={handleLocalFilesNameChange}
            onOpenExternalChange={setFileViewOpenExternal}
          />
        );
      case "serial":
        return <SerialConnectionFields initialConnection={initialConnection} />;
      case "url":
        return (
          <UrlConnectionFields
            hasStoredUrlPassword={hasStoredUrlPassword}
            initialConnection={initialConnection}
            isEditMode={isEditMode}
          />
        );
      case "ssh":
        return (
          <SshConnectionFields
            authMethod={authMethod}
            hasStoredConnectionPassword={hasStoredConnectionPassword}
            hasStoredConnectionPassphrase={hasStoredConnectionPassphrase}
            initialConnection={initialConnection}
            isEditMode={isEditMode}
            keyPath={keyPath}
            keyPassphraseDraft={keyPassphraseDraft}
            matchingPasswordCredentials={matchingPasswordCredentials}
            onAuthMethodChange={setAuthMethod}
            onBrowseKeyFile={() => void handleBrowseKeyFile()}
            onKeyPathChange={setKeyPath}
            onOpenKeyEmailDialog={handleOpenKeyEmailDialog}
            onPortDraftChange={setPortDraft}
            onSelectedPasswordCredentialIdChange={setSelectedPasswordCredentialId}
            portDraft={portDraft}
            selectedPasswordCredentialId={selectedPasswordCredentialId}
            sshSettings={sshSettings}
          />
        );
      case "telnet":
        return (
          <TelnetConnectionFields
            hasStoredConnectionPassword={hasStoredConnectionPassword}
            initialConnection={initialConnection}
            isEditMode={isEditMode}
            matchingPasswordCredentials={matchingPasswordCredentials}
            onPortDraftChange={setPortDraft}
            onSelectedPasswordCredentialIdChange={setSelectedPasswordCredentialId}
            portDraft={portDraft}
            selectedPasswordCredentialId={selectedPasswordCredentialId}
            sshSettings={sshSettings}
          />
        );
      case "rdp":
        return (
          <RdpConnectionFields
            hasStoredConnectionPassword={hasStoredConnectionPassword}
            initialConnection={initialConnection}
            isEditMode={isEditMode}
            matchingPasswordCredentials={matchingPasswordCredentials}
            onPortDraftChange={setPortDraft}
            onSelectedPasswordCredentialIdChange={setSelectedPasswordCredentialId}
            portDraft={portDraft}
            selectedPasswordCredentialId={selectedPasswordCredentialId}
            sshSettings={sshSettings}
          />
        );
      case "vnc":
        return (
          <VncConnectionFields
            hasStoredConnectionPassword={hasStoredConnectionPassword}
            initialConnection={initialConnection}
            isEditMode={isEditMode}
            matchingPasswordCredentials={matchingPasswordCredentials}
            onPortDraftChange={setPortDraft}
            onSelectedPasswordCredentialIdChange={setSelectedPasswordCredentialId}
            portDraft={portDraft}
            selectedPasswordCredentialId={selectedPasswordCredentialId}
            sshSettings={sshSettings}
          />
        );
      case "ftp":
        return (
          <FtpConnectionFields
            hasStoredConnectionPassword={hasStoredConnectionPassword}
            initialConnection={initialConnection}
            isEditMode={isEditMode}
            matchingPasswordCredentials={matchingPasswordCredentials}
            onPortDraftChange={setPortDraft}
            onSelectedPasswordCredentialIdChange={setSelectedPasswordCredentialId}
            portDraft={portDraft}
            selectedPasswordCredentialId={selectedPasswordCredentialId}
            sshSettings={sshSettings}
          />
        );
      default:
        return null;
    }
  }

  function renderConnectionTypeOptions() {
    switch (connectionType) {
      case "ssh":
        return (
          <SshConnectionOptions
            initialConnection={initialConnection}
            onInheritsSettingsDefaultsChange={setSshSocksProxyInheritsSettingsDefaults}
            sshInheritsSettingsDefaults={sshSocksProxyInheritsSettingsDefaults}
            sshSettings={sshSettings}
          />
        );
      case "rdp":
        return (
          <RdpConnectionOptions
            initialConnection={initialConnection}
            onInheritsSettingsDefaultsChange={setRdpInheritsSettingsDefaults}
            rdpInheritsSettingsDefaults={rdpInheritsSettingsDefaults}
            rdpSettings={rdpSettings}
          />
        );
      case "vnc":
        return (
          <VncConnectionOptions
            initialConnection={initialConnection}
            onInheritsSettingsDefaultsChange={setVncInheritsSettingsDefaults}
            vncInheritsSettingsDefaults={vncInheritsSettingsDefaults}
            vncSettings={vncSettings}
          />
        );
      case "ftp":
        return (
          <FtpConnectionOptions
            ftpProtocol={ftpProtocol}
            initialConnection={initialConnection}
            onFtpProtocolChange={handleFtpProtocolChange}
          />
        );
      case "url":
        return <UrlConnectionOptions initialConnection={initialConnection} />;
      default:
        return null;
    }
  }

  return (
    <DialogPortal>
    <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
      <form
        className={usesTwoColumnOptions ? "connection-dialog connection-dialog-wide" : "connection-dialog"}
        onSubmit={handleSubmit}
      >
        <header
          className={mode === "quick" ? "connection-dialog-header" : "connection-dialog-header compact"}
        >
          <div>
            <p className="connection-dialog-eyebrow">
              {mode === "edit"
                ? t("connections.connectionProperties")
                : mode === "save"
                  ? t("connections.newConnectionTitle")
                  : t("connections.quickConnect")}
            </p>
          </div>
        </header>

        {connectionType ? (
          <div className="connection-type-summary">
            {mode === "quick" ? (
              <ConnectionGlyph
                iconBackgroundColor={initialConnection?.iconBackgroundColor}
                iconDataUrl={initialConnection?.iconDataUrl}
                localShell={initialConnection?.localShell}
                size={20}
                type={connectionType}
              />
            ) : (
              <ConnectionIconPicker
                customIconDataUrls={reusableIconDataUrls}
                iconBackgroundColor={iconBackgroundColor}
                iconDataUrl={iconDataUrl}
                localShell={initialConnection?.localShell}
                onChange={handleIconDataUrlChange}
                type={connectionType}
              />
            )}
            <span>
              <strong>{connectionTypeLabel(connectionType)}</strong>
              <small>
                {isEditMode && initialConnection
                  ? connectionSubtitle(initialConnection)
                  : connectionTypeSubtitle(connectionType)}
              </small>
            </span>
            {mode !== "quick" ? (
              <ConnectionIconBackgroundPicker
                color={iconBackgroundColor}
                onChange={setIconBackgroundColor}
              />
            ) : null}
          </div>
        ) : null}

        {connectionType ? (
          <div
            className={
              usesTwoColumnOptions
                ? "connection-dialog-fields connection-dialog-fields-two-column"
                : "connection-dialog-fields"
            }
          >
            <div className="connection-dialog-primary-fields">
            {mode === "save" || mode === "edit" ? (
              <label>
                <span>{t("connections.folder")}</span>
                <select name="folderId" defaultValue={initialFolderId ?? ""}>
                  <option value="">{t("connections.root")}</option>
                  {folderOptions.map((option) => (
                    <option value={option.folder.id} key={option.folder.id}>
                      {"  ".repeat(option.level)}
                      {option.folder.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {renderConnectionTypeFields()}
            </div>
            {renderConnectionTypeOptions()}
          </div>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        <LegacyDialogActions
          primary={<button className="approve-button" disabled={!connectionType} type="submit">
            <Check size={15} />
            {mode === "quick" ? t("connections.saveAndConnect") : t("common.save")}
          </button>}
          cancel={<button className="toolbar-button" type="button" onClick={onCancel}>
            {t("connections.cancel")}
          </button>}
        />
      </form>
      {keyEmailDialogOpen ? (
        <ConnectionSshKeyEmailDialog
          email={keyEmailDraft}
          error={keyGenerationError}
          isGenerating={isGeneratingKey}
          passphrase={keyGenerationPassphrase}
          passphraseConfirm={keyGenerationPassphraseConfirm}
          onCancel={() => {
            if (isGeneratingKey) {
              return;
            }
            setKeyEmailDialogOpen(false);
            setKeyEmailDraft("");
          }}
          onChange={setKeyEmailDraft}
          onPassphraseChange={setKeyGenerationPassphrase}
          onPassphraseConfirmChange={setKeyGenerationPassphraseConfirm}
          onSubmit={(email) => void handleGenerateKeyPair(email)}
        />
      ) : null}
    </div>
    </DialogPortal>
  );
}

function ConnectionSshKeyEmailDialog({
  email,
  error,
  isGenerating,
  passphrase,
  passphraseConfirm,
  onCancel,
  onChange,
  onPassphraseChange,
  onPassphraseConfirmChange,
  onSubmit,
}: {
  email: string;
  error: string;
  isGenerating: boolean;
  passphrase: string;
  passphraseConfirm: string;
  onCancel: () => void;
  onChange: (email: string) => void;
  onPassphraseChange: (passphrase: string) => void;
  onPassphraseConfirmChange: (passphrase: string) => void;
  onSubmit: (email: string) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const canSubmit = Boolean(email.trim()) && passphrase === passphraseConfirm && !isGenerating;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onSubmit(email);
  }

  return (
    <DialogPortal>
    <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
      <form
        aria-label={t("settings.sshKeyEmailDialogTitle")}
        aria-modal="true"
        className="connection-dialog ssh-key-email-dialog"
        onSubmit={handleSubmit}
        role="dialog"
      >
        <header className="connection-dialog-header compact">
          <div>
            <p className="panel-label">{t("settings.sectionSsh")}</p>
            <h2>{t("settings.sshKeyEmailDialogTitle")}</h2>
          </div>
        </header>
        <p className="field-hint">{t("settings.sshKeyEmailDialogHint")}</p>
        {error ? <p className="form-error">{error}</p> : null}
        <label>
          <span>{t("settings.sshKeyEmailPrompt")}</span>
          <input
            autoComplete="email"
            onChange={(event) => onChange(event.currentTarget.value)}
            placeholder={t("settings.sshKeyEmailPlaceholder")}
            ref={inputRef}
            required
            type="email"
            value={email}
          />
        </label>
        <label>
          <span>{t("settings.sshKeyPassphraseOptional")}</span>
          <input
            autoComplete="new-password"
            onChange={(event) => onPassphraseChange(event.currentTarget.value)}
            type="password"
            value={passphrase}
          />
        </label>
        <label>
          <span>{t("settings.sshKeyPassphraseConfirm")}</span>
          <input
            autoComplete="new-password"
            onChange={(event) => onPassphraseConfirmChange(event.currentTarget.value)}
            type="password"
            value={passphraseConfirm}
          />
        </label>
        {passphrase !== passphraseConfirm ? (
          <p className="form-error">{t("settings.sshKeyPassphraseMismatch")}</p>
        ) : null}
        <LegacyDialogActions
          primary={<button className="approve-button" disabled={!canSubmit} type="submit">
            <KeyRound size={15} />
            {isGenerating ? t("settings.sshKeyGenerating") : t("settings.generateSshKey")}
          </button>}
          cancel={<button className="toolbar-button" disabled={isGenerating} onClick={onCancel} type="button">
            {t("common.cancel")}
          </button>}
        />
      </form>
    </div>
    </DialogPortal>
  );
}

function deleteConfirmationTitle(t: TFunction, target: DeleteTarget) {
  return target.kind === "connection"
    ? t("connections.deleteConnectionConfirm")
    : t("connections.deleteFolderConfirm");
}

function deleteConfirmationMessage(t: TFunction, target: DeleteTarget) {
  const name = target.kind === "connection" ? target.connection.name : target.folder.name;
  return `${deleteConfirmationTitle(t, target)}: ${name}\n\n${t("connections.cannotBeUndone")}`;
}

function newestUnattachedTmuxSession(sessions: TmuxSession[], skippedSessionIds: ReadonlySet<string>) {
  return sessions
    .filter((session) => !session.attached && !skippedSessionIds.has(session.id))
    .sort((left, right) => (right.created ?? 0) - (left.created ?? 0))[0];
}

function ConfirmDeleteDialog({
  onCancel,
  onConfirm,
  target,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  target: DeleteTarget;
}) {
  const { t } = useTranslation();
  const name = target.kind === "connection" ? target.connection.name : target.folder.name;
  const title = deleteConfirmationTitle(t, target);

  return (
    <DeleteConfirmationDialog
      confirmLabel={t("common.delete")}
      message={`${name}\n\n${t("connections.cannotBeUndone")}`}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title={title}
    />
  );
}

function TransferSshPublicKeyDialog({
  connection,
  error,
  onCancel,
  onSubmit,
}: {
  connection: Connection;
  error: string;
  onCancel: () => void;
  onSubmit: (username: string, password: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(connection.user);
  const [password, setPassword] = useState("");
  const canSubmit = Boolean(username.trim()) && password.length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    void onSubmit(username.trim(), password);
  }

  return (
    <DialogPortal>
    <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
      <form className="connection-dialog ssh-public-key-dialog" onSubmit={handleSubmit}>
        <header className="connection-dialog-header compact">
          <div>
            <p className="panel-label">{t("connections.transferSshPublicKey")}</p>
            <h2>{connection.name}</h2>
          </div>
        </header>
        <p className="field-hint">{t("connections.transferSshPublicKeyHint")}</p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="form-grid">
          <label>
            <span>{t("connections.user")}*</span>
            <input
              autoComplete="username"
              onChange={(event) => setUsername(event.currentTarget.value)}
              required
              value={username}
            />
          </label>
          <label>
            <span>{t("connections.passwordLabel")}*</span>
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              type="password"
              value={password}
            />
          </label>
        </div>
        <LegacyDialogActions
          primary={<button className="approve-button" disabled={!canSubmit} type="submit">
            <KeyRound size={15} />
            {t("connections.transferSshPublicKeyAction")}
          </button>}
          cancel={<button className="toolbar-button" type="button" onClick={onCancel}>
            {t("connections.cancel")}
          </button>}
        />
      </form>
    </div>
    </DialogPortal>
  );
}

function TreeDragPreview({ preview }: { preview: TreeDragPreview }) {
  const previewRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = previewRef.current;
    if (!node) {
      return;
    }

    node.style.left = `${preview.x - preview.offsetX}px`;
    node.style.top = `${preview.y - preview.offsetY}px`;
    node.style.width = `${preview.width}px`;
  }, [preview.offsetX, preview.offsetY, preview.width, preview.x, preview.y]);

  return (
    <div className={`tree-drag-preview ${preview.kind}`} ref={previewRef}>
      {preview.kind === "folder" ? (
        <ConnectionIcon iconDataUrl={preview.iconDataUrl} size={15} type="localFiles" />
      ) : (
        <ConnectionGlyph size={15} type={preview.connectionType ?? "ssh"} />
      )}
      <span className="connection-main">
        <strong>{preview.title}</strong>
        {preview.subtitle ? <small>{preview.subtitle}</small> : null}
      </span>
      {preview.kind === "folder" ? (
        <small className="tree-drag-count">{preview.connectionCount ?? 0}</small>
      ) : preview.connectionStatus ? (
        <span className={`status-dot ${preview.connectionStatus}`} />
      ) : null}
    </div>
  );
}

// The slice of the target the dropped Connection will occupy: half the pane in
// the chosen direction for a split, or the whole area for an empty-canvas drop.
function dockHighlightRect(zone: CanvasDropZone): DockRect {
  const { rect } = zone;
  if (zone.kind === "empty") {
    return rect;
  }
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  switch (zone.direction) {
    case "left":
      return { left: rect.left, top: rect.top, width: halfW, height: rect.height };
    case "right":
      return { left: rect.left + halfW, top: rect.top, width: halfW, height: rect.height };
    case "up":
      return { left: rect.left, top: rect.top, width: rect.width, height: halfH };
    case "down":
    default:
      return { left: rect.left, top: rect.top + halfH, width: rect.width, height: halfH };
  }
}

// Visual Studio–style docking overlay shown while dragging a Connection over the
// Workspace Canvas. A faint outline frames the target pane and an accent-tinted
// panel previews the snap region; both glide between edges/panes because the
// same nodes persist across renders and animate their inline geometry via CSS.
function DockOverlay({ zone }: { zone: CanvasDropZone | null }) {
  if (!zone) {
    return null;
  }
  const { rect } = zone;
  const highlight = dockHighlightRect(zone);
  const highlightClass =
    zone.kind === "split"
      ? `dock-overlay-highlight dock-overlay-${zone.direction}`
      : "dock-overlay-highlight dock-overlay-empty";
  // Portal to <body>: the host `.connection-sidebar` declares `contain: layout`,
  // which makes it the containing block for `position: fixed` descendants. Left
  // inline, the overlay would resolve its viewport coordinates against the
  // sidebar box and render misaligned with the panes it points at.
  return (
    <DialogPortal>
      <div className="dock-overlay" aria-hidden="true">
        <div
          className="dock-overlay-outline"
          style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}
        />
        <div
          className={highlightClass}
          style={{
            left: `${highlight.left}px`,
            top: `${highlight.top}px`,
            width: `${highlight.width}px`,
            height: `${highlight.height}px`,
          }}
        />
      </div>
    </DialogPortal>
  );
}

function ConnectionRowWithChildTabs({
  activeTabId,
  childConnections,
  childTabs,
  connection,
  connectionIndex,
  dragDisabled,
  folderId,
  isRenaming,
  isDraggingSource,
  isDropTarget,
  isSelected,
  onChildContextMenu,
  onCancelChildRename,
  onCancelRename,
  onClickCapture,
  onCloseChildTab,
  onCommitRename,
  onContextMenu,
  onOpen,
  onOpenChildConnection,
  onPointerDragStart,
  onRenameChildConnection,
  onSelect,
  inlineChildRenameTarget,
  onStartChildRename,
}: {
  activeTabId: string;
  childConnections: WorkspaceChildConnection[];
  childTabs: WorkspaceTab[];
  connection: Connection;
  connectionIndex: number;
  dragDisabled: boolean;
  folderId?: string;
  isRenaming: boolean;
  isDraggingSource: boolean;
  isDropTarget: boolean;
  isSelected: boolean;
  onChildContextMenu: (
    connection: Connection,
    child: WorkspaceChildConnection,
    event: ReactMouseEvent<HTMLElement>,
  ) => void | Promise<void>;
  onCancelChildRename: () => void;
  onCancelRename: () => void;
  onClickCapture: (event: ReactMouseEvent) => void;
  onCloseChildTab: (childConnectionId: string) => void;
  onCommitRename: (name: string) => Promise<boolean>;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onOpenChildConnection: (connection: Connection, child: WorkspaceChildConnection) => void;
  onPointerDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onRenameChildConnection: (child: WorkspaceChildConnection, name: string) => boolean;
  onSelect: () => void;
  inlineChildRenameTarget: string | null;
  onStartChildRename: (childConnectionId: string) => void;
}) {
  const activeTab = childTabs.find((tab) => tab.id === activeTabId);
  const isActiveParent =
    activeTab?.childConnectionGroupParentId === connection.id
      ? true
      : Boolean(
          activeTab &&
            activeTab.connection?.id === connection.id &&
            !activeTab.childConnectionId &&
            !activeTab.childConnectionGroupParentId,
        );
  const childLocationById = new Map<string, { tab: WorkspaceTab; paneId?: string }>();
  for (const tab of childTabs) {
    if (tab.childConnectionId) {
      childLocationById.set(tab.childConnectionId, { tab });
    }
    for (const pane of tab.panes) {
      if (pane.childConnectionId && !childLocationById.has(pane.childConnectionId)) {
        childLocationById.set(pane.childConnectionId, { tab, paneId: pane.id });
      }
    }
  }
  return (
    <>
      <ConnectionRow
        connection={connection}
        connectionIndex={connectionIndex}
        dragDisabled={dragDisabled}
        folderId={folderId}
        isActiveParent={isActiveParent}
        isDraggingSource={isDraggingSource}
        isDropTarget={isDropTarget}
        isRenaming={isRenaming}
        isSelected={isSelected}
        onCancelRename={onCancelRename}
        onClickCapture={onClickCapture}
        onCommitRename={onCommitRename}
        onContextMenu={onContextMenu}
        onOpen={onOpen}
        onPointerDragStart={onPointerDragStart}
        onSelect={onSelect}
      />
      {childConnections.map((child) => {
        const location = childLocationById.get(child.id);
        const tab = location?.tab;
        const active = isChildConnectionRowActive({
          activeTabId,
          paneId: location?.paneId,
          tab,
        });
        return (
        <ConnectionChildTabRow
          active={active}
          child={child}
          connection={connection}
          connected={Boolean(location)}
          isRenaming={inlineChildRenameTarget === child.id}
          key={child.id}
          onActivate={() => onOpenChildConnection(connection, child)}
          onCancelRename={onCancelChildRename}
          onClose={() => onCloseChildTab(child.id)}
          onCommitRename={(name) => onRenameChildConnection(child, name)}
          onContextMenu={(event) => void onChildContextMenu(connection, child, event)}
          onRename={() => onStartChildRename(child.id)}
        />
        );
      })}
    </>
  );
}

function ConnectionChildTabRow({
  active,
  child,
  connection,
  connected,
  isRenaming,
  onActivate,
  onCancelRename,
  onClose,
  onCommitRename,
  onContextMenu,
  onRename,
}: {
  active: boolean;
  child: WorkspaceChildConnection;
  connection: Connection;
  connected: boolean;
  isRenaming: boolean;
  onActivate: () => void;
  onCancelRename: () => void;
  onClose?: () => void;
  onCommitRename: (name: string) => boolean;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onRename: () => void;
}) {
  const { t } = useTranslation();
  const doubleClickOpensConnection = useWorkspaceStore(
    (state) => state.generalSettings.doubleClickOpensConnection,
  );
  const title = child.name;
  const clickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  function clearClickTimer() {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }

  return (
    <div
      className={`connection-child-tab-row${active ? " active" : ""}`}
      onContextMenu={onContextMenu}
    >
      <button
        className="connection-child-tab-open"
        onClick={() => {
          // In double-click-to-open mode a single click must not open the
          // child Connection, matching the parent ConnectionRow. Opening
          // happens from onDoubleClick below; rename moves to the context menu.
          if (doubleClickOpensConnection) {
            clearClickTimer();
            return;
          }
          clearClickTimer();
          clickTimerRef.current = window.setTimeout(() => {
            clickTimerRef.current = null;
            onActivate();
          }, 180);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          clearClickTimer();
          if (doubleClickOpensConnection) {
            onActivate();
            return;
          }
          onRename();
        }}
        type="button"
      >
        <ConnectionGlyph
          iconBackgroundColor={child.iconBackgroundColor ?? connection.iconBackgroundColor}
          iconDataUrl={child.iconDataUrl ?? connection.iconDataUrl}
          localShell={connection.localShell}
          size={14}
          type={connection.type}
        />
        <span className="connection-main">
          {isRenaming ? (
            <InlineTreeRenameInput
              ariaLabel={t("connections.rename")}
              initialName={title}
              onCancel={onCancelRename}
              onCommit={async (name) => onCommitRename(name)}
            />
          ) : (
            <strong>{title}</strong>
          )}
        </span>
      </button>
      <ConnectionStatusIndicator
        connectionType={connection.type}
        status={connected ? "connected" : "idle"}
      />
      <button
        aria-label={t("workspace.closeTab", { title })}
        className="connection-child-tab-close"
        onClick={onClose}
        title={t("workspace.closeTab", { title })}
        type="button"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function ConnectionRow({
  connection,
  connectionIndex,
  dragDisabled,
  folderId,
  isActiveParent,
  isRenaming,
  isDraggingSource,
  isDropTarget,
  isSelected,
  onCancelRename,
  onClickCapture,
  onContextMenu,
  onCommitRename,
  onOpen,
  onPointerDragStart,
  onSelect,
}: {
  connection: Connection;
  connectionIndex: number;
  dragDisabled: boolean;
  folderId?: string;
  isActiveParent: boolean;
  isRenaming: boolean;
  isDraggingSource: boolean;
  isDropTarget: boolean;
  isSelected: boolean;
  onCancelRename: () => void;
  onClickCapture: (event: ReactMouseEvent) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onCommitRename: (name: string) => Promise<boolean>;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onSelect: () => void;
}) {
  const doubleClickOpensConnection = useWorkspaceStore(
    (state) => state.generalSettings.doubleClickOpensConnection,
  );

  return (
    <div
      className={`connection-row ${dragDisabled ? "" : "can-drag"} ${
        isDropTarget ? "drop-target" : ""
      } ${isActiveParent ? "active" : ""
      } ${isSelected ? "selected" : ""
      } ${isDraggingSource ? "dragging-source" : ""
      }`}
      data-connection-id={connection.id}
      data-connection-index={connectionIndex}
      data-folder-id={folderId ?? ""}
      data-tree-drop-kind="connection"
      onClickCapture={onClickCapture}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDragStart}
    >
      {isRenaming ? (
        <div className="connection-open connection-open-editing">
          <ConnectionGlyph
            iconBackgroundColor={connection.iconBackgroundColor}
            iconDataUrl={connection.iconDataUrl}
            localShell={connection.localShell}
            size={18}
            type={connection.type}
          />
          <span className="connection-main">
            <InlineTreeRenameInput
              ariaLabel={i18next.t("connections.renameConnection")}
              initialName={connection.name}
              onCancel={onCancelRename}
              onCommit={onCommitRename}
            />
          </span>
        </div>
      ) : (
        <button
          className="connection-open"
          onClick={(event) => {
            if (doubleClickOpensConnection) {
              onSelect();
              return;
            }
            onOpen(event);
          }}
          onDoubleClick={(event) => {
            if (doubleClickOpensConnection) {
              event.preventDefault();
              onOpen(event);
            }
          }}
          type="button"
        >
          <ConnectionGlyph
            iconBackgroundColor={connection.iconBackgroundColor}
            iconDataUrl={connection.iconDataUrl}
            localShell={connection.localShell}
            size={18}
            type={connection.type}
          />
          <span className="connection-main">
            <strong>{connectionTreeDisplayName(connection, i18next.t)}</strong>
          </span>
        </button>
      )}
      <ConnectionStatusIndicator
        connectionType={connection.type}
        status={connection.status}
      />
    </div>
  );
}

function ConnectionStatusIndicator({
  connectionType,
  status,
}: {
  connectionType: ConnectionType;
  status: ConnectionStatus;
}) {
  const syncInputEnabled = useWorkspaceStore((state) => state.syncInputEnabled);
  const isConnectedTerminal =
    status === "connected" &&
    ["local", "ssh", "telnet", "serial"].includes(connectionType);

  if (syncInputEnabled && isConnectedTerminal) {
    return (
      <span className="status-sync-input" aria-hidden="true">
        <Radio size={13} strokeWidth={2.25} />
      </span>
    );
  }

  return <span className={`status-dot ${status}`} />;
}

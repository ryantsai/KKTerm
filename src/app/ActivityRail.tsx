import { listen } from "@tauri-apps/api/event";
import {
  BedSingle,
  Coffee,
  Gauge,
  LayoutDashboard,
  Pin,
  PinOff,
  Plus,
  Settings,
} from "../lib/reicon";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { loadStoredChildConnections } from "../modules/workspace/connections/childConnections";
import { ConnectionIcon } from "../modules/workspace/connections/ConnectionIcon";
import { flattenConnections } from "../modules/workspace/connections/treeUtils";
import { ariaPressed } from "../lib/aria";
import { nativeMenuIcons } from "../lib/nativeMenuIcons";
import { showNativeContextMenu, type NativeContextMenuItem } from "../lib/nativeContextMenu";
import { supportsInstallerHelper } from "../lib/platform";
import { activityRailModuleOrder } from "./activityRailOrder";
import { invokeCommand, isTauriRuntime } from "../lib/tauri";
import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "../store";
import type { Connection, Workspace } from "../types";
import { NewWorkspaceDialog } from "../modules/workspace/NewWorkspaceDialog";
import { DeleteWorkspaceDialog } from "../modules/workspace/WorkspaceRailDialogs";
import { WorkspaceIcon } from "../modules/workspace/workspaceIcons";
import { ItOpsModuleIcon } from "../modules/itops/icons";
import { InstallHelperModuleIcon, ScreenshotsModuleIcon } from "./moduleIdentityIcons";
import { RailTooltip } from "./RailTooltip";

export type ActivePage =
  | "workspace"
  | "dashboard"
  | "itops"
  | "installer"
  | "screenshots"
  | "settings";

type ConnectedRailItem = {
  connection: Connection;
  tabId?: string;
  pinned: boolean;
};

type ConnectionRailDragState = {
  connectionId: string;
  pointerId: number;
  startY: number;
  moved: boolean;
};

type ConnectionRailDropTarget = {
  connectionId: string | null;
  position: "before" | "after" | "end";
};

type RailConnectionMenuState = {
  connection: Connection;
  pinned: boolean;
  x: number;
  y: number;
};

const CONNECTION_RAIL_ORDER_KEY = "kkterm.connectionRail.order.v1";
const WORKSPACE_RAIL_ICON_SIZE = 18;
const WORKSPACE_RAIL_ICON_SHELL_SIZE = 24;

function loadConnectionRailOrder() {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(CONNECTION_RAIL_ORDER_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function persistConnectionRailOrder(order: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CONNECTION_RAIL_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Ordering is a convenience preference; fail silently if storage is unavailable.
  }
}

export function ActivityRail({
  activePage,
  connectionsCollapsed,
  onConnectionsToggle,
  onNavigate,
}: {
  activePage: ActivePage;
  connectionsCollapsed: boolean;
  onConnectionsToggle: () => void;
  onNavigate: (page: ActivePage) => void;
}) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const closeWorkspaceTabs = useWorkspaceStore((state) => state.closeWorkspaceTabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeSessionCounts = useWorkspaceStore((state) => state.activeSessionCounts);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const setGeneralSettings = useWorkspaceStore((state) => state.setGeneralSettings);
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const openConnection = useWorkspaceStore((state) => state.openConnection);
  const openChildConnectionLayout = useWorkspaceStore(
    (state) => state.openChildConnectionLayout,
  );
  const storedDontSleepEnabled = useWorkspaceStore(
    (state) => state.generalSettings.dontSleepEnabled,
  );
  const [dontSleepEnabled, setDontSleepEnabled] = useState(storedDontSleepEnabled);
  const [dontSleepUpdating, setDontSleepUpdating] = useState(false);
  const [savedConnections, setSavedConnections] = useState<Connection[]>([]);
  const [connectionRailOrder, setConnectionRailOrder] = useState(
    loadConnectionRailOrder,
  );
  const [draggedConnectionId, setDraggedConnectionId] = useState<string | null>(
    null,
  );
  const [connectionRailDropTarget, setConnectionRailDropTarget] =
    useState<ConnectionRailDropTarget | null>(null);
  const [railConnectionMenu, setRailConnectionMenu] =
    useState<RailConnectionMenuState | null>(null);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [workspaceToEdit, setWorkspaceToEdit] = useState<Workspace | null>(null);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(null);
  const railConnectionMenuRef = useRef<HTMLDivElement | null>(null);
  const connectionRailDragRef = useRef<ConnectionRailDragState | null>(null);
  const connectionRailListRef = useRef<HTMLDivElement | null>(null);
  const suppressConnectionClickRef = useRef<string | null>(null);

  useEffect(() => {
    setDontSleepEnabled(storedDontSleepEnabled);
  }, [storedDontSleepEnabled]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    void invokeCommand("get_dont_sleep_enabled")
      .then((nextEnabled) => {
        if (!disposed) {
          setDontSleepEnabled(nextEnabled);
          setGeneralSettings({
            ...useWorkspaceStore.getState().generalSettings,
            dontSleepEnabled: nextEnabled,
          });
        }
      })
      .catch(() => {
        // The rail should still render if the desktop-only helper is unavailable.
      });

    return () => {
      disposed = true;
    };
  }, [setGeneralSettings]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const unlistenPromise = listen<boolean>("kkterm://dont-sleep-changed", (event) => {
      setDontSleepEnabled(event.payload);
      setGeneralSettings({
        ...useWorkspaceStore.getState().generalSettings,
        dontSleepEnabled: event.payload,
      });
      showStatusBarNotice(
        event.payload ? t("app.dontSleepEnabled") : t("app.dontSleepDisabled"),
        { tone: event.payload ? "success" : "info" },
      );
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [setGeneralSettings, showStatusBarNotice, t]);

  async function handleDontSleepClick() {
    if (dontSleepUpdating) {
      return;
    }

    const nextEnabled = !dontSleepEnabled;
    setDontSleepUpdating(true);

    try {
      const savedEnabled = isTauriRuntime()
        ? await invokeCommand("set_dont_sleep_enabled", { enabled: nextEnabled })
        : nextEnabled;
      setDontSleepEnabled(savedEnabled);
      setGeneralSettings({
        ...useWorkspaceStore.getState().generalSettings,
        dontSleepEnabled: savedEnabled,
      });
      showStatusBarNotice(
        savedEnabled ? t("app.dontSleepEnabled") : t("app.dontSleepDisabled"),
        { tone: savedEnabled ? "success" : "info" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("app.dontSleepError", { message }), { tone: "error" });
    } finally {
      setDontSleepUpdating(false);
    }
  }

  useEffect(() => {
    let disposed = false;

    async function loadSavedConnections() {
      try {
        const tree = await invokeCommand("list_connection_tree", {
          workspaceId: activeWorkspaceId,
        });
        if (!disposed) {
          setSavedConnections(flattenConnections(tree));
        }
      } catch {
        if (!disposed) {
          setSavedConnections([]);
        }
      }
    }

    void loadSavedConnections();
    const handleTreeInvalidated = () => {
      void loadSavedConnections();
    };
    window.addEventListener("kkterm:connection-tree-invalidated", handleTreeInvalidated);
    return () => {
      disposed = true;
      window.removeEventListener("kkterm:connection-tree-invalidated", handleTreeInvalidated);
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    let disposed = false;
    async function loadWorkspaces() {
      try {
        const list = await invokeCommand("list_workspaces");
        if (!disposed) {
          const removedWorkspaceIds = useWorkspaceStore
            .getState()
            .workspaces.filter(
              (workspace) => !list.some((item) => item.id === workspace.id),
            )
            .map((workspace) => workspace.id);
          for (const workspaceId of removedWorkspaceIds) {
            closeWorkspaceTabs(workspaceId);
          }
          setWorkspaces(list);
        }
      } catch {
        // The rail still renders with the default-only workspace state.
      }
    }
    void loadWorkspaces();
    const unlistenPromise = isTauriRuntime()
      ? listen("workspaces-changed", () => {
          void loadWorkspaces();
        })
      : null;
    return () => {
      disposed = true;
      if (unlistenPromise) {
        void unlistenPromise.then((unlisten) => unlisten());
      }
    };
  }, [closeWorkspaceTabs, setWorkspaces]);

  async function reloadWorkspaces() {
    try {
      setWorkspaces(await invokeCommand("list_workspaces"));
    } catch {
      // Non-fatal; keep the current list.
    }
  }

  function handleWorkspaceClick(workspace: Workspace) {
    if (workspace.id === activeWorkspaceId && activePage === "workspace") {
      onConnectionsToggle();
      return;
    }
    setActiveWorkspace(workspace.id);
    onNavigate("workspace");
  }

  async function openWorkspaceMenu(workspace: Workspace, x: number, y: number) {
    await showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("workspace.editWorkspace"),
          action: () => setWorkspaceToEdit(workspace),
        },
        {
          kind: "item",
          label: t("workspace.deleteWorkspace"),
          action: () => setWorkspaceToDelete(workspace),
        },
      ],
      { x, y },
    );
  }

  function handleRailConnectionClick(item: ConnectedRailItem) {
    onNavigate("workspace");
    const existingTab = item.tabId
      ? tabs.find((tab) => tab.id === item.tabId)
      : undefined;
    // A connected rail item already identifies the exact live Tab surface.
    // Activate it before considering child-layout reconstruction: SFTP Tabs
    // intentionally carry an ssh-typed Connection, so rebuilding from the
    // Connection would open an SSH terminal over the existing file browser.
    // activateTab also switches Workspaces when the live Tab belongs elsewhere.
    if (existingTab) {
      activateTab(existingTab.id);
      return;
    }
    if (generalSettings.hideTopTabButtons) {
      const childConnections = loadStoredChildConnections().filter(
        (child) =>
          child.parentConnectionId === item.connection.id &&
          (child.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWorkspaceId,
      );
      if (childConnections.length > 0) {
        openChildConnectionLayout(item.connection, childConnections);
        return;
      }
    }
    openConnection(item.connection);
  }

  const activeTabConnectionId = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId)?.connection?.id,
    [activeTabId, tabs],
  );

  const connectedRailItems = useMemo<ConnectedRailItem[]>(() => {
    const savedConnectionById = new Map(
      savedConnections.map((connection) => [connection.id, connection]),
    );
    const pinnedConnectionIds = generalSettings.pinnedConnectionIds ?? [];
    const pinnedConnectionIdSet = new Set(pinnedConnectionIds);
    const pinnedItems: ConnectedRailItem[] = pinnedConnectionIds.flatMap((connectionId) => {
      const connection = savedConnectionById.get(connectionId);
      if (!connection) {
        return [];
      }
      const tabId = tabs.find((tab) => tab.connection?.id === connection.id)?.id;
      return [{ connection, tabId, pinned: true }];
    });

    const seenConnectionIds = new Set<string>();
    pinnedItems.forEach((item) => seenConnectionIds.add(item.connection.id));
    const items: ConnectedRailItem[] = generalSettings.showConnectedConnectionsInRail
      ? tabs.flatMap((tab) => {
          const connection = tab.connection;
          if (
            !connection ||
            pinnedConnectionIdSet.has(connection.id) ||
            seenConnectionIds.has(connection.id) ||
            !activeSessionCounts[connection.id]
          ) {
            return [];
          }
          seenConnectionIds.add(connection.id);
          return [{ connection, tabId: tab.id, pinned: false }];
        })
      : [];

    const itemByConnectionId = new Map(
      items.map((item) => [item.connection.id, item]),
    );
    const orderedItems = connectionRailOrder.flatMap((connectionId) => {
      const item = itemByConnectionId.get(connectionId);
      if (!item) {
        return [];
      }
      itemByConnectionId.delete(connectionId);
      return [item];
    });

    return [...pinnedItems, ...orderedItems, ...itemByConnectionId.values()];
  }, [
    activeSessionCounts,
    connectionRailOrder,
    generalSettings.pinnedConnectionIds,
    generalSettings.showConnectedConnectionsInRail,
    savedConnections,
    tabs,
  ]);

  function reorderConnectedRailItem(
    sourceConnectionId: string,
    dropTarget: ConnectionRailDropTarget,
  ) {
    const visibleConnectionIds = connectedRailItems
      .filter((item) => !item.pinned)
      .map((item) => item.connection.id);
    if (
      !visibleConnectionIds.includes(sourceConnectionId) ||
      sourceConnectionId === dropTarget.connectionId
    ) {
      return;
    }

    setConnectionRailOrder((currentOrder) => {
      const nextOrder = [
        ...currentOrder.filter((connectionId) =>
          visibleConnectionIds.includes(connectionId),
        ),
        ...visibleConnectionIds.filter(
          (connectionId) => !currentOrder.includes(connectionId),
        ),
      ].filter((connectionId) => connectionId !== sourceConnectionId);

      const targetIndex = dropTarget.connectionId
        ? nextOrder.indexOf(dropTarget.connectionId)
        : -1;
      if (targetIndex === -1) {
        nextOrder.push(sourceConnectionId);
      } else {
        nextOrder.splice(
          dropTarget.position === "after" ? targetIndex + 1 : targetIndex,
          0,
          sourceConnectionId,
        );
      }
      const orderUnchanged =
        nextOrder.length === currentOrder.length &&
        nextOrder.every((connectionId, index) => connectionId === currentOrder[index]);
      if (orderUnchanged) {
        return currentOrder;
      }
      persistConnectionRailOrder(nextOrder);
      return nextOrder;
    });
  }

  function getConnectionRailDropTarget(
    clientX: number,
    clientY: number,
  ): ConnectionRailDropTarget {
    const list = connectionRailListRef.current;
    if (!list) {
      return { connectionId: null, position: "end" };
    }

    const target = document.elementFromPoint(clientX, clientY);
    const button = target?.closest?.("[data-rail-connected-id]");
    if (button instanceof HTMLElement && list.contains(button)) {
      const rect = button.getBoundingClientRect();
      return {
        connectionId: button.dataset.railConnectedId ?? null,
        position: clientY < rect.top + rect.height / 2 ? "before" : "after",
      };
    }

    const firstButton = list.querySelector<HTMLElement>(
      "[data-rail-connected-id]",
    );
    if (firstButton) {
      const rect = firstButton.getBoundingClientRect();
      if (clientY < rect.top) {
        return {
          connectionId: firstButton.dataset.railConnectedId ?? null,
          position: "before",
        };
      }
    }

    return { connectionId: null, position: "end" };
  }

  function handleConnectedRailPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    connectionId: string,
  ) {
    if (event.button !== 0) {
      return;
    }
    connectionRailDragRef.current = {
      connectionId,
      pointerId: event.pointerId,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleConnectedRailPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const drag = connectionRailDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 5) {
      return;
    }

    drag.moved = true;
    setDraggedConnectionId(drag.connectionId);
    event.preventDefault();

    const targetConnectionId = getConnectionRailDropTarget(
      event.clientX,
      event.clientY,
    );
    setConnectionRailDropTarget((currentTarget) =>
      currentTarget?.connectionId === targetConnectionId.connectionId &&
      currentTarget.position === targetConnectionId.position
        ? currentTarget
        : targetConnectionId,
    );
    if (targetConnectionId.connectionId !== drag.connectionId) {
      reorderConnectedRailItem(drag.connectionId, targetConnectionId);
    }
  }

  function handleConnectedRailPointerEnd(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const drag = connectionRailDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (drag.moved) {
      const targetConnectionId = getConnectionRailDropTarget(
        event.clientX,
        event.clientY,
      );
      reorderConnectedRailItem(drag.connectionId, targetConnectionId);
      suppressConnectionClickRef.current = drag.connectionId;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    connectionRailDragRef.current = null;
    setDraggedConnectionId(null);
    setConnectionRailDropTarget(null);
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

  async function pinRailConnection(connection: Connection) {
    const nextPinnedConnectionIds = [
      ...generalSettings.pinnedConnectionIds.filter(
        (connectionId) => connectionId !== connection.id,
      ),
      connection.id,
    ];
    await updatePinnedRailConnections(
      nextPinnedConnectionIds,
      t("connections.pinnedToRailStatus", { name: connection.name }),
    );
  }

  async function unpinRailConnection(connection: Connection) {
    await updatePinnedRailConnections(
      generalSettings.pinnedConnectionIds.filter(
        (connectionId) => connectionId !== connection.id,
      ),
      t("connections.unpinnedFromRailStatus", { name: connection.name }),
    );
  }

  function buildRailConnectionMenuItems(
    menu: RailConnectionMenuState,
  ): NativeContextMenuItem[] {
    return [
      {
        kind: "item",
        label: t(menu.pinned ? "connections.unpinFromRail" : "connections.pinToRail"),
        iconSvg: menu.pinned ? nativeMenuIcons.pinOff : nativeMenuIcons.pin,
        action: () => {
          void (menu.pinned
            ? unpinRailConnection(menu.connection)
            : pinRailConnection(menu.connection));
        },
      },
    ];
  }

  async function openRailConnectionMenu(menu: RailConnectionMenuState) {
    const opened = await showNativeContextMenu(buildRailConnectionMenuItems(menu), {
      x: menu.x,
      y: menu.y,
    });
    if (!opened) {
      setRailConnectionMenu(menu);
    }
  }

  useEffect(() => {
    if (!railConnectionMenu) {
      return;
    }
    function closeMenu(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && railConnectionMenuRef.current?.contains(target)) {
        return;
      }
      setRailConnectionMenu(null);
    }
    function closeMenuOnKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setRailConnectionMenu(null);
      }
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeMenuOnKey);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeMenuOnKey);
    };
  }, [railConnectionMenu]);

  useLayoutEffect(() => {
    const node = railConnectionMenuRef.current;
    if (!node || !railConnectionMenu) {
      return;
    }
    const bounds = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(railConnectionMenu.x, window.innerWidth - bounds.width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(railConnectionMenu.y, window.innerHeight - bounds.height - 8))}px`;
  }, [railConnectionMenu]);

  const dontSleepTooltip = dontSleepEnabled
    ? t("app.dontSleepEnabledTooltip")
    : t("app.dontSleepDisabledTooltip");
  const activityRailOrder = activityRailModuleOrder(generalSettings.activityRailOrder);
  const activityRailItemStyle = (id: (typeof activityRailOrder)[number]) => ({
    order: activityRailOrder.indexOf(id) - activityRailOrder.length - 1,
  });

  return (
    <nav className="activity-rail" aria-label={t("app.primaryNav")}>
      {generalSettings.showWorkspaceOnRail ? (
        <div className="rail-workspaces" aria-label={t("workspace.workspaceSwitcher")} style={activityRailItemStyle("workspace")}>
          {(workspaces.length > 0
          ? workspaces
          : [
              {
                id: activeWorkspaceId,
                name: t("workspace.defaultWorkspace"),
                icon: null,
                isDefault: true,
                sortOrder: 0,
              } as Workspace,
            ]
        ).map((workspace) => {
          const isActiveWorkspace = workspace.id === activeWorkspaceId;
          const label = workspace.isDefault
            ? t("workspace.defaultWorkspace")
            : workspace.name;
          return (
            <button
              key={workspace.id}
              className={`rail-button rail-button-workspace ${
                activePage === "workspace" && isActiveWorkspace ? "active" : ""
              } ${
                connectionsCollapsed && isActiveWorkspace
                  ? "connections-collapsed-indicator"
                  : ""
              }`}
              aria-label={label}
              data-tutorial-id={
                workspace.isDefault ? "app.activityRailWorkspace" : undefined
              }
              onClick={() => handleWorkspaceClick(workspace)}
              onContextMenu={
                workspace.isDefault
                  ? undefined
                  : (event) => {
                      event.preventDefault();
                      void openWorkspaceMenu(
                        workspace,
                        event.clientX,
                        event.clientY,
                      );
                    }
              }
            >
              {workspace.isDefault ? (
                <LayoutDashboard size={18} />
              ) : (
                <WorkspaceIcon
                  backgroundColor={workspace.iconBackgroundColor}
                  color={workspace.iconColor}
                  icon={workspace.icon}
                  name={label}
                  size={WORKSPACE_RAIL_ICON_SIZE}
                  shellSize={WORKSPACE_RAIL_ICON_SHELL_SIZE}
                />
              )}
              <RailTooltip label={label} />
            </button>
          );
        })}
          <button
            className="rail-button rail-button-add-workspace"
            aria-label={t("workspace.newWorkspace")}
            data-tutorial-id="app.activityRailNewWorkspace"
            onClick={() => setShowNewWorkspace(true)}
          >
            <Plus size={18} />
            <RailTooltip label={t("workspace.newWorkspace")} />
          </button>
        </div>
      ) : null}
      {generalSettings.showDashboardOnRail ? (
        <button
          className={`rail-button ${activePage === "dashboard" ? "active" : ""}`}
          aria-label={t("dashboard.title")}
          data-tutorial-id="app.activityRailDashboard"
          onClick={() => onNavigate("dashboard")}
          style={activityRailItemStyle("dashboard")}
        >
          <Gauge size={18} />
          <RailTooltip label={t("dashboard.title")} />
        </button>
      ) : null}
      {generalSettings.showItOps ? (
        <button
          className={`rail-button rail-button-itops ${activePage === "itops" ? "active" : ""}`}
          aria-label={t("itops.railLabel")}
          data-tutorial-id="app.activityRailItOps"
          onClick={() => onNavigate("itops")}
          style={activityRailItemStyle("itops")}
        >
          <ItOpsModuleIcon size={18} />
          <RailTooltip label={t("itops.railLabel")} />
        </button>
      ) : null}
      {generalSettings.showInstallerOnRail && supportsInstallerHelper() ? (
        <button
          className={`rail-button rail-button-installer ${activePage === "installer" ? "active" : ""}`}
          aria-label={t("installer.railLabel")}
          data-tutorial-id="app.activityRailInstaller"
          onClick={() => onNavigate("installer")}
          style={activityRailItemStyle("installer")}
        >
          <InstallHelperModuleIcon size={18} />
          <RailTooltip label={t("installer.railLabel")} />
        </button>
      ) : null}
      {generalSettings.showScreenshotsOnRail ? (
        <button
          className={`rail-button rail-button-screenshots ${activePage === "screenshots" ? "active" : ""}`}
          aria-label={t("screenshots.railLabel")}
          data-tutorial-id="app.activityRailScreenshots"
          onClick={() => onNavigate("screenshots")}
          style={activityRailItemStyle("screenshots")}
        >
          <ScreenshotsModuleIcon size={18} />
          <RailTooltip label={t("screenshots.railLabel")} />
        </button>
      ) : null}
      {connectedRailItems.length > 0 ? (
        <div className="rail-connected-connections-spacer">
          <div
            ref={connectionRailListRef}
            className={`rail-connected-connections ${
            draggedConnectionId &&
            connectionRailDropTarget?.position === "end"
              ? "rail-drop-end"
              : ""
            }`}
            aria-label={t("app.connectionRail")}
            data-tutorial-id="app.connectionRail"
          >
            {connectedRailItems.map((item) => (
            <button
              key={item.connection.id}
              data-rail-connection-id={item.connection.id}
              data-rail-connected-id={item.pinned ? undefined : item.connection.id}
              className={`rail-button rail-button-connection ${
                item.pinned ? "pinned" : ""
              } ${activeSessionCounts[item.connection.id] ? "connected" : ""} ${
                activePage === "workspace" && activeTabConnectionId === item.connection.id
                  ? "active"
                  : ""
              } ${draggedConnectionId === item.connection.id ? "dragging" : ""} ${
                draggedConnectionId &&
                connectionRailDropTarget?.connectionId === item.connection.id &&
                connectionRailDropTarget.position === "before"
                  ? "rail-drop-before"
                  : ""
              } ${
                draggedConnectionId &&
                connectionRailDropTarget?.connectionId === item.connection.id &&
                connectionRailDropTarget.position === "after"
                  ? "rail-drop-after"
                  : ""
              }`}
              aria-label={t(item.pinned ? "app.openPinnedConnection" : "app.openConnectedConnection", {
                name: item.connection.name,
              })}
              onClick={() => {
                if (suppressConnectionClickRef.current === item.connection.id) {
                  suppressConnectionClickRef.current = null;
                  return;
                }
                handleRailConnectionClick(item);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                void openRailConnectionMenu({
                  connection: item.connection,
                  pinned: item.pinned,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onPointerCancel={item.pinned ? undefined : handleConnectedRailPointerEnd}
              onPointerDown={
                item.pinned
                  ? undefined
                  : (event) =>
                    handleConnectedRailPointerDown(event, item.connection.id)
              }
              onPointerMove={item.pinned ? undefined : handleConnectedRailPointerMove}
              onPointerUp={item.pinned ? undefined : handleConnectedRailPointerEnd}
            >
              <ConnectionIcon
                iconBackgroundColor={item.connection.iconBackgroundColor}
                iconColor={item.connection.iconColor}
                iconDataUrl={item.connection.iconDataUrl}
                localShell={item.connection.localShell}
                size={18}
                type={item.connection.type}
              />
              <RailTooltip label={item.connection.name} />
            </button>
            ))}
          </div>
        </div>
      ) : null}
      {railConnectionMenu ? (
        <div
          ref={railConnectionMenuRef}
          className="terminal-menu rail-context-menu rail-connection-menu"
          onContextMenu={(event) => event.preventDefault()}
          role="menu"
        >
          <button
            className="terminal-menu-item"
            onClick={() => {
              const connection = railConnectionMenu.connection;
              const pinned = railConnectionMenu.pinned;
              setRailConnectionMenu(null);
              void (pinned ? unpinRailConnection(connection) : pinRailConnection(connection));
            }}
            role="menuitem"
            type="button"
          >
            {railConnectionMenu.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {t(railConnectionMenu.pinned ? "connections.unpinFromRail" : "connections.pinToRail")}
          </button>
        </div>
      ) : null}
      {generalSettings.showDontSleepOnRail ? (
        <button
          className={`rail-button rail-button-dont-sleep ${
            dontSleepEnabled ? "active dont-sleep-enabled" : ""
          }`}
          aria-label={
            dontSleepEnabled ? t("app.dontSleepDisable") : t("app.dontSleepEnable")
          }
          data-tutorial-id="app.activityRailDontSleep"
          {...ariaPressed(dontSleepEnabled)}
          disabled={dontSleepUpdating}
          onClick={() => void handleDontSleepClick()}
        >
          {dontSleepEnabled ? <Coffee size={18} /> : <BedSingle size={18} />}
          <RailTooltip label={dontSleepTooltip} />
        </button>
      ) : null}
      <button
        className={`rail-button rail-button-settings ${activePage === "settings" ? "active" : ""}`}
        aria-label={t("app.settings")}
        data-tutorial-id="app.activityRailSettings"
        onClick={() => onNavigate("settings")}
      >
        <Settings size={18} />
        <RailTooltip label={t("app.settings")} />
      </button>
      {showNewWorkspace ? (
        <NewWorkspaceDialog
          workspaces={workspaces}
          onClose={() => setShowNewWorkspace(false)}
          onCreated={(workspace) => {
            setShowNewWorkspace(false);
            void reloadWorkspaces();
            setActiveWorkspace(workspace.id);
            onNavigate("workspace");
            showStatusBarNotice(
              t("workspace.workspaceCreated", { name: workspace.name }),
              { tone: "success" },
            );
          }}
        />
      ) : null}
      {workspaceToEdit ? (
        <NewWorkspaceDialog
          workspace={workspaceToEdit}
          workspaces={workspaces}
          onClose={() => setWorkspaceToEdit(null)}
          onSaved={() => {
            setWorkspaceToEdit(null);
            void reloadWorkspaces();
          }}
        />
      ) : null}
      {workspaceToDelete ? (
        <DeleteWorkspaceDialog
          workspace={workspaceToDelete}
          onClose={() => setWorkspaceToDelete(null)}
          onDeleted={(deletedWorkspace) => {
            closeWorkspaceTabs(deletedWorkspace.id);
            setWorkspaceToDelete(null);
            onNavigate("workspace");
            void reloadWorkspaces();
          }}
        />
      ) : null}
    </nav>
  );
}

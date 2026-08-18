import { Plus, Search, X } from "../../../../../lib/reicon";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionIcon } from "../../../../workspace/connections/ConnectionIcon";
import { connectionSubtitle, connectionTypeLabel } from "../../../../workspace/connections/utils";
import { flattenConnections, withLiveConnectionStatuses } from "../../../../workspace/connections/treeUtils";
import { invokeCommand, isTauriRuntime } from "../../../../../lib/tauri";
import { connectionUsesTmux, tmuxSessionIdsForConnection, useWorkspaceStore } from "../../../../../store";
import { defaultLayoutFor } from "../../../../workspace/layout";
import { TerminalWorkspace } from "../../../../workspace/connections/terminal/TerminalWorkspace";
import type { BuiltInWidgetBodyProps } from "../../../registry/builtInRegistry";
import type { Connection, ConnectionTree, WorkspacePane, WorkspaceTab } from "../../../../../types";
import { connectionTree as emptyConnectionTree } from "../../../../../app-defaults";
import { useWidgetConfig } from "../../widgetLocalStorage";

const WebViewWorkspace = lazy(() =>
  import("../../../../workspace/connections/webview/WebViewWorkspace").then(({ WebViewWorkspace }) => ({
    default: WebViewWorkspace,
  })),
);
const RemoteDesktopWorkspace = lazy(() =>
  import("../../../../workspace/connections/remote-desktop/RemoteDesktopWorkspace").then(({ RemoteDesktopWorkspace }) => ({
    default: RemoteDesktopWorkspace,
  })),
);

type ConnectionWidgetConfig = {
  connectionIds: string[];
  activeConnectionId: string | null;
};

const DEFAULT_CONFIG: ConnectionWidgetConfig = {
  connectionIds: [],
  activeConnectionId: null,
};

function storageKey(instanceId: string) {
  return `kkterm.dashboard.connectionPane.${instanceId}.v1`;
}

function normalizeConnectionWidgetConfig(value: unknown): ConnectionWidgetConfig {
  if (!value || typeof value !== "object") {
    return DEFAULT_CONFIG;
  }
  const candidate = value as Partial<ConnectionWidgetConfig>;
  const connectionIds = Array.isArray(candidate.connectionIds)
    ? candidate.connectionIds.filter((id): id is string => typeof id === "string")
    : [];
  const activeConnectionId =
    typeof candidate.activeConnectionId === "string" ? candidate.activeConnectionId : null;
  return { connectionIds, activeConnectionId };
}

export function createConnectionWidgetTab(
  instanceId: string,
  connection: Connection,
  tmuxSessionId?: string,
): WorkspaceTab {
  const pane = createConnectionWidgetPane(instanceId, connection, tmuxSessionId);
  const baseTab = {
    id: `dashboard-${instanceId}-${connection.id}`,
    title: connection.name,
    toolbarTitle: connection.name,
    subtitle: connectionSubtitle(connection),
    connection,
  };

  if (connection.type === "url") {
    return {
      ...baseTab,
      kind: "webview",
      panes: [],
      url: connection.url,
      dataPartition: connection.dataPartition,
    };
  }

  if (connection.type === "rdp" || connection.type === "vnc") {
    return {
      ...baseTab,
      kind: "remoteDesktop",
      panes: [],
    };
  }

  return {
    ...baseTab,
    kind: "terminal",
    panes: [pane],
    layout: defaultLayoutFor([pane]),
    focusedPaneId: pane.id,
  };
}

function createConnectionWidgetPane(
  instanceId: string,
  connection: Connection,
  tmuxSessionId?: string,
): WorkspacePane {
  const paneId = `dashboard-pane-${instanceId}-${connection.id}`;
  if (connection.type === "url") {
    return {
      kind: "webview",
      id: paneId,
      title: connection.name,
      toolbarTitle: connection.name,
      connection,
      url: connection.url ?? "",
      dataPartition: connection.dataPartition,
    };
  }

  if (connection.type === "rdp" || connection.type === "vnc") {
    return {
      kind: "remoteDesktop",
      id: paneId,
      title: connection.name,
      toolbarTitle: connection.name,
      connection,
    };
  }

  return {
    kind: "terminal",
    id: paneId,
    title: connection.type,
    toolbarTitle: connection.name,
    cwd: connection.type === "local" ? "C:\\Users\\example" : "~",
    buffer: "",
    connection,
    tmuxSessionId,
  };
}

export function ConnectionWidgetBody({
  instance,
  isViewActive,
}: BuiltInWidgetBodyProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useWidgetConfig(
    storageKey(instance.id),
    DEFAULT_CONFIG,
    normalizeConnectionWidgetConfig,
  );
  const [tree, setTree] = useState<ConnectionTree>(emptyConnectionTree);
  const [loadError, setLoadError] = useState("");
  const [showLauncher, setShowLauncher] = useState(false);
  const [launcherSearch, setLauncherSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const activeSessionCounts = useWorkspaceStore((state) => state.activeSessionCounts);

  useEffect(() => {
    let disposed = false;
    async function loadTree() {
      if (!isTauriRuntime()) {
        setTree(emptyConnectionTree);
        return;
      }
      try {
        const nextTree = await invokeCommand("list_connection_tree");
        if (!disposed) {
          setTree(nextTree);
          setLoadError("");
        }
      } catch (error) {
        if (!disposed) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void loadTree();
    window.addEventListener("kkterm:connection-tree-invalidated", loadTree);
    return () => {
      disposed = true;
      window.removeEventListener("kkterm:connection-tree-invalidated", loadTree);
    };
  }, []);

  const liveTree = useMemo(
    () => withLiveConnectionStatuses(tree, activeSessionCounts),
    [activeSessionCounts, tree],
  );
  const allConnections = useMemo(() => flattenConnections(liveTree), [liveTree]);
  const connectionsById = useMemo(
    () => new Map(allConnections.map((connection) => [connection.id, connection])),
    [allConnections],
  );
  // Stable, status-free connection lookup. The embedded workspace must not see a
  // new connection object every time activeSessionCounts changes, otherwise the
  // terminal session effect tears down and restarts in an infinite loop.
  const sessionConnectionsById = useMemo(
    () => new Map(flattenConnections(tree).map((connection) => [connection.id, connection])),
    [tree],
  );
  const selectedConnections = config.connectionIds.flatMap((id) => {
    const connection = connectionsById.get(id);
    return connection ? [connection] : [];
  });
  const activeConnection =
    selectedConnections.find((connection) => connection.id === config.activeConnectionId) ??
    selectedConnections[0] ??
    null;
  const sessionConnection = activeConnection
    ? (sessionConnectionsById.get(activeConnection.id) ?? activeConnection)
    : null;

  const filteredConnections = useMemo(() => {
    const q = launcherSearch.toLowerCase().trim();
    if (!q) return allConnections;
    return allConnections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        connectionSubtitle(c).toLowerCase().includes(q) ||
        connectionTypeLabel(c.type).toLowerCase().includes(q),
    );
  }, [allConnections, launcherSearch]);

  function updateConfig(nextConfig: ConnectionWidgetConfig) {
    const knownIds = new Set(allConnections.map((connection) => connection.id));
    const connectionIds = nextConfig.connectionIds.filter((id) => knownIds.has(id));
    const activeConnectionId =
      nextConfig.activeConnectionId && connectionIds.includes(nextConfig.activeConnectionId)
        ? nextConfig.activeConnectionId
        : (connectionIds[0] ?? null);
    setConfig({ connectionIds, activeConnectionId });
  }

  function removeConnection(connectionId: string) {
    const nextIds = config.connectionIds.filter((id) => id !== connectionId);
    updateConfig({
      connectionIds: nextIds,
      activeConnectionId:
        config.activeConnectionId === connectionId
          ? (nextIds[0] ?? null)
          : config.activeConnectionId,
    });
  }

  function openLauncher() {
    setShowLauncher(true);
    setLauncherSearch("");
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function closeLauncher() {
    setShowLauncher(false);
    setLauncherSearch("");
  }

  function selectFromLauncher(connectionId: string) {
    if (!config.connectionIds.includes(connectionId)) {
      updateConfig({
        connectionIds: [...config.connectionIds, connectionId],
        activeConnectionId: connectionId,
      });
    } else {
      updateConfig({ ...config, activeConnectionId: connectionId });
    }
    closeLauncher();
  }

  if (showLauncher) {
    return (
      <div
        className="dashboard-connection-widget"
        onKeyDown={(e) => e.key === "Escape" && closeLauncher()}
      >
        <div className="dashboard-connection-launcher">
          <div className="dashboard-connection-launcher-search">
            <Search size={13} />
            <input
              ref={searchRef}
              type="text"
              value={launcherSearch}
              onChange={(e) => setLauncherSearch(e.currentTarget.value)}
              placeholder={t("common.search")}
            />
            <button className="dashboard-widget-icon-button" onClick={closeLauncher} type="button">
              <X size={13} />
            </button>
          </div>
          <div className="dashboard-connection-launcher-list">
            {filteredConnections.map((connection) => (
              <button
                key={connection.id}
                className={connection.id === activeConnection?.id ? "active" : ""}
                onClick={() => selectFromLauncher(connection.id)}
                type="button"
              >
                <ConnectionIcon
                  localShell={connection.localShell}
                  size={14}
                  type={connection.type}
                />
                <span className="dashboard-connection-launcher-name">{connection.name}</span>
                <span className={`status-dot ${connection.status}`} />
                {config.connectionIds.includes(connection.id) ? (
                  <span
                    className="dashboard-connection-tab-remove"
                    role="button"
                    tabIndex={0}
                    aria-label={t("dashboard.connectionWidgetRemove", { name: connection.name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeConnection(connection.id);
                    }}
                  >
                    <X size={11} />
                  </span>
                ) : null}
              </button>
            ))}
            {filteredConnections.length === 0 ? (
              <p className="dashboard-connection-launcher-empty">
                {t("dashboard.connectionWidgetNoResults")}
              </p>
            ) : null}
          </div>
          {loadError ? (
            <p className="dashboard-widget-error">
              {t("dashboard.connectionWidgetLoadError", { message: loadError })}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (!activeConnection) {
    return (
      <div className="dashboard-connection-widget dashboard-connection-widget-empty">
        <button className="dashboard-connection-add" onClick={openLauncher} type="button">
          <Plus size={15} />
          {t("common.add")}
        </button>
      </div>
    );
  }

  return (
    <div className="dashboard-connection-widget">
      <div className="dashboard-connection-pane">
        {sessionConnection ? (
          <ConnectionWidgetSession
            connection={sessionConnection}
            instanceId={instance.id}
            isViewActive={isViewActive}
            key={sessionConnection.id}
          />
        ) : null}
      </div>
    </div>
  );
}

function ConnectionWidgetSession({
  connection,
  instanceId,
  isViewActive,
}: {
  connection: Connection;
  instanceId: string;
  isViewActive: boolean;
}) {
  const [tmuxSession, setTmuxSession] = useState<{ connectionId: string; sessionId: string } | null>(null);
  const defaultUseTmuxSessions = useWorkspaceStore(
    (state) => state.sshSettings.defaultUseTmuxSessions,
  );
  const usesTmux = connectionUsesTmux(connection, defaultUseTmuxSessions);
  const tmuxSessionId =
    usesTmux && tmuxSession?.connectionId === connection.id ? tmuxSession.sessionId : undefined;

  useEffect(() => {
    if (!usesTmux) {
      setTmuxSession(null);
      return;
    }
    const sessionId = tmuxSessionIdsForConnection(
      connection,
      1,
      defaultUseTmuxSessions,
    )[0];
    setTmuxSession(sessionId ? { connectionId: connection.id, sessionId } : null);
  }, [connection, defaultUseTmuxSessions, usesTmux]);

  const tab = useMemo(
    () => createConnectionWidgetTab(instanceId, connection, tmuxSessionId),
    [connection, instanceId, tmuxSessionId],
  );

  if (connection.type === "url") {
    return (
      <Suspense fallback={null}>
        <WebViewWorkspace isActive={isViewActive} tab={tab} />
      </Suspense>
    );
  }

  if (connection.type === "rdp" || connection.type === "vnc") {
    return (
      <Suspense fallback={null}>
        <RemoteDesktopWorkspace isActive={isViewActive} tab={tab} />
      </Suspense>
    );
  }

  if (usesTmux && !tmuxSessionId) {
    return null;
  }

  return (
    <TerminalWorkspace
      allowPaneLayoutControls={false}
      isActive={isViewActive}
      showSftpButton={false}
      tab={tab}
    />
  );
}

import type { DashboardBackground } from "../../dashboard/types";
import type { Connection, TerminalPane, WorkspaceChildConnection, WorkspacePane, WorkspaceTab } from "../../../types";
import { readDurableUiState, writeDurableUiState } from "../../../lib/durableUiState";

export const CHILD_CONNECTIONS_STORAGE_KEY = "kkterm.workspace.childConnections.v1";
export const CHILD_CONNECTIONS_UPDATED_EVENT = "kkterm:workspace-child-connections-updated";

export function loadStoredChildConnections(): WorkspaceChildConnection[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(readDurableUiState(CHILD_CONNECTIONS_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isStoredChildConnection) : [];
  } catch {
    return [];
  }
}

export function persistStoredChildConnections(children: WorkspaceChildConnection[]) {
  if (typeof window === "undefined") {
    return;
  }
  // Child Connection Tabs are durable frontend workspace state: source of truth
  // is SQLite (backed up, portable), mirrored to the synchronous cache.
  writeDurableUiState(CHILD_CONNECTIONS_STORAGE_KEY, JSON.stringify(children));
}

// Drop every saved Child Connection Tab under a deleted parent Connection so the
// rows do not orphan after the parent is gone.
export function pruneChildConnectionsForParent(parentConnectionId: string) {
  const children = loadStoredChildConnections();
  const next = children.filter((child) => child.parentConnectionId !== parentConnectionId);
  if (next.length !== children.length) {
    persistStoredChildConnections(next);
    notifyStoredChildConnectionsUpdated();
  }
}

export function notifyStoredChildConnectionsUpdated() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(CHILD_CONNECTIONS_UPDATED_EVENT));
}

function isStoredChildConnection(value: unknown): value is WorkspaceChildConnection {
  if (!value || typeof value !== "object") {
    return false;
  }
  const child = value as Partial<WorkspaceChildConnection>;
  return (
    typeof child.id === "string" &&
    child.id.trim().length > 0 &&
    typeof child.parentConnectionId === "string" &&
    child.parentConnectionId.trim().length > 0 &&
    typeof child.name === "string" &&
    child.name.trim().length > 0
  );
}

function isTerminalWorkspacePane(pane: WorkspacePane): pane is TerminalPane {
  return pane.kind === undefined || pane.kind === "terminal";
}

function backgroundsEqual(
  left: DashboardBackground | null | undefined,
  right: DashboardBackground | null | undefined,
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function syncChildConnectionsFromTabs(
  children: WorkspaceChildConnection[],
  tabs: WorkspaceTab[],
): WorkspaceChildConnection[] {
  const paneByChildId = new Map<string, WorkspacePane>();
  for (const tab of tabs) {
    for (const pane of tab.panes) {
      if (pane.childConnectionId) {
        paneByChildId.set(pane.childConnectionId, pane);
      }
    }
  }

  let changed = false;
  const next = children.map((child) => {
    const pane = paneByChildId.get(child.id);
    if (!pane || !isTerminalWorkspacePane(pane)) {
      return child;
    }

    const cwd = pane.cwd.trim();
    const fontSize = pane.fontSize;
    const textEncoding = pane.textEncoding;
    const terminalOpacity = pane.connection?.terminalOpacity;
    const terminalBackground =
      "terminalBackground" in pane && pane.terminalBackground !== undefined
        ? pane.terminalBackground
        : pane.connection?.terminalBackground;
    const cwdChanged = Boolean(cwd) && child.cwd !== cwd;
    const fontSizeChanged = child.fontSize !== fontSize;
    const textEncodingChanged = child.textEncoding !== textEncoding;
    const opacityChanged = child.terminalOpacity !== terminalOpacity;
    const backgroundChanged = !backgroundsEqual(child.terminalBackground, terminalBackground);

    if (!cwdChanged && !fontSizeChanged && !textEncodingChanged && !opacityChanged && !backgroundChanged) {
      return child;
    }

    changed = true;
    return {
      ...child,
      cwd: cwdChanged ? cwd : child.cwd,
      fontSize,
      textEncoding,
      terminalOpacity,
      terminalBackground,
    };
  });

  return changed ? next : children;
}

function isTerminalConnectionType(connection: WorkspacePane["connection"]): connection is Connection {
  return (
    connection?.type === "local" ||
    connection?.type === "ssh" ||
    connection?.type === "telnet" ||
    connection?.type === "serial"
  );
}

function convertedChildName(tab: WorkspaceTab, pane: TerminalPane) {
  return (
    pane.tmuxSessionId ||
    tab.displayTitle?.trim() ||
    tab.title.trim() ||
    pane.connection?.name ||
    pane.title
  );
}

export function convertOpenTabsToChildConnections(params: {
  children: WorkspaceChildConnection[];
  tabs: WorkspaceTab[];
  activeWorkspaceId: string;
  defaultWorkspaceId: string;
}): WorkspaceChildConnection[] {
  const { children, tabs, activeWorkspaceId, defaultWorkspaceId } = params;
  const existingIds = new Set(children.map((child) => child.id));
  let changed = false;
  const next = [...children];

  for (const tab of tabs) {
    if (tab.kind !== "terminal" || (tab.workspaceId ?? defaultWorkspaceId) !== activeWorkspaceId) {
      continue;
    }
    for (const pane of tab.panes) {
      const paneConnection = pane.connection;
      if (pane.childConnectionId || !isTerminalWorkspacePane(pane) || !isTerminalConnectionType(paneConnection)) {
        continue;
      }
      if (existingIds.has(pane.id)) {
        continue;
      }
      const name = convertedChildName(tab, pane).trim();
      existingIds.add(pane.id);
      changed = true;
      next.push({
        id: pane.id,
        workspaceId: activeWorkspaceId,
        parentConnectionId: paneConnection.id,
        name: name || paneConnection.name,
        tmuxSessionId: pane.tmuxSessionId,
        cwd: pane.cwd.trim() || undefined,
        fontSize: pane.fontSize,
        terminalOpacity: paneConnection.terminalOpacity,
        terminalBackground:
          pane.terminalBackground !== undefined
            ? pane.terminalBackground
            : paneConnection.terminalBackground,
        iconColor: paneConnection.iconColor,
        iconDataUrl: paneConnection.iconDataUrl,
        iconBackgroundColor: paneConnection.iconBackgroundColor,
      });
    }
  }

  return changed ? next : children;
}

/**
 * Gather the Panes that must survive when (re)building a parent Connection's
 * child panorama Tab, beyond the named child Connections themselves:
 *
 *  - `carriedGroupPanes`: Panes already inside the group Tab that never became
 *    named children — e.g. a "split right" created within the panorama.
 *    Rebuilding the layout strictly from the children list would drop them.
 *
 * Plain parent Tabs are converted into Child Connection Tabs separately when
 * child mode is enabled, so this helper must not keep adding the parent as an
 * unnamed panorama Pane.
 */
export function collectPreservedParentPanes(params: {
  parentConnectionId: string;
  activeWorkspaceId: string;
  defaultWorkspaceId: string;
  existingGroupTab: WorkspaceTab | undefined;
  tabs: WorkspaceTab[];
  excludedPaneIds?: ReadonlySet<string>;
}): { carriedGroupPanes: WorkspacePane[]; adoptedOrphanPanes: WorkspacePane[] } {
  const { existingGroupTab, excludedPaneIds } = params;
  const claimed = new Set(excludedPaneIds ?? []);

  const carriedGroupPanes = existingGroupTab
    ? existingGroupTab.panes.filter((pane) => !pane.childConnectionId && !claimed.has(pane.id))
    : [];

  return { carriedGroupPanes, adoptedOrphanPanes: [] };
}

export function focusedPaneIdForChildLayout(
  existingTab: Pick<WorkspaceTab, "focusedPaneId"> | undefined,
  panes: WorkspacePane[],
) {
  const paneIds = new Set(panes.map((pane) => pane.id));
  return existingTab?.focusedPaneId && paneIds.has(existingTab.focusedPaneId)
    ? existingTab.focusedPaneId
    : undefined;
}

export function isChildConnectionRowActive(params: {
  activeTabId: string;
  paneId?: string;
  tab: WorkspaceTab | undefined;
}) {
  const { activeTabId, paneId, tab } = params;
  if (!tab || tab.id !== activeTabId) {
    return false;
  }
  if (!paneId) {
    return true;
  }
  if (tab.childConnectionGroupParentId) {
    return tab.maximizedPaneId === paneId;
  }
  return tab.focusedPaneId === paneId;
}

import type { Connection, ConnectionType } from "../../../types";

const RECENT_CONNECTION_STORAGE_KEY = "kkterm.recentConnectionIds";
const COLLAPSED_FOLDER_IDS_KEY = "kkterm.collapsedFolderIds";
export const NEW_CONNECTION_REQUEST_EVENT = "kkterm:new-connection-request";
export const IMPORT_CONNECTIONS_REQUEST_EVENT = "kkterm:import-connections-request";
export const NEW_CONNECTION_TAB_REQUEST_EVENT = "kkterm:new-connection-tab-request";
export const RECONNECT_TERMINAL_CONNECTION_EVENT = "kkterm:reconnect-terminal-connection";

export type NewConnectionRequestDetail = {
  connectionType: ConnectionType;
  openAfterCreate?: boolean;
};

export type NewConnectionTabRequestDetail = {
  connection: Connection;
};

export type ReconnectTerminalConnectionDetail = {
  connectionId: string;
};

export const RECENT_CONNECTION_LIMIT = 50;

export function createStoredSecretMask() {
  const maskLength = 12 + Math.floor(Math.random() * 5);
  return "*".repeat(maskLength);
}

export function loadRecentConnectionIds() {
  if (typeof localStorage === "undefined") {
    return [];
  }

  try {
    const storedIds = JSON.parse(localStorage.getItem(RECENT_CONNECTION_STORAGE_KEY) ?? "[]");
    return Array.isArray(storedIds)
      ? storedIds.filter((connectionId): connectionId is string => typeof connectionId === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveRecentConnectionIds(connectionIds: string[]) {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(
    RECENT_CONNECTION_STORAGE_KEY,
    JSON.stringify(connectionIds.slice(0, RECENT_CONNECTION_LIMIT)),
  );
}

export function loadCollapsedFolderIds(): Set<string> {
  if (typeof localStorage === "undefined") {
    return new Set();
  }
  try {
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_FOLDER_IDS_KEY) ?? "[]");
    return new Set(
      Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export function saveCollapsedFolderIds(ids: Set<string>) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(COLLAPSED_FOLDER_IDS_KEY, JSON.stringify([...ids]));
}

export function notifyConnectionTreeInvalidated() {
  window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
}

export function requestNewConnection(
  connectionType: ConnectionType,
  options?: { openAfterCreate?: boolean },
) {
  window.dispatchEvent(
    new CustomEvent<NewConnectionRequestDetail>(NEW_CONNECTION_REQUEST_EVENT, {
      detail: { connectionType, openAfterCreate: options?.openAfterCreate },
    }),
  );
}

export function requestImportConnections() {
  window.dispatchEvent(new CustomEvent(IMPORT_CONNECTIONS_REQUEST_EVENT));
}

export function requestConnectionNewTab(connection: Connection) {
  window.dispatchEvent(
    new CustomEvent<NewConnectionTabRequestDetail>(NEW_CONNECTION_TAB_REQUEST_EVENT, {
      detail: { connection },
    }),
  );
}

export function requestTerminalConnectionReconnect(connectionId: string) {
  window.dispatchEvent(
    new CustomEvent<ReconnectTerminalConnectionDetail>(RECONNECT_TERMINAL_CONNECTION_EVENT, {
      detail: { connectionId },
    }),
  );
}

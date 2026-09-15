import type { Connection } from "../../../types";

export const CONNECTION_TAB_CONTEXT_MENU_EVENT = "kkterm:connection-tab-context-menu";

export type ConnectionTabContextMenuDetail = {
  connection: Connection;
  tabId: string;
  x: number;
  y: number;
};

export function isConnectionTabContextMenuConnection(
  connection: Connection | undefined,
): connection is Connection {
  return Boolean(connection && !connection.id.startsWith("quick-"));
}

export function dispatchConnectionTabContextMenu(detail: ConnectionTabContextMenuDetail) {
  window.dispatchEvent(
    new CustomEvent<ConnectionTabContextMenuDetail>(CONNECTION_TAB_CONTEXT_MENU_EVENT, {
      detail,
    }),
  );
}

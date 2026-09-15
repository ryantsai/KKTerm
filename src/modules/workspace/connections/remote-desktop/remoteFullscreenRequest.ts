import type { WorkspaceTab } from "../../../../types";

export const REMOTE_FULLSCREEN_REQUEST_EVENT = "kkterm:remote-fullscreen-request";

export type RemoteFullscreenRequestDetail = {
  surfaceId: string;
};

export type RemoteDesktopSurfaceTarget = {
  paneId: string;
  surfaceId: string;
  tabId: string;
};

const remoteFullscreenReadyChecks = new Map<string, () => boolean>();

export function registerRemoteFullscreenSurface(
  surfaceId: string,
  isReady: () => boolean,
) {
  remoteFullscreenReadyChecks.set(surfaceId, isReady);
  return () => {
    if (remoteFullscreenReadyChecks.get(surfaceId) === isReady) {
      remoteFullscreenReadyChecks.delete(surfaceId);
    }
  };
}

export function isRemoteFullscreenSurfaceReady(surfaceId: string) {
  return remoteFullscreenReadyChecks.get(surfaceId)?.() === true;
}

export function findRemoteDesktopSurface(
  tabs: WorkspaceTab[],
  connectionId: string,
  preferredTabId?: string,
): RemoteDesktopSurfaceTarget | null {
  const orderedTabs = preferredTabId
    ? [
        ...tabs.filter((tab) => tab.id === preferredTabId),
        ...tabs.filter((tab) => tab.id !== preferredTabId),
      ]
    : tabs;

  for (const tab of orderedTabs) {
    if (
      tab.kind === "remoteDesktop" &&
      tab.connection?.id === connectionId &&
      (tab.connection.type === "rdp" || tab.connection.type === "vnc")
    ) {
      return { paneId: tab.id, surfaceId: tab.id, tabId: tab.id };
    }

    const remotePanes = tab.panes.filter(
      (pane) =>
        pane.kind === "remoteDesktop" &&
        pane.connection.id === connectionId &&
        (pane.connection.type === "rdp" || pane.connection.type === "vnc"),
    );
    const pane =
      remotePanes.find((candidate) => candidate.id === tab.focusedPaneId) ?? remotePanes[0];
    if (pane) {
      return { paneId: pane.id, surfaceId: pane.id, tabId: tab.id };
    }
  }

  return null;
}

export function requestRemoteFullscreen(surfaceId: string) {
  window.dispatchEvent(
    new CustomEvent<RemoteFullscreenRequestDetail>(REMOTE_FULLSCREEN_REQUEST_EVENT, {
      detail: { surfaceId },
    }),
  );
}

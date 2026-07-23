// Pure parsing for the detached full-screen window route. Kept free of React/CSS
// imports so it is unit-testable and importable from the app entry (main.tsx).

export type RemoteFullscreenRoute = {
  kind: "rdp" | "vnc";
  sessionId: string;
  connectionId: string;
};

/** Parse `#/remote-fullscreen/<kind>/<sessionId>/<connectionId>` from a URL hash. */
export function parseRemoteFullscreenRoute(hash: string): RemoteFullscreenRoute | null {
  const parts = hash.replace(/^#\/?/, "").split("/");
  if (parts[0] !== "remote-fullscreen") {
    return null;
  }
  const [, kind, sessionId, connectionId] = parts;
  if ((kind !== "rdp" && kind !== "vnc") || !sessionId || !connectionId) {
    return null;
  }
  return {
    kind,
    sessionId: decodeURIComponent(sessionId),
    connectionId: decodeURIComponent(connectionId),
  };
}

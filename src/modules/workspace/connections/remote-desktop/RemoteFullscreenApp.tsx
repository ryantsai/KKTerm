// Root React tree for a detached RDP/VNC full-screen window. It is mounted by
// main.tsx when the window URL carries the `#/remote-fullscreen/...` route
// instead of the full app shell. It attaches to the already-running Session by
// id (events emit app-wide) and renders it with the shared surface code plus the
// full-screen connection bar.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { emit, listen } from "@tauri-apps/api/event";
import { usesCanvasRdp } from "../../../../lib/platform";
import { closeCurrentWindow, isTauriRuntime } from "../../../../lib/tauri";
import { RdpCanvasView } from "./RdpCanvasView";
import { RemoteFullscreenBar } from "./RemoteFullscreenBar";
import {
  VNC_FULLSCREEN_SURFACE_EVENT,
  useVncSurface,
} from "./vncSurface";
import type { RemoteFullscreenRoute } from "./remoteFullscreenRoute";
import "./remote-desktop.css";

const REMOTE_FULLSCREEN_SHORTCUT_EVENT = "kkterm://toggle-remote-fullscreen";

export type { RemoteFullscreenRoute };
export { parseRemoteFullscreenRoute } from "./remoteFullscreenRoute";

export function RemoteFullscreenApp({ route }: { route: RemoteFullscreenRoute }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const vnc = useVncSurface({
    canvasRef,
    sessionId: route.sessionId,
    viewMode: "fit",
    enabled: route.kind === "vnc",
    onError: (message) => setStatus(message),
    onDisconnected: () => setStatus(t("remoteDesktop.disconnected")),
  });

  const title = useMemo(
    () => t("remoteDesktop.fullscreen.windowTitle"),
    [t],
  );

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let dispose: (() => void) | undefined;
    void listen(REMOTE_FULLSCREEN_SHORTCUT_EVENT, () => {
      if (!disposed) {
        void closeCurrentWindow();
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        dispose = unlisten;
      }
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || route.kind !== "vnc") return;
    const announce = (active: boolean) =>
      emit(VNC_FULLSCREEN_SURFACE_EVENT, { sessionId: route.sessionId, active });
    void announce(true);
    const handleUnload = () => void announce(false);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      void announce(false);
    };
  }, [route.kind, route.sessionId]);

  return (
    <div className="remote-fullscreen-root">
      <RemoteFullscreenBar
        sessionId={route.sessionId}
        kind={route.kind}
        title={title}
      />

      {route.kind === "vnc" ? (
        <canvas
          ref={canvasRef}
          className={vnc.hasDisplay ? "remote-fullscreen-canvas ready" : "remote-fullscreen-canvas"}
          tabIndex={0}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={vnc.handlers.onPointerDown}
          onPointerMove={vnc.handlers.onPointerMove}
          onPointerUp={vnc.handlers.onPointerUp}
          onWheel={vnc.handlers.onWheel}
          onKeyDown={vnc.handlers.onKeyDown}
          onKeyUp={vnc.handlers.onKeyUp}
        />
      ) : usesCanvasRdp() ? (
        // macOS/Linux: reuse the IronRDP canvas view in attach mode. It requests
        // a full-frame repaint on attach (refresh_rdp_client_session) so the
        // current screen shows immediately, then paints deltas as they arrive.
        <RdpCanvasView attachSessionId={route.sessionId} />
      ) : (
        // Windows RDP never reaches this detached route: mstscax owns its
        // full-screen host and native connection bar.
        null
      )}

      {status ? <div className="remote-fullscreen-status">{status}</div> : null}
    </div>
  );
}

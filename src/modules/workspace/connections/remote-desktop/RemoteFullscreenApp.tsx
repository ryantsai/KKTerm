// Root React tree for a detached RDP/VNC full-screen window. It is mounted by
// main.tsx when the window URL carries the `#/remote-fullscreen/...` route
// instead of the full app shell. It attaches to the already-running Session by
// id (events emit app-wide) and renders it with the shared surface code plus the
// full-screen connection bar.

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usesCanvasRdp } from "../../../../lib/platform";
import { RdpCanvasView } from "./RdpCanvasView";
import { RemoteFullscreenBar } from "./RemoteFullscreenBar";
import { useVncSurface } from "./vncSurface";
import type { RemoteFullscreenRoute } from "./remoteFullscreenRoute";
import "./remote-desktop.css";

export type { RemoteFullscreenRoute };
export { parseRemoteFullscreenRoute } from "./remoteFullscreenRoute";

export function RemoteFullscreenApp({ route }: { route: RemoteFullscreenRoute }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [keyboardGrab, setKeyboardGrab] = useState(true);
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

  return (
    <div className="remote-fullscreen-root">
      <RemoteFullscreenBar
        sessionId={route.sessionId}
        kind={route.kind}
        keyboardGrab={keyboardGrab}
        onToggleKeyboardGrab={setKeyboardGrab}
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
        // macOS/Linux: reuse the IronRDP canvas view in attach mode. It renders
        // framebuffer deltas as they arrive; a late attacher's initial frame is
        // not resent (no full-refresh command yet — Phase 4 adds a RefreshRect).
        <RdpCanvasView attachSessionId={route.sessionId} />
      ) : (
        // Windows RDP is the ActiveX popup; full-screen for it lands in Phase 4.
        <div className="remote-fullscreen-pending">
          <p>{t("remoteDesktop.fullscreen.rdpPending")}</p>
        </div>
      )}

      {status ? <div className="remote-fullscreen-status">{status}</div> : null}
    </div>
  );
}

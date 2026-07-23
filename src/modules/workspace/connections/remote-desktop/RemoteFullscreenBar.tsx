// The full-screen "connection bar": a reveal-on-hover / pinnable strip docked
// top-center of the detached RDP/VNC window. It is the persistent exit + control
// affordance every mainstream client uses (mstsc, RDCMan, Remmina, TigerVNC),
// because in full screen the surface covers the taskbar and grabs the keyboard.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Monitor, Pin, PinOff, X } from "../../../../lib/reicon";
import { usesCanvasRdp } from "../../../../lib/platform";
import {
  closeCurrentWindow,
  invokeCommand,
  isTauriRuntime,
  listDisplayMonitors,
  setCurrentWindowBounds,
  type DisplayMonitor,
} from "../../../../lib/tauri";

type MonitorChoice = { key: string; label: string; monitor?: DisplayMonitor; span: boolean };

function unionBounds(monitors: DisplayMonitor[]) {
  const first = monitors[0];
  if (!first) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;
  for (const monitor of monitors.slice(1)) {
    left = Math.min(left, monitor.x);
    top = Math.min(top, monitor.y);
    right = Math.max(right, monitor.x + monitor.width);
    bottom = Math.max(bottom, monitor.y + monitor.height);
  }
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function RemoteFullscreenBar({
  sessionId,
  kind,
  title,
}: {
  sessionId: string;
  kind: "rdp" | "vnc";
  title: string;
}) {
  const { t } = useTranslation();
  const [pinned, setPinned] = useState(false);
  const [revealed, setRevealed] = useState(true);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [monitors, setMonitors] = useState<DisplayMonitor[]>([]);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Auto-hide the initially-revealed bar shortly after mount unless pinned.
    if (pinned) {
      return;
    }
    hideTimerRef.current = window.setTimeout(() => setRevealed(false), 2400);
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [pinned]);

  const choices: MonitorChoice[] = [
    { key: "span", label: t("remoteDesktop.fullscreen.spanAll"), span: true },
    ...monitors.map((monitor, index) => ({
      key: `monitor-${index}`,
      label:
        monitor.name.trim().length > 0
          ? monitor.name
          : t("remoteDesktop.fullscreen.displayIndex", { index: index + 1 }),
      monitor,
      span: false,
    })),
  ];

  async function openMonitorMenu() {
    if (!monitorOpen) {
      try {
        setMonitors(await listDisplayMonitors());
      } catch {
        setMonitors([]);
      }
    }
    setMonitorOpen((open) => !open);
  }

  async function applyChoice(choice: MonitorChoice) {
    setMonitorOpen(false);
    try {
      if (choice.span) {
        const list = monitors.length > 0 ? monitors : await listDisplayMonitors();
        await setCurrentWindowBounds({ ...unionBounds(list), native: false });
      } else if (choice.monitor) {
        await setCurrentWindowBounds({
          x: choice.monitor.x,
          y: choice.monitor.y,
          width: choice.monitor.width,
          height: choice.monitor.height,
          native: true,
        });
      }
    } catch {
      // Repositioning is best-effort; the window stays where it is on failure.
    }
  }

  async function sendCtrlAltDelete() {
    if (!isTauriRuntime()) {
      return;
    }
    const request = { request: { sessionId } };
    const call =
      kind === "vnc"
        ? invokeCommand("send_vnc_ctrl_alt_delete", request)
        : usesCanvasRdp()
          ? invokeCommand("send_rdp_client_ctrl_alt_delete", request)
          : invokeCommand("send_rdp_ctrl_alt_delete", request);
    await call.catch(() => undefined);
  }

  return (
    <div
      className={`remote-fullscreen-bar-zone${revealed || pinned ? " revealed" : ""}`}
      onPointerEnter={() => setRevealed(true)}
      onPointerLeave={() => {
        if (!pinned && !monitorOpen) {
          setRevealed(false);
        }
      }}
    >
      <div className="remote-fullscreen-bar" role="toolbar" aria-label={t("remoteDesktop.fullscreen.barAria")}>
        <span className="remote-fullscreen-bar-title">{title}</span>

        <div className="remote-fullscreen-bar-monitor">
          <button
            type="button"
            className="remote-fullscreen-bar-button"
            onClick={() => void openMonitorMenu()}
            aria-haspopup="menu"
            aria-expanded={monitorOpen}
            title={t("remoteDesktop.fullscreen.display")}
          >
            <Monitor size={14} />
            <ChevronDown size={12} />
          </button>
          {monitorOpen ? (
            <ul className="remote-fullscreen-bar-menu" role="menu">
              {choices.map((choice) => (
                <li key={choice.key}>
                  <button
                    type="button"
                    role="menuitem"
                    className="remote-fullscreen-bar-menu-item"
                    onClick={() => void applyChoice(choice)}
                  >
                    {choice.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <button
          type="button"
          className="remote-fullscreen-bar-button"
          onClick={() => void sendCtrlAltDelete()}
          title={t("remoteDesktop.sendCtrlAltDel")}
        >
          <span className="remote-fullscreen-bar-cad">Ctrl+Alt+Del</span>
        </button>

        <button
          type="button"
          className={`remote-fullscreen-bar-button${pinned ? " active" : ""}`}
          onClick={() => setPinned((value) => !value)}
          aria-pressed={pinned}
          title={t(pinned ? "remoteDesktop.fullscreen.unpin" : "remoteDesktop.fullscreen.pin")}
        >
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>

        <button
          type="button"
          className="remote-fullscreen-bar-button remote-fullscreen-bar-exit"
          onClick={() => void closeCurrentWindow()}
          title={t("remoteDesktop.fullscreen.exit")}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

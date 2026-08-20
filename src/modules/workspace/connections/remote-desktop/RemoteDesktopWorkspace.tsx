import { connectionIconForType, connectionPasswordOwnerId, connectionSubtitle, connectionToolbarTitle, connectionTypeLabel } from "../utils";
import { ScreenshotMenu } from "../../ScreenshotMenu";

import { documentHasRdpBlockingOverlay } from "../../nativeOverlay";
import { showNativeContextMenu } from "../../../../lib/nativeContextMenu";
import { Bot, Keyboard, Menu, Monitor, RotateCcw } from "../../../../lib/reicon";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import {
  invokeCommand,
  isTauriRuntime,
  logUiDebug,
  openRemoteFullscreen,
  type AssistantScreenshot,
  type StoredScreenshot,
} from "../../../../lib/tauri";
import { useWorkspaceStore } from "../../../../store";
import type {
  Connection,
  RemoteDesktopViewMode,
  RdpConnectionOptions,
  RdpSettings,
  VncConnectionOptions,
  VncSettings,
  WorkspaceTab,
} from "../../../../types";
import { normalizeRdpSharedLocalFolders } from "./rdpLocalResources";
import {
  registerRdpTextSender,
  registerRemoteDesktopController,
  unregisterRdpTextSender,
  unregisterRemoteDesktopController,
  type RemoteDesktopController,
} from "../../paneRegistry";
import { usesCanvasRdp } from "../../../../lib/platform";
import {
  displayShortcutBinding,
  effectiveWorkspaceShortcutBindings,
} from "../../keymap";
import { RdpCanvasView } from "./RdpCanvasView";
import { scancodeForCode } from "./rdpScancodes";
import {
  fetchAndPaintVncFrame,
  paintVncCursor,
  pointerButtonMask,
  vncKeysymForEvent,
  vncRenderedContentRect,
  type VncSessionEvent,
  VNC_FULLSCREEN_SURFACE_EVENT,
  type VncFullscreenSurfaceEvent,
} from "./vncSurface";
import { isCurrentVncFrame } from "./vncFrame";
import { NoteToolbarButton } from "../../../notes/NoteToolbarButton";

const RDP_ESTABLISHING_STATE = 2;
const RDP_PRE_CAPTURE_INTERVAL_MS = 800;
// After the RDP control first reports a displayable session, re-issue the
// display-size sync a couple of times. MsRdpClient can report Connected while
// a policy-driven credential prompt is still on-screen, but repeated successful
// nudges mean the session has accepted the size and more passes just flicker.
const RDP_DISPLAY_SETTLE_INTERVAL_MS = 2000;
const RDP_DISPLAY_SETTLE_PASSES = 6;
const RDP_DISPLAY_SETTLE_SUCCESS_PASSES = 2;
const REMOTE_FULLSCREEN_SHORTCUT_EVENT = "kkterm://toggle-remote-fullscreen";

function currentRdpPixelScale() {
  return window.devicePixelRatio || 1;
}

function createRemoteDesktopSessionId(kind: "rdp" | "vnc") {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function RemoteDesktopWorkspace({
  isActive,
  onOpenAssistant = () => undefined,
  tab,
}: {
  isActive: boolean;
  onOpenAssistant?: () => void;
  tab: WorkspaceTab;
}) {
  const { t } = useTranslation();
  const connection = tab.connection;
  const openNoteEditor = useWorkspaceStore((state) => state.openNoteEditor);
  const typeLabel = connection ? connectionTypeLabel(connection.type) : t("remoteDesktop.typeLabel");
  const Icon = connection ? connectionIconForType(connection.type) : Monitor;
  const toolbarTitle = tab.toolbarTitle ?? (connection ? connectionToolbarTitle(connection) : tab.title);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionStartedRef = useRef(false);
  const sessionStartingRef = useRef(false);
  const openFullscreenRef = useRef<() => void>(() => undefined);
  const rdpConnectionCountedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const lastLoggedBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const displayReadyRef = useRef(false);
  const displaySyncInFlightRef = useRef(false);
  const displaySettleTimerRef = useRef<number | null>(null);
  const displaySettlePassesRef = useRef(0);
  const rdpVisibleRef = useRef(false);
  const rdpControlRef = useRef("");
  const rdpSuppressionCaptureInFlightRef = useRef(false);
  const rdpPreCaptureInFlightRef = useRef(false);
  const preCachedSnapshotRef = useRef<AssistantScreenshot | null>(null);
  const preCaptureLastRef = useRef(0);
  const vncButtonMaskRef = useRef(0);
  const vncPendingPointerRef = useRef<{ x: number; y: number; buttonMask: number } | null>(null);
  const vncPointerRafRef = useRef<number | null>(null);
  const vncFrameChainRef = useRef(Promise.resolve());
  const vncFrameGenerationRef = useRef(0);
  const vncFullscreenAttachedRef = useRef(false);
  const visibilityRef = useRef({ isActive, suppressed: false });
  const markConnectionSessionStarted = useWorkspaceStore(
    (state) => state.markConnectionSessionStarted,
  );
  const markConnectionSessionEnded = useWorkspaceStore((state) => state.markConnectionSessionEnded);
  const setAssistantContextSnippet = useWorkspaceStore(
    (state) => state.setAssistantContextSnippet,
  );
  const submitAssistantContextSnippet = useWorkspaceStore(
    (state) => state.submitAssistantContextSnippet,
  );
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const refreshOpenConnectionMetadata = useWorkspaceStore((state) => state.refreshOpenConnectionMetadata);
  const rdpPreCaptureSignal = useWorkspaceStore((state) => state.rdpPreCaptureSignal);
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const rdpSettings = useWorkspaceStore((state) => state.rdpSettings);
  const vncSettings = useWorkspaceStore((state) => state.vncSettings);
  const [suppressed, setSuppressed] = useState(false);
  const [rdpError, setRdpError] = useState("");
  const [rdpSnapshot, setRdpSnapshot] = useState<AssistantScreenshot | null>(null);
  const [rdpStatus, setRdpStatus] = useState("");
  const [rdpStartKey, setRdpStartKey] = useState(0);
  const [rdpCanvasCadSignal, setRdpCanvasCadSignal] = useState(0);
  const [optimisticViewMode, setOptimisticViewMode] = useState<RemoteDesktopViewMode | null>(null);
  const [vncHasDisplay, setVncHasDisplay] = useState(false);
  // macOS and Linux render RDP through the in-app IronRDP canvas
  // (RdpCanvasView), not the Windows native ActiveX overlay. Keep the overlay
  // path Windows-only so its effects never run elsewhere.
  const useRdpCanvas = connection?.type === "rdp" && usesCanvasRdp();
  const canStartRdp = connection?.type === "rdp" && !useRdpCanvas;
  const canStartVnc = connection?.type === "vnc";
  const resolvedViewMode = resolveRemoteDesktopViewMode(connection, rdpSettings, vncSettings);
  const viewMode = optimisticViewMode ?? resolvedViewMode;
  const showRemoteDesktopToolbar = canStartRdp || canStartVnc || useRdpCanvas;

  useEffect(() => {
    setOptimisticViewMode(null);
  }, [connection?.id, connection?.rdpOptions, connection?.vncOptions, rdpSettings, vncSettings]);

  const reportRemoteDesktopError = (message: string) => {
    setRdpError(message);
    if (connection?.type === "rdp") {
      showStatusBarNotice(t("remoteDesktop.rdpErrorStatus", { message }), { tone: "error" });
    }
  };

  const computeBounds = () => {
    const node = hostRef.current;
    if (!node) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    const clipNode = node.closest(".embedded-workspace-pane");
    const clipRect = clipNode?.getBoundingClientRect() ?? rect;
    const visibleRect = {
      left: Math.max(rect.left, clipRect.left),
      top: Math.max(rect.top, clipRect.top),
      right: Math.min(rect.right, clipRect.right),
      bottom: Math.min(rect.bottom, clipRect.bottom),
    };
    const bounds = {
      x: Math.max(0, Math.round(visibleRect.left)),
      y: Math.max(0, Math.round(visibleRect.top)),
      width: Math.max(1, Math.round(visibleRect.right - visibleRect.left)),
      height: Math.max(1, Math.round(visibleRect.bottom - visibleRect.top)),
    };
    const previous = lastLoggedBoundsRef.current;
    if (
      canStartRdp &&
      (!previous ||
        previous.x !== bounds.x ||
        previous.y !== bounds.y ||
        previous.width !== bounds.width ||
        previous.height !== bounds.height)
    ) {
      lastLoggedBoundsRef.current = bounds;
      logUiDebug("rdp.geometry.frontend", {
        sessionId: sessionIdRef.current,
        connectionId: connection?.id ?? null,
        isActive: visibilityRef.current.isActive,
        suppressed: visibilityRef.current.suppressed,
        domRect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
        clipRect: {
          left: clipRect.left,
          top: clipRect.top,
          width: clipRect.width,
          height: clipRect.height,
          right: clipRect.right,
          bottom: clipRect.bottom,
        },
        visibleRect,
        requestedLogicalBounds: bounds,
        elementSize: {
          clientWidth: node.clientWidth,
          clientHeight: node.clientHeight,
          offsetWidth: node.offsetWidth,
          offsetHeight: node.offsetHeight,
        },
        devicePixelRatio: window.devicePixelRatio,
        visualViewport: window.visualViewport
          ? {
              width: window.visualViewport.width,
              height: window.visualViewport.height,
              scale: window.visualViewport.scale,
              offsetLeft: window.visualViewport.offsetLeft,
              offsetTop: window.visualViewport.offsetTop,
            }
          : null,
      });
    }
    return bounds;
  };

  const boundsEqual = (
    first: { x: number; y: number; width: number; height: number },
    second: { x: number; y: number; width: number; height: number },
  ) =>
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height;

  const markRdpConnectionStarted = () => {
    if (!connection || rdpConnectionCountedRef.current) {
      return;
    }
    rdpConnectionCountedRef.current = true;
    markConnectionSessionStarted(connection.id);
  };

  const markRdpConnectionEnded = () => {
    if (!connection || !rdpConnectionCountedRef.current) {
      return;
    }
    rdpConnectionCountedRef.current = false;
    markConnectionSessionEnded(connection.id);
  };

  const requireRdpCanvasSessionId = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !sessionStartedRef.current) {
      throw new Error("RDP Session is not connected.");
    }
    return sessionId;
  };

  const handleRdpCanvasConnected = (sessionId: string) => {
    sessionIdRef.current = sessionId;
    sessionStartingRef.current = false;
    sessionStartedRef.current = true;
    setRdpStatus(t("remoteDesktop.connected"));
    markRdpConnectionStarted();
  };

  const handleRdpCanvasDisconnected = (sessionId: string) => {
    if (sessionIdRef.current === sessionId) {
      sessionIdRef.current = null;
    }
    sessionStartingRef.current = false;
    sessionStartedRef.current = false;
    markRdpConnectionEnded();
  };

  const handleRdpDisconnectedStatus = (connectionState: number) => {
    markRdpConnectionEnded();
    displayReadyRef.current = false;
    rdpVisibleRef.current = false;
    setRdpStatus(
      connectionState === RDP_ESTABLISHING_STATE
        ? t("remoteDesktop.connecting")
        : t("remoteDesktop.disconnected"),
    );
  };

  const readSettledBounds = () =>
    new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
      let previous = computeBounds();
      let stableFrames = 0;
      let attempts = 0;
      const tick = () => {
        const next = computeBounds();
        attempts += 1;
        if (!next) {
          if (attempts >= 8) {
            resolve(null);
            return;
          }
          window.requestAnimationFrame(tick);
          return;
        }
        if (previous && boundsEqual(previous, next)) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
        previous = next;
        if (stableFrames >= 2 || attempts >= 10) {
          resolve(next);
          return;
        }
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    });

  const captureVisibleRdpSnapshot = async () => {
    if (
      !canStartRdp ||
      !isTauriRuntime() ||
      !sessionStartedRef.current ||
      !rdpVisibleRef.current ||
      !displayReadyRef.current
    ) {
      return null;
    }
    const bounds = computeBounds();
    if (!bounds) {
      return null;
    }
    return invokeCommand("capture_screenshot_for_assistant", {
      request: bounds,
    });
  };

  const captureTargetScreenshotForAssistant = async () => {
    if (!isTauriRuntime()) {
      showStatusBarNotice(t("workspace.screenshotsRequireRuntime"), { tone: "warning" });
      return;
    }
    const target = hostRef.current;
    if (!target) {
      return;
    }
    const bounds = target.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    try {
      const request = {
        x: Math.max(0, Math.round(bounds.left)),
        y: Math.max(0, Math.round(bounds.top)),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      };
      const screenshot = useRdpCanvas || canStartVnc
        ? await captureCanvasScreenshotForAssistant(
            canvasRef.current,
            request,
            useRdpCanvas ? "stretch" : viewMode,
          )
        : await invokeCommand("capture_screenshot_for_assistant", { request });
      const snippet = {
        id: `remote-desktop-screenshot-${Date.now()}`,
        kind: "screenshot",
        sourceLabel: `${tab.title} ${typeLabel} ${t("workspace.screenshot")}`,
        imageDataUrl: screenshot.dataUrl,
        width: screenshot.width,
        height: screenshot.height,
        capturedAt: new Date().toISOString(),
      } as const;
      if (generalSettings.submitAiAttachmentsDirectly) {
        submitAssistantContextSnippet(snippet, t("ai.directAttachmentPrompt"));
      } else {
        setAssistantContextSnippet(snippet);
      }
      onOpenAssistant();
      showStatusBarNotice(t("workspace.sentToAi"), { tone: "success" });
    } catch (error) {
      showStatusBarNotice(
        t("workspace.screenshotCaptureError", {
          message: error instanceof Error ? error.message : String(error),
        }),
        { tone: "error" },
      );
    }
  };

  const captureRemoteDesktopScreenshot = async () => {
    if (!isTauriRuntime()) {
      throw new Error(t("workspace.screenshotsRequireRuntime"));
    }
    const target = hostRef.current;
    if (!target) {
      throw new Error("Remote desktop host is not mounted.");
    }
    const bounds = target.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      throw new Error("Remote desktop host is not visible.");
    }
    const request = {
      x: Math.max(0, Math.round(bounds.left)),
      y: Math.max(0, Math.round(bounds.top)),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };
    if (useRdpCanvas || canStartVnc) {
      return captureCanvasScreenshotForAssistant(
        canvasRef.current,
        request,
        useRdpCanvas ? "stretch" : viewMode,
      );
    }
    return invokeCommand("capture_screenshot_for_assistant", { request });
  };

  const captureRemoteDesktopCanvas = async (
    request: {
      x: number;
      y: number;
      width: number;
      height: number;
    },
    kind: StoredScreenshot["kind"],
  ) => {
    if (!(useRdpCanvas || canStartVnc)) {
      return invokeCommand("capture_screenshot_to_library", { request, kind });
    }
    const screenshot = await captureCanvasScreenshotForAssistant(
      canvasRef.current,
      request,
      useRdpCanvas ? "stretch" : viewMode,
    );
    return invokeCommand("deliver_screenshot_data_url", {
      request: { dataUrl: screenshot.dataUrl },
      kind,
    });
  };

  const sendVncText = async (text: string, pressEnter: boolean) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !sessionStartedRef.current) {
      throw new Error("VNC Session is not connected.");
    }
    for (const char of text) {
      const key = char === "\n" || char === "\r" ? 0xff0d : char.codePointAt(0);
      if (!key) {
        continue;
      }
      await invokeCommand("send_vnc_key_event", {
        request: { sessionId, key, down: true },
      });
      await invokeCommand("send_vnc_key_event", {
        request: { sessionId, key, down: false },
      });
    }
    if (pressEnter && !text.endsWith("\n") && !text.endsWith("\r")) {
      await invokeCommand("send_vnc_key_event", {
        request: { sessionId, key: 0xff0d, down: true },
      });
      await invokeCommand("send_vnc_key_event", {
        request: { sessionId, key: 0xff0d, down: false },
      });
    }
  };

  const sendVncMouseClick = async (
    x: number,
    y: number,
    button: "left" | "right" | "middle",
  ) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !sessionStartedRef.current) {
      throw new Error("VNC Session is not connected.");
    }
    const buttonIndex = button === "right" ? 2 : button === "middle" ? 1 : 0;
    const buttonMask = pointerButtonMask(buttonIndex);
    await invokeCommand("send_vnc_pointer_event", {
      request: { sessionId, x, y, buttonMask },
    });
    await invokeCommand("send_vnc_pointer_event", {
      request: { sessionId, x, y, buttonMask: 0 },
    });
  };

  const sendVncKeyPress = async (keyName: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !sessionStartedRef.current) {
      throw new Error("VNC Session is not connected.");
    }
    if (normalizeRemoteDesktopKeyName(keyName) === "ctrlaltdelete") {
      await invokeCommand("send_vnc_ctrl_alt_delete", {
        request: { sessionId },
      });
      return;
    }
    const key = vncKeysymForName(keyName);
    await invokeCommand("send_vnc_key_event", {
      request: { sessionId, key, down: true },
    });
    await invokeCommand("send_vnc_key_event", {
      request: { sessionId, key, down: false },
    });
  };

  useEffect(() => {
    const paneId = tab.panes[0]?.id;
    if (!paneId || !connection || !isTauriRuntime()) {
      return;
    }
    const mouseClick: RemoteDesktopController["mouseClick"] = connection.type === "vnc"
      ? (x, y, button) => sendVncMouseClick(x, y, button)
      : useRdpCanvas
        ? (x, y, button) => sendRdpCanvasMouseClick(requireRdpCanvasSessionId(), x, y, button)
        : async (x, y, button) => {
            const sessionId = sessionIdRef.current;
            if (!sessionId || !sessionStartedRef.current) {
              throw new Error("RDP Session is not connected.");
            }
            await invokeCommand("send_rdp_mouse_click", {
              request: {
                sessionId,
                x: Math.max(0, Math.min(65535, Math.trunc(x))),
                y: Math.max(0, Math.min(65535, Math.trunc(y))),
                button,
              },
            });
          };
    const controller: RemoteDesktopController = {
      kind: connection.type === "vnc" ? "vnc" : "rdp",
      captureScreenshot: captureRemoteDesktopScreenshot,
      sendText: async (text, pressEnter) => {
        if (connection.type === "vnc") {
          await sendVncText(text, pressEnter);
          return;
        }
        if (useRdpCanvas) {
          await sendRdpCanvasText(requireRdpCanvasSessionId(), text, pressEnter);
          return;
        }
        const sessionId = sessionIdRef.current;
        if (!sessionId || !sessionStartedRef.current) {
          throw new Error("RDP Session is not connected.");
        }
        await invokeCommand("send_rdp_text", {
          request: { sessionId, text, pressEnter },
        });
      },
      keyPress: async (key) => {
        if (connection.type === "vnc") {
          await sendVncKeyPress(key);
          return;
        }
        if (useRdpCanvas) {
          await sendRdpCanvasKeyPress(requireRdpCanvasSessionId(), key);
          return;
        }
        const sessionId = sessionIdRef.current;
        if (!sessionId || !sessionStartedRef.current) {
          throw new Error("RDP Session is not connected.");
        }
        await invokeCommand("send_rdp_key_press", {
          request: { sessionId, key },
        });
      },
      mouseClick,
    };
    registerRemoteDesktopController(paneId, controller);
    return () => unregisterRemoteDesktopController(paneId, controller);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.type, tab.panes[0]?.id]);

  useEffect(() => {
    const paneId = tab.panes[0]?.id;
    if (!useRdpCanvas || !paneId || !isTauriRuntime()) {
      return;
    }
    const sender = async (text: string, pressEnter: boolean) => {
      await sendRdpCanvasText(requireRdpCanvasSessionId(), text, pressEnter);
    };
    registerRdpTextSender(paneId, sender);
    return () => unregisterRdpTextSender(paneId, sender);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useRdpCanvas, tab.panes[0]?.id]);

  const triggerPreCapture = () => {
    if (!canStartRdp || !isActive || !rdpVisibleRef.current) {
      return;
    }
    const now = Date.now();
    if (
      rdpPreCaptureInFlightRef.current ||
      now - preCaptureLastRef.current < RDP_PRE_CAPTURE_INTERVAL_MS
    ) {
      return;
    }
    preCaptureLastRef.current = now;
    rdpPreCaptureInFlightRef.current = true;
    void captureVisibleRdpSnapshot()
      .then((snapshot) => {
        if (snapshot) {
          preCachedSnapshotRef.current = snapshot;
        }
      })
      .catch(() => {
        // Speculative pre-capture can miss; the overlay path still falls back to capture-on-open.
      })
      .finally(() => {
        rdpPreCaptureInFlightRef.current = false;
      });
  };

  const pushRdpVisibility = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionStartedRef.current || !sessionId) {
      return;
    }
    const wantsVisible = visibilityRef.current.isActive && !visibilityRef.current.suppressed;
    const visible = wantsVisible && displayReadyRef.current;
    const bounds = wantsVisible ? computeBounds() : lastBoundsRef.current ?? computeBounds();
    if (!bounds) {
      return;
    }
    const previous = lastBoundsRef.current;
    const boundsChanged = !previous || !boundsEqual(previous, bounds);
    void invokeCommand("set_rdp_visibility", {
      request: { sessionId, visible, scaleFactor: currentRdpPixelScale(), ...bounds },
    })
      .then(() => {
        rdpVisibleRef.current = visible;
        if (visible) {
          setRdpSnapshot(null);
        }
      })
      .catch((error) => {
        reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
      });
    if (!visible) {
      if (wantsVisible) {
        attemptRdpDisplaySync();
      }
      return;
    }
    if (boundsChanged) {
      lastBoundsRef.current = bounds;
      void invokeCommand("update_rdp_bounds", {
        request: { sessionId, scaleFactor: currentRdpPixelScale(), ...bounds },
      }).catch((error) => {
        reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
      });
    }
  };

  const cancelRdpDisplaySettle = () => {
    if (displaySettleTimerRef.current !== null) {
      window.clearTimeout(displaySettleTimerRef.current);
      displaySettleTimerRef.current = null;
    }
    displaySettlePassesRef.current = 0;
  };

  // Re-apply visible RDP bounds for a short window after the session first
  // becomes displayable. Pane-tracking modes resize the remote desktop through
  // update_rdp_bounds; presentation-fit modes only resize the native control.
  // Either way this stays on-screen so pane switches never park a live session.
  const scheduleRdpDisplaySettle = () => {
    if (displaySettleTimerRef.current !== null) {
      return;
    }
    displaySettlePassesRef.current = 0;
    let successfulPasses = 0;
    const run = () => {
      displaySettleTimerRef.current = null;
      const sessionId = sessionIdRef.current;
      if (
        !sessionStartedRef.current ||
        !sessionId ||
        !displayReadyRef.current ||
        !rdpVisibleRef.current ||
        !visibilityRef.current.isActive ||
        visibilityRef.current.suppressed
      ) {
        return;
      }
      const bounds = computeBounds() ?? lastBoundsRef.current;
      if (!bounds) {
        return;
      }
      lastBoundsRef.current = bounds;
      void invokeCommand("update_rdp_bounds", {
        request: { sessionId, scaleFactor: currentRdpPixelScale(), ...bounds, force: true },
      })
        .then(() => {
          successfulPasses += 1;
        })
        .catch(() => {
          // A forced settle failure usually means the RDP control is no longer
          // accepting dynamic display updates. Stop instead of flickering a
          // fully established desktop; real bounds changes still re-sync later.
          displaySettlePassesRef.current = RDP_DISPLAY_SETTLE_PASSES;
        })
        .finally(() => {
          displaySettlePassesRef.current += 1;
          if (
            successfulPasses < RDP_DISPLAY_SETTLE_SUCCESS_PASSES &&
            displaySettlePassesRef.current < RDP_DISPLAY_SETTLE_PASSES &&
            sessionStartedRef.current
          ) {
            displaySettleTimerRef.current = window.setTimeout(
              run,
              RDP_DISPLAY_SETTLE_INTERVAL_MS,
            );
          }
        });
    };
    displaySettleTimerRef.current = window.setTimeout(run, RDP_DISPLAY_SETTLE_INTERVAL_MS);
  };

  const attemptRdpDisplaySync = () => {
    const sessionId = sessionIdRef.current;
    if (
      !sessionStartedRef.current ||
      !sessionId ||
      !visibilityRef.current.isActive ||
      visibilityRef.current.suppressed ||
      displayReadyRef.current ||
      displaySyncInFlightRef.current
    ) {
      return;
    }
    const bounds = computeBounds() ?? lastBoundsRef.current;
    if (!bounds) {
      return;
    }
    displaySyncInFlightRef.current = true;
    void invokeCommand("sync_rdp_display_size", {
      request: { sessionId, scaleFactor: currentRdpPixelScale(), ...bounds },
    })
      .then((result) => {
        if (sessionIdRef.current !== result.sessionId) {
          return;
        }
        if (result.displaySynced) {
          markRdpConnectionStarted();
          displayReadyRef.current = true;
          lastBoundsRef.current = bounds;
          setRdpStatus(
            result.connectionState === RDP_ESTABLISHING_STATE
              ? t("remoteDesktop.connecting")
              : t("remoteDesktop.connected"),
          );
          pushRdpVisibility();
          scheduleRdpDisplaySettle();
        } else if (result.connected) {
          markRdpConnectionStarted();
          setRdpStatus(t("remoteDesktop.preparingDisplay"));
        } else {
          handleRdpDisconnectedStatus(result.connectionState);
        }
      })
      .catch((error) => {
        reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        displaySyncInFlightRef.current = false;
      });
  };

  const resetRdpSessionRefs = () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    cancelRdpDisplaySettle();
    sessionStartedRef.current = false;
    sessionStartingRef.current = false;
    rdpConnectionCountedRef.current = false;
    sessionIdRef.current = null;
    lastBoundsRef.current = null;
    displayReadyRef.current = false;
    displaySyncInFlightRef.current = false;
    rdpVisibleRef.current = false;
    rdpControlRef.current = "";
    rdpSuppressionCaptureInFlightRef.current = false;
    rdpPreCaptureInFlightRef.current = false;
    setRdpSnapshot(null);
  };

  const resetVncSessionRefs = () => {
    vncFrameGenerationRef.current += 1;
    sessionStartedRef.current = false;
    sessionStartingRef.current = false;
    sessionIdRef.current = null;
    // Safety net: a detached full-screen window announces "inactive" via an
    // async event emitted from its own beforeunload handler, which is not
    // guaranteed to land before the window is torn down (e.g. closed via Alt+F4
    // or the OS). If that announcement is lost, this flag would otherwise stay
    // stuck true and silently swallow every future frame for this pane,
    // including across reconnects. Every reset clears it unconditionally.
    vncFullscreenAttachedRef.current = false;
    vncButtonMaskRef.current = 0;
    vncPendingPointerRef.current = null;
    if (vncPointerRafRef.current !== null) {
      window.cancelAnimationFrame(vncPointerRafRef.current);
      vncPointerRafRef.current = null;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    setVncHasDisplay(false);
  };

  const handleReconnect = async () => {
    if ((!canStartRdp && !canStartVnc && !useRdpCanvas) || !connection || !isTauriRuntime()) {
      return;
    }
    if (useRdpCanvas) {
      setRdpStartKey((key) => key + 1);
      return;
    }
    const sessionId = sessionIdRef.current;
    const hadCountedSession = canStartRdp
      ? rdpConnectionCountedRef.current
      : sessionStartedRef.current;
    const ownedSession = sessionStartingRef.current || sessionStartedRef.current;
    if (canStartVnc) {
      resetVncSessionRefs();
    } else {
      resetRdpSessionRefs();
    }
    setRdpError("");
    setRdpStatus(t("remoteDesktop.reconnecting"));
    if (ownedSession && sessionId) {
      try {
        await invokeCommand(canStartVnc ? "close_vnc_session" : "close_rdp_session", {
          request: { sessionId },
        });
      } catch (error) {
        reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    if (hadCountedSession) {
      markConnectionSessionEnded(connection.id);
    }
    setRdpStartKey((key) => key + 1);
  };

  const handleSendCtrlAltDelete = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (useRdpCanvas) {
      setRdpCanvasCadSignal((value) => value + 1);
      return;
    }
    if (canStartRdp) {
      const rect = event.currentTarget.getBoundingClientRect();
      void showNativeContextMenu(
        [
          {
            kind: "item",
            label: t("remoteDesktop.sendCtrlAltDelHint"),
            disabled: true,
            action: () => {},
          },
        ],
        { x: rect.left, y: rect.bottom },
      );
      return;
    }
    const sessionId = sessionIdRef.current;
    if (!sessionId || !sessionStartedRef.current || !isTauriRuntime()) {
      return;
    }
    void invokeCommand("send_vnc_ctrl_alt_delete", { request: { sessionId } }).catch((error) => {
      reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
    });
  };

  const openFullscreen = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !connection || (connection.type !== "rdp" && connection.type !== "vnc")) {
      return;
    }
    if (canStartRdp) {
      void invokeCommand("enter_rdp_fullscreen", {
        request: { sessionId, connectionName: connection.name },
      }).catch((error) =>
        reportRemoteDesktopError(error instanceof Error ? error.message : String(error)),
      );
      return;
    }
    void openRemoteFullscreen({
      sessionId,
      connectionId: connection.id,
      kind: connection.type,
      monitorMode: "current",
    }).catch((error) =>
      reportRemoteDesktopError(error instanceof Error ? error.message : String(error)),
    );
  };
  openFullscreenRef.current = openFullscreen;

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let dispose: (() => void) | undefined;
    void listen(REMOTE_FULLSCREEN_SHORTCUT_EVENT, () => {
      if (
        disposed
        || !isActive
        || document.querySelector(".settings-backdrop, .dialog-backdrop, .kk-dlg-backdrop")
      ) {
        return;
      }
      const state = useWorkspaceStore.getState();
      const activeTab = state.tabs.find((entry) => entry.id === state.activeTabId);
      const isFocusedRemoteDesktop =
        tab.id === state.activeTabId || activeTab?.focusedPaneId === tab.id;
      if (isFocusedRemoteDesktop) {
        openFullscreenRef.current();
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
  }, [isActive, tab.id]);

  const handleRemoteDesktopMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!connection || !showRemoteDesktopToolbar) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const options = remoteDesktopViewModeOptions(t);
    const fullscreenBinding = effectiveWorkspaceShortcutBindings(
      generalSettings.workspaceShortcuts,
    ).get("remoteFullscreen");
    void showNativeContextMenu(
      [
        {
          kind: "item",
          label: fullscreenBinding
            ? `${t("remoteDesktop.fullscreen.enter")}\t${displayShortcutBinding(fullscreenBinding)}`
            : t("remoteDesktop.fullscreen.enter"),
          disabled: !sessionIdRef.current,
          action: openFullscreen,
        },
        { kind: "separator" },
        ...options.map((option) => ({
          kind: "item" as const,
          label: option.value === viewMode ? `✓ ${option.label}` : option.label,
          disabled: option.value === viewMode,
          action: () => void saveViewMode(option.value),
        })),
      ],
      { x: rect.left, y: rect.bottom },
    );
  };

  const saveViewMode = async (nextViewMode: RemoteDesktopViewMode) => {
    if (!connection || nextViewMode === viewMode) {
      return;
    }
    setOptimisticViewMode(nextViewMode);
    const updated = connection.type === "rdp"
      ? {
          ...connection,
          rdpOptions: {
            ...resolveRdpOptions(rdpSettings, connection.rdpOptions),
            inheritDefaults: false,
            remoteResolution: rdpResolutionForViewMode(
              nextViewMode,
              resolveRdpOptions(rdpSettings, connection.rdpOptions).remoteResolution,
            ),
            viewMode: nextViewMode,
          },
        }
      : {
          ...connection,
          vncOptions: {
            ...resolveVncOptions(vncSettings, connection.vncOptions),
            inheritDefaults: false,
            viewMode: nextViewMode,
          },
        };
    refreshOpenConnectionMetadata(updated);
    if (isTauriRuntime() && !connection.id.startsWith("quick-")) {
      try {
        const saved = await invokeCommand("update_connection", {
          request: connectionUpdateRequest(updated),
        });
        refreshOpenConnectionMetadata(saved);
      } catch (error) {
        setOptimisticViewMode(null);
        refreshOpenConnectionMetadata(connection);
        showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
        return;
      }
    }
    showStatusBarNotice(t("remoteDesktop.viewModeSaved", { mode: viewModeLabel(t, nextViewMode) }), {
      tone: "success",
    });
    if (connection.type === "rdp" && !useRdpCanvas) {
      void handleReconnect();
    }
  };

  const scheduleBoundsPush = () => {
    if (!sessionStartedRef.current) {
      return;
    }
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }
      if (!visibilityRef.current.isActive || visibilityRef.current.suppressed) {
        const bounds = lastBoundsRef.current ?? computeBounds();
        if (!bounds) {
          return;
        }
        void invokeCommand("set_rdp_visibility", {
          request: { sessionId, visible: false, ...bounds },
        })
          .then(() => {
            rdpVisibleRef.current = false;
          })
          .catch((error) => {
            reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
          });
        return;
      }
      const bounds = computeBounds();
      if (!bounds) {
        return;
      }
      if (!displayReadyRef.current) {
        lastBoundsRef.current = bounds;
        attemptRdpDisplaySync();
        return;
      }
      const previous = lastBoundsRef.current;
      if (
        previous &&
        boundsEqual(previous, bounds)
      ) {
        return;
      }
      if (!rdpVisibleRef.current) {
        lastBoundsRef.current = bounds;
        void invokeCommand("set_rdp_visibility", {
          request: { sessionId, visible: true, scaleFactor: currentRdpPixelScale(), ...bounds },
        })
          .then(() => {
            rdpVisibleRef.current = true;
            setRdpSnapshot(null);
          })
          .catch((error) => {
            reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
          });
        return;
      }
      lastBoundsRef.current = bounds;
      void invokeCommand("update_rdp_bounds", {
        request: { sessionId, scaleFactor: currentRdpPixelScale(), ...bounds },
      }).catch((error) => {
        reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
      });
    });
  };

  useEffect(() => {
    if (!canStartRdp || !connection || !isTauriRuntime() || sessionStartedRef.current || sessionStartingRef.current) {
      return;
    }
    let disposed = false;
    let sessionId = "";
    const rdpPaneId = tab.panes[0]?.id;
    let registeredRdpSender:
      | ((text: string, pressEnter: boolean) => Promise<void>)
      | null = null;
    void readSettledBounds().then((bounds) => {
      if (disposed || !bounds) {
        return;
      }
      sessionId = createRemoteDesktopSessionId("rdp");
      sessionIdRef.current = sessionId;
      lastLoggedBoundsRef.current = null;
      computeBounds();
      sessionStartingRef.current = true;
      displayReadyRef.current = false;
      displaySyncInFlightRef.current = false;
      rdpVisibleRef.current = false;
      lastBoundsRef.current = bounds;
      rdpControlRef.current = "";
      setRdpStatus((current) => (current === t("remoteDesktop.reconnecting") ? current : t("remoteDesktop.connecting")));
      void invokeCommand("start_rdp_session", {
        request: {
          sessionId,
          connectionName: connection.name,
          host: connection.host,
          user: connection.user,
          port: connection.port,
          secretOwnerId: connectionPasswordOwnerId(connection),
          options: resolveRdpOptions(rdpSettings, connection.rdpOptions),
          scaleFactor: currentRdpPixelScale(),
          ...bounds,
        },
      })
        .then((started) => {
          sessionStartingRef.current = false;
          if (disposed) {
            void invokeCommand("close_rdp_session", { request: { sessionId: started.sessionId } });
            return;
          }
          sessionStartedRef.current = true;
          rdpControlRef.current = started.control;
          setRdpStatus(t("remoteDesktop.preparingDisplay"));
          if (rdpPaneId) {
            const startedSessionId = started.sessionId;
            registeredRdpSender = async (text, pressEnter) => {
              await invokeCommand("send_rdp_text", {
                request: {
                  sessionId: startedSessionId,
                  text,
                  pressEnter,
                },
              });
            };
            registerRdpTextSender(rdpPaneId, registeredRdpSender);
          }
          attemptRdpDisplaySync();
        })
        .catch((error) => {
          sessionStartingRef.current = false;
          sessionStartedRef.current = false;
          if (!disposed) {
            setRdpStatus("");
            reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
          }
        });
    });

    return () => {
      disposed = true;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      cancelRdpDisplaySettle();
      const ownsSession = sessionStartingRef.current || sessionStartedRef.current;
      sessionStartingRef.current = false;
      const counted = rdpConnectionCountedRef.current;
      sessionStartedRef.current = false;
      rdpConnectionCountedRef.current = false;
      displayReadyRef.current = false;
      displaySyncInFlightRef.current = false;
      rdpVisibleRef.current = false;
      if (sessionIdRef.current === sessionId) {
        sessionIdRef.current = null;
      }
      if (rdpPaneId && registeredRdpSender) {
        unregisterRdpTextSender(rdpPaneId, registeredRdpSender);
        registeredRdpSender = null;
      }
      if (ownsSession) {
        void invokeCommand("close_rdp_session", { request: { sessionId } });
      }
      if (counted) {
        markConnectionSessionEnded(connection.id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdpStartKey]);

  useEffect(() => {
    if (!canStartVnc || !connection || !isTauriRuntime() || sessionStartedRef.current || sessionStartingRef.current) {
      return;
    }
    let disposed = false;
    let startTimer = 0;
    const sessionId = createRemoteDesktopSessionId("vnc");
    sessionIdRef.current = sessionId;
    sessionStartingRef.current = true;
    setRdpStatus((current) => (current === t("remoteDesktop.reconnecting") ? current : t("remoteDesktop.connecting")));
    setRdpError("");

    startTimer = window.setTimeout(() => {
      void invokeCommand("start_vnc_session", {
        request: {
          sessionId,
          host: connection.host,
          port: connection.port,
          username: connection.user || undefined,
          secretOwnerId: connectionPasswordOwnerId(connection),
          options: resolveVncOptions(vncSettings, connection.vncOptions),
        },
      })
        .then((started) => {
          sessionStartingRef.current = false;
          if (disposed) {
            void invokeCommand("close_vnc_session", { request: { sessionId: started.sessionId } });
            return;
          }
          sessionStartedRef.current = true;
          setRdpStatus(t("remoteDesktop.connected"));
          markConnectionSessionStarted(connection.id);
        })
        .catch((error) => {
          sessionStartingRef.current = false;
          sessionStartedRef.current = false;
          if (!disposed) {
            setRdpStatus("");
            reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
          }
        });
      });

    return () => {
      disposed = true;
      window.clearTimeout(startTimer);
      const ownsSession = sessionStartingRef.current || sessionStartedRef.current;
      sessionStartingRef.current = false;
      const started = sessionStartedRef.current;
      sessionStartedRef.current = false;
      if (sessionIdRef.current === sessionId) {
        sessionIdRef.current = null;
      }
      if (ownsSession) {
        void invokeCommand("close_vnc_session", { request: { sessionId } });
      }
      if (started) {
        markConnectionSessionEnded(connection.id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdpStartKey, canStartVnc]);

  useEffect(() => {
    visibilityRef.current = { isActive, suppressed };
  }, [isActive, suppressed]);

  useEffect(() => {
    if (!canStartRdp || !isTauriRuntime()) {
      return;
    }
    const node = hostRef.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(() => scheduleBoundsPush());
    observer.observe(node);
    window.addEventListener("resize", scheduleBoundsPush);
    window.addEventListener("scroll", scheduleBoundsPush, true);
    const repushOnNativeMove = () => {
      lastBoundsRef.current = null;
      scheduleBoundsPush();
    };
    const moveUnlisten = listen("tauri://move", repushOnNativeMove).catch(() => null);
    const resizeUnlisten = listen("tauri://resize", repushOnNativeMove).catch(() => null);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsPush);
      window.removeEventListener("scroll", scheduleBoundsPush, true);
      void moveUnlisten.then((dispose) => dispose?.());
      void resizeUnlisten.then((dispose) => dispose?.());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStartRdp]);

  useEffect(() => {
    if (!canStartRdp || !isTauriRuntime()) {
      return;
    }
    const updateSuppression = () => {
      if (!documentHasRdpBlockingOverlay(hostRef.current)) {
        rdpSuppressionCaptureInFlightRef.current = false;
        visibilityRef.current = { ...visibilityRef.current, suppressed: false };
        setSuppressed(false);
        return;
      }
      if (visibilityRef.current.suppressed || rdpSuppressionCaptureInFlightRef.current) {
        return;
      }
      const cached = preCachedSnapshotRef.current;
      if (cached) {
        preCachedSnapshotRef.current = null;
        if (documentHasRdpBlockingOverlay(hostRef.current)) {
          setRdpSnapshot(cached);
          visibilityRef.current = { ...visibilityRef.current, suppressed: true };
          setSuppressed(true);
        }
        return;
      }
      rdpSuppressionCaptureInFlightRef.current = true;
      void captureVisibleRdpSnapshot()
        .then((snapshot) => {
          if (!documentHasRdpBlockingOverlay(hostRef.current)) {
            visibilityRef.current = { ...visibilityRef.current, suppressed: false };
            setSuppressed(false);
            return;
          }
          if (snapshot) {
            setRdpSnapshot(snapshot);
          }
          visibilityRef.current = { ...visibilityRef.current, suppressed: true };
          setSuppressed(true);
        })
        .catch(() => {
          if (documentHasRdpBlockingOverlay(hostRef.current)) {
            visibilityRef.current = { ...visibilityRef.current, suppressed: true };
            setSuppressed(true);
          }
        })
        .finally(() => {
          rdpSuppressionCaptureInFlightRef.current = false;
        });
    };
    updateSuppression();
    const observer = new MutationObserver(updateSuppression);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStartRdp]);

  useEffect(() => {
    if (!canStartRdp || rdpPreCaptureSignal === 0) {
      return;
    }
    triggerPreCapture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdpPreCaptureSignal]);

  useEffect(() => {
    if (!canStartRdp || !isTauriRuntime() || !sessionStartedRef.current) {
      return;
    }
    pushRdpVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStartRdp, isActive, suppressed]);

  useEffect(() => {
    if (!canStartRdp || !isTauriRuntime()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (
        !sessionStartedRef.current ||
        displayReadyRef.current ||
        displaySyncInFlightRef.current
      ) {
        return;
      }

      attemptRdpDisplaySync();
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
    // Re-arm the poll only when RDP eligibility changes; attemptRdpDisplaySync reads live refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStartRdp]);

  useEffect(() => {
    if (!canStartVnc || !isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let dispose: (() => void) | undefined;
    void listen<VncSessionEvent>("vnc-session-event", (event) => {
      if (disposed) {
        return;
      }
      if (event.payload.sessionId !== sessionIdRef.current) {
        return;
      }
      handleVncSessionEvent(event.payload);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      dispose = unlisten;
    });
    return () => {
      disposed = true;
      dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStartVnc]);

  useEffect(() => {
    if (!canStartVnc || !isTauriRuntime()) return;
    let disposed = false;
    let dispose: (() => void) | undefined;
    void listen<VncFullscreenSurfaceEvent>(VNC_FULLSCREEN_SURFACE_EVENT, (event) => {
      if (disposed || event.payload.sessionId !== sessionIdRef.current) return;
      vncFullscreenAttachedRef.current = event.payload.active;
      if (!event.payload.active && sessionStartedRef.current) {
        void invokeCommand("refresh_vnc_session", {
          request: { sessionId: event.payload.sessionId },
        }).catch(() => undefined);
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else dispose = unlisten;
    });
    return () => {
      disposed = true;
      dispose?.();
      vncFullscreenAttachedRef.current = false;
    };
  }, [canStartVnc]);

  useEffect(() => {
    if (!canStartVnc || !isTauriRuntime()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const sessionId = sessionIdRef.current;
      if (!sessionStartedRef.current || !sessionId) {
        return;
      }

      void invokeCommand("get_vnc_session_status", {
        request: { sessionId },
      })
        .then((status) => {
          if (!status.connected && sessionIdRef.current === status.sessionId) {
            const hadStartedSession = sessionStartedRef.current;
            resetVncSessionRefs();
            if (hadStartedSession && connection) {
              markConnectionSessionEnded(connection.id);
            }
            setRdpStatus(t("remoteDesktop.disconnected"));
          }
        })
        .catch((error) => {
          reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
        });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
    // Re-arm the poll only when VNC eligibility changes; t/reportRemoteDesktopError are read at run time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStartVnc]);

  const handleVncSessionEvent = (event: VncSessionEvent) => {
    if (event.kind === "connected") {
      setRdpStatus(t("remoteDesktop.waitingFramebuffer"));
      return;
    }
    if (event.kind === "resolution") {
      resizeVncCanvas(event.width, event.height);
      setVncHasDisplay(false);
      setRdpStatus(t("remoteDesktop.connected"));
      return;
    }
    if (event.kind === "frameAvailable") {
      // The backend advances its single bounded framebuffer stream after the
      // first acknowledgement. While the detached surface owns presentation,
      // it must therefore be the only canvas fetching and acknowledging frames.
      if (vncFullscreenAttachedRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) {
        void invokeCommand("acknowledge_vnc_frame", {
          request: { sessionId: event.sessionId, frameId: event.frameId },
        });
        return;
      }
      const frameGeneration = vncFrameGenerationRef.current;
      vncFrameChainRef.current = vncFrameChainRef.current
        .then(() =>
          fetchAndPaintVncFrame(canvas, event, () =>
            isCurrentVncFrame(
              sessionStartedRef.current,
              sessionIdRef.current,
              event.sessionId,
              vncFrameGenerationRef.current,
              frameGeneration,
            ),
          ),
        )
        .then((painted) => {
          if (painted) {
            setVncHasDisplay(true);
          }
        })
        .catch((error) => {
          reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
        });
      return;
    }
    if (event.kind === "setCursor") {
      const canvas = canvasRef.current;
      if (canvas) {
        paintVncCursor(canvas, event);
      }
      return;
    }
    if (event.kind === "error") {
      reportRemoteDesktopError(event.message);
      setRdpStatus(t("remoteDesktop.disconnected"));
      return;
    }
    if (event.kind === "disconnected") {
      const hadStartedSession = sessionStartedRef.current;
      resetVncSessionRefs();
      void invokeCommand("close_vnc_session", {
        request: { sessionId: event.sessionId },
      }).catch(() => undefined);
      if (hadStartedSession && connection) {
        markConnectionSessionEnded(connection.id);
      }
      setRdpStatus(t("remoteDesktop.disconnected"));
    }
  };

  const resizeVncCanvas = (width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) {
      return;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const vncPointForEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    const content = vncRenderedContentRect(rect, canvas.width, canvas.height, viewMode);
    const scaleX = canvas.width / Math.max(1, content.width);
    const scaleY = canvas.height / Math.max(1, content.height);
    return {
      x: Math.max(
        0,
        Math.min(canvas.width - 1, Math.round((event.clientX - content.left) * scaleX)),
      ),
      y: Math.max(
        0,
        Math.min(canvas.height - 1, Math.round((event.clientY - content.top) * scaleY)),
      ),
    };
  };

  const flushVncPointer = (coalescible = true) => {
    vncPointerRafRef.current = null;
    const pending = vncPendingPointerRef.current;
    const sessionId = sessionIdRef.current;
    if (!pending || !sessionId || !sessionStartedRef.current) {
      return;
    }
    vncPendingPointerRef.current = null;
    void invokeCommand("send_vnc_pointer_event", {
      request: { sessionId, ...pending, coalescible },
    }).catch((error) => {
      reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
    });
  };

  const sendVncPointer = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    buttonMask?: number,
    immediate = false,
  ) => {
    if (!sessionStartedRef.current) {
      return;
    }
    const point = vncPointForEvent(event);
    const mask = buttonMask ?? vncButtonMaskRef.current;
    vncPendingPointerRef.current = { x: point.x, y: point.y, buttonMask: mask };
    if (immediate) {
      if (vncPointerRafRef.current !== null) {
        window.cancelAnimationFrame(vncPointerRafRef.current);
        vncPointerRafRef.current = null;
      }
      flushVncPointer(false);
      return;
    }
    if (vncPointerRafRef.current === null) {
      vncPointerRafRef.current = window.requestAnimationFrame(() => flushVncPointer());
    }
  };

  const handleVncPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    vncButtonMaskRef.current = pointerButtonMask(event.button);
    sendVncPointer(event, vncButtonMaskRef.current, true);
  };

  const handleVncPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    vncButtonMaskRef.current = 0;
    sendVncPointer(event, 0, true);
  };

  const handleVncWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const pointerEvent = event as unknown as ReactPointerEvent<HTMLCanvasElement>;
    const wheelMask = event.deltaY < 0 ? 8 : 16;
    sendVncPointer(pointerEvent, wheelMask, true);
    window.setTimeout(() => sendVncPointer(pointerEvent, 0, true), 20);
  };

  const handleVncKey = (event: ReactKeyboardEvent<HTMLCanvasElement>, down: boolean) => {
    const key = vncKeysymForEvent(event);
    const sessionId = sessionIdRef.current;
    if (!sessionId || !key || !sessionStartedRef.current) {
      return;
    }
    event.preventDefault();
    void invokeCommand("send_vnc_key_event", {
      request: { sessionId, key, down },
    }).catch((error) => {
      reportRemoteDesktopError(error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <section
      className={isActive ? "terminal-workspace remote-desktop-shell active" : "terminal-workspace remote-desktop-shell"}
      ref={workspaceRef}
    >
      <article className="terminal-pane remote-desktop-pane">
        <header>
          <span>
            <Icon size={13} />
            {toolbarTitle}
          </span>
          <div className="terminal-pane-actions" data-tutorial-id="remoteDesktop.toolbar">
            {tab.subtitle ? <small>{tab.subtitle}</small> : null}
          {rdpStatus ? <span className="webview-toolbar-status">{rdpStatus}</span> : null}
          {showRemoteDesktopToolbar ? (
            <button
              aria-label={`${t("remoteDesktop.sendCtrlAltDel")} ${typeLabel} ${t("remoteDesktop.session")}`}
              className="terminal-pane-action"
              data-tutorial-id="remoteDesktop.sendCtrlAltDel"
              disabled={!isTauriRuntime() || (!canStartRdp && !useRdpCanvas && !sessionStartedRef.current)}
              onClick={handleSendCtrlAltDelete}
              title={canStartRdp ? t("remoteDesktop.sendCtrlAltDelHint") : t("remoteDesktop.sendCtrlAltDel")}
              type="button"
            >
              <Keyboard size={13} />
            </button>
          ) : null}
          {showRemoteDesktopToolbar ? (
            <button
              aria-label={`${t("remoteDesktop.reconnect")} ${typeLabel} ${t("remoteDesktop.session")}`}
              className="terminal-pane-action"
              data-tutorial-id="remoteDesktop.reconnect"
              disabled={!isTauriRuntime()}
              onClick={() => void handleReconnect()}
              title={t("remoteDesktop.reconnect")}
              type="button"
            >
              <RotateCcw size={13} />
            </button>
          ) : null}
          <ScreenshotMenu
            buttonClassName="terminal-pane-action"
            dataTutorialId="workspace.screenshotMenu"
            onCapture={captureRemoteDesktopCanvas}
            targetRef={connection?.type === "rdp" || connection?.type === "vnc" ? hostRef : workspaceRef}
          />
          {connection ? (
            <NoteToolbarButton
              connectionId={connection.id}
              onOpen={() => openNoteEditor(connection.id, connection.name)}
            />
          ) : null}
          {showRemoteDesktopToolbar ? (
            <button
              aria-label={t("workspace.sendEntirePanelToAi")}
              className="terminal-pane-action"
              data-tutorial-id="remoteDesktop.sendToAi"
              disabled={!isTauriRuntime()}
              onClick={() => void captureTargetScreenshotForAssistant()}
              title={t("workspace.sendEntirePanelToAi")}
              type="button"
            >
              <Bot size={13} />
            </button>
          ) : null}
          {showRemoteDesktopToolbar ? (
            <button
              aria-label={t("remoteDesktop.actionsMenu")}
              className="terminal-pane-action"
              data-tutorial-id="remoteDesktop.viewMode"
              disabled={!isTauriRuntime()}
              onClick={handleRemoteDesktopMenu}
              title={t("remoteDesktop.actionsMenu")}
              type="button"
            >
              <Menu size={13} />
            </button>
          ) : null}
        
        </div>
        </header>
      <div
        className={`remote-desktop-workspace remote-desktop-view-mode-${viewMode}`}
        data-tutorial-id="remoteDesktop.surface"
        ref={hostRef}
      >
        {connection?.type === "rdp" && rdpSnapshot ? (
          <img
            alt=""
            className="rdp-suppression-snapshot"
            height={rdpSnapshot.height}
            src={rdpSnapshot.dataUrl}
            width={rdpSnapshot.width}
          />
        ) : null}
        {useRdpCanvas && connection ? (
          <RdpCanvasView
            cadSignal={rdpCanvasCadSignal}
            connection={connection}
            key={rdpStartKey}
            onSessionConnected={handleRdpCanvasConnected}
            onSessionDisconnected={handleRdpCanvasDisconnected}
            rdpOptions={resolveRdpOptions(rdpSettings, connection.rdpOptions)}
            surfaceRef={canvasRef}
          />
        ) : null}
        {connection?.type === "vnc" ? (
          <canvas
            aria-label={`${tab.title} ${t("remoteDesktop.displayAria")}`}
            className={vncHasDisplay ? "vnc-display ready" : "vnc-display"}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => handleVncKey(event, true)}
            onKeyUp={(event) => handleVncKey(event, false)}
            onPointerDown={handleVncPointerDown}
            onPointerMove={sendVncPointer}
            onPointerUp={handleVncPointerUp}
            onWheel={handleVncWheel}
            ref={canvasRef}
            tabIndex={0}
          />
        ) : null}
        <div className="remote-desktop-placeholder" hidden={vncHasDisplay || Boolean(rdpSnapshot) || useRdpCanvas}>
          <Icon size={34} />
          <h2>{connection?.name ?? typeLabel}</h2>
          <p>{connection ? `${typeLabel} ${connectionSubtitle(connection)}` : typeLabel}</p>
          {connection?.type === "rdp" ? (
            !isTauriRuntime() ? (
              <small>{t("remoteDesktop.rdpDesktopRequired")}</small>
            ) : rdpError ? (
              <small className="form-error">{rdpError}</small>
            ) : (
              <small>{t("remoteDesktop.rdpActiveX")}</small>
            )
          ) : connection?.type === "vnc" ? (
            !isTauriRuntime() ? (
              <small>{t("remoteDesktop.vncDesktopRequired")}</small>
            ) : rdpError ? (
              <small className="form-error">{rdpError}</small>
            ) : (
              <small>{t("remoteDesktop.vncFramebuffer")}</small>
            )
          ) : (
            <small>{t("remoteDesktop.transportUnavailable")}</small>
          )}
        </div>
      </div>
      </article>
    </section>
  );
}

async function captureCanvasScreenshotForAssistant(
  canvas: HTMLCanvasElement | null,
  request: { x: number; y: number; width: number; height: number },
  viewMode: RemoteDesktopViewMode,
): Promise<AssistantScreenshot> {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
    throw new Error("Remote desktop canvas is not ready.");
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error("Remote desktop canvas is not visible.");
  }
  const contentRect = vncRenderedContentRect(rect, canvas.width, canvas.height, viewMode);
  const requestedRect = {
    left: request.x,
    top: request.y,
    right: request.x + request.width,
    bottom: request.y + request.height,
  };
  const cropCss = {
    left: Math.max(contentRect.left, requestedRect.left),
    top: Math.max(contentRect.top, requestedRect.top),
    right: Math.min(contentRect.left + contentRect.width, requestedRect.right),
    bottom: Math.min(contentRect.top + contentRect.height, requestedRect.bottom),
  };
  if (cropCss.right <= cropCss.left || cropCss.bottom <= cropCss.top) {
    throw new Error("Screenshot region is outside the remote desktop canvas.");
  }

  const scaleX = canvas.width / Math.max(1, contentRect.width);
  const scaleY = canvas.height / Math.max(1, contentRect.height);
  const sourceX = Math.max(0, Math.round((cropCss.left - contentRect.left) * scaleX));
  const sourceY = Math.max(0, Math.round((cropCss.top - contentRect.top) * scaleY));
  const sourceWidth = Math.min(
    canvas.width - sourceX,
    Math.max(1, Math.round((cropCss.right - cropCss.left) * scaleX)),
  );
  const sourceHeight = Math.min(
    canvas.height - sourceY,
    Math.max(1, Math.round((cropCss.bottom - cropCss.top) * scaleY)),
  );

  const output = document.createElement("canvas");
  output.width = sourceWidth;
  output.height = sourceHeight;
  const context = output.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare remote desktop screenshot.");
  }
  context.drawImage(
    canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  return {
    dataUrl: output.toDataURL("image/png"),
    width: sourceWidth,
    height: sourceHeight,
  };
}

async function sendRdpCanvasText(sessionId: string, text: string, pressEnter: boolean) {
  if (text.length > 0) {
    await invokeCommand("send_rdp_client_text", { request: { sessionId, text } });
  }
  if (pressEnter && !text.endsWith("\n") && !text.endsWith("\r")) {
    await sendRdpCanvasKeyPress(sessionId, "enter");
  }
}

async function sendRdpCanvasKeyPress(sessionId: string, key: string) {
  if (normalizeRemoteDesktopKeyName(key) === "ctrlaltdelete") {
    await invokeCommand("send_rdp_client_ctrl_alt_delete", { request: { sessionId } });
    return;
  }
  const scancode = rdpCanvasScancodeForName(key);
  await invokeCommand("send_rdp_client_key_event", {
    request: { sessionId, scancode, down: true },
  });
  await invokeCommand("send_rdp_client_key_event", {
    request: { sessionId, scancode, down: false },
  });
}

async function sendRdpCanvasMouseClick(
  sessionId: string,
  x: number,
  y: number,
  button: "left" | "right" | "middle",
) {
  const request = {
    sessionId,
    x: Math.max(0, Math.min(65535, Math.trunc(x))),
    y: Math.max(0, Math.min(65535, Math.trunc(y))),
  };
  const buttonMask = button === "right" ? 4 : button === "middle" ? 2 : 1;
  await invokeCommand("send_rdp_client_pointer_event", {
    request: { ...request, buttonMask },
  });
  await invokeCommand("send_rdp_client_pointer_event", {
    request: { ...request, buttonMask: 0 },
  });
}

function rdpCanvasScancodeForName(value: string) {
  const code = rdpCanvasCodeForName(value);
  const scancode = code ? scancodeForCode(code) : undefined;
  if (scancode === undefined) {
    throw new Error(`Unsupported RDP key press: ${value}`);
  }
  return scancode;
}

function rdpCanvasCodeForName(value: string) {
  const keyCodes: Record<string, string> = {
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    escape: "Escape",
    esc: "Escape",
    backspace: "Backspace",
    delete: "Delete",
    del: "Delete",
    arrowup: "ArrowUp",
    up: "ArrowUp",
    arrowdown: "ArrowDown",
    down: "ArrowDown",
    arrowleft: "ArrowLeft",
    left: "ArrowLeft",
    arrowright: "ArrowRight",
    right: "ArrowRight",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pgup: "PageUp",
    pagedown: "PageDown",
    pgdn: "PageDown",
    space: "Space",
  };
  return keyCodes[normalizeRemoteDesktopKeyName(value)];
}

function resolveRdpOptions(
  defaults: RdpSettings,
  overrides?: RdpConnectionOptions,
): RdpSettings {
  if (!overrides || overrides.inheritDefaults) {
    return defaults;
  }
  return {
    colorDepth: overrides.colorDepth ?? defaults.colorDepth,
    administrativeSession: overrides.administrativeSession ?? defaults.administrativeSession,
    redirectClipboard: overrides.redirectClipboard ?? defaults.redirectClipboard,
    redirectDrives: overrides.redirectDrives ?? defaults.redirectDrives,
    driveSelection: overrides.driveSelection ?? defaults.driveSelection,
    sharedLocalFolders: normalizeRdpSharedLocalFolders(
      overrides.sharedLocalFolders ?? defaults.sharedLocalFolders,
      overrides.sharedLocalFolder ?? defaults.sharedLocalFolder,
    ),
    sharedLocalFolder: undefined,
    redirectPrinters: overrides.redirectPrinters ?? defaults.redirectPrinters,
    redirectPorts: overrides.redirectPorts ?? defaults.redirectPorts,
    bitmapCache: overrides.bitmapCache ?? defaults.bitmapCache,
    performanceProfile: overrides.performanceProfile ?? defaults.performanceProfile,
    remoteResolution: overrides.remoteResolution ?? defaults.remoteResolution,
    viewMode: overrides.viewMode ?? defaults.viewMode,
  };
}

function resolveVncOptions(
  defaults: VncSettings,
  overrides?: VncConnectionOptions,
): VncSettings {
  if (!overrides || overrides.inheritDefaults) {
    return defaults;
  }
  return {
    sharedSession: overrides.sharedSession ?? defaults.sharedSession,
    viewOnly: overrides.viewOnly ?? defaults.viewOnly,
    colorLevel: overrides.colorLevel ?? defaults.colorLevel,
    preferredEncoding: overrides.preferredEncoding ?? defaults.preferredEncoding,
    performancePreset: overrides.performancePreset ?? defaults.performancePreset,
    compressionLevel: overrides.compressionLevel ?? defaults.compressionLevel,
    jpegQuality: overrides.jpegQuality ?? defaults.jpegQuality,
    jpegEnabled: overrides.jpegEnabled ?? defaults.jpegEnabled,
    viewMode: overrides.viewMode ?? defaults.viewMode,
  };
}

function resolveRemoteDesktopViewMode(
  connection: Connection | undefined,
  rdpSettings: RdpSettings,
  vncSettings: VncSettings,
): RemoteDesktopViewMode {
  if (connection?.type === "rdp") {
    return resolveRdpOptions(rdpSettings, connection.rdpOptions).viewMode;
  }
  if (connection?.type === "vnc") {
    return resolveVncOptions(vncSettings, connection.vncOptions).viewMode;
  }
  return "fit";
}

function remoteDesktopViewModeOptions(t: TFunction) {
  return [
    { value: "fit" as const, label: t("settings.remoteDesktopViewModeFit") },
    { value: "stretch" as const, label: t("settings.remoteDesktopViewModeStretch") },
    { value: "actualSize" as const, label: t("settings.remoteDesktopViewModeActualSize") },
    { value: "fitWidth" as const, label: t("settings.remoteDesktopViewModeFitWidth") },
    { value: "fitHeight" as const, label: t("settings.remoteDesktopViewModeFitHeight") },
  ];
}

function viewModeLabel(t: TFunction, viewMode: RemoteDesktopViewMode) {
  return remoteDesktopViewModeOptions(t).find((option) => option.value === viewMode)?.label ??
    t("settings.remoteDesktopViewModeFit");
}

function rdpResolutionForViewMode(
  viewMode: RemoteDesktopViewMode,
  currentResolution: RdpSettings["remoteResolution"],
): RdpSettings["remoteResolution"] {
  if (viewMode === "fit") {
    return "automatic";
  }
  if (viewMode === "stretch") {
    return "smartSizing";
  }
  if (viewMode === "actualSize") {
    return "dpiZoom";
  }
  return currentResolution;
}

function connectionUpdateRequest(connection: Connection) {
  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    user: connection.user,
    type: connection.type,
    port: connection.port,
    keyPath: connection.keyPath,
    proxyJump: connection.proxyJump,
    authMethod: connection.authMethod,
    localShell: connection.localShell,
    localStartupDirectory: connection.localStartupDirectory,
    localStartupScript: connection.localStartupScript,
    serialLine: connection.serialLine,
    serialSpeed: connection.serialSpeed,
    url: connection.url,
    dataPartition: connection.dataPartition,
    useTmuxSessions: connection.useTmuxSessions,
    rdpOptions: connection.rdpOptions,
    vncOptions: connection.vncOptions,
    ftpOptions: connection.ftpOptions,
  };
}

function normalizeRemoteDesktopKeyName(value: string) {
  return value
    .split("")
    .filter((char) => /[a-zA-Z0-9]/.test(char))
    .join("")
    .toLowerCase();
}

function vncKeysymForName(value: string) {
  const keysyms: Record<string, number> = {
    enter: 0xff0d,
    return: 0xff0d,
    tab: 0xff09,
    escape: 0xff1b,
    esc: 0xff1b,
    backspace: 0xff08,
    delete: 0xffff,
    del: 0xffff,
    arrowleft: 0xff51,
    left: 0xff51,
    arrowup: 0xff52,
    up: 0xff52,
    arrowright: 0xff53,
    right: 0xff53,
    arrowdown: 0xff54,
    down: 0xff54,
    home: 0xff50,
    pageup: 0xff55,
    pgup: 0xff55,
    pagedown: 0xff56,
    pgdn: 0xff56,
    end: 0xff57,
    space: 0x20,
  };
  const key = keysyms[normalizeRemoteDesktopKeyName(value)];
  if (!key) {
    throw new Error(`Unsupported VNC key press: ${value}`);
  }
  return key;
}

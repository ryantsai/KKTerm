// Shared VNC surface logic used by both the embedded Pane
// (`RemoteDesktopWorkspace`) and the detached full-screen window
// (`RemoteFullscreenApp`). It owns only framebuffer painting, coordinate
// mapping, and input encoding — never the Session lifecycle. A detached window
// attaches to an already-running Session by id: VNC events emit app-wide, and
// `refresh_vnc_session` forces a full framebuffer so a late attacher repaints.

import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from "react";
import { invokeCommand, isTauriRuntime, logUiDebug } from "../../../../lib/tauri";
import type { RemoteDesktopViewMode } from "../../../../types";
import { isCurrentVncFrame, parseVncFrameBatch, type VncFrameOperation } from "./vncFrame";

export type VncSessionEvent =
  | { kind: "connected"; sessionId: string; name: string }
  | { kind: "resolution"; sessionId: string; width: number; height: number }
  | {
      kind: "frameAvailable";
      sessionId: string;
      frameId: number;
      width: number;
      height: number;
      payloadBytes: number;
      operationCount: number;
      wireBytes: number;
      decodeMicros: number;
      bridgeMicros: number;
      rectangles: number;
      rawRectangles: number;
      copyRectangles: number;
      tightRectangles: number;
      zrleRectangles: number;
      trleRectangles: number;
      cursorRectangles: number;
      desktopSizeRectangles: number;
    }
  | { kind: "bell"; sessionId: string }
  | {
      kind: "setCursor";
      sessionId: string;
      width: number;
      height: number;
      hotX: number;
      hotY: number;
      rgba: string;
    }
  | { kind: "clipboardText"; sessionId: string; text: string }
  | { kind: "error"; sessionId: string; message: string }
  | { kind: "disconnected"; sessionId: string };

export const VNC_FULLSCREEN_SURFACE_EVENT = "kkterm://vnc-fullscreen-surface";

export type VncFullscreenSurfaceEvent = {
  sessionId: string;
  active: boolean;
};

export function decodeBase64Bytes(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function pointerButtonMask(button: number) {
  if (button === 1) {
    return 2;
  }
  if (button === 2) {
    return 4;
  }
  return 1;
}

export function vncKeysymForEvent(event: ReactKeyboardEvent<HTMLCanvasElement>) {
  if (event.key.length === 1) {
    return event.key.charCodeAt(0);
  }
  const specialKeys: Record<string, number> = {
    Backspace: 0xff08,
    Tab: 0xff09,
    Enter: 0xff0d,
    Escape: 0xff1b,
    Delete: 0xffff,
    Home: 0xff50,
    ArrowLeft: 0xff51,
    ArrowUp: 0xff52,
    ArrowRight: 0xff53,
    ArrowDown: 0xff54,
    PageUp: 0xff55,
    PageDown: 0xff56,
    End: 0xff57,
    Insert: 0xff63,
    Shift: 0xffe1,
    Control: 0xffe3,
    Alt: 0xffe9,
    Meta: 0xffe7,
  };
  return specialKeys[event.key] ?? 0;
}

/** Where the framebuffer is actually drawn inside the canvas box for a view mode. */
export function vncRenderedContentRect(
  rect: DOMRect,
  intrinsicWidth: number,
  intrinsicHeight: number,
  viewMode: RemoteDesktopViewMode,
  allowUpscale = true,
) {
  if (viewMode !== "fit") {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  const width = Math.max(1, intrinsicWidth);
  const height = Math.max(1, intrinsicHeight);
  const containScale = Math.min(rect.width / width, rect.height / height);
  const scale = allowUpscale ? containScale : Math.min(1, containScale);
  const contentWidth = width * scale;
  const contentHeight = height * scale;
  return {
    left: rect.left + (rect.width - contentWidth) / 2,
    top: rect.top + (rect.height - contentHeight) / 2,
    width: contentWidth,
    height: contentHeight,
  };
}

export function resizeVncCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  if (width <= 0 || height <= 0) {
    return;
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

export function paintVncCursor(
  canvas: HTMLCanvasElement,
  event: Extract<VncSessionEvent, { kind: "setCursor" }>,
) {
  if (event.width === 0 || event.height === 0) {
    canvas.style.cursor = "none";
    return;
  }
  const offscreen = document.createElement("canvas");
  offscreen.width = event.width;
  offscreen.height = event.height;
  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    return;
  }
  const bytes = decodeBase64Bytes(event.rgba);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(bytes), event.width, event.height), 0, 0);
  const dataUrl = offscreen.toDataURL("image/png");
  canvas.style.cursor = `url("${dataUrl}") ${event.hotX} ${event.hotY}, default`;
}

type PreparedVncOperation =
  | Exclude<VncFrameOperation, { kind: "jpeg" }>
  | (Extract<VncFrameOperation, { kind: "jpeg" }> & { bitmap: ImageBitmap });

async function prepareVncOperation(operation: VncFrameOperation): Promise<PreparedVncOperation> {
  if (operation.kind !== "jpeg") {
    return operation;
  }
  const jpeg = new Uint8Array(operation.bytes).buffer;
  const bitmap = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
  return { ...operation, bitmap };
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

export async function fetchAndPaintVncFrame(
  canvas: HTMLCanvasElement,
  event: Extract<VncSessionEvent, { kind: "frameAvailable" }>,
  shouldPaint: () => boolean = () => true,
) {
  const noticedAt = performance.now();
  let fetchedAt: number;
  let preparedAt: number;
  let paintedAt: number;
  try {
    const payload = await invokeCommand("read_vnc_frame", {
      request: { sessionId: event.sessionId, frameId: event.frameId },
    });
    fetchedAt = performance.now();
    const batch = parseVncFrameBatch(payload);
    const operations = await Promise.all(batch.operations.map(prepareVncOperation));
    preparedAt = performance.now();
    await nextAnimationFrame();
    if (!shouldPaint()) {
      for (const operation of operations) {
        if (operation.kind === "jpeg") {
          operation.bitmap.close();
        }
      }
      return false;
    }
    resizeVncCanvas(canvas, event.width, event.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("VNC canvas is unavailable.");
    }
    for (const operation of operations) {
      if (operation.kind === "raw") {
        context.putImageData(
          new ImageData(
            new Uint8ClampedArray(operation.bytes),
            operation.width,
            operation.height,
          ),
          operation.x,
          operation.y,
        );
      } else if (operation.kind === "jpeg") {
        context.drawImage(
          operation.bitmap,
          operation.x,
          operation.y,
          operation.width,
          operation.height,
        );
        operation.bitmap.close();
      } else if (operation.width > 0 && operation.height > 0) {
        const imageData = context.getImageData(
          operation.sourceX,
          operation.sourceY,
          operation.width,
          operation.height,
        );
        context.putImageData(imageData, operation.x, operation.y);
      }
    }
    paintedAt = performance.now();
    logUiDebug("vnc.frame", {
      sessionId: event.sessionId,
      frameId: event.frameId,
      payloadBytes: event.payloadBytes,
      wireBytes: event.wireBytes,
      operationCount: event.operationCount,
      rectangles: event.rectangles,
      encodings: {
        raw: event.rawRectangles,
        copy: event.copyRectangles,
        tight: event.tightRectangles,
        zrle: event.zrleRectangles,
        trle: event.trleRectangles,
        cursor: event.cursorRectangles,
        desktopSize: event.desktopSizeRectangles,
      },
      timingsMs: {
        backendDecode: event.decodeMicros / 1000,
        backendBridge: event.bridgeMicros / 1000,
        binaryFetch: fetchedAt - noticedAt,
        jpegDecode: preparedAt - fetchedAt,
        paint: paintedAt - preparedAt,
        noticeToPaint: paintedAt - noticedAt,
      },
    });
    return operations.length > 0;
  } finally {
    await invokeCommand("acknowledge_vnc_frame", {
      request: { sessionId: event.sessionId, frameId: event.frameId },
    }).catch(() => undefined);
  }
}

/** Map a pointer event to remote framebuffer pixel coordinates. */
export function vncPointForEvent(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  viewMode: RemoteDesktopViewMode,
  allowUpscale = true,
) {
  const rect = canvas.getBoundingClientRect();
  const content = vncRenderedContentRect(
    rect,
    canvas.width,
    canvas.height,
    viewMode,
    allowUpscale,
  );
  const scaleX = canvas.width / Math.max(1, content.width);
  const scaleY = canvas.height / Math.max(1, content.height);
  return {
    x: Math.max(0, Math.min(canvas.width - 1, Math.round((clientX - content.left) * scaleX))),
    y: Math.max(0, Math.min(canvas.height - 1, Math.round((clientY - content.top) * scaleY))),
  };
}

export type VncSurfaceHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onWheel: (event: ReactWheelEvent<HTMLCanvasElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLCanvasElement>) => void;
  onKeyUp: (event: ReactKeyboardEvent<HTMLCanvasElement>) => void;
};

/**
 * Attach to a running VNC Session by id and drive a canvas: paint framebuffer
 * events and encode pointer/keyboard input. Self-contained — used by the
 * detached full-screen host. On mount it requests a full framebuffer so a late
 * attacher sees the current screen instead of waiting for the next delta.
 */
export function useVncSurface(options: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  sessionId: string;
  viewMode: RemoteDesktopViewMode;
  allowUpscale?: boolean;
  enabled: boolean;
  onError?: (message: string) => void;
  onDisconnected?: () => void;
}): { hasDisplay: boolean; handlers: VncSurfaceHandlers } {
  const {
    canvasRef,
    sessionId,
    viewMode,
    allowUpscale = true,
    enabled,
    onError,
    onDisconnected,
  } = options;
  const [hasDisplay, setHasDisplay] = useState(false);
  const buttonMaskRef = useRef(0);
  const pendingPointerRef = useRef<{ x: number; y: number; buttonMask: number } | null>(null);
  const pointerRafRef = useRef<number | null>(null);
  const frameChainRef = useRef(Promise.resolve());
  const frameGenerationRef = useRef(0);
  const viewModeRef = useRef(viewMode);
  const allowUpscaleRef = useRef(allowUpscale);
  const onErrorRef = useRef(onError);
  const onDisconnectedRef = useRef(onDisconnected);
  viewModeRef.current = viewMode;
  allowUpscaleRef.current = allowUpscale;
  onErrorRef.current = onError;
  onDisconnectedRef.current = onDisconnected;

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let dispose: (() => void) | undefined;
    const frameGeneration = ++frameGenerationRef.current;
    void listen<VncSessionEvent>("vnc-session-event", (event) => {
      if (disposed || event.payload.sessionId !== sessionId) {
        return;
      }
      const canvas = canvasRef.current;
      const payload = event.payload;
      if (payload.kind === "resolution") {
        if (canvas) {
          resizeVncCanvas(canvas, payload.width, payload.height);
        }
        setHasDisplay(false);
      } else if (payload.kind === "frameAvailable") {
        frameChainRef.current = frameChainRef.current
          .then(async () => {
            const target = canvasRef.current;
            if (!disposed && target) {
              const painted = await fetchAndPaintVncFrame(target, payload, () =>
                isCurrentVncFrame(
                  !disposed,
                  sessionId,
                  payload.sessionId,
                  frameGenerationRef.current,
                  frameGeneration,
                ),
              );
              if (painted) {
                setHasDisplay(true);
              }
            } else {
              await invokeCommand("acknowledge_vnc_frame", {
                request: { sessionId: payload.sessionId, frameId: payload.frameId },
              }).catch(() => undefined);
            }
          })
          .catch((error) => onErrorRef.current?.(error instanceof Error ? error.message : String(error)));
      } else if (payload.kind === "setCursor") {
        if (canvas) {
          paintVncCursor(canvas, payload);
        }
      } else if (payload.kind === "error") {
        onErrorRef.current?.(payload.message);
      } else if (payload.kind === "disconnected") {
        frameGenerationRef.current += 1;
        if (canvas) {
          canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        }
        setHasDisplay(false);
        onDisconnectedRef.current?.();
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      dispose = unlisten;
      // Force a full framebuffer so this newly-attached surface repaints now.
      void invokeCommand("refresh_vnc_session", { request: { sessionId } }).catch(() => undefined);
    });
    return () => {
      disposed = true;
      frameGenerationRef.current += 1;
      dispose?.();
    };
  }, [enabled, sessionId, canvasRef]);

  const flushPointer = () => {
    pointerRafRef.current = null;
    const pending = pendingPointerRef.current;
    if (!pending) {
      return;
    }
    pendingPointerRef.current = null;
    void invokeCommand("send_vnc_pointer_event", {
      request: { sessionId, ...pending, coalescible: true },
    }).catch(
      (error) => onError?.(error instanceof Error ? error.message : String(error)),
    );
  };

  const queuePointer = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    buttonMask: number,
    immediate: boolean,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const point = vncPointForEvent(
      canvas,
      event.clientX,
      event.clientY,
      viewModeRef.current,
      allowUpscaleRef.current,
    );
    pendingPointerRef.current = { x: point.x, y: point.y, buttonMask };
    if (immediate) {
      if (pointerRafRef.current !== null) {
        window.cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = null;
      }
      const pending = pendingPointerRef.current;
      if (pending) {
        pendingPointerRef.current = null;
        void invokeCommand("send_vnc_pointer_event", {
          request: { sessionId, ...pending, coalescible: false },
        }).catch((error) => onError?.(error instanceof Error ? error.message : String(error)));
      }
      return;
    }
    if (pointerRafRef.current === null) {
      pointerRafRef.current = window.requestAnimationFrame(flushPointer);
    }
  };

  const handlers: VncSurfaceHandlers = {
    onPointerDown: (event) => {
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      buttonMaskRef.current = pointerButtonMask(event.button);
      queuePointer(event, buttonMaskRef.current, true);
    },
    onPointerMove: (event) => {
      queuePointer(event, buttonMaskRef.current, false);
    },
    onPointerUp: (event) => {
      buttonMaskRef.current = 0;
      queuePointer(event, 0, true);
    },
    onWheel: (event) => {
      event.preventDefault();
      const pointerEvent = event as unknown as ReactPointerEvent<HTMLCanvasElement>;
      const wheelMask = event.deltaY < 0 ? 8 : 16;
      queuePointer(pointerEvent, wheelMask, true);
      window.setTimeout(() => queuePointer(pointerEvent, 0, true), 20);
    },
    onKeyDown: (event) => {
      const key = vncKeysymForEvent(event);
      if (!key) {
        return;
      }
      event.preventDefault();
      void invokeCommand("send_vnc_key_event", {
        request: { sessionId, key, down: true },
      }).catch((error) => onError?.(error instanceof Error ? error.message : String(error)));
    },
    onKeyUp: (event) => {
      const key = vncKeysymForEvent(event);
      if (!key) {
        return;
      }
      event.preventDefault();
      void invokeCommand("send_vnc_key_event", {
        request: { sessionId, key, down: false },
      }).catch((error) => onError?.(error instanceof Error ? error.message : String(error)));
    },
  };

  return { hasDisplay, handlers };
}

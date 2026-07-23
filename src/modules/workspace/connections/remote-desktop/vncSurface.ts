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
import { invokeCommand, isTauriRuntime } from "../../../../lib/tauri";
import type { RemoteDesktopViewMode } from "../../../../types";

export type VncSessionEvent =
  | { kind: "connected"; sessionId: string; name: string }
  | { kind: "resolution"; sessionId: string; width: number; height: number }
  | {
      kind: "rawImage";
      sessionId: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rgba: string;
    }
  | {
      kind: "copy";
      sessionId: string;
      x: number;
      y: number;
      width: number;
      height: number;
      sourceX: number;
      sourceY: number;
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
) {
  if (viewMode !== "fit") {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  const width = Math.max(1, intrinsicWidth);
  const height = Math.max(1, intrinsicHeight);
  const boxAspect = rect.width / Math.max(1, rect.height);
  const contentAspect = width / height;
  if (contentAspect > boxAspect) {
    const contentHeight = rect.width / contentAspect;
    return {
      left: rect.left,
      top: rect.top + (rect.height - contentHeight) / 2,
      width: rect.width,
      height: contentHeight,
    };
  }
  const contentWidth = rect.height * contentAspect;
  return {
    left: rect.left + (rect.width - contentWidth) / 2,
    top: rect.top,
    width: contentWidth,
    height: rect.height,
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

export function paintVncRawImage(
  canvas: HTMLCanvasElement,
  event: Extract<VncSessionEvent, { kind: "rawImage" }>,
) {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  if (canvas.width < event.x + event.width || canvas.height < event.y + event.height) {
    resizeVncCanvas(
      canvas,
      Math.max(canvas.width, event.x + event.width),
      Math.max(canvas.height, event.y + event.height),
    );
  }
  const imageData = new ImageData(
    new Uint8ClampedArray(decodeBase64Bytes(event.rgba)),
    event.width,
    event.height,
  );
  context.putImageData(imageData, event.x, event.y);
}

export function paintVncCopy(
  canvas: HTMLCanvasElement,
  event: Extract<VncSessionEvent, { kind: "copy" }>,
) {
  const context = canvas.getContext("2d");
  if (!context || event.width <= 0 || event.height <= 0) {
    return;
  }
  const imageData = context.getImageData(event.sourceX, event.sourceY, event.width, event.height);
  context.putImageData(imageData, event.x, event.y);
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

/** Map a pointer event to remote framebuffer pixel coordinates. */
export function vncPointForEvent(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  viewMode: RemoteDesktopViewMode,
) {
  const rect = canvas.getBoundingClientRect();
  const content = vncRenderedContentRect(rect, canvas.width, canvas.height, viewMode);
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
  enabled: boolean;
  onError?: (message: string) => void;
  onDisconnected?: () => void;
}): { hasDisplay: boolean; handlers: VncSurfaceHandlers } {
  const { canvasRef, sessionId, viewMode, enabled, onError, onDisconnected } = options;
  const [hasDisplay, setHasDisplay] = useState(false);
  const buttonMaskRef = useRef(0);
  const pendingPointerRef = useRef<{ x: number; y: number; buttonMask: number } | null>(null);
  const pointerRafRef = useRef<number | null>(null);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let dispose: (() => void) | undefined;
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
        setHasDisplay(true);
      } else if (payload.kind === "rawImage") {
        if (canvas) {
          paintVncRawImage(canvas, payload);
        }
        setHasDisplay(true);
      } else if (payload.kind === "copy") {
        if (canvas) {
          paintVncCopy(canvas, payload);
        }
      } else if (payload.kind === "setCursor") {
        if (canvas) {
          paintVncCursor(canvas, payload);
        }
      } else if (payload.kind === "error") {
        onError?.(payload.message);
      } else if (payload.kind === "disconnected") {
        onDisconnected?.();
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
      dispose?.();
    };
  }, [enabled, sessionId, canvasRef, onError, onDisconnected]);

  const flushPointer = () => {
    pointerRafRef.current = null;
    const pending = pendingPointerRef.current;
    if (!pending) {
      return;
    }
    pendingPointerRef.current = null;
    void invokeCommand("send_vnc_pointer_event", { request: { sessionId, ...pending } }).catch(
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
    const point = vncPointForEvent(canvas, event.clientX, event.clientY, viewModeRef.current);
    pendingPointerRef.current = { x: point.x, y: point.y, buttonMask };
    if (immediate) {
      if (pointerRafRef.current !== null) {
        window.cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = null;
      }
      flushPointer();
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

// Self-contained macOS/Linux RDP view: renders the IronRDP framebuffer to a <canvas>
// and sends mouse + hybrid keyboard input. Kept independent of the VNC/Windows
// ActiveX paths in RemoteDesktopWorkspace so neither is affected.
//
// Keyboard model (see research in the IronRDP/RDP keyboard notes):
//   - Printable text, including IME composition, dead keys and accents, is sent
//     as RDP Unicode keyboard events via `send_rdp_client_text` (the local OS/IME
//     composes; the final characters are layout-independent).
//   - Control / navigation / modifier keys and Ctrl/Alt/Meta shortcuts are sent
//     as scancodes via `send_rdp_client_key_event`.

import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { writeToClipboard } from "../../../../lib/clipboard";
import { isMacPlatform } from "../../../../lib/platform";
import { invokeCommand, isTauriRuntime, logUiDebug } from "../../../../lib/tauri";
import type { Connection, RdpSettings } from "../../../../types";
import { connectionPasswordOwnerId } from "../utils";
import { isCharacterCode, scancodeForCode } from "./rdpScancodes";

type RdpCanvasEvent =
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
      kind: "setCursor";
      sessionId: string;
      width: number;
      height: number;
      hotX: number;
      hotY: number;
      rgba: string;
    }
  | { kind: "error"; sessionId: string; message: string }
  | { kind: "disconnected"; sessionId: string }
  | { kind: "clipboardText"; sessionId: string; text: string };

function isMetaKeyCode(code: string): boolean {
  return code === "MetaLeft" || code === "MetaRight";
}

function pointerButtonBit(button: number, ctrlKey: boolean): number {
  if (button === 2 || (button === 0 && ctrlKey && isMacPlatform())) {
    return 2;
  }
  if (button === 1) {
    return 1;
  }
  return button === 0 ? 0 : -1;
}

function createRdpSessionId() {
  return `rdp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function RdpCanvasView({
  cadSignal = 0,
  connection,
  onSessionConnected,
  onSessionDisconnected,
  rdpOptions,
  surfaceRef,
  attachSessionId,
}: {
  cadSignal?: number;
  // Required to START a session (pane path). Omitted in attach mode, where the
  // detached full-screen window renders an already-running session by id.
  connection?: Connection;
  onSessionConnected?: (sessionId: string) => void;
  onSessionDisconnected?: (sessionId: string) => void;
  rdpOptions?: RdpSettings;
  surfaceRef?: RefObject<HTMLCanvasElement | null>;
  /** When set, attach to this live session instead of starting a new one. */
  attachSessionId?: string;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const buttonMaskRef = useRef(0);
  const composingRef = useRef(false);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const sharedLocalFoldersKey = (rdpOptions?.sharedLocalFolders ?? []).join("\u0000");

  const focusInput = useCallback((reason: string) => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    logUiDebug("rdp.canvas.focus", {
      reason,
      sessionId: sessionIdRef.current,
      documentHasFocus: document.hasFocus(),
      activeElement: document.activeElement?.tagName.toLowerCase() ?? null,
      inputFocused: document.activeElement === input,
    });
  }, []);

  // Session lifecycle + framebuffer rendering.
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let reportedConnected = false;
    // Attach mode reuses a live session started elsewhere (the Pane); it never
    // starts or closes the backend session, only renders + forwards input.
    const sessionId = attachSessionId ?? createRdpSessionId();
    sessionIdRef.current = sessionId;
    setStatus(attachSessionId ? "connected" : "connecting");
    setErrorMessage("");

    const reportConnected = () => {
      if (reportedConnected) {
        return;
      }
      reportedConnected = true;
      onSessionConnected?.(sessionId);
    };

    const reportDisconnected = () => {
      if (!reportedConnected) {
        return;
      }
      reportedConnected = false;
      onSessionDisconnected?.(sessionId);
    };

    const draw = (event: RdpCanvasEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      if (event.kind === "resolution") {
        canvas.width = event.width;
        canvas.height = event.height;
        return;
      }
      if (event.kind === "rawImage") {
        if (event.width === 0 || event.height === 0) {
          return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return;
        }
        const bytes = base64ToBytes(event.rgba);
        const expected = event.width * event.height * 4;
        if (bytes.length < expected) {
          return;
        }
        const clamped = new Uint8ClampedArray(expected);
        clamped.set(bytes.subarray(0, expected));
        const image = new ImageData(clamped, event.width, event.height);
        ctx.putImageData(image, event.x, event.y);
      }
    };

    void listen<RdpCanvasEvent>("rdp-canvas-event", (event) => {
      if (disposed || event.payload.sessionId !== sessionIdRef.current) {
        return;
      }
      const payload = event.payload;
      switch (payload.kind) {
        case "connected":
          setStatus("connected");
          reportConnected();
          break;
        case "error":
          setErrorMessage(payload.message);
          reportDisconnected();
          break;
        case "disconnected":
          setStatus("disconnected");
          reportDisconnected();
          break;
        case "clipboardText":
          void writeToClipboard(payload.text).catch(() => undefined);
          break;
        default:
          draw(payload);
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    if (attachSessionId) {
      reportConnected();
      // Force a full-frame repaint so the detached window shows the current
      // screen immediately instead of waiting for server deltas.
      void invokeCommand("refresh_rdp_client_session", {
        request: { sessionId: attachSessionId },
      }).catch(() => undefined);
    } else if (connection && rdpOptions) {
      void invokeCommand("start_rdp_client_session", {
        request: {
          sessionId,
          host: connection.host,
          port: connection.port,
          username: connection.user ?? "",
          secretOwnerId: connectionPasswordOwnerId(connection),
          administrativeSession: rdpOptions.administrativeSession,
          sharedLocalFolders: rdpOptions.redirectDrives ? rdpOptions.sharedLocalFolders : undefined,
        },
      }).catch((error) => {
        if (!disposed) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
          setStatus("disconnected");
          reportDisconnected();
        }
      });
    }

    return () => {
      disposed = true;
      reportDisconnected();
      unlisten?.();
      // Never close a session we merely attached to — the Pane owns its lifecycle.
      if (!attachSessionId) {
        void invokeCommand("close_rdp_client_session", { request: { sessionId } }).catch(() => undefined);
      }
      sessionIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    attachSessionId,
    connection?.id,
    connection?.host,
    connection?.port,
    connection?.user,
    rdpOptions?.administrativeSession,
    rdpOptions?.redirectDrives,
    sharedLocalFoldersKey,
  ]);

  // ── Mouse ──────────────────────────────────────────────────────────────────
  const remotePoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round(((clientX - rect.left) / rect.width) * canvas.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.round(((clientY - rect.top) / rect.height) * canvas.height)));
    return { x, y };
  };

  const sendPointer = (clientX: number, clientY: number, buttonMask: number) => {
    const sessionId = sessionIdRef.current;
    const point = remotePoint(clientX, clientY);
    if (!sessionId || !point) {
      return;
    }
    void invokeCommand("send_rdp_client_pointer_event", {
      request: { sessionId, x: point.x, y: point.y, buttonMask },
    }).catch(() => undefined);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    sendPointer(e.clientX, e.clientY, buttonMaskRef.current);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // WKWebView can apply the canvas's default pointer focus after this handler
    // and immediately blur the hidden IME input. Cancel that default transition
    // so keyboard and composition events stay routed to the input we focus here.
    e.preventDefault();
    focusInput("pointerdown");
    const bit = pointerButtonBit(e.button, e.ctrlKey);
    if (bit >= 0) {
      buttonMaskRef.current |= 1 << bit;
    }
    sendPointer(e.clientX, e.clientY, buttonMaskRef.current);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const bit = pointerButtonBit(e.button, e.ctrlKey);
    if (bit >= 0) {
      buttonMaskRef.current &= ~(1 << bit);
    }
    sendPointer(e.clientX, e.clientY, buttonMaskRef.current);
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    // Bit 3 = wheel up, bit 4 = wheel down (momentary, matching the backend).
    const wheelBit = e.deltaY < 0 ? 1 << 3 : 1 << 4;
    sendPointer(e.clientX, e.clientY, buttonMaskRef.current | wheelBit);
  };

  // ── Keyboard ────────────────────────────────────────────────────────────────
  const sendScancode = (scancode: number, down: boolean) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      return;
    }
    void invokeCommand("send_rdp_client_key_event", {
      request: { sessionId, scancode, down },
    }).catch(() => undefined);
  };

  const sendText = (text: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || text.length === 0) {
      return;
    }
    void invokeCommand("send_rdp_client_text", { request: { sessionId, text } }).catch(() => undefined);
  };

  const sendClipboardText = (text: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || text.length === 0) {
      return Promise.resolve();
    }
    return invokeCommand("send_rdp_client_clipboard_text", { request: { sessionId, text } }).catch(() => undefined);
  };

  const sendRemotePasteChord = () => {
    const ctrlScancode = scancodeForCode("ControlLeft");
    const vScancode = scancodeForCode("KeyV");
    if (ctrlScancode === undefined || vScancode === undefined) {
      return;
    }
    sendScancode(ctrlScancode, true);
    sendScancode(vScancode, true);
    sendScancode(vScancode, false);
    sendScancode(ctrlScancode, false);
  };

  const pasteNativeMacClipboard = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      return;
    }
    void invokeCommand("paste_rdp_client_clipboard", { request: { sessionId } }).catch(() => undefined);
  };

  // Refresh CLIPRDR with trusted paste-event text before sending remote Ctrl+V.
  // Reading ClipboardEvent data avoids WKWebView's async clipboard permission
  // boundary.
  const pasteClipboardText = (text: string) => {
    if (!text) {
      return;
    }
    void sendClipboardText(text)
      .then(() => sendRemotePasteChord())
      .catch(() => undefined);
  };

  const setCanvasRef = (node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    if (surfaceRef) {
      surfaceRef.current = node;
    }
  };

  const sendCtrlAltDelete = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      return;
    }
    void invokeCommand("send_rdp_client_ctrl_alt_delete", { request: { sessionId } }).catch(() => undefined);
    focusInput("ctrl-alt-delete");
  }, [focusInput]);

  useEffect(() => {
    if (cadSignal === 0) {
      return;
    }
    sendCtrlAltDelete();
  }, [cadSignal, sendCtrlAltDelete]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    logUiDebug("rdp.canvas.key", {
      sessionId: sessionIdRef.current,
      code: e.code,
      key: e.key,
      composing: composingRef.current,
      documentHasFocus: document.hasFocus(),
    });
    if (composingRef.current || e.key === "Process") {
      return; // IME is composing — let composition events handle it.
    }
    // Let the focused IME input produce a trusted paste event. `onPaste` reads
    // its clipboardData, refreshes CLIPRDR, and sends remote Ctrl+V. The key is
    // not forwarded as a raw scancode, so no bare remote V can leak through.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyV") {
      if (isMacPlatform()) {
        e.preventDefault();
        pasteNativeMacClipboard();
      }
      return;
    }
    const shortcut = e.ctrlKey || e.altKey || e.metaKey;
    const isText = isCharacterCode(e.code);
    if (isText && !shortcut) {
      return; // Plain printable key → handled by the Unicode/input path below.
    }
    if (isMetaKeyCode(e.code)) {
      return; // Cmd/Super is a local modifier here; forwarding it just taps the remote Start menu.
    }
    const scancode = scancodeForCode(e.code);
    if (scancode !== undefined) {
      e.preventDefault();
      sendScancode(scancode, true);
    }
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current) {
      return;
    }
    // Matches the paste interception in onKeyDown: swallow the "V" release so it
    // is not forwarded as a lone scancode after the clipboard was replayed.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyV") {
      e.preventDefault();
      return;
    }
    const shortcut = e.ctrlKey || e.altKey || e.metaKey;
    const isText = isCharacterCode(e.code);
    if (isText && !shortcut) {
      return;
    }
    if (isMetaKeyCode(e.code)) {
      return; // See onKeyDown: the Cmd/Super modifier is not forwarded to the remote.
    }
    const scancode = scancodeForCode(e.code);
    if (scancode !== undefined) {
      e.preventDefault();
      sendScancode(scancode, false);
    }
  };

  const onCompositionStart = () => {
    composingRef.current = true;
  };
  const onCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    if (e.data) {
      sendText(e.data);
    }
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };
  const onInput = (e: React.FormEvent<HTMLInputElement>) => {
    if (composingRef.current) {
      return; // wait for compositionend
    }
    const native = e.nativeEvent as InputEvent;
    if (native.inputType === "insertText" && native.data) {
      sendText(native.data);
    }
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    pasteClipboardText(e.clipboardData.getData("text/plain"));
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };
  const preventLocalContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
  };

  const statusText =
    status === "connecting"
      ? t("remoteDesktop.connecting")
      : status === "disconnected"
        ? t("remoteDesktop.disconnected")
        : "";

  return (
    <div className="rdp-canvas-view">
      <canvas
        ref={setCanvasRef}
        className="rdp-canvas-surface"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={preventLocalContextMenu}
        draggable={false}
      />
      {/* Visually-hidden focus target that captures IME composition + text input. */}
      <input
        ref={inputRef}
        className="rdp-canvas-ime-input"
        aria-label={t("remoteDesktop.displayAria")}
        title={t("remoteDesktop.displayAria")}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onContextMenu={preventLocalContextMenu}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onInput={onInput}
        onPaste={onPaste}
        onCompositionStart={onCompositionStart}
        onCompositionUpdate={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
      {(statusText || errorMessage) && (
        <div className="rdp-canvas-status">{errorMessage || statusText}</div>
      )}
    </div>
  );
}

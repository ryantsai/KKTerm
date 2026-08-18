import { ScreenshotMenu } from "../../ScreenshotMenu";
import { documentHasWebviewBlockingOverlay } from "../../nativeOverlay";

import { ArrowLeft, ArrowRight, Bot, Download, ExternalLink, Floppy, Globe2, KeyRound, Lock, RefreshCw, Unlock, X } from "../../../../lib/reicon";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { resolveAppliedColorScheme } from "../../../../app/appShellEffects";
import { writeToClipboard } from "../../../../lib/clipboard";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import { showNativeContextMenu } from "../../../../lib/nativeContextMenu";
import { nativeMenuIcons } from "../../../../lib/nativeMenuIcons";
import {
  invokeCommand,
  isTauriRuntime,
  logUrlConnectionDebug,
  openFilesystemPath,
  openExternalUrl,
  selectPngSavePath,
  writeDataUrlFile,
} from "../../../../lib/tauri";
import type { AssistantScreenshot, WebviewSessionStarted } from "../../../../lib/tauri";
import { useWorkspaceStore } from "../../../../store";
import {
  registerWebviewController,
  unregisterWebviewController,
  type WebviewController,
} from "../../paneRegistry";
import { urlCredentialSecretOwnerId } from "./urlCredentialKeys";
import { resolveUrlDataPartition, resolveUrlProxy, resolveUrlUserAgent } from "./urlProxy";
import type { WorkspaceTab } from "../../../../types";
import { NoteToolbarButton } from "../../../notes/NoteToolbarButton";

type WebviewNavigationEvent = {
  sessionId: string;
  url: string;
};

type WebviewPageLoadEvent = {
  sessionId: string;
  url: string;
  status: "started" | "finished" | "unknown";
};

type WebviewCertificateErrorEvent = {
  sessionId: string;
};

type WebviewTitleChangedEvent = {
  sessionId: string;
  title: string;
};

type WebviewNewWindowEvent = {
  sessionId: string;
  url: string;
};

type WebviewDownloadEvent = {
  sessionId: string;
  url: string;
  status: "requested" | "finished" | "unknown";
  path?: string;
  success?: boolean;
};

type WebviewDownload = {
  id: number;
  url: string;
  path?: string;
  status: "downloading" | "complete" | "failed";
};

interface WebviewSessionLease {
  promise: Promise<WebviewSessionStarted>;
  refCount: number;
  closeTimer: number | null;
  started: boolean;
  closed: boolean;
}

const webviewSessionLeases = new Map<string, WebviewSessionLease>();
const HIDDEN_WEBVIEW_BOUNDS = { x: 0, y: 0, width: 1, height: 1 };
// The overlay's native window handle is realized asynchronously by the event loop, so the
// very first show after a session starts can race ahead of it and fail with "the underlying
// handle is not available". Retrying the show across a few short delays lets the loop catch up.
const WEBVIEW_HANDLE_NOT_READY_PATTERN = /handle is not available|webview hwnd|failed to realize/i;
const WEBVIEW_SHOW_RETRY_DELAYS_MS = [80, 160, 320, 640, 1000];

function acquireWebviewSession(sessionId: string, start: () => Promise<WebviewSessionStarted>) {
  const current = webviewSessionLeases.get(sessionId);
  if (current && !current.closed) {
    if (current.closeTimer !== null) {
      window.clearTimeout(current.closeTimer);
      current.closeTimer = null;
    }
    current.refCount += 1;
    return current;
  }

  const promise = Promise.resolve()
    .then(start)
    .then((started) => {
      lease.started = true;
      return started;
    });
  const lease: WebviewSessionLease = {
    promise,
    refCount: 1,
    closeTimer: null,
    started: false,
    closed: false,
  };
  promise.catch(() => {
    if (webviewSessionLeases.get(sessionId) === lease) {
      webviewSessionLeases.delete(sessionId);
    }
  });
  webviewSessionLeases.set(sessionId, lease);
  return lease;
}

function releaseLogPayload(sessionId: string, lease?: WebviewSessionLease) {
  return {
    sessionId,
    lease: lease
      ? {
          refCount: lease.refCount,
          started: lease.started,
          closed: lease.closed,
          closeTimerPending: lease.closeTimer !== null,
        }
      : null,
  };
}

function releaseErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function releaseWebviewSession(sessionId: string) {
  const lease = webviewSessionLeases.get(sessionId);
  if (!lease) {
    logUrlConnectionDebug("frontend.session.release.missing", releaseLogPayload(sessionId));
    return;
  }
  logUrlConnectionDebug("frontend.session.release.requested", releaseLogPayload(sessionId, lease));
  lease.refCount = Math.max(0, lease.refCount - 1);
  if (lease.refCount > 0) {
    logUrlConnectionDebug("frontend.session.release.deferred", releaseLogPayload(sessionId, lease));
    return;
  }
  if (lease.closeTimer !== null) {
    window.clearTimeout(lease.closeTimer);
  }
  lease.closeTimer = window.setTimeout(() => {
    if (lease.refCount > 0 || webviewSessionLeases.get(sessionId) !== lease) {
      logUrlConnectionDebug("frontend.session.release.cancelled", releaseLogPayload(sessionId, lease));
      return;
    }
    lease.closed = true;
    void lease.promise
      .then(
        () => {
          logUrlConnectionDebug("frontend.session.release.close_request", releaseLogPayload(sessionId, lease));
          return invokeCommand("close_webview_session", {
            request: { sessionId },
          })
            .then(() => {
              logUrlConnectionDebug("frontend.session.release.closed", releaseLogPayload(sessionId, lease));
            })
            .catch((error) => {
              logUrlConnectionDebug("frontend.session.release.close_error", {
                ...releaseLogPayload(sessionId, lease),
                error: releaseErrorMessage(error),
              });
            });
        },
        (error) => {
          logUrlConnectionDebug("frontend.session.release.start_failed", {
            ...releaseLogPayload(sessionId, lease),
            error: releaseErrorMessage(error),
          });
        },
      )
      .finally(() => {
        if (webviewSessionLeases.get(sessionId) === lease) {
          webviewSessionLeases.delete(sessionId);
          logUrlConnectionDebug("frontend.session.release.removed", releaseLogPayload(sessionId, lease));
        }
      });
  }, 50);
}

type CapturedCredentialPayload = {
  ok: boolean;
  nonce?: string;
  reason?: string;
  url?: string;
  username?: string;
  password?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  fieldValues?: unknown;
};

type WebviewContextMenuPayload = {
  x: number;
  y: number;
  linkUrl?: string;
  selectionText?: string;
};

type WebviewPageCaptureState = {
  nonce: string;
  x: number;
  y: number;
  pageWidth: number;
  pageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  captureWidth: number;
  captureHeight: number;
};

type PendingPageCaptureState = {
  resolve: (state: WebviewPageCaptureState) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

const CREDENTIAL_TITLE_PREFIX = "__KKTERM_URL_CREDENTIAL__";
const EXTERNAL_LINK_TITLE_PREFIX = "__KKTERM_URL_EXTERNAL_LINK__";
const CONTEXT_MENU_TITLE_PREFIX = "__KKTERM_URL_CONTEXT_MENU__";
const PAGE_CAPTURE_TITLE_PREFIX = "__KKTERM_URL_PAGE_CAPTURE__";
const PAGE_CAPTURE_STATE_TIMEOUT_MS = 4000;
const MAX_FULL_PAGE_CANVAS_DIMENSION = 32_767;
const MAX_FULL_PAGE_CANVAS_PIXELS = 100_000_000;
const AUTO_REFRESH_INTERVALS_SECONDS = [0, 5, 15, 30, 60, 120] as const;
const WEBVIEW_PRE_CAPTURE_INTERVAL_MS = 1200;
// A speculative pre-capture is only a faithful stand-in for the live surface for a short
// window. Beyond this, fall back to capturing on-open so an unrelated overlay (e.g. a
// connection dialog) never parks the WebView behind a stale frame from an idle hover.
const WEBVIEW_PRE_CAPTURE_MAX_AGE_MS = 1500;
type AutoRefreshIntervalSeconds = (typeof AUTO_REFRESH_INTERVALS_SECONDS)[number];

function createCredentialCaptureNonce() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createWebviewSessionId() {
  return `webview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function webviewBoundsClipElement(node: HTMLElement) {
  return node.closest(".dashboard-connection-pane, .embedded-workspace-pane, .workspace-canvas");
}

type VisibleClientRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type WebviewBoundsDebugSnapshot = {
  placeholderRect: Record<string, number> | null;
  clipRect: Record<string, number> | null;
  visibleRect: Record<string, number> | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
};

function intersectClientRects(rect: DOMRectReadOnly, clipRect: DOMRectReadOnly): VisibleClientRect | null {
  const left = Math.max(rect.left, clipRect.left);
  const top = Math.max(rect.top, clipRect.top);
  const right = Math.min(rect.right, clipRect.right);
  const bottom = Math.min(rect.bottom, clipRect.bottom);
  if (right <= left || bottom <= top) {
    return null;
  }
  return {
    left,
    top,
    right,
    bottom,
  };
}

function boundsFromVisibleRect(rect: VisibleClientRect) {
  const x = Math.max(0, Math.floor(rect.left));
  const y = Math.max(0, Math.floor(rect.top));
  const right = Math.max(x + 1, Math.ceil(rect.right));
  const bottom = Math.max(y + 1, Math.ceil(rect.bottom));
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function rectDebugSnapshot(rect: DOMRectReadOnly | VisibleClientRect | null): Record<string, number> | null {
  if (!rect) {
    return null;
  }
  const right = rect.right;
  const bottom = rect.bottom;
  return {
    left: rect.left,
    top: rect.top,
    right,
    bottom,
    width: "width" in rect ? rect.width : right - rect.left,
    height: "height" in rect ? rect.height : bottom - rect.top,
  };
}

export function WebViewWorkspace({
  isActive,
  onClose,
  onOpenAssistant = () => undefined,
  tab,
}: {
  isActive: boolean;
  onClose?: () => void;
  onOpenAssistant?: () => void;
  tab: WorkspaceTab;
}) {
  const { t } = useTranslation();
  const appearanceSettings = useWorkspaceStore((state) => state.appearanceSettings);
  const updateWebviewTabMetadata = useWorkspaceStore((state) => state.updateWebviewTabMetadata);
  const openUrlInNewTab = useWorkspaceStore((state) => state.openUrlInNewTab);
  const openNoteEditor = useWorkspaceStore((state) => state.openNoteEditor);
  const refreshOpenConnectionMetadata = useWorkspaceStore((state) => state.refreshOpenConnectionMetadata);
  const markConnectionSessionStarted = useWorkspaceStore((state) => state.markConnectionSessionStarted);
  const markConnectionSessionEnded = useWorkspaceStore((state) => state.markConnectionSessionEnded);
  const urlSettings = useWorkspaceStore((state) => state.urlSettings);
  const ignoreCertificateErrors = urlSettings.ignoreCertificateErrors;
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const setAssistantContextSnippet = useWorkspaceStore((state) => state.setAssistantContextSnippet);
  const submitAssistantContextSnippet = useWorkspaceStore((state) => state.submitAssistantContextSnippet);
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const sessionStartedRef = useRef(false);
  const sessionStartingRef = useRef(false);
  const sessionIdRef = useRef<string>(createWebviewSessionId());
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const lastBoundsDebugRef = useRef<WebviewBoundsDebugSnapshot | null>(null);
  const rafRef = useRef<number | null>(null);
  const suppressionCaptureInFlightRef = useRef(false);
  const preCaptureInFlightRef = useRef(false);
  const preCachedSnapshotRef = useRef<AssistantScreenshot | null>(null);
  const preCachedAtRef = useRef(0);
  const preCaptureLastRef = useRef(0);
  const visibilityRef = useRef({ isActive, suppressed: false });
  const pendingCaptureNonceRef = useRef<string | null>(null);
  const pendingPageCaptureStatesRef = useRef(new Map<string, PendingPageCaptureState>());
  const fullPageCaptureInFlightRef = useRef(false);
  const externalLinkTokenRef = useRef<string | null>(null);
  const downloadFolderRef = useRef<string | null>(null);
  const nextDownloadIdRef = useRef(1);
  const faviconUpdatedRef = useRef(false);
  const connectionSessionCountedRef = useRef(false);
  const credentialRef = useRef({ canFillCredential: false });
  const [navError, setNavError] = useState("");
  const [fillStatus, setFillStatus] = useState("");
  const [addressInput, setAddressInput] = useState(tab.url ?? "");
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewEventsReady, setWebviewEventsReady] = useState(!isTauriRuntime());
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState<AutoRefreshIntervalSeconds>(0);
  const [downloads, setDownloads] = useState<WebviewDownload[]>([]);

  const initialUrl = tab.url ?? "";
  const [hasSavedCredential, setHasSavedCredential] = useState(Boolean(tab.connection?.hasUrlCredential));
  const [webviewSnapshot, setWebviewSnapshot] = useState<AssistantScreenshot | null>(null);
  const canFillCredential = Boolean(hasSavedCredential);

  const markWebviewConnectionStarted = () => {
    if (!tab.connection || connectionSessionCountedRef.current) {
      return;
    }
    connectionSessionCountedRef.current = true;
    markConnectionSessionStarted(tab.connection.id);
  };

  const markWebviewConnectionEnded = () => {
    if (!tab.connection || !connectionSessionCountedRef.current) {
      return;
    }
    connectionSessionCountedRef.current = false;
    markConnectionSessionEnded(tab.connection.id);
  };

  useEffect(() => {
    const invokeSimple = (name: "webview_reload" | "webview_go_back" | "webview_go_forward") => {
      if (!isTauriRuntime() || !sessionStartedRef.current) {
        throw new Error("URL Session is not ready.");
      }
      return invokeCommand(name, {
        request: { sessionId: sessionIdRef.current },
      });
    };
    const controller: WebviewController = {
      navigate: (url) => {
        const nextUrl = url.trim();
        if (!nextUrl) {
          throw new Error("url is required");
        }
        if (!isTauriRuntime() || !sessionStartedRef.current) {
          throw new Error("URL Session is not ready.");
        }
        return invokeCommand("webview_navigate", {
          request: { sessionId: sessionIdRef.current, url: nextUrl },
        });
      },
      reload: () => invokeSimple("webview_reload"),
      goBack: () => invokeSimple("webview_go_back"),
      goForward: () => invokeSimple("webview_go_forward"),
      snapshot: () => ({
        kind: "webview",
        tabId: tab.id,
        connectionId: tab.connection?.id,
        connectionName: tab.connection?.name,
        url: addressInput || initialUrl,
        ready: sessionStartedRef.current,
        webviewReady,
        navError: navError || undefined,
      }),
    };
    registerWebviewController(tab.id, controller);
    return () => unregisterWebviewController(tab.id, controller);
    // Methods read refs at call time; the snapshot follows the current URL/readiness state.
  }, [addressInput, initialUrl, navError, tab.connection?.id, tab.connection?.name, tab.id, webviewReady]);

  useEffect(() => {
    credentialRef.current = {
      canFillCredential,
    };
  }, [canFillCredential]);

  const computeBounds = () => {
    const node = placeholderRef.current;
    if (!node) {
      lastBoundsDebugRef.current = {
        placeholderRect: null,
        clipRect: null,
        visibleRect: null,
        bounds: null,
      };
      return null;
    }
    const rect = node.getBoundingClientRect();
    const clipRect = webviewBoundsClipElement(node)?.getBoundingClientRect();
    const visibleRect = clipRect ? intersectClientRects(rect, clipRect) : rect;
    if (!visibleRect) {
      lastBoundsDebugRef.current = {
        placeholderRect: rectDebugSnapshot(rect),
        clipRect: rectDebugSnapshot(clipRect ?? null),
        visibleRect: null,
        bounds: null,
      };
      return null;
    }
    const bounds = boundsFromVisibleRect(visibleRect);
    lastBoundsDebugRef.current = {
      placeholderRect: rectDebugSnapshot(rect),
      clipRect: rectDebugSnapshot(clipRect ?? null),
      visibleRect: rectDebugSnapshot(visibleRect),
      bounds,
    };
    return bounds;
  };

  const logWebviewBoundsDebug = (event: string, payload: Record<string, unknown> = {}) => {
    logUrlConnectionDebug(event, {
      sessionId: sessionIdRef.current,
      tabId: tab.id,
      connectionId: tab.connection?.id ?? null,
      connectionName: tab.connection?.name ?? null,
      url: urlDebugSnapshot(addressInput || initialUrl),
      isActive: visibilityRef.current.isActive,
      suppressed: visibilityRef.current.suppressed,
      devicePixelRatio: window.devicePixelRatio,
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      boundsDebug: lastBoundsDebugRef.current,
      ...payload,
    });
  };

  const requestWebviewVisibility = (
    request: { sessionId: string; visible: boolean; x: number; y: number; width: number; height: number },
    attempt = 0,
  ): Promise<void | null> =>
    invokeCommand("set_webview_visibility", { request }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const stillWantsVisible = visibilityRef.current.isActive && !visibilityRef.current.suppressed;
      const shouldRetry =
        request.visible &&
        stillWantsVisible &&
        sessionStartedRef.current &&
        attempt < WEBVIEW_SHOW_RETRY_DELAYS_MS.length &&
        WEBVIEW_HANDLE_NOT_READY_PATTERN.test(message);
      if (!shouldRetry) {
        throw error instanceof Error ? error : new Error(message);
      }
      return new Promise<void | null>((resolve, reject) => {
        window.setTimeout(() => {
          requestWebviewVisibility(request, attempt + 1).then(resolve, reject);
        }, WEBVIEW_SHOW_RETRY_DELAYS_MS[attempt]);
      });
    });

  const pushWebviewVisibility = () => {
    if (!sessionStartedRef.current) {
      return;
    }
    const bounds = computeBounds();
    const visible = visibilityRef.current.isActive && !visibilityRef.current.suppressed;
    if (!bounds && visible) {
      logWebviewBoundsDebug("frontend.visibility.skipped_missing_bounds", { visible });
      return;
    }
    logWebviewBoundsDebug("frontend.visibility.request", {
      visible,
      requestBounds: bounds ?? HIDDEN_WEBVIEW_BOUNDS,
    });
    const visibilityUpdate = requestWebviewVisibility({
      sessionId: sessionIdRef.current,
      visible,
      ...(bounds ?? HIDDEN_WEBVIEW_BOUNDS),
    });
    void visibilityUpdate.catch((error) => {
      setNavError(error instanceof Error ? error.message : String(error));
    });
    if (visible && bounds) {
      lastBoundsRef.current = bounds;
    }
  };

  const captureVisibleWebviewSnapshot = async () => {
    if (!isTauriRuntime() || !sessionStartedRef.current || !visibilityRef.current.isActive) {
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

  const suppressWebviewWithSnapshot = (snapshot: AssistantScreenshot | null) => {
    setWebviewSnapshot(snapshot);
    visibilityRef.current = { ...visibilityRef.current, suppressed: true };
    window.requestAnimationFrame(() => pushWebviewVisibility());
  };

  const triggerPreCapture = () => {
    if (
      !isActive ||
      !isTauriRuntime() ||
      !sessionStartedRef.current ||
      visibilityRef.current.suppressed
    ) {
      return;
    }
    const now = Date.now();
    if (preCaptureInFlightRef.current || now - preCaptureLastRef.current < WEBVIEW_PRE_CAPTURE_INTERVAL_MS) {
      return;
    }
    preCaptureLastRef.current = now;
    preCaptureInFlightRef.current = true;
    void captureVisibleWebviewSnapshot()
      .then((snapshot) => {
        if (snapshot) {
          preCachedSnapshotRef.current = snapshot;
          preCachedAtRef.current = Date.now();
        }
      })
      .catch(() => {
        // Speculative pre-capture can miss; the overlay path still falls back to capture-on-open.
      })
      .finally(() => {
        preCaptureInFlightRef.current = false;
      });
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
      const bounds = computeBounds();
      if (!visibilityRef.current.isActive || visibilityRef.current.suppressed) {
        logWebviewBoundsDebug("frontend.visibility.request", {
          visible: false,
          reason: visibilityRef.current.isActive ? "suppressed" : "inactive",
          requestBounds: bounds ?? HIDDEN_WEBVIEW_BOUNDS,
        });
        void invokeCommand("set_webview_visibility", {
          request: { sessionId: sessionIdRef.current, visible: false, ...(bounds ?? HIDDEN_WEBVIEW_BOUNDS) },
        }).catch((error) => {
          setNavError(error instanceof Error ? error.message : String(error));
        });
        return;
      }
      if (!bounds) {
        logWebviewBoundsDebug("frontend.bounds.update.skipped_missing_bounds");
        return;
      }
      const previous = lastBoundsRef.current;
      if (
        previous &&
        previous.x === bounds.x &&
        previous.y === bounds.y &&
        previous.width === bounds.width &&
        previous.height === bounds.height
      ) {
        logWebviewBoundsDebug("frontend.bounds.update.skipped_unchanged", {
          requestBounds: bounds,
        });
        return;
      }
      lastBoundsRef.current = bounds;
      logWebviewBoundsDebug("frontend.bounds.update.request", {
        previousBounds: previous,
        requestBounds: bounds,
      });
      void invokeCommand("update_webview_bounds", {
        request: { sessionId: sessionIdRef.current, ...bounds },
      }).catch((error) => {
        setNavError(error instanceof Error ? error.message : String(error));
      });
    });
  };

  useEffect(() => {
    if (
      !isTauriRuntime() ||
      !webviewEventsReady ||
      sessionStartedRef.current ||
      sessionStartingRef.current ||
      !initialUrl
    ) {
      return;
    }
    const bounds = computeBounds();
    if (!bounds) {
      logWebviewBoundsDebug("frontend.start.skipped_missing_bounds");
      return;
    }
    let disposed = false;
    const sessionId = sessionIdRef.current;
    const urlConnectionOptions = {
      ...tab.connection,
      dataPartition: tab.dataPartition ?? tab.connection?.dataPartition,
      urlUserAgent: tab.connection?.urlUserAgent,
      urlProxyInheritDefaults: tab.connection
        ? tab.connection.urlProxyInheritDefaults
        : tab.dataPartition
          ? false
          : undefined,
    };
    const proxyUrl = resolveUrlProxy(urlConnectionOptions, generalSettings);
    const dataPartition = resolveUrlDataPartition(urlConnectionOptions, urlSettings);
    const userAgent = resolveUrlUserAgent(urlConnectionOptions, urlSettings);
    sessionStartingRef.current = true;
    lastBoundsRef.current = bounds;
    markWebviewConnectionStarted();
    logWebviewBoundsDebug("frontend.start.request", {
      requestBounds: bounds,
      dataPartition,
      ignoreCertificateErrors,
      proxyUrl,
      userAgentConfigured: Boolean(userAgent),
    });
    const lease = acquireWebviewSession(sessionId, () =>
      invokeCommand("start_webview_session", {
        request: {
          sessionId,
          url: initialUrl,
          dataPartition,
          userAgent,
          downloadFolder: urlSettings.downloadFolder?.trim() || undefined,
          proxyUrl,
          ignoreCertificateErrors,
          ...bounds,
        },
      }),
    );
    lease.promise
      .then((started) => {
        sessionStartingRef.current = false;
        if (disposed) {
          return;
        }
        externalLinkTokenRef.current = started.externalLinkToken;
        downloadFolderRef.current = started.downloadFolder;
        sessionStartedRef.current = true;
        setWebviewReady(true);
        pushWebviewVisibility();
      })
      .catch((error) => {
        sessionStartingRef.current = false;
        sessionStartedRef.current = false;
        if (!disposed) {
          markWebviewConnectionEnded();
          setNavError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      disposed = true;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const ownsSession = sessionStartingRef.current || sessionStartedRef.current;
      sessionStartingRef.current = false;
      sessionStartedRef.current = false;
      setWebviewReady(false);
      if (ownsSession) {
        releaseWebviewSession(sessionId);
      }
      markWebviewConnectionEnded();
      if (tab.sshPortForwardSessionId) {
        void invokeCommand("close_ssh_port_forward", {
          request: { forwardId: tab.sshPortForwardSessionId },
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webviewEventsReady]);

  useEffect(() => {
    if (!isTauriRuntime() || !webviewReady || autoRefreshSeconds === 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (!sessionStartedRef.current || fullPageCaptureInFlightRef.current) {
        return;
      }
      void invokeCommand("webview_reload", {
        request: { sessionId: sessionIdRef.current },
      }).catch((error) => {
        setNavError(error instanceof Error ? error.message : String(error));
      });
    }, autoRefreshSeconds * 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoRefreshSeconds, webviewReady]);

  useEffect(() => {
    visibilityRef.current = { ...visibilityRef.current, isActive };
  }, [isActive]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const node = placeholderRef.current;
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
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || !sessionStartedRef.current) {
      return;
    }
    pushWebviewVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const updateSuppression = () => {
      const suppressed = documentHasWebviewBlockingOverlay(placeholderRef.current);
      if (!suppressed) {
        suppressionCaptureInFlightRef.current = false;
        if (visibilityRef.current.suppressed) {
          visibilityRef.current = { ...visibilityRef.current, suppressed: false };
          setWebviewSnapshot(null);
          pushWebviewVisibility();
        }
        return;
      }
      if (visibilityRef.current.suppressed || suppressionCaptureInFlightRef.current) {
        return;
      }
      const cached = preCachedSnapshotRef.current;
      if (cached) {
        preCachedSnapshotRef.current = null;
        const fresh = Date.now() - preCachedAtRef.current < WEBVIEW_PRE_CAPTURE_MAX_AGE_MS;
        if (fresh && documentHasWebviewBlockingOverlay(placeholderRef.current)) {
          suppressWebviewWithSnapshot(cached);
          return;
        }
        // Stale cache: fall through to capture the live surface on-open.
      }
      suppressionCaptureInFlightRef.current = true;
      void captureVisibleWebviewSnapshot()
        .then((snapshot) => {
          if (!documentHasWebviewBlockingOverlay(placeholderRef.current)) {
            visibilityRef.current = { ...visibilityRef.current, suppressed: false };
            setWebviewSnapshot(null);
            pushWebviewVisibility();
            return;
          }
          suppressWebviewWithSnapshot(snapshot);
        })
        .catch(() => {
          if (documentHasWebviewBlockingOverlay(placeholderRef.current)) {
            suppressWebviewWithSnapshot(null);
          }
        })
        .finally(() => {
          suppressionCaptureInFlightRef.current = false;
        });
    };
    updateSuppression();
    const observer = new MutationObserver(updateSuppression);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", updateSuppression);
    window.addEventListener("scroll", updateSuppression, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSuppression);
      window.removeEventListener("scroll", updateSuppression, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    const disposers: Array<() => void> = [];
    const pendingPageCaptureStates = pendingPageCaptureStatesRef.current;
    void Promise.all([
      listen<WebviewNavigationEvent>("webview-navigation", (event) => {
        if (event.payload.sessionId !== sessionIdRef.current) {
          return;
        }
        setAddressInput(event.payload.url);
        updateWebviewTabMetadata(tab.id, {
          subtitle: formatWebviewSubtitle(event.payload.url),
          url: event.payload.url,
        });
        scheduleBoundsPush();
      }),
      listen<WebviewPageLoadEvent>("webview-page-load", (event) => {
        if (event.payload.sessionId !== sessionIdRef.current) {
          return;
        }
        setAddressInput(event.payload.url);
        scheduleBoundsPush();
        if (event.payload.status === "finished") {
          setFillStatus("");
          void maybeUpdateConnectionIcon(event.payload.url);
          void fillCredential({ automatic: true, showStatus: false });
        }
      }),
      listen<WebviewCertificateErrorEvent>("webview-certificate-error", (event) => {
        if (event.payload.sessionId !== sessionIdRef.current) {
          return;
        }
        showStatusBarNotice(t("webview.invalidCertificateWarning"), { tone: "warning" });
      }),
      listen<WebviewNewWindowEvent>("webview-new-window", (event) => {
        if (event.payload.sessionId !== sessionIdRef.current) {
          return;
        }
        if (tab.connection) {
          openUrlInNewTab(tab.connection, event.payload.url, {
            subtitle: formatWebviewSubtitle(event.payload.url),
          });
          return;
        }
        void openExternalUrl(event.payload.url).catch((error) => {
          setNavError(error instanceof Error ? error.message : String(error));
        });
      }),
      listen<WebviewTitleChangedEvent>("webview-title-changed", (event) => {
        if (event.payload.sessionId !== sessionIdRef.current) {
          return;
        }
        const title = event.payload.title.trim();
        if (title.startsWith(CREDENTIAL_TITLE_PREFIX)) {
          void handleCapturedCredential(title.slice(CREDENTIAL_TITLE_PREFIX.length));
          return;
        }
        if (title.startsWith(EXTERNAL_LINK_TITLE_PREFIX)) {
          const externalUrl = externalWebviewLinkUrl(
            title.slice(EXTERNAL_LINK_TITLE_PREFIX.length),
            externalLinkTokenRef.current,
          );
          if (externalUrl) {
            void openExternalUrl(externalUrl).catch((error) => {
              setNavError(error instanceof Error ? error.message : String(error));
            });
          }
          return;
        }
        if (title.startsWith(CONTEXT_MENU_TITLE_PREFIX)) {
          const payload = webviewContextMenuPayload(
            title.slice(CONTEXT_MENU_TITLE_PREFIX.length),
            externalLinkTokenRef.current,
          );
          if (payload) {
            void showWebviewContextMenu(payload);
          }
          return;
        }
        if (title.startsWith(PAGE_CAPTURE_TITLE_PREFIX)) {
          const state = webviewPageCaptureState(
            title.slice(PAGE_CAPTURE_TITLE_PREFIX.length),
            externalLinkTokenRef.current,
          );
          const pending = state ? pendingPageCaptureStates.get(state.nonce) : undefined;
          if (state && pending) {
            window.clearTimeout(pending.timeoutId);
            pendingPageCaptureStates.delete(state.nonce);
            pending.resolve(state);
          }
          return;
        }
        if (title) {
          updateWebviewTabMetadata(tab.id, { title });
        }
      }),
      listen<WebviewDownloadEvent>("webview-download", (event) => {
        if (event.payload.sessionId !== sessionIdRef.current) {
          return;
        }
        if (event.payload.status === "requested") {
          if (!downloadFolderRef.current && event.payload.path) {
            downloadFolderRef.current = parentDirectory(event.payload.path);
          }
          setDownloads((current) => [
            ...current,
            {
              id: nextDownloadIdRef.current++,
              path: event.payload.path,
              status: "downloading",
              url: event.payload.url,
            },
          ]);
          showStatusBarNotice(t("webview.downloadStarted"), { tone: "info" });
          return;
        }
        if (event.payload.status === "finished") {
          setDownloads((current) => {
            const matchingIndex = current.findIndex(
              (download) =>
                download.status === "downloading" &&
                ((event.payload.path && download.path === event.payload.path) ||
                  download.url === event.payload.url),
            );
            if (matchingIndex < 0) {
              return current;
            }
            return current.map((download, index) =>
              index === matchingIndex
                ? {
                    ...download,
                    path: event.payload.path ?? download.path,
                    status: event.payload.success ? "complete" : "failed",
                  }
                : download,
            );
          });
          showStatusBarNotice(
            event.payload.success ? t("webview.downloadComplete") : t("webview.downloadFailed"),
            { tone: event.payload.success ? "success" : "error" },
          );
        }
      }),
    ]).then((unlistenFns) => {
      if (disposed) {
        unlistenFns.forEach((unlisten) => unlisten());
        return;
      }
      disposers.push(...unlistenFns);
      setWebviewEventsReady(true);
    });

    return () => {
      disposed = true;
      disposers.forEach((dispose) => dispose());
      for (const pending of pendingPageCaptureStates.values()) {
        window.clearTimeout(pending.timeoutId);
        pending.reject(new Error("URL page capture was cancelled."));
      }
      pendingPageCaptureStates.clear();
    };
    // Re-subscribe only on the listed inputs; the credential/icon handlers are recreated each render and read at event time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUrlInNewTab, refreshOpenConnectionMetadata, showStatusBarNotice, tab.connection, tab.id, t, updateWebviewTabMetadata]);

  function handleNavigate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isTauriRuntime() || !sessionStartedRef.current) {
      return;
    }
    setNavError("");
    void invokeCommand("webview_navigate", {
      request: { sessionId: sessionIdRef.current, url: addressInput },
    }).catch((error) => {
      setNavError(error instanceof Error ? error.message : String(error));
    });
  }

  async function handleDownloadsMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const downloadItems = downloads.map((download) => ({
      kind: "item" as const,
      label: t(
        download.status === "downloading"
          ? "webview.downloadInProgress"
          : download.status === "complete"
            ? "webview.downloadSucceeded"
            : "webview.downloadFailedItem",
        { file: downloadFileName(download) },
      ),
      iconSvg: nativeMenuIcons.download,
      disabled: true,
      action: () => undefined,
    }));
    const openFolderItem = {
      kind: "item",
      label: t("webview.openDownloadFolder"),
      iconSvg: nativeMenuIcons.folderOpen,
      disabled: false,
      action: () => {
        const folder = downloadFolderRef.current;
        if (!folder) {
          return;
        }
        void openFilesystemPath(folder).catch((error) => {
          showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
        });
      },
    } as const;
    await showNativeContextMenu(
      [
        ...downloadItems,
        { kind: "separator" },
        openFolderItem,
      ],
      { x: bounds.left, y: bounds.bottom },
    );
  }

  function handleSimple(name: "webview_reload" | "webview_go_back" | "webview_go_forward") {
    if (!isTauriRuntime() || !sessionStartedRef.current) {
      return;
    }
    void invokeCommand(name, {
      request: { sessionId: sessionIdRef.current },
    }).catch((error) => {
      setNavError(error instanceof Error ? error.message : String(error));
    });
  }

  function maybeUpdateConnectionIcon(pageUrl: string) {
    if (!tab.connection || tab.connection.type !== "url" || tab.connection.iconDataUrl || faviconUpdatedRef.current) {
      return;
    }
    faviconUpdatedRef.current = true;
    void invokeCommand("update_url_connection_icon_from_page", {
      connectionId: tab.connection.id,
      pageUrl,
    })
      .then((connection) => {
        if (connection) {
          refreshOpenConnectionMetadata(connection);
          window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
        }
      })
      .catch(() => undefined);
  }

  function handleCapturedCredential(rawPayload: string) {
    if (!tab.connection || !pendingCaptureNonceRef.current) {
      return;
    }
    let payload: CapturedCredentialPayload;
    try {
      payload = JSON.parse(rawPayload) as CapturedCredentialPayload;
    } catch {
      pendingCaptureNonceRef.current = null;
      setFillStatus("");
      setNavError(t("webview.savePasswordInvalidCapture"));
      return;
    }
    if (payload.nonce !== pendingCaptureNonceRef.current) {
      return;
    }
    pendingCaptureNonceRef.current = null;
    if (!payload.ok || !payload.username) {
      setFillStatus("");
      const reason = payload.reason === "no-fields"
        ? t("webview.savePasswordNoPasswordField")
        : t("webview.savePasswordFailed");
      setNavError(reason);
      return;
    }
    setNavError("");
    setFillStatus(t("webview.savingPassword"));
    const secretOwnerId = urlCredentialSecretOwnerId(tab.connection.id, payload.url);
    // The primary password (if any) is the only value kept in the OS keychain;
    // every other field is durable form data persisted alongside the credential.
    const storePassword = payload.password
      ? invokeCommand("store_secret", {
          request: {
            kind: "urlPassword",
            ownerId: secretOwnerId,
            secret: payload.password,
          },
        })
      : Promise.resolve();
    void storePassword
      .then(() => invokeCommand("upsert_url_credential", {
        request: {
          connectionId: tab.connection!.id,
          username: payload.username!,
          pageUrl: payload.url,
          usernameSelector: payload.usernameSelector,
          passwordSelector: payload.passwordSelector,
          fieldValues: payload.fieldValues ? JSON.stringify(payload.fieldValues) : undefined,
        },
      }))
      .then(() => {
        setHasSavedCredential(true);
        setFillStatus(t("webview.passwordSaved"));
        window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
      })
      .catch((error) => {
        setFillStatus("");
        setNavError(error instanceof Error ? error.message : String(error));
      });
  }

  function handleSaveCredential() {
    if (!isTauriRuntime() || !sessionStartedRef.current || !tab.connection) {
      return;
    }
    setNavError("");
    setFillStatus(t("webview.capturingPassword"));
    const nonce = createCredentialCaptureNonce();
    pendingCaptureNonceRef.current = nonce;
    void invokeCommand("capture_webview_credential", {
      request: { sessionId: sessionIdRef.current, nonce },
    }).catch((error) => {
      pendingCaptureNonceRef.current = null;
      setFillStatus("");
      setNavError(error instanceof Error ? error.message : String(error));
    });
  }

  function fillCredential({ automatic, showStatus }: { automatic: boolean; showStatus: boolean }) {
    const credential = credentialRef.current;
    if (!isTauriRuntime() || !sessionStartedRef.current || !tab.connection || !credential.canFillCredential) {
      return Promise.resolve();
    }
    if (showStatus) {
      setNavError("");
      setFillStatus(t("webview.fillingCredential"));
    }
    return invokeCommand("fill_webview_credential", {
      request: {
        sessionId: sessionIdRef.current,
        connectionId: tab.connection.id,
        pageUrl: addressInput || initialUrl,
        automatic,
      },
    })
      .then(() => {
        if (showStatus) {
          setFillStatus(t("webview.credentialFilled"));
        }
      })
      .catch((error) => {
        if (showStatus) {
          setFillStatus("");
          setNavError(error instanceof Error ? error.message : String(error));
        }
      });
  }

  function handleFillCredential() {
    void fillCredential({ automatic: false, showStatus: true });
  }

  function handleOpenExternal() {
    if (!addressInput.trim()) {
      return;
    }
    setNavError("");
    void openExternalUrl(addressInput).catch((error) => {
      setNavError(error instanceof Error ? error.message : String(error));
    });
  }

  function requestPageCaptureState(x?: number, y?: number) {
    const nonce = createCredentialCaptureNonce();
    return new Promise<WebviewPageCaptureState>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingPageCaptureStatesRef.current.delete(nonce);
        reject(new Error("The URL page did not respond to the screenshot request."));
      }, PAGE_CAPTURE_STATE_TIMEOUT_MS);
      pendingPageCaptureStatesRef.current.set(nonce, { resolve, reject, timeoutId });
      void invokeCommand("request_webview_page_capture_state", {
        request: { sessionId: sessionIdRef.current, nonce, x, y },
      }).catch((error) => {
        window.clearTimeout(timeoutId);
        pendingPageCaptureStatesRef.current.delete(nonce);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async function captureFullWebviewPage() {
    if (!isTauriRuntime() || !sessionStartedRef.current || !visibilityRef.current.isActive) {
      throw new Error(t("webview.fullPageCaptureFailed"));
    }
    if (fullPageCaptureInFlightRef.current) {
      throw new Error(t("webview.fullPageCaptureFailed"));
    }
    fullPageCaptureInFlightRef.current = true;
    let initialState: WebviewPageCaptureState | null = null;
    let dataUrl: string | null = null;
    let captureFailed = false;
    try {
      initialState = await requestPageCaptureState();
      const xPositions = pageCaptureTilePositions(initialState.pageWidth, initialState.viewportWidth);
      const yPositions = pageCaptureTilePositions(initialState.pageHeight, initialState.viewportHeight);
      let canvas: HTMLCanvasElement | null = null;
      let context: CanvasRenderingContext2D | null = null;
      let scaleX = 1;
      let scaleY = 1;

      for (const y of yPositions) {
        for (const x of xPositions) {
          const state = await requestPageCaptureState(x, y);
          const bounds = computeBounds();
          if (!bounds) {
            throw new Error("The URL page moved out of the visible capture area.");
          }
          const screenshot = await invokeCommand("capture_screenshot_for_assistant", {
            request: bounds,
          });
          const image = await loadScreenshotImage(screenshot.dataUrl);
          if (!canvas || !context) {
            scaleX = screenshot.width / Math.max(1, state.captureWidth);
            scaleY = screenshot.height / Math.max(1, state.captureHeight);
            const outputWidth = Math.max(1, Math.ceil(initialState.pageWidth * scaleX));
            const outputHeight = Math.max(1, Math.ceil(initialState.pageHeight * scaleY));
            assertFullPageCanvasSize(outputWidth, outputHeight);
            canvas = document.createElement("canvas");
            canvas.width = outputWidth;
            canvas.height = outputHeight;
            context = canvas.getContext("2d");
            if (!context) {
              throw new Error("Could not prepare the full-page screenshot canvas.");
            }
          }
          const sourceWidth = Math.min(
            image.naturalWidth,
            Math.ceil(state.viewportWidth * scaleX),
            Math.ceil((initialState.pageWidth - state.x) * scaleX),
          );
          const sourceHeight = Math.min(
            image.naturalHeight,
            Math.ceil(state.viewportHeight * scaleY),
            Math.ceil((initialState.pageHeight - state.y) * scaleY),
          );
          context.drawImage(
            image,
            0,
            0,
            sourceWidth,
            sourceHeight,
            Math.round(state.x * scaleX),
            Math.round(state.y * scaleY),
            sourceWidth,
            sourceHeight,
          );
        }
      }
      if (!canvas) {
        throw new Error("The URL page did not produce any screenshot tiles.");
      }
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      captureFailed = true;
    }
    try {
      if (initialState) {
        await requestPageCaptureState(initialState.x, initialState.y);
      }
    } catch {
      captureFailed = true;
    } finally {
      fullPageCaptureInFlightRef.current = false;
    }
    if (captureFailed || !dataUrl) {
      throw new Error(t("webview.fullPageCaptureFailed"));
    }
    return dataUrl;
  }

  async function captureFullWebviewPageWithSettings() {
    const dataUrl = await captureFullWebviewPage();
    return invokeCommand("deliver_screenshot_data_url", {
      request: { dataUrl },
      kind: "screenshot",
    });
  }

  async function saveFullWebviewPageAs() {
    const filename = fullPageScreenshotFilename(tab.title);
    try {
      const path = await selectPngSavePath(filename, t("dashboard.qrSaveImage"));
      if (!path) {
        return;
      }
      const dataUrl = await captureFullWebviewPage();
      await writeDataUrlFile(path, dataUrl);
      showStatusBarNotice(t("dashboard.imageConverter.saved", { name: filename }), {
        tone: "success",
      });
    } catch (error) {
      showStatusBarNotice(
        t("workspace.screenshotCaptureError", {
          message: error instanceof Error ? error.message : String(error),
        }),
        { tone: "error" },
      );
    }
  }

  async function showWebviewContextMenu(payload: WebviewContextMenuPayload) {
    const bounds = computeBounds();
    if (!bounds) {
      return;
    }
    const copyText = (text: string) => {
      void writeToClipboard(text).then(() => {
        showStatusBarNotice(t("workspace.copied"), { tone: "success" });
      });
    };
    await showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("webview.back"),
          iconSvg: nativeMenuIcons.arrowLeft,
          action: () => handleSimple("webview_go_back"),
        },
        {
          kind: "item",
          label: t("webview.forward"),
          iconSvg: nativeMenuIcons.arrowRight,
          action: () => handleSimple("webview_go_forward"),
        },
        {
          kind: "item",
          label: t("webview.reload"),
          iconSvg: nativeMenuIcons.rotateCcw,
          action: () => handleSimple("webview_reload"),
        },
        { kind: "separator" },
        ...(payload.linkUrl && tab.connection
          ? [{
              kind: "item" as const,
              label: t("webview.openLinkInNewTab"),
              iconSvg: nativeMenuIcons.squarePlus,
              action: () => openUrlInNewTab(tab.connection!, payload.linkUrl!, {
                subtitle: formatWebviewSubtitle(payload.linkUrl!),
              }),
            }]
          : []),
        ...(payload.linkUrl
          ? [
              {
                kind: "item" as const,
                label: t("webview.openExternally"),
                iconSvg: nativeMenuIcons.arrowUp,
                action: () => void openExternalUrl(payload.linkUrl!).catch((error) => {
                  setNavError(error instanceof Error ? error.message : String(error));
                }),
              },
              {
                kind: "item" as const,
                label: t("webview.copyLinkAddress"),
                iconSvg: nativeMenuIcons.copy,
                action: () => copyText(payload.linkUrl!),
              },
            ]
          : []),
        ...(payload.selectionText
          ? [{
              kind: "item" as const,
              label: t("webview.copySelectedText"),
              iconSvg: nativeMenuIcons.copy,
              action: () => copyText(payload.selectionText!),
            }]
          : []),
        { kind: "separator" },
        {
          kind: "item",
          label: t("dashboard.qrSaveImage"),
          iconSvg: nativeMenuIcons.saveAs,
          action: () => void saveFullWebviewPageAs(),
        },
        {
          kind: "item",
          label: t("workspace.sendEntirePanelToAi"),
          action: () => void captureWebviewScreenshotForAssistant(),
        },
      ],
      {
        x: bounds.x + Math.min(bounds.width - 1, Math.max(0, payload.x)),
        y: bounds.y + Math.min(bounds.height - 1, Math.max(0, payload.y)),
      },
    );
  }

  function handleAutoRefreshChange(value: string) {
    const seconds = Number(value);
    if (AUTO_REFRESH_INTERVALS_SECONDS.includes(seconds as AutoRefreshIntervalSeconds)) {
      setAutoRefreshSeconds(seconds as AutoRefreshIntervalSeconds);
    }
  }

  async function captureWebviewScreenshotForAssistant() {
    if (!isTauriRuntime()) {
      showStatusBarNotice(t("workspace.screenshotsRequireRuntime"), { tone: "warning" });
      return;
    }
    const target = workspaceRef.current;
    if (!target) {
      return;
    }
    const bounds = target.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    try {
      const screenshot = await invokeCommand("capture_screenshot_for_assistant", {
        request: {
          x: Math.max(0, Math.round(bounds.left)),
          y: Math.max(0, Math.round(bounds.top)),
          width: Math.max(1, Math.round(bounds.width)),
          height: Math.max(1, Math.round(bounds.height)),
        },
      });
      const snippet = {
        id: `webview-screenshot-${Date.now()}`,
        kind: "screenshot",
        sourceLabel: t("webview.screenshotTarget", { title: tab.title }),
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
  }

  const trimmedAddress = addressInput.trim();
  const isHttpsAddress = /^https:\/\//i.test(trimmedAddress);
  const isHttpAddress = /^http:\/\//i.test(trimmedAddress);
  const addressBarClassName = [
    "webview-address-bar",
    isHttpAddress ? "is-http" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const addressHost = formatWebviewSubtitle(addressInput);
  const connectionIconSrc = tab.connection?.iconDataUrl;
  const connectionIdentityLabel = tab.connection?.name || addressHost;

  return (
    <section
      className={isActive ? "terminal-workspace webview-workspace active" : "terminal-workspace webview-workspace"}
      data-color-scheme={resolveAppliedColorScheme(appearanceSettings.colorScheme)}
      data-selected-color-scheme={appearanceSettings.colorScheme}
      ref={workspaceRef}
    >
      <article className="terminal-pane webview-pane">
        <header>
          <div className="webview-nav-group" data-tutorial-id="webview.toolbar">
            <span className="webview-conn-icon" title={connectionIdentityLabel}>
              {connectionIconSrc ? (
                <img alt="" aria-hidden="true" draggable={false} height={18} src={connectionIconSrc} width={18} />
              ) : (
                <Globe2 size={16} />
              )}
            </span>
            <div className="webview-nav-cluster">
              <button
                className="terminal-pane-action"
                aria-label={t("webview.goBack")}
                onClick={() => handleSimple("webview_go_back")}
                title={t("webview.back")}
                type="button"
              >
                <ArrowLeft size={15} />
              </button>
              <button
                className="terminal-pane-action"
                aria-label={t("webview.goForward")}
                onClick={() => handleSimple("webview_go_forward")}
                title={t("webview.forward")}
                type="button"
              >
                <ArrowRight size={15} />
              </button>
              <button
                className="terminal-pane-action"
                aria-label={t("webview.reload")}
                onClick={() => handleSimple("webview_reload")}
                title={t("webview.reload")}
                type="button"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <form className={addressBarClassName} onSubmit={handleNavigate}>
              <span className={isHttpsAddress || isHttpAddress ? "webview-address-lock" : "webview-address-lock insecure"}>
                {isHttpAddress ? <Unlock size={13} /> : isHttpsAddress ? <Lock size={13} /> : <Globe2 size={13} />}
              </span>
              <input
                aria-label={t("webview.address")}
                className="webview-address-input"
                data-tutorial-id="webview.address"
                {...technicalInputProps}
                onChange={(event) => setAddressInput(event.currentTarget.value)}
                placeholder={t("webview.urlPlaceholder")}
                value={addressInput}
              />
            </form>
          </div>
          <div className="terminal-pane-actions">
            {fillStatus ? <span className="webview-toolbar-status">{fillStatus}</span> : null}
            {downloads.length > 0 ? (
              <button
                aria-label={t("webview.downloads")}
                className="terminal-pane-action"
                onClick={(event) => void handleDownloadsMenu(event)}
                title={t("webview.downloads")}
                type="button"
              >
                <Download size={15} />
              </button>
            ) : null}
            <button
              aria-label={t("webview.openExternally")}
              className="terminal-pane-action"
              data-tutorial-id="webview.openExternally"
              disabled={!addressInput.trim()}
              onClick={handleOpenExternal}
              title={t("webview.openExternally")}
              type="button"
            >
              <ExternalLink size={15} />
            </button>
            <select
              aria-label={t("webview.autoRefresh")}
              className="webview-auto-refresh-select"
              data-tutorial-id="webview.autoRefresh"
              onChange={(event) => handleAutoRefreshChange(event.currentTarget.value)}
              title={t("webview.autoRefresh")}
              value={autoRefreshSeconds}
            >
              {AUTO_REFRESH_INTERVALS_SECONDS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds === 0
                    ? t("webview.autoRefreshOff")
                    : t("webview.autoRefreshSeconds", { count: seconds })}
                </option>
              ))}
            </select>
            {tab.connection ? (
              <>
                <button
                  className="terminal-pane-action"
                  data-tutorial-id="webview.savePassword"
                  onClick={handleSaveCredential}
                  title={t("webview.savePasswordTitle")}
                  type="button"
                >
                  <Floppy size={15} />
                </button>
                <button
                  className="terminal-pane-action"
                  data-tutorial-id="webview.fillCredential"
                  disabled={!canFillCredential}
                  onClick={handleFillCredential}
                  title={canFillCredential ? t("webview.fillSavedCredential") : t("webview.noSavedCredential")}
                  type="button"
                >
                  <KeyRound size={15} />
                </button>
              </>
            ) : null}
            <ScreenshotMenu
              buttonClassName="terminal-pane-action"
              dataTutorialId="workspace.screenshotMenu"
              entirePanelLabel={t("webview.capturePageToClipboard")}
              onCaptureEntirePanel={captureFullWebviewPageWithSettings}
              onPreCapture={triggerPreCapture}
              targetLabel={t("webview.screenshotTarget", { title: tab.title })}
              targetRef={workspaceRef}
            />
            {tab.connection ? (
              <NoteToolbarButton
                connectionId={tab.connection.id}
                onOpen={() => openNoteEditor(tab.connection!.id, tab.connection!.name)}
              />
            ) : null}
            <button
              aria-label={t("workspace.sendEntirePanelToAi")}
              className="terminal-pane-action"
              data-tutorial-id="webview.sendToAi"
              disabled={!isTauriRuntime()}
              onClick={() => void captureWebviewScreenshotForAssistant()}
              title={t("workspace.sendEntirePanelToAi")}
              type="button"
            >
              <Bot size={15} />
            </button>
            {onClose ? (
              <button
                aria-label={t("workspace.closeTab", { title: tab.title })}
                className="terminal-pane-action webview-close-action"
                data-tutorial-id="webview.close"
                onClick={onClose}
                title={t("workspace.closeTab", { title: tab.title })}
                type="button"
              >
                <X size={15} />
              </button>
            ) : null}
          </div>
        </header>
        <div ref={placeholderRef} className="webview-placeholder" data-tutorial-id="webview.surface">
          {webviewSnapshot ? (
            <img
              alt=""
              className="webview-suppression-snapshot"
              height={webviewSnapshot.height}
              src={webviewSnapshot.dataUrl}
              width={webviewSnapshot.width}
            />
          ) : null}
          {!initialUrl ? (
            <p className="webview-placeholder-message">{t("webview.noUrlConfigured")}</p>
          ) : !isTauriRuntime() ? (
            <p className="webview-placeholder-message">
              {t("webview.desktopRuntimeOnly")} <code>{initialUrl}</code>
            </p>
          ) : null}
          {navError ? <p className="form-error webview-placeholder-error">{navError}</p> : null}
        </div>
      </article>
    </section>
  );
}

function parentDirectory(path: string) {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : null;
}

function downloadFileName(download: WebviewDownload) {
  const path = download.path?.trim();
  if (path) {
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return path.slice(separatorIndex + 1) || path;
  }
  try {
    const pathname = new URL(download.url).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1)) || download.url;
  } catch {
    return download.url;
  }
}

function formatWebviewSubtitle(url: string) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function urlDebugSnapshot(url: string) {
  try {
    const parsed = new URL(url);
    return {
      scheme: parsed.protocol.replace(/:$/, ""),
      host: parsed.host,
    };
  } catch {
    return {
      scheme: null,
      host: null,
    };
  }
}

function externalWebviewLinkUrl(rawPayload: string, expectedToken: string | null) {
  if (!expectedToken) {
    return null;
  }
  try {
    const payload = JSON.parse(rawPayload) as { token?: unknown; url?: unknown };
    if (payload.token !== expectedToken || typeof payload.url !== "string") {
      return null;
    }
    const url = new URL(payload.url);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function webviewContextMenuPayload(
  rawPayload: string,
  expectedToken: string | null,
): WebviewContextMenuPayload | null {
  if (!expectedToken) {
    return null;
  }
  try {
    const payload = JSON.parse(rawPayload) as Record<string, unknown>;
    if (
      payload.token !== expectedToken ||
      typeof payload.x !== "number" ||
      !Number.isFinite(payload.x) ||
      typeof payload.y !== "number" ||
      !Number.isFinite(payload.y)
    ) {
      return null;
    }
    let linkUrl: string | undefined;
    if (typeof payload.linkUrl === "string") {
      const parsed = new URL(payload.linkUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        linkUrl = parsed.href;
      }
    }
    return {
      x: payload.x,
      y: payload.y,
      linkUrl,
      selectionText: typeof payload.selectionText === "string" && payload.selectionText
        ? payload.selectionText.slice(0, 65536)
        : undefined,
    };
  } catch {
    return null;
  }
}

function webviewPageCaptureState(
  rawPayload: string,
  expectedToken: string | null,
): WebviewPageCaptureState | null {
  if (!expectedToken) {
    return null;
  }
  try {
    const payload = JSON.parse(rawPayload) as Record<string, unknown>;
    const numericKeys = [
      "x",
      "y",
      "pageWidth",
      "pageHeight",
      "viewportWidth",
      "viewportHeight",
      "captureWidth",
      "captureHeight",
    ] as const;
    if (
      payload.token !== expectedToken ||
      typeof payload.nonce !== "string" ||
      !payload.nonce ||
      numericKeys.some((key) => typeof payload[key] !== "number" || !Number.isFinite(payload[key]))
    ) {
      return null;
    }
    return {
      nonce: payload.nonce,
      x: Math.max(0, payload.x as number),
      y: Math.max(0, payload.y as number),
      pageWidth: Math.max(1, payload.pageWidth as number),
      pageHeight: Math.max(1, payload.pageHeight as number),
      viewportWidth: Math.max(1, payload.viewportWidth as number),
      viewportHeight: Math.max(1, payload.viewportHeight as number),
      captureWidth: Math.max(1, payload.captureWidth as number),
      captureHeight: Math.max(1, payload.captureHeight as number),
    };
  } catch {
    return null;
  }
}

function pageCaptureTilePositions(total: number, viewport: number) {
  const maxScroll = Math.max(0, Math.ceil(total - viewport));
  if (maxScroll === 0) {
    return [0];
  }
  const positions = [0];
  for (let position = viewport; position < maxScroll; position += viewport) {
    positions.push(Math.round(position));
  }
  positions.push(maxScroll);
  return positions;
}

function fullPageScreenshotFilename(title: string) {
  const safeTitle = Array.from(title, (character) =>
    character.charCodeAt(0) < 32 ? "_" : character
  )
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim()
    .slice(0, 80) || "url-page";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safeTitle}-${timestamp}.png`;
}

function assertFullPageCanvasSize(width: number, height: number) {
  if (
    width > MAX_FULL_PAGE_CANVAS_DIMENSION ||
    height > MAX_FULL_PAGE_CANVAS_DIMENSION ||
    width * height > MAX_FULL_PAGE_CANVAS_PIXELS
  ) {
    throw new Error(`The full page is too large to stitch safely (${width} × ${height} pixels).`);
  }
}

function loadScreenshotImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode a URL page screenshot tile."));
    image.src = dataUrl;
  });
}

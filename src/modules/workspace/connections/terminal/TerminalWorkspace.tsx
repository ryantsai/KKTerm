import { confirmTrustedSshHostKey, connectionPasswordOwnerId, connectionToolbarTitle, uniqueRuntimeId, usesNativeSshHostKeyVerification } from "../utils";
import { ConfirmDialog } from "../../../../app/ConfirmDialog";
import { readFromClipboard, writeToClipboard } from "../../../../lib/clipboard";
import { ScreenshotMenu } from "../../ScreenshotMenu";

import { RemoteDesktopWorkspace } from "../remote-desktop/RemoteDesktopWorkspace";
import { SftpWorkspace } from "../sftp/SftpWorkspace";
import { WebViewWorkspace } from "../webview/WebViewWorkspace";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bot, Check, FileText, Folder, FolderOpen, Mouse, ChevronRight, Circle, ClipboardPaste, Copy, Globe2, Menu, Monitor, Network, PanelBottom, Pencil, RefreshCw, Save, Search, SplitSquareHorizontal, Square, Type, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import i18next from "../../../../i18n/config";
import { ariaInvalid, dialogButtonAria, menuButtonAria } from "../../../../lib/aria";
import { focusCurrentWebview, focusMainWindow, invokeCommand, isTauriRuntime, logUiDebug, saveTextFile, type RemoteLoopbackPort, type TerminalOutput, type TerminalRecordingEntry, type TerminalRecordingInfo, type TmuxSession } from "../../../../lib/tauri";
import { defaultTerminalSettings } from "../../../../app-defaults";
import { forgetTmuxSessionId, useWorkspaceStore } from "../../../../store";
import { createTerminalRenderer, type TerminalDimensions, type TerminalRenderer } from "./renderer";
import { ensureLayout } from "../../layout";
import {
  getPaneRenderer,
  preserveTerminalPaneRuntime,
  registerPaneInputWriter,
  registerPaneRenderer,
  shouldPreservePaneRuntimeOnUnmount,
  takePreservedTerminalPaneRuntime,
  unregisterPaneInputWriter,
  unregisterPaneRenderer,
} from "../../paneRegistry";
import type { Connection, LayoutNode, SplitDirection, TerminalPane, WorkspacePane, WorkspaceTab } from "../../../../types";
import { QuickCommandBar } from "./QuickCommandBar";
import { TerminalBackgroundLayer, TerminalBackgroundPopover } from "./TerminalBackgroundPopover";

type TerminalContextMenuState = {
  x: number;
  y: number;
  hasSelection: boolean;
};

const TMUX_MOUSE_MODE_EVENT = "kkterm:tmux-mouse-mode";
const TMUX_UNAVAILABLE_MARKER = "[KKTerm: tmux not found, using normal shell]";
const MAIN_WINDOW_FOCUS_CHANGED_EVENT = "kkterm://main-window-focus-changed";
const terminalInputEncoder = new TextEncoder();

function normalizeFilenamePart(value: string) {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "terminal";
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatBufferLogFilename(panelTitle: string, date = new Date()) {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());
  const second = padDatePart(date.getSeconds());
  return `${normalizeFilenamePart(panelTitle)}_${year}${month}${day}_${hour}${minute}${second}.log`;
}

function terminalBufferSnapshotForWrite(bufferText: string) {
  const snapshot = bufferText.trimEnd();
  return snapshot ? `${snapshot.replace(/\r?\n/g, "\r\n")}\r\n` : "";
}

export function TerminalWorkspace({
  allowPaneLayoutControls = true,
  isActive,
  onOpenAssistant = () => undefined,
  showSftpButton = true,
  tab,
}: {
  allowPaneLayoutControls?: boolean;
  isActive: boolean;
  onOpenAssistant?: () => void;
  showSftpButton?: boolean;
  tab: WorkspaceTab;
}) {
  const splitTerminalPaneDirected = useWorkspaceStore(
    (state) => state.splitTerminalPaneDirected,
  );
  const setQuickCommandBarVisible = useWorkspaceStore(
    (state) => state.setQuickCommandBarVisible,
  );
  const sshSettings = useWorkspaceStore((state) => state.sshSettings);
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const setFocusedPane = useWorkspaceStore((state) => state.setFocusedPane);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const usePaneTerminalBackgrounds =
    generalSettings.separateSplitTerminalBackgrounds &&
    tab.panes.filter(isTerminalPane).length > 1;
  const [sftpDialogConnection, setSftpDialogConnection] = useState<Connection | null>(null);
  const sftpFocusRestorePaneIdRef = useRef<string | null>(null);
  const { t } = useTranslation();
  const defaultFontSize = defaultTerminalSettings.fontSize;
  const canSplit = allowPaneLayoutControls && tab.panes.some((pane) => pane.connection);
  const focusedPaneId = tab.focusedPaneId ?? tab.panes[0]?.id;
  const maximizedPaneId = tab.maximizedPaneId && tab.panes.some((pane) => pane.id === tab.maximizedPaneId)
    ? tab.maximizedPaneId
    : undefined;
  const layout = useMemo(() => ensureLayout(tab.layout, tab.panes), [tab.layout, tab.panes]);
  const isSingleEmbeddedPane = tab.panes.length === 1 && tab.panes[0] !== undefined && !isTerminalPane(tab.panes[0]);
  const canCloseSinglePane = tab.kind === "terminal" && generalSettings.hideTopTabButtons;
  const quickCommandBarVisible = Boolean(tab.quickCommandBarVisible) && !isSingleEmbeddedPane;
  const focusedTerminalPane = tab.panes.find((pane): pane is TerminalPane => (
    isTerminalPane(pane) && pane.id === focusedPaneId
  ));
  const firstTerminalPane = tab.panes.find(isTerminalPane);
  const workspaceTerminalBackground = usePaneTerminalBackgrounds
    ? null
    : (
        focusedTerminalPane?.connection?.terminalBackground ??
        firstTerminalPane?.connection?.terminalBackground ??
        tab.connection?.terminalBackground ??
        null
      );
  const sftpDialogTab = useMemo<WorkspaceTab | null>(() => {
    if (!sftpDialogConnection) {
      return null;
    }

    return {
      id: `dialog-${tab.id}-${sftpDialogConnection.id}-sftp`,
      title: `${sftpDialogConnection.name} SFTP`,
      toolbarTitle: connectionToolbarTitle(sftpDialogConnection),
      subtitle: `${sftpDialogConnection.user}@${sftpDialogConnection.host}`,
      kind: "sftp",
      panes: [],
      connection: sftpDialogConnection,
    };
  }, [sftpDialogConnection, tab.id]);

  useEffect(() => {
    if (!sftpDialogConnection) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSftpDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sftpDialogConnection]);

  function focusTerminalPaneAfterDialogClose(paneId: string) {
    const focus = () => getPaneRenderer(paneId)?.focus();
    queueMicrotask(focus);
    window.requestAnimationFrame(focus);
  }

  function closeSftpDialog() {
    const restorePaneId = sftpFocusRestorePaneIdRef.current;
    sftpFocusRestorePaneIdRef.current = null;
    setSftpDialogConnection(null);
    if (restorePaneId) {
      focusTerminalPaneAfterDialogClose(restorePaneId);
    }
  }

  function openSftpDialog(connection: Connection, paneId: string) {
    sftpFocusRestorePaneIdRef.current = paneId === focusedPaneId ? paneId : null;
    setSftpDialogConnection(connection);
  }

  function handleSplit(paneId: string, direction: "right" | "left" | "down" | "up") {
    setFocusedPane(tab.id, paneId);
    splitTerminalPaneDirected(tab.id, direction);
  }

  async function handleSaveBuffer(targetPaneId: string) {
    const targetPane = tab.panes.find((pane) => pane.id === targetPaneId);
    const renderer = getPaneRenderer(targetPaneId);
    if (!renderer) {
      return;
    }
    const defaultFilename = formatBufferLogFilename(targetPane?.title ?? tab.title);

    try {
      const text =
        targetPane && isTerminalPane(targetPane) && targetPane.connection?.type === "ssh" && targetPane.tmuxSessionId
          ? await invokeCommand("capture_tmux_pane", {
              request: {
                ...tmuxConnectionRequest(targetPane.connection),
                tmuxSessionId: targetPane.tmuxSessionId,
                bufferLines: sshSettings.bufferLines,
              },
            })
          : renderer.getBufferText();
      await saveTextFile(defaultFilename, text);
    } catch (error) {
      showStatusBarNotice(
        t("terminal.bufferSaveFailed", { message: error instanceof Error ? error.message : String(error) }),
        { tone: "error" },
      );
    }
  }

  function applyFontSizeToPanes(size: number) {
    for (const pane of tab.panes) {
      const renderer = getPaneRenderer(pane.id);
      renderer?.setFontSize(size);
    }
  }

  function currentFontSize() {
    const focusRenderer = focusedPaneId ? getPaneRenderer(focusedPaneId) : undefined;
    if (focusRenderer) {
      return focusRenderer.getFontSize();
    }
    for (const pane of tab.panes) {
      const renderer = getPaneRenderer(pane.id);
      if (renderer) {
        return renderer.getFontSize();
      }
    }
    return defaultFontSize;
  }

  const lastFocusRestoreRef = useRef(0);
  const inputProbeArmedRef = useRef(false);
  const restoreFocusOnWindowFocusRef = useRef(false);
  // Only a genuine OS window re-activation ("window-focus") escalates to native
  // WebView2 focus; in-app activations stay DOM-only (see restoreFocusedTerminalPane).
  type TerminalFocusRestoreReason = "workspace-activated" | "window-focus" | "titlebar";
  function restoreFocusedTerminalPane(reason: TerminalFocusRestoreReason) {
    logTerminalFocusDiagnostic(`restore:${reason}`);
    if (shouldPreserveTerminalWorkspaceFocus()) {
      return;
    }
    // Re-entrancy guard: a single activation must not be able to spin. Native
    // focus calls below can re-emit focus signals on some WebView2 builds.
    const now = Date.now();
    if (now - lastFocusRestoreRef.current < 300) {
      return;
    }
    lastFocusRestoreRef.current = now;
    // Arm the input probe: the diagnostic shows the document already reports
    // focused (hasFocus=true) with the xterm textarea active here, yet input
    // reportedly still needs a click. The probe records whether the next user
    // input after activation is a keystroke (focus really works) or a click
    // (the WebView2 input routing was dead until the click), which the
    // hasFocus/activeElement signals cannot distinguish.
    inputProbeArmedRef.current = true;
    const focusRenderer = () => getPaneRenderer(focusedPaneId)?.focus();
    // Cover the case where DOM focus did leave the terminal (e.g. a title-bar
    // drag parked it on <body>): re-focus the pane's textarea. This is a no-op
    // when it already holds focus.
    focusRenderer();
    window.requestAnimationFrame(focusRenderer);
    // Native focus escalation (window.set_focus -> WebView2 MoveFocus) re-arms
    // the WebView2 content window's OS keyboard focus. That is only necessary
    // when the OS actually moved keyboard focus off our window -- an Alt+Tab /
    // taskbar return ("window-focus"). On in-app activations ("workspace-
    // activated", "titlebar") the WebView2 content still owns native keyboard
    // focus, so escalating there forces focus onto the terminal and steals it
    // from whatever pane/control the UI legitimately routed focus to during the
    // module switch (the #269/#270 regression). Keep in-app paths DOM-only.
    if (reason === "window-focus" && isTauriRuntime()) {
      void focusMainWindow()
        .then(() => focusCurrentWebview())
        .catch(() => undefined)
        .finally(() => {
          window.requestAnimationFrame(focusRenderer);
          logTerminalFocusDiagnostic(`restored:${reason}`);
        });
    } else {
      logTerminalFocusDiagnostic(`restored:${reason}`);
    }
  }

  function describeProbeTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return String(target);
    }
    return `${target.tagName.toLowerCase()}${target.className ? `.${target.className.split(/\s+/).join(".")}` : ""}`;
  }

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const restore = () => restoreFocusedTerminalPane("workspace-activated");
    const frameId = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(frameId);
  }, [focusedPaneId, isActive]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    // Restore terminal input focus after native app activation only when the
    // active terminal owned focus before the app blurred. Keep the xterm focus
    // path pane-local instead of stealing focus on every window activation.
    const handleWindowBlur = () => {
      restoreFocusOnWindowFocusRef.current = shouldRestoreTerminalFocusAfterWindowBlur();
    };
    const handleWindowFocus = () => {
      if (!restoreFocusOnWindowFocusRef.current) {
        return;
      }
      restoreFocusOnWindowFocusRef.current = false;
      restoreFocusedTerminalPane("window-focus");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handleWindowBlur();
      } else if (document.visibilityState === "visible") {
        handleWindowFocus();
      }
    };
    const handleTitlebarPointerUp = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target?.closest(".app-titlebar") || target.closest("button")) {
        return;
      }
      restoreFocusedTerminalPane("titlebar");
    };
    // Probe: log the first user input after a focus restore. "keydown-first"
    // means keyboard focus actually worked; "pointerdown-first" means the user
    // had to click before input was accepted (native WebView2 focus issue).
    const handleProbeKeydown = (event: Event) => {
      if (!inputProbeArmedRef.current) {
        return;
      }
      inputProbeArmedRef.current = false;
      logTerminalFocusDiagnostic(`input-after-activation:keydown:${describeProbeTarget(event.target)}`);
    };
    const handleProbePointerdown = (event: Event) => {
      if (!inputProbeArmedRef.current) {
        return;
      }
      inputProbeArmedRef.current = false;
      logTerminalFocusDiagnostic(`input-after-activation:pointerdown:${describeProbeTarget(event.target)}`);
    };

    let disposed = false;
    let removeNativeFocusListener: (() => void) | undefined;

    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("pointerup", handleTitlebarPointerUp, true);
    document.addEventListener("keydown", handleProbeKeydown, true);
    document.addEventListener("pointerdown", handleProbePointerdown, true);
    if (isTauriRuntime()) {
      void listen<boolean>(MAIN_WINDOW_FOCUS_CHANGED_EVENT, (event) => {
        if (event.payload) {
          handleWindowFocus();
        } else {
          handleWindowBlur();
        }
      }).then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          removeNativeFocusListener = unlisten;
        }
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("pointerup", handleTitlebarPointerUp, true);
      document.removeEventListener("keydown", handleProbeKeydown, true);
      document.removeEventListener("pointerdown", handleProbePointerdown, true);
      removeNativeFocusListener?.();
    };
  }, [focusedPaneId, isActive]);

  function handleFontChange(delta: number | "reset") {
    const next = delta === "reset" ? defaultFontSize : currentFontSize() + delta;
    const clamped = Math.min(Math.max(Math.round(next), 6), 64);
    applyFontSizeToPanes(clamped);
  }

  return (
    <section
      className={[
        "terminal-workspace",
        isActive ? "active" : "",
        isSingleEmbeddedPane ? "terminal-workspace-embedded-only" : "",
        maximizedPaneId ? "terminal-workspace-pane-maximized" : "",
        quickCommandBarVisible ? "quick-command-bar-visible" : "",
        workspaceTerminalBackground ? "terminal-workspace-has-background" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <TerminalBackgroundLayer active={isActive} background={workspaceTerminalBackground} />
      <div className="terminal-grid">
        {layout ? (
          <TerminalLayoutView
            isActive={isActive}
            tabId={tab.id}
            layout={layout}
            panes={tab.panes}
            focusedPaneId={focusedPaneId}
            maximizedPaneId={maximizedPaneId}
            canCloseSinglePane={canCloseSinglePane}
            onFocusPane={(paneId) => setFocusedPane(tab.id, paneId)}
            canSplit={canSplit}
            usePaneTerminalBackgrounds={usePaneTerminalBackgrounds}
            onFontChange={handleFontChange}
            onOpenAssistant={onOpenAssistant}
            onOpenSftp={openSftpDialog}
            onSaveBuffer={(paneId) => void handleSaveBuffer(paneId)}
            showSftpButton={showSftpButton}
            onSplit={handleSplit}
            quickCommandBarVisible={quickCommandBarVisible}
            onToggleQuickCommandBar={() => setQuickCommandBarVisible(tab.id, !quickCommandBarVisible)}
          />
        ) : null}
      </div>
      {quickCommandBarVisible ? <QuickCommandBar tab={tab} /> : null}
      {sftpDialogTab ? createPortal(
        <div className="dialog-backdrop connection-dialog-backdrop sftp-popup-dialog-backdrop" role="presentation">
          <section
            aria-label={t("terminal.openSftp")}
            aria-modal="true"
            className="connection-dialog sftp-popup-dialog"
            role="dialog"
          >
            <header className="connection-dialog-header compact">
              <div>
                <h2>{t("terminal.openSftp")}</h2>
              </div>
              <button
                aria-label={t("common.close")}
                className="connection-dialog-close"
                onClick={closeSftpDialog}
                type="button"
              >
                <X size={15} />
              </button>
            </header>
            <div className="sftp-popup-dialog-body">
              <SftpWorkspace isActive={true} tab={sftpDialogTab} inline />
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}

function TerminalLayoutView({
  isActive,
  tabId,
  layout,
  panes,
  focusedPaneId,
  maximizedPaneId,
  canCloseSinglePane,
  onFocusPane,
  canSplit,
  usePaneTerminalBackgrounds,
  onFontChange,
  onOpenAssistant,
  onOpenSftp,
  onSaveBuffer,
  showSftpButton,
  onSplit,
  quickCommandBarVisible,
  onToggleQuickCommandBar,
}: {
  isActive: boolean;
  tabId: string;
  layout: LayoutNode;
  panes: WorkspacePane[];
  focusedPaneId: string | undefined;
  maximizedPaneId?: string;
  canCloseSinglePane: boolean;
  onFocusPane: (paneId: string) => void;
  canSplit: boolean;
  usePaneTerminalBackgrounds: boolean;
  onFontChange: (delta: number | "reset") => void;
  onOpenAssistant: () => void;
  onOpenSftp: (connection: Connection, paneId: string) => void;
  onSaveBuffer: (paneId: string) => void;
  showSftpButton: boolean;
  onSplit: (paneId: string, direction: "right" | "left" | "down" | "up") => void;
  quickCommandBarVisible: boolean;
  onToggleQuickCommandBar: () => void;
}) {
  if (layout.type === "leaf") {
    const pane = panes.find((entry) => entry.id === layout.paneId);
    if (!pane) {
      return null;
    }
    const isPaneMaximized = maximizedPaneId === pane.id;
    const isPaneHidden = Boolean(maximizedPaneId && !isPaneMaximized);
    return (
      <div
        className={[
          "terminal-layout-leaf",
          isPaneMaximized ? "terminal-layout-maximized" : "",
          isPaneHidden ? "terminal-layout-hidden" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {isTerminalPane(pane) ? (
          <TerminalPaneView
            isActive={isActive && !isPaneHidden}
            tabId={tabId}
            pane={pane}
            isFocused={pane.id === focusedPaneId}
            onFocus={() => onFocusPane(pane.id)}
            canSplit={canSplit}
            canClosePane={panes.length > 1 || canCloseSinglePane}
            onFontChange={onFontChange}
            usePaneTerminalBackgrounds={usePaneTerminalBackgrounds}
            onOpenAssistant={onOpenAssistant}
            onOpenSftp={onOpenSftp}
            onSaveBuffer={onSaveBuffer}
            showSftpButton={showSftpButton}
            onSplit={onSplit}
            quickCommandBarVisible={quickCommandBarVisible}
            onToggleQuickCommandBar={onToggleQuickCommandBar}
          />
        ) : (
          <EmbeddedConnectionPane
            isActive={isActive && !isPaneHidden}
            pane={pane}
            tabId={tabId}
            canClosePane={panes.length > 1 || canCloseSinglePane}
            onOpenAssistant={onOpenAssistant}
            onFocus={() => onFocusPane(pane.id)}
          />
        )}
      </div>
    );
  }

  const className =
    layout.orientation === "horizontal"
      ? "terminal-layout-split terminal-layout-split-horizontal"
      : "terminal-layout-split terminal-layout-split-vertical";
  const hiddenByMaximizedPane = Boolean(
    maximizedPaneId && !layoutContainsPane(layout, maximizedPaneId),
  );

  return (
    <div className={`${className}${hiddenByMaximizedPane ? " terminal-layout-hidden" : ""}`}>
      {layout.children.map((child, index) => (
        <TerminalLayoutView
          key={child.type === "leaf" ? child.paneId : `split-${index}`}
          isActive={isActive}
          tabId={tabId}
          layout={child}
          panes={panes}
          focusedPaneId={focusedPaneId}
          maximizedPaneId={maximizedPaneId}
          canCloseSinglePane={canCloseSinglePane}
          onFocusPane={onFocusPane}
          canSplit={canSplit}
          usePaneTerminalBackgrounds={usePaneTerminalBackgrounds}
          onFontChange={onFontChange}
          onOpenAssistant={onOpenAssistant}
          onOpenSftp={onOpenSftp}
          onSaveBuffer={onSaveBuffer}
          showSftpButton={showSftpButton}
          onSplit={onSplit}
          quickCommandBarVisible={quickCommandBarVisible}
          onToggleQuickCommandBar={onToggleQuickCommandBar}
        />
      ))}
    </div>
  );
}

function layoutContainsPane(layout: LayoutNode, paneId: string): boolean {
  if (layout.type === "leaf") {
    return layout.paneId === paneId;
  }
  return layout.children.some((child) => layoutContainsPane(child, paneId));
}

function isTerminalPane(pane: WorkspacePane): pane is TerminalPane {
  return pane.kind === undefined || pane.kind === "terminal";
}

function EmbeddedConnectionPane({
  isActive,
  pane,
  tabId,
  canClosePane,
  onOpenAssistant,
  onFocus,
}: {
  isActive: boolean;
  pane: Exclude<WorkspacePane, TerminalPane>;
  tabId: string;
  canClosePane: boolean;
  onOpenAssistant: () => void;
  onFocus: () => void;
}) {
  const closePane = useWorkspaceStore((state) => state.closePane);
  const { t } = useTranslation();
  const embeddedTab: WorkspaceTab = {
    id: pane.id,
    title: pane.title,
    subtitle:
      pane.kind === "webview"
        ? formatUrlPaneSubtitle(pane.url)
        : formatRemoteDesktopPaneSubtitle(pane.connection),
    kind: pane.kind,
    panes: [],
    connection: pane.connection,
    url: pane.kind === "webview" ? pane.url : undefined,
    dataPartition: pane.kind === "webview" ? pane.dataPartition : undefined,
  };

  return (
    <article
      className="embedded-workspace-pane"
      onMouseDown={onFocus}
    >
      {canClosePane ? (
        <button
          aria-label={t("workspace.closeTab", { title: pane.title })}
          className="embedded-pane-close"
          onClick={() => closePane(tabId, pane.id)}
          title={t("workspace.closeTab", { title: pane.title })}
          type="button"
        >
          <X size={13} />
        </button>
      ) : null}
      {pane.kind === "webview" ? (
        <WebViewWorkspace
          isActive={isActive}
          onOpenAssistant={onOpenAssistant}
          tab={embeddedTab}
        />
      ) : (
        <RemoteDesktopWorkspace
          isActive={isActive}
          onOpenAssistant={onOpenAssistant}
          tab={embeddedTab}
        />
      )}
    </article>
  );
}

function formatUrlPaneSubtitle(url: string) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function formatRemoteDesktopPaneSubtitle(connection: Connection) {
  return connection.user?.trim() || connection.host;
}

function TmuxSessionTag({
  connection,
  onMouseModeChange,
  sessionId,
  tabId,
}: {
  connection: Connection;
  onMouseModeChange: (enabled: boolean) => void;
  sessionId?: string;
  tabId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [error, setError] = useState("");
  const [renameDraft, setRenameDraft] = useState(sessionId ?? "");
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [mouseEnabledIds, setMouseEnabledIds] = useState<Set<string>>(
    () => new Set(sessionId ? [sessionId] : []),
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();

  const tabs = useWorkspaceStore((state) => state.tabs);
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const setFocusedPane = useWorkspaceStore((state) => state.setFocusedPane);
  const openTmuxSessionInPane = useWorkspaceStore((state) => state.openTmuxSessionInPane);
  const renameTmuxSessionInOpenPanes = useWorkspaceStore((state) => state.renameTmuxSessionInOpenPanes);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);

  const enabled = connection.type === "ssh" && connection.useTmuxSessions !== false && sessionId;
  const renameInputId = useMemo(
    () => `tmux-session-name-${tabId}-${editingSessionId ?? sessionId ?? "active"}`.replace(/[^A-Za-z0-9_-]/g, "-"),
    [editingSessionId, sessionId, tabId],
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    setMouseEnabledIds((prev) => {
      if (prev.has(sessionId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
  }, [sessionId]);

  useEffect(() => {
    if (!editingSessionId) {
      setRenameDraft(sessionId ?? "");
      setRenameError("");
    }
  }, [editingSessionId, sessionId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function findSessionPane(tmuxSessionId: string): { tabId: string; paneId: string } | null {
    for (const tab of tabs) {
      if (tab.kind !== "terminal") continue;
      for (const pane of tab.panes) {
        if (isTerminalPane(pane) && pane.tmuxSessionId === tmuxSessionId) {
          return { tabId: tab.id, paneId: pane.id };
        }
      }
    }
    return null;
  }

  async function loadSessions() {
    if (!enabled || !isTauriRuntime()) {
      setSessions([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await invokeCommand("list_tmux_sessions", {
        request: tmuxConnectionRequest(connection),
      });
      setSessions(result);
    } catch (loadError) {
      setSessions([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    setExpandedSessionId(null);
    if (nextOpen) {
      await loadSessions();
    }
  }

  async function handleCloseSession(targetSessionId: string) {
    setLoading(true);
    setError("");
    try {
      await invokeCommand("close_tmux_session", {
        request: {
          ...tmuxConnectionRequest(connection),
          tmuxSessionId: targetSessionId,
        },
      });
      forgetTmuxSessionId(connection.id, targetSessionId);
      setMouseEnabledIds((prev) => {
        const next = new Set(prev);
        next.delete(targetSessionId);
        return next;
      });
      await loadSessions();
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : String(closeError));
    } finally {
      setLoading(false);
    }
  }

  function validateTmuxSessionName(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return t("terminal.tmuxSessionNameRequired");
    }
    if (!/^[^\s:;]+$/u.test(trimmed)) {
      return t("terminal.tmuxSessionNameInvalid");
    }
    return "";
  }

  function handleStartRename(targetSessionId: string) {
    setRenameDraft(targetSessionId);
    setRenameError("");
    setEditingSessionId(targetSessionId);
  }

  function handleCancelRename() {
    setEditingSessionId(null);
    setRenameDraft(sessionId ?? "");
    setRenameError("");
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSessionId) {
      return;
    }
    const nextSessionId = renameDraft.trim();
    const validationError = validateTmuxSessionName(nextSessionId);
    if (validationError) {
      setRenameError(validationError);
      return;
    }
    if (nextSessionId === editingSessionId) {
      handleCancelRename();
      return;
    }
    setRenaming(true);
    setRenameError("");
    try {
      await invokeCommand("rename_tmux_session", {
        request: {
          ...tmuxConnectionRequest(connection),
          tmuxSessionId: editingSessionId,
          newTmuxSessionId: nextSessionId,
        },
      });
      renameTmuxSessionInOpenPanes(connection.id, editingSessionId, nextSessionId);
      setMouseEnabledIds((prev) => {
        const next = new Set(prev);
        if (next.delete(editingSessionId)) {
          next.add(nextSessionId);
        }
        return next;
      });
      setSessions((current) =>
        current.map((session) =>
          session.id === editingSessionId ? { ...session, id: nextSessionId } : session,
        ),
      );
      setEditingSessionId(null);
      showStatusBarNotice(t("terminal.tmuxSessionRenamed"));
    } catch (renameErrorValue) {
      setRenameError(renameErrorValue instanceof Error ? renameErrorValue.message : String(renameErrorValue));
    } finally {
      setRenaming(false);
    }
  }

  async function handleToggleMouse(targetSessionId: string) {
    const nextEnabled = !mouseEnabledIds.has(targetSessionId);
    try {
      await invokeCommand("set_tmux_mouse", {
        request: {
          ...tmuxConnectionRequest(connection),
          tmuxSessionId: targetSessionId,
          enabled: nextEnabled,
        },
      });
      setMouseEnabledIds((prev) => {
        const next = new Set(prev);
        if (nextEnabled) {
          next.add(targetSessionId);
        } else {
          next.delete(targetSessionId);
        }
        return next;
      });
      if (targetSessionId === sessionId) {
        onMouseModeChange(nextEnabled);
      }
      window.dispatchEvent(
        new CustomEvent(TMUX_MOUSE_MODE_EVENT, {
          detail: { enabled: nextEnabled, sessionId: targetSessionId },
        }),
      );
    } catch (mouseError) {
      setError(mouseError instanceof Error ? mouseError.message : String(mouseError));
    }
  }

  function handleSessionRowClick(session: TmuxSession) {
    const location = findSessionPane(session.id);
    if (location) {
      activateTab(location.tabId);
      setFocusedPane(location.tabId, location.paneId);
      setOpen(false);
    } else {
      setExpandedSessionId((current) => (current === session.id ? null : session.id));
    }
  }

  function handleOpenInDirection(session: TmuxSession, direction: SplitDirection) {
    openTmuxSessionInPane(tabId, connection, session.id, direction);
    setOpen(false);
  }

  if (!enabled) {
    return null;
  }

  return (
    <div className="tmux-session-wrapper" data-tutorial-id="terminal.tmuxSessions" ref={menuRef}>
      <div className="tmux-session-tag-group">
        <button
          className="tmux-session-tag"
          {...dialogButtonAria(open)}
          onClick={() => void handleToggle()}
          title={t("terminal.showTmux")}
          type="button"
        >
          <span>tmux {sessionId}</span>
        </button>
      </div>
      {open ? (
        <div className="tmux-session-menu" role="dialog" aria-label={t("terminal.tmuxSessions")}>
          <header>
            <strong>{t("terminal.tmuxSessions")}</strong>
            <button
              className="terminal-pane-action"
              aria-label={t("terminal.refreshTmux")}
              onClick={() => void loadSessions()}
              title={t("terminal.refreshTmux")}
              type="button"
            >
              <RefreshCw size={13} />
            </button>
          </header>
          {loading ? <p>{t("terminal.loading")}</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
          {!loading && !error && sessions.length === 0 ? <p>{t("terminal.noTmuxSessions")}</p> : null}
          <div className="tmux-session-list">
            {sessions.map((session) => {
              const location = findSessionPane(session.id);
              const isInApp = location !== null;
              const isExpanded = expandedSessionId === session.id;
              const isRenaming = editingSessionId === session.id;
              const mouseOn = mouseEnabledIds.has(session.id);
              const sessionLabel = session.id;
              const sessionStatus = isInApp
                ? t("terminal.open")
                : session.attached
                  ? t("terminal.attached")
                  : t("terminal.detached");

              return (
                <div className="tmux-session-row" key={session.id}>
                  <div className="tmux-session-row-main">
                    {isRenaming ? (
                      <form className="tmux-session-rename" onSubmit={(event) => void handleRenameSubmit(event)}>
                        <label className="sr-only" htmlFor={renameInputId}>
                          {t("terminal.tmuxSessionName")}
                        </label>
                        <input
                          autoFocus
                          id={renameInputId}
                          value={renameDraft}
                          onChange={(event) => {
                            setRenameDraft(event.target.value);
                            setRenameError("");
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              handleCancelRename();
                            }
                          }}
                          {...ariaInvalid(Boolean(renameError))}
                        />
                        <button
                          className="terminal-pane-action"
                          aria-label={t("common.save")}
                          disabled={renaming}
                          title={t("common.save")}
                          type="submit"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          className="terminal-pane-action"
                          aria-label={t("common.cancel")}
                          disabled={renaming}
                          onClick={handleCancelRename}
                          title={t("common.cancel")}
                          type="button"
                        >
                          <X size={13} />
                        </button>
                      </form>
                    ) : (
                      <button
                        className={`tmux-session-row-info${isInApp ? " in-app" : ""}`}
                        onClick={() => handleSessionRowClick(session)}
                        title={isInApp ? t("terminal.focusPane") : t("terminal.openInPane")}
                        type="button"
                      >
                        <strong>{sessionLabel}</strong>
                        <small>
                          {sessionStatus}
                          {" · "}
                          {session.windows}w
                        </small>
                      </button>
                    )}
                    <button
                      className="tmux-session-edit-button"
                      aria-label={`${t("terminal.editTmuxSession")} ${sessionLabel}`}
                      disabled={renaming}
                      onClick={() => handleStartRename(session.id)}
                      title={t("terminal.editTmuxSession")}
                      type="button"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className={`tmux-mouse-toggle${mouseOn ? " active" : ""}`}
                      aria-label={`${mouseOn ? t("terminal.mouseOn") : t("terminal.mouseOff")} ${sessionLabel}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleToggleMouse(session.id)}
                      title={mouseOn ? t("terminal.mouseOn") : t("terminal.mouseOff")}
                      type="button"
                    >
                      <Mouse size={11} />
                    </button>
                    <button
                      className="terminal-pane-action"
                      aria-label={`${t("terminal.closeTmux")} ${sessionLabel}`}
                      onClick={() => void handleCloseSession(session.id)}
                      title={t("terminal.closeTmux")}
                      type="button"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  {isRenaming && renameError ? <p className="tmux-session-rename-error form-error">{renameError}</p> : null}
                  {!isInApp && isExpanded ? (
                    <div className="tmux-session-directions">
                      <button
                        className="tmux-direction-btn"
                        onClick={() => handleOpenInDirection(session, "left")}
                        title={t("terminal.openLeft")}
                        type="button"
                      >
                        <ArrowLeft size={12} />
                      </button>
                      <button
                        className="tmux-direction-btn"
                        onClick={() => handleOpenInDirection(session, "up")}
                        title={t("terminal.openAbove")}
                        type="button"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        className="tmux-direction-btn"
                        onClick={() => handleOpenInDirection(session, "down")}
                        title={t("terminal.openBelow")}
                        type="button"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        className="tmux-direction-btn"
                        onClick={() => handleOpenInDirection(session, "right")}
                        title={t("terminal.openRight")}
                        type="button"
                      >
                        <ArrowRight size={12} />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function tmuxConnectionRequest(connection: Connection) {
  return {
    host: connection.host,
    user: connection.user,
    port: connection.port,
    keyPath: connection.keyPath,
    proxyJump: connection.proxyJump,
    authMethod: connection.authMethod,
    secretOwnerId: connectionPasswordOwnerId(connection),
  };
}

function XServerToolbarIndicator({
  status,
}: {
  status: "disabled" | "enabled" | "rejected";
}) {
  const { t } = useTranslation();
  return (
    <button
      aria-label={t("settings.xServer")}
      className={`terminal-pane-action tmux-x11-button ${status}`}
      disabled
      title={t("settings.xServer")}
      type="button"
    >
      <Monitor size={13} />
    </button>
  );
}

function SshPortForwardMenu({
  connection,
  triggerClassName = "terminal-pane-action",
  triggerLabel,
  triggerRole,
}: {
  connection: Connection;
  triggerClassName?: string;
  triggerLabel?: string;
  triggerRole?: "menuitem";
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ports, setPorts] = useState<RemoteLoopbackPort[]>([]);
  const [error, setError] = useState("");
  const [openingPort, setOpeningPort] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openSshPortForwardBrowser = useWorkspaceStore((state) => state.openSshPortForwardBrowser);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  async function loadPorts() {
    if (!isTauriRuntime()) {
      setPorts([]);
      setError(t("terminal.tauriRequired"));
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await invokeCommand("list_remote_loopback_ports", {
        request: tmuxConnectionRequest(connection),
      });
      setPorts(result);
    } catch (loadError) {
      setPorts([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      await loadPorts();
    }
  }

  async function handleOpenPort(port: number) {
    setOpeningPort(port);
    setError("");
    try {
      const forward = await invokeCommand("start_ssh_port_forward", {
        request: {
          ...tmuxConnectionRequest(connection),
          remotePort: port,
        },
      });
      openSshPortForwardBrowser(connection, forward);
      showStatusBarNotice(t("terminal.sshPortForwardOpened", { port }));
      setOpen(false);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setOpeningPort(null);
    }
  }

  return (
    <div
      className="tmux-session-wrapper"
      data-tutorial-id="terminal.sshPortRedirect"
      ref={menuRef}
      role={triggerRole ? "none" : undefined}
    >
      <button
        className={triggerClassName}
        aria-label={t("terminal.sshPortRedirect")}
        {...dialogButtonAria(open)}
        onClick={() => void handleToggle()}
        role={triggerRole}
        title={t("terminal.sshPortRedirect")}
        type="button"
      >
        <Network size={13} />
        {triggerLabel ? <span>{triggerLabel}</span> : null}
      </button>
      {open ? (
        <div className="tmux-session-menu ssh-port-menu" role="dialog" aria-label={t("terminal.sshPortRedirect")}>
          <header>
            <strong>{t("terminal.remoteLoopbackPorts")}</strong>
            <button
              className="terminal-pane-action"
              aria-label={t("terminal.refreshPorts")}
              onClick={() => void loadPorts()}
              title={t("terminal.refreshPorts")}
              type="button"
            >
              <RefreshCw size={13} />
            </button>
          </header>
          {loading ? <p>{t("terminal.scanningPorts")}</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
          {!loading && !error && ports.length === 0 ? <p>{t("terminal.noRemoteLoopbackPorts")}</p> : null}
          <div className="tmux-session-list">
            {ports.map((entry) => (
              <div className="tmux-session-row ssh-port-row" key={`${entry.address}-${entry.port}`}>
                <div className="tmux-session-row-main">
                  <div className="tmux-session-row-info" aria-label={t("terminal.remoteLoopbackPort", { port: entry.port })}>
                    <strong>{t("terminal.remoteLoopbackPort", { port: entry.port })}</strong>
                    <small>{entry.address}</small>
                  </div>
                  <button
                    className="terminal-pane-action"
                    aria-label={t("terminal.openPortInBrowser", { port: entry.port })}
                    disabled={openingPort !== null}
                    onClick={() => void handleOpenPort(entry.port)}
                    title={t("terminal.openPortInBrowser", { port: entry.port })}
                    type="button"
                  >
                    {openingPort === entry.port ? <RefreshCw size={13} /> : <Globe2 size={13} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export async function inspectActiveSshSystemContext(tab: WorkspaceTab | undefined) {
  const connection =
    tab?.connection?.type === "ssh"
      ? tab.connection
      : tab?.panes.find((pane) => pane.connection?.type === "ssh")?.connection;
  if (!connection) {
    return undefined;
  }
  try {
    const context = await invokeCommand("inspect_ssh_system_context", {
      request: tmuxConnectionRequest(connection),
    });
    return [
      i18next.t("terminal.connectLabel", { name: connection.name }),
      i18next.t("terminal.targetLabel", { target: `${connection.user}@${connection.host}${connection.port ? `:${connection.port}` : ""}` }),
      context.trim(),
    ]
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    return [
      i18next.t("terminal.connectLabel", { name: connection.name }),
      i18next.t("terminal.targetLabel", { target: `${connection.user}@${connection.host}${connection.port ? `:${connection.port}` : ""}` }),
      i18next.t("terminal.sshContextUnavailable", { message: error instanceof Error ? error.message : String(error) }),
    ]
      .join("\n");
  }
}

function TerminalPaneView({
  isActive,
  tabId,
  pane,
  isFocused,
  onFocus,
  canSplit,
  canClosePane,
  onFontChange,
  usePaneTerminalBackgrounds,
  onOpenAssistant,
  onOpenSftp,
  onSaveBuffer,
  showSftpButton,
  onSplit,
  quickCommandBarVisible,
  onToggleQuickCommandBar,
}: {
  isActive: boolean;
  tabId: string;
  pane: TerminalPane;
  isFocused: boolean;
  onFocus: () => void;
  canSplit: boolean;
  canClosePane: boolean;
  onFontChange: (delta: number | "reset") => void;
  usePaneTerminalBackgrounds: boolean;
  onOpenAssistant: () => void;
  onOpenSftp: (connection: Connection, paneId: string) => void;
  onSaveBuffer: (paneId: string) => void;
  showSftpButton: boolean;
  onSplit: (paneId: string, direction: "right" | "left" | "down" | "up") => void;
  quickCommandBarVisible: boolean;
  onToggleQuickCommandBar: () => void;
}) {
  const paneRef = useRef<HTMLElement | null>(null);
  const terminalElementRef = useRef<HTMLDivElement | null>(null);
  const terminalRendererRef = useRef<TerminalRenderer | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastResizeDimensionsRef = useRef<TerminalDimensions | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeTimeoutRefs = useRef<number[]>([]);
  const fitAndResizeRef = useRef<() => void>(() => undefined);
  const isActiveRef = useRef(isActive);
  const startedRef = useRef(false);
  const tmuxWheelFlushTimerRef = useRef<number | null>(null);
  const tmuxWheelPendingLinesRef = useRef(0);
  const tmuxStartupOutputTailRef = useRef("");
  const multilinePasteConfirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResult, setSearchResult] = useState<{
    resultIndex: number;
    resultCount: number;
    found: boolean;
  }>({ resultIndex: -1, resultCount: 0, found: true });
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [backgroundPopoverOpen, setBackgroundPopoverOpen] = useState(false);
  const [selectedTerminalText, setSelectedTerminalText] = useState("");
  const [contextMenu, setContextMenu] = useState<TerminalContextMenuState | null>(null);
  const [multilinePasteConfirmationOpen, setMultilinePasteConfirmationOpen] = useState(false);
  const [recordingInfo, setRecordingInfo] = useState<TerminalRecordingInfo | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [tmuxMouseEnabled, setTmuxMouseEnabled] = useState(true);
  function focusTerminalRenderer() {
    const renderer = terminalRendererRef.current;
    if (renderer) {
      focusTerminalUnlessExternalInputIsActive(renderer, paneRef.current);
    }
  }

  function focusTerminalRendererFromSurface() {
    onFocus();
    focusTerminalRenderer();
  }

  function handleTerminalSurfacePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    focusTerminalRendererFromSurface();
  }

  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const terminalSettings = useWorkspaceStore((state) => state.terminalSettings);
  const sshSettings = useWorkspaceStore((state) => state.sshSettings);
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const x11ForwardingStatus = pane.x11ForwardingStatus ?? (
    pane.connection?.type === "ssh" && sshSettings.managedXServerEnabled ? "enabled" : "disabled"
  );
  const setAssistantContextSnippet = useWorkspaceStore(
    (state) => state.setAssistantContextSnippet,
  );
  const submitAssistantContextSnippet = useWorkspaceStore(
    (state) => state.submitAssistantContextSnippet,
  );
  const markConnectionSessionStarted = useWorkspaceStore(
    (state) => state.markConnectionSessionStarted,
  );
  const markConnectionSessionEnded = useWorkspaceStore(
    (state) => state.markConnectionSessionEnded,
  );
  const recordTerminalStartMetric = useWorkspaceStore(
    (state) => state.recordTerminalStartMetric,
  );
  const clearTerminalStartMetric = useWorkspaceStore(
    (state) => state.clearTerminalStartMetric,
  );
  const closePane = useWorkspaceStore((state) => state.closePane);
  const updatePaneCwd = useWorkspaceStore((state) => state.updatePaneCwd);
  const updateOpenConnectionTerminalAppearance = useWorkspaceStore((state) => state.updateOpenConnectionTerminalAppearance);
  const updateOpenTerminalPaneAppearance = useWorkspaceStore((state) => state.updateOpenTerminalPaneAppearance);
  const updateOpenTerminalPaneBackground = useWorkspaceStore((state) => state.updateOpenTerminalPaneBackground);
  const updateOpenTerminalPaneX11ForwardingStatus = useWorkspaceStore((state) => state.updateOpenTerminalPaneX11ForwardingStatus);
  const markOpenTerminalPaneTmuxUnavailable = useWorkspaceStore((state) => state.markOpenTerminalPaneTmuxUnavailable);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const { t } = useTranslation();
  const terminalOpacity =
    pane.connection?.terminalOpacity ?? (100 - terminalSettings.defaultTransparency);
  const terminalTransparency = 100 - terminalOpacity;
  const terminalBackground = usePaneTerminalBackgrounds
    ? (pane.terminalBackground ?? pane.connection?.terminalBackground ?? null)
    : (pane.connection?.terminalBackground ?? null);

  useEffect(() => {
    return () => {
      if (tmuxWheelFlushTimerRef.current !== null) {
        window.clearTimeout(tmuxWheelFlushTimerRef.current);
        tmuxWheelFlushTimerRef.current = null;
      }
      multilinePasteConfirmationResolverRef.current?.(false);
      multilinePasteConfirmationResolverRef.current = null;
    };
  }, []);

  useEffect(() => {
    setTmuxMouseEnabled(true);
  }, [pane.tmuxSessionId]);

  useEffect(() => {
    function handleTmuxMouseModeEvent(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (
        !detail ||
        detail.sessionId !== pane.tmuxSessionId ||
        typeof detail.enabled !== "boolean"
      ) {
        return;
      }
      setTmuxMouseEnabled(detail.enabled);
    }

    window.addEventListener(TMUX_MOUSE_MODE_EVENT, handleTmuxMouseModeEvent);
    return () => window.removeEventListener(TMUX_MOUSE_MODE_EVENT, handleTmuxMouseModeEvent);
  }, [pane.tmuxSessionId]);

  function requestMultilinePasteConfirmation() {
    multilinePasteConfirmationResolverRef.current?.(false);
    setMultilinePasteConfirmationOpen(true);
    return new Promise<boolean>((resolve) => {
      multilinePasteConfirmationResolverRef.current = resolve;
    });
  }

  function resolveMultilinePasteConfirmation(confirmed: boolean) {
    multilinePasteConfirmationResolverRef.current?.(confirmed);
    multilinePasteConfirmationResolverRef.current = null;
    setMultilinePasteConfirmationOpen(false);
  }

  async function writeWithPasteConfirmation(data: string, writeInput: (input: string) => void) {
    if (terminalSettings.confirmMultilinePaste && isMultilinePaste(data)) {
      const shouldPaste = await requestMultilinePasteConfirmation();
      if (!shouldPaste) {
        return;
      }
    }

    writeInput(data);
  }

  function flushTmuxWheelScroll() {
    tmuxWheelFlushTimerRef.current = null;
    const lines = Math.max(-120, Math.min(120, tmuxWheelPendingLinesRef.current));
    tmuxWheelPendingLinesRef.current = 0;
    if (!lines || pane.connection?.type !== "ssh" || !pane.tmuxSessionId) {
      return;
    }

    void invokeCommand("scroll_tmux_pane", {
      request: {
        ...tmuxConnectionRequest(pane.connection),
        tmuxSessionId: pane.tmuxSessionId,
        lines,
      },
    }).catch((error) => {
      console.warn("tmux wheel scroll failed.", error);
    });
  }

  function handleTmuxWheelScroll(lines: number) {
    tmuxWheelPendingLinesRef.current += lines;
    if (tmuxWheelFlushTimerRef.current !== null) {
      return;
    }
    tmuxWheelFlushTimerRef.current = window.setTimeout(flushTmuxWheelScroll, 40);
  }

  useEffect(() => {
    if (!actionsMenuOpen) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (actionsMenuRef.current && target && !actionsMenuRef.current.contains(target)) {
        setActionsMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [actionsMenuOpen]);

  useEffect(() => {
    function handleExternalPointerDown(event: PointerEvent) {
      const renderer = terminalRendererRef.current;
      const target = event.target as Node | null;
      if (!renderer || !target || paneRef.current?.contains(target)) {
        return;
      }

      renderer.blur();
      focusExternalPointerTarget(target);
    }

    document.addEventListener("pointerdown", handleExternalPointerDown, true);
    return () => document.removeEventListener("pointerdown", handleExternalPointerDown, true);
  }, []);

  useEffect(() => {
    const element = terminalElementRef.current;
    const connection = pane.connection;
    if (!element || !connection || startedRef.current) {
      return;
    }

    startedRef.current = true;
    const rendererSettings =
      connection.type === "ssh"
        ? {
            ...terminalSettings,
            scrollbackLines: sshSettings.bufferLines,
            allowOsc52Clipboard: sshSettings.allowOsc52Clipboard,
          }
        : terminalSettings;
    const terminalHost = element;
    const terminal = createTerminalRenderer(rendererSettings, terminalOpacity);
    terminalRendererRef.current = terminal;
    const cwdDisposable = terminal.onCwdChange((cwd) => updatePaneCwd(tabId, pane.id, cwd));
    terminal.setWheelScrollbackOverride(Boolean(pane.tmuxSessionId && !tmuxMouseEnabled), handleTmuxWheelScroll);
    terminal.open(element);
    terminal.fit();
    focusTerminalUnlessExternalInputIsActive(terminal, paneRef.current);
    // A freshly opened terminal holds DOM focus on its textarea but the
    // WebView2 content does not yet own OS keyboard focus (especially right
    // after a connection dialog closes), so the first keystroke is otherwise
    // dropped until the user clicks. Route native focus into the webview once
    // when this pane is the active, focused one.
    if (isActive && isFocused && isTauriRuntime()) {
      void focusMainWindow()
        .then(() => focusCurrentWebview())
        .catch(() => undefined);
    }
    terminal.attachCustomKeyEventHandler((event) => {
      // xterm.js emits a bare CR for Shift+Enter, indistinguishable from a
      // plain Enter, so Node.js TUIs running inside local PowerShell/cmd/WSL
      // (e.g. Claude Code) submit the line instead of inserting a newline.
      // Translate Shift+Enter to LF here, matching Windows Terminal's
      // behavior. Only for local connections; SSH uses the NativeSsh
      // transport and its own remote PTY semantics.
      if (
        event.type === "keydown" &&
        event.code === "Enter" &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.isComposing &&
        connection.type === "local"
      ) {
        event.preventDefault();
        writeInputToSession(encodeShiftEnterForLocalPty());
        return false;
      }

      if (event.type !== "keydown" || !event.ctrlKey) {
        return true;
      }

      const key = event.key.toLowerCase();
      if ((key === "c" && event.shiftKey) || key === "insert") {
        const selection = terminal.getSelection();
        if (selection) {
          void writeToClipboard(selection);
          setSelectedTerminalText(selection);
          setContextMenu(null);
          return false;
        }
        return true;
      }

      if (key === "v") {
        // Prevent the browser's native paste event from also reaching xterm's
        // hidden textarea — otherwise the clipboard text is written twice.
        event.preventDefault();
        void handlePasteIntoTerminal();
        return false;
      }

      return true;
    });
    registerPaneRenderer(pane.id, terminal);
    const focusDisposable = terminal.onFocus(() => {
      onFocusRef.current();
    });
    const terminalSessionType = terminalSessionTypeFor(connection);
    const preservedRuntime = takePreservedTerminalPaneRuntime(pane.id);
    if (preservedRuntime) {
      terminal.write(terminalBufferSnapshotForWrite(preservedRuntime.bufferText));
    } else {
      terminal.writeln(t("terminal.startingSessionFor", { type: terminalSessionType, name: connection.name }));
    }

    if (!isTauriRuntime()) {
      terminal.writeln(t("terminal.desktopRuntimeRequired"));
      return () => {
        cwdDisposable.dispose();
        focusDisposable.dispose();
        unregisterPaneRenderer(pane.id, terminal);
        terminal.dispose();
      };
    }

    const requestedSessionId = preservedRuntime?.sessionId ?? uniqueRuntimeId(`${connection.id}-terminal`);
    sessionIdRef.current = requestedSessionId;

    let disposed = false;
    let preservingRuntime = false;
    let sessionStarted = preservedRuntime?.sessionStarted ?? false;
    let removeOutputListener: (() => void) | undefined;
    const writeInputToSession = (data: string) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }
      void invokeCommand("write_terminal_input", {
        request: { sessionId, data: encodeTerminalInput(data) },
      });
    };
    registerPaneInputWriter(pane.id, writeInputToSession);
    const dataDisposable = terminal.onData((data) => {
      void writeWithPasteConfirmation(data, writeInputToSession);
    });
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      setSelectedTerminalText(selection);
      if (selection && terminalSettings.copyOnSelect) {
        void navigator.clipboard?.writeText(selection);
      }
    });
    const searchResultsDisposable = terminal.onSearchResultsChange((result) => {
      setSearchResult({
        resultIndex: result.resultIndex,
        resultCount: result.resultCount,
        found: result.resultCount > 0,
      });
    });

    function fitAndResizeTerminal() {
      // Inactive workspace Tabs are display:none. Fitting xterm while hidden can
      // resize Windows ConPTY through a zero/unstable viewport; ConPTY then
      // replays the visible screen on the next real resize, which appends a
      // duplicate-looking terminal buffer after switching back to the Tab.
      if (!isActiveRef.current || terminalHost.clientWidth <= 0 || terminalHost.clientHeight <= 0) {
        return;
      }

      const dimensions = terminal.fit();
      const lastDimensions = lastResizeDimensionsRef.current;
      if (lastDimensions && terminalDimensionsEqual(lastDimensions, dimensions)) {
        return;
      }

      lastResizeDimensionsRef.current = dimensions;
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void invokeCommand("resize_terminal", {
          request: {
            sessionId,
            cols: dimensions.cols,
            pixelHeight: dimensions.pixelHeight,
            pixelWidth: dimensions.pixelWidth,
            rows: dimensions.rows,
          },
        });
      }
    }
    fitAndResizeRef.current = fitAndResizeTerminal;

    function clearScheduledResizeTimeouts() {
      for (const timeoutId of resizeTimeoutRefs.current) {
        window.clearTimeout(timeoutId);
      }
      resizeTimeoutRefs.current = [];
    }

    function scheduleFitAndResizeTerminal() {
      if (resizeFrameRef.current !== null) {
        return;
      }
      clearScheduledResizeTimeouts();

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = window.requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          fitAndResizeTerminal();
        });
      });
      resizeTimeoutRefs.current = [
        window.setTimeout(fitAndResizeTerminal, 80),
        window.setTimeout(fitAndResizeTerminal, 180),
        window.setTimeout(() => {
          fitAndResizeTerminal();
          resizeTimeoutRefs.current = [];
        }, 320),
      ];
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleFitAndResizeTerminal();
    });
    resizeObserver.observe(element);
    window.addEventListener("resize", scheduleFitAndResizeTerminal);
    scheduleFitAndResizeTerminal();
    void document.fonts?.ready.then(() => {
      if (!disposed) {
        scheduleFitAndResizeTerminal();
      }
    });

    void (async () => {
      const unlisten = await listen<TerminalOutput>("terminal-output", (event) => {
        if (event.payload.sessionId === sessionIdRef.current) {
          terminal.write(event.payload.data);
          if (pane.tmuxSessionId) {
            tmuxStartupOutputTailRef.current = (tmuxStartupOutputTailRef.current + event.payload.data).slice(
              -TMUX_UNAVAILABLE_MARKER.length * 2,
            );
            if (tmuxStartupOutputTailRef.current.includes(TMUX_UNAVAILABLE_MARKER)) {
              markOpenTerminalPaneTmuxUnavailable(tabId, pane.id);
            }
          }
        }
      });
      if (disposed) {
        unlisten();
        return;
      }
      removeOutputListener = unlisten;

      if (preservedRuntime) {
        scheduleFitAndResizeTerminal();
        return;
      }

      try {
        if (usesNativeSshHostKeyVerification(connection)) {
          terminal.writeln(t("terminal.verifyingHostKey"));
          const preview = await invokeCommand("inspect_ssh_host_key", {
            request: {
              host: connection.host,
              port: connection.port,
            },
          });
          await confirmTrustedSshHostKey(preview);
        }

        const terminalStartAt = performance.now();
        const terminalDimensions = terminal.dimensions;
        const shell =
          connection.type === "local"
            ? connection.localShell ?? terminalSettings.defaultShell
            : undefined;
        const result = await invokeCommand("start_terminal_session", {
          request: {
            sessionId: requestedSessionId,
            title: connection.name,
            type: terminalSessionType,
            host: connection.host,
            user: connection.user,
            port: connection.port,
            keyPath: connection.keyPath,
            proxyJump: connection.proxyJump,
            authMethod: connection.authMethod,
            secretOwnerId: connectionPasswordOwnerId(connection),
            shell,
            serialLine: connection.type === "serial" ? connection.serialLine ?? connection.host : undefined,
            serialSpeed: connection.type === "serial" ? connection.serialSpeed ?? 9600 : undefined,
            initialDirectory: initialDirectoryForTerminalSession(connection, pane.cwd),
            cols: terminalDimensions.cols,
            pixelHeight: terminalDimensions.pixelHeight,
            pixelWidth: terminalDimensions.pixelWidth,
            rows: terminalDimensions.rows,
            useTmux: connection.type === "ssh" && connection.useTmuxSessions !== false,
            tmuxSessionId: pane.tmuxSessionId,
            sshBufferLines: connection.type === "ssh" ? sshSettings.bufferLines : undefined,
          },
        });
        if (disposed) {
          if (!preservingRuntime) {
            void invokeCommand("close_terminal_session", { sessionId: result.sessionId });
          }
          return;
        }
        const frontendDurationMs = Math.round(performance.now() - terminalStartAt);
        if (terminalSessionType === "ssh" && result.terminalReadyMs === undefined) {
          clearTerminalStartMetric("ssh");
        } else {
          recordTerminalStartMetric({
            kind: terminalSessionType,
            title: connection.name,
            durationMs:
              terminalSessionType === "ssh"
                ? result.terminalReadyMs ?? frontendDurationMs
                : frontendDurationMs,
            recordedAt: new Date().toISOString(),
          });
        }
        sessionIdRef.current = result.sessionId;
        if (connection.type === "ssh") {
          updateOpenTerminalPaneX11ForwardingStatus(
            tabId,
            pane.id,
            result.x11ForwardingStatus ?? x11ForwardingStatus,
          );
        }
        sessionStarted = true;
        const startupInput = localStartupInputFor(connection);
        if (startupInput) {
          writeInputToSession(startupInput);
        }
        markConnectionSessionStarted(connection.id);
      } catch (error) {
        terminal.writeln("");
        terminal.writeln(t("terminal.failedToStartDetail", { message: String(error) }));
      }
    })();

    return () => {
      disposed = true;
      startedRef.current = false;
      dataDisposable.dispose();
      selectionDisposable.dispose();
      searchResultsDisposable.dispose();
      focusDisposable.dispose();
      unregisterPaneInputWriter(pane.id, writeInputToSession);
      unregisterPaneRenderer(pane.id, terminal);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleFitAndResizeTerminal);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      clearScheduledResizeTimeouts();
      if (tmuxWheelFlushTimerRef.current !== null) {
        window.clearTimeout(tmuxWheelFlushTimerRef.current);
        tmuxWheelFlushTimerRef.current = null;
      }
      tmuxWheelPendingLinesRef.current = 0;
      cwdDisposable.dispose();
      removeOutputListener?.();
      const sessionId = sessionIdRef.current;
      preservingRuntime = Boolean(sessionId && shouldPreservePaneRuntimeOnUnmount(pane.id));
      if (sessionId && preservingRuntime) {
        preserveTerminalPaneRuntime(pane.id, {
          bufferText: terminal.getBufferText(),
          sessionId,
          sessionStarted,
        });
      } else if (sessionId) {
        void invokeCommand("close_terminal_session", { sessionId });
      }
      if (sessionStarted && !preservingRuntime) {
        markConnectionSessionEnded(connection.id);
      }
      sessionIdRef.current = null;
      lastResizeDimensionsRef.current = null;
      terminalRendererRef.current = null;
      fitAndResizeRef.current = () => undefined;
      setSelectedTerminalText("");
      setRecordingInfo(null);
      setRecordingBusy(false);
      setRecordingsOpen(false);
      setContextMenu(null);
      setSearchResult({ resultIndex: -1, resultCount: 0, found: true });
      terminal.dispose();
    };
  // A terminal Session belongs to the Pane id. Display metadata updates such
  // as Child Connection Tab rename/icon edits must not tear down and recreate
  // the live SSH/local process.
  }, [pane.id, tabId]);

  useEffect(() => {
    terminalRendererRef.current?.setBackgroundOpacity(terminalOpacity);
  }, [terminalOpacity]);

  useEffect(() => {
    terminalRendererRef.current?.setWheelScrollbackOverride(
      Boolean(pane.tmuxSessionId && !tmuxMouseEnabled),
      handleTmuxWheelScroll,
    );
  }, [pane.tmuxSessionId, tmuxMouseEnabled]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = () => setContextMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const renderer = terminalRendererRef.current;
      if (!renderer) {
        return;
      }

      fitAndResizeRef.current();
      focusTerminalUnlessExternalInputIsActive(renderer, paneRef.current);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isActive]);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [searchOpen]);

  useEffect(() => {
    const renderer = terminalRendererRef.current;
    if (!renderer) {
      return;
    }

    if (!searchOpen || !searchTerm.trim()) {
      renderer.clearSearch();
      setSearchResult({ resultIndex: -1, resultCount: 0, found: true });
      return;
    }

    const found = renderer.findNext(searchTerm);
    setSearchResult((result) => ({
      ...result,
      found,
      resultCount: found ? result.resultCount : 0,
      resultIndex: found ? result.resultIndex : -1,
    }));
  }, [searchOpen, searchTerm]);

  async function saveTerminalAppearance(nextOpacity: number, nextBackground = terminalBackground) {
    const connection = pane.connection;
    if (!connection) {
      return;
    }
    const appearance = {
      terminalOpacity: Math.min(Math.max(Math.round(nextOpacity), 0), 100),
      terminalBackground: nextBackground,
    };
    if (pane.childConnectionId) {
      updateOpenTerminalPaneAppearance(tabId, pane.id, appearance);
      return;
    }
    updateOpenConnectionTerminalAppearance(connection.id, appearance);
    if (isTransientLocalConnectionId(connection.id)) {
      return;
    }
    try {
      const updated = await invokeCommand("update_connection_terminal_appearance", {
        connectionId: connection.id,
        terminalOpacity: appearance.terminalOpacity,
        terminalBackground: appearance.terminalBackground,
      });
      if (updated) {
        updateOpenConnectionTerminalAppearance(connection.id, {
          terminalOpacity: updated.terminalOpacity ?? appearance.terminalOpacity,
          terminalBackground: updated.terminalBackground ?? null,
        });
      }
    } catch (error) {
      console.warn("terminal appearance update failed.", error);
      showStatusBarNotice(t("terminal.appearanceSaveFailed", { message: String(error) }));
    }
  }

  function handleOpacityChange(value: string) {
    void saveTerminalAppearance(100 - Number(value));
  }

  function handleBackgroundChange(nextBackground: typeof terminalBackground) {
    if (pane.childConnectionId) {
      updateOpenTerminalPaneAppearance(tabId, pane.id, {
        terminalOpacity,
        terminalBackground: nextBackground,
      });
      return;
    }
    if (usePaneTerminalBackgrounds) {
      updateOpenTerminalPaneBackground(tabId, pane.id, nextBackground);
      return;
    }
    void saveTerminalAppearance(terminalOpacity, nextBackground);
  }

  function handleCopyTerminalSelection() {
    const text = terminalRendererRef.current?.getSelection() || selectedTerminalText;
    if (text) {
      void writeToClipboard(text);
    }
    setContextMenu(null);
    terminalRendererRef.current?.focus();
  }

  async function handlePasteIntoTerminal() {
    const text = await readFromClipboard();
    if (!text) {
      setContextMenu(null);
      terminalRendererRef.current?.focus();
      return;
    }

    terminalRendererRef.current?.paste(text);
    setContextMenu(null);
    terminalRendererRef.current?.focus();
  }

  function handleTerminalContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    onFocus();

    const selection = terminalRendererRef.current?.getSelection() ?? "";
    setSelectedTerminalText(selection);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      hasSelection: Boolean(selection),
    });
  }

  async function handleToggleRecording() {
    const connection = pane.connection;
    const sessionId = sessionIdRef.current;
    if (!connection || !sessionId || !isTauriRuntime()) {
      showStatusBarNotice(t("terminal.recordingUnavailable"), { tone: "error" });
      return;
    }

    setRecordingBusy(true);
    try {
      if (recordingInfo) {
        const stopped = await invokeCommand("stop_terminal_recording", { sessionId });
        setRecordingInfo(null);
        showStatusBarNotice(
          stopped ? t("terminal.recordingSaved", { path: stopped.path }) : t("terminal.recordingStopped"),
        );
        return;
      }

      const started = await invokeCommand("start_terminal_recording", {
        request: {
          sessionId,
          connectionId: connection.id,
          connectionName: connection.name,
          initialBuffer: terminalRendererRef.current?.getBufferText() ?? "",
        },
      });
      setRecordingInfo(started);
      showStatusBarNotice(t("terminal.recordingStarted"));
    } catch (error) {
      showStatusBarNotice(
        t("terminal.recordingFailed", { message: error instanceof Error ? error.message : String(error) }),
        { tone: "error" },
      );
    } finally {
      setRecordingBusy(false);
    }
  }

  function handleOpenRecordings() {
    setActionsMenuOpen(false);
    setRecordingsOpen(true);
  }

  async function handleSendBufferToAssistant() {
    const text = (
      await terminalBufferForAssistant(
        pane,
        terminalRendererRef.current,
        sshSettings.bufferLines,
      )
    ).trim();
    if (!text) {
      return;
    }

    const sourceLabel = pane.connection
      ? `${pane.connection.name} ${t("terminal.terminalBuffer")}`
      : `${pane.title} ${t("terminal.terminalBuffer")}`;
    const snippet = {
      id: `terminal-buffer-${Date.now()}`,
      kind: "text",
      sourceLabel,
      text,
      capturedAt: new Date().toISOString(),
    } as const;
    if (generalSettings.submitAiAttachmentsDirectly) {
      submitAssistantContextSnippet(snippet, t("ai.directAttachmentPrompt"));
      onOpenAssistant();
      return;
    }
    setAssistantContextSnippet(snippet);
    onOpenAssistant();
  }

  function handleSearchNext() {
    const found = terminalRendererRef.current?.findNext(searchTerm) ?? false;
    setSearchResult((result) => ({
      ...result,
      found,
      resultCount: found ? result.resultCount : 0,
      resultIndex: found ? result.resultIndex : -1,
    }));
  }

  function handleSearchPrevious() {
    const found = terminalRendererRef.current?.findPrevious(searchTerm) ?? false;
    setSearchResult((result) => ({
      ...result,
      found,
      resultCount: found ? result.resultCount : 0,
      resultIndex: found ? result.resultIndex : -1,
    }));
  }

  function handleCloseSearch() {
    terminalRendererRef.current?.clearSearch();
    setSearchOpen(false);
    setSearchTerm("");
    setSearchResult({ resultIndex: -1, resultCount: 0, found: true });
    terminalRendererRef.current?.focus();
  }

  function handleOpenSftp() {
    if (pane.connection?.type !== "ssh") {
      return;
    }
    onOpenSftp(pane.connection, pane.id);
  }

  function handleSplit(direction: "right" | "left" | "down" | "up") {
    setActionsMenuOpen(false);
    onSplit(pane.id, direction);
  }

  function handleSaveBuffer() {
    setActionsMenuOpen(false);
    onSaveBuffer(pane.id);
  }

  function handleToggleSearch() {
    setActionsMenuOpen(false);
    setSearchOpen((open) => !open);
  }

  function handleFontChange(delta: number | "reset") {
    onFontChange(delta);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        handleSearchPrevious();
      } else {
        handleSearchNext();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      handleCloseSearch();
    }
  }

  const searchStatusLabel = searchTerm.trim()
    ? searchResult.resultCount > 0 && searchResult.resultIndex >= 0
      ? `${searchResult.resultIndex + 1}/${searchResult.resultCount}`
      : searchResult.found
        ? "..."
        : t("terminal.noResults")
    : "";
  const isSshPane = pane.connection?.type === "ssh";
  const paneToolbarTitle = pane.toolbarTitle ?? (pane.connection ? connectionToolbarTitle(pane.connection) : pane.title);

  return (
    <article
      className={[
        "terminal-pane",
        searchOpen ? "terminal-pane-search-open" : "",
        recordingInfo ? "terminal-pane-recording" : "",
        isFocused ? "terminal-pane-focused" : "terminal-pane-inactive",
      ]
        .filter(Boolean)
        .join(" ")}
      data-tutorial-id="terminal.pane"
      onMouseDown={() => {
        onFocus();
        focusTerminalRenderer();
      }}
      ref={paneRef}
    >
      <header>
        <span>
          <Circle size={9} fill="currentColor" />
          {paneToolbarTitle}
        </span>
        <div className="terminal-pane-actions">
          {pane.connection ? (
            <TmuxSessionTag
              connection={pane.connection}
              onMouseModeChange={setTmuxMouseEnabled}
              sessionId={pane.tmuxSessionId}
              tabId={tabId}
            />
          ) : null}
          {isSshPane && sshSettings.managedXServerEnabled ? (
            <XServerToolbarIndicator status={x11ForwardingStatus} />
          ) : null}
          {recordingInfo ? <span className="terminal-recording-status">{t("terminal.recording")}</span> : null}
          <button
            className={`terminal-pane-action terminal-recording-button${recordingInfo ? " active" : ""}`}
            aria-label={recordingInfo ? t("terminal.stopRecording") : t("terminal.startRecording")}
            data-tutorial-id="terminal.startRecording"
            disabled={recordingBusy}
            onClick={() => void handleToggleRecording()}
            title={recordingInfo ? t("terminal.stopRecording") : t("terminal.startRecording")}
            type="button"
          >
            {recordingInfo ? <Square size={9} fill="currentColor" /> : <Circle size={8} fill="currentColor" />}
          </button>
          {isSshPane && showSftpButton ? (
            <button
              className="terminal-pane-action"
              aria-label={t("terminal.openSftp")}
              data-tutorial-id="terminal.openSftp"
              onClick={handleOpenSftp}
              title={t("terminal.sftp")}
              type="button"
            >
              <Folder size={13} />
            </button>
          ) : null}
          <button
            className={`terminal-pane-action quick-command-toggle${quickCommandBarVisible ? " active" : ""}`}
            aria-label={quickCommandBarVisible ? t("terminal.quickCommandsHide") : t("terminal.quickCommandsShow")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToggleQuickCommandBar}
            title={quickCommandBarVisible ? t("terminal.quickCommandsHide") : t("terminal.quickCommandsShow")}
            type="button"
          >
            <PanelBottom size={13} />
          </button>
          <button
            className="terminal-pane-action"
            aria-label={t("terminal.copySelection")}
            data-tutorial-id="terminal.copySelection"
            disabled={!selectedTerminalText}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCopyTerminalSelection}
            title={t("terminal.copySelection")}
            type="button"
          >
            <Copy size={13} />
          </button>
          <button
            className="terminal-pane-action"
            aria-label={t("terminal.sendToAi")}
            data-tutorial-id="terminal.sendToAi"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleSendBufferToAssistant()}
            title={t("terminal.sendToAi")}
            type="button"
          >
            <Bot size={13} />
          </button>
          <div className="terminal-menu-wrapper" ref={actionsMenuRef}>
            <button
              className="terminal-pane-action"
              aria-label={t("terminal.actions")}
              data-tutorial-id="terminal.actions"
              {...menuButtonAria(actionsMenuOpen)}
              onClick={() => setActionsMenuOpen((open) => !open)}
              title={t("terminal.actions")}
              type="button"
            >
              <Menu size={13} />
            </button>
            {actionsMenuOpen ? (
              <div className="terminal-menu" role="menu">
                {isSshPane && pane.connection ? (
                  <SshPortForwardMenu
                    connection={pane.connection}
                    triggerClassName="terminal-menu-item"
                    triggerLabel={t("terminal.sshPortRedirect")}
                    triggerRole="menuitem"
                  />
                ) : null}
                <div className="terminal-menu-submenu">
                  <button
                    className="terminal-menu-item"
                    disabled={!canSplit}
                    role="menuitem"
                    type="button"
                  >
                    <SplitSquareHorizontal size={13} />
                    {t("terminal.splitLayout")}
                    <ChevronRight size={13} className="terminal-menu-chevron" />
                  </button>
                  <div className="terminal-menu terminal-menu-submenu-panel" role="menu">
                    <button
                      className="terminal-menu-item"
                      disabled={!canSplit}
                      onClick={() => handleSplit("right")}
                      role="menuitem"
                      type="button"
                    >
                      <ArrowRight size={13} />
                      {t("terminal.splitRight")}
                    </button>
                    <button
                      className="terminal-menu-item"
                      disabled={!canSplit}
                      onClick={() => handleSplit("left")}
                      role="menuitem"
                      type="button"
                    >
                      <ArrowLeft size={13} />
                      {t("terminal.splitLeft")}
                    </button>
                    <button
                      className="terminal-menu-item"
                      disabled={!canSplit}
                      onClick={() => handleSplit("down")}
                      role="menuitem"
                      type="button"
                    >
                      <ArrowDown size={13} />
                      {t("terminal.splitDown")}
                    </button>
                    <button
                      className="terminal-menu-item"
                      disabled={!canSplit}
                      onClick={() => handleSplit("up")}
                      role="menuitem"
                      type="button"
                    >
                      <ArrowUp size={13} />
                      {t("terminal.splitUp")}
                    </button>
                  </div>
                </div>
                <button
                  className="terminal-menu-item"
                  onClick={handleToggleSearch}
                  role="menuitem"
                  type="button"
                >
                  <Search size={13} />
                  {t("terminal.findInScrollback")}
                </button>
                <button
                  className="terminal-menu-item"
                  onClick={handleSaveBuffer}
                  role="menuitem"
                  type="button"
                >
                  <Save size={13} />
                  {t("terminal.saveBuffer")}
                </button>
                <ScreenshotMenu
                  buttonClassName="terminal-menu-item"
                  buttonLabel={t("workspace.takeScreenshot")}
                  dataTutorialId="workspace.screenshotMenu"
                  targetLabel={`${pane.connection?.name ?? pane.title} ${t("workspace.terminalPane")}`}
                  targetRef={paneRef}
                />
                <button
                  className="terminal-menu-item"
                  onClick={handleOpenRecordings}
                  role="menuitem"
                  type="button"
                >
                  <FolderOpen size={13} />
                  {t("terminal.openRecordings")}
                </button>
                <div className="terminal-menu-submenu">
                  <button
                    className="terminal-menu-item"
                    role="menuitem"
                    type="button"
                  >
                    <Circle size={13} />
                    {t("terminal.opacity")}
                    <ChevronRight size={13} className="terminal-menu-chevron" />
                  </button>
                  <div className="terminal-menu terminal-menu-submenu-panel terminal-opacity-panel" role="menu">
                    <label className="terminal-opacity-control">
                      <span>{t("terminal.opacityValue", { value: terminalTransparency })}</span>
                      <input
                        aria-label={t("terminal.opacity")}
                        max={100}
                        min={0}
                        onChange={(event) => handleOpacityChange(event.currentTarget.value)}
                        step={1}
                        type="range"
                        value={terminalTransparency}
                      />
                    </label>
                  </div>
                </div>
                <button
                  className="terminal-menu-item"
                  onClick={() => {
                    setBackgroundPopoverOpen(true);
                    setActionsMenuOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <PanelBottom size={13} />
                  {t("terminal.background")}
                </button>
                <div className="terminal-menu-submenu">
                  <button
                    className="terminal-menu-item"
                    role="menuitem"
                    type="button"
                  >
                    <Type size={13} />
                    {t("terminal.font")}
                    <ChevronRight size={13} className="terminal-menu-chevron" />
                  </button>
                  <div className="terminal-menu terminal-menu-submenu-panel" role="menu">
                    <button
                      className="terminal-menu-item"
                      onClick={() => handleFontChange(1)}
                      role="menuitem"
                      type="button"
                    >
                      {t("terminal.increaseSize")}
                    </button>
                    <button
                      className="terminal-menu-item"
                      onClick={() => handleFontChange(-1)}
                      role="menuitem"
                      type="button"
                    >
                      {t("terminal.decreaseSize")}
                    </button>
                    <button
                      className="terminal-menu-item"
                      onClick={() => handleFontChange("reset")}
                      role="menuitem"
                      type="button"
                    >
                      {t("terminal.resetSize")}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {canClosePane ? (
            <button
              className="terminal-pane-action terminal-pane-close"
              aria-label={pane.tmuxSessionId ? t("terminal.detachTmux") : t("terminal.closePane")}
              onClick={() => closePane(tabId, pane.id)}
              title={pane.tmuxSessionId ? t("terminal.detachTmux") : t("terminal.closePane")}
              type="button"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      </header>
      {searchOpen ? (
        <div className="terminal-search-bar" data-tutorial-id="terminal.searchBar">
          <Search size={13} />
          <input
            aria-label={t("terminal.findInScrollback")}
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t("terminal.find")}
            ref={searchInputRef}
            value={searchTerm}
          />
          <span className={searchResult.found ? "terminal-search-count" : "terminal-search-count empty"}>
            {searchStatusLabel}
          </span>
          <button
            aria-label={t("terminal.previousSearch")}
            className="terminal-pane-action"
            disabled={!searchTerm.trim()}
            onClick={handleSearchPrevious}
            title={t("terminal.previousSearch")}
            type="button"
          >
            <ArrowUp size={13} />
          </button>
          <button
            aria-label={t("terminal.nextSearch")}
            className="terminal-pane-action"
            disabled={!searchTerm.trim()}
            onClick={handleSearchNext}
            title={t("terminal.nextSearch")}
            type="button"
          >
            <ArrowDown size={13} />
          </button>
          <button
            aria-label={t("terminal.closeSearch")}
            className="terminal-pane-action"
            onClick={handleCloseSearch}
            title={t("terminal.closeSearch")}
            type="button"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      {pane.connection ? (
        <>
          <TerminalBackgroundLayer active={isActive} background={usePaneTerminalBackgrounds ? terminalBackground : null} />
          <div
            className="xterm-host"
            data-tutorial-id="terminal.surface"
            onContextMenu={handleTerminalContextMenu}
            onPointerDown={handleTerminalSurfacePointerDown}
            ref={terminalElementRef}
          />
        </>
      ) : (
        <pre>
          <code>{pane.buffer}</code>
        </pre>
      )}
      {backgroundPopoverOpen ? (
        <TerminalBackgroundPopover
          background={terminalBackground}
          onBackgroundChange={handleBackgroundChange}
          onClose={() => setBackgroundPopoverOpen(false)}
        />
      ) : null}
      {contextMenu ? (
        <TerminalContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onCopy={handleCopyTerminalSelection}
          onPaste={() => void handlePasteIntoTerminal()}
        />
      ) : null}
      {recordingsOpen && pane.connection ? (
        <TerminalRecordingsDialog
          connection={pane.connection}
          onClose={() => setRecordingsOpen(false)}
        />
      ) : null}
      {multilinePasteConfirmationOpen ? (
        <ConfirmDialog
          confirmLabel={t("common.paste")}
          message={t("terminal.pasteMultilineConfirm")}
          onCancel={() => resolveMultilinePasteConfirmation(false)}
          onConfirm={() => resolveMultilinePasteConfirmation(true)}
          title={t("settings.confirmMultilinePaste")}
        />
      ) : null}
    </article>
  );
}

function TerminalContextMenu({
  menu,
  onClose,
  onCopy,
  onPaste,
}: {
  menu: TerminalContextMenuState;
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) {
      return;
    }

    const bounds = node.getBoundingClientRect();
    const left = Math.min(menu.x, window.innerWidth - bounds.width - 8);
    const top = Math.min(menu.y, window.innerHeight - bounds.height - 8);
    node.style.left = `${Math.max(8, left)}px`;
    node.style.top = `${Math.max(8, top)}px`;
  }, [menu.x, menu.y]);

  // Portal to document.body so the menu escapes any ancestor CSS transform
  // (eg. react-grid-layout's translated grid item when the terminal is
  // embedded in a Dashboard connection widget) and any overflow:hidden clip.
  return createPortal(
    <div
      className="terminal-context-menu"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      ref={menuRef}
      role="menu"
    >
      <button
        disabled={!menu.hasSelection}
        onClick={() => {
          onCopy();
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        <span className="menu-item-label">
          <Copy size={14} />
          <span>{t("terminal.copy")}</span>
        </span>
        <kbd>{t("terminal.copyShortcut")}</kbd>
      </button>
      <button
        onClick={() => {
          onPaste();
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        <span className="menu-item-label">
          <ClipboardPaste size={14} />
          <span>{t("terminal.paste")}</span>
        </span>
      </button>
    </div>,
    document.body,
  );
}

function TerminalRecordingsDialog({
  connection,
  onClose,
}: {
  connection: Connection;
  onClose: () => void;
}) {
  const [recordings, setRecordings] = useState<TerminalRecordingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  useEffect(() => {
    let canceled = false;
    async function loadRecordings() {
      if (!isTauriRuntime()) {
        setRecordings([]);
        setError(t("terminal.tauriRequired"));
        return;
      }
      setLoading(true);
      setError("");
      try {
        const result = await invokeCommand("list_terminal_recordings", {
          request: {
            connectionId: connection.id,
            connectionName: connection.name,
          },
        });
        if (!canceled) {
          setRecordings(result);
        }
      } catch (loadError) {
        if (!canceled) {
          setRecordings([]);
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    void loadRecordings();
    return () => {
      canceled = true;
    };
  }, [connection.id, connection.name, t]);

  async function handleOpenFolder() {
    try {
      await invokeCommand("open_terminal_recordings_folder", {
        request: {
          connectionId: connection.id,
          connectionName: connection.name,
        },
      });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  }

  async function handleOpenRecording(path: string) {
    try {
      await invokeCommand("open_terminal_recording", { path });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  }

  return (
    <div className="terminal-recordings-backdrop" role="presentation">
      <div className="terminal-recordings-dialog" role="dialog" aria-modal="true" aria-label={t("terminal.recordingsTitle")}>
        <header>
          <div>
            <strong>{t("terminal.recordingsTitle")}</strong>
            <small>{connection.name}</small>
          </div>
          <div className="terminal-recordings-actions">
            <button
              className="terminal-pane-action"
              aria-label={t("terminal.openRecordingsFolder")}
              onClick={() => void handleOpenFolder()}
              title={t("terminal.openRecordingsFolder")}
              type="button"
            >
              <FolderOpen size={13} />
            </button>
            <button
              className="terminal-pane-action"
              aria-label={t("common.close")}
              onClick={onClose}
              title={t("common.close")}
              type="button"
            >
              <X size={13} />
            </button>
          </div>
        </header>
        {loading ? <p>{t("terminal.loading")}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {!loading && !error && recordings.length === 0 ? <p>{t("terminal.noRecordings")}</p> : null}
        {recordings.length > 0 ? (
          <div className="terminal-recordings-list">
            {recordings.map((recording) => (
              <button
                className="terminal-recording-row"
                key={recording.path}
                onClick={() => void handleOpenRecording(recording.path)}
                type="button"
              >
                <FileText size={14} />
                <span>
                  <strong>{recording.fileName}</strong>
                  <small>
                    {formatRecordingMetadata(recording, t)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function isMultilinePaste(data: string) {
  return data.split(/\r\n|\r|\n/).filter((line) => line.length > 0).length > 1;
}

function formatRecordingMetadata(recording: TerminalRecordingEntry, t: (key: string, options?: Record<string, unknown>) => string) {
  const parts = [formatByteCount(recording.sizeBytes)];
  if (recording.modifiedAtMillis) {
    parts.push(new Date(recording.modifiedAtMillis).toLocaleString());
  }
  return t("terminal.recordingMetadata", { metadata: parts.join(" · ") });
}

function formatByteCount(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  for (let index = 0; index < units.length; index += 1) {
    if (value < 1024 || index === units.length - 1) {
      return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

function encodeTerminalInput(data: string) {
  return Array.from(terminalInputEncoder.encode(data));
}

// Node.js TUIs (Claude Code, etc.) read stdin as raw bytes and never call
// ReadConsoleInputW, so the win32-input-mode KEY_EVENT_RECORD CSI sequences
// that ConPTY translates for native Win32 console clients are invisible to
// them. Both plain Enter and Shift+Enter arrive as bare CR ("\r"), which
// readline treats as "submit". Send LF ("\n") instead so the TUI sees a
// real newline, matching what Windows Terminal emits for Shift+Enter.
function encodeShiftEnterForLocalPty(): string {
  return "\n";
}

function terminalDimensionsEqual(left: TerminalDimensions, right: TerminalDimensions) {
  return (
    left.cols === right.cols &&
    left.pixelHeight === right.pixelHeight &&
    left.pixelWidth === right.pixelWidth &&
    left.rows === right.rows
  );
}

function terminalSessionTypeFor(connection: Connection): "local" | "ssh" | "telnet" | "serial" {
  return connection.type === "local" ||
    connection.type === "ssh" ||
    connection.type === "telnet" ||
    connection.type === "serial"
    ? connection.type
    : "ssh";
}

async function terminalBufferForAssistant(
  pane: TerminalPane,
  renderer: TerminalRenderer | null,
  bufferLines: number,
) {
  if (pane.connection?.type === "ssh" && pane.tmuxSessionId) {
    try {
      return await invokeCommand("capture_tmux_pane", {
        request: {
          ...tmuxConnectionRequest(pane.connection),
          tmuxSessionId: pane.tmuxSessionId,
          bufferLines,
        },
      });
    } catch (error) {
      console.warn("Falling back to local terminal buffer after tmux capture failed.", error);
    }
  }

  return renderer?.getBufferText() ?? "";
}

function isRemoteInitialDirectory(cwd: string) {
  const trimmed = cwd.trim();
  if (!trimmed || trimmed === "~") {
    return false;
  }

  return !/^[A-Za-z]:[\\/]/.test(trimmed);
}

function initialDirectoryForTerminalSession(connection: Connection, paneCwd: string) {
  if (connection.type === "local") {
    return paneCwd.trim() && paneCwd.trim() !== "."
      ? paneCwd.trim()
      : connection.localStartupDirectory?.trim() || undefined;
  }
  if (connection.type === "ssh" && isRemoteInitialDirectory(paneCwd)) {
    return paneCwd.trim();
  }
  return undefined;
}

function localStartupInputFor(connection: Connection) {
  if (connection.type !== "local") {
    return "";
  }
  const script = connection.localStartupScript?.trim();
  if (!script) {
    return "";
  }
  return `${script.replace(/\r?\n/g, "\r")}\r`;
}

function isTransientLocalConnectionId(connectionId: string) {
  return /^local-\d+$/u.test(connectionId);
}

function focusTerminalUnlessExternalInputIsActive(
  renderer: TerminalRenderer,
  paneElement: HTMLElement | null,
) {
  if (shouldPreserveExternalFocus(paneElement)) {
    return;
  }

  renderer.focus();
}

function shouldPreserveExternalFocus(paneElement: HTMLElement | null) {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) {
    return false;
  }

  if (activeElement === document.body || activeElement === document.documentElement) {
    return false;
  }

  if (paneElement?.contains(activeElement)) {
    return false;
  }

  if (activeElement.closest(".assistant-panel")) {
    return true;
  }

  return isEditableElement(activeElement) || isFocusableElement(activeElement);
}

// Focus tracing for the "terminal loses input focus after app switch" bug.
// Records whether the document actually holds OS focus and which element is
// active at each restore step to ui.debug.log (written in debug builds, or in
// release builds when the advanced debugging setting is on), turning the
// previously blind guess-and-try into a verifiable signal on Windows.
function logTerminalFocusDiagnostic(stage: string) {
  const active = document.activeElement;
  const describe = active instanceof HTMLElement
    ? `${active.tagName.toLowerCase()}${active.className ? `.${active.className.split(/\s+/).join(".")}` : ""}`
    : String(active);
  logUiDebug("terminal.focus_restore", {
    stage,
    hasFocus: document.hasFocus(),
    activeElement: describe,
  });
}

function shouldRestoreTerminalFocusAfterWindowBlur() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && activeElement.closest(".terminal-pane") !== null;
}

function shouldPreserveTerminalWorkspaceFocus() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) {
    return false;
  }

  if (activeElement === document.body || activeElement === document.documentElement) {
    return false;
  }

  if (activeElement.closest(".terminal-pane")) {
    return false;
  }

  // Only yield to surfaces the user is genuinely working in: the assistant
  // panel or an editable input (e.g. a dialog field). After an OS window
  // switch, document.activeElement reflects Chromium's automatic focus
  // restoration, not a user action — a non-terminal *button* (e.g. the
  // connection tree's open button) landing focus is never intent, so it must
  // not block restoring focus to the terminal the user was using.
  return activeElement.closest(".assistant-panel") !== null ||
    isEditableElement(activeElement);
}

function isEditableElement(element: HTMLElement) {
  if (element.isContentEditable) {
    return true;
  }

  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function focusExternalPointerTarget(target: Node) {
  const focusTarget = focusableElementForPointerTarget(target);
  if (!focusTarget) {
    return;
  }

  const focus = () => {
    if (!focusTarget.isConnected || document.activeElement === focusTarget) {
      return;
    }

    focusTarget.focus({ preventScroll: true });
  };

  queueMicrotask(focus);
  window.requestAnimationFrame(focus);
}

function focusableElementForPointerTarget(target: Node) {
  const element = target instanceof HTMLElement ? target : target.parentElement;
  if (!element) {
    return null;
  }

  if (isFocusableElement(element)) {
    return element;
  }

  const label = element.closest("label");
  if (label instanceof HTMLLabelElement && label.control instanceof HTMLElement) {
    return label.control;
  }

  return element.closest<HTMLElement>(
    'input, textarea, select, button, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
  );
}

function isFocusableElement(element: HTMLElement) {
  if (element instanceof HTMLButtonElement) {
    return !element.disabled;
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return !element.disabled;
  }

  if (element.isContentEditable) {
    return true;
  }

  const tabIndex = element.getAttribute("tabindex");
  return tabIndex !== null && tabIndex !== "-1";
}

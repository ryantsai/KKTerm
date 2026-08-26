import { confirmTrustedSshHostKey, connectionPasswordOwnerId, connectionToolbarTitle, localShellOptionsForPlatform, resolveAvailableLocalShell, resolveSshCompression, resolveSshOldProtocols, resolveSshSocksProxyRequest, uniqueRuntimeId, usesNativeSshHostKeyVerification } from "../utils";
import { resolveLocalShellForLaunch } from "./pwshPreflight";
import { ConfirmDialog } from "../../../../app/ConfirmDialog";
import { readFromClipboard, writeToClipboard } from "../../../../lib/clipboard";
import { CUSTOM_FONTS_LOADED_EVENT } from "../../../../lib/customFonts";
import { ScreenshotMenu } from "../../ScreenshotMenu";

import { ConnectionGlyph } from "../ConnectionGlyph";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bot, Braces, Check, FileText, Folder, FolderOpen, Mouse, ChevronRight, Circle, Copy, Menu, Monitor, Network, Palette, PanelBottom, Pencil, Radio, RefreshCw, Scan, Search, SplitSquareHorizontal, Square, Type, X } from "../../../../lib/reicon";
import { SaveAsIcon } from "../../../../app/ui/SaveAsIcon";
import { listen } from "@tauri-apps/api/event";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import i18next from "../../../../i18n/config";
import { ariaInvalid, dialogButtonAria, menuButtonAria } from "../../../../lib/aria";
import { fileBrowserCommandsFor } from "../../../../lib/fileBrowserCommands";
import { focusCurrentWebview, invokeCommand, isTauriRuntime, logUiDebug, openExternalUrl, saveTextFile, type TerminalOutput, type TerminalRecordingInfo, type TerminalSessionEnded, type TmuxSession } from "../../../../lib/tauri";
import { markOsIconAutoDetectDone, osIconIdForDetection, osIconRefForId, shouldAutoDetectOsIcon } from "../../../../lib/osIcons";
import {
  notifyConnectionTreeInvalidated,
  RECONNECT_TERMINAL_CONNECTION_EVENT,
  type ReconnectTerminalConnectionDetail,
} from "../connectionSidebarState";
import { defaultTerminalSettings } from "../../../../app-defaults";
import { connectionUsesTmux, forgetTmuxSessionId, useWorkspaceStore } from "../../../../store";
import { resolveVisibleTerminalBackground } from "../terminalAppearanceDefaults";
import { GitIcon } from "../../../git/GitIcon";
import { useGitRepoDetection } from "../../../git/useGitRepoDetection";
import { createTerminalRenderer, logTerminalFontAtlasState, scheduleTerminalFontAtlasRefresh, type TerminalDimensions, type TerminalRenderer } from "./renderer";
import { hexColorWithAlpha, resolveTerminalColorScheme, terminalToolbarOpacity, TERMINAL_COLOR_SCHEMES } from "./colorSchemes";
import { findQuickSelectMatches, labelQuickSelectMatches, quickSelectPointerAction, type LabeledQuickSelectMatch } from "./quickSelect";
import {
  fixedTerminalShortcutFromKeyboardEvent,
  workspaceShortcutFromKeyboardEvent,
} from "../../keymap";
import { ensureLayout, leafOrder } from "../../layout";
import {
  broadcastInputToOtherPanes,
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
import { TERMINAL_ENCODING_OPTIONS, normalizeTerminalEncoding } from "./terminalEncoding";
import { QuickCommandBar } from "./QuickCommandBar";
import { TerminalBackgroundLayer, TerminalBackgroundPopover } from "./TerminalBackgroundPopover";
import { SshPortForwardingDialog, hasEnabledSshPortForwardings } from "./SshPortForwardingDialog";
import { startEnabledSshPortForwardings } from "./sshPortForwardingModel";
import { classifyEnvironmentShell, prepareLocalStartup } from "../connection-dialog/environmentVariables";
import { readSshApplyStartupToExistingTmux } from "../connection-dialog/sshStartupScript";
import { showNativeContextMenu } from "../../../../lib/nativeContextMenu";
import { nativeMenuIcons } from "../../../../lib/nativeMenuIcons";
import { NoteToolbarButton } from "../../../notes/NoteToolbarButton";
import {
  allSyntaxHighlightProfiles,
  findSyntaxHighlightProfile,
} from "./syntaxHighlighting";

const SftpWorkspace = lazy(() =>
  import("../sftp/SftpWorkspace").then(({ SftpWorkspace }) => ({
    default: SftpWorkspace,
  })),
);
const FileViewerWorkspace = lazy(() =>
  import("../file-viewer/FileViewerWorkspace").then(({ FileViewerWorkspace }) => ({
    default: FileViewerWorkspace,
  })),
);
const WebViewWorkspace = lazy(() =>
  import("../webview/WebViewWorkspace").then(({ WebViewWorkspace }) => ({
    default: WebViewWorkspace,
  })),
);
const RemoteDesktopWorkspace = lazy(() =>
  import("../remote-desktop/RemoteDesktopWorkspace").then(({ RemoteDesktopWorkspace }) => ({
    default: RemoteDesktopWorkspace,
  })),
);

const TMUX_MOUSE_MODE_EVENT = "kkterm:tmux-mouse-mode";
const TMUX_UNAVAILABLE_MARKER = "[KKTerm: tmux not found, using normal shell]";
// Emitted by the remote tmux launch command so the frontend can tell, with no
// guessing, whether `tmux new-session -A` created the session or attached to an
// already-running one — the basis for replaying the SSH startup script.
const TMUX_SESSION_CREATED_MARKER = "[KKTerm: tmux session created]";
const TMUX_SESSION_ATTACHED_MARKER = "[KKTerm: tmux session attached]";
const TMUX_MARKER_TAIL_LENGTH = Math.max(
  TMUX_SESSION_CREATED_MARKER.length,
  TMUX_SESSION_ATTACHED_MARKER.length,
) * 2;
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
  onClose,
  onOpenAssistant = () => undefined,
  showSftpButton = true,
  tab,
  trackConnectionSession = true,
}: {
  allowPaneLayoutControls?: boolean;
  isActive: boolean;
  onClose?: () => void;
  onOpenAssistant?: () => void;
  showSftpButton?: boolean;
  tab: WorkspaceTab;
  trackConnectionSession?: boolean;
}) {
  const splitTerminalPaneDirected = useWorkspaceStore(
    (state) => state.splitTerminalPaneDirected,
  );
  const setQuickCommandBarVisible = useWorkspaceStore(
    (state) => state.setQuickCommandBarVisible,
  );
  const sshSettings = useWorkspaceStore((state) => state.sshSettings);
  const terminalSettings = useWorkspaceStore((state) => state.terminalSettings);
  const setTerminalSettings = useWorkspaceStore((state) => state.setTerminalSettings);
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const setFocusedPane = useWorkspaceStore((state) => state.setFocusedPane);
  const refreshOpenConnectionMetadata = useWorkspaceStore((state) => state.refreshOpenConnectionMetadata);
  const updateOpenTerminalPaneFontSize = useWorkspaceStore((state) => state.updateOpenTerminalPaneFontSize);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const usePaneTerminalBackgrounds =
    generalSettings.separateSplitTerminalBackgrounds &&
    tab.panes.filter(isTerminalPane).length > 1;
  const [sftpDialogConnection, setSftpDialogConnection] = useState<Connection | null>(null);
  const [sftpDialogInitialRemotePath, setSftpDialogInitialRemotePath] = useState<string | undefined>(undefined);
  const [sshPortForwardingDialogConnection, setSshPortForwardingDialogConnection] = useState<Connection | null>(null);
  const [sshPortForwardingDialogSessionId, setSshPortForwardingDialogSessionId] = useState<string | null>(null);
  const [sshPortForwardingDialogPaneId, setSshPortForwardingDialogPaneId] = useState<string | null>(null);
  const setOpenTerminalPaneSshForwardFailures = useWorkspaceStore((state) => state.setOpenTerminalPaneSshForwardFailures);
  const sftpFocusRestorePaneIdRef = useRef<string | null>(null);
  const sftpOpenRequestIdRef = useRef(0);
  const sshPortForwardingFocusRestorePaneIdRef = useRef<string | null>(null);
  const { t } = useTranslation();
  const defaultFontSize = defaultTerminalSettings.fontSize;
  const canSplit = allowPaneLayoutControls && tab.panes.some((pane) => pane.connection);
  const focusedPaneId = tab.focusedPaneId ?? tab.panes[0]?.id;
  const maximizedPaneId = tab.maximizedPaneId && tab.panes.some((pane) => pane.id === tab.maximizedPaneId)
    ? tab.maximizedPaneId
    : undefined;
  const layout = useMemo(() => ensureLayout(tab.layout, tab.panes), [tab.layout, tab.panes]);
  const isSingleEmbeddedPane = tab.panes.length === 1 && tab.panes[0] !== undefined && !isTerminalPane(tab.panes[0]);
  const canCloseSinglePane =
    Boolean(onClose) ||
    (allowPaneLayoutControls && tab.kind === "terminal" && generalSettings.hideTopTabButtons);
  const quickCommandBarVisible = Boolean(tab.quickCommandBarVisible) && !isSingleEmbeddedPane;
  const focusedTerminalPane = tab.panes.find((pane): pane is TerminalPane => (
    isTerminalPane(pane) && pane.id === focusedPaneId
  ));
  const firstTerminalPane = leafOrder(layout)
    .map((paneId) => tab.panes.find((pane) => pane.id === paneId))
    .filter((pane): pane is WorkspacePane => Boolean(pane))
    .find(isTerminalPane);
  const maximizedTerminalPane = maximizedPaneId
    ? tab.panes.find((pane): pane is TerminalPane => (
        pane.id === maximizedPaneId && isTerminalPane(pane)
      ))
    : undefined;
  const sharedTerminalBackgroundOwnerPane = maximizedTerminalPane ?? firstTerminalPane;
  const workspaceTerminalBackground = usePaneTerminalBackgrounds
    ? null
    : (sharedTerminalBackgroundOwnerPane?.connection?.terminalBackground ?? null);
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
    // Bind Escape only while a dialog is open; closeSftpDialog is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sftpDialogConnection]);

  function focusTerminalPaneAfterDialogClose(paneId: string) {
    const focus = () => getPaneRenderer(paneId)?.focus();
    queueMicrotask(focus);
    window.requestAnimationFrame(focus);
  }

  function closeSftpDialog() {
    const restorePaneId = sftpFocusRestorePaneIdRef.current;
    sftpFocusRestorePaneIdRef.current = null;
    sftpOpenRequestIdRef.current += 1;
    setSftpDialogConnection(null);
    if (restorePaneId) {
      focusTerminalPaneAfterDialogClose(restorePaneId);
    }
  }

  async function openSftpDialog(connection: Connection, paneId: string) {
    const requestId = sftpOpenRequestIdRef.current + 1;
    sftpOpenRequestIdRef.current = requestId;
    sftpFocusRestorePaneIdRef.current = paneId === focusedPaneId ? paneId : null;
    const pane = tab.panes.find((candidate) => candidate.id === paneId);
    const initialRemotePath = await resolveSftpDialogInitialRemotePath(connection, pane);
    if (sftpOpenRequestIdRef.current !== requestId) {
      return;
    }
    setSftpDialogInitialRemotePath(initialRemotePath);
    setSftpDialogConnection(connection);
  }

  function closeSshPortForwardingDialog() {
    const restorePaneId = sshPortForwardingFocusRestorePaneIdRef.current;
    sshPortForwardingFocusRestorePaneIdRef.current = null;
    setSshPortForwardingDialogConnection(null);
    setSshPortForwardingDialogSessionId(null);
    setSshPortForwardingDialogPaneId(null);
    if (restorePaneId) {
      focusTerminalPaneAfterDialogClose(restorePaneId);
    }
  }

  function openSshPortForwardingDialog(connection: Connection, paneId: string, sessionId: string | null) {
    sshPortForwardingFocusRestorePaneIdRef.current = paneId === focusedPaneId ? paneId : null;
    setSshPortForwardingDialogPaneId(paneId);
    setSshPortForwardingDialogConnection(connection);
    setSshPortForwardingDialogSessionId(sessionId);
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
      applyFontSizeToPane(pane.id, size);
    }
  }

  function applyFontSizeToPane(paneId: string, size: number) {
    const renderer = getPaneRenderer(paneId);
    renderer?.setFontSize(size);
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
  function restoreFocusedTerminalPane(reason: string) {
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
    // when it already holds focus. Schedule another pass for app activation,
    // because WebView2 can ignore textarea focus until the webview receives
    // native keyboard focus after an Alt+Tab return.
    focusRenderer();
    window.requestAnimationFrame(focusRenderer);
    if (isTauriRuntime()) {
      // Restore keyboard focus through WebView2's own MoveFocus
      // (focusCurrentWebview), NOT by raising the frame with SetForegroundWindow
      // (focusMainWindow). With the custom title bar (decorations: false) the OS
      // no longer auto-restores focus to the WebView2 content child on
      // activation, and raising the top-level frame first yanked focus back up to
      // the frame HWND — the regression behind the lost-input bug. MoveFocus is
      // the documented path a native title bar leverages to route WM_KEYDOWN into
      // the web content, so we call it alone.
      void focusCurrentWebview()
        .catch(() => undefined)
        .finally(() => {
          window.requestAnimationFrame(focusRenderer);
          logTerminalFocusDiagnostic(`restored:${reason}`);
        });
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
    // Re-arm on focus/active changes; restoreFocusedTerminalPane is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Re-bind activation listeners on focus/active changes; restoreFocusedTerminalPane is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedPaneId, isActive]);

  function handleFontChange(delta: number | "reset") {
    const next = delta === "reset" ? defaultFontSize : currentFontSize() + delta;
    const clamped = Math.min(Math.max(Math.round(next), 6), 64);
    if (focusedTerminalPane?.childConnectionId) {
      const persisted = Math.min(Math.max(clamped, 8), 32);
      applyFontSizeToPane(focusedTerminalPane.id, clamped);
      updateOpenTerminalPaneFontSize(tab.id, focusedTerminalPane.id, persisted);
      return;
    }
    applyFontSizeToPanes(clamped);
    void persistTerminalFontSize(clamped);
  }

  async function persistTerminalFontSize(fontSize: number) {
    // The durable terminal font size is capped at the Settings range, while the
    // live toolbar zoom range is wider. Clamp before persisting so the default
    // reloaded on the next app launch always passes backend validation.
    const persisted = Math.min(Math.max(fontSize, 8), 32);
    if (persisted === terminalSettings.fontSize) {
      return;
    }
    const nextSettings = { ...terminalSettings, fontSize: persisted };
    try {
      const saved = isTauriRuntime()
        ? await invokeCommand("update_terminal_settings", { request: nextSettings })
        : nextSettings;
      setTerminalSettings(saved);
    } catch {
      // Best-effort: the live panes already reflect the new size even if saving
      // the durable default fails.
    }
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
            onCloseSinglePane={onClose}
            onFocusPane={(paneId) => setFocusedPane(tab.id, paneId)}
            canSplit={canSplit}
            sharedTerminalBackground={workspaceTerminalBackground}
            sharedTerminalBackgroundOwnerPane={sharedTerminalBackgroundOwnerPane}
            usePaneTerminalBackgrounds={usePaneTerminalBackgrounds}
            onFontChange={handleFontChange}
            onOpenAssistant={onOpenAssistant}
            onOpenSftp={openSftpDialog}
            onOpenSshPortForwarding={openSshPortForwardingDialog}
            onSaveBuffer={(paneId) => void handleSaveBuffer(paneId)}
            showSftpButton={showSftpButton}
            onSplit={handleSplit}
            quickCommandBarVisible={quickCommandBarVisible}
            onToggleQuickCommandBar={() => setQuickCommandBarVisible(tab.id, !quickCommandBarVisible)}
            trackConnectionSession={trackConnectionSession}
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
            <div className="sftp-popup-dialog-body">
              <Suspense fallback={null}>
                <SftpWorkspace
                  isActive={true}
                  tab={sftpDialogTab}
                  inline
                  onClose={closeSftpDialog}
                  protocolSourceConnection={sftpDialogConnection ?? undefined}
                  initialRemotePath={sftpDialogInitialRemotePath}
                />
              </Suspense>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
      {sshPortForwardingDialogConnection ? createPortal(
        <SshPortForwardingDialog
          connection={sshPortForwardingDialogConnection}
          sessionId={sshPortForwardingDialogSessionId}
          failedForwardIds={
            tab.panes.find((pane): pane is TerminalPane =>
              isTerminalPane(pane) && pane.id === sshPortForwardingDialogPaneId,
            )?.sshPortForwardFailures ?? []
          }
          onForwardFailuresChange={(failedForwardIds) => {
            if (sshPortForwardingDialogPaneId) {
              setOpenTerminalPaneSshForwardFailures(tab.id, sshPortForwardingDialogPaneId, failedForwardIds);
            }
          }}
          onClose={closeSshPortForwardingDialog}
          onConnectionUpdated={(updatedConnection) => {
            refreshOpenConnectionMetadata(updatedConnection);
            notifyConnectionTreeInvalidated();
            setSshPortForwardingDialogConnection(updatedConnection);
          }}
        />,
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
  onCloseSinglePane,
  onFocusPane,
  canSplit,
  sharedTerminalBackground,
  sharedTerminalBackgroundOwnerPane,
  usePaneTerminalBackgrounds,
  onFontChange,
  onOpenAssistant,
  onOpenSftp,
  onOpenSshPortForwarding,
  onSaveBuffer,
  showSftpButton,
  onSplit,
  quickCommandBarVisible,
  onToggleQuickCommandBar,
  trackConnectionSession,
}: {
  isActive: boolean;
  tabId: string;
  layout: LayoutNode;
  panes: WorkspacePane[];
  focusedPaneId: string | undefined;
  maximizedPaneId?: string;
  canCloseSinglePane: boolean;
  onCloseSinglePane?: () => void;
  onFocusPane: (paneId: string) => void;
  canSplit: boolean;
  sharedTerminalBackground: Connection["terminalBackground"];
  sharedTerminalBackgroundOwnerPane: TerminalPane | undefined;
  usePaneTerminalBackgrounds: boolean;
  onFontChange: (delta: number | "reset") => void;
  onOpenAssistant: () => void;
  onOpenSftp: (connection: Connection, paneId: string) => void;
  onOpenSshPortForwarding: (connection: Connection, paneId: string, sessionId: string | null) => void;
  onSaveBuffer: (paneId: string) => void;
  showSftpButton: boolean;
  onSplit: (paneId: string, direction: "right" | "left" | "down" | "up") => void;
  quickCommandBarVisible: boolean;
  onToggleQuickCommandBar: () => void;
  trackConnectionSession: boolean;
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
        data-dock-pane-id={pane.id}
        data-dock-tab-id={tabId}
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
            onClosePane={panes.length === 1 ? onCloseSinglePane : undefined}
            onFontChange={onFontChange}
            sharedTerminalBackground={sharedTerminalBackground}
            sharedTerminalBackgroundOwnerPane={sharedTerminalBackgroundOwnerPane}
            usePaneTerminalBackgrounds={usePaneTerminalBackgrounds}
            onOpenAssistant={onOpenAssistant}
            onOpenSftp={onOpenSftp}
            onOpenSshPortForwarding={onOpenSshPortForwarding}
            onSaveBuffer={onSaveBuffer}
            showSftpButton={showSftpButton}
            onSplit={onSplit}
            quickCommandBarVisible={quickCommandBarVisible}
            onToggleQuickCommandBar={onToggleQuickCommandBar}
            trackConnectionSession={trackConnectionSession}
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
          onCloseSinglePane={onCloseSinglePane}
          onFocusPane={onFocusPane}
          canSplit={canSplit}
          sharedTerminalBackground={sharedTerminalBackground}
          sharedTerminalBackgroundOwnerPane={sharedTerminalBackgroundOwnerPane}
          usePaneTerminalBackgrounds={usePaneTerminalBackgrounds}
          onFontChange={onFontChange}
          onOpenAssistant={onOpenAssistant}
          onOpenSftp={onOpenSftp}
          onOpenSshPortForwarding={onOpenSshPortForwarding}
          onSaveBuffer={onSaveBuffer}
          showSftpButton={showSftpButton}
          onSplit={onSplit}
          quickCommandBarVisible={quickCommandBarVisible}
          onToggleQuickCommandBar={onToggleQuickCommandBar}
          trackConnectionSession={trackConnectionSession}
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

// Matches the control sequences xterm emits for pointer/focus activity rather
// than typed text, so the sync-input broadcast can skip them. Covers SGR (1006)
// `CSI < … M/m`, X10 (1000) `CSI M …`, URXVT (1015) `CSI … M`, and focus
// tracking (1004) `CSI I` / `CSI O`. Keyboard sequences (arrows, function keys,
// modifyOtherKeys, IME text) never match these, so they still broadcast.
// eslint-disable-next-line no-control-regex -- ESC (\x1b) is the literal CSI introducer we must match.
const TERMINAL_POINTER_SEQUENCE = /^\x1b\[(M|<[0-9;]*[Mm]|[0-9;]+M|[IO])/;

function isTerminalPointerSequence(data: string): boolean {
  return TERMINAL_POINTER_SEQUENCE.test(data);
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
  const fileBrowserCommands = useMemo(
    () =>
      pane.kind === "sftp" || pane.kind === "ftp" || pane.kind === "localFiles"
        ? fileBrowserCommandsFor(pane.connection)
        : null,
    [pane.kind, pane.connection],
  );
  const embeddedTab: WorkspaceTab = {
    id: pane.id,
    title: pane.title,
    subtitle:
      pane.kind === "webview"
        ? formatUrlPaneSubtitle(pane.url)
        : formatEmbeddedConnectionPaneSubtitle(pane.connection),
    kind: pane.kind,
    panes: [],
    connection: pane.connection,
    url: pane.kind === "webview" ? pane.url : undefined,
    dataPartition: pane.kind === "webview" ? pane.dataPartition : undefined,
  };

  // Dispatch the embedded surface by pane kind. The `default` exhaustiveness
  // guard makes a new pane kind a compile error here instead of silently
  // rendering the SFTP browser (the fallthrough bug this replaced).
  let body: ReactNode;
  switch (pane.kind) {
    case "webview":
      body = (
        <WebViewWorkspace
          isActive={isActive}
          onClose={canClosePane ? () => closePane(tabId, pane.id) : undefined}
          onOpenAssistant={onOpenAssistant}
          tab={embeddedTab}
        />
      );
      break;
    case "remoteDesktop":
      body = (
        <RemoteDesktopWorkspace
          isActive={isActive}
          onOpenAssistant={onOpenAssistant}
          tab={embeddedTab}
        />
      );
      break;
    case "fileViewer":
      body = <FileViewerWorkspace isActive={isActive} tab={embeddedTab} />;
      break;
    case "sftp":
    case "ftp":
    case "localFiles":
      body = (
        <SftpWorkspace
          commands={fileBrowserCommands ?? undefined}
          isActive={isActive}
          tab={embeddedTab}
        />
      );
      break;
    default:
      body = assertNeverPane(pane);
  }

  // The URL surface closes from its own toolbar (matching the singleton tab
  // layout), so the floating overlay close button is suppressed for webview
  // panes to avoid a second, misaligned X.
  const showOverlayClose = canClosePane && pane.kind !== "webview";

  function handleEmbeddedPaneMouseDown(event: ReactMouseEvent<HTMLElement>) {
    if (shouldDeferPaneFocusUntilClick(event.target)) {
      return;
    }
    onFocus();
  }

  function handleEmbeddedPaneClick(event: ReactMouseEvent<HTMLElement>) {
    if (shouldDeferPaneFocusUntilClick(event.target)) {
      onFocus();
    }
  }

  return (
    <article
      className="embedded-workspace-pane"
      onClick={handleEmbeddedPaneClick}
      onMouseDown={handleEmbeddedPaneMouseDown}
    >
      {showOverlayClose ? (
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
      <Suspense fallback={null}>{body}</Suspense>
    </article>
  );
}

/** Compile-time exhaustiveness guard for embeddable pane kinds: if a new
 * `WorkspacePane` kind is added, the `EmbeddedConnectionPane` switch fails to
 * type-check here rather than silently falling back to a wrong surface. */
function assertNeverPane(pane: never): never {
  throw new Error(
    `Unhandled embedded pane kind: ${String((pane as { kind?: unknown }).kind)}`,
  );
}

function formatUrlPaneSubtitle(url: string) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function formatEmbeddedConnectionPaneSubtitle(connection: Connection) {
  if (connection.type === "localFiles") {
    return connection.localStartupDirectory || connection.host || "";
  }
  if (connection.user.trim()) {
    return `${connection.user}@${connection.host}`;
  }
  return connection.host;
}

function formatTmuxSessionTimestamp(value?: number) {
  if (!value) {
    return "";
  }
  return new Date(value * 1000).toLocaleString();
}

function TmuxSessionTag({
  connection,
  isChildConnection = false,
  onMouseModeChange,
  sessionId,
  tabId,
}: {
  connection: Connection;
  isChildConnection?: boolean;
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
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();

  const tabs = useWorkspaceStore((state) => state.tabs);
  const defaultUseTmuxSessions = useWorkspaceStore(
    (state) => state.sshSettings.defaultUseTmuxSessions,
  );
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const setFocusedPane = useWorkspaceStore((state) => state.setFocusedPane);
  const openTmuxSessionInPane = useWorkspaceStore((state) => state.openTmuxSessionInPane);
  const renameTmuxSessionInOpenPanes = useWorkspaceStore((state) => state.renameTmuxSessionInOpenPanes);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);

  // psmux is the local-shell counterpart to SSH tmux. The popover UI is shared;
  // only the transport differs (one-shot local psmux.exe vs SSH channel).
  const isPsmux = connection.type === "local" && connection.usePsmuxSessions === true;
  const enabled =
    Boolean(sessionId) &&
    (isPsmux || connectionUsesTmux(connection, defaultUseTmuxSessions));
  const multiplexerLabel = isPsmux ? "psmux" : "tmux";
  const showLabel = isPsmux ? t("terminal.showPsmux") : t("terminal.showTmux");
  const sessionsLabel = isPsmux ? t("terminal.psmuxSessions") : t("terminal.tmuxSessions");
  const tagLabel = isChildConnection ? multiplexerLabel : `${multiplexerLabel} ${sessionId}`;
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
      const clickedWrapper = Boolean(wrapperRef.current && target && wrapperRef.current.contains(target));
      const clickedMenu = Boolean(menuRef.current && target && menuRef.current.contains(target));
      if (!clickedWrapper && !clickedMenu) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function positionMenu() {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) {
        return;
      }

      const triggerBounds = trigger.getBoundingClientRect();
      const menuBounds = menu.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 6;
      const maxLeft = window.innerWidth - menuBounds.width - viewportPadding;
      const below = triggerBounds.bottom + gap;
      const above = triggerBounds.top - menuBounds.height - gap;
      const top =
        below + menuBounds.height > window.innerHeight - viewportPadding && above >= viewportPadding
          ? above
          : Math.min(below, window.innerHeight - menuBounds.height - viewportPadding);

      menu.style.left = `${Math.max(viewportPadding, Math.min(triggerBounds.right - menuBounds.width, maxLeft))}px`;
      menu.style.top = `${Math.max(viewportPadding, top)}px`;
    }

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [editingSessionId, error, expandedSessionId, loading, open, sessions.length]);

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

  async function fetchSessions() {
    if (isPsmux) {
      return invokeCommand("list_psmux_sessions", {});
    }
    return invokeCommand("list_tmux_sessions", {
      request: tmuxConnectionRequest(connection),
    });
  }

  async function invokeCloseSession(targetSessionId: string) {
    if (isPsmux) {
      return invokeCommand("close_psmux_session", { psmuxSessionId: targetSessionId });
    }
    return invokeCommand("close_tmux_session", {
      request: { ...tmuxConnectionRequest(connection), tmuxSessionId: targetSessionId },
    });
  }

  async function invokeRenameSession(targetSessionId: string, nextSessionId: string) {
    if (isPsmux) {
      return invokeCommand("rename_psmux_session", {
        psmuxSessionId: targetSessionId,
        newPsmuxSessionId: nextSessionId,
      });
    }
    return invokeCommand("rename_tmux_session", {
      request: {
        ...tmuxConnectionRequest(connection),
        tmuxSessionId: targetSessionId,
        newTmuxSessionId: nextSessionId,
      },
    });
  }

  async function invokeSetMouse(targetSessionId: string, nextEnabled: boolean) {
    if (isPsmux) {
      return invokeCommand("set_psmux_mouse", {
        psmuxSessionId: targetSessionId,
        enabled: nextEnabled,
      });
    }
    return invokeCommand("set_tmux_mouse", {
      request: {
        ...tmuxConnectionRequest(connection),
        tmuxSessionId: targetSessionId,
        enabled: nextEnabled,
      },
    });
  }

  async function loadSessions() {
    if (!enabled || !isTauriRuntime()) {
      setSessions([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await fetchSessions();
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
      await invokeCloseSession(targetSessionId);
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
      await invokeRenameSession(editingSessionId, nextSessionId);
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
      await invokeSetMouse(targetSessionId, nextEnabled);
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
    <div className="tmux-session-wrapper" data-tutorial-id="terminal.tmuxSessions" ref={wrapperRef}>
      <div className="tmux-session-tag-group">
        <button
          className="tmux-session-tag"
          {...dialogButtonAria(open)}
          onClick={() => void handleToggle()}
          ref={triggerRef}
          title={showLabel}
          type="button"
        >
          <span>{tagLabel}</span>
        </button>
      </div>
      {open ? createPortal(
        <div
          className="tmux-session-menu tmux-session-menu-portal"
          role="dialog"
          aria-label={sessionsLabel}
          ref={menuRef}
        >
          <header>
            <strong>{sessionsLabel}</strong>
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
              const sessionTimestamp = formatTmuxSessionTimestamp(session.lastAttached);

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
                          {sessionTimestamp ? ` · ${sessionTimestamp}` : ""}
                        </small>
                        {session.path ? <small className="tmux-session-path">{session.path}</small> : null}
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
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function tmuxConnectionRequest(connection: Connection) {
  const sshSettings = useWorkspaceStore.getState().sshSettings;
  return {
    host: connection.host,
    user: connection.user,
    port: connection.port,
    keyPath: connection.keyPath,
    proxyJump: connection.proxyJump,
    ...resolveSshSocksProxyRequest(connection),
    sshCompression: resolveSshCompression(connection, sshSettings),
    authMethod: connection.authMethod,
    secretOwnerId: connectionPasswordOwnerId(connection),
    passphraseOwnerId: connection.id,
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

// Connection ids with an OS-detection request in flight, so concurrently
// opening panes of the same Connection only probe the remote host once.
const osDetectInFlight = new Set<string>();

// On the first SSH connect, detect the remote OS and set a matching distro/OS
// logo as the Connection icon. It runs once per Connection (then a persistent
// "done" flag stops it, so the host is probed only once for performance) and is
// skipped when the user has chosen an icon, so a hand-picked icon is never
// overridden.
async function maybeAutoDetectOsIcon(connection: Connection, sessionId?: string) {
  if (!shouldAutoDetectOsIcon(connection) || osDetectInFlight.has(connection.id)) {
    return;
  }
  osDetectInFlight.add(connection.id);
  try {
    const detected = await invokeCommand("detect_ssh_remote_os", {
      request: tmuxConnectionRequest(connection),
      sessionId,
    });
    const iconId = osIconIdForDetection(detected);
    if (!iconId) {
      // No usable result (unreachable, non-POSIX shell, unknown OS): leave the
      // default icon in place.
      return;
    }
    // Re-check: the user may have chosen an icon while we probed.
    const current = useWorkspaceStore
      .getState()
      .tabs.flatMap((tab) => [tab.connection, ...tab.panes.map((pane) => pane.connection)])
      .find((candidate) => candidate?.id === connection.id);
    if (!shouldAutoDetectOsIcon({ ...connection, iconDataUrl: current?.iconDataUrl ?? connection.iconDataUrl })) {
      return;
    }
    const updated = await invokeCommand("update_connection_icon_data_url", {
      connectionId: connection.id,
      iconDataUrl: osIconRefForId(iconId),
    });
    if (updated) {
      useWorkspaceStore.getState().refreshOpenConnectionMetadata(updated);
      notifyConnectionTreeInvalidated();
    }
  } catch {
    // Detection is best-effort: a transient error leaves the default connection
    // icon in place. Since this runs after an SSH Connection is established, the
    // in-flight guard still keeps concurrent pane opens from multiplying probes.
  } finally {
    // The remote probe was attempted for this established SSH Connection.
    // Whether or not it maps to a bundled logo, do not probe this Connection
    // again on later opens.
    markOsIconAutoDetectDone(connection.id);
    osDetectInFlight.delete(connection.id);
  }
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
  onClosePane,
  onFontChange,
  sharedTerminalBackground,
  sharedTerminalBackgroundOwnerPane,
  usePaneTerminalBackgrounds,
  onOpenAssistant,
  onOpenSftp,
  onOpenSshPortForwarding,
  onSaveBuffer,
  showSftpButton,
  onSplit,
  quickCommandBarVisible,
  onToggleQuickCommandBar,
  trackConnectionSession,
}: {
  isActive: boolean;
  tabId: string;
  pane: TerminalPane;
  isFocused: boolean;
  onFocus: () => void;
  canSplit: boolean;
  canClosePane: boolean;
  onClosePane?: () => void;
  onFontChange: (delta: number | "reset") => void;
  sharedTerminalBackground: Connection["terminalBackground"];
  sharedTerminalBackgroundOwnerPane: TerminalPane | undefined;
  usePaneTerminalBackgrounds: boolean;
  onOpenAssistant: () => void;
  onOpenSftp: (connection: Connection, paneId: string) => void;
  onOpenSshPortForwarding: (connection: Connection, paneId: string, sessionId: string | null) => void;
  onSaveBuffer: (paneId: string) => void;
  showSftpButton: boolean;
  onSplit: (paneId: string, direction: "right" | "left" | "down" | "up") => void;
  quickCommandBarVisible: boolean;
  onToggleQuickCommandBar: () => void;
  trackConnectionSession: boolean;
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
  // tmux startup-script injection is driven by the remote "session created" /
  // "session attached" markers so we replay the script exactly once, and only on a
  // fresh session unless the user opted into applying it on every attach.
  const sshStartupPendingInputRef = useRef("");
  const sshStartupApplyOnAttachRef = useRef(false);
  const sshStartupInjectedRef = useRef(false);
  const sshStartupMarkerTailRef = useRef("");
  const multilinePasteConfirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const selectedTerminalTextRef = useRef("");
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);
  // The xterm custom key handler is installed once per terminal, so shortcut
  // targets that change across renders are reached through a ref.
  const shortcutHandlersRef = useRef({ canSplit, onFontChange, onSplit });
  useEffect(() => {
    shortcutHandlersRef.current = { canSplit, onFontChange, onSplit };
  }, [canSplit, onFontChange, onSplit]);
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
  const [terminalConnectionState, setTerminalConnectionState] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const [backgroundPopoverOpen, setBackgroundPopoverOpen] = useState(false);
  const [hasTerminalSelection, setHasTerminalSelection] = useState(false);
  const [multilinePasteConfirmationOpen, setMultilinePasteConfirmationOpen] = useState(false);
  const [recordingInfo, setRecordingInfo] = useState<TerminalRecordingInfo | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [tmuxMouseEnabled, setTmuxMouseEnabled] = useState(true);
  const [quickSelect, setQuickSelect] = useState<{
    matches: LabeledQuickSelectMatch[];
    offsetLeft: number;
    offsetTop: number;
    cellWidth: number;
    cellHeight: number;
    input: string;
  } | null>(null);
  const quickSelectOverlayRef = useRef<HTMLDivElement | null>(null);

  function updateTerminalSelection(selection: string) {
    selectedTerminalTextRef.current = selection;
    setHasTerminalSelection(Boolean(selection));
  }

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

  function handlePaneMouseDown(event: ReactMouseEvent<HTMLElement>) {
    if (shouldDeferPaneFocusUntilClick(event.target)) {
      return;
    }
    onFocus();
    focusTerminalRenderer();
  }

  function handlePaneClick(event: ReactMouseEvent<HTMLElement>) {
    if (shouldDeferPaneFocusUntilClick(event.target)) {
      onFocus();
    }
  }

  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const actionsMenuPortalRef = useRef<HTMLDivElement | null>(null);
  const terminalSettings = useWorkspaceStore((state) => state.terminalSettings);
  const sshSettings = useWorkspaceStore((state) => state.sshSettings);
  const openNoteEditor = useWorkspaceStore((state) => state.openNoteEditor);
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const syncInputEnabled = useWorkspaceStore((state) => state.syncInputEnabled);
  const setSyncInputEnabled = useWorkspaceStore((state) => state.setSyncInputEnabled);
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
  const updateOpenConnectionTerminalColorScheme = useWorkspaceStore((state) => state.updateOpenConnectionTerminalColorScheme);
  const updateOpenConnectionTerminalSyntaxHighlightProfile = useWorkspaceStore((state) => state.updateOpenConnectionTerminalSyntaxHighlightProfile);
  const updateOpenTerminalPaneAppearance = useWorkspaceStore((state) => state.updateOpenTerminalPaneAppearance);
  const updateOpenTerminalPaneBackground = useWorkspaceStore((state) => state.updateOpenTerminalPaneBackground);
  const updateOpenTerminalPaneTextEncoding = useWorkspaceStore((state) => state.updateOpenTerminalPaneTextEncoding);
  const updateOpenTerminalPaneX11ForwardingStatus = useWorkspaceStore((state) => state.updateOpenTerminalPaneX11ForwardingStatus);
  const setOpenTerminalPaneSshForwardFailures = useWorkspaceStore((state) => state.setOpenTerminalPaneSshForwardFailures);
  const markOpenTerminalPaneTmuxUnavailable = useWorkspaceStore((state) => state.markOpenTerminalPaneTmuxUnavailable);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const openTerminalRecordingsBrowser = useWorkspaceStore((state) => state.openTerminalRecordingsBrowser);
  const openGitBrowser = useWorkspaceStore((state) => state.openGitBrowser);
  // Show the Git icon when a local terminal's directory is inside a repo. Use
  // the OSC-reported cwd when available, otherwise fall back to the Connection's
  // startup directory so the icon can appear before any OSC 7 update. Remote
  // (SSH) terminals run git on another host and are out of scope here.
  const isLocalTerminal = pane.connection?.type === "local";
  const gitDetectPath = isLocalTerminal
    ? pane.cwd || pane.connection?.localStartupDirectory || undefined
    : undefined;
  const gitRepo = useGitRepoDetection(gitDetectPath, isLocalTerminal);
  const { t } = useTranslation();
  const isReconnectableTerminal =
    pane.connection?.type === "ssh" ||
    pane.connection?.type === "telnet" ||
    pane.connection?.type === "serial";
  const terminalOpacity =
    pane.connection?.terminalOpacity ?? (100 - terminalSettings.defaultTransparency);
  const terminalTransparency = 100 - terminalOpacity;
  const terminalBackground = resolveVisibleTerminalBackground({
    connectionBackground: pane.connection?.terminalBackground,
    paneBackground: pane.terminalBackground,
    sharedBackground: sharedTerminalBackground,
    usePaneBackground: usePaneTerminalBackgrounds,
  });
  // Per-Connection color scheme override wins over the global Terminal
  // Settings default; both live-apply to the open renderer below.
  const terminalColorScheme = pane.connection?.terminalColorScheme ?? terminalSettings.colorScheme;
  const syntaxHighlightProfiles = allSyntaxHighlightProfiles(terminalSettings.syntaxHighlightProfiles);
  const syntaxHighlightProfile = findSyntaxHighlightProfile(
    pane.connection?.terminalSyntaxHighlightProfileId,
    terminalSettings.syntaxHighlightProfiles,
  );
  const globalTerminalColorScheme = resolveTerminalColorScheme(terminalSettings.colorScheme);
  const terminalToolbarBackground =
    terminalBackground
      ? hexColorWithAlpha(
          resolveTerminalColorScheme(terminalColorScheme).palette.background,
          terminalToolbarOpacity(terminalOpacity) / 100,
        )
      : undefined;
  const committedTerminalColorSchemeRef = useRef(terminalColorScheme);

  useEffect(() => {
    committedTerminalColorSchemeRef.current = terminalColorScheme;
    terminalRendererRef.current?.setColorScheme(terminalColorScheme);
  }, [terminalColorScheme]);

  useEffect(() => {
    terminalRendererRef.current?.setSyntaxHighlightProfile(syntaxHighlightProfile);
  }, [syntaxHighlightProfile]);

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
    function handleReconnectRequest(event: Event) {
      const detail = (event as CustomEvent<ReconnectTerminalConnectionDetail>).detail;
      if (isReconnectableTerminal && detail?.connectionId === pane.connection?.id) {
        setReconnectGeneration((generation) => generation + 1);
      }
    }

    window.addEventListener(RECONNECT_TERMINAL_CONNECTION_EVENT, handleReconnectRequest);
    return () =>
      window.removeEventListener(RECONNECT_TERMINAL_CONNECTION_EVENT, handleReconnectRequest);
  }, [isReconnectableTerminal, pane.connection?.id]);

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

  useEffect(() => {
    if (quickSelect) {
      quickSelectOverlayRef.current?.focus();
    }
  }, [quickSelect]);

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
    // The confirm sheet's button holds DOM focus when it is clicked, so once
    // the dialog unmounts focus falls to <body>. Return it to the terminal
    // after the unmount commits, on both confirm and cancel.
    const focus = () => terminalRendererRef.current?.focus();
    queueMicrotask(focus);
    window.requestAnimationFrame(focus);
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
      const clickedTrigger = Boolean(
        actionsMenuRef.current && target && actionsMenuRef.current.contains(target),
      );
      const clickedMenu = Boolean(
        actionsMenuPortalRef.current && target && actionsMenuPortalRef.current.contains(target),
      );
      if (!clickedTrigger && !clickedMenu) {
        setActionsMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [actionsMenuOpen]);

  useLayoutEffect(() => {
    if (!actionsMenuOpen) {
      return;
    }

    function positionActionsMenu() {
      const trigger = actionsMenuTriggerRef.current;
      const menu = actionsMenuPortalRef.current;
      if (!trigger || !menu) {
        return;
      }

      menu.classList.remove("terminal-actions-menu-submenus-right");
      const triggerBounds = trigger.getBoundingClientRect();
      const menuBounds = menu.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 4;
      const maxLeft = window.innerWidth - menuBounds.width - viewportPadding;
      const below = triggerBounds.bottom + gap;
      const above = triggerBounds.top - menuBounds.height - gap;
      const top =
        below + menuBounds.height > window.innerHeight - viewportPadding && above >= viewportPadding
          ? above
          : Math.min(below, window.innerHeight - menuBounds.height - viewportPadding);
      const left = Math.max(
        viewportPadding,
        Math.min(triggerBounds.right - menuBounds.width, maxLeft),
      );

      menu.style.left = `${left}px`;
      menu.style.top = `${Math.max(viewportPadding, top)}px`;

      let widestSubmenu = 0;
      const submenuPanels = menu.querySelectorAll<HTMLElement>(".terminal-menu-submenu-panel");
      for (const panel of submenuPanels) {
        const display = panel.style.display;
        const visibility = panel.style.visibility;
        panel.style.display = "grid";
        panel.style.visibility = "hidden";
        widestSubmenu = Math.max(widestSubmenu, panel.getBoundingClientRect().width);
        panel.style.display = display;
        panel.style.visibility = visibility;
      }

      const positionedBounds = menu.getBoundingClientRect();
      const activityRailRight =
        document.querySelector(".activity-rail")?.getBoundingClientRect().right ?? 0;
      const fitsLeft = positionedBounds.left - gap - widestSubmenu >= activityRailRight + gap;
      const fitsRight =
        positionedBounds.right + gap + widestSubmenu <= window.innerWidth - viewportPadding;
      menu.classList.toggle(
        "terminal-actions-menu-submenus-right",
        !fitsLeft && fitsRight,
      );
    }

    positionActionsMenu();
    window.addEventListener("resize", positionActionsMenu);
    window.addEventListener("scroll", positionActionsMenu, true);
    return () => {
      window.removeEventListener("resize", positionActionsMenu);
      window.removeEventListener("scroll", positionActionsMenu, true);
    };
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
            fontSize: pane.fontSize ?? terminalSettings.fontSize,
            scrollbackLines: sshSettings.bufferLines,
            allowOsc52Clipboard: sshSettings.allowOsc52Clipboard,
            colorScheme: connection.terminalColorScheme ?? terminalSettings.colorScheme,
          }
        : {
            ...terminalSettings,
            fontSize: pane.fontSize ?? terminalSettings.fontSize,
            colorScheme: connection.terminalColorScheme ?? terminalSettings.colorScheme,
          };
    const terminalHost = element;
    const terminal = createTerminalRenderer(rendererSettings, terminalOpacity, syntaxHighlightProfile);
    terminalRendererRef.current = terminal;
    const cwdDisposable = terminal.onCwdChange((cwd) => updatePaneCwd(tabId, pane.id, cwd));
    const notificationDisposable = terminal.onNotification((notification) => {
      // Read the toggle at event time so turning terminal notifications off in
      // Settings silences already-open terminals immediately.
      if (!useWorkspaceStore.getState().terminalSettings.allowTerminalNotifications) {
        return;
      }
      useWorkspaceStore.getState().showStatusBarNotice(
        notification.title
          ? t("terminal.notificationWithTitle", {
              name: connection.name,
              title: notification.title,
              message: notification.body,
            })
          : t("terminal.notification", { name: connection.name, message: notification.body }),
      );
    });
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
      void focusCurrentWebview().catch(() => undefined);
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

      if (event.type !== "keydown") {
        return true;
      }

      // Terminal-scope Workspace shortcuts, rebindable in Settings →
      // Shortcuts. Workspace-scope shortcuts (Tab management) are handled by
      // the window capture listener before xterm ever sees the key.
      const action = fixedTerminalShortcutFromKeyboardEvent(event)
        ?? workspaceShortcutFromKeyboardEvent(
          event,
          useWorkspaceStore.getState().generalSettings.workspaceShortcuts,
          "terminal",
        );
      switch (action) {
        case "copy": {
          const selection = terminal.getSelection();
          if (selection) {
            void writeToClipboard(selection);
            updateTerminalSelection(selection);
            return false;
          }
          return true;
        }
        case "paste":
          // Prevent the browser's native paste event from also reaching
          // xterm's hidden textarea — otherwise the clipboard text is written
          // twice.
          event.preventDefault();
          void handlePasteIntoTerminal();
          return false;
        case "quickSelect":
          // Quick Select (WezTerm parity): copies a visible token by hint
          // label.
          event.preventDefault();
          startQuickSelect();
          return false;
        case "find":
          event.preventDefault();
          setSearchOpen(true);
          return false;
        case "zoomIn":
          event.preventDefault();
          shortcutHandlersRef.current.onFontChange(1);
          return false;
        case "zoomOut":
          event.preventDefault();
          shortcutHandlersRef.current.onFontChange(-1);
          return false;
        case "zoomReset":
          event.preventDefault();
          shortcutHandlersRef.current.onFontChange("reset");
          return false;
        case "reconnectActiveSession":
          if (!isReconnectableTerminal) {
            return true;
          }
          event.preventDefault();
          setReconnectGeneration((generation) => generation + 1);
          return false;
        case "splitRight":
        case "splitLeft":
        case "splitDown":
        case "splitUp": {
          if (shortcutHandlersRef.current.canSplit) {
            event.preventDefault();
            const direction = action === "splitRight"
              ? "right"
              : action === "splitLeft"
                ? "left"
                : action === "splitDown"
                  ? "down"
                  : "up";
            shortcutHandlersRef.current.onSplit(pane.id, direction);
          }
          return false;
        }
        default:
          break;
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
        notificationDisposable.dispose();
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
    let sessionEnded = false;
    let removeOutputListener: (() => void) | undefined;
    let removeEndedListener: (() => void) | undefined;
    setTerminalConnectionState(sessionStarted ? "connected" : "connecting");
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
      // Read sync state at keystroke time so the broadcast toggle takes effect
      // without re-running this session effect. When on, the same gated input is
      // mirrored to every other open terminal pane.
      void writeWithPasteConfirmation(data, (input) => {
        writeInputToSession(input);
        // Only mirror real keyboard/IME/paste text. xterm routes mouse and
        // focus activity through onData as control sequences too; broadcasting
        // those would dump garbled coordinates into the other panes (and into
        // shells that never enabled mouse mode), so they are filtered out.
        if (useWorkspaceStore.getState().syncInputEnabled && !isTerminalPointerSequence(input)) {
          broadcastInputToOtherPanes(pane.id, input);
        }
      });
    });
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      updateTerminalSelection(selection);
      // Read the setting at selection time so toggling copy-on-select in
      // Settings applies to already-open terminals without re-running this
      // session effect.
      if (selection && useWorkspaceStore.getState().terminalSettings.copyOnSelect) {
        void writeToClipboard(selection);
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
      const [unlistenOutput, unlistenEnded] = await Promise.all([
        listen<TerminalOutput>("terminal-output", (event) => {
          if (event.payload.sessionId !== sessionIdRef.current) {
            return;
          }
          terminal.write(event.payload.data);
          if (pane.tmuxSessionId) {
            tmuxStartupOutputTailRef.current = (tmuxStartupOutputTailRef.current + event.payload.data).slice(
              -TMUX_UNAVAILABLE_MARKER.length * 2,
            );
            if (tmuxStartupOutputTailRef.current.includes(TMUX_UNAVAILABLE_MARKER)) {
              markOpenTerminalPaneTmuxUnavailable(tabId, pane.id);
              if (!sshStartupInjectedRef.current && sshStartupPendingInputRef.current) {
                sshStartupInjectedRef.current = true;
                writeInputToSession(sshStartupPendingInputRef.current);
              }
            }
            // Replay the SSH startup script based on the authoritative session-state
            // marker: always on a freshly created session, and on attach only when the
            // Connection opted in. We inject at most once per session open.
            if (!sshStartupInjectedRef.current && sshStartupPendingInputRef.current) {
              sshStartupMarkerTailRef.current = (sshStartupMarkerTailRef.current + event.payload.data).slice(
                -TMUX_MARKER_TAIL_LENGTH,
              );
              if (sshStartupMarkerTailRef.current.includes(TMUX_SESSION_CREATED_MARKER)) {
                sshStartupInjectedRef.current = true;
                writeInputToSession(sshStartupPendingInputRef.current);
              } else if (sshStartupMarkerTailRef.current.includes(TMUX_SESSION_ATTACHED_MARKER)) {
                sshStartupInjectedRef.current = true;
                if (sshStartupApplyOnAttachRef.current) {
                  writeInputToSession(sshStartupPendingInputRef.current);
                }
              }
            }
          }
        }),
        listen<TerminalSessionEnded>("terminal-session-ended", (event) => {
          if (event.payload.sessionId !== sessionIdRef.current) {
            return;
          }
          sessionEnded = true;
          setTerminalConnectionState("disconnected");
          if (sessionStarted && trackConnectionSession) {
            sessionStarted = false;
            markConnectionSessionEnded(connection.id);
          }
        }),
      ]);
      if (disposed) {
        unlistenOutput();
        unlistenEnded();
        return;
      }
      removeOutputListener = unlistenOutput;
      removeEndedListener = unlistenEnded;

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
              ...resolveSshSocksProxyRequest(connection),
              sshOldProtocols: resolveSshOldProtocols(connection, sshSettings),
            },
          });
          await confirmTrustedSshHostKey(preview, sshSettings);
        }

        const terminalStartAt = performance.now();
        const terminalDimensions = terminal.dimensions;
        const requestedShell =
          connection.type === "local"
            ? resolveAvailableLocalShell(
                connection.localShell ?? terminalSettings.defaultShell,
                localShellOptionsForPlatform(terminalSettings.customShells),
              )
            : undefined;
        const shell =
          connection.type === "local"
            ? await resolveLocalShellForLaunch(requestedShell, terminal)
            : requestedShell;
        if (disposed) {
          return;
        }
        const localStartup = localStartupFor(connection, shell);
        // Arm tmux startup-script replay before the session starts so the output
        // listener never misses an early session-state marker. Non-tmux SSH injects
        // directly after start (no session to reuse), so it leaves the refs disarmed.
        const sshStartupInput = sshStartupInputFor(connection);
        // The remote tmux command (and its session-state markers) only runs when a
        // tmux session id is present; otherwise the backend falls back to a plain
        // shell, which we treat like non-tmux SSH and inject into directly.
        const sshUsesTmux =
          connectionUsesTmux(connection, sshSettings.defaultUseTmuxSessions) &&
          Boolean(pane.tmuxSessionId);
        sshStartupInjectedRef.current = false;
        sshStartupMarkerTailRef.current = "";
        sshStartupPendingInputRef.current = sshStartupInput && sshUsesTmux ? sshStartupInput : "";
        sshStartupApplyOnAttachRef.current = sshUsesTmux
          ? readSshApplyStartupToExistingTmux(connection.id)
          : false;
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
            ...resolveSshSocksProxyRequest(connection),
            authMethod: connection.authMethod,
            secretOwnerId: connectionPasswordOwnerId(connection),
            passphraseOwnerId: connection.type === "ssh" ? connection.id : undefined,
            shell,
            serialLine: connection.type === "serial" ? connection.serialLine ?? connection.host : undefined,
            serialSpeed: connection.type === "serial" ? connection.serialSpeed ?? 9600 : undefined,
            initialDirectory: initialDirectoryForTerminalSession(connection, pane.cwd),
            environmentVariables: localStartup.environmentVariables,
            cols: terminalDimensions.cols,
            pixelHeight: terminalDimensions.pixelHeight,
            pixelWidth: terminalDimensions.pixelWidth,
            rows: terminalDimensions.rows,
            useTmux: connectionUsesTmux(connection, sshSettings.defaultUseTmuxSessions),
            tmuxSessionId: pane.tmuxSessionId,
            usePsmux: connection.type === "local" && connection.usePsmuxSessions === true,
            psmuxSessionId: connection.type === "local" ? pane.tmuxSessionId : undefined,
            sshBufferLines: connection.type === "ssh" ? sshSettings.bufferLines : undefined,
            sshCompression:
              connection.type === "ssh" ? resolveSshCompression(connection, sshSettings) : undefined,
            sshOldProtocols: connection.type === "ssh" ? resolveSshOldProtocols(connection, sshSettings) : undefined,
            textEncoding: normalizeTerminalEncoding(pane.textEncoding),
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
        if (sessionEnded) {
          return;
        }
        sessionStarted = true;
        setTerminalConnectionState("connected");
        if (trackConnectionSession) {
          markConnectionSessionStarted(connection.id);
        }
        if (terminalSettings.autoRecordSessions) {
          // Register recording before startup scripts can produce output.
          setRecordingBusy(true);
          try {
            await startTerminalRecording(result.sessionId, connection);
          } catch (error) {
            if (!disposed) {
              showStatusBarNotice(
                t("terminal.recordingFailed", { message: error instanceof Error ? error.message : String(error) }),
                { tone: "error" },
              );
            }
          } finally {
            if (!disposed) {
              setRecordingBusy(false);
            }
          }
          if (disposed) {
            return;
          }
        }
        if (connection.type === "ssh") {
          updateOpenTerminalPaneX11ForwardingStatus(
            tabId,
            pane.id,
            result.x11ForwardingStatus ?? x11ForwardingStatus,
          );
          void startEnabledSshPortForwardings(
            connection.sshPortForwardings ?? [],
            (forwarding) => invokeCommand("start_ssh_port_forward", {
              request: {
                ...tmuxConnectionRequest(connection),
                forwardId: forwarding.id,
                mode: forwarding.mode,
                bind: forwarding.bind,
                listenPort: forwarding.listenPort,
                destHost: forwarding.destHost,
                destPort: forwarding.destPort,
                remotePort: forwarding.destPort,
                sessionId: result.sessionId,
              },
            }),
          ).then((failures) => {
            if (disposed) {
              return;
            }
            setOpenTerminalPaneSshForwardFailures(
              tabId,
              pane.id,
              failures.map((failure) => failure.forwarding.id),
            );
            if (failures.length > 0) {
              const reason = failures[0].reason;
              showStatusBarNotice(t("terminal.sshPortForwardStartupFailed", {
                message: reason instanceof Error ? reason.message : String(reason),
              }), { tone: "warning" });
            }
          });
        }
        if (localStartup.startupInput) {
          writeInputToSession(localStartup.startupInput);
        }
        if (sshStartupInput && !sshUsesTmux) {
          // Non-tmux SSH lands directly in the remote shell, so there is no session to
          // reuse — replay the script on every connect, like the local shell does.
          // (tmux replay is handled by the session-state marker in the output listener.)
          writeInputToSession(sshStartupInput);
        }
        void maybeAutoDetectOsIcon(connection, result.sessionId);
      } catch (error) {
        setTerminalConnectionState("disconnected");
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
      notificationDisposable.dispose();
      removeOutputListener?.();
      removeEndedListener?.();
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
      if (sessionStarted && !preservingRuntime && trackConnectionSession) {
        markConnectionSessionEnded(connection.id);
      }
      sessionIdRef.current = null;
      lastResizeDimensionsRef.current = null;
      terminalRendererRef.current = null;
      fitAndResizeRef.current = () => undefined;
      updateTerminalSelection("");
      setRecordingInfo(null);
      setRecordingBusy(false);
      setQuickSelect(null);
      setSearchResult({ resultIndex: -1, resultCount: 0, found: true });
      terminal.dispose();
    };
  // A terminal Session belongs to the Pane id. Display metadata updates such
  // as Child Connection Tab rename/icon edits must not tear down and recreate
  // the live SSH/local process.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, reconnectGeneration, tabId]);

  useEffect(() => {
    terminalRendererRef.current?.setBackgroundOpacity(terminalOpacity);
  }, [terminalOpacity]);

  useEffect(() => {
    terminalRendererRef.current?.setFontFamily(terminalSettings.fontFamily);
    fitAndResizeRef.current();
  }, [terminalSettings.fontFamily]);

  useEffect(() => {
    function refreshLoadedCustomFont() {
      scheduleTerminalFontAtlasRefresh("custom-fonts-loaded");
      fitAndResizeRef.current();
    }

    document.addEventListener(CUSTOM_FONTS_LOADED_EVENT, refreshLoadedCustomFont);
    return () => document.removeEventListener(CUSTOM_FONTS_LOADED_EVENT, refreshLoadedCustomFont);
  }, [terminalSettings.fontFamily]);

  useEffect(() => {
    terminalRendererRef.current?.setWheelScrollbackOverride(
      Boolean(pane.tmuxSessionId && !tmuxMouseEnabled),
      handleTmuxWheelScroll,
    );
    // Update the wheel override on tmux/mouse changes; handleTmuxWheelScroll is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.tmuxSessionId, tmuxMouseEnabled]);

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
      logTerminalFontAtlasState("tab-activated");
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

  async function saveTerminalAppearance(
    nextOpacity: number,
    nextBackground = pane.connection?.terminalBackground ?? null,
    targetPane = pane,
  ) {
    const connection = targetPane.connection;
    if (!connection) {
      return;
    }
    const appearance = {
      terminalOpacity: Math.min(Math.max(Math.round(nextOpacity), 0), 100),
      terminalBackground: nextBackground,
    };
    if (targetPane.childConnectionId) {
      updateOpenTerminalPaneAppearance(tabId, targetPane.id, appearance);
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
    if (!usePaneTerminalBackgrounds && sharedTerminalBackgroundOwnerPane) {
      const ownerOpacity =
        sharedTerminalBackgroundOwnerPane.connection?.terminalOpacity ??
        (100 - terminalSettings.defaultTransparency);
      void saveTerminalAppearance(
        ownerOpacity,
        nextBackground,
        sharedTerminalBackgroundOwnerPane,
      );
      return;
    }
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

  async function saveTerminalColorScheme(nextScheme: string | null) {
    const connection = pane.connection;
    if (!connection) {
      return;
    }
    updateOpenConnectionTerminalColorScheme(connection.id, nextScheme);
    if (isTransientLocalConnectionId(connection.id) || !isTauriRuntime()) {
      return;
    }
    try {
      await invokeCommand("update_connection_terminal_color_scheme", {
        connectionId: connection.id,
        terminalColorScheme: nextScheme,
      });
    } catch (error) {
      console.warn("terminal color scheme update failed.", error);
      showStatusBarNotice(t("terminal.colorSchemeSaveFailed", { message: String(error) }), { tone: "error" });
    }
  }

  function previewTerminalColorScheme(nextScheme: string | null) {
    terminalRendererRef.current?.setColorScheme(nextScheme ?? terminalSettings.colorScheme);
  }

  function restoreTerminalColorSchemePreview() {
    terminalRendererRef.current?.setColorScheme(committedTerminalColorSchemeRef.current);
  }

  function commitTerminalColorScheme(nextScheme: string | null) {
    const appliedScheme = nextScheme ?? terminalSettings.colorScheme;
    committedTerminalColorSchemeRef.current = appliedScheme;
    terminalRendererRef.current?.setColorScheme(appliedScheme);
    void saveTerminalColorScheme(nextScheme);
  }

  async function commitSyntaxHighlightProfile(profileId: string | null) {
    const connection = pane.connection;
    if (!connection) return;
    const profile = findSyntaxHighlightProfile(profileId, terminalSettings.syntaxHighlightProfiles);
    terminalRendererRef.current?.setSyntaxHighlightProfile(profile);
    updateOpenConnectionTerminalSyntaxHighlightProfile(connection.id, profileId);
    if (isTransientLocalConnectionId(connection.id) || !isTauriRuntime()) return;
    try {
      await invokeCommand("update_connection_terminal_syntax_highlight_profile", {
        connectionId: connection.id,
        profileId,
      });
    } catch (error) {
      console.warn("terminal keyword highlighting update failed.", error);
      showStatusBarNotice(
        t("terminal.syntaxHighlightSaveFailed", { message: String(error) }),
        { tone: "error" },
      );
    }
  }

  function startQuickSelect() {
    const renderer = terminalRendererRef.current;
    const host = terminalElementRef.current;
    const paneElement = paneRef.current;
    if (!renderer || !host || !paneElement) {
      return;
    }
    const geometry = renderer.getScreenGeometry();
    if (!geometry) {
      return;
    }
    const matches = labelQuickSelectMatches(findQuickSelectMatches(renderer.getViewportLines()));
    if (matches.length === 0) {
      showStatusBarNotice(t("terminal.quickSelectNoMatches"));
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const paneRect = paneElement.getBoundingClientRect();
    setQuickSelect({
      matches,
      offsetLeft: hostRect.left - paneRect.left + geometry.left,
      offsetTop: hostRect.top - paneRect.top + geometry.top,
      cellWidth: geometry.cellWidth,
      cellHeight: geometry.cellHeight,
      input: "",
    });
  }

  function closeQuickSelect() {
    setQuickSelect(null);
    focusTerminalRenderer();
  }

  function copyQuickSelectMatch(match: LabeledQuickSelectMatch) {
    void writeToClipboard(match.text);
    showStatusBarNotice(t("terminal.quickSelectCopied", { text: truncateForNotice(match.text) }), { tone: "success" });
    closeQuickSelect();
  }

  function handleQuickSelectClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    match: LabeledQuickSelectMatch,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const action = quickSelectPointerAction(match.text, event.shiftKey || event.ctrlKey);
    if (action.kind === "open") {
      closeQuickSelect();
      void openExternalUrl(action.url).catch((error) => {
        console.warn("Quick Select external link open failed.", error);
      });
      return;
    }
    copyQuickSelectMatch(match);
  }

  function handleQuickSelectKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!quickSelect) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      closeQuickSelect();
      return;
    }
    if (event.key === "Backspace") {
      setQuickSelect({ ...quickSelect, input: quickSelect.input.slice(0, -1) });
      return;
    }
    if (!/^[a-z]$/i.test(event.key)) {
      return;
    }
    const input = quickSelect.input + event.key.toLowerCase();
    const remaining = quickSelect.matches.filter((match) => match.label.startsWith(input));
    if (remaining.length === 0) {
      return;
    }
    const selected = remaining.find((match) => match.label === input);
    if (selected) {
      copyQuickSelectMatch(selected);
      return;
    }
    setQuickSelect({ ...quickSelect, input });
  }

  function handleCopyTerminalSelection() {
    const text = terminalRendererRef.current?.getSelection() || selectedTerminalTextRef.current;
    if (text) {
      void writeToClipboard(text);
    }
    terminalRendererRef.current?.focus();
  }

  async function handlePasteIntoTerminal() {
    const text = await readFromClipboard();
    if (!text) {
      terminalRendererRef.current?.focus();
      return;
    }

    terminalRendererRef.current?.paste(text);
    terminalRendererRef.current?.focus();
  }

  function handleTerminalContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    onFocus();

    // PuTTY-style right-click paste; Shift+right-click keeps the menu reachable.
    if (terminalSettings.rightClickPaste && !event.shiftKey) {
      void handlePasteIntoTerminal();
      return;
    }

    const selection = terminalRendererRef.current?.getSelection() ?? "";
    updateTerminalSelection(selection);
    void showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("terminal.copy"),
          iconSvg: nativeMenuIcons.copy,
          disabled: !selection,
          action: handleCopyTerminalSelection,
        },
        {
          kind: "item",
          label: t("terminal.paste"),
          iconSvg: nativeMenuIcons.clipboardPaste,
          action: () => void handlePasteIntoTerminal(),
        },
      ],
      { x: event.clientX, y: event.clientY },
    );
  }

  async function startTerminalRecording(sessionId: string, connection: Connection) {
    const dimensions = terminalRendererRef.current?.dimensions;
    const started = await invokeCommand("start_terminal_recording", {
      request: {
        sessionId,
        connectionId: connection.id,
        connectionName: connection.name,
        initialBuffer: terminalRendererRef.current?.getRecordingBufferText() ?? "",
        rows: dimensions?.rows,
        cols: dimensions?.cols,
      },
    });
    setRecordingInfo(started);
    showStatusBarNotice(t("terminal.recordingStarted"));
  }

  async function handleTextEncodingChange(encoding: string) {
    const normalized = normalizeTerminalEncoding(encoding);
    const sessionId = sessionIdRef.current;
    try {
      if (sessionId && isTauriRuntime()) {
        await invokeCommand("set_terminal_encoding", { request: { sessionId, encoding: normalized } });
      }
      updateOpenTerminalPaneTextEncoding(tabId, pane.id, normalized);
      setActionsMenuOpen(false);
      focusTerminalRenderer();
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
    }
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

      await startTerminalRecording(sessionId, connection);
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
    openTerminalRecordingsBrowser(undefined, recordingInfo?.path);
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
    void onOpenSftp(pane.connection, pane.id);
  }

  function handleOpenSshPortForwarding() {
    if (pane.connection?.type !== "ssh") {
      return;
    }
    onOpenSshPortForwarding(pane.connection, pane.id, sessionIdRef.current);
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
        syncInputEnabled ? "terminal-pane-sync-active" : "",
        isFocused ? "terminal-pane-focused" : "terminal-pane-inactive",
      ]
        .filter(Boolean)
        .join(" ")}
      data-tutorial-id="terminal.pane"
      onClick={handlePaneClick}
      onMouseDown={handlePaneMouseDown}
      ref={paneRef}
      style={
        terminalToolbarBackground
          ? ({ "--terminal-toolbar-background": terminalToolbarBackground } as CSSProperties)
          : undefined
      }
    >
      <header>
        <span className="terminal-pane-title">
          {pane.connection ? (
            <ConnectionGlyph
              className="terminal-pane-connection-icon"
              iconBackgroundColor={pane.connection.iconBackgroundColor}
              iconColor={pane.connection.iconColor}
              iconDataUrl={pane.connection.iconDataUrl}
              localShell={pane.connection.localShell}
              size={18}
              type={pane.connection.type}
            />
          ) : (
            <Circle size={9} fill="currentColor" />
          )}
          {paneToolbarTitle}
        </span>
        <div className="terminal-pane-actions">
          {pane.connection ? (
            <TmuxSessionTag
              connection={pane.connection}
              isChildConnection={Boolean(pane.childConnectionId)}
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
          {isSshPane && hasEnabledSshPortForwardings(pane.connection) ? (
            <button
              className={`terminal-pane-action terminal-ssh-forwarding-button${(pane.sshPortForwardFailures?.length ?? 0) > 0 ? " has-failure" : ""}`}
              aria-label={t("terminal.sshPortRedirect")}
              data-tutorial-id="terminal.sshPortRedirect"
              onClick={handleOpenSshPortForwarding}
              title={(pane.sshPortForwardFailures?.length ?? 0) > 0 ? t("terminal.sshPortForwardSomeFailed") : t("terminal.sshPortRedirect")}
              type="button"
            >
              <Network size={13} />
            </button>
          ) : null}
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
          {gitRepo ? (
            <button
              className="terminal-pane-action"
              aria-label={t("git.openBrowser")}
              onClick={() => openGitBrowser(gitRepo.repoRoot, gitRepo.label)}
              title={t("git.openBrowser")}
              type="button"
            >
              <GitIcon name="branch" size={13} />
            </button>
          ) : null}
          <button
            className={`terminal-pane-action terminal-sync-toggle${syncInputEnabled ? " active" : ""}`}
            aria-label={t("workspace.syncInput")}
            aria-pressed={syncInputEnabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const next = !syncInputEnabled;
              setSyncInputEnabled(next);
              if (next) {
                showStatusBarNotice(t("workspace.syncInputEnabledNotice"), { tone: "warning" });
              }
              focusTerminalRenderer();
            }}
            title={t("workspace.syncInput")}
            type="button"
          >
            <Radio size={13} />
          </button>
          <button
            className={`terminal-pane-action quick-command-toggle${quickCommandBarVisible ? " active" : ""}`}
            aria-label={quickCommandBarVisible ? t("terminal.quickCommandsHide") : t("terminal.quickCommandsShow")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onToggleQuickCommandBar();
              focusTerminalRenderer();
            }}
            title={quickCommandBarVisible ? t("terminal.quickCommandsHide") : t("terminal.quickCommandsShow")}
            type="button"
          >
            <PanelBottom size={13} />
          </button>
          <button
            className="terminal-pane-action"
            aria-label={t("terminal.quickSelect")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={startQuickSelect}
            title={t("terminal.quickSelect")}
            type="button"
          >
            <Scan size={13} />
          </button>
          <button
            className="terminal-pane-action"
            aria-label={t("terminal.copySelection")}
            data-tutorial-id="terminal.copySelection"
            disabled={!hasTerminalSelection}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCopyTerminalSelection}
            title={t("terminal.copySelection")}
            type="button"
          >
            <Copy size={13} />
          </button>
          {pane.connection ? (
            <NoteToolbarButton
              connectionId={pane.connection.id}
              onOpen={() => openNoteEditor(pane.connection!.id, pane.connection!.name)}
            />
          ) : null}
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
          {isReconnectableTerminal && terminalConnectionState === "disconnected" ? (
            <button
              aria-label={t("connections.reconnect")}
              className="terminal-pane-action"
              onClick={() => setReconnectGeneration((generation) => generation + 1)}
              title={t("connections.reconnect")}
              type="button"
            >
              <RefreshCw size={13} />
            </button>
          ) : null}
          <div className="terminal-menu-wrapper" ref={actionsMenuRef}>
            <button
              className="terminal-pane-action"
              aria-label={t("terminal.actions")}
              data-tutorial-id="terminal.actions"
              {...menuButtonAria(actionsMenuOpen)}
              onClick={() => setActionsMenuOpen((open) => !open)}
              ref={actionsMenuTriggerRef}
              title={t("terminal.actions")}
              type="button"
            >
              <Menu size={13} />
            </button>
            {actionsMenuOpen ? createPortal(
              <div
                className="terminal-menu terminal-actions-menu terminal-actions-menu-portal"
                ref={actionsMenuPortalRef}
                role="menu"
              >
                {isReconnectableTerminal ? (
                  <button
                    className="terminal-menu-item"
                    onClick={() => {
                      setActionsMenuOpen(false);
                      setReconnectGeneration((generation) => generation + 1);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <RefreshCw size={13} />
                    {t("connections.reconnect")}
                  </button>
                ) : null}
                {isSshPane && pane.connection ? (
                  <button
                    className="terminal-menu-item"
                    onClick={() => {
                      setActionsMenuOpen(false);
                      handleOpenSshPortForwarding();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Network size={13} />
                    {t("terminal.sshPortRedirect")}
                  </button>
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
                      className="terminal-menu-item terminal-color-scheme-item"
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
                  <SaveAsIcon size={13} />
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
                    <Palette size={13} />
                    {t("terminal.colorScheme")}
                    <ChevronRight size={13} className="terminal-menu-chevron" />
                  </button>
                  <div
                    className="terminal-menu terminal-menu-submenu-panel terminal-color-scheme-panel"
                    onMouseLeave={restoreTerminalColorSchemePreview}
                    role="menu"
                  >
                    <button
                      className="terminal-menu-item"
                      onClick={() => {
                        setActionsMenuOpen(false);
                        commitTerminalColorScheme(null);
                        focusTerminalRenderer();
                      }}
                      onMouseEnter={() => previewTerminalColorScheme(null)}
                      role="menuitemradio"
                      aria-checked={!pane.connection?.terminalColorScheme}
                      style={{
                        backgroundColor: globalTerminalColorScheme.palette.background,
                        color: globalTerminalColorScheme.palette.foreground,
                      }}
                      type="button"
                    >
                      <Monitor size={13} />
                      {t("terminal.colorSchemeGlobalDefault")}
                      {!pane.connection?.terminalColorScheme ? (
                        <Check size={13} className="terminal-color-scheme-check" />
                      ) : null}
                    </button>
                    {TERMINAL_COLOR_SCHEMES.map((scheme) => (
                      <button
                        className="terminal-menu-item terminal-color-scheme-item"
                        key={scheme.id}
                        onClick={() => {
                          setActionsMenuOpen(false);
                          commitTerminalColorScheme(scheme.id);
                          focusTerminalRenderer();
                        }}
                        onMouseEnter={() => previewTerminalColorScheme(scheme.id)}
                        role="menuitemradio"
                        aria-checked={pane.connection?.terminalColorScheme === scheme.id}
                        style={{
                          backgroundColor: scheme.palette.background,
                          color: scheme.palette.foreground,
                        }}
                        type="button"
                      >
                        <Palette aria-hidden size={13} />
                        {scheme.name}
                        {pane.connection?.terminalColorScheme === scheme.id ? (
                          <Check size={13} className="terminal-color-scheme-check" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="terminal-menu-submenu">
                  <button
                    className="terminal-menu-item"
                    role="menuitem"
                    type="button"
                  >
                    <Braces size={13} />
                    {t("terminal.syntaxHighlight")}
                    <ChevronRight size={13} className="terminal-menu-chevron" />
                  </button>
                  <div className="terminal-menu terminal-menu-submenu-panel" role="menu">
                    <button
                      aria-checked={!syntaxHighlightProfile}
                      className="terminal-menu-item"
                      onClick={() => {
                        setActionsMenuOpen(false);
                        void commitSyntaxHighlightProfile(null);
                        focusTerminalRenderer();
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      {t("terminal.syntaxHighlightNone")}
                      {!syntaxHighlightProfile ? <Check size={13} className="terminal-color-scheme-check" /> : null}
                    </button>
                    {syntaxHighlightProfiles.map((profile) => {
                      const selectedProfile = syntaxHighlightProfile?.id === profile.id;
                      return (
                        <button
                          aria-checked={selectedProfile}
                          className="terminal-menu-item"
                          key={profile.id}
                          onClick={() => {
                            setActionsMenuOpen(false);
                            void commitSyntaxHighlightProfile(profile.id);
                            focusTerminalRenderer();
                          }}
                          role="menuitemradio"
                          type="button"
                        >
                          {profile.name}
                          {selectedProfile ? <Check size={13} className="terminal-color-scheme-check" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
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
                <div className="terminal-menu-submenu">
                  <button className="terminal-menu-item" role="menuitem" type="button">
                    <FileText size={13} />
                    {t("terminal.textEncoding")}
                    <ChevronRight size={13} className="terminal-menu-chevron" />
                  </button>
                  <div className="terminal-menu terminal-menu-submenu-panel" role="menu">
                    {TERMINAL_ENCODING_OPTIONS.map((option) => {
                      const selected = normalizeTerminalEncoding(pane.textEncoding) === option.value;
                      return (
                        <button
                          aria-checked={selected}
                          className="terminal-menu-item"
                          key={option.value}
                          onClick={() => void handleTextEncodingChange(option.value)}
                          role="menuitemradio"
                          type="button"
                        >
                          {option.label}
                          {selected ? <Check size={13} className="terminal-color-scheme-check" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>,
              document.body,
            ) : null}
          </div>
          {canClosePane ? (
            <button
              className="terminal-pane-action terminal-pane-close"
              aria-label={pane.tmuxSessionId ? t("terminal.detachTmux") : t("terminal.closePane")}
              onClick={() => onClosePane ? onClosePane() : closePane(tabId, pane.id)}
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
      {quickSelect ? (
        <div
          aria-label={t("terminal.quickSelect")}
          className="terminal-quick-select-overlay"
          onKeyDown={handleQuickSelectKeyDown}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              closeQuickSelect();
            }
          }}
          ref={quickSelectOverlayRef}
          role="dialog"
          tabIndex={-1}
        >
          {quickSelect.matches
            .filter((match) => match.label.startsWith(quickSelect.input))
            .map((match) => (
              <button
                aria-label={match.text}
                className="terminal-quick-select-hint"
                key={match.label}
                onClick={(event) => handleQuickSelectClick(event, match)}
                style={{
                  left: quickSelect.offsetLeft + match.column * quickSelect.cellWidth,
                  top: quickSelect.offsetTop + match.row * quickSelect.cellHeight,
                }}
              >
                <strong>{match.label.slice(quickSelect.input.length)}</strong>
                <span className="terminal-quick-select-hint-text">{match.text}</span>
              </button>
            ))}
          <div className="terminal-quick-select-help">{t("terminal.quickSelectHint")}</div>
        </div>
      ) : null}
      {multilinePasteConfirmationOpen ? (
        <ConfirmDialog
          autoFocusConfirm
          confirmIcon="copy"
          confirmLabel={t("common.paste")}
          icon="copy"
          message={t("terminal.pasteMultilineConfirm")}
          onCancel={() => resolveMultilinePasteConfirmation(false)}
          onConfirm={() => resolveMultilinePasteConfirmation(true)}
          title={t("settings.confirmMultilinePaste")}
        />
      ) : null}
    </article>
  );
}

function isMultilinePaste(data: string) {
  return data.split(/\r\n|\r|\n/).filter((line) => line.length > 0).length > 1;
}

function truncateForNotice(text: string) {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
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

async function resolveSftpDialogInitialRemotePath(connection: Connection, pane: WorkspacePane | undefined) {
  if (!pane || !isTerminalPane(pane) || connection.type !== "ssh") {
    return undefined;
  }

  if (pane.tmuxSessionId && isTauriRuntime()) {
    try {
      const tmuxPath = await invokeCommand("tmux_current_path", {
        request: {
          ...tmuxConnectionRequest(connection),
          tmuxSessionId: pane.tmuxSessionId,
        },
      });
      if (isRemoteInitialDirectory(tmuxPath)) {
        return tmuxPath.trim();
      }
    } catch (error) {
      console.debug("Falling back to terminal cwd after tmux current-path probe failed.", error);
    }
  }

  return isRemoteInitialDirectory(pane.cwd) ? pane.cwd.trim() : undefined;
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

function localStartupFor(connection: Connection, shell: string | undefined) {
  if (connection.type !== "local") {
    return { environmentVariables: [], startupInput: "" };
  }
  const script = connection.localStartupScript?.trim();
  if (!script) {
    return { environmentVariables: [], startupInput: "" };
  }
  const family = classifyEnvironmentShell(shell ?? "");
  const prepared = family
    ? prepareLocalStartup(script, family)
    : { environmentVariables: [], startupScript: script };
  return {
    environmentVariables: prepared.environmentVariables,
    startupInput: prepared.startupScript
      ? `${prepared.startupScript.replace(/\r?\n/g, "\r")}\r`
      : "",
  };
}

function sshStartupInputFor(connection: Connection) {
  if (connection.type !== "ssh") {
    return "";
  }
  const script = connection.localStartupScript?.trim();
  if (!script) {
    return "";
  }
  // The script is typed into the remote PTY after the session lands, so each line
  // becomes a carriage return (Enter) just like the local startup script path.
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

function shouldDeferPaneFocusUntilClick(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  return Boolean(
    element?.closest(
      'button, input, textarea, select, a[href], summary, [role="button"], [role^="menuitem"]',
    ),
  );
}

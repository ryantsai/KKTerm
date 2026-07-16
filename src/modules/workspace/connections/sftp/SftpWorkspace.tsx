import { confirmTrustedSshHostKey, connectionToolbarTitle, resolveSshOldProtocols, resolveSshSocksProxyRequest, uniqueRuntimeId, usesNativeSshHostKeyVerification } from "../utils";

import { AlertTriangle, ChevronsUpDown, X } from "../../../../lib/reicon";
import { Actions, Btn, DIcon, DialogShell, Field, Sheet, TextInput } from "../../../../app/ui/dialog";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { resolveAppliedColorScheme } from "../../../../app/appShellEffects";
import { invokeCommand, isTauriRuntime, openFilesystemPath, type LocalDirectoryEntry, type LocalFileClipboardOperation, type LocalPlacesListing, type SftpDirectoryEntry, type SftpPathProperties, type SftpSessionStarted, type SftpTransferProgress } from "../../../../lib/tauri";
import { readDurableUiState, writeDurableUiState } from "../../../../lib/durableUiState";
import {
  fileBrowserCommandsFor,
  type FileBrowserCommands,
} from "../../../../lib/fileBrowserCommands";
import {
  registerFileBrowserController,
  unregisterFileBrowserController,
  type FileBrowserController,
} from "../../paneRegistry";
import { useWorkspaceStore } from "../../../../store";
import { useGitRepoDetection } from "../../../git/useGitRepoDetection";
import type { Connection, FileBrowserViewOptions, FileEntry, FtpConnectionOptions, SftpSettings, WorkspaceTab } from "../../../../types";
import type { DashboardBackground } from "../../../dashboard/types";
import { FILE_PANE_ZOOM_DEFAULT, FilePane } from "./SftpFilePane";
import { fileBrowserConnectionIconSrc } from "../fileBrowserConnectionIcons";
import type { CompareEndpoint } from "../../../compare/compareTypes";
import {
  fileExplorerTerminalOptionsForPlatform,
  resolveFileExplorerTerminalOption,
} from "./fileExplorerTerminalOptions";
import {
  ConfirmRemoteDeleteDialog,
  NewRemoteFolderDialog,
  SftpContextMenu,
  SftpPropertiesPopup,
  TransferConflictDialog,
} from "./SftpOverlays";
import { formatFileSize, formatMode, formatRemoteTime, formatTransferResult, joinLocalPath, joinRemotePath } from "./format";
import type {
  DeleteRequest,
  FilePaneSide,
  FilePropertiesState,
  LocalFavorite,
  SftpContextMenuState,
  TransferConflictDecision,
  TransferConflictState,
  TransferDirection,
  TransferRecord,
} from "./types";

const TRANSFER_HISTORY_STATES: TransferRecord["state"][] = ["canceled", "done", "failed"];
const WINDOWS_DRIVES_PATH = "__KKTERM_WINDOWS_DRIVES__";
const FILE_BROWSER_RECENT_PATHS_STORAGE_KEY = "kkterm.fileBrowserRecentPaths.v1";
const FILE_BROWSER_FAVORITES_STORAGE_KEY = "kkterm.fileBrowserFavorites.v1";
const FILE_BROWSER_SIDEBAR_STORAGE_KEY = "kkterm.fileBrowserSidebarCollapsed.v1";
const SSH_FILE_BROWSER_PROTOCOL_STORAGE_KEY = "kkterm.sshFileBrowserProtocol.v1";
const SSH_FILE_BROWSER_LOCAL_PATH_STORAGE_KEY = "kkterm.sshFileBrowserLocalPath.v1";
const RECENT_PATH_LIMIT = 5;

type SshFileBrowserProtocol = "sftp" | "ftpsExplicit" | "ftpsImplicit" | "ftp";

type StoredSshFileBrowserProtocol = {
  protocol: SshFileBrowserProtocol;
  port?: number;
};

const DEFAULT_SSH_FILE_BROWSER_PROTOCOL: SshFileBrowserProtocol = "sftp";

type SshFileBrowserSelection = {
  protocol: SshFileBrowserProtocol;
  port: number;
};

type FtpNoticeDialogState = {
  title: string;
  message: string;
};

// Per-pane zoom + content-view background. Persisted durably on the Connection
// (DB) so the look survives restarts and follows the Connection, except for the
// ephemeral terminal-spawned SFTP browser (`inline`), which keeps these settings
// in memory only so they are forgotten when the popup closes.
type PaneViewOptions = {
  zoom: number;
  background: DashboardBackground | null;
};

type PaneViewOptionsState = {
  local: PaneViewOptions;
  remote: PaneViewOptions;
};

const DEFAULT_PANE_VIEW_OPTIONS: PaneViewOptions = {
  zoom: FILE_PANE_ZOOM_DEFAULT,
  background: null,
};

function paneViewOptionsFromConnection(
  side: FilePaneSide,
  connection: WorkspaceTab["connection"],
): PaneViewOptions {
  const stored = connection?.fileBrowserViewOptions?.[side];
  return {
    zoom:
      typeof stored?.zoom === "number" && Number.isFinite(stored.zoom)
        ? stored.zoom
        : FILE_PANE_ZOOM_DEFAULT,
    background: stored?.background ?? null,
  };
}

function initialViewOptionsState(
  connection: WorkspaceTab["connection"],
  ephemeral: boolean,
): PaneViewOptionsState {
  if (ephemeral) {
    return { local: { ...DEFAULT_PANE_VIEW_OPTIONS }, remote: { ...DEFAULT_PANE_VIEW_OPTIONS } };
  }
  return {
    local: paneViewOptionsFromConnection("local", connection),
    remote: paneViewOptionsFromConnection("remote", connection),
  };
}

type FileClipboard = {
  operation: LocalFileClipboardOperation;
  side: FilePaneSide;
  paths: string[];
  names: string[];
};

export function SftpWorkspace({
  isActive,
  tab,
  commands: commandsProp,
  inline = false,
  onClose,
  protocolSourceConnection,
  initialRemotePath,
}: {
  isActive: boolean;
  tab: WorkspaceTab;
  commands?: FileBrowserCommands;
  // The terminal's inline SFTP dialog. No longer alters layout, but marks the
  // browser as ephemeral so per-pane view options are not persisted.
  inline?: boolean;
  onClose?: () => void;
  protocolSourceConnection?: Connection;
  // Preferred remote start directory (e.g. the SSH session's current working
  // directory when the browser opens from a terminal pane).
  initialRemotePath?: string;
}) {
  const { t } = useTranslation();
  const appearanceSettings = useWorkspaceStore((state) => state.appearanceSettings);
  const sftpSettings = useWorkspaceStore((state) => state.sftpSettings);
  const terminalSettings = useWorkspaceStore((state) => state.terminalSettings);
  const fileExplorerOpenMode = sftpSettings.fileExplorerOpenMode;
  const openFileViewerPath = useWorkspaceStore((state) => state.openFileViewerPath);
  const openLocalTerminalHere = useWorkspaceStore((state) => state.openLocalTerminalHere);
  const openElevatedLocalTerminal = useWorkspaceStore((state) => state.openElevatedLocalTerminal);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const openGitBrowser = useWorkspaceStore((state) => state.openGitBrowser);
  const compareLeft = useWorkspaceStore((state) => state.compareLeft);
  const setCompareLeft = useWorkspaceStore((state) => state.setCompareLeft);
  const openCompareView = useWorkspaceStore((state) => state.openCompareView);
  const openFolderCompareView = useWorkspaceStore((state) => state.openFolderCompareView);
  const sourceConnection = protocolSourceConnection;
  const initialSshFileBrowserSelection = sourceConnection
    ? readStoredSshFileBrowserProtocol(sourceConnection.id, sourceConnection)
    : {
        protocol: protocolFromTab(tab),
        port: defaultPortForSshFileBrowserProtocol(protocolFromTab(tab), tab.connection),
      };
  const [sshFileBrowserProtocol, setSshFileBrowserProtocol] = useState<SshFileBrowserProtocol>(() =>
    initialSshFileBrowserSelection.protocol,
  );
  const [sshFileBrowserPort, setSshFileBrowserPort] = useState(() => initialSshFileBrowserSelection.port);
  const [sshFileBrowserPortDraft, setSshFileBrowserPortDraft] = useState(() =>
    String(initialSshFileBrowserSelection.port),
  );
  const [protocolMenuOpen, setProtocolMenuOpen] = useState(false);
  const [plainFtpFallbackActive, setPlainFtpFallbackActive] = useState(false);
  const connection = useMemo(
    () =>
      sourceConnection
        ? connectionForSshFileBrowserProtocol(sourceConnection, sshFileBrowserProtocol, sshFileBrowserPort)
        : tab.connection,
    [sourceConnection, sshFileBrowserPort, sshFileBrowserProtocol, tab.connection],
  );
  const effectiveBrowserKind = sourceConnection
    ? sshFileBrowserProtocol === "sftp"
      ? "sftp"
      : "ftp"
    : tab.kind;
  const isLocalFilesBrowser = effectiveBrowserKind === "localFiles";
  const commands = useMemo<FileBrowserCommands | null>(
    () => (commandsProp ?? (connection ? fileBrowserCommandsFor(connection) : null)),
    [commandsProp, connection],
  );
  const activeProtocolLabel = connection
    ? fileBrowserProtocolLabel(connection, sourceConnection ? sshFileBrowserProtocol : undefined, t)
    : t("sftp.protocolSftp");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [localPath, setLocalPath] = useState("");
  // Show the Git icon when the File Explorer's current directory is in a repo.
  const gitRepo = useGitRepoDetection(localPath, isLocalFilesBrowser);
  const [localFiles, setLocalFiles] = useState<FileEntry[]>([]);
  const [remotePath, setRemotePath] = useState(".");
  const [remoteFiles, setRemoteFiles] = useState<FileEntry[]>([]);
  const [recentLocalPaths, setRecentLocalPaths] = useState<string[]>(() => readRecentPaths("local"));
  const [recentRemotePaths, setRecentRemotePaths] = useState<string[]>(() =>
    readRecentPaths("remote", connection?.id),
  );
  const sidebarConnectionKey = connection?.id ?? tab.id;
  const [localPlaces, setLocalPlaces] = useState<LocalPlacesListing | null>(null);
  const [favorites, setFavorites] = useState<LocalFavorite[]>(() => readFavorites());
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    readSidebarCollapsed(sidebarConnectionKey, isLocalFilesBrowser),
  );
  const [viewOptions, setViewOptions] = useState<PaneViewOptionsState>(() =>
    initialViewOptionsState(connection, inline),
  );
  const viewOptionsRef = useRef(viewOptions);
  const [status, setStatus] = useState(t("sftp.connecting"));
  const [remoteError, setRemoteError] = useState("");
  const [localStatus, setLocalStatus] = useState("");
  const [isLocalLoading, setIsLocalLoading] = useState(false);
  const [isRemoteLoading, setIsRemoteLoading] = useState(false);
  const [selectedLocalNames, setSelectedLocalNames] = useState<string[]>([]);
  const [selectedRemoteNames, setSelectedRemoteNames] = useState<string[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null);
  const [contextMenu, setContextMenu] = useState<SftpContextMenuState | null>(null);
  const [propertiesState, setPropertiesState] = useState<FilePropertiesState | null>(null);
  const [transferConflict, setTransferConflict] = useState<TransferConflictState | null>(null);
  const [newRemoteFolderOpen, setNewRemoteFolderOpen] = useState(false);
  const [passwordPrompt, setPasswordPrompt] = useState<{ message?: string } | null>(null);
  const [ftpNoticeDialog, setFtpNoticeDialog] = useState<FtpNoticeDialogState | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [renameRequest, setRenameRequest] = useState<{
    side: FilePaneSide;
    name: string;
    requestId: number;
  } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const transientPasswordRef = useRef<string | null>(null);
  const passwordPromptPromiseRef = useRef<Promise<string | null> | null>(null);
  const passwordPromptResolverRef = useRef<((password: string | null) => void) | null>(null);
  const protocolMenuRef = useRef<HTMLSpanElement | null>(null);
  const activeTransferIdRef = useRef<string | null>(null);
  const transferConflictResolverRef = useRef<
    ((decision: TransferConflictDecision) => void) | null
  >(null);
  const overwriteAllConflictsRef = useRef<Record<TransferDirection, boolean>>({
    upload: false,
    download: false,
  });
  const markConnectionSessionStarted = useWorkspaceStore(
    (state) => state.markConnectionSessionStarted,
  );
  const markConnectionSessionEnded = useWorkspaceStore(
    (state) => state.markConnectionSessionEnded,
  );
  const updateOpenConnectionFileBrowserViewOptions = useWorkspaceStore(
    (state) => state.updateOpenConnectionFileBrowserViewOptions,
  );

  useEffect(() => {
    if (!sourceConnection) {
      return;
    }
    const selection = readStoredSshFileBrowserProtocol(sourceConnection.id, sourceConnection);
    setSshFileBrowserProtocol(selection.protocol);
    setSshFileBrowserPort(selection.port);
    setSshFileBrowserPortDraft(String(selection.port));
    setPlainFtpFallbackActive(false);
    setFtpNoticeDialog(null);
    transientPasswordRef.current = null;
    // Re-run only when the connection identity changes; reading the latest object inline is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceConnection?.id]);

  function handleProtocolChange(protocol: SshFileBrowserProtocol) {
    const nextPort = protocol === sshFileBrowserProtocol
      ? sshFileBrowserPort
      : defaultPortForSshFileBrowserProtocol(protocol, sourceConnection ?? connection);
    setSshFileBrowserProtocol(protocol);
    setSshFileBrowserPort(nextPort);
    setSshFileBrowserPortDraft(String(nextPort));
    setProtocolMenuOpen(false);
    setPlainFtpFallbackActive(false);
    transientPasswordRef.current = null;
  }

  function commitProtocolPortDraft() {
    const nextPort = normalizeSshFileBrowserPort(sshFileBrowserPortDraft);
    if (!nextPort) {
      setSshFileBrowserPortDraft(String(sshFileBrowserPort));
      return;
    }
    setSshFileBrowserPortDraft(String(nextPort));
    if (nextPort !== sshFileBrowserPort) {
      setSshFileBrowserPort(nextPort);
      transientPasswordRef.current = null;
    }
  }

  function completePasswordPrompt(password: string | null) {
    const resolve = passwordPromptResolverRef.current;
    passwordPromptPromiseRef.current = null;
    passwordPromptResolverRef.current = null;
    setPasswordPrompt(null);
    resolve?.(password);
  }

  async function requestTransientPassword(message?: string) {
    if (passwordPromptPromiseRef.current) {
      return passwordPromptPromiseRef.current;
    }
    setPasswordPrompt({ message });
    passwordPromptPromiseRef.current = new Promise<string | null>((resolve) => {
      passwordPromptResolverRef.current = resolve;
    });
    return passwordPromptPromiseRef.current;
  }

  useEffect(() => {
    if (!protocolMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!protocolMenuRef.current?.contains(event.target as Node)) {
        setProtocolMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProtocolMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [protocolMenuOpen]);

  useEffect(() => {
    if (isLocalFilesBrowser) {
      void loadLocalDirectory(connection?.localStartupDirectory);
      return;
    }
    // Terminal-spawned browser: reopen the last local folder used for this SSH
    // Connection. Standalone FTP/SFTP Connection: start at the configured local
    // path. Either way fall back to the home directory when the preferred
    // folder is missing or fails to list.
    const preferredLocalDirectory = sourceConnection
      ? readStoredSshFileBrowserLocalPath(sourceConnection.id)
      : tab.connection?.ftpOptions?.localPath?.trim() || undefined;
    void (async () => {
      if (preferredLocalDirectory && (await loadLocalDirectory(preferredLocalDirectory))) {
        return;
      }
      await loadLocalDirectory(undefined);
    })();
    // Reload when the startup directory or browser mode changes; loadLocalDirectory is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.localStartupDirectory, isLocalFilesBrowser]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let dispose: (() => void) | undefined;
    let disposed = false;
    const progressEvent = commands?.transferProgressEvent ?? "sftp-transfer-progress";
    void listen<SftpTransferProgress>(progressEvent, (event) => {
      const progress = event.payload;
      setTransfers((current) =>
        current.map((transfer) =>
          transfer.id === progress.transferId
            ? {
                ...transfer,
                progress: progress.progress,
                detail:
                  progress.totalBytes > 0
                    ? `${formatFileSize(progress.transferredBytes)} / ${formatFileSize(
                        progress.totalBytes,
                      )}`
                    : `${formatFileSize(progress.transferredBytes)} transferred`,
              }
            : transfer,
        ),
      );
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
  }, [commands]);

  useEffect(() => {
    setRecentRemotePaths(readRecentPaths("remote", connection?.id));
  }, [connection?.id]);

  // Load Finder/Explorer sidebar places (home, common folders, drives) once.
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let disposed = false;
    void invokeCommand("list_local_places")
      .then((result) => {
        if (!disposed) {
          setLocalPlaces(result);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  // The File Explorer has no network session, but it should still register as a
  // live connection (green dot in the rail / connection tree) the moment it
  // opens, and release it when the tab closes.
  useEffect(() => {
    const connectionId = connection?.id;
    if (!isLocalFilesBrowser || !connectionId) {
      return;
    }
    markConnectionSessionStarted(connectionId);
    return () => markConnectionSessionEnded(connectionId);
  }, [connection?.id, isLocalFilesBrowser, markConnectionSessionEnded, markConnectionSessionStarted]);

  useEffect(() => {
    setSidebarCollapsed(readSidebarCollapsed(sidebarConnectionKey, isLocalFilesBrowser));
  }, [sidebarConnectionKey, isLocalFilesBrowser]);

  // Re-seed the in-memory view options from the durable Connection only when the
  // browser switches identity (not on our own round-tripped updates, which keep
  // the same connection id).
  useEffect(() => {
    const next = initialViewOptionsState(connection, inline);
    viewOptionsRef.current = next;
    setViewOptions(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.id, inline]);

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      writeSidebarCollapsed(sidebarConnectionKey, next);
      return next;
    });
  };

  const persistViewOptions = (next: PaneViewOptionsState) => {
    const connectionId = connection?.id;
    // Ephemeral popup and transient (non-DB) connections stay in memory only.
    if (inline || !connectionId || isTransientFileBrowserConnectionId(connectionId)) {
      return;
    }
    const payload: FileBrowserViewOptions = {
      local: { zoom: next.local.zoom, background: next.local.background },
      remote: { zoom: next.remote.zoom, background: next.remote.background },
    };
    updateOpenConnectionFileBrowserViewOptions(connectionId, payload);
    if (!isTauriRuntime()) {
      return;
    }
    void invokeCommand("update_connection_file_browser_view_options", {
      connectionId,
      viewOptions: payload,
    })
      .then((updated) => {
        if (updated) {
          updateOpenConnectionFileBrowserViewOptions(
            connectionId,
            updated.fileBrowserViewOptions ?? payload,
          );
        }
      })
      .catch((error) => {
        console.warn("file browser view options update failed.", error);
      });
  };

  const updateViewOptions = (side: FilePaneSide, patch: Partial<PaneViewOptions>) => {
    const prev = viewOptionsRef.current;
    const next: PaneViewOptionsState = { ...prev, [side]: { ...prev[side], ...patch } };
    viewOptionsRef.current = next;
    setViewOptions(next);
    persistViewOptions(next);
  };

  const addFavorite = (place: { label: string; path: string; icon: string; kind?: "file" | "folder" }) => {
    setFavorites((current) => {
      if (current.some((favorite) => favorite.path === place.path)) {
        return current;
      }
      const next = [...current, { ...place, id: uniqueRuntimeId("fav") }];
      writeFavorites(next);
      return next;
    });
  };

  const removeFavorite = (id: string) => {
    setFavorites((current) => {
      const next = current.filter((favorite) => favorite.id !== id);
      writeFavorites(next);
      return next;
    });
  };

  const reorderFavorites = (next: LocalFavorite[]) => {
    setFavorites(next);
    writeFavorites(next);
  };

  const rememberLocalPath = (path: string) => {
    const nextPaths = writeRecentPaths("local", path);
    setRecentLocalPaths(nextPaths);
  };

  const rememberRemotePath = (path: string) => {
    const nextPaths = writeRecentPaths("remote", path, connection?.id);
    setRecentRemotePaths(nextPaths);
  };

  const loadLocalDirectory = async (path?: string) => {
    if (!isTauriRuntime()) {
      setLocalStatus(t("sftp.tauriUnavailable"));
      setLocalFiles([]);
      return false;
    }

    setIsLocalLoading(true);
    setLocalStatus(path ? t("sftp.openingFolder") : t("sftp.loadingLocal"));
    try {
      const result = await invokeCommand("list_local_directory", {
        request: { path },
      });
      setLocalPath(result.path);
      setLocalFiles(result.entries.map(localEntryToFileEntry));
      rememberLocalPath(result.path);
      if (sourceConnection && result.path !== WINDOWS_DRIVES_PATH) {
        writeStoredSshFileBrowserLocalPath(sourceConnection.id, result.path);
      }
      setSelectedLocalNames([]);
      setLocalStatus("");
      return true;
    } catch (error) {
      setLocalStatus(String(error));
      setLocalFiles([]);
      return false;
    } finally {
      setIsLocalLoading(false);
    }
  };

  useEffect(() => {
    if (isLocalFilesBrowser) {
      sessionIdRef.current = null;
      setIsRemoteLoading(false);
      setRemoteError("");
      setRemoteFiles([]);
      setSelectedRemoteNames([]);
      setStatus("");
      return;
    }

    if (!connection) {
      setStatus(t("sftp.noSshConnection"));
      return;
    }

    if (!isTauriRuntime()) {
      setStatus(t("sftp.tauriUnavailable"));
      return;
    }

    let disposed = false;
    let sessionStarted = false;
    const requestedSessionId = uniqueRuntimeId(`${connection.id}-${effectiveBrowserKind}`);
    const sessionTrackingConnectionId = sourceConnection?.id ?? connection.id;
    sessionIdRef.current = requestedSessionId;
    setIsRemoteLoading(true);
    setRemoteError("");
    setStatus(t("sftp.verifyingHost"));

    (async () => {
      try {
        if (!commands) {
          throw new Error("file-browser commands adapter not initialized");
        }
        if (commands.capabilities.verifySshHostKey && usesNativeSshHostKeyVerification(connection)) {
          const preview = await invokeCommand("inspect_ssh_host_key", {
            request: {
              host: connection.host,
              port: connection.port,
              ...resolveSshSocksProxyRequest(connection),
              sshOldProtocols: resolveSshOldProtocols(connection, useWorkspaceStore.getState().sshSettings),
            },
          });
          await confirmTrustedSshHostKey(preview, useWorkspaceStore.getState().sshSettings);
        }

        setStatus(t("sftp.openingProtocol", { protocol: activeProtocolLabel }));
        let password = transientPasswordRef.current ?? undefined;
        if (!password && shouldPromptBeforeFileBrowserConnect(connection, sourceConnection, sshFileBrowserProtocol)) {
          const enteredPassword = await requestTransientPassword();
          if (disposed) {
            return;
          }
          if (!enteredPassword) {
            throw new Error(t("sftp.passwordPromptCanceled"));
          }
          password = enteredPassword;
          transientPasswordRef.current = password;
        }
        // Prefer the terminal session's current directory (popup browser) or
        // the Connection's configured remote path (standalone browser); fall
        // back to the remote home directory when that folder cannot be opened.
        const preferredRemoteDirectory =
          (sourceConnection ? initialRemotePath : connection.ftpOptions?.remotePath)?.trim() || ".";
        const startSessionAt = async (sessionPassword?: string) => {
          try {
            return await commands.startSession({
              sessionId: requestedSessionId,
              path: preferredRemoteDirectory,
              password: sessionPassword,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (preferredRemoteDirectory === "." || isMissingFileBrowserPasswordError(message)) {
              throw error;
            }
            return await commands.startSession({
              sessionId: requestedSessionId,
              path: ".",
              password: sessionPassword,
            });
          }
        };
        let result: SftpSessionStarted;
        try {
          result = await startSessionAt(password);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!password && isMissingFileBrowserPasswordError(message)) {
            const enteredPassword = await requestTransientPassword(message);
            if (disposed) {
              return;
            }
            if (!enteredPassword) {
              throw Object.assign(new Error(t("sftp.passwordPromptCanceled")), { cause: error });
            }
            transientPasswordRef.current = enteredPassword;
            result = await startSessionAt(enteredPassword);
          } else if (sourceConnection && isFtpsProtocol(sshFileBrowserProtocol)) {
            setPlainFtpFallbackActive(true);
            setStatus(t("sftp.ftpsFallbackStatus"));
            showStatusBarNotice(t("sftp.ftpsFallbackStatus"), { tone: "warning" });
            setSshFileBrowserProtocol("ftp");
            setSshFileBrowserPort(defaultPortForSshFileBrowserProtocol("ftp", sourceConnection));
            setSshFileBrowserPortDraft(String(defaultPortForSshFileBrowserProtocol("ftp", sourceConnection)));
            return;
          } else {
            throw error;
          }
        }

        if (disposed) {
          void commands.closeSession(result.sessionId);
          return;
        }

        sessionIdRef.current = result.sessionId;
        sessionStarted = true;
        markConnectionSessionStarted(sessionTrackingConnectionId);
        setRemotePath(result.path);
        setRemoteFiles(result.entries.map(remoteEntryToFileEntry));
        rememberRemotePath(result.path);
        setSelectedRemoteNames([]);
        setStatus(t("sftp.connected"));
        if (sourceConnection) {
          writeStoredSshFileBrowserProtocol(sourceConnection.id, {
            protocol: sshFileBrowserProtocol,
            port: sshFileBrowserPort,
          });
        }
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : String(error);
          setStatus(message);
          setRemoteError(message);
          setRemoteFiles([]);
          if (effectiveBrowserKind === "ftp" && message !== t("sftp.passwordPromptCanceled")) {
            setFtpNoticeDialog({
              title: t("sftp.ftpConnectionErrorTitle"),
              message,
            });
          }
        }
      } finally {
        if (!disposed) {
          setIsRemoteLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      const sessionId =
        sessionIdRef.current === requestedSessionId ? sessionIdRef.current : requestedSessionId;
      if (sessionId && commands) {
        void commands.closeSession(sessionId);
      }
      if (sessionStarted) {
        markConnectionSessionEnded(sessionTrackingConnectionId);
      }
      if (sessionIdRef.current === requestedSessionId) {
        sessionIdRef.current = null;
      }
    };
    // rememberRemotePath is an inline closure over stable refs; including it would restart the session every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProtocolLabel, commands, connection, effectiveBrowserKind, isLocalFilesBrowser, markConnectionSessionEnded, markConnectionSessionStarted, showStatusBarNotice, sourceConnection, sshFileBrowserPort, sshFileBrowserProtocol, t]);

  const refreshRemoteDirectory = async () => {
    await loadRemoteDirectory(remotePath, t("sftp.refreshing"));
  };

  const loadRemoteDirectory = async (path: string, loadingStatus = t("sftp.openingFolder")) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !isTauriRuntime() || !commands) {
      return;
    }

    setIsRemoteLoading(true);
    setStatus(loadingStatus);
    try {
      const result = await commands.listDirectory({ sessionId, path });
      setRemotePath(result.path);
      setRemoteFiles(result.entries.map(remoteEntryToFileEntry));
      rememberRemotePath(result.path);
      setSelectedRemoteNames([]);
      setStatus(t("sftp.connected"));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setIsRemoteLoading(false);
    }
  };

  const openRemoteFolder = async (folderName: string) => {
    await loadRemoteDirectory(joinRemotePath(remotePath, folderName));
  };

  const openRemoteParent = async () => {
    await loadRemoteDirectory(joinRemotePath(remotePath, ".."));
  };

  const isLocalDrivePicker = localPath === WINDOWS_DRIVES_PATH;

  // Free space of the drive that holds the current local folder, for the status
  // bar. Picks the longest matching mount point (e.g. C:\ for C:\Users\...).
  const localAvailableBytes = useMemo(() => {
    if (!localPlaces || !localPath || isLocalDrivePicker) {
      return undefined;
    }
    const normalizedPath = localPath.toLowerCase();
    const drive = localPlaces.drives
      .filter((entry) => normalizedPath.startsWith(entry.path.toLowerCase()))
      .sort((left, right) => right.path.length - left.path.length)[0];
    return drive?.freeBytes;
  }, [isLocalDrivePicker, localPath, localPlaces]);

  const refreshLocalDirectory = async () => {
    await loadLocalDirectory(localPath || undefined);
  };

  const handleOpenLocalTerminalHere = async () => {
    if (!localPath || isLocalDrivePicker) {
      return;
    }
    const option = resolveFileExplorerTerminalOption(
      {
        shell: sftpSettings.fileExplorerTerminalShell,
        elevated: sftpSettings.fileExplorerTerminalElevated,
      },
      fileExplorerTerminalOptionsForPlatform(terminalSettings.customShells),
    );
    try {
      if (option.elevated) {
        await openElevatedLocalTerminal(
          { canElevate: true, label: option.label, value: option.shell },
          { cwd: localPath },
        );
        return;
      }
      openLocalTerminalHere(localPath, { name: option.label, shell: option.shell });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
    }
  };

  const openLocalFolder = async (folderName: string) => {
    await loadLocalDirectory(
      isLocalDrivePicker ? folderName : joinLocalPath(localPath, folderName),
    );
  };

  const openLocalParent = async () => {
    await loadLocalDirectory(
      isLocalDrivePicker || isWindowsDriveRoot(localPath)
        ? WINDOWS_DRIVES_PATH
        : joinLocalPath(localPath, ".."),
    );
  };

  const setTransferState = (id: string, patch: Partial<TransferRecord>) => {
    setTransfers((current) =>
      current.map((transfer) => (transfer.id === id ? { ...transfer, ...patch } : transfer)),
    );
  };

  const resolveTransferConflict = (decision: TransferConflictDecision) => {
    transferConflictResolverRef.current?.(decision);
    transferConflictResolverRef.current = null;
    setTransferConflict(null);
  };

  const promptTransferConflict = (conflict: TransferConflictState) =>
    new Promise<TransferConflictDecision>((resolve) => {
      transferConflictResolverRef.current = resolve;
      setTransferConflict(conflict);
    });

  const conflictTargetPath = (direction: TransferDirection, fileName: string) =>
    direction === "upload" ? joinRemotePath(remotePath, fileName) : joinLocalPath(localPath, fileName);

  const destinationHasVisibleConflict = (direction: TransferDirection, fileName: string) => {
    const targetFiles = direction === "upload" ? remoteFiles : localFiles;
    return targetFiles.some((file) =>
      direction === "download"
        ? file.name.localeCompare(fileName, undefined, { sensitivity: "accent" }) === 0
        : file.name === fileName,
    );
  };

  const isExistingDestinationError = (message: string) =>
    /already exists/i.test(message) || /destination .*exists/i.test(message);

  const conflictPathFromError = (message: string, fallbackPath: string) => {
    const match = message.match(/already exists:\s*(.+)$/i);
    return match?.[1]?.trim() || fallbackPath;
  };

  const runQueuedTransfer = async (transfer: TransferRecord) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !isTauriRuntime()) {
      setTransferState(transfer.id, {
        state: "failed",
        progress: 100,
        detail: t("sftp.sessionUnavailable"),
      });
      activeTransferIdRef.current = null;
      return;
    }

    setTransferState(transfer.id, {
      state: "active",
      detail: t("sftp.preparing"),
    });

    try {
      if (!commands) throw new Error("commands adapter not initialized");
      const result =
        transfer.direction === "upload"
          ? await commands.uploadPath({
              sessionId,
              transferId: transfer.id,
              localPath: transfer.localPath ?? "",
              remoteDirectory: transfer.remoteDirectory ?? remotePath,
              overwriteBehavior: transfer.overwriteBehavior,
            })
          : await commands.downloadPath({
              sessionId,
              transferId: transfer.id,
              remotePath: transfer.remotePath ?? "",
              localDirectory: transfer.localDirectory ?? localPath,
              overwriteBehavior: transfer.overwriteBehavior,
            });

      if (transfer.deleteSourceWhenDone) {
        if (transfer.deleteSourceWhenDone.side === "local") {
          await invokeCommand("delete_local_path", {
            request: { path: transfer.deleteSourceWhenDone.path },
          });
        } else {
          await commands.deletePath({
            sessionId,
            path: transfer.deleteSourceWhenDone.path,
          });
        }
      }

      setTransferState(transfer.id, {
        state: "done",
        progress: 100,
        detail: formatTransferResult(result),
      });

      if (transfer.direction === "upload") {
        await refreshRemoteDirectory();
        if (transfer.deleteSourceWhenDone?.side === "local") {
          await refreshLocalDirectory();
        }
      } else {
        await refreshLocalDirectory();
        if (transfer.deleteSourceWhenDone?.side === "remote") {
          await refreshRemoteDirectory();
        }
        if (transfer.openWhenDone) {
          await openFilesystemPath(transfer.openWhenDone);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        transfer.overwriteBehavior !== "overwrite" &&
        isExistingDestinationError(message) &&
        overwriteAllConflictsRef.current[transfer.direction]
      ) {
        setTransferState(transfer.id, {
          state: "queued",
          progress: 0,
          detail: t("sftp.waitingToOverwrite"),
          overwriteBehavior: "overwrite",
        });
        return;
      }

      if (
        transfer.overwriteBehavior !== "overwrite" &&
        isExistingDestinationError(message) &&
        !overwriteAllConflictsRef.current[transfer.direction]
      ) {
        const decision = await promptTransferConflict({
          direction: transfer.direction,
          name: transfer.name,
          targetPath: conflictPathFromError(
            message,
            transfer.direction === "upload"
              ? joinRemotePath(transfer.remoteDirectory ?? remotePath, transfer.name)
              : joinLocalPath(transfer.localDirectory ?? localPath, transfer.name),
          ),
          isFolder: false,
          remainingConflicts: transfers.filter(
            (queuedTransfer) =>
              queuedTransfer.direction === transfer.direction && queuedTransfer.state === "queued",
          ).length,
        });

        if (decision === "overwrite" || decision === "overwriteAll") {
          if (decision === "overwriteAll") {
            overwriteAllConflictsRef.current[transfer.direction] = true;
            setTransfers((current) =>
              current.map((queuedTransfer) =>
                queuedTransfer.direction === transfer.direction && queuedTransfer.state === "queued"
                  ? { ...queuedTransfer, overwriteBehavior: "overwrite" }
                  : queuedTransfer,
              ),
            );
          }
          setTransferState(transfer.id, {
            state: "queued",
            progress: 0,
            detail: t("sftp.waitingToOverwrite"),
            overwriteBehavior: "overwrite",
          });
          return;
        }

        setTransferState(transfer.id, {
          state: decision === "skip" ? "canceled" : "failed",
          progress: 100,
          detail: decision === "skip" ? t("sftp.skippedExisting") : t("sftp.transferCanceled"),
        });
        return;
      }

      setTransferState(transfer.id, {
        state: message.includes("transfer canceled") ? "canceled" : "failed",
        progress: 100,
        detail: message.includes("transfer canceled") ? t("sftp.canceled") : message,
      });
    } finally {
      activeTransferIdRef.current = null;
      setTransfers((current) => [...current]);
    }
  };

  useEffect(() => {
    if (activeTransferIdRef.current) {
      return;
    }

    const nextTransfer = transfers.find((transfer) => transfer.state === "queued");
    if (!nextTransfer) {
      return;
    }

    activeTransferIdRef.current = nextTransfer.id;
    void runQueuedTransfer(nextTransfer);
    // Drain the queue when transfers change; runQueuedTransfer is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfers]);

  useEffect(() => {
    if (transfers.some((transfer) => transfer.state === "queued" || transfer.state === "active")) {
      return;
    }

    overwriteAllConflictsRef.current = {
      upload: false,
      download: false,
    };
  }, [transfers]);

  const enqueueTransfers = async (direction: TransferDirection, names: string[]) => {
    const sessionId = sessionIdRef.current;
    const selected =
      direction === "upload"
        ? localFiles.filter((file) => names.includes(file.name))
        : remoteFiles.filter((file) => names.includes(file.name));
    if (!sessionId || selected.length === 0 || !localPath || !isTauriRuntime()) {
      return;
    }
    if (direction === "upload" && isLocalDrivePicker) {
      return;
    }

    const visibleConflictCount = selected.filter((file) =>
      destinationHasVisibleConflict(direction, file.name),
    ).length;
    let batchOverwriteAll = overwriteAllConflictsRef.current[direction];
    let promptedConflictCount = 0;
    const nextTransfers: TransferRecord[] = [];

    for (const file of selected) {
      let overwriteBehavior: SftpSettings["overwriteBehavior"] = "fail";
      if (destinationHasVisibleConflict(direction, file.name)) {
        if (!batchOverwriteAll) {
          const decision = await promptTransferConflict({
            direction,
            name: file.name,
            targetPath: conflictTargetPath(direction, file.name),
            isFolder: file.kind === "folder",
            remainingConflicts: Math.max(visibleConflictCount - promptedConflictCount - 1, 0),
          });
          promptedConflictCount += 1;

          if (decision === "cancel") {
            break;
          }
          if (decision === "skip") {
            continue;
          }
          if (decision === "overwriteAll") {
            batchOverwriteAll = true;
            overwriteAllConflictsRef.current[direction] = true;
          }
        }

        overwriteBehavior = "overwrite";
      }

      nextTransfers.push({
        id: uniqueRuntimeId(direction),
        direction,
        name: file.name,
        state: "queued",
        progress: 0,
        detail: t("sftp.waiting"),
        overwriteBehavior,
        localPath: direction === "upload" ? joinLocalPath(localPath, file.name) : undefined,
        remoteDirectory: direction === "upload" ? remotePath : undefined,
        remotePath: direction === "download" ? joinRemotePath(remotePath, file.name) : undefined,
        localDirectory: direction === "download" ? localPath : undefined,
      });
    }

    if (nextTransfers.length > 0) {
      setTransfers((current) => [...current, ...nextTransfers]);
    }
  };

  const handleUpload = (names = selectedLocalNames) => {
    void enqueueTransfers("upload", names);
  };

  const handleDownload = (names = selectedRemoteNames) => {
    void enqueueTransfers("download", names);
  };

  const selectedPathsForMenu = (menu: SftpContextMenuState) => {
    const files = menu.side === "local" ? localFiles : remoteFiles;
    return menu.names
      .filter((name) => files.some((file) => file.name === name))
      .map((name) =>
        menu.side === "local"
          ? isLocalDrivePicker
            ? name
            : joinLocalPath(localPath, name)
          : joinRemotePath(remotePath, name),
      );
  };

  const writeFileClipboard = async (
    menu: SftpContextMenuState,
    operation: LocalFileClipboardOperation,
  ) => {
    const paths = selectedPathsForMenu(menu);
    if (paths.length === 0) {
      return;
    }

    setFileClipboard({
      operation,
      side: menu.side,
      paths,
      names: menu.names,
    });

    if (menu.side === "local" && isTauriRuntime()) {
      await invokeCommand("set_local_file_clipboard", {
        request: { operation, paths },
      }).catch(() => undefined);
    }
  };

  const readClipboardForPaste = async () => {
    if (!isTauriRuntime()) {
      return fileClipboard;
    }
    if (fileClipboard?.side === "remote") {
      return fileClipboard;
    }

    const nativeClipboard = await invokeCommand("read_local_file_clipboard").catch(() => null);
    if (nativeClipboard?.paths.length) {
      return {
        operation: nativeClipboard.operation,
        side: "local" as const,
        paths: nativeClipboard.paths,
        names: nativeClipboard.paths.map(localNameFromPath).filter(Boolean),
      };
    }

    return fileClipboard;
  };

  const pasteLocalPaths = async (
    operation: LocalFileClipboardOperation,
    paths: string[],
    targetSide: FilePaneSide,
  ) => {
    const uniquePaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    if (uniquePaths.length === 0 || !isTauriRuntime()) {
      return;
    }

    if (targetSide === "local") {
      if (!localPath || isLocalDrivePicker) {
        return;
      }
      setIsLocalLoading(true);
      setLocalStatus(t("sftp.waiting"));
      try {
        for (const path of uniquePaths) {
          await invokeCommand(operation === "cut" ? "move_local_path" : "copy_local_path", {
            request: { sourcePath: path, destinationDirectory: localPath },
          });
        }
        await refreshLocalDirectory();
        if (operation === "cut") {
          setFileClipboard(null);
        }
      } catch (error) {
        setLocalStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setIsLocalLoading(false);
      }
      return;
    }

    if (!sessionIdRef.current || !commands || isLocalFilesBrowser || isTransferring) {
      return;
    }

    const nextTransfers = uniquePaths.flatMap((path): TransferRecord[] => {
      const name = localNameFromPath(path);
      return name
        ? [
            {
              id: uniqueRuntimeId("upload"),
              direction: "upload",
              name,
              state: "queued",
              progress: 0,
              detail: t("sftp.waiting"),
              overwriteBehavior: "fail",
              localPath: path,
              remoteDirectory: remotePath,
              deleteSourceWhenDone: operation === "cut" ? { side: "local", path } : undefined,
            },
          ]
        : [];
    });
    if (nextTransfers.length > 0) {
      setTransfers((current) => [...current, ...nextTransfers]);
      if (operation === "cut") {
        setFileClipboard(null);
      }
    }
  };

  const pasteRemotePaths = async (
    operation: LocalFileClipboardOperation,
    paths: string[],
    targetSide: FilePaneSide,
  ) => {
    if (targetSide !== "local" || !localPath || isLocalDrivePicker || !sessionIdRef.current || !commands) {
      return;
    }
    const selected = paths
      .map((path) => ({ path, name: remoteNameFromPath(path) }))
      .filter((entry) => entry.name.length > 0);
    const nextTransfers = selected.map((entry): TransferRecord => ({
      id: uniqueRuntimeId("download"),
      direction: "download",
      name: entry.name,
      state: "queued",
      progress: 0,
      detail: t("sftp.waiting"),
      overwriteBehavior: "fail",
      remotePath: entry.path,
      localDirectory: localPath,
      deleteSourceWhenDone: operation === "cut" ? { side: "remote", path: entry.path } : undefined,
    }));
    if (nextTransfers.length > 0) {
      setTransfers((current) => [...current, ...nextTransfers]);
      if (operation === "cut") {
        setFileClipboard(null);
      }
    }
  };

  const handleOpenLocalFile = async (fileName: string) => {
    const file = localFiles.find((entry) => entry.name === fileName);
    if (!file || file.kind !== "file" || !localPath || isLocalDrivePicker || !isTauriRuntime()) {
      return;
    }

    const path = joinLocalPath(localPath, file.name);
    try {
      if (isLocalFilesBrowser && fileExplorerOpenMode === "inlineEditor") {
        openFileViewerPath(path, { sourceConnection: tab.connection });
        return;
      }
      await openFilesystemPath(path);
    } catch (error) {
      setLocalStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRenameLocalPath = async (currentName: string, newName: string) => {
    const selected = localFiles.find((file) => file.name === currentName);
    if (!selected || !localPath || isLocalDrivePicker || !isTauriRuntime()) {
      return;
    }

    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName === selected.name) {
      return;
    }

    setIsLocalLoading(true);
    setLocalStatus(t("sftp.renaming"));
    try {
      await invokeCommand("rename_local_path", {
        request: {
          path: joinLocalPath(localPath, selected.name),
          newName: trimmedName,
        },
      });
      await refreshLocalDirectory();
    } catch (error) {
      setLocalStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLocalLoading(false);
    }
  };

  const handleDeleteLocalPath = async (names = selectedLocalNames) => {
    const selected = localFiles.filter((file) => names.includes(file.name));
    if (!localPath || isLocalDrivePicker || selected.length === 0 || !isTauriRuntime()) {
      return;
    }

    setDeleteRequest({
      side: "local",
      items: selected.map((item) => ({ kind: item.kind, name: item.name })),
    });
  };

  const handleOpenRemoteFile = async (fileName: string) => {
    const file = remoteFiles.find((entry) => entry.name === fileName);
    const sessionId = sessionIdRef.current;
    if (!file || file.kind !== "file" || !sessionId || !localPath || isLocalDrivePicker || !isTauriRuntime() || !commands) {
      return;
    }

    const remoteFilePath = joinRemotePath(remotePath, file.name);
    const localFilePath = joinLocalPath(localPath, file.name);
    let overwriteBehavior: SftpSettings["overwriteBehavior"] = "fail";
    if (destinationHasVisibleConflict("download", file.name)) {
      const decision = await promptTransferConflict({
        direction: "download",
        name: file.name,
        targetPath: localFilePath,
        isFolder: false,
        remainingConflicts: 0,
      });
      if (decision === "cancel" || decision === "skip") {
        setTransfers((current) => [
          ...current,
          {
            id: uniqueRuntimeId("download"),
            direction: "download",
            name: file.name,
            state: "canceled",
            progress: 100,
            detail: decision === "skip" ? t("sftp.skippedExisting") : t("sftp.transferCanceled"),
            overwriteBehavior,
            remotePath: remoteFilePath,
            localDirectory: localPath,
          },
        ]);
        return;
      }
      overwriteBehavior = "overwrite";
    }

    const transfer: TransferRecord = {
      id: uniqueRuntimeId("download"),
      direction: "download",
      name: file.name,
      state: "queued",
      progress: 0,
      detail: t("sftp.waiting"),
      overwriteBehavior,
      remotePath: remoteFilePath,
      localDirectory: localPath,
      openWhenDone: localFilePath,
    };
    setTransfers((current) => [...current, transfer]);
  };

  const handleCancelTransfer = async (transfer: TransferRecord) => {
    if (transfer.state === "queued") {
      setTransferState(transfer.id, {
        state: "canceled",
        progress: 100,
        detail: t("sftp.canceledBeforeStart"),
      });
      return;
    }

    if (transfer.state !== "active") {
      return;
    }

    setTransferState(transfer.id, { detail: t("sftp.canceling") });
    try {
      if (!commands) throw new Error("commands adapter not initialized");
      await commands.cancelTransfer({ transferId: transfer.id });
    } catch (error) {
      setTransferState(transfer.id, {
        state: "failed",
        progress: 100,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleCreateRemoteFolder = () => {
    if (!sessionIdRef.current || !isTauriRuntime() || !commands) {
      return;
    }

    setNewRemoteFolderOpen(true);
  };

  const handleConfirmCreateRemoteFolder = async (name: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !isTauriRuntime() || !commands) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus(t("sftp.folderNameBlank"));
      return;
    }

    setNewRemoteFolderOpen(false);
    setIsRemoteLoading(true);
    setStatus(t("sftp.creatingFolder"));
    try {
      await commands.createFolder({
        sessionId,
        parentPath: remotePath,
        name: trimmedName,
      });
      await refreshRemoteDirectory();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRemoteLoading(false);
    }
  };

  const handleRenameRemotePath = async (currentName: string, newName: string) => {
    const sessionId = sessionIdRef.current;
    const selected = remoteFiles.find((file) => file.name === currentName);
    if (!sessionId || !selected || !isTauriRuntime() || !commands) {
      return;
    }

    const trimmedName = newName.trim();
    if (!trimmedName) {
      setStatus(t("sftp.remoteNameBlank"));
      return;
    }
    if (trimmedName === selected.name) {
      return;
    }

    setIsRemoteLoading(true);
    setStatus(t("sftp.renaming"));
    try {
      await commands.renamePath({
        sessionId,
        path: joinRemotePath(remotePath, selected.name),
        newName: trimmedName,
      });
      await refreshRemoteDirectory();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRemoteLoading(false);
    }
  };

  const handleDeleteRemotePath = async (names = selectedRemoteNames) => {
    const selected = remoteFiles.filter((file) => names.includes(file.name));
    if (!sessionIdRef.current || selected.length === 0 || !isTauriRuntime() || !commands) {
      return;
    }

    setDeleteRequest({
      side: "remote",
      items: selected.map((item) => ({ kind: item.kind, name: item.name })),
    });
  };

  const handleConfirmDeletePath = async () => {
    const sessionId = sessionIdRef.current;
    const request = deleteRequest;
    if (!request || !isTauriRuntime()) {
      return;
    }

    setDeleteRequest(null);
    try {
      if (request.side === "local") {
        setIsLocalLoading(true);
        setLocalStatus(t("sftp.deleting"));
        for (const item of request.items) {
          await invokeCommand("delete_local_path", {
            request: { path: joinLocalPath(localPath, item.name) },
          });
        }
        await refreshLocalDirectory();
        return;
      }

      if (!sessionId || !commands) {
        return;
      }
      setIsRemoteLoading(true);
      setStatus(t("sftp.deleting"));
      for (const item of request.items) {
        await commands.deletePath({
          sessionId,
          path: joinRemotePath(remotePath, item.name),
        });
      }
      await refreshRemoteDirectory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (request.side === "local") {
        setLocalStatus(message);
      } else {
        setStatus(message);
      }
    } finally {
      setIsLocalLoading(false);
      setIsRemoteLoading(false);
    }
  };

  const selectedLocalFiles = localFiles.filter((file) => selectedLocalNames.includes(file.name));
  const selectedRemoteFiles = remoteFiles.filter((file) => selectedRemoteNames.includes(file.name));

  const handleDropTransfer = (targetSide: FilePaneSide, names: string[]) => {
    if (targetSide === "remote") {
      handleUpload(names);
      return;
    }

    if (!isLocalDrivePicker) {
      handleDownload(names);
    }
  };

  const handleOpenContextMenu = (
    side: FilePaneSide,
    names: string[],
    event: ReactMouseEvent,
  ) => {
    event.preventDefault();
    const fallbackNames = side === "local" ? selectedLocalNames : selectedRemoteNames;
    const nextNames = names.length > 0 ? names : fallbackNames;

    if (side === "local" && nextNames.length > 0) {
      setSelectedLocalNames(nextNames);
    } else if (side === "remote" && nextNames.length > 0) {
      setSelectedRemoteNames(nextNames);
    }

    setContextMenu({
      side,
      names: nextNames,
      x: event.clientX,
      y: event.clientY,
      mutable: side === "local" ? !isLocalDrivePicker : isConnected && !isTransferring,
      canPaste: side === "local" ? !isLocalDrivePicker : isConnected && !isTransferring,
      openable:
        nextNames.length === 1 &&
        (side === "local" ? localFiles : remoteFiles).some(
          (file) => file.name === nextNames[0] && file.kind === "file",
        ),
    });
  };

  const handleContextTransfer = (menu: SftpContextMenuState) => {
    if (menu.side === "local") {
      handleUpload(menu.names);
    } else {
      handleDownload(menu.names);
    }
    setContextMenu(null);
  };

  const handleContextOpen = (menu: SftpContextMenuState) => {
    const name = menu.names[0];
    if (name) {
      if (menu.side === "local") {
        void handleOpenLocalFile(name);
      } else {
        void handleOpenRemoteFile(name);
      }
    }
    setContextMenu(null);
  };

  const handleContextRename = (menu: SftpContextMenuState) => {
    if (menu.side === "local" && menu.names.length === 1 && menu.mutable) {
      setSelectedLocalNames(menu.names);
      setRenameRequest({
        side: "local",
        name: menu.names[0],
        requestId: Date.now(),
      });
    } else if (menu.side === "remote" && menu.names.length === 1 && menu.mutable) {
      setSelectedRemoteNames(menu.names);
      setRenameRequest({
        side: "remote",
        name: menu.names[0],
        requestId: Date.now(),
      });
    }
    setContextMenu(null);
  };

  const handleContextCut = (menu: SftpContextMenuState) => {
    void writeFileClipboard(menu, "cut");
    setContextMenu(null);
  };

  const handleContextCopy = (menu: SftpContextMenuState) => {
    void writeFileClipboard(menu, "copy");
    setContextMenu(null);
  };

  const handleContextPaste = (menu: SftpContextMenuState) => {
    void (async () => {
      const clipboard = await readClipboardForPaste();
      if (!clipboard || clipboard.paths.length === 0) {
        return;
      }
      if (clipboard.side === "local") {
        await pasteLocalPaths(clipboard.operation, clipboard.paths, menu.side);
      } else {
        await pasteRemotePaths(clipboard.operation, clipboard.paths, menu.side);
      }
    })();
    setContextMenu(null);
  };

  const handleContextCopyPath = (menu: SftpContextMenuState) => {
    const name = menu.names[0];
    if (name) {
      const fullPath =
        menu.side === "local"
          ? isLocalDrivePicker
            ? name
            : joinLocalPath(localPath, name)
          : joinRemotePath(remotePath, name);
      void navigator.clipboard?.writeText(fullPath);
    }
    setContextMenu(null);
  };

  const handleContextDelete = (menu: SftpContextMenuState) => {
    if (menu.side === "local") {
      void handleDeleteLocalPath(menu.names);
    } else if (menu.side === "remote") {
      void handleDeleteRemotePath(menu.names);
    }
    setContextMenu(null);
  };

  const handleOpenProperties = async (side: FilePaneSide, names: string[]) => {
    const name = names[0];
    const entry =
      side === "local"
        ? localFiles.find((file) => file.name === name)
        : remoteFiles.find((file) => file.name === name);
    if (!entry) {
      return;
    }

    const path =
      side === "local"
        ? isLocalDrivePicker
          ? entry.name
          : joinLocalPath(localPath, entry.name)
        : joinRemotePath(remotePath, entry.name);
    let remoteProperties: SftpPathProperties | undefined;
    if (side === "remote") {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !isTauriRuntime() || !commands) {
        setStatus(t("sftp.sessionUnavailable"));
        return;
      }

      try {
        remoteProperties = await commands.pathProperties({ sessionId, path });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }

    setPropertiesState({ side, entry, path, remoteProperties });
  };

  const handleContextProperties = (menu: SftpContextMenuState) => {
    void handleOpenProperties(menu.side, menu.names);
    setContextMenu(null);
  };

  // Resolve a single selected file to a local readable path for File Compare.
  // Local files use their own path; remote files are downloaded to a fresh temp
  // dir (the session is live now, so a later compare never depends on it).
  const resolveCompareEndpoint = async (
    side: FilePaneSide,
    name: string,
  ): Promise<CompareEndpoint | null> => {
    if (side === "local") {
      if (isLocalDrivePicker || !localPath) {
        return null;
      }
      const isFolder = localFiles.some((file) => file.name === name && file.kind === "folder");
      return {
        localPath: joinLocalPath(localPath, name),
        label: name,
        origin: localPath,
        isDirectory: isFolder,
      };
    }
    // Folder Compare recursively reads + mirrors local paths, so a remote folder
    // can't be a compare endpoint (we don't mirror an entire remote tree).
    if (remoteFiles.some((file) => file.name === name && file.kind === "folder")) {
      showStatusBarNotice(t("compare.folderRemoteUnsupported"), { tone: "warning" });
      return null;
    }
    const sessionId = sessionIdRef.current;
    if (!sessionId || !commands || !isTauriRuntime()) {
      showStatusBarNotice(t("sftp.sessionUnavailable"), { tone: "error" });
      return null;
    }
    const remoteFilePath = joinRemotePath(remotePath, name);
    const hostLabel = connection?.host ?? t("sftp.remote");
    try {
      const tempDir = await invokeCommand("create_compare_temp_dir");
      await commands.downloadPath({
        sessionId,
        transferId: uniqueRuntimeId("compare"),
        remotePath: remoteFilePath,
        localDirectory: tempDir,
        overwriteBehavior: "overwrite",
      });
      return {
        localPath: joinLocalPath(tempDir, name),
        label: name,
        origin: `${remoteFilePath} @ ${hostLabel}`,
      };
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), { tone: "error" });
      return null;
    }
  };

  const handleContextSelectLeft = (menu: SftpContextMenuState) => {
    setContextMenu(null);
    const name = menu.names[0];
    if (!name) {
      return;
    }
    void (async () => {
      const endpoint = await resolveCompareEndpoint(menu.side, name);
      if (!endpoint) {
        return;
      }
      setCompareLeft(endpoint);
      showStatusBarNotice(t("compare.leftSelected", { name: endpoint.label }), { tone: "info" });
    })();
  };

  const handleContextCompareTo = (menu: SftpContextMenuState) => {
    setContextMenu(null);
    const name = menu.names[0];
    const left = compareLeft;
    if (!name || !left) {
      return;
    }
    void (async () => {
      const right = await resolveCompareEndpoint(menu.side, name);
      if (!right) {
        return;
      }
      if (left.isDirectory && right.isDirectory) {
        openFolderCompareView(left, right);
      } else if (!left.isDirectory && !right.isDirectory) {
        openCompareView(left, right);
      } else {
        showStatusBarNotice(t("compare.mismatch"), { tone: "warning" });
      }
    })();
  };

  const handleUpdateRemoteProperties = async (request: {
    permissions?: string;
    uid?: number;
    gid?: number;
  }) => {
    const sessionId = sessionIdRef.current;
    if (
      !sessionId ||
      !propertiesState ||
      propertiesState.side !== "remote" ||
      !isTauriRuntime() ||
      !commands ||
      !commands.capabilities.editPermissions
    ) {
      return;
    }

    try {
      const remoteProperties = await commands.updatePathProperties({
        sessionId,
        path: propertiesState.path,
        ...request,
      });
      setPropertiesState((current) =>
        current ? { ...current, remoteProperties } : current,
      );
      await refreshRemoteDirectory();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const isConnected = status === t("sftp.connected") && Boolean(sessionIdRef.current);
  const isTransferring = transfers.some((transfer) => transfer.state === "active");
  const clearableTransferCount = transfers.filter((transfer) =>
    TRANSFER_HISTORY_STATES.includes(transfer.state),
  ).length;
  const rawToolbarTitle = tab.toolbarTitle ?? (connection ? connectionToolbarTitle(connection) : tab.title);
  const toolbarTitle =
    isLocalFilesBrowser && connection
      ? localFilesToolbarTitle(connection, rawToolbarTitle, localPlaces?.home?.path ?? "", t)
      : rawToolbarTitle;
  const kindLabel = isLocalFilesBrowser ? toolbarTitle : activeProtocolLabel;
  const kindIconSrc = fileBrowserConnectionIconSrc(
    effectiveBrowserKind === "localFiles" ? "localFiles" : effectiveBrowserKind === "ftp" ? "ftp" : "sftp",
  );
  const hasRemoteHost = !isLocalFilesBrowser && Boolean(connection);
  const hostLabel = tab.subtitle || toolbarTitle;
  const showPlainFtpWarning = !isLocalFilesBrowser && connection
    ? isPlainFtpFileBrowser(connection, sourceConnection ? sshFileBrowserProtocol : undefined)
    : false;
  const connectionStatusLabel = isConnected
    ? t("sftp.connected")
    : remoteError
      ? t("sftp.notConnected")
      : t("sftp.connecting");
  const connectionStatusState = isConnected ? "connected" : remoteError ? "error" : "connecting";


  useEffect(() => {
    if (isLocalFilesBrowser || !commands || !isTauriRuntime()) {
      return;
    }
    const controller: FileBrowserController = {
      kind: effectiveBrowserKind === "ftp" ? "ftp" : "sftp",
      list: async (path) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) {
          throw new Error(t("sftp.sessionUnavailable"));
        }
        return commands.listDirectory({ sessionId, path: path?.trim() || remotePath });
      },
      createFolder: async (parentPath, name) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) {
          throw new Error(t("sftp.sessionUnavailable"));
        }
        const result = await commands.createFolder({ sessionId, parentPath, name });
        await refreshRemoteDirectory();
        return result ?? { ok: true };
      },
      rename: async (path, newName) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) {
          throw new Error(t("sftp.sessionUnavailable"));
        }
        const result = await commands.renamePath({ sessionId, path, newName });
        await refreshRemoteDirectory();
        return result ?? { ok: true };
      },
      deletePath: async (path) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) {
          throw new Error(t("sftp.sessionUnavailable"));
        }
        const result = await commands.deletePath({ sessionId, path });
        await refreshRemoteDirectory();
        return result ?? { ok: true };
      },
      snapshot: () => ({
        kind: effectiveBrowserKind === "ftp" ? "ftp" : "sftp",
        tabId: tab.id,
        connectionId: connection?.id,
        connectionName: connection?.name,
        remotePath,
        remoteFiles,
        selectedRemoteNames,
        status,
      }),
    };
    registerFileBrowserController(tab.id, controller);
    return () => unregisterFileBrowserController(tab.id, controller);
    // Re-register only on the listed inputs; refreshRemoteDirectory is recreated each render and read at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, connection?.id, connection?.name, effectiveBrowserKind, isLocalFilesBrowser, remoteFiles, remotePath, selectedRemoteNames, status, t, tab.id]);

  return (
    <section
      className={isActive ? "sftp-workspace active" : "sftp-workspace"}
      data-color-scheme={resolveAppliedColorScheme(appearanceSettings.colorScheme)}
      data-selected-color-scheme={appearanceSettings.colorScheme}
      ref={workspaceRef}
    >
      <div className="workspace-toolbar sftp-toolbar" data-tutorial-id="sftp.toolbar">
        <span className="sftp-bar-left">
          <span className="sftp-bar-kind">
            <img alt="" aria-hidden="true" draggable={false} height={18} src={kindIconSrc} width={18} />
            <span>{kindLabel}</span>
            {sourceConnection ? (
              <span className="sftp-protocol-menu-host" ref={protocolMenuRef}>
                <button
                  className="sftp-protocol-change"
                  aria-expanded={protocolMenuOpen}
                  aria-haspopup="menu"
                  aria-label={t("sftp.protocolSelectorAria")}
                  onClick={() => setProtocolMenuOpen((open) => !open)}
                  type="button"
                >
                  <ChevronsUpDown size={12} />
                </button>
                {protocolMenuOpen ? (
                  <div className="sftp-protocol-menu" role="menu">
                    {sshFileBrowserProtocolOptions(t).map((option) => (
                      <button
                        className={option.value === sshFileBrowserProtocol ? "active" : ""}
                        key={option.value}
                        onClick={() => handleProtocolChange(option.value)}
                        role="menuitemradio"
                        aria-checked={option.value === sshFileBrowserProtocol}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                    <label className="sftp-protocol-port-row">
                      <span>{t("connections.port")}</span>
                      <input
                        className="sftp-protocol-port-input"
                        inputMode="numeric"
                        min={1}
                        max={65535}
                        type="number"
                        value={sshFileBrowserPortDraft}
                        onBlur={commitProtocolPortDraft}
                        onChange={(event) => setSshFileBrowserPortDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitProtocolPortDraft();
                            event.currentTarget.blur();
                          }
                          event.stopPropagation();
                        }}
                      />
                    </label>
                  </div>
                ) : null}
              </span>
            ) : null}
          </span>
        </span>
        <span className="sftp-bar-center" title={hasRemoteHost ? hostLabel : undefined}>
          {hasRemoteHost ? hostLabel : null}
        </span>
        <span className="sftp-bar-right">
          {showPlainFtpWarning ? (
            <span
              className="sftp-title-warning"
              title={plainFtpFallbackActive ? t("sftp.plainFtpFallbackWarningTitle") : t("sftp.plainFtpWarningTitle")}
            >
              <AlertTriangle size={13} />
              {t("sftp.plainFtpWarning")}
            </span>
          ) : null}
          {hasRemoteHost ? (
            <span className="sftp-conn-pill" data-state={connectionStatusState}>
              <span className="dot" />
              {connectionStatusLabel}
            </span>
          ) : null}
          {onClose ? (
            <button
              className="sftp-bar-close"
              aria-label={t("common.close")}
              onClick={onClose}
              type="button"
            >
              <X size={16} />
            </button>
          ) : null}
        </span>
      </div>

      <div className={isLocalFilesBrowser ? "sftp-panes sftp-panes-single" : "sftp-panes"}>
        <FilePane
          side="local"
          title={t("sftp.local")}
          path={isLocalDrivePicker ? t("sftp.windowsDrives") : localPath || localStatus || t("sftp.localFiles")}
          files={localFiles}
          isLoading={isLocalLoading}
          status={localStatus}
          selectedNames={selectedLocalNames}
          onRefresh={refreshLocalDirectory}
          onGoUp={openLocalParent}
          onRenameSelected={!isLocalDrivePicker ? handleRenameLocalPath : undefined}
          onDeleteSelected={!isLocalDrivePicker ? handleDeleteLocalPath : undefined}
          onOpenFolder={openLocalFolder}
          onOpenFile={(fileName) => void handleOpenLocalFile(fileName)}
          onOpenTerminalHere={() => void handleOpenLocalTerminalHere()}
          onOpenGit={gitRepo ? () => openGitBrowser(gitRepo.repoRoot, gitRepo.label) : undefined}
          onPathSubmit={(path) => void loadLocalDirectory(path)}
          recentPaths={recentLocalPaths}
          onSelectionChange={setSelectedLocalNames}
          onContextMenuRequest={handleOpenContextMenu}
          onDropTransfer={
            !isLocalFilesBrowser && isConnected && !isTransferring && !isLocalDrivePicker ? handleDropTransfer : undefined
          }
          renameRequest={renameRequest?.side === "local" ? renameRequest : undefined}
          enableSidebar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          places={localPlaces}
          favorites={favorites}
          onAddFavorite={addFavorite}
          onRemoveFavorite={removeFavorite}
          onReorderFavorites={reorderFavorites}
          onOpenFavoriteFile={(path) => {
            if (isLocalFilesBrowser && fileExplorerOpenMode === "inlineEditor") {
              openFileViewerPath(path, { sourceConnection: tab.connection });
              return;
            }
            void openFilesystemPath(path);
          }}
          enableSearch
          showFooter
          availableBytes={isLocalDrivePicker ? undefined : localAvailableBytes}
          zoom={viewOptions.local.zoom}
          onZoomChange={(zoom) => updateViewOptions("local", { zoom })}
          background={viewOptions.local.background}
          onBackgroundChange={(background) => updateViewOptions("local", { background })}
          backgroundActive={isActive}
        />
        {!isLocalFilesBrowser ? (
          <>
            <div className="sftp-gutter">
              <button
                className="sftp-xfer-arrow"
                data-tutorial-id="sftp.upload"
                aria-label={t("sftp.upload")}
                title={t("sftp.upload")}
                disabled={!isConnected || isLocalDrivePicker || selectedLocalFiles.length === 0}
                onClick={() => handleUpload()}
                type="button"
              >
                <DIcon name="forward" size={18} />
              </button>
              <button
                className="sftp-xfer-arrow"
                data-tutorial-id="sftp.download"
                aria-label={t("sftp.download")}
                title={t("sftp.download")}
                disabled={!isConnected || selectedRemoteFiles.length === 0 || !localPath || isLocalDrivePicker}
                onClick={() => handleDownload()}
                type="button"
              >
                <DIcon name="back" size={18} />
              </button>
            </div>
            <FilePane
              side="remote"
              title={t("sftp.remote")}
              path={remotePath}
              files={remoteFiles}
              isLoading={isRemoteLoading}
              status={remoteError ? t("sftp.notConnected") : status === t("sftp.connected") ? "" : status}
              selectedNames={selectedRemoteNames}
              onRefresh={refreshRemoteDirectory}
              onGoUp={openRemoteParent}
              onCreateFolder={isConnected && !isTransferring ? handleCreateRemoteFolder : undefined}
              onRenameSelected={isConnected && !isTransferring ? handleRenameRemotePath : undefined}
              onDeleteSelected={isConnected && !isTransferring ? handleDeleteRemotePath : undefined}
              onOpenFolder={openRemoteFolder}
              onOpenFile={(fileName) => void handleOpenRemoteFile(fileName)}
              onPathSubmit={(path) => void loadRemoteDirectory(path)}
              recentPaths={recentRemotePaths}
              onSelectionChange={setSelectedRemoteNames}
              onContextMenuRequest={handleOpenContextMenu}
              onDropTransfer={isConnected && !isTransferring ? handleDropTransfer : undefined}
              renameRequest={renameRequest?.side === "remote" ? renameRequest : undefined}
              enableSearch
              showFooter
              zoom={viewOptions.remote.zoom}
              onZoomChange={(zoom) => updateViewOptions("remote", { zoom })}
              background={viewOptions.remote.background}
              onBackgroundChange={(background) => updateViewOptions("remote", { background })}
              backgroundActive={isActive}
            />
          </>
        ) : null}
      </div>

      {!isLocalFilesBrowser ? (
        <TransferArea
          transfers={transfers}
          clearableCount={clearableTransferCount}
          error={effectiveBrowserKind === "ftp" ? undefined : remoteError}
          onClear={() =>
            setTransfers((current) =>
              current.filter((transfer) => !TRANSFER_HISTORY_STATES.includes(transfer.state)),
            )
          }
          onCancel={(transfer) => void handleCancelTransfer(transfer)}
        />
      ) : null}
      {contextMenu ? (() => {
        // A single file is always compare-selectable; a folder only when local,
        // since Folder Compare mirrors local paths (remote trees aren't mirrored).
        const compareEntry =
          contextMenu.names.length === 1
            ? (contextMenu.side === "local" ? localFiles : remoteFiles).find(
                (file) => file.name === contextMenu.names[0],
              )
            : undefined;
        const compareEntryIsFolder = compareEntry?.kind === "folder";
        const canSelectForCompare =
          !!compareEntry &&
          !(contextMenu.side === "local" && isLocalDrivePicker) &&
          (compareEntryIsFolder ? contextMenu.side === "local" : true);
        const isSameAsLeft =
          contextMenu.side === "local" &&
          !isLocalDrivePicker &&
          !!localPath &&
          compareLeft?.localPath === joinLocalPath(localPath, contextMenu.names[0] ?? "");
        // Only compare like-with-like: folder↔folder or file↔file.
        const typesMatch = !!compareLeft && !!compareLeft.isDirectory === compareEntryIsFolder;
        return (
        <SftpContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onCopy={handleContextCopy}
          onCopyPath={handleContextCopyPath}
          onCut={handleContextCut}
          onDelete={handleContextDelete}
          onOpen={handleContextOpen}
          onPaste={handleContextPaste}
          onProperties={handleContextProperties}
          onRename={handleContextRename}
          onSelectLeftForCompare={handleContextSelectLeft}
          onCompareToLeft={handleContextCompareTo}
          compareLeftLabel={compareLeft?.label ?? null}
          canSelectForCompare={canSelectForCompare}
          canCompareToLeft={!!compareLeft && canSelectForCompare && typesMatch && !isSameAsLeft}
          showTransfer={!isLocalFilesBrowser}
          onTransfer={handleContextTransfer}
        />
        );
      })() : null}
      {propertiesState ? (
        <SftpPropertiesPopup
          properties={propertiesState}
          onClose={() => setPropertiesState(null)}
          onSave={(request) => void handleUpdateRemoteProperties(request)}
        />
      ) : null}
      {newRemoteFolderOpen ? (
        <NewRemoteFolderDialog
          onCancel={() => setNewRemoteFolderOpen(false)}
          onCreate={(name) => void handleConfirmCreateRemoteFolder(name)}
        />
      ) : null}
      {deleteRequest ? (
        <ConfirmRemoteDeleteDialog
          request={deleteRequest}
          onCancel={() => setDeleteRequest(null)}
          onConfirm={() => void handleConfirmDeletePath()}
        />
      ) : null}
      {passwordPrompt && connection ? (
        <PasswordPromptDialog
          connection={connection}
          message={passwordPrompt.message}
          onCancel={() => completePasswordPrompt(null)}
          onSubmit={(password) => completePasswordPrompt(password)}
        />
      ) : null}
      {ftpNoticeDialog ? (
        <FtpNoticeDialog
          notice={ftpNoticeDialog}
          onClose={() => setFtpNoticeDialog(null)}
        />
      ) : null}
      {transferConflict ? (
        <TransferConflictDialog
          conflict={transferConflict}
          onDecision={resolveTransferConflict}
        />
      ) : null}
    </section>
  );
}

function PasswordPromptDialog({
  connection,
  message,
  onCancel,
  onSubmit,
}: {
  connection: Connection;
  message?: string;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const trimmedPassword = password.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedPassword) {
      setError(t("sftp.passwordRequired"));
      return;
    }
    onSubmit(password);
  }

  return (
    <DialogShell onBackdrop={onCancel}>
      <Sheet
        width={420}
        title={t("sftp.passwordDialogTitle")}
        ariaLabel={t("sftp.passwordDialogTitle")}
        footer={
          <Actions
            cancel={<Btn onClick={onCancel}>{t("common.cancel")}</Btn>}
            primary={
              <Btn kind="primary" onClick={() => onSubmit(password)} disabled={!trimmedPassword}>
                {t("sftp.passwordDialogSubmit")}
              </Btn>
            }
          />
        }
      >
        <form className="sftp-password-dialog" onSubmit={handleSubmit}>
          <p>
            {t("sftp.passwordDialogBody", {
              user: connection.user || "anonymous",
              host: connection.host,
            })}
          </p>
          {message ? <p className="sftp-password-dialog-error">{message}</p> : null}
          {error ? <p className="sftp-password-dialog-error">{error}</p> : null}
          <Field label={t("connections.password")}>
            <TextInput
              autoFocus
              autoComplete="current-password"
              type="password"
              value={password}
              placeholder={t("sftp.passwordDialogPlaceholder")}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
            />
          </Field>
          <button className="sr-only" type="submit">
            {t("sftp.passwordDialogSubmit")}
          </button>
        </form>
      </Sheet>
    </DialogShell>
  );
}

function FtpNoticeDialog({
  notice,
  onClose,
}: {
  notice: FtpNoticeDialogState;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={420}
        title={notice.title}
        ariaLabel={notice.title}
        footer={
          <Actions
            primary={<Btn kind="primary" onClick={onClose}>{t("common.close")}</Btn>}
          />
        }
      >
        <div className="sftp-ftp-notice-dialog">
          <p>{notice.message}</p>
        </div>
      </Sheet>
    </DialogShell>
  );
}

function protocolFromTab(tab: WorkspaceTab): SshFileBrowserProtocol {
  return tab.kind === "ftp" ? "ftp" : "sftp";
}

function isFtpsProtocol(protocol: SshFileBrowserProtocol) {
  return protocol === "ftpsExplicit" || protocol === "ftpsImplicit";
}

function sshFileBrowserProtocolOptions(t: (key: string) => string) {
  return [
    { value: "sftp" as const, label: t("sftp.protocolSftp") },
    { value: "ftpsExplicit" as const, label: t("sftp.protocolFtpsExplicit") },
    { value: "ftpsImplicit" as const, label: t("sftp.protocolFtpsImplicit") },
    { value: "ftp" as const, label: t("sftp.protocolFtp") },
  ];
}

function shouldPromptBeforeFileBrowserConnect(
  connection: Connection,
  sourceConnection?: Connection,
  protocol: SshFileBrowserProtocol = "sftp",
) {
  let credentialSource = sourceConnection ?? connection;
  if (protocol !== "sftp" && sourceConnection) {
    credentialSource = connection;
  }
  return (
    credentialSource.authMethod === "password" &&
    !credentialSource.hasPassword &&
    !credentialSource.passwordCredentialId
  );
}

function fileBrowserProtocolLabel(
  connection: Connection,
  protocol: SshFileBrowserProtocol | undefined,
  t: (key: string) => string,
) {
  if (protocol === "ftpsExplicit") {
    return t("sftp.protocolFtpsExplicit");
  }
  if (protocol === "ftpsImplicit") {
    return t("sftp.protocolFtpsImplicit");
  }
  if (protocol === "ftp") {
    return t("sftp.protocolFtp");
  }
  if (connection.type === "ftp" && connection.ftpOptions?.protocol === "ftps") {
    return connection.ftpOptions.tlsMode === "implicit"
      ? t("sftp.protocolFtpsImplicit")
      : t("sftp.protocolFtpsExplicit");
  }
  if (connection.type === "ftp") {
    return t("sftp.protocolFtp");
  }
  return t("sftp.protocolSftp");
}

function isPlainFtpFileBrowser(
  connection: Connection,
  protocol?: SshFileBrowserProtocol,
) {
  if (protocol) {
    return protocol === "ftp";
  }
  return connection.type === "ftp" && connection.ftpOptions?.protocol !== "ftps";
}

function isMissingFileBrowserPasswordError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("password auth requires a stored connection password") ||
    normalized.includes("password auth requires a connection secret owner") ||
    normalized.includes("password is required for native ssh sessions")
  );
}

function connectionForSshFileBrowserProtocol(
  sourceConnection: Connection,
  protocol: SshFileBrowserProtocol,
  port: number,
): Connection {
  if (protocol === "sftp") {
    return {
      ...sourceConnection,
      port,
    };
  }
  const ftpOptions = ftpOptionsForSshFileBrowserProtocol(protocol);
  return {
    ...sourceConnection,
    type: "ftp",
    port,
    keyPath: undefined,
    proxyJump: undefined,
    sshSocksProxy: undefined,
    sshSocksProxyUsername: undefined,
    sshSocksProxyInheritDefaults: undefined,
    authMethod: "password",
    ftpOptions,
    iconDataUrl: sourceConnection.iconDataUrl ?? "material:folder-server",
  };
}

function defaultPortForSshFileBrowserProtocol(
  protocol: SshFileBrowserProtocol,
  sourceConnection?: Pick<Connection, "port"> | null,
) {
  if (protocol === "sftp") {
    return sourceConnection?.port ?? 22;
  }
  if (protocol === "ftpsExplicit") {
    return 21;
  }
  if (protocol === "ftpsImplicit") {
    return 990;
  }
  return 21;
}

function ftpOptionsForSshFileBrowserProtocol(
  protocol: SshFileBrowserProtocol,
): FtpConnectionOptions {
  return {
    protocol: protocol === "ftp" ? "ftp" : "ftps",
    mode: "passive",
    tlsMode: protocol === "ftpsImplicit" ? "implicit" : "explicit",
    transferType: "binary",
    utf8: true,
    showHidden: false,
    connectTimeoutSecs: 30,
    ignoreCertErrors: false,
    keepaliveSecs: 0,
  };
}

function readStoredSshFileBrowserProtocol(
  connectionId: string,
  sourceConnection?: Pick<Connection, "port"> | null,
): SshFileBrowserSelection {
  if (typeof window === "undefined") {
    return {
      protocol: DEFAULT_SSH_FILE_BROWSER_PROTOCOL,
      port: defaultPortForSshFileBrowserProtocol(DEFAULT_SSH_FILE_BROWSER_PROTOCOL, sourceConnection),
    };
  }
  try {
    const raw = window.localStorage.getItem(SSH_FILE_BROWSER_PROTOCOL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, StoredSshFileBrowserProtocol> : {};
    const protocol = normalizeSshFileBrowserProtocol(parsed[connectionId]?.protocol);
    return {
      protocol,
      port: normalizeSshFileBrowserPort(parsed[connectionId]?.port) ??
        defaultPortForSshFileBrowserProtocol(protocol, sourceConnection),
    };
  } catch {
    return {
      protocol: DEFAULT_SSH_FILE_BROWSER_PROTOCOL,
      port: defaultPortForSshFileBrowserProtocol(DEFAULT_SSH_FILE_BROWSER_PROTOCOL, sourceConnection),
    };
  }
}

function writeStoredSshFileBrowserProtocol(
  connectionId: string,
  selection: SshFileBrowserSelection,
) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const raw = window.localStorage.getItem(SSH_FILE_BROWSER_PROTOCOL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, StoredSshFileBrowserProtocol> : {};
    parsed[connectionId] = selection;
    window.localStorage.setItem(SSH_FILE_BROWSER_PROTOCOL_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Best-effort preference only; connection startup must not depend on storage.
  }
}

// Last local folder opened in the terminal-spawned browser, per SSH Connection,
// so reopening the popup returns to where the user left off.
function readStoredSshFileBrowserLocalPath(connectionId: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(SSH_FILE_BROWSER_LOCAL_PATH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const path = parsed[connectionId];
    return typeof path === "string" && path.trim() ? path : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredSshFileBrowserLocalPath(connectionId: string, path: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const raw = window.localStorage.getItem(SSH_FILE_BROWSER_LOCAL_PATH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    parsed[connectionId] = path;
    window.localStorage.setItem(SSH_FILE_BROWSER_LOCAL_PATH_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Best-effort preference only; browsing must not depend on storage.
  }
}

function normalizeSshFileBrowserProtocol(value: unknown): SshFileBrowserProtocol {
  return value === "ftp" ||
    value === "ftpsExplicit" ||
    value === "ftpsImplicit" ||
    value === "sftp"
    ? value
    : DEFAULT_SSH_FILE_BROWSER_PROTOCOL;
}

function normalizeSshFileBrowserPort(value: unknown) {
  const port = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function TransferArea({
  transfers,
  clearableCount,
  error,
  onClear,
  onCancel,
}: {
  transfers: TransferRecord[];
  clearableCount: number;
  error?: string;
  onClear: () => void;
  onCancel: (transfer: TransferRecord) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const active = transfers.filter(
    (transfer) => transfer.state === "active" || transfer.state === "queued",
  );
  const doneCount = transfers.filter((transfer) => transfer.state === "done").length;
  const averageProgress = active.length
    ? Math.round(active.reduce((sum, transfer) => sum + transfer.progress, 0) / active.length)
    : 0;

  useEffect(() => {
    if (active.length > 0) {
      setOpen(true);
    }
  }, [active.length]);

  let status: string;
  if (error) {
    status = error;
  } else if (active.length) {
    status = t("sftp.transferringStatus", { count: active.length, percent: averageProgress });
  } else if (transfers.length) {
    status = t("sftp.transfersIdleStatus", { count: doneCount });
  } else {
    status = t("sftp.noTransfers");
  }

  return (
    <div className={`sftp-xfer${open ? " open" : ""}${error ? " has-error" : ""}`} data-tutorial-id="sftp.transferQueue">
      <div
        className="sftp-xfer-bar"
        onClick={() => setOpen((value) => !value)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        <div className="lead">
          <DIcon name={error ? "alert" : active.length ? "refresh" : "check"} size={15} />
          <span className="status" title={error || undefined}>{status}</span>
        </div>
        {active.length > 0 ? (
          <div className="mini-track">
            <div className="mini-fill" style={{ width: `${averageProgress}%` }} />
          </div>
        ) : null}
        <div className="right">
          {transfers.length > 0 ? (
            <button
              className="sftp-icon-btn"
              disabled={clearableCount === 0}
              title={t("sftp.clear")}
              aria-label={t("sftp.clear")}
              onClick={(event) => {
                event.stopPropagation();
                onClear();
              }}
              type="button"
            >
              <DIcon name="trash" size={14} />
            </button>
          ) : null}
          <span className="sftp-xfer-chev">
            <DIcon name="chevdown" size={16} />
          </span>
        </div>
      </div>
      <div className="sftp-xfer-panel">
        <div className="sftp-xfer-panel-inner">
          {transfers.length === 0 ? (
            <div className="sftp-xfer-empty">{t("sftp.transferHint")}</div>
          ) : null}
          {transfers.map((transfer) => (
            <div className="sftp-xfer-row" key={transfer.id}>
              <span className="dir">
                <DIcon name={transfer.direction === "upload" ? "upload" : "download"} size={16} />
              </span>
              <div className="meta">
                <div className="nm">{transfer.name}</div>
                <div className="track">
                  <div className={`fill ${transfer.state}`} style={{ width: `${transfer.progress}%` }} />
                </div>
              </div>
              <span className={`st ${transfer.state}`}>
                {transfer.state === "active"
                  ? `${Math.round(transfer.progress)}%`
                  : t(`sftp.transferState.${transfer.state}`)}
              </span>
              {transfer.state === "active" || transfer.state === "queued" ? (
                <button
                  className="sftp-icon-btn"
                  title={t("sftp.cancelTransferName", { name: transfer.name })}
                  aria-label={t("sftp.cancelTransferName", { name: transfer.name })}
                  onClick={() => onCancel(transfer)}
                  type="button"
                >
                  <DIcon name="close" size={13} />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function isWindowsDriveRoot(path: string) {
  return /^[A-Za-z]:[\\/]?$/.test(path.trim());
}


function localNameFromPath(path: string) {
  const trimmedPath = path.trim().replace(/[\\/]+$/, "");
  const parts = trimmedPath.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function remoteNameFromPath(path: string) {
  const trimmedPath = path.trim().replace(/\/+$/, "");
  const parts = trimmedPath.split("/");
  return parts[parts.length - 1] ?? "";
}


function readRecentPaths(side: FilePaneSide, connectionId?: string) {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const state = JSON.parse(
      window.localStorage.getItem(FILE_BROWSER_RECENT_PATHS_STORAGE_KEY) || "{}",
    ) as RecentFileBrowserPaths;
    if (side === "local") {
      return normalizeRecentPaths(state.local);
    }

    return normalizeRecentPaths(state.remote?.[remoteRecentPathKey(connectionId)]);
  } catch {
    return [];
  }
}

function writeRecentPaths(side: FilePaneSide, path: string, connectionId?: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath || trimmedPath === WINDOWS_DRIVES_PATH || typeof window === "undefined") {
    return readRecentPaths(side, connectionId);
  }

  let state: RecentFileBrowserPaths;
  try {
    state = JSON.parse(
      window.localStorage.getItem(FILE_BROWSER_RECENT_PATHS_STORAGE_KEY) || "{}",
    ) as RecentFileBrowserPaths;
  } catch {
    state = {};
  }

  const currentPaths = side === "local"
    ? normalizeRecentPaths(state.local)
    : normalizeRecentPaths(state.remote?.[remoteRecentPathKey(connectionId)]);
  const nextPaths = [
    trimmedPath,
    ...currentPaths.filter((entry) => entry !== trimmedPath),
  ].slice(0, RECENT_PATH_LIMIT);

  if (side === "local") {
    state = { ...state, local: nextPaths };
  } else {
    state = {
      ...state,
      remote: {
        ...(state.remote ?? {}),
        [remoteRecentPathKey(connectionId)]: nextPaths,
      },
    };
  }

  window.localStorage.setItem(FILE_BROWSER_RECENT_PATHS_STORAGE_KEY, JSON.stringify(state));
  return nextPaths;
}

function readFavorites(): LocalFavorite[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(
      readDurableUiState(FILE_BROWSER_FAVORITES_STORAGE_KEY) || "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is LocalFavorite =>
          Boolean(entry) &&
          typeof entry.id === "string" &&
          typeof entry.label === "string" &&
          typeof entry.path === "string" &&
          typeof entry.icon === "string",
      )
      .map((entry) => ({ id: entry.id, label: entry.label, path: entry.path, icon: entry.icon }));
  } catch {
    return [];
  }
}

function writeFavorites(favorites: LocalFavorite[]) {
  if (typeof window === "undefined") {
    return;
  }
  // File-browser favorites are durable user bookmarks: SQLite source of truth
  // (backed up, portable), mirrored to the synchronous cache. Recent paths stay
  // local-only as transient navigation history.
  writeDurableUiState(FILE_BROWSER_FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
}

function readSidebarCollapsed(connectionKey: string, isLocalFilesBrowser: boolean): boolean {
  // File Explorer defaults to an open sidebar; remote browsers default to closed.
  const fallback = !isLocalFilesBrowser;
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const state = JSON.parse(
      window.localStorage.getItem(FILE_BROWSER_SIDEBAR_STORAGE_KEY) || "{}",
    ) as Record<string, boolean>;
    const stored = state[connectionKey];
    return typeof stored === "boolean" ? stored : fallback;
  } catch {
    return fallback;
  }
}

function normalizeLocalPathForTitleComparison(path: string) {
  return path.trim().replace(/[\\/]+$/g, "");
}

function localFilesToolbarTitle(
  connection: NonNullable<WorkspaceTab["connection"]>,
  fallbackTitle: string,
  homeDirectory: string,
  t: (key: string) => string,
) {
  const defaultFileExplorerNames = new Set(["File Explorer", t("connections.localFiles")]);
  const name = connection.name.trim();
  const startupDirectory = normalizeLocalPathForTitleComparison(connection.localStartupDirectory ?? "");
  const normalizedHome = normalizeLocalPathForTitleComparison(homeDirectory);
  const isHomeDirectory = !startupDirectory || (
    normalizedHome &&
    startupDirectory.toLocaleLowerCase() === normalizedHome.toLocaleLowerCase()
  );
  if (isHomeDirectory && (!name || defaultFileExplorerNames.has(name))) {
    return t("connections.homeDirectory");
  }
  return fallbackTitle;
}

function writeSidebarCollapsed(connectionKey: string, collapsed: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  let state: Record<string, boolean>;
  try {
    state = JSON.parse(
      window.localStorage.getItem(FILE_BROWSER_SIDEBAR_STORAGE_KEY) || "{}",
    ) as Record<string, boolean>;
  } catch {
    state = {};
  }
  state[connectionKey] = collapsed;
  window.localStorage.setItem(FILE_BROWSER_SIDEBAR_STORAGE_KEY, JSON.stringify(state));
}

// Transient terminal-local Connections (e.g. `local-123…`) are not durable DB
// rows, so view-option writes for them are skipped.
function isTransientFileBrowserConnectionId(connectionId: string) {
  return /^local-\d+$/u.test(connectionId);
}

function normalizeRecentPaths(paths: unknown) {
  return Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === "string" && path.length > 0).slice(0, RECENT_PATH_LIMIT)
    : [];
}

function remoteRecentPathKey(connectionId?: string) {
  return connectionId || "default";
}

type RecentFileBrowserPaths = {
  local?: string[];
  remote?: Record<string, string[]>;
};

function localEntryToFileEntry(entry: LocalDirectoryEntry): FileEntry {
  return {
    name: entry.name,
    kind: entry.kind,
    size: entry.kind === "folder" ? "-" : formatFileSize(entry.size),
    sizeBytes: entry.size,
    modified: formatRemoteTime(entry.modified),
    modifiedTimestamp: entry.modified,
  };
}

function remoteEntryToFileEntry(entry: SftpDirectoryEntry): FileEntry {
  return {
    name: entry.name,
    kind: entry.kind,
    size: entry.kind === "folder" ? "-" : formatFileSize(entry.size),
    sizeBytes: entry.size,
    modified: formatRemoteTime(entry.modified),
    modifiedTimestamp: entry.modified,
    accessedTimestamp: entry.accessed,
    permissions: entry.permissions,
    mode: entry.permissions === undefined ? undefined : formatMode(entry.permissions),
    uid: entry.uid,
    user: entry.user,
    gid: entry.gid,
    group: entry.group,
  };
}

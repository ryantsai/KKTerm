import { create } from "zustand";
import {
  defaultAppearanceSettings,
  defaultAiProviderSettings,
  defaultCredentialSettings,
  defaultRdpSettings,
  defaultSftpSettings,
  defaultSshSettings,
  defaultUrlSettings,
  defaultVncSettings,
  defaultGeneralSettings,
  defaultDashboardSettings,
  defaultTerminalSettings,
  initialTabs,
} from "./app-defaults";
import {
  defaultLayoutFor,
  ensureLayout,
  hydrateLayout,
  leafOrder,
  serializeLayout,
  splitLayout,
} from "./modules/workspace/layout";
import type {
  AppearanceSettings,
  AiProviderSettings,
  CredentialSettings,
  AssistantDirectSubmitRequest,
  AssistantContextSnippet,
  Connection,
  PerformanceMetrics,
  PerformanceSnapshot,
  HostUsageSnapshot,
  RdpSettings,
  SftpSettings,
  SplitDirection,
  UrlSettings,
  VncSettings,
  SshSettings,
  StoredConnectionLayout,
  TerminalPane,
  GeneralSettings,
  DashboardSettings,
  QuickCommand,
  TerminalSettings,
  TerminalStartMetric,
  LayoutNode,
  WorkspacePane,
  StatusBarNotice,
  Workspace,
  WorkspaceChildConnection,
  WorkspaceTab,
} from "./types";
import i18next from "./i18n/config";
import { invokeCommand, openFilesystemPath } from "./lib/tauri";
import { elevatedLocalShellAction } from "./modules/workspace/connections/quickConnectMenuModel";
import { resolveDefaultTerminalAppearance } from "./modules/workspace/connections/terminalAppearanceDefaults";
import type { LocalShellOption } from "./modules/workspace/connections/utils";
import type { GitBrowserTarget } from "./modules/git/gitTypes";
import type { CompareEndpoint, CompareView } from "./modules/compare/compareTypes";
import { markPanesForRuntimeMove } from "./modules/workspace/paneRegistry";
import {
  collectPreservedParentPanes,
  focusedPaneIdForChildLayout,
  loadStoredChildConnections,
  notifyStoredChildConnectionsUpdated,
  persistStoredChildConnections,
} from "./modules/workspace/connections/childConnections";
import {
  readDurableUiState,
  removeDurableUiState,
  writeDurableUiState,
} from "./lib/durableUiState";

const LAYOUT_STORAGE_PREFIX = "kkterm.layout.";
const TMUX_SESSION_STORAGE_PREFIX = "kkterm.tmuxSessions.";
const QUICK_COMMAND_BAR_STORAGE_PREFIX = "kkterm.quickCommandBar.";
const QUICK_COMMANDS_STORAGE_PREFIX = "kkterm.quickCommands.";
const TMUX_SESSION_ID_PATTERN = /^[^\s:;]+$/u;
export const CHILD_CONNECTION_CLOSED_EVENT = "kkterm:workspace-child-connection-closed";
let statusBarNoticeSequence = 0;
const DEFAULT_STATUS_BAR_NOTICE_DURATION_MS: Record<StatusBarNotice["tone"], number> = {
  success: 2_000,
  info: 5_000,
  warning: 5_000,
  error: 5_000,
};
// English fallback names used only when the active locale has no tmux-safe
// ai.tmuxSessionLabels pool. Locales own their pool; names do not map by index.
const TMUX_SESSION_NAMES = [
  "airlock",
  "andromeda",
  "antimatter",
  "asteroid",
  "astronaut",
  "atmosphere",
  "aurora",
  "binary",
  "biosphere",
  "blackhole",
  "blazar",
  "capsule",
  "celestial",
  "chromosphere",
  "chronos",
  "cluster",
  "comet",
  "constellation",
  "corona",
  "cosmos",
  "crater",
  "cryo",
  "cyber",
  "datasphere",
  "deepspace",
  "docking",
  "domeshield",
  "drift",
  "dwarfstar",
  "eclipse",
  "electromag",
  "equinox",
  "event",
  "exoplanet",
  "exosphere",
  "filament",
  "flyby",
  "fusion",
  "galaxy",
  "gateway",
  "geodesic",
  "gluon",
  "gravity",
  "hangar",
  "helix",
  "holodeck",
  "horizon",
  "hydrogen",
  "hypernova",
  "hyperspace",
  "ignition",
  "impulse",
  "inertia",
  "infrared",
  "iondrive",
  "ionosphere",
  "jetstream",
  "jumpgate",
  "jupiter",
  "kepler",
  "launchpad",
  "lightyear",
  "lithium",
  "lodestar",
  "mainframe",
  "mars",
  "mercury",
  "meteor",
  "mission",
  "moonbase",
  "moonshot",
  "nebula",
  "neptune",
  "netrunner",
  "neutron",
  "nextgen",
  "nova",
  "observatory",
  "orbit",
  "orion",
  "parsec",
  "payload",
  "photon",
  "planetoid",
  "plasma",
  "polaris",
  "probe",
  "pulsar",
  "quantum",
  "quasar",
  "redshift",
  "rover",
  "satellite",
  "singularity",
  "solarwind",
  "spacelab",
  "stardust",
  "starship",
  "sunspot",
  "supernova",
];

export function forgetTmuxSessionId(connectionId: string, sessionId: string) {
  const sessionIds = loadStoredTmuxSessionIds(connectionId).filter((entry) => entry !== sessionId);
  persistTmuxSessionIds(connectionId, sessionIds);
}

function replaceTmuxSessionId(connectionId: string, previousSessionId: string, nextSessionId: string) {
  const sessionIds = loadStoredTmuxSessionIds(connectionId);
  const nextSessionIds = sessionIds.map((entry) => (entry === previousSessionId ? nextSessionId : entry));
  if (!nextSessionIds.includes(nextSessionId)) {
    nextSessionIds.push(nextSessionId);
  }
  persistTmuxSessionIds(connectionId, Array.from(new Set(nextSessionIds)));
}

function loadStoredLayout(
  connectionId: string,
): StoredConnectionLayout | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(
      `${LAYOUT_STORAGE_PREFIX}${connectionId}`,
    );
    return raw ? (JSON.parse(raw) as StoredConnectionLayout) : undefined;
  } catch {
    return undefined;
  }
}

function persistLayout(
  connectionId: string,
  stored: StoredConnectionLayout | undefined,
) {
  if (typeof window === "undefined") {
    return;
  }
  const key = `${LAYOUT_STORAGE_PREFIX}${connectionId}`;
  try {
    if (!stored) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // Storage may be unavailable (private mode, quota); fail silently.
  }
}

function clearStoredLayouts() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(LAYOUT_STORAGE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage may be unavailable (private mode, quota); fail silently.
  }
}

function loadStoredTmuxSessionIds(connectionId: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(
      `${TMUX_SESSION_STORAGE_PREFIX}${connectionId}`,
    );
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter(isCurrentTmuxSessionId) : [];
  } catch {
    return [];
  }
}

function loadReservedPsmuxSessionIds(connectionId: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const currentConnectionKey = `${TMUX_SESSION_STORAGE_PREFIX}${connectionId}`;
  const reserved = new Set<string>();
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(TMUX_SESSION_STORAGE_PREFIX) || key === currentConnectionKey) {
        continue;
      }
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) {
        parsed.filter(isCurrentTmuxSessionId).forEach((sessionId) => reserved.add(sessionId));
      }
    }
  } catch {
    return [];
  }
  return Array.from(reserved);
}

function persistTmuxSessionIds(connectionId: string, sessionIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      `${TMUX_SESSION_STORAGE_PREFIX}${connectionId}`,
      JSON.stringify(sessionIds),
    );
  } catch {
    // Storage may be unavailable (private mode, quota); fail silently.
  }
}

function loadStoredQuickCommandBarVisible(connectionId: string | undefined) {
  if (!connectionId || typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(`${QUICK_COMMAND_BAR_STORAGE_PREFIX}${connectionId}`) === "true";
  } catch {
    return false;
  }
}

function persistQuickCommandBarVisible(connectionId: string | undefined, visible: boolean) {
  if (!connectionId || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(`${QUICK_COMMAND_BAR_STORAGE_PREFIX}${connectionId}`, visible ? "true" : "false");
  } catch {
    // Storage may be unavailable (private mode, quota); fail silently.
  }
}

function loadStoredQuickCommands(connectionId: string | undefined): QuickCommand[] {
  if (!connectionId || typeof window === "undefined") {
    return [];
  }
  try {
    const raw = readDurableUiState(`${QUICK_COMMANDS_STORAGE_PREFIX}${connectionId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter(isQuickCommand) : [];
  } catch {
    return [];
  }
}

function persistQuickCommands(connectionId: string | undefined, commands: QuickCommand[]) {
  if (!connectionId || typeof window === "undefined") {
    return;
  }
  // Quick Commands are durable per-Connection configuration: source of truth is
  // SQLite (backed up, portable), mirrored to the synchronous cache.
  writeDurableUiState(`${QUICK_COMMANDS_STORAGE_PREFIX}${connectionId}`, JSON.stringify(commands));
}

// Remove a deleted Connection's durable Quick Commands plus its local-only
// per-Connection reopen hints (layout, tmux session ids, quick-command-bar
// visibility) so they do not orphan and accumulate.
export function forgetConnectionLocalState(connectionId: string) {
  if (typeof window === "undefined") {
    return;
  }
  removeDurableUiState(`${QUICK_COMMANDS_STORAGE_PREFIX}${connectionId}`);
  try {
    window.localStorage.removeItem(`${QUICK_COMMAND_BAR_STORAGE_PREFIX}${connectionId}`);
    window.localStorage.removeItem(`${LAYOUT_STORAGE_PREFIX}${connectionId}`);
    window.localStorage.removeItem(`${TMUX_SESSION_STORAGE_PREFIX}${connectionId}`);
  } catch {
    // Storage may be unavailable; nothing durable is lost.
  }
}

function isQuickCommand(value: unknown): value is QuickCommand {
  if (!value || typeof value !== "object") {
    return false;
  }
  const command = value as Partial<QuickCommand>;
  return (
    typeof command.id === "string" &&
    typeof command.label === "string" &&
    typeof command.command === "string" &&
    typeof command.iconName === "string" &&
    typeof command.accentName === "string" &&
    typeof command.sendEnter === "boolean" &&
    typeof command.confirm === "boolean"
  );
}

function connectionUsesTmux(connection: Connection) {
  return connection.type === "ssh" && connection.useTmuxSessions !== false;
}

// psmux is the local-shell counterpart to SSH tmux: a native Windows multiplexer
// opted into per local PowerShell Connection. Both reuse the same pane session-id
// pool (ai.tmuxSessionLabels) and pane.tmuxSessionId slot, since a pane is either
// SSH-tmux or local-psmux, never both.
export function connectionUsesPsmux(connection: Connection) {
  return connection.type === "local" && connection.usePsmuxSessions === true;
}

function connectionUsesMultiplexer(connection: Connection) {
  return connectionUsesTmux(connection) || connectionUsesPsmux(connection);
}

function isRemoteDesktopConnection(connection: Connection) {
  return connection.type === "rdp" || connection.type === "vnc";
}

export function tmuxSessionIdsForConnection(connection: Connection, count: number) {
  if (!connectionUsesMultiplexer(connection)) {
    return [];
  }
  const sessionIds = loadStoredTmuxSessionIds(connection.id).slice(0, count);
  const reservedSessionIds = connectionUsesPsmux(connection)
    ? loadReservedPsmuxSessionIds(connection.id)
    : [];
  while (sessionIds.length < count) {
    sessionIds.push(generateTmuxSessionId([...sessionIds, ...reservedSessionIds]));
  }
  persistTmuxSessionIds(connection.id, sessionIds);
  return sessionIds;
}

export function appendTmuxSessionId(connection: Connection) {
  if (!connectionUsesMultiplexer(connection)) {
    return undefined;
  }
  const sessionIds = loadStoredTmuxSessionIds(connection.id);
  const reservedSessionIds = connectionUsesPsmux(connection)
    ? loadReservedPsmuxSessionIds(connection.id)
    : [];
  const sessionId = generateTmuxSessionId([...sessionIds, ...reservedSessionIds]);
  sessionIds.push(sessionId);
  persistTmuxSessionIds(connection.id, sessionIds);
  return sessionId;
}

function generateTmuxSessionId(existingSessionIds: string[]) {
  const existing = new Set(existingSessionIds);
  const namePool = tmuxSessionNamePool();

  for (let attempt = 0; attempt < namePool.length * 2; attempt += 1) {
    const candidate = randomTmuxName(namePool);
    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    for (let attempt = 0; attempt < namePool.length; attempt += 1) {
      const candidate = `${randomTmuxName(namePool)}${formatTmuxSessionNumber(suffix)}`;
      if (!existing.has(candidate)) {
        return candidate;
      }
    }
  }

  return `${randomTmuxName(namePool)}${formatTmuxSessionNumber((Date.now() % 98) + 2)}`;
}

function isCurrentTmuxSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    TMUX_SESSION_ID_PATTERN.test(value) &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  );
}

function tmuxSessionNamePool() {
  try {
    const labels = i18next.t("ai.tmuxSessionLabels", { returnObjects: true });
    if (Array.isArray(labels)) {
      const names = labels.filter((label): label is string => isCurrentTmuxSessionId(label));
      if (names.length > 0) {
        return names;
      }
    }
  } catch {
    // Fall back below.
  }
  return TMUX_SESSION_NAMES;
}

function randomTmuxName(namePool: string[]) {
  const index = randomTmuxIndex(namePool.length);
  return namePool[index] ?? "airlock";
}

function randomTmuxIndex(max: number) {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return (bytes[0] ?? 0) % max;
  }
  return Math.floor(Math.random() * max);
}

function formatTmuxSessionNumber(value: number) {
  return String(Math.max(2, value)).padStart(2, "0");
}

function buildPanesForConnection(
  connection: Connection,
  count: number,
): TerminalPane[] {
  const baseId = connection.id;
  const baseTitle = terminalPaneTitleForConnection(connection);
  const baseCwd = defaultTerminalCwdForConnection(connection);
  const tmuxSessionIds = tmuxSessionIdsForConnection(connection, count);
  const panes: TerminalPane[] = [];
  for (let index = 0; index < count; index += 1) {
    panes.push({
      id:
        index === 0
          ? `pane-${baseId}`
          : createPaneId(baseId),
      title: index === 0 ? baseTitle : `${baseTitle} ${index + 1}`,
      toolbarTitle: toolbarTitleForConnection(connection),
      cwd: baseCwd,
      buffer: "",
      connection,
      tmuxSessionId: tmuxSessionIds[index],
    });
  }
  return panes;
}

function buildPanesFromStoredLayout(
  connection: Connection,
  stored?: StoredConnectionLayout,
): WorkspacePane[] {
  const paneCount = Math.max(1, stored?.paneCount ?? 1);
  const fallback =
    connection.type === "url" ||
    isRemoteDesktopConnection(connection) ||
    connection.type === "ftp" ||
    connection.type === "localFiles" ||
    connection.type === "fileView"
      ? Array.from({ length: paneCount }, () => {
          const pane = buildPaneForConnection(connection);
          return pane ? { ...pane, id: createPaneId(connection.id) } : null;
        }).filter((pane): pane is WorkspacePane => Boolean(pane))
      : buildPanesForConnection(connection, paneCount);
  if (!stored?.panes?.length) {
    return fallback;
  }
  return Array.from({ length: paneCount }, (_, index) => {
    const fallbackPane = fallback[index] ?? buildPaneForConnection(connection);
    const storedPane = stored.panes?.[index];
    const pane = storedPane?.connection
      ? buildPaneFromStoredLayoutPane(storedPane, index)
      : fallbackPane;
    if (pane && isTerminalPane(pane) && fallbackPane && isTerminalPane(fallbackPane)) {
      const sameConnection = pane.connection?.id === fallbackPane.connection?.id;
      if (sameConnection) {
        const tmuxDisabled =
          fallbackPane.connection?.type === "ssh" &&
          fallbackPane.connection.useTmuxSessions === false;
        return {
          ...pane,
          connection: fallbackPane.connection,
          tmuxSessionId: tmuxDisabled
            ? undefined
            : pane.tmuxSessionId ?? (pane.tmuxUnavailable ? undefined : fallbackPane.tmuxSessionId),
          tmuxUnavailable: tmuxDisabled ? undefined : pane.tmuxUnavailable,
        };
      }
    }
    if (
      pane &&
      isTerminalPane(pane) &&
      !pane.tmuxSessionId &&
      !pane.tmuxUnavailable &&
      fallbackPane &&
      isTerminalPane(fallbackPane) &&
      fallbackPane.tmuxSessionId
    ) {
      return {
        ...pane,
        tmuxSessionId: fallbackPane.tmuxSessionId,
      };
    }
    return pane ?? fallbackPane;
  }).filter((pane): pane is WorkspacePane => Boolean(pane));
}

function buildPaneFromStoredLayoutPane(
  storedPane: NonNullable<StoredConnectionLayout["panes"]>[number],
  _index: number,
): WorkspacePane | null {
  const connection = storedPane.connection;
  const id = createPaneId(connection.id);
  const title = storedPane.title?.trim() || titleForConnectionPane(connection);
  const toolbarTitle = toolbarTitleForConnection(connection);

  // The stored pane.kind is authoritative for the rendered surface and must be
  // honored before any connection.type derivation. A file-browser pane reuses an
  // ssh-typed Connection — an SFTP browser opened from an SSH Connection, and an
  // sftp-protocol FTP Connection that is normalized to an ssh shape at pane
  // creation (see sftpBrowserConnectionFromFtpConnection) — so deriving the kind
  // from connection.type alone would silently rebuild SFTP as an SSH terminal.
  // See "SFTP vs SSH" in CONTEXT.md / docs/ARCHITECTURE.md.
  if (storedPane.kind === "sftp" || storedPane.kind === "localFiles") {
    return {
      kind: storedPane.kind,
      id,
      title,
      toolbarTitle,
      connection:
        storedPane.kind === "sftp" && connection.type === "ftp"
          ? sftpBrowserConnectionFromFtpConnection(connection)
          : connection,
    };
  }

  if (connection.type === "url") {
    if (!connection.url) {
      return null;
    }
    return {
      kind: "webview",
      id,
      title,
      toolbarTitle,
      connection,
      url: storedPane.url?.trim() || connection.url,
      dataPartition: storedPane.dataPartition ?? connection.dataPartition,
    };
  }
  if (isRemoteDesktopConnection(connection)) {
    return {
      kind: "remoteDesktop",
      id,
      title,
      toolbarTitle,
      connection,
    };
  }
  if (connection.type === "ftp") {
    const isSftpProtocol = connection.ftpOptions?.protocol === "sftp";
    return {
      kind: isSftpProtocol ? "sftp" : "ftp",
      id,
      title,
      toolbarTitle,
      connection: isSftpProtocol
        ? sftpBrowserConnectionFromFtpConnection(connection)
        : connection,
    };
  }
  if (storedPane.kind === "fileViewer" || connection.type === "fileView") {
    return {
      kind: "fileViewer",
      id,
      title,
      toolbarTitle,
      connection,
    };
  }
  if (connection.type === "localFiles") {
    return {
      kind: "localFiles",
      id,
      title,
      toolbarTitle,
      connection,
    };
  }
  return {
    kind: "terminal",
    id,
    title,
    toolbarTitle,
    cwd: storedPane.cwd?.trim() || defaultTerminalCwdForConnection(connection),
    buffer: "",
    connection,
    fontSize: storedPane.fontSize,
    textEncoding: storedPane.textEncoding,
    terminalBackground: storedPane.terminalBackground,
    tmuxSessionId: storedPane.tmuxSessionId,
  };
}

function titleForConnectionPane(connection: Connection) {
  if (connection.type === "url") {
    return connection.name;
  }
  if (isRemoteDesktopConnection(connection)) {
    return connection.name;
  }
  if (connection.type === "localFiles" || connection.type === "fileView") {
    return connection.name;
  }
  return terminalPaneTitleForConnection(connection);
}

function toolbarTitleForConnection(connection: Connection) {
  if (connection.type === "url") {
    return connection.name;
  }
  if (connection.type === "serial") {
    return connection.serialLine?.trim() || connection.host || connection.name;
  }
  if (connection.type === "local") {
    return localTerminalToolbarTitle(connection);
  }
  if (connection.type === "localFiles") {
    return connection.name;
  }
  if (connection.type === "fileView") {
    return connection.name;
  }
  return formatConnectionAddress(connection);
}

function fileNameFromPath(path: string) {
  const normalized = path.trim().replace(/[\\/]+$/u, "");
  return normalized.split(/[\\/]/u).pop()?.trim() ?? "";
}

function stableIdFromPath(path: string) {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function localTerminalToolbarTitle(connection: Connection) {
  return connection.name;
}

function terminalPaneTitleForConnection(connection: Connection) {
  switch (connection.type) {
    case "local":
      return connection.name;
    case "telnet":
      return "telnet";
    case "serial":
      return "serial";
    case "ssh":
    default:
      return "ssh";
  }
}

type ConnectionPaneOptions = {
  childConnectionId?: string;
  cwd?: string;
  iconColor?: string | null;
  iconBackgroundColor?: string | null;
  iconDataUrl?: string | null;
  fontSize?: number;
  textEncoding?: string;
  terminalOpacity?: number | null;
  terminalBackground?: TerminalPane["terminalBackground"];
  title?: string;
  toolbarTitle?: string;
  tmuxSessionId?: string;
};

function connectionWithPaneOptions(
  connection: Connection,
  options?: ConnectionPaneOptions,
): Connection {
  if (
    !options ||
    (
      options.iconDataUrl === undefined &&
      options.iconColor === undefined &&
      options.iconBackgroundColor === undefined &&
      options.terminalOpacity === undefined &&
      options.terminalBackground === undefined
    )
  ) {
    return connection;
  }
  return {
    ...connection,
    iconColor: options.iconColor ?? connection.iconColor,
    iconBackgroundColor: options.iconBackgroundColor ?? connection.iconBackgroundColor,
    iconDataUrl: options.iconDataUrl ?? connection.iconDataUrl,
    terminalOpacity:
      options.terminalOpacity !== undefined
        ? options.terminalOpacity
        : connection.terminalOpacity,
    terminalBackground:
      options.terminalBackground !== undefined
        ? options.terminalBackground
        : connection.terminalBackground,
  };
}

function buildPaneForConnection(
  connection: Connection,
  focusedPane?: WorkspacePane,
  options?: ConnectionPaneOptions,
): WorkspacePane | null {
  if (connection.type === "url") {
    if (!connection.url) {
      return null;
    }
    return {
      kind: "webview",
      id: createPaneId(connection.id),
      childConnectionId: options?.childConnectionId,
      title: titleForConnectionPane(connection),
      toolbarTitle: options?.toolbarTitle ?? toolbarTitleForConnection(connection),
      connection,
      url: connection.url,
      dataPartition: connection.dataPartition,
    };
  }

  if (isRemoteDesktopConnection(connection)) {
    return {
      kind: "remoteDesktop",
      id: createPaneId(connection.id),
      childConnectionId: options?.childConnectionId,
      title: titleForConnectionPane(connection),
      toolbarTitle: options?.toolbarTitle ?? toolbarTitleForConnection(connection),
      connection,
    };
  }

  if (connection.type === "ftp") {
    const isSftpProtocol = connection.ftpOptions?.protocol === "sftp";
    const fileConnection = isSftpProtocol
      ? sftpBrowserConnectionFromFtpConnection(connection)
      : connection;
    return {
      kind: isSftpProtocol ? "sftp" : "ftp",
      id: createPaneId(connection.id),
      childConnectionId: options?.childConnectionId,
      title: options?.title ?? `${connection.name} ${connection.ftpOptions?.protocol?.toUpperCase() ?? "FTP"}`,
      toolbarTitle: options?.toolbarTitle ?? toolbarTitleForConnection(fileConnection),
      connection: fileConnection,
    };
  }

  if (connection.type === "localFiles") {
    return {
      kind: "localFiles",
      id: createPaneId(connection.id),
      childConnectionId: options?.childConnectionId,
      title: options?.title ?? connection.name,
      toolbarTitle: options?.toolbarTitle ?? toolbarTitleForConnection(connection),
      connection,
    };
  }

  if (connection.type === "fileView") {
    return {
      kind: "fileViewer",
      id: createPaneId(connection.id),
      childConnectionId: options?.childConnectionId,
      title: options?.title ?? connection.name,
      toolbarTitle: options?.toolbarTitle ?? toolbarTitleForConnection(connection),
      connection,
    };
  }

  return {
    kind: "terminal",
    id: createPaneId(connection.id),
    childConnectionId: options?.childConnectionId,
    title: options?.title ?? titleForConnectionPane(connection),
    toolbarTitle: options?.toolbarTitle ?? toolbarTitleForConnection(connection),
    cwd: options?.cwd?.trim() || inheritedTerminalCwdForConnection(connection, focusedPane),
    buffer: "",
    fontSize: options?.fontSize,
    textEncoding: options?.textEncoding,
    connection: options?.terminalOpacity !== undefined || options?.terminalBackground !== undefined
      ? {
          ...connection,
          terminalOpacity: options.terminalOpacity !== undefined
            ? options.terminalOpacity
            : connection.terminalOpacity,
          terminalBackground: options.terminalBackground !== undefined
            ? options.terminalBackground
            : connection.terminalBackground,
        }
      : connection,
    terminalBackground: options?.terminalBackground,
    tmuxSessionId: options?.tmuxSessionId ?? appendTmuxSessionId(connection),
  };
}

function buildPaneForStandaloneTab(tab: WorkspaceTab): WorkspacePane | null {
  if (!tab.connection) {
    return null;
  }
  if (tab.kind === "webview" && tab.url) {
    return {
      kind: "webview",
      id: tab.id,
      title: tab.title,
      toolbarTitle: tab.toolbarTitle ?? toolbarTitleForConnection(tab.connection),
      connection: tab.connection,
      url: tab.url,
      dataPartition: tab.dataPartition,
    };
  }
  if (tab.kind === "remoteDesktop") {
    return {
      kind: "remoteDesktop",
      id: tab.id,
      title: tab.title,
      toolbarTitle: tab.toolbarTitle ?? toolbarTitleForConnection(tab.connection),
      connection: tab.connection,
    };
  }
  if (tab.kind === "sftp" || tab.kind === "ftp" || tab.kind === "localFiles") {
    return {
      kind: tab.kind,
      id: tab.id,
      title: tab.title,
      toolbarTitle: tab.toolbarTitle ?? toolbarTitleForConnection(tab.connection),
      connection: tab.connection,
    };
  }
  if (tab.kind === "fileViewer") {
    return {
      kind: "fileViewer",
      id: tab.id,
      title: tab.title,
      toolbarTitle: tab.toolbarTitle ?? toolbarTitleForConnection(tab.connection),
      connection: tab.connection,
    };
  }
  return null;
}

function connectionForChild(connection: Connection, child: WorkspaceChildConnection): Connection {
  const fileViewPath = child.fileViewPath?.trim();
  if (fileViewPath) {
    return {
      id: `inline-file-view-${stableIdFromPath(fileViewPath)}`,
      name: child.name,
      host: "localhost",
      user: "",
      localStartupDirectory: fileViewPath,
      iconColor: child.iconColor ?? connection.iconColor,
      iconBackgroundColor: child.iconBackgroundColor ?? connection.iconBackgroundColor,
      iconDataUrl: child.iconDataUrl ?? connection.iconDataUrl,
      type: "fileView",
      status: "idle",
    };
  }
  return {
    ...connection,
    iconColor: child.iconColor ?? connection.iconColor,
    iconBackgroundColor: child.iconBackgroundColor ?? connection.iconBackgroundColor,
    iconDataUrl: child.iconDataUrl ?? connection.iconDataUrl,
    terminalOpacity: child.terminalOpacity !== undefined
      ? child.terminalOpacity
      : connection.terminalOpacity,
    terminalBackground: child.terminalBackground !== undefined
      ? child.terminalBackground
      : connection.terminalBackground,
  };
}

function layoutForChildPanes(panes: WorkspacePane[]): LayoutNode | undefined {
  if (panes.length <= 2) {
    return defaultLayoutFor(panes);
  }
  const leaf = (pane: WorkspacePane): LayoutNode => ({ type: "leaf", paneId: pane.id });
  if (panes.length === 3) {
    return {
      type: "split",
      orientation: "vertical",
      children: [
        {
          type: "split",
          orientation: "horizontal",
          children: [leaf(panes[0]!), leaf(panes[1]!)],
        },
        leaf(panes[2]!),
      ],
    };
  }
  const columns = Math.ceil(Math.sqrt(panes.length));
  const rows: LayoutNode[] = [];
  for (let index = 0; index < panes.length; index += columns) {
    const rowPanes = panes.slice(index, index + columns);
    rows.push(
      rowPanes.length === 1
        ? leaf(rowPanes[0]!)
        : {
            type: "split",
            orientation: "horizontal",
            children: rowPanes.map(leaf),
          },
    );
  }
  return rows.length === 1
    ? rows[0]
    : { type: "split", orientation: "vertical", children: rows };
}

function createPaneId(connectionId: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `pane-${connectionId}-${suffix}`;
}

function createConnectionTabId(connectionId: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `tab-${connectionId}-${suffix}`;
}

function localFilesBrowserChildId(connectionId: string) {
  return `child-${connectionId}-localFiles-browser`;
}

function fileViewerChildId(connectionId: string, filePath: string) {
  return `child-${connectionId}-fileView-${stableIdFromPath(filePath)}`;
}

function upsertStoredChildConnections(children: WorkspaceChildConnection[]) {
  const stored = loadStoredChildConnections();
  const next = [...stored];
  const upserted: WorkspaceChildConnection[] = [];

  for (const child of children) {
    const index = next.findIndex((entry) => entry.id === child.id);
    const merged =
      index >= 0
        ? {
            ...child,
            ...next[index],
            parentConnectionId: child.parentConnectionId,
            workspaceId: next[index]?.workspaceId ?? child.workspaceId,
            fileViewPath: child.fileViewPath ?? next[index]?.fileViewPath,
          }
        : child;
    if (index >= 0) {
      next[index] = merged;
    } else {
      next.push(merged);
    }
    upserted.push(merged);
  }

  persistStoredChildConnections(next);
  notifyStoredChildConnectionsUpdated();
  return upserted;
}

function defaultTerminalCwdForConnection(connection: Connection) {
  if (connection.type === "local") {
    return connection.localStartupDirectory?.trim() || ".";
  }
  return "~";
}

function inheritedTerminalCwdForConnection(
  connection: Connection,
  focusedPane?: WorkspacePane,
) {
  if (
    focusedPane &&
    "cwd" in focusedPane &&
    focusedPane.connection?.id === connection.id
  ) {
    return focusedPane.cwd;
  }

  return defaultTerminalCwdForConnection(connection);
}

function isTerminalPane(pane: WorkspacePane): pane is TerminalPane {
  return pane.kind === undefined || pane.kind === "terminal";
}

function refreshTerminalPaneConnection(
  pane: TerminalPane,
  connection: Connection,
  toolbarTitle = toolbarTitleForConnection(connection),
): TerminalPane {
  const tmuxDisabled =
    (connection.type === "ssh" && connection.useTmuxSessions === false) ||
    (connection.type === "local" && connection.usePsmuxSessions !== true);
  return {
    ...pane,
    connection,
    title: refreshedPaneTitle(pane, connection),
    toolbarTitle,
    tmuxSessionId: tmuxDisabled ? undefined : pane.tmuxSessionId,
    tmuxUnavailable: tmuxDisabled ? undefined : pane.tmuxUnavailable,
  };
}

function refreshChildPaneConnection(
  pane: TerminalPane,
  parentBefore: Connection | undefined,
  parentAfter: Connection,
): Connection {
  const current = pane.connection;
  if (!current || !pane.childConnectionId) {
    return parentAfter;
  }
  return {
    ...parentAfter,
    iconColor:
      current.iconColor !== parentBefore?.iconColor
        ? current.iconColor
        : parentAfter.iconColor,
    iconBackgroundColor:
      current.iconBackgroundColor !== parentBefore?.iconBackgroundColor
        ? current.iconBackgroundColor
        : parentAfter.iconBackgroundColor,
    iconDataUrl:
      current.iconDataUrl !== parentBefore?.iconDataUrl
        ? current.iconDataUrl
        : parentAfter.iconDataUrl,
    terminalOpacity: current.terminalOpacity,
    terminalBackground: current.terminalBackground,
  };
}

function urlConnectionIdsForTab(tab: WorkspaceTab) {
  if (tab.kind === "webview" && tab.connection?.type === "url") {
    return [tab.connection.id];
  }
  return tab.panes.flatMap((pane) =>
    pane.kind === "webview" && pane.connection.type === "url"
      ? [pane.connection.id]
      : [],
  );
}

function incrementActiveSessionCounts(
  activeSessionCounts: Record<string, number>,
  connectionIds: string[],
) {
  if (connectionIds.length === 0) {
    return activeSessionCounts;
  }
  const nextCounts = { ...activeSessionCounts };
  connectionIds.forEach((connectionId) => {
    nextCounts[connectionId] = (nextCounts[connectionId] ?? 0) + 1;
  });
  return nextCounts;
}

function decrementActiveSessionCounts(
  activeSessionCounts: Record<string, number>,
  connectionIds: string[],
) {
  if (connectionIds.length === 0) {
    return activeSessionCounts;
  }
  const nextCounts = { ...activeSessionCounts };
  connectionIds.forEach((connectionId) => {
    const currentCount = nextCounts[connectionId] ?? 0;
    if (currentCount <= 1) {
      delete nextCounts[connectionId];
      return;
    }
    nextCounts[connectionId] = currentCount - 1;
  });
  return nextCounts;
}

function emitChildConnectionClosed(childConnectionId: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(CHILD_CONNECTION_CLOSED_EVENT, {
      detail: { childConnectionId },
    }),
  );
}

/** Stable id of the seeded, permanent Default Workspace (mirrors the Rust side). */
export const DEFAULT_WORKSPACE_ID = "default";

const ACTIVE_WORKSPACE_STORAGE_KEY = "kkterm.activeWorkspaceId";

function loadStoredActiveWorkspaceId(): string {
  if (typeof window === "undefined") {
    return DEFAULT_WORKSPACE_ID;
  }
  try {
    return (
      window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) ?? DEFAULT_WORKSPACE_ID
    );
  } catch {
    return DEFAULT_WORKSPACE_ID;
  }
}

function persistActiveWorkspaceId(workspaceId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
  } catch {
    // Active Workspace is a convenience preference; ignore storage failures.
  }
}

function tabWorkspaceId(tab: Pick<WorkspaceTab, "workspaceId"> | undefined) {
  return tab?.workspaceId ?? DEFAULT_WORKSPACE_ID;
}

function firstTabIdForWorkspace(tabs: WorkspaceTab[], workspaceId: string) {
  return tabs.find((tab) => tabWorkspaceId(tab) === workspaceId)?.id ?? "";
}

function tabIdForWorkspace(
  tabs: WorkspaceTab[],
  workspaceId: string,
  preferredTabId: string | undefined,
) {
  const preferredTab = preferredTabId
    ? tabs.find((tab) => tab.id === preferredTabId)
    : undefined;
  return tabWorkspaceId(preferredTab) === workspaceId
    ? preferredTab?.id ?? ""
    : firstTabIdForWorkspace(tabs, workspaceId);
}

interface WorkspaceState {
  query: string;
  tabs: WorkspaceTab[];
  activeTabId: string;
  activeWorkspaceId: string;
  activeTabIdsByWorkspace: Record<string, string>;
  workspaces: Workspace[];
  generalSettings: GeneralSettings;
  credentialSettings: CredentialSettings;
  dashboardSettings: DashboardSettings;
  terminalSettings: TerminalSettings;
  appearanceSettings: AppearanceSettings;
  sshSettings: SshSettings;
  sftpSettings: SftpSettings;
  urlSettings: UrlSettings;
  rdpSettings: RdpSettings;
  vncSettings: VncSettings;
  aiProviderSettings: AiProviderSettings;
  aiProviderHasApiKey: boolean;
  assistantWorking: boolean;
  // Runtime-only (never persisted): when true, keystrokes typed into the focused
  // terminal pane are mirrored to every other open terminal pane.
  syncInputEnabled: boolean;
  assistantContextSnippet?: AssistantContextSnippet;
  assistantDirectSubmitRequest?: AssistantDirectSubmitRequest;
  rdpPreCaptureSignal: number;
  activeSessionCounts: Record<string, number>;
  performanceMetrics: PerformanceMetrics;
  statusBarNotice?: StatusBarNotice;
  localTerminalPopup?: WorkspaceTab;
  /** App-global Terminal recordings browser. A Connection id is present only
   * when the browser was opened from that Connection's tree context menu. */
  terminalRecordingsBrowser?: {
    initialConnectionId?: string;
    initialRecordingPath?: string;
    requestId: number;
  };
  /** Open Git Browser overlay target (repo root + label); undefined when closed. */
  gitBrowser?: GitBrowserTarget;
  /** App-global "left file" remembered for File Compare; undefined when none picked. */
  compareLeft?: CompareEndpoint;
  /** Open File Compare overlay (left + right endpoints); undefined when closed. */
  compareView?: CompareView;
  /** Open Folder Compare overlay (two local folder endpoints); undefined when closed. */
  folderCompareView?: CompareView;
  /** DOM node in the global Status Bar that the active Document Connection portals
   * its status segments into. Set by `StatusBar`; null when the bar is hidden. */
  documentStatusSlot: HTMLElement | null;
  quickCommandsByConnection: Record<string, QuickCommand[]>;
  setQuery: (query: string) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setActiveWorkspace: (workspaceId: string) => void;
  closeWorkspaceTabs: (workspaceId: string, fallbackWorkspaceId?: string) => void;
  setGeneralSettings: (settings: GeneralSettings) => void;
  setCredentialSettings: (settings: CredentialSettings) => void;
  setDashboardSettings: (settings: DashboardSettings) => void;
  setTerminalSettings: (settings: TerminalSettings) => void;
  setAppearanceSettings: (settings: AppearanceSettings) => void;
  setSshSettings: (settings: SshSettings) => void;
  setSftpSettings: (settings: SftpSettings) => void;
  setUrlSettings: (settings: UrlSettings) => void;
  setRdpSettings: (settings: RdpSettings) => void;
  setVncSettings: (settings: VncSettings) => void;
  setAiProviderSettings: (settings: AiProviderSettings) => void;
  setAiProviderHasApiKey: (hasApiKey: boolean) => void;
  setAssistantWorking: (assistantWorking: boolean) => void;
  setSyncInputEnabled: (syncInputEnabled: boolean) => void;
  setAssistantContextSnippet: (snippet: AssistantContextSnippet) => void;
  submitAssistantContextSnippet: (snippet: AssistantContextSnippet, prompt: string) => void;
  clearAssistantContextSnippet: () => void;
  clearAssistantDirectSubmitRequest: (id: string) => void;
  requestRdpPreCapture: () => void;
  setFrontendLaunchMs: (frontendLaunchMs: number) => void;
  setPerformanceSnapshot: (snapshot: PerformanceSnapshot) => void;
  setHostUsageSnapshot: (snapshot: HostUsageSnapshot) => void;
  recordTerminalStartMetric: (metric: TerminalStartMetric) => void;
  clearTerminalStartMetric: (kind: TerminalStartMetric["kind"]) => void;
  showStatusBarNotice: (
    message: string,
    options?: { tone?: StatusBarNotice["tone"]; durationMs?: number },
  ) => void;
  showStatusBarProgress: (
    message: string,
    options?: { progress?: number; cancelLabel?: string; onCancel?: () => void },
  ) => number;
  updateStatusBarProgress: (id: number, progress: number) => void;
  clearStatusBarNotice: (id: number) => void;
  setDocumentStatusSlot: (slot: HTMLElement | null) => void;
  activateTab: (tabId: string) => void;
  renameTab: (tabId: string, title: string) => Promise<void>;
  closeTab: (tabId: string) => void;
  openConnection: (connection: Connection) => void;
  openConnectionInNewTab: (
    connection: Connection,
    options?: {
      childConnectionId?: string;
      cwd?: string;
      iconColor?: string | null;
      iconBackgroundColor?: string | null;
      iconDataUrl?: string | null;
      fontSize?: number;
      textEncoding?: string;
      terminalOpacity?: number | null;
      terminalBackground?: TerminalPane["terminalBackground"];
      title?: string;
      toolbarTitle?: string;
      tmuxSessionId?: string;
    },
  ) => void;
  openUrlInNewTab: (
    connection: Connection,
    url: string,
    options?: { title?: string; subtitle?: string },
  ) => void;
  openChildConnectionInNewTab: (
    connection: Connection,
    child: WorkspaceChildConnection,
  ) => void;
  openChildConnectionLayout: (
    connection: Connection,
    children: WorkspaceChildConnection[],
  ) => void;
  openConnectionsInPanorama: (
    connections: Connection[],
    options?: { title?: string },
  ) => void;
  updateOpenChildConnectionMetadata: (child: WorkspaceChildConnection) => void;
  openUrlConnection: (connection: Connection) => void;
  openSshPortForwardBrowser: (
    sourceConnection: Connection,
    forward: { forwardId: string; localPort: number; remotePort: number; url: string },
  ) => void;
  openRemoteDesktopConnection: (connection: Connection) => void;
  openSftpBrowser: (connection: Connection) => void;
  openSftpBrowserInNewTab: (connection: Connection) => void;
  openFtpBrowser: (connection: Connection) => void;
  openLocalFilesBrowser: (connection: Connection) => void;
  openFileViewer: (connection: Connection) => void;
  openFileViewerPath: (path: string, options?: { sourceConnection?: Connection }) => void;
  openTerminalHere: (connection: Connection, remotePath: string) => void;
  openLocalTerminal: (options?: { name?: string; shell?: string }) => void;
  openLocalTerminalHere: (cwd: string, options?: { name?: string; shell?: string }) => void;
  closeLocalTerminalPopup: () => void;
  openTerminalRecordingsBrowser: (
    initialConnectionId?: string,
    initialRecordingPath?: string,
  ) => void;
  closeTerminalRecordingsBrowser: () => void;
  openGitBrowser: (repoRoot: string, label: string) => void;
  closeGitBrowser: () => void;
  setCompareLeft: (endpoint: CompareEndpoint) => void;
  clearCompareLeft: () => void;
  openCompareView: (left: CompareEndpoint, right: CompareEndpoint) => void;
  closeCompareView: () => void;
  openFolderCompareView: (left: CompareEndpoint, right: CompareEndpoint) => void;
  closeFolderCompareView: () => void;
  openElevatedLocalTerminal: (option: LocalShellOption, options?: { cwd?: string }) => Promise<void>;
  splitTerminalPane: (tabId: string) => void;
  splitTerminalPaneDirected: (tabId: string, direction: SplitDirection) => void;
  addConnectionToTerminalPane: (
    tabId: string,
    connection: Connection,
    direction: SplitDirection,
    targetPaneId?: string,
    options?: ConnectionPaneOptions,
  ) => void;
  closePane: (tabId: string, paneId: string) => void;
  closeChildConnection: (childConnectionId: string) => void;
  maximizeChildConnectionPane: (tabId: string, paneId: string) => void;
  updatePaneCwd: (tabId: string, paneId: string, cwd: string) => void;
  setQuickCommandBarVisible: (tabId: string, visible: boolean) => void;
  ensureQuickCommandsLoaded: (connectionId: string | undefined) => void;
  addQuickCommand: (connectionId: string | undefined, command: QuickCommand) => void;
  updateQuickCommand: (connectionId: string | undefined, command: QuickCommand) => void;
  moveQuickCommand: (connectionId: string | undefined, commandId: string, direction: -1 | 1) => void;
  reorderQuickCommand: (
    connectionId: string | undefined,
    commandId: string,
    targetCommandId: string,
  ) => void;
  removeQuickCommand: (connectionId: string | undefined, commandId: string) => void;
  openTmuxSessionInPane: (
    tabId: string,
    connection: Connection,
    tmuxSessionId: string,
    direction: SplitDirection,
  ) => void;
  renameTmuxSessionInOpenPanes: (
    connectionId: string,
    previousSessionId: string,
    nextSessionId: string,
  ) => void;
  setFocusedPane: (tabId: string, paneId: string) => void;
  saveTabLayout: (tabId: string) => void;
  resetTabLayout: (tabId: string) => void;
  saveConnectionLayout: (connectionId: string) => void;
  resetConnectionLayout: (connectionId: string) => void;
  resetAllLayouts: () => void;
  updateWebviewTabMetadata: (
    tabId: string,
    metadata: { title?: string; subtitle?: string; url?: string },
  ) => void;
  refreshOpenConnectionMetadata: (connection: Connection) => void;
  updateOpenConnectionTerminalAppearance: (connectionId: string, appearance: Pick<Connection, "terminalOpacity" | "terminalBackground">) => void;
  updateOpenConnectionTerminalColorScheme: (connectionId: string, terminalColorScheme: string | null) => void;
  updateOpenConnectionFileBrowserViewOptions: (connectionId: string, fileBrowserViewOptions: Connection["fileBrowserViewOptions"]) => void;
  updateOpenTerminalPaneAppearance: (tabId: string, paneId: string, appearance: Pick<Connection, "terminalOpacity" | "terminalBackground">) => void;
  updateOpenTerminalPaneFontSize: (tabId: string, paneId: string, fontSize: number) => void;
  updateOpenTerminalPaneTextEncoding: (tabId: string, paneId: string, textEncoding: string) => void;
  updateOpenTerminalPaneBackground: (tabId: string, paneId: string, terminalBackground: TerminalPane["terminalBackground"]) => void;
  updateOpenTerminalPaneX11ForwardingStatus: (
    tabId: string,
    paneId: string,
    status: TerminalPane["x11ForwardingStatus"],
  ) => void;
  setOpenTerminalPaneSshForwardFailures: (
    tabId: string,
    paneId: string,
    failedForwardIds: string[],
  ) => void;
  markOpenTerminalPaneTmuxUnavailable: (tabId: string, paneId: string) => void;
  markConnectionSessionStarted: (connectionId: string) => void;
  markConnectionSessionEnded: (connectionId: string) => void;
  closeAllTabs: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  query: "",
  tabs: initialTabs,
  activeTabId: initialTabs[0]?.id ?? "",
  activeWorkspaceId: loadStoredActiveWorkspaceId(),
  activeTabIdsByWorkspace: initialTabs[0]
    ? { [tabWorkspaceId(initialTabs[0])]: initialTabs[0].id }
    : {},
  workspaces: [],
  generalSettings: defaultGeneralSettings,
  credentialSettings: defaultCredentialSettings,
  dashboardSettings: defaultDashboardSettings,
  terminalSettings: defaultTerminalSettings,
  appearanceSettings: defaultAppearanceSettings,
  sshSettings: defaultSshSettings,
  sftpSettings: defaultSftpSettings,
  urlSettings: defaultUrlSettings,
  rdpSettings: defaultRdpSettings,
  vncSettings: defaultVncSettings,
  aiProviderSettings: defaultAiProviderSettings,
  aiProviderHasApiKey: false,
  assistantWorking: false,
  syncInputEnabled: false,
  assistantContextSnippet: undefined,
  assistantDirectSubmitRequest: undefined,
  rdpPreCaptureSignal: 0,
  activeSessionCounts: {},
  performanceMetrics: {},
  statusBarNotice: undefined,
  terminalRecordingsBrowser: undefined,
  documentStatusSlot: null,
  quickCommandsByConnection: {},
  setQuery: (query) => set({ query }),
  setWorkspaces: (workspaces) => {
    const { activeWorkspaceId } = get();
    // If the active Workspace was deleted elsewhere, fall back to Default.
    const stillExists = workspaces.some(
      (workspace) => workspace.id === activeWorkspaceId,
    );
    if (!stillExists && workspaces.length > 0) {
      const fallbackId =
        workspaces.find((workspace) => workspace.isDefault)?.id ??
        workspaces[0].id;
      persistActiveWorkspaceId(fallbackId);
      set({
        workspaces,
        activeWorkspaceId: fallbackId,
        activeTabId: tabIdForWorkspace(
          get().tabs,
          fallbackId,
          get().activeTabIdsByWorkspace[fallbackId],
        ),
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
      }
      return;
    }
    set({ workspaces });
  },
  setActiveWorkspace: (workspaceId) => {
    if (get().activeWorkspaceId === workspaceId) {
      return;
    }
    persistActiveWorkspaceId(workspaceId);
    const state = get();
    const activeTabIdsByWorkspace = {
      ...state.activeTabIdsByWorkspace,
      [state.activeWorkspaceId]: state.activeTabId,
    };
    set({
      activeWorkspaceId: workspaceId,
      activeTabId: tabIdForWorkspace(
        state.tabs,
        workspaceId,
        activeTabIdsByWorkspace[workspaceId],
      ),
      activeTabIdsByWorkspace,
    });
    // The Connection Tree, rail, and sidebar all re-read the active Workspace's
    // tree off this shared invalidation event.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
    }
  },
  closeWorkspaceTabs: (workspaceId, fallbackWorkspaceId = DEFAULT_WORKSPACE_ID) => {
    const closingTabs = get().tabs.filter(
      (tab) => tabWorkspaceId(tab) === workspaceId,
    );
    if (closingTabs.length === 0 && get().activeWorkspaceId !== workspaceId) {
      return;
    }
    const remainingTabs = get().tabs.filter(
      (tab) => tabWorkspaceId(tab) !== workspaceId,
    );
    const nextActiveWorkspaceId =
      get().activeWorkspaceId === workspaceId
        ? fallbackWorkspaceId
        : get().activeWorkspaceId;
    const activeTabStillOpen = remainingTabs.some(
      (tab) => tab.id === get().activeTabId,
    );
    const nextActiveTabId = activeTabStillOpen
      ? get().activeTabId
      : tabIdForWorkspace(
          remainingTabs,
          nextActiveWorkspaceId,
          get().activeTabIdsByWorkspace[nextActiveWorkspaceId],
        );

    if (nextActiveWorkspaceId !== get().activeWorkspaceId) {
      persistActiveWorkspaceId(nextActiveWorkspaceId);
    }
    set((state) => ({
      tabs: remainingTabs,
      activeWorkspaceId: nextActiveWorkspaceId,
      activeTabId: nextActiveTabId,
      syncInputEnabled:
        state.syncInputEnabled && closingTabs.some((tab) => tab.panes.some(isTerminalPane))
          ? false
          : state.syncInputEnabled,
      activeSessionCounts: decrementActiveSessionCounts(
        state.activeSessionCounts,
        closingTabs.flatMap(urlConnectionIdsForTab),
      ),
    }));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
    }
  },
  setGeneralSettings: (generalSettings) => set({ generalSettings }),
  setCredentialSettings: (credentialSettings) => set({ credentialSettings }),
  setDashboardSettings: (dashboardSettings) => set({ dashboardSettings }),
  setTerminalSettings: (terminalSettings) => set({ terminalSettings }),
  setAppearanceSettings: (appearanceSettings) => set({ appearanceSettings }),
  setSshSettings: (sshSettings) => set({ sshSettings }),
  setSftpSettings: (sftpSettings) => set({ sftpSettings }),
  setUrlSettings: (urlSettings) => set({ urlSettings }),
  setRdpSettings: (rdpSettings) => set({ rdpSettings }),
  setVncSettings: (vncSettings) => set({ vncSettings }),
  setAiProviderSettings: (aiProviderSettings) => set({ aiProviderSettings }),
  setAiProviderHasApiKey: (aiProviderHasApiKey) => set({ aiProviderHasApiKey }),
  setAssistantWorking: (assistantWorking) => set({ assistantWorking }),
  setSyncInputEnabled: (syncInputEnabled) => set({ syncInputEnabled }),
  setAssistantContextSnippet: (assistantContextSnippet) =>
    set({ assistantContextSnippet }),
  submitAssistantContextSnippet: (snippet, prompt) =>
    set({
      assistantDirectSubmitRequest: {
        id: `assistant-direct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prompt,
        snippet,
      },
    }),
  clearAssistantContextSnippet: () =>
    set({ assistantContextSnippet: undefined }),
  clearAssistantDirectSubmitRequest: (id) =>
    set((state) =>
      state.assistantDirectSubmitRequest?.id === id
        ? { assistantDirectSubmitRequest: undefined }
        : {},
    ),
  requestRdpPreCapture: () =>
    set((state) => ({ rdpPreCaptureSignal: state.rdpPreCaptureSignal + 1 })),
  setFrontendLaunchMs: (frontendLaunchMs) =>
    set((state) => ({
      performanceMetrics: {
        ...state.performanceMetrics,
        frontendLaunchMs,
      },
    })),
  setPerformanceSnapshot: (snapshot) =>
    set((state) => ({
      performanceMetrics: {
        ...state.performanceMetrics,
        backendUptimeMs: snapshot.uptimeMs,
        workingSetBytes: snapshot.workingSetBytes,
        memorySource: snapshot.memorySource,
        ...(snapshot.lastSshTerminalReadyMs === undefined
          ? {}
          : {
              lastSshTerminalStart: {
                kind: "ssh",
                title: "Native SSH terminal",
                durationMs: snapshot.lastSshTerminalReadyMs,
                recordedAt: snapshot.lastSshTerminalReadyAtUnixSeconds
                  ? new Date(
                      snapshot.lastSshTerminalReadyAtUnixSeconds * 1000,
                    ).toISOString()
                  : new Date().toISOString(),
              },
            }),
      },
    })),
  setHostUsageSnapshot: (snapshot) =>
    set((state) => ({
      performanceMetrics: {
        ...state.performanceMetrics,
        hostUsage: snapshot,
      },
    })),
  recordTerminalStartMetric: (lastTerminalStart) =>
    set((state) => ({
      performanceMetrics: {
        ...state.performanceMetrics,
        lastTerminalStart,
        ...(lastTerminalStart.kind === "local"
          ? { lastLocalTerminalStart: lastTerminalStart }
          : {}),
        ...(lastTerminalStart.kind === "ssh"
          ? { lastSshTerminalStart: lastTerminalStart }
          : {}),
      },
    })),
  clearTerminalStartMetric: (kind) =>
    set((state) => ({
      performanceMetrics: {
        ...state.performanceMetrics,
        ...(kind === "local" ? { lastLocalTerminalStart: undefined } : {}),
        ...(kind === "ssh" ? { lastSshTerminalStart: undefined } : {}),
      },
    })),
  showStatusBarNotice: (message, options) => {
    const tone = options?.tone ?? "info";
    const durationMs = options?.durationMs ?? DEFAULT_STATUS_BAR_NOTICE_DURATION_MS[tone];
    const now = Date.now();
    set({
      statusBarNotice: {
        id: (statusBarNoticeSequence += 1),
        message,
        tone,
        durationMs,
        expiresAt: tone === "error" ? null : now + durationMs,
      },
    });
  },
  showStatusBarProgress: (message, options) => {
    const id = (statusBarNoticeSequence += 1);
    set({
      statusBarNotice: {
        id,
        message,
        tone: "info",
        durationMs: 0,
        expiresAt: null,
        progress: Math.max(0, Math.min(100, options?.progress ?? 0)),
        cancelLabel: options?.cancelLabel,
        onCancel: options?.onCancel,
      },
    });
    return id;
  },
  updateStatusBarProgress: (id, progress) =>
    set((state) =>
      state.statusBarNotice?.id === id && state.statusBarNotice.progress !== undefined
        ? (() => {
            const nextProgress = Math.max(0, Math.min(100, progress));
            return {
              statusBarNotice: {
                ...state.statusBarNotice,
                progress: nextProgress,
                ...(nextProgress === 100 ? { cancelLabel: undefined, onCancel: undefined } : {}),
              },
            };
          })()
        : {},
    ),
  clearStatusBarNotice: (id) =>
    set((state) =>
      state.statusBarNotice?.id === id
        ? { statusBarNotice: undefined }
        : {},
    ),
  setDocumentStatusSlot: (slot) =>
    set((state) => (state.documentStatusSlot === slot ? {} : { documentStatusSlot: slot })),
  activateTab: (tabId) => {
    const state = get();
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    const targetWorkspaceId = tabWorkspaceId(tab);
    // Activating a tab from another Workspace (e.g. a connected/pinned
    // connection in the activity rail) must also switch to its parent
    // Workspace; otherwise the canvas filters it out and shows "no active
    // session" over the wrong Workspace.
    if (tab && targetWorkspaceId !== state.activeWorkspaceId) {
      persistActiveWorkspaceId(targetWorkspaceId);
      set((current) => ({
        activeTabId: tabId,
        activeWorkspaceId: targetWorkspaceId,
        activeTabIdsByWorkspace: {
          ...current.activeTabIdsByWorkspace,
          [current.activeWorkspaceId]: current.activeTabId,
          [targetWorkspaceId]: tabId,
        },
      }));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
      }
      return;
    }
    set((current) => ({
      activeTabId: tabId,
      activeTabIdsByWorkspace: {
        ...current.activeTabIdsByWorkspace,
        [targetWorkspaceId]: tabId,
      },
    }));
  },
  renameTab: async (tabId, title) => {
    const displayTitle = title.trim();
    if (!displayTitle) {
      return;
    }
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, displayTitle } : tab,
      ),
    }));
  },
  closeAllTabs: () => {
    const closingTabs = get().tabs;
    const urlConnectionIds = closingTabs.flatMap(urlConnectionIdsForTab);
    set((state) => ({
      tabs: [],
      activeTabId: "",
      syncInputEnabled:
        state.syncInputEnabled && closingTabs.some((tab) => tab.panes.some(isTerminalPane))
          ? false
          : state.syncInputEnabled,
      activeSessionCounts: decrementActiveSessionCounts(
        state.activeSessionCounts,
        urlConnectionIds,
      ),
    }));
  },
  closeTab: (tabId) => {
    const closingTab = get().tabs.find((tab) => tab.id === tabId);
    const remainingTabs = get().tabs.filter((tab) => tab.id !== tabId);
    const activeWorkspaceId = get().activeWorkspaceId;
    const nextActiveTabId =
      get().activeTabId === tabId
        ? firstTabIdForWorkspace(remainingTabs, activeWorkspaceId)
        : get().activeTabId;
    set({
      tabs: remainingTabs,
      activeTabId: nextActiveTabId,
      activeSessionCounts: decrementActiveSessionCounts(
        get().activeSessionCounts,
        closingTab ? urlConnectionIdsForTab(closingTab) : [],
      ),
      syncInputEnabled:
        get().syncInputEnabled && closingTab?.panes.some(isTerminalPane)
          ? false
          : get().syncInputEnabled,
    });
  },
  openConnection: (connection) => {
    if (connection.type === "url") {
      get().openUrlConnection(connection);
      return;
    }
    if (isRemoteDesktopConnection(connection)) {
      get().openRemoteDesktopConnection(connection);
      return;
    }
    if (connection.type === "ftp") {
      get().openFtpBrowser(connection);
      return;
    }
    if (connection.type === "localFiles") {
      get().openLocalFilesBrowser(connection);
      return;
    }
    if (connection.type === "fileView") {
      get().openFileViewer(connection);
      return;
    }

    const existingTab = get().tabs.find(
      (tab) => tab.id === `tab-${connection.id}`,
    );
    if (existingTab) {
      set((state) => ({
        tabs: state.tabs.map((tab) => refreshTabConnectionMetadata(tab, connection)),
        activeTabId: existingTab.id,
      }));
      return;
    }

    const stored = loadStoredLayout(connection.id);
    const panes = buildPanesFromStoredLayout(connection, stored);
    const paneIds = panes.map((pane) => pane.id);
    const layout =
      (stored ? hydrateLayout(stored.layout, paneIds) : undefined) ??
      defaultLayoutFor(panes);

    const tab: WorkspaceTab = {
      id: `tab-${connection.id}`,
      workspaceId: get().activeWorkspaceId,
      title: connection.name,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: terminalConnectionSubtitle(connection),
      kind: "terminal",
      panes,
      layout,
      focusedPaneId: panes[0]?.id,
      quickCommandBarVisible: loadStoredQuickCommandBarVisible(connection.id),
      connection,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },
  openConnectionInNewTab: (connection, options) => {
    if (connection.type === "url") {
      get().openUrlInNewTab(connection, connection.url ?? "", {
        title: options?.title,
      });
      return;
    }

    if (connection.type === "fileView" && connection.fileViewOpenExternal) {
      const filePath = connection.localStartupDirectory?.trim() ?? "";
      if (filePath) {
        void openFilesystemPath(filePath);
      }
      return;
    }

    if (connection.type === "ftp") {
      if (connection.ftpOptions?.protocol === "sftp") {
        const sshConnection = sftpBrowserConnectionFromFtpConnection(connection);
        get().openSftpBrowserInNewTab(sshConnection);
        return;
      }

      const tabId = createConnectionTabId(`${connection.id}-ftp`);
      const protocolLabel =
        connection.ftpOptions?.protocol?.toUpperCase() ?? "FTP";
      const tab: WorkspaceTab = {
        id: tabId,
        workspaceId: get().activeWorkspaceId,
        title: `${connection.name} ${protocolLabel}`,
        toolbarTitle: toolbarTitleForConnection(connection),
        subtitle: `${connection.user || "anonymous"}@${connection.host}`,
        kind: "ftp",
        panes: [],
        connection,
      };

      set((state) => ({
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
      }));
      return;
    }

    const paneConnection = connectionWithPaneOptions(connection, options);
    const pane = buildPaneForConnection(paneConnection, undefined, {
      childConnectionId: options?.childConnectionId,
      cwd: options?.cwd,
      fontSize: options?.fontSize,
      textEncoding: options?.textEncoding,
      terminalOpacity: options?.terminalOpacity,
      terminalBackground: options?.terminalBackground,
      title: options?.tmuxSessionId ?? options?.title,
      toolbarTitle: options?.toolbarTitle,
      tmuxSessionId: options?.tmuxSessionId,
    });
    if (!pane) {
      return;
    }

    const tabId = createConnectionTabId(connection.id);
    const subtitle = isRemoteDesktopConnection(connection)
      ? remoteDesktopSubtitle(connection)
      : terminalConnectionSubtitle(connection);
    const tab: WorkspaceTab = {
      id: tabId,
      workspaceId: get().activeWorkspaceId,
      childConnectionId: options?.childConnectionId,
      title: options?.title ?? connection.name,
      toolbarTitle: options?.toolbarTitle ?? toolbarTitleForConnection(connection),
      subtitle,
      kind: "terminal",
      panes: [pane],
      layout: defaultLayoutFor([pane]),
      focusedPaneId: pane.id,
      quickCommandBarVisible: loadStoredQuickCommandBarVisible(connection.id),
      connection: paneConnection,
      url: connection.url,
      dataPartition: connection.dataPartition,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      activeSessionCounts: incrementActiveSessionCounts(
        state.activeSessionCounts,
        urlConnectionIdsForTab(tab),
      ),
    }));
  },
  openUrlInNewTab: (connection, url, options) => {
    const nextUrl = url.trim();
    if (connection.type !== "url" || !nextUrl) {
      return;
    }
    const tabConnection: Connection = {
      ...connection,
      url: nextUrl,
    };
    const tab: WorkspaceTab = {
      id: createConnectionTabId(connection.id),
      workspaceId: get().activeWorkspaceId,
      title: options?.title ?? connection.name,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: options?.subtitle ?? urlConnectionSubtitle(tabConnection),
      kind: "webview",
      panes: [],
      connection: tabConnection,
      url: nextUrl,
      dataPartition: connection.dataPartition,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      activeSessionCounts: incrementActiveSessionCounts(
        state.activeSessionCounts,
        [connection.id],
      ),
    }));
  },
  openChildConnectionInNewTab: (connection, child) => {
    if (connection.type === "localFiles") {
      const activeWorkspaceId = get().activeWorkspaceId;
      const children = loadStoredChildConnections().filter(
        (entry) =>
          entry.parentConnectionId === connection.id &&
          (entry.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWorkspaceId,
      );
      get().openChildConnectionLayout(
        connection,
        children.some((entry) => entry.id === child.id) ? children : [child],
      );
      const groupTab = get().tabs.find(
        (tab) =>
          tab.childConnectionGroupParentId === connection.id &&
          (tab.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWorkspaceId,
      );
      const pane = groupTab?.panes.find((entry) => entry.childConnectionId === child.id);
      if (groupTab && pane) {
        get().maximizeChildConnectionPane(groupTab.id, pane.id);
      }
      return;
    }
    const childConnection = connectionForChild(connection, child);
    get().openConnectionInNewTab(childConnection, {
      childConnectionId: child.id,
      cwd: child.cwd,
      iconColor: child.iconColor,
      iconBackgroundColor: child.iconBackgroundColor,
      iconDataUrl: child.iconDataUrl,
      fontSize: child.fontSize,
      textEncoding: child.textEncoding,
      terminalOpacity: child.terminalOpacity,
      terminalBackground: child.terminalBackground,
      title: child.tmuxSessionId ?? child.name,
      toolbarTitle: child.name,
      tmuxSessionId: child.tmuxSessionId,
    });
  },
  openChildConnectionLayout: (connection, children) => {
    const state = get();
    const activeWorkspaceId = state.activeWorkspaceId;
    const existingGroupTab = state.tabs.find(
      (tab) =>
        tab.childConnectionGroupParentId === connection.id &&
        (tab.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWorkspaceId,
    );

    const uniqueChildren = children.filter(
      (child, index, all) => all.findIndex((entry) => entry.id === child.id) === index,
    );
    const childIds = new Set(uniqueChildren.map((child) => child.id));
    const groupPaneByChildId = new Map<string, WorkspacePane>();
    const convertedPlainPaneIds = new Set<string>();
    if (existingGroupTab) {
      for (const pane of existingGroupTab.panes) {
        if (pane.childConnectionId && childIds.has(pane.childConnectionId)) {
          groupPaneByChildId.set(pane.childConnectionId, pane);
          continue;
        }
        if (!pane.childConnectionId && pane.connection?.id === connection.id && childIds.has(pane.id)) {
          groupPaneByChildId.set(pane.id, pane);
          convertedPlainPaneIds.add(pane.id);
        }
      }
    }

    const externalPaneByChildId = new Map<
      string,
      { pane: WorkspacePane; tab: WorkspaceTab }
    >();
    for (const tab of state.tabs) {
      if (tab.id === existingGroupTab?.id) {
        continue;
      }
      if ((tab.workspaceId ?? DEFAULT_WORKSPACE_ID) !== activeWorkspaceId) {
        continue;
      }
      for (const pane of tab.panes) {
        const paneChildId =
          pane.childConnectionId && childIds.has(pane.childConnectionId)
            ? pane.childConnectionId
            : !pane.childConnectionId && pane.connection?.id === connection.id && childIds.has(pane.id)
              ? pane.id
              : undefined;
        if (paneChildId && !externalPaneByChildId.has(paneChildId)) {
          if (!pane.childConnectionId) {
            convertedPlainPaneIds.add(pane.id);
          }
          externalPaneByChildId.set(paneChildId, { pane, tab });
        }
      }
    }
    const movedPaneIds = new Set<string>();
    const newPanes: WorkspacePane[] = [];
    const namedChildPanes = uniqueChildren
      .map((child) => {
        const groupPane = groupPaneByChildId.get(child.id);
        if (groupPane) {
          return {
            ...groupPane,
            childConnectionId: child.id,
            fontSize: child.fontSize ?? (isTerminalPane(groupPane) ? groupPane.fontSize : undefined),
            textEncoding: child.textEncoding ?? (isTerminalPane(groupPane) ? groupPane.textEncoding : undefined),
            connection: connectionForChild(connection, child),
            title: child.tmuxSessionId ?? child.name,
            toolbarTitle: child.name,
          };
        }
        const existing = externalPaneByChildId.get(child.id);
        if (existing) {
          movedPaneIds.add(existing.pane.id);
          return {
            ...existing.pane,
            childConnectionId: child.id,
            fontSize: child.fontSize ?? (isTerminalPane(existing.pane) ? existing.pane.fontSize : undefined),
            textEncoding: child.textEncoding ?? (isTerminalPane(existing.pane) ? existing.pane.textEncoding : undefined),
            connection: connectionForChild(connection, child),
            title: child.tmuxSessionId ?? child.name,
            toolbarTitle: child.name,
          };
        }
        const childConnection = connectionForChild(connection, child);
        const pane = buildPaneForConnection(childConnection, undefined, {
          childConnectionId: child.id,
          cwd: child.cwd,
          fontSize: child.fontSize,
          textEncoding: child.textEncoding,
          terminalOpacity: child.terminalOpacity,
          terminalBackground: child.terminalBackground,
          title: child.tmuxSessionId ?? child.name,
          toolbarTitle: child.name,
          tmuxSessionId: child.tmuxSessionId,
        });
        if (pane) {
          newPanes.push(pane);
        }
        return pane;
      })
      .filter((pane): pane is WorkspacePane => Boolean(pane));
    const claimedPaneIds = new Set(namedChildPanes.map((pane) => pane.id));
    // Preserve unnamed in-panorama split Panes only after all named children,
    // including Panes converted from the old top Tab Strip mode, are claimed.
    const { carriedGroupPanes, adoptedOrphanPanes } = collectPreservedParentPanes({
      parentConnectionId: connection.id,
      activeWorkspaceId,
      defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
      existingGroupTab,
      tabs: state.tabs,
      excludedPaneIds: new Set([...movedPaneIds, ...claimedPaneIds]),
    });
    for (const pane of adoptedOrphanPanes) {
      movedPaneIds.add(pane.id);
    }
    const childPanes = [...namedChildPanes, ...carriedGroupPanes, ...adoptedOrphanPanes];
    if (childPanes.length === 0) {
      get().openConnection(connection);
      return;
    }
    const tabId = existingGroupTab?.id ?? createConnectionTabId(`${connection.id}-children`);
    const tab: WorkspaceTab = {
      ...existingGroupTab,
      id: tabId,
      workspaceId: get().activeWorkspaceId,
      childConnectionGroupParentId: connection.id,
      title: connection.name,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: terminalConnectionSubtitle(connection),
      kind: "terminal",
      panes: childPanes,
      layout: existingGroupTab && convertedPlainPaneIds.size === 0
        ? ensureLayout(existingGroupTab.layout, childPanes)
        : layoutForChildPanes(childPanes),
      focusedPaneId: focusedPaneIdForChildLayout(existingGroupTab, childPanes),
      maximizedPaneId: undefined,
      quickCommandBarVisible: false,
      connection,
    };
    const terminalPaneIdsToMove = childPanes
      .filter((pane) => movedPaneIds.has(pane.id) && isTerminalPane(pane))
      .map((pane) => pane.id);
    markPanesForRuntimeMove(terminalPaneIdsToMove);
    set((state) => ({
      tabs: [
        ...state.tabs.flatMap((entry) => {
          if (entry.id === tab.id) {
            return [tab];
          }
          const movedPaneIdsInTab = entry.panes
            .filter((pane) => movedPaneIds.has(pane.id))
            .map((pane) => pane.id);
          if (movedPaneIdsInTab.length === 0) {
            return [entry];
          }
          const nextPanes = entry.panes.filter((pane) => !movedPaneIds.has(pane.id));
          if (nextPanes.length === 0) {
            return [];
          }
          const nextLayout = ensureLayout(entry.layout, nextPanes);
          return [
            {
              ...entry,
              childConnectionId:
                entry.childConnectionId && childIds.has(entry.childConnectionId)
                  ? undefined
                  : entry.childConnectionId,
              panes: nextPanes,
              layout: nextLayout,
              focusedPaneId:
                entry.focusedPaneId && movedPaneIds.has(entry.focusedPaneId)
                  ? leafOrder(nextLayout)[0] ?? nextPanes[0]?.id
                  : entry.focusedPaneId,
            },
          ];
        }),
        ...(existingGroupTab ? [] : [tab]),
      ],
      activeTabId: tab.id,
      activeSessionCounts: incrementActiveSessionCounts(
        state.activeSessionCounts,
        newPanes.flatMap((pane) =>
          pane.kind === "webview" && pane.connection.type === "url"
            ? [pane.connection.id]
            : [],
        ),
      ),
    }));
  },
  openConnectionsInPanorama: (connections, options) => {
    // Lay every connection out as split Panes inside one terminal Tab, the same
    // grid the parent/child Connection panorama uses. Pane-incapable or invalid
    // connections (e.g. a URL with no address) are skipped.
    const panes = connections
      .map((connection) => buildPaneForConnection(connection))
      .filter((pane): pane is WorkspacePane => Boolean(pane));
    if (panes.length === 0) {
      return;
    }
    const title = options?.title?.trim() || panes[0]?.connection?.name || "";
    const tab: WorkspaceTab = {
      id: createConnectionTabId("panorama"),
      workspaceId: get().activeWorkspaceId,
      title,
      toolbarTitle: title,
      subtitle: "",
      kind: "terminal",
      panes,
      layout: layoutForChildPanes(panes),
      focusedPaneId: panes[0]?.id,
      quickCommandBarVisible: false,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      activeSessionCounts: incrementActiveSessionCounts(
        state.activeSessionCounts,
        panes.flatMap((pane) =>
          pane.kind === "webview" && pane.connection.type === "url"
            ? [pane.connection.id]
            : [],
        ),
      ),
    }));
  },
  updateOpenChildConnectionMetadata: (child) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        const tabMatches = tab.childConnectionId === child.id;
        let panesChanged = false;
        const panes = tab.panes.map((pane) => {
          if (pane.childConnectionId !== child.id || !pane.connection) {
            return pane;
          }
          panesChanged = true;
          const connection = pane.connection;
          const nextIconColor = child.iconColor ?? connection.iconColor;
          const nextIconBackgroundColor = child.iconBackgroundColor ?? connection.iconBackgroundColor;
          const nextIconDataUrl = child.iconDataUrl ?? connection.iconDataUrl;
          const nextConnection =
            nextIconColor === connection.iconColor &&
            nextIconBackgroundColor === connection.iconBackgroundColor &&
            nextIconDataUrl === connection.iconDataUrl
              ? connection
              : {
                  ...connection,
                  iconColor: nextIconColor,
                  iconBackgroundColor: nextIconBackgroundColor,
                  iconDataUrl: nextIconDataUrl,
                };
          return {
            ...pane,
            toolbarTitle: child.name,
            connection: nextConnection,
          };
        });
        if (!tabMatches && !panesChanged) {
          return tab;
        }
        const tabConnection = tab.connection;
        const nextTabConnection =
          tabMatches && tabConnection
            ? (() => {
                const nextIconColor = child.iconColor ?? tabConnection.iconColor;
                const nextIconBackgroundColor = child.iconBackgroundColor ?? tabConnection.iconBackgroundColor;
                const nextIconDataUrl = child.iconDataUrl ?? tabConnection.iconDataUrl;
                return nextIconColor === tabConnection.iconColor &&
                  nextIconBackgroundColor === tabConnection.iconBackgroundColor &&
                  nextIconDataUrl === tabConnection.iconDataUrl
                  ? tabConnection
                  : {
                      ...tabConnection,
                      iconColor: nextIconColor,
                      iconBackgroundColor: nextIconBackgroundColor,
                      iconDataUrl: nextIconDataUrl,
                    };
              })()
            : tabConnection;
        return tabMatches
          ? {
              ...tab,
              title: child.name,
              toolbarTitle: child.name,
              panes,
              connection: nextTabConnection,
            }
          : { ...tab, panes };
      }),
    }));
  },
  openRemoteDesktopConnection: (connection) => {
    if (!isRemoteDesktopConnection(connection)) {
      return;
    }

    const existingTab = get().tabs.find(
      (tab) => tab.id === `tab-${connection.id}`,
    );
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }

    const pane = buildPaneForConnection(connection);
    if (!pane) {
      return;
    }
    const tab: WorkspaceTab = {
      id: `tab-${connection.id}`,
      workspaceId: get().activeWorkspaceId,
      title: connection.name,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: remoteDesktopSubtitle(connection),
      kind: "terminal",
      panes: [pane],
      layout: defaultLayoutFor([pane]),
      focusedPaneId: pane.id,
      quickCommandBarVisible: loadStoredQuickCommandBarVisible(connection.id),
      connection,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },
  openUrlConnection: (connection) => {
    if (connection.type !== "url" || !connection.url) {
      return;
    }

    const existingTab = get().tabs.find(
      (tab) => tab.id === `tab-${connection.id}`,
    );
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }

    const subtitle = urlConnectionSubtitle(connection);

    const tab: WorkspaceTab = {
      id: `tab-${connection.id}`,
      workspaceId: get().activeWorkspaceId,
      title: connection.name,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle,
      kind: "webview",
      panes: [],
      connection,
      url: connection.url,
      dataPartition: connection.dataPartition,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      activeSessionCounts: incrementActiveSessionCounts(
        state.activeSessionCounts,
        urlConnectionIdsForTab(tab),
      ),
    }));
  },
  openSshPortForwardBrowser: (sourceConnection, forward) => {
    if (sourceConnection.type !== "ssh") {
      return;
    }

    const tabId = `tab-${forward.forwardId}`;
    const title = `${sourceConnection.name} :${forward.remotePort}`;
    const connection: Connection = {
      id: forward.forwardId,
      name: title,
      host: "127.0.0.1",
      user: sourceConnection.user,
      type: "url",
      status: "idle",
      url: forward.url,
    };
    const pane = {
      kind: "webview" as const,
      id: tabId,
      title,
      toolbarTitle: title,
      connection,
      url: forward.url,
      sshPortForwardSessionId: forward.forwardId,
      sshPortForwardRemotePort: forward.remotePort,
    };
    const tab: WorkspaceTab = {
      id: tabId,
      workspaceId: get().activeWorkspaceId,
      title,
      toolbarTitle: title,
      subtitle: `127.0.0.1:${forward.localPort} -> ${sourceConnection.host}:${forward.remotePort}`,
      kind: "terminal",
      panes: [pane],
      layout: defaultLayoutFor([pane]),
      focusedPaneId: pane.id,
      quickCommandBarVisible: loadStoredQuickCommandBarVisible(connection.id),
      connection,
      url: forward.url,
      sshPortForwardSessionId: forward.forwardId,
      sshPortForwardRemotePort: forward.remotePort,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },
  openSftpBrowser: (connection) => {
    if (connection.type !== "ssh") {
      return;
    }

    const tabId = `tab-${connection.id}-sftp`;
    const existingTab = get().tabs.find((tab) => tab.id === tabId);
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }

    const tab: WorkspaceTab = {
      id: tabId,
      workspaceId: get().activeWorkspaceId,
      title: `${connection.name} SFTP`,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: `${connection.user}@${connection.host}`,
      kind: "sftp",
      panes: [],
      connection,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },
  openSftpBrowserInNewTab: (connection) => {
    if (connection.type !== "ssh") {
      return;
    }

    const tabId = createConnectionTabId(`${connection.id}-sftp`);
    const tab: WorkspaceTab = {
      id: tabId,
      workspaceId: get().activeWorkspaceId,
      title: `${connection.name} SFTP`,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: `${connection.user}@${connection.host}`,
      kind: "sftp",
      panes: [],
      connection,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },
  openFtpBrowser: (connection) => {
    if (connection.type !== "ftp") {
      return;
    }

    // SFTP sub-protocol shares the existing SSH-launched SFTP code path:
    // derive an SSH-shaped Connection from the FTP Connection's host/user/
    // port and hand it to openSftpBrowser. Same SftpWorkspace component,
    // same sftp_* Tauri commands, same SftpSessionManager.
    if (connection.ftpOptions?.protocol === "sftp") {
      const sshConnection = sftpBrowserConnectionFromFtpConnection(connection);
      get().openSftpBrowser(sshConnection);
      return;
    }

    const tabId = `tab-${connection.id}-ftp`;
    const existingTab = get().tabs.find((tab) => tab.id === tabId);
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }

    const protocolLabel =
      connection.ftpOptions?.protocol?.toUpperCase() ?? "FTP";
    const tab: WorkspaceTab = {
      id: tabId,
      workspaceId: get().activeWorkspaceId,
      title: `${connection.name} ${protocolLabel}`,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: `${connection.user || "anonymous"}@${connection.host}`,
      kind: "ftp",
      panes: [],
      connection,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },
  openLocalFilesBrowser: (connection) => {
    if (connection.type !== "localFiles") {
      return;
    }
    const tabId = `tab-${connection.id}-localFiles`;
    const existingTab = get().tabs.find((tab) => tab.id === tabId);
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }
    const tab: WorkspaceTab = {
      id: tabId,
      workspaceId: get().activeWorkspaceId,
      title: connection.name,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: connection.localStartupDirectory || connection.host || "",
      kind: "localFiles",
      panes: [],
      connection,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },
  openFileViewer: (connection) => {
    if (connection.type !== "fileView") {
      return;
    }
    const filePath = connection.localStartupDirectory?.trim() ?? "";
    if (connection.fileViewOpenExternal) {
      if (filePath) {
        void openFilesystemPath(filePath);
      }
      return;
    }
    const tabId = `tab-${connection.id}-fileView`;
    const existingTab = get().tabs.find((tab) => tab.id === tabId);
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }
    const tab: WorkspaceTab = {
      id: tabId,
      workspaceId: get().activeWorkspaceId,
      title: connection.name,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: filePath,
      kind: "fileViewer",
      panes: [],
      connection,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },
  openFileViewerPath: (path, options) => {
    const filePath = path.trim();
    if (!filePath) {
      return;
    }
    const name = fileNameFromPath(filePath) || i18next.t("connections.fileView");
    const sourceConnection = options?.sourceConnection;
    const connection: Connection = {
      id: `inline-file-view-${stableIdFromPath(filePath)}`,
      name,
      host: "localhost",
      user: "",
      localStartupDirectory: filePath,
      iconDataUrl: sourceConnection?.iconDataUrl ?? null,
      iconBackgroundColor: sourceConnection?.iconBackgroundColor ?? null,
      type: "fileView",
      status: "idle",
    };

    if (sourceConnection?.type === "localFiles" && get().generalSettings.hideTopTabButtons) {
      const state = get();
      const activeWorkspaceId = state.activeWorkspaceId;
      const parentChild = upsertStoredChildConnections([
        {
          id: localFilesBrowserChildId(sourceConnection.id),
          workspaceId: activeWorkspaceId,
          parentConnectionId: sourceConnection.id,
          name: sourceConnection.name,
          iconColor: sourceConnection.iconColor,
          iconDataUrl: sourceConnection.iconDataUrl,
          iconBackgroundColor: sourceConnection.iconBackgroundColor,
        },
        {
          id: fileViewerChildId(sourceConnection.id, filePath),
          workspaceId: activeWorkspaceId,
          parentConnectionId: sourceConnection.id,
          name,
          fileViewPath: filePath,
          iconColor: sourceConnection.iconColor,
          iconDataUrl: sourceConnection.iconDataUrl,
          iconBackgroundColor: sourceConnection.iconBackgroundColor,
        },
      ]);
      const browserChild = parentChild[0];
      const fileChild = parentChild[1];
      if (!browserChild || !fileChild) {
        return;
      }

      const existingGroupTab = state.tabs.find(
        (tab) =>
          tab.childConnectionGroupParentId === sourceConnection.id &&
          (tab.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWorkspaceId,
      );
      const existingBrowserTab = state.tabs.find(
        (tab) =>
          tab.kind === "localFiles" &&
          tab.connection?.id === sourceConnection.id &&
          (tab.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWorkspaceId,
      );
      const existingFileViewerTab = state.tabs.find(
        (tab) =>
          tab.kind === "fileViewer" &&
          tab.connection?.id === connection.id &&
          (tab.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWorkspaceId,
      );

      const paneByChildId = new Map<string, WorkspacePane>();
      for (const tab of state.tabs) {
        if ((tab.workspaceId ?? DEFAULT_WORKSPACE_ID) !== activeWorkspaceId) {
          continue;
        }
        for (const pane of tab.panes) {
          if (pane.childConnectionId) {
            paneByChildId.set(pane.childConnectionId, pane);
          }
        }
      }

      const browserConnection = connectionForChild(sourceConnection, browserChild);
      const fileConnection = connectionForChild(sourceConnection, fileChild);
      const existingBrowserPane = paneByChildId.get(browserChild.id);
      const browserPane =
        existingBrowserPane
          ? {
              ...existingBrowserPane,
              childConnectionId: browserChild.id,
              connection: browserConnection,
              title: browserChild.name,
              toolbarTitle: browserChild.name,
            }
          : existingBrowserTab
            ? (() => {
                const pane = buildPaneForStandaloneTab(existingBrowserTab);
                return pane
                  ? {
                      ...pane,
                      childConnectionId: browserChild.id,
                      connection: browserConnection,
                      title: browserChild.name,
                      toolbarTitle: browserChild.name,
                    }
                  : null;
              })()
            : buildPaneForConnection(browserConnection, undefined, {
                childConnectionId: browserChild.id,
                title: browserChild.name,
                toolbarTitle: browserChild.name,
              });
      const existingFilePane = paneByChildId.get(fileChild.id);
      const filePane =
        existingFilePane
          ? {
              ...existingFilePane,
              childConnectionId: fileChild.id,
              connection: fileConnection,
              title: fileChild.name,
              toolbarTitle: fileChild.name,
            }
          : existingFileViewerTab
            ? (() => {
                const pane = buildPaneForStandaloneTab(existingFileViewerTab);
                return pane
                  ? {
                      ...pane,
                      childConnectionId: fileChild.id,
                      connection: fileConnection,
                      title: fileChild.name,
                      toolbarTitle: fileChild.name,
                    }
                  : null;
              })()
            : buildPaneForConnection(fileConnection, undefined, {
                childConnectionId: fileChild.id,
                title: fileChild.name,
                toolbarTitle: fileChild.name,
              });
      if (!browserPane || !filePane) {
        return;
      }

      const carriedPanes = existingGroupTab
        ? existingGroupTab.panes.filter(
            (pane) =>
              pane.childConnectionId !== browserChild.id &&
              pane.childConnectionId !== fileChild.id,
          )
        : [];
      const panes = [browserPane, ...carriedPanes, filePane];
      const tabId = existingGroupTab?.id ?? existingBrowserTab?.id ?? createConnectionTabId(`${sourceConnection.id}-children`);
      const tab: WorkspaceTab = {
        ...existingGroupTab,
        id: tabId,
        workspaceId: activeWorkspaceId,
        childConnectionGroupParentId: sourceConnection.id,
        title: sourceConnection.name,
        toolbarTitle: toolbarTitleForConnection(sourceConnection),
        subtitle: sourceConnection.localStartupDirectory || sourceConnection.host || "",
        kind: "terminal",
        panes,
        layout: layoutForChildPanes(panes),
        focusedPaneId: filePane.id,
        maximizedPaneId: filePane.id,
        quickCommandBarVisible: false,
        connection: sourceConnection,
      };
      const removeTabIds = new Set(
        [existingBrowserTab?.id, existingFileViewerTab?.id].filter(
          (id): id is string => Boolean(id) && id !== tabId,
        ),
      );

      set((current) => {
        let replaced = false;
        const tabs = current.tabs.flatMap((entry) => {
          if (entry.id === tab.id) {
            replaced = true;
            return [tab];
          }
          if (removeTabIds.has(entry.id)) {
            return [];
          }
          return [entry];
        });
        if (!replaced) {
          tabs.push(tab);
        }
        return {
          tabs,
          activeTabId: tab.id,
        };
      });
      return;
    }

    const tabId = `tab-${connection.id}-fileView`;
    const existingTab = get().tabs.find((tab) => tab.id === tabId);
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }
    const tab: WorkspaceTab = {
      id: tabId,
      workspaceId: get().activeWorkspaceId,
      title: connection.name,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: filePath,
      kind: "fileViewer",
      panes: [],
      connection,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },
  openTerminalHere: (connection, remotePath) => {
    const normalizedPath = remotePath.trim() || ".";
    const tabId = `tab-${connection.id}-terminal-${Date.now()}`;
    const tab: WorkspaceTab = {
      id: tabId,
      workspaceId: get().activeWorkspaceId,
      title: `${connection.name} terminal`,
      toolbarTitle: toolbarTitleForConnection(connection),
      subtitle: `${connection.user}@${connection.host}:${normalizedPath}`,
      kind: "terminal",
      panes: [
        {
          id: createPaneId(`${connection.id}-terminal`),
          title: "ssh",
          toolbarTitle: toolbarTitleForConnection(connection),
          cwd: normalizedPath,
          buffer: "",
          connection,
          tmuxSessionId: appendTmuxSessionId(connection),
        },
      ],
      quickCommandBarVisible: loadStoredQuickCommandBarVisible(connection.id),
      connection,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },
  openLocalTerminal: (options) => {
    const id = `local-${Date.now()}`;
    const { sshSettings, terminalSettings } = get();
    const shell = options?.shell ?? terminalSettings.defaultShell;
    const appearance = resolveDefaultTerminalAppearance("local", sshSettings, terminalSettings);
    get().openConnection({
      id,
      name: options?.name ?? shell,
      host: "localhost",
      user: "local",
      localShell: shell,
      terminalOpacity: appearance.terminalOpacity,
      terminalBackground: appearance.terminalBackground,
      type: "local",
      status: "idle",
    });
  },
  openLocalTerminalHere: (cwd, options) => {
    const normalizedCwd = cwd.trim() || ".";
    const id = `local-popup-${Date.now()}`;
    const { sshSettings, terminalSettings } = get();
    const shell = options?.shell ?? terminalSettings.defaultShell;
    const appearance = resolveDefaultTerminalAppearance("local", sshSettings, terminalSettings);
    const connection: Connection = {
      id,
      name: options?.name ?? shell,
      host: "localhost",
      user: "local",
      localShell: shell,
      localStartupDirectory: normalizedCwd,
      terminalOpacity: appearance.terminalOpacity,
      terminalBackground: appearance.terminalBackground,
      type: "local",
      status: "idle",
    };
    const paneId = createPaneId(id);
    set({
      localTerminalPopup: {
        id: `popup-${id}`,
        workspaceId: get().activeWorkspaceId,
        title: connection.name,
        toolbarTitle: connection.name,
        subtitle: normalizedCwd,
        kind: "terminal",
        panes: [{
          id: paneId,
          title: connection.name,
          toolbarTitle: connection.name,
          cwd: normalizedCwd,
          buffer: "",
          connection,
        }],
        focusedPaneId: paneId,
        connection,
      },
    });
  },
  closeLocalTerminalPopup: () => set({ localTerminalPopup: undefined }),
  openTerminalRecordingsBrowser: (initialConnectionId, initialRecordingPath) =>
    set({
      terminalRecordingsBrowser: {
        initialConnectionId,
        initialRecordingPath,
        requestId: Date.now(),
      },
    }),
  closeTerminalRecordingsBrowser: () => set({ terminalRecordingsBrowser: undefined }),
  openGitBrowser: (repoRoot, label) => set({ gitBrowser: { repoRoot, label } }),
  closeGitBrowser: () => set({ gitBrowser: undefined }),
  setCompareLeft: (endpoint) => set({ compareLeft: endpoint }),
  clearCompareLeft: () => set({ compareLeft: undefined }),
  openCompareView: (left, right) => set({ compareView: { left, right } }),
  closeCompareView: () => set({ compareView: undefined }),
  openFolderCompareView: (left, right) => set({ folderCompareView: { left, right } }),
  closeFolderCompareView: () => set({ folderCompareView: undefined }),
  openElevatedLocalTerminal: async (option, options) => {
    const isAppElevated = await invokeCommand("is_app_elevated", undefined).catch(() => false);
    const action = elevatedLocalShellAction({
      adminLabel: i18next.t("connections.admin"),
      isAppElevated,
      option,
    });

    if (action.mode === "embedded") {
      if (options?.cwd) {
        get().openLocalTerminalHere(options.cwd, { name: action.name, shell: action.shell });
      } else {
        get().openLocalTerminal({ name: action.name, shell: action.shell });
      }
      return;
    }

    await invokeCommand("launch_elevated_terminal", {
      request: { shell: action.shell, initialDirectory: options?.cwd },
    });
  },
  splitTerminalPane: (tabId) => {
    get().splitTerminalPaneDirected(tabId, "right");
  },
  splitTerminalPaneDirected: (tabId, direction) => {
    set((state) => {
      const openedUrlConnectionIds: string[] = [];
      const tabs = state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") {
          return tab;
        }

        const focusedPane =
          tab.panes.find((pane) => pane.id === tab.focusedPaneId) ??
          tab.panes[0];
        const connection = focusedPane?.connection;
        if (!focusedPane || !connection) {
          return tab;
        }

        const newPane = buildPaneForConnection(connection, focusedPane);
        if (!newPane) {
          return tab;
        }
        newPane.title = `${focusedPane.title} ${tab.panes.length + 1}`;
        if (newPane.kind === "webview") {
          openedUrlConnectionIds.push(newPane.connection.id);
        }

        const nextPanes = [...tab.panes, newPane];
        const baseLayout = ensureLayout(tab.layout, tab.panes);
        const nextLayout = splitLayout(
          baseLayout,
          focusedPane.id,
          direction,
          newPane.id,
          tab.panes.map((pane) => pane.id),
        );

        return {
          ...tab,
          panes: nextPanes,
          layout: nextLayout,
          focusedPaneId: newPane.id,
        };
      });
      return {
        tabs,
        activeSessionCounts: incrementActiveSessionCounts(
          state.activeSessionCounts,
          openedUrlConnectionIds,
        ),
      };
    });
  },
  addConnectionToTerminalPane: (tabId, connection, direction, targetPaneId, options) => {
    set((state) => {
      const openedUrlConnectionIds: string[] = [];
      const tabs = state.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const basePane = tab.kind === "terminal" ? null : buildPaneForStandaloneTab(tab);
        const currentPanes = tab.kind === "terminal" ? tab.panes : basePane ? [basePane] : [];
        // Prefer an explicit drop target (e.g. the pane hovered during a
        // drag-to-dock), falling back to the focused pane for menu-driven splits.
        const targetPane =
          (targetPaneId && currentPanes.find((pane) => pane.id === targetPaneId)) ||
          currentPanes.find((pane) => pane.id === tab.focusedPaneId) ||
          currentPanes[0];
        if (!targetPane) {
          return tab;
        }
        const paneConnection = connectionWithPaneOptions(connection, options);
        const newPane = buildPaneForConnection(paneConnection, targetPane, options);
        if (!newPane) {
          return tab;
        }
        if (newPane.kind === "webview") {
          openedUrlConnectionIds.push(newPane.connection.id);
        }
        const nextPanes = [...currentPanes, newPane];
        const baseLayout = ensureLayout(
          tab.kind === "terminal" ? tab.layout : undefined,
          currentPanes,
        );
        const nextLayout = splitLayout(
          baseLayout,
          targetPane.id,
          direction,
          newPane.id,
          currentPanes.map((pane) => pane.id),
        );
        return {
          ...tab,
          kind: "terminal" as const,
          panes: nextPanes,
          layout: nextLayout,
          focusedPaneId: newPane.id,
          quickCommandBarVisible:
            tab.kind === "terminal"
              ? tab.quickCommandBarVisible
              : loadStoredQuickCommandBarVisible(tab.connection?.id),
        };
      });
      return {
        tabs,
        activeSessionCounts: incrementActiveSessionCounts(
          state.activeSessionCounts,
          openedUrlConnectionIds,
        ),
      };
    });
  },
  closePane: (tabId, paneId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "terminal") {
      return;
    }
    const closingPane = tab.panes.find((pane) => pane.id === paneId);
    if (closingPane?.childConnectionId) {
      get().closeChildConnection(closingPane.childConnectionId);
      return;
    }
    if (tab.panes.length <= 1) {
      get().closeTab(tabId);
      return;
    }
    const nextPanes = tab.panes.filter((p) => p.id !== paneId);
    const nextLayout = ensureLayout(tab.layout, nextPanes);
    const nextFocusedPaneId =
      tab.focusedPaneId === paneId
        ? (leafOrder(nextLayout)[0] ?? nextPanes[0]?.id)
        : tab.focusedPaneId;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id !== tabId
          ? t
          : {
              ...t,
              panes: nextPanes,
              layout: nextLayout,
              focusedPaneId: nextFocusedPaneId,
            },
      ),
      activeSessionCounts:
        closingPane?.kind === "webview"
          ? decrementActiveSessionCounts(s.activeSessionCounts, [closingPane.connection.id])
          : s.activeSessionCounts,
      syncInputEnabled:
        s.syncInputEnabled && closingPane && isTerminalPane(closingPane)
          ? false
          : s.syncInputEnabled,
    }));
  },
  closeChildConnection: (childConnectionId) => {
    let removed = false;
    const closesTerminalPane = get().tabs.some((tab) =>
      tab.panes.some(
        (pane) => pane.childConnectionId === childConnectionId && isTerminalPane(pane),
      ),
    );
    set((state) => {
      const closedUrlConnectionIds: string[] = [];
      const tabs = state.tabs.flatMap((tab) => {
        const tabMatches = tab.childConnectionId === childConnectionId;
        const matchingPanes = tab.panes.filter(
          (pane) => pane.childConnectionId === childConnectionId,
        );
        if (!tabMatches && matchingPanes.length === 0) {
          return [tab];
        }

        removed = true;
        closedUrlConnectionIds.push(
          ...urlConnectionIdsForTab({
            ...tab,
            panes: tabMatches ? tab.panes : matchingPanes,
          }),
        );
        const nextPanes = tab.panes.filter(
          (pane) => pane.childConnectionId !== childConnectionId,
        );
        if (tabMatches || nextPanes.length === 0) {
          return [];
        }

        const nextLayout = ensureLayout(tab.layout, nextPanes);
        const nextFocusedPaneId =
          tab.focusedPaneId && nextPanes.some((pane) => pane.id === tab.focusedPaneId)
            ? tab.focusedPaneId
            : leafOrder(nextLayout)[0] ?? nextPanes[0]?.id;
        const nextMaximizedPaneId =
          tab.maximizedPaneId && nextPanes.some((pane) => pane.id === tab.maximizedPaneId)
            ? tab.maximizedPaneId
            : undefined;
        return [
          {
            ...tab,
            panes: nextPanes,
            layout: nextLayout,
            focusedPaneId: nextFocusedPaneId,
            maximizedPaneId: nextMaximizedPaneId,
          },
        ];
      });
      return {
        tabs,
        activeTabId:
          tabs.some((tab) => tab.id === state.activeTabId)
            ? state.activeTabId
            : tabs[0]?.id ?? "",
        activeSessionCounts: decrementActiveSessionCounts(
          state.activeSessionCounts,
          closedUrlConnectionIds,
        ),
        syncInputEnabled:
          state.syncInputEnabled && closesTerminalPane
            ? false
            : state.syncInputEnabled,
      };
    });
    if (removed) {
      emitChildConnectionClosed(childConnectionId);
    }
  },
  maximizeChildConnectionPane: (tabId, paneId) => {
    set((state) => ({
      activeTabId: tabId,
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && tab.childConnectionGroupParentId
          ? {
              ...tab,
              focusedPaneId: paneId,
              maximizedPaneId: paneId,
            }
          : tab.id === tabId
            ? { ...tab, focusedPaneId: paneId }
            : tab,
      ),
    }));
  },
  updatePaneCwd: (tabId, paneId, cwd) => {
    const nextCwd = cwd.trim();
    if (!nextCwd) {
      return;
    }
    set((state) => {
      // OSC7 fires this on (potentially) every shell prompt. Short-circuit
      // when nothing actually changed so we return the same `tabs` reference
      // and Zustand skips notifying subscribers (sidebar, canvas, rail).
      let changed = false;
      const tabs = state.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        let paneChanged = false;
        const panes = tab.panes.map((pane) => {
          if (pane.id === paneId && isTerminalPane(pane) && pane.cwd !== nextCwd) {
            paneChanged = true;
            return { ...pane, cwd: nextCwd };
          }
          return pane;
        });
        if (!paneChanged) {
          return tab;
        }
        changed = true;
        return { ...tab, panes };
      });
      if (!changed) {
        return state;
      }
      return { tabs };
    });
  },
  setQuickCommandBarVisible: (tabId, visible) => {
    const tab = get().tabs.find((entry) => entry.id === tabId);
    persistQuickCommandBarVisible(tab?.connection?.id, visible);
    set((state) => ({
      tabs: state.tabs.map((entry) =>
        entry.id === tabId ? { ...entry, quickCommandBarVisible: visible } : entry,
      ),
    }));
  },
  ensureQuickCommandsLoaded: (connectionId) => {
    if (!connectionId || get().quickCommandsByConnection[connectionId]) {
      return;
    }
    set((state) => ({
      quickCommandsByConnection: {
        ...state.quickCommandsByConnection,
        [connectionId]: loadStoredQuickCommands(connectionId),
      },
    }));
  },
  addQuickCommand: (connectionId, command) => {
    if (!connectionId) {
      return;
    }
    set((state) => {
      const quickCommands = [
        ...(state.quickCommandsByConnection[connectionId] ?? loadStoredQuickCommands(connectionId)),
        command,
      ];
      persistQuickCommands(connectionId, quickCommands);
      return {
        quickCommandsByConnection: {
          ...state.quickCommandsByConnection,
          [connectionId]: quickCommands,
        },
      };
    });
  },
  updateQuickCommand: (connectionId, command) => {
    if (!connectionId) {
      return;
    }
    set((state) => {
      const existing = state.quickCommandsByConnection[connectionId] ?? loadStoredQuickCommands(connectionId);
      const quickCommands = existing.map((entry) =>
        entry.id === command.id ? command : entry,
      );
      persistQuickCommands(connectionId, quickCommands);
      return {
        quickCommandsByConnection: {
          ...state.quickCommandsByConnection,
          [connectionId]: quickCommands,
        },
      };
    });
  },
  moveQuickCommand: (connectionId, commandId, direction) => {
    if (!connectionId) {
      return;
    }
    set((state) => {
      const existing = state.quickCommandsByConnection[connectionId] ?? loadStoredQuickCommands(connectionId);
      const index = existing.findIndex((entry) => entry.id === commandId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= existing.length) {
        return {};
      }
      const quickCommands = [...existing];
      const [command] = quickCommands.splice(index, 1);
      if (!command) {
        return {};
      }
      quickCommands.splice(nextIndex, 0, command);
      persistQuickCommands(connectionId, quickCommands);
      return {
        quickCommandsByConnection: {
          ...state.quickCommandsByConnection,
          [connectionId]: quickCommands,
        },
      };
    });
  },
  reorderQuickCommand: (connectionId, commandId, targetCommandId) => {
    if (!connectionId || commandId === targetCommandId) {
      return;
    }
    set((state) => {
      const existing = state.quickCommandsByConnection[connectionId] ?? loadStoredQuickCommands(connectionId);
      const index = existing.findIndex((entry) => entry.id === commandId);
      const targetIndex = existing.findIndex((entry) => entry.id === targetCommandId);
      if (index < 0 || targetIndex < 0) {
        return {};
      }
      const quickCommands = [...existing];
      const [command] = quickCommands.splice(index, 1);
      if (!command) {
        return {};
      }
      quickCommands.splice(targetIndex, 0, command);
      persistQuickCommands(connectionId, quickCommands);
      return {
        quickCommandsByConnection: {
          ...state.quickCommandsByConnection,
          [connectionId]: quickCommands,
        },
      };
    });
  },
  removeQuickCommand: (connectionId, commandId) => {
    if (!connectionId) {
      return;
    }
    set((state) => {
      const existing = state.quickCommandsByConnection[connectionId] ?? loadStoredQuickCommands(connectionId);
      const quickCommands = existing.filter((entry) => entry.id !== commandId);
      persistQuickCommands(connectionId, quickCommands);
      return {
        quickCommandsByConnection: {
          ...state.quickCommandsByConnection,
          [connectionId]: quickCommands,
        },
      };
    });
  },
  openTmuxSessionInPane: (tabId, connection, tmuxSessionId, direction) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") {
          return tab;
        }

        const focusedPane =
          tab.panes.find((pane) => pane.id === tab.focusedPaneId) ??
          tab.panes[0];
        if (!focusedPane || !isTerminalPane(focusedPane)) {
          return tab;
        }

        const newPane: TerminalPane = {
          id: createPaneId(connection.id),
          title: tmuxSessionId,
          toolbarTitle: toolbarTitleForConnection(connection),
          cwd: focusedPane.cwd,
          buffer: "",
          connection,
          tmuxSessionId,
        };

        const nextPanes = [...tab.panes, newPane];
        const baseLayout = ensureLayout(tab.layout, tab.panes);
        const nextLayout = splitLayout(
          baseLayout,
          focusedPane.id,
          direction,
          newPane.id,
          tab.panes.map((pane) => pane.id),
        );

        return {
          ...tab,
          panes: nextPanes,
          layout: nextLayout,
          focusedPaneId: newPane.id,
        };
      }),
    }));
  },
  renameTmuxSessionInOpenPanes: (connectionId, previousSessionId, nextSessionId) => {
    const trimmedSessionId = nextSessionId.trim();
    if (!trimmedSessionId || !isCurrentTmuxSessionId(trimmedSessionId)) {
      return;
    }
    replaceTmuxSessionId(connectionId, previousSessionId, trimmedSessionId);
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.kind !== "terminal") {
          return tab;
        }
        const panes = tab.panes.map((pane) => {
          if (!isTerminalPane(pane) || pane.connection?.id !== connectionId || pane.tmuxSessionId !== previousSessionId) {
            return pane;
          }
          return {
            ...pane,
            tmuxSessionId: trimmedSessionId,
            title: pane.title === previousSessionId ? trimmedSessionId : pane.title,
          };
        });
        return panes.some((pane, index) => pane !== tab.panes[index]) ? { ...tab, panes } : tab;
      }),
    }));
  },
  setFocusedPane: (tabId, paneId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.focusedPaneId === paneId) {
          return tab;
        }
        return { ...tab, focusedPaneId: paneId };
      }),
    }));
  },
  saveTabLayout: (tabId) => {
    const tab = get().tabs.find((entry) => entry.id === tabId);
    if (!tab || tab.kind !== "terminal" || !tab.connection) {
      return;
    }
    const layout = ensureLayout(tab.layout, tab.panes);
    if (!layout) {
      return;
    }
    const orderedIds = leafOrder(layout);
    const orderedPanes = orderedIds
      .map((id) => tab.panes.find((pane) => pane.id === id))
      .filter(
        (pane): pane is WorkspacePane =>
          pane !== undefined && Boolean(pane.connection),
      );
    if (orderedPanes.length !== tab.panes.length) {
      return;
    }
    const stored = serializeLayout(layout, orderedPanes);
    persistLayout(tab.connection.id, stored);
  },
  resetTabLayout: (tabId) => {
    const tab = get().tabs.find((entry) => entry.id === tabId);
    if (!tab || tab.kind !== "terminal" || !tab.connection) {
      return;
    }
    persistLayout(tab.connection.id, undefined);
  },
  saveConnectionLayout: (connectionId) => {
    const { activeTabId, tabs } = get();
    const tab =
      tabs.find(
        (entry) =>
          entry.id === activeTabId &&
          entry.kind === "terminal" &&
          entry.connection?.id === connectionId,
      ) ??
      tabs.find(
        (entry) =>
          entry.kind === "terminal" && entry.connection?.id === connectionId,
      );
    if (!tab || tab.kind !== "terminal") {
      return;
    }
    get().saveTabLayout(tab.id);
  },
  resetConnectionLayout: (connectionId) => {
    persistLayout(connectionId, undefined);
  },
  resetAllLayouts: () => {
    clearStoredLayouts();
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.kind !== "terminal"
          ? tab
          : {
              ...tab,
              layout: defaultLayoutFor(tab.panes),
              focusedPaneId: tab.panes[0]?.id,
            },
      ),
    }));
  },
  updateWebviewTabMetadata: (tabId, metadata) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.kind === "terminal") {
          const updatesTab = tab.id === tabId;
          const updatesPane = tab.panes.some(
            (pane) => pane.kind === "webview" && pane.id === tabId,
          );
          if (!updatesTab && !updatesPane) {
            return tab;
          }
          const updatesSinglePaneTab = updatesPane && tab.panes.length === 1;

          return {
            ...tab,
            title:
              updatesTab || updatesSinglePaneTab
                ? (metadata.title ?? tab.title)
                : tab.title,
            subtitle:
              updatesTab || updatesSinglePaneTab
                ? (metadata.subtitle ?? tab.subtitle)
                : tab.subtitle,
            url:
              updatesTab || updatesSinglePaneTab
                ? (metadata.url ?? tab.url)
                : tab.url,
            panes: tab.panes.map((pane) =>
              pane.kind === "webview" && pane.id === tabId
                ? {
                    ...pane,
                    title: metadata.title ?? pane.title,
                    url: metadata.url ?? pane.url,
                  }
                : pane,
            ),
          };
        }

        if (tab.id !== tabId || tab.kind !== "webview") {
          return tab;
        }

        return {
          ...tab,
          title: metadata.title ?? tab.title,
          subtitle: metadata.subtitle ?? tab.subtitle,
          url: metadata.url ?? tab.url,
        };
      }),
    }));
  },
  refreshOpenConnectionMetadata: (connection) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => refreshTabConnectionMetadata(tab, connection)),
    }));
  },
  updateOpenConnectionTerminalAppearance: (connectionId, appearance) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => updateTabTerminalAppearance(tab, connectionId, appearance)),
    }));
  },
  updateOpenConnectionTerminalColorScheme: (connectionId, terminalColorScheme) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        updateTabTerminalAppearance(tab, connectionId, { terminalColorScheme }),
      ),
    }));
  },
  updateOpenConnectionFileBrowserViewOptions: (connectionId, fileBrowserViewOptions) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.connection?.id === connectionId
          ? { ...tab, connection: { ...tab.connection, fileBrowserViewOptions } }
          : tab,
      ),
    }));
  },
  updateOpenTerminalPaneAppearance: (tabId, paneId, appearance) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") {
          return tab;
        }
        let changed = false;
        const panes = tab.panes.map((pane) => {
          if (!isTerminalPane(pane) || pane.id !== paneId || !pane.connection) {
            return pane;
          }
          changed = true;
          return {
            ...pane,
            connection: { ...pane.connection, ...appearance },
            terminalBackground: appearance.terminalBackground,
          };
        });
        if (!changed) {
          return tab;
        }
        return { ...tab, panes };
      }),
    }));
  },
  updateOpenTerminalPaneFontSize: (tabId, paneId, fontSize) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") {
          return tab;
        }
        let changed = false;
        const panes = tab.panes.map((pane) => {
          if (!isTerminalPane(pane) || pane.id !== paneId) {
            return pane;
          }
          changed = true;
          return { ...pane, fontSize };
        });
        if (!changed) {
          return tab;
        }
        const nextTab = { ...tab, panes };
        if (nextTab.connection) {
          const layout = ensureLayout(nextTab.layout, nextTab.panes);
          if (layout) {
            persistLayout(nextTab.connection.id, serializeLayout(layout, nextTab.panes));
          }
        }
        return nextTab;
      }),
    }));
  },
  updateOpenTerminalPaneTextEncoding: (tabId, paneId, textEncoding) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") return tab;
        const panes = tab.panes.map((pane) =>
          isTerminalPane(pane) && pane.id === paneId ? { ...pane, textEncoding } : pane,
        );
        if (panes.every((pane, index) => pane === tab.panes[index])) return tab;
        const nextTab = { ...tab, panes };
        if (nextTab.connection) {
          const layout = ensureLayout(nextTab.layout, nextTab.panes);
          if (layout) persistLayout(nextTab.connection.id, serializeLayout(layout, nextTab.panes));
        }
        return nextTab;
      }),
    }));
  },
  updateOpenTerminalPaneBackground: (tabId, paneId, terminalBackground) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") {
          return tab;
        }
        let changed = false;
        const panes = tab.panes.map((pane) => {
          if (!isTerminalPane(pane) || pane.id !== paneId) {
            return pane;
          }
          changed = true;
          return { ...pane, terminalBackground };
        });
        if (!changed) {
          return tab;
        }
        const nextTab = { ...tab, panes };
        if (nextTab.connection) {
          const layout = ensureLayout(nextTab.layout, nextTab.panes);
          if (layout) {
            persistLayout(nextTab.connection.id, serializeLayout(layout, nextTab.panes));
          }
        }
        return nextTab;
      }),
    }));
  },
  updateOpenTerminalPaneX11ForwardingStatus: (tabId, paneId, status) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") {
          return tab;
        }
        let changed = false;
        const panes = tab.panes.map((pane) => {
          if (!isTerminalPane(pane) || pane.id !== paneId || pane.x11ForwardingStatus === status) {
            return pane;
          }
          changed = true;
          return { ...pane, x11ForwardingStatus: status };
        });
        return changed ? { ...tab, panes } : tab;
      }),
    }));
  },
  setOpenTerminalPaneSshForwardFailures: (tabId, paneId, failedForwardIds) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") {
          return tab;
        }
        let changed = false;
        const panes = tab.panes.map((pane) => {
          if (!isTerminalPane(pane) || pane.id !== paneId) {
            return pane;
          }
          const current = pane.sshPortForwardFailures ?? [];
          const unchanged =
            current.length === failedForwardIds.length &&
            current.every((id, index) => id === failedForwardIds[index]);
          if (unchanged) {
            return pane;
          }
          changed = true;
          return { ...pane, sshPortForwardFailures: failedForwardIds };
        });
        return changed ? { ...tab, panes } : tab;
      }),
    }));
  },

  markOpenTerminalPaneTmuxUnavailable: (tabId, paneId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") {
          return tab;
        }
        let changed = false;
        const panes = tab.panes.map((pane) => {
          if (!isTerminalPane(pane) || pane.id !== paneId || !pane.tmuxSessionId) {
            return pane;
          }
          changed = true;
          return {
            ...pane,
            title: pane.title === pane.tmuxSessionId ? pane.connection?.name ?? pane.title : pane.title,
            tmuxSessionId: undefined,
            tmuxUnavailable: true,
          };
        });
        return changed ? { ...tab, panes } : tab;
      }),
    }));
  },
  markConnectionSessionStarted: (connectionId) => {
    set((state) => ({
      activeSessionCounts: {
        ...state.activeSessionCounts,
        [connectionId]: (state.activeSessionCounts[connectionId] ?? 0) + 1,
      },
    }));
  },
  markConnectionSessionEnded: (connectionId) => {
    set((state) => {
      const currentCount = state.activeSessionCounts[connectionId] ?? 0;
      if (currentCount <= 1) {
        const remainingCounts = { ...state.activeSessionCounts };
        delete remainingCounts[connectionId];
        return { activeSessionCounts: remainingCounts };
      }

      return {
        activeSessionCounts: {
          ...state.activeSessionCounts,
          [connectionId]: currentCount - 1,
        },
      };
    });
  },
}));


function updateTabTerminalAppearance(
  tab: WorkspaceTab,
  connectionId: string,
  appearance: Partial<Pick<Connection, "terminalOpacity" | "terminalBackground" | "terminalColorScheme">>,
): WorkspaceTab {
  const apply = (connection: Connection): Connection => ({ ...connection, ...appearance });
  const tabConnectionMatches = tab.connection?.id === connectionId;
  const panes = tab.panes.map((pane) => (
    pane.connection?.id === connectionId
      ? { ...pane, connection: apply(pane.connection) }
      : pane
  ));
  const panesChanged = panes.some((pane, index) => pane !== tab.panes[index]);
  if (!tabConnectionMatches && !panesChanged) {
    return tab;
  }
  return {
    ...tab,
    connection: tabConnectionMatches && tab.connection ? apply(tab.connection) : tab.connection,
    panes,
  };
}

function refreshTabConnectionMetadata(tab: WorkspaceTab, connection: Connection): WorkspaceTab {
  const tabConnectionMatches = tab.connection?.id === connection.id;
  const refreshedConnection =
    tab.kind === "sftp" && connection.type === "ftp" && connection.ftpOptions?.protocol === "sftp"
      ? sftpBrowserConnectionFromFtpConnection(connection)
      : connection;
  const toolbarTitle = toolbarTitleForConnection(refreshedConnection);
  const panes = tab.panes.map((pane) => {
    if (!isTerminalPane(pane) || pane.connection?.id !== connection.id) {
      return pane;
    }
    const paneConnection = refreshChildPaneConnection(pane, tab.connection, refreshedConnection);
    return refreshTerminalPaneConnection(
      pane,
      pane.childConnectionId ? paneConnection : refreshedConnection,
      pane.childConnectionId ? pane.toolbarTitle : toolbarTitle,
    );
  });
  const panesChanged = panes.some((pane, index) => pane !== tab.panes[index]);
  if (!tabConnectionMatches && !panesChanged) {
    return tab;
  }

  if (!tabConnectionMatches) {
    return { ...tab, panes };
  }

  return {
    ...tab,
    connection: refreshedConnection,
    title: refreshedTabTitle(tab, refreshedConnection),
    toolbarTitle,
    subtitle: refreshedTabSubtitle(tab, refreshedConnection),
    panes,
  };
}

function sftpBrowserConnectionFromFtpConnection(connection: Connection): Connection {
  return {
    ...connection,
    type: "ssh",
    authMethod: connection.authMethod,
    port: connection.port ?? 22,
    keyPath: connection.authMethod === "keyFile" ? connection.keyPath : undefined,
    proxyJump: undefined,
    // Keep standalone SFTP browser preferences such as local/remote start paths
    // available to SftpWorkspace after the runtime adapter normalizes the
    // Connection to the SSH command path.
    ftpOptions: connection.ftpOptions,
    // Keep the file-browser identity for the rail/tab glyph instead of the
    // default SSH terminal icon (this connection opens a file browser). Use a
    // catalog icon ref so non-Vite consumers, like the test runner, don't import
    // an SVG asset from the store.
    iconDataUrl: connection.iconDataUrl ?? "material:folder-server",
  };
}

function refreshedTabTitle(tab: WorkspaceTab, connection: Connection) {
  if (tab.kind === "sftp") {
    return `${connection.name} SFTP`;
  }
  if (tab.id.startsWith(`tab-${connection.id}-terminal-`)) {
    return `${connection.name} terminal`;
  }
  return connection.name;
}

function refreshedTabSubtitle(tab: WorkspaceTab, connection: Connection) {
  if (tab.kind === "sftp") {
    return `${connection.user}@${connection.host}`;
  }
  if (tab.kind === "webview") {
    return tab.subtitle;
  }
  if (tab.id.startsWith(`tab-${connection.id}-terminal-`)) {
    const firstPane = tab.panes.find((pane): pane is TerminalPane => isTerminalPane(pane));
    const path = firstPane?.cwd?.trim() || ".";
    return `${connection.user}@${formatConnectionAddress(connection)}:${path}`;
  }
  if (tab.panes[0]?.kind === "remoteDesktop") {
    return remoteDesktopSubtitle(connection);
  }
  return terminalConnectionSubtitle(connection);
}

function refreshedPaneTitle(pane: WorkspacePane, connection: Connection) {
  if (pane.kind === "webview" || pane.kind === "remoteDesktop") {
    return connection.name;
  }
  return pane.title;
}

function formatConnectionAddress(connection: Connection) {
  return connection.port
    ? `${connection.host}:${connection.port}`
    : connection.host;
}

function remoteDesktopSubtitle(connection: Connection) {
  return connection.user?.trim() || formatConnectionAddress(connection);
}

function urlConnectionSubtitle(connection: Connection) {
  if (!connection.url) {
    return "";
  }
  try {
    return new URL(connection.url).host;
  } catch {
    return connection.url;
  }
}

function terminalConnectionSubtitle(connection: Connection) {
  if (connection.type === "local") {
    return i18next.t("workspace.localTerminalSession");
  }
  if (connection.type === "serial") {
    return `${connection.serialLine ?? connection.host} @ ${connection.serialSpeed ?? 9600}`;
  }
  if (connection.user.trim()) {
    return `${connection.user}@${formatConnectionAddress(connection)}`;
  }
  return formatConnectionAddress(connection);
}

import type { AccentName, DashboardBackground, IconName, WidgetLayoutEnforcement } from "./modules/dashboard/types";
import type { WatchdogConfig } from "./watchdog/types";

export type ConnectionType =
  | "local"
  | "ssh"
  | "telnet"
  | "serial"
  | "url"
  | "rdp"
  | "vnc"
  | "ftp"
  | "localFiles"
  | "fileView";

/**
 * A named, isolated container of Connections. The first Workspace ("Default")
 * is seeded and permanent; additional Workspaces are user-created. Switching the
 * active Workspace re-scopes the Connection Tree only — open Sessions/Tabs,
 * Dashboard, and Settings remain global.
 */
export interface Workspace {
  id: string;
  name: string;
  icon?: string | null;
  iconColor?: string | null;
  iconBackgroundColor?: string | null;
  isDefault: boolean;
  sortOrder: number;
}

export interface CreateWorkspaceRequest {
  name: string;
  icon?: string | null;
  iconColor?: string | null;
  iconBackgroundColor?: string | null;
  importConnectionIds?: string[];
}

export interface RenameWorkspaceRequest {
  id: string;
  name: string;
  icon?: string | null;
  iconColor?: string | null;
  iconBackgroundColor?: string | null;
}

export interface ReorderWorkspacesRequest {
  orderedIds: string[];
}
export type ConnectionStatus = "connected" | "idle" | "offline";
export interface AppModeInfo {
  mode: "installed" | "portable";
  dataDir: string;
}
export interface CreatedPortableCopy {
  destination: string;
  executable: string;
}
export type SshAuthMethod = "keyFile" | "password" | "agent";

/**
 * SSH transport compression. `"fast"` enables zlib at russh's fast level
 * (matching `ssh -XC`); `"off"` disables it. A per-connection value of
 * `undefined` means "inherit the global SSH default".
 */
export type SshCompressionMode = "off" | "fast";
export type SshOldProtocolsMode = "off" | "legacy";

/** Per-pane File Explorer / SFTP browser view options (item zoom + content-view
 * background), persisted durably on the Connection. */
export interface FileBrowserPaneViewOptions {
  zoom?: number;
  background?: DashboardBackground | null;
}
export interface FileBrowserViewOptions {
  local?: FileBrowserPaneViewOptions;
  remote?: FileBrowserPaneViewOptions;
}

export type SshPortForwardMode = "L" | "R" | "D";

export interface SshPortForwarding {
  id: string;
  mode: SshPortForwardMode;
  enabled: boolean;
  bind: string;
  listenPort: number;
  destHost?: string;
  destPort?: number;
}

export interface Connection {
  id: string;
  name: string;
  tabTitle?: string | null;
  host: string;
  user: string;
  port?: number;
  keyPath?: string;
  proxyJump?: string;
  sshSocksProxy?: string;
  sshSocksProxyUsername?: string;
  sshSocksProxyInheritDefaults?: boolean;
  sshCompression?: SshCompressionMode;
  sshOldProtocols?: SshOldProtocolsMode;
  authMethod?: SshAuthMethod;
  hasPassword?: boolean;
  localShell?: string;
  localStartupDirectory?: string;
  localStartupScript?: string;
  serialLine?: string;
  serialSpeed?: number;
  url?: string;
  dataPartition?: string;
  urlUserAgent?: string;
  urlProxy?: string;
  urlProxyInheritDefaults?: boolean;
  useTmuxSessions?: boolean;
  usePsmuxSessions?: boolean;
  tmuxConnectionId?: string;
  passwordCredentialId?: string | null;
  urlCredentialUsername?: string;
  hasUrlCredential?: boolean;
  iconColor?: string | null;
  iconDataUrl?: string | null;
  iconBackgroundColor?: string | null;
  terminalOpacity?: number | null;
  terminalBackground?: DashboardBackground | null;
  /** Per-Connection terminal color scheme override; null inherits the global
   * Terminal Settings default. Set from the terminal Pane actions menu. */
  terminalColorScheme?: string | null;
  fileBrowserViewOptions?: FileBrowserViewOptions | null;
  sshPortForwardings?: SshPortForwarding[] | null;
  fileViewOpenExternal?: boolean;
  rdpOptions?: RdpConnectionOptions;
  vncOptions?: VncConnectionOptions;
  ftpOptions?: FtpConnectionOptions;
  type: ConnectionType;
  status: ConnectionStatus;
}

export interface ConnectionFolder {
  id: string;
  name: string;
  iconDataUrl?: string | null;
  connections: Connection[];
  folders: ConnectionFolder[];
}

export interface ConnectionTree {
  connections: Connection[];
  folders: ConnectionFolder[];
}

// IT Ops Module (docs/ITOPS.md). A Site is a durable, named selection of
// existing Connections used as a site target; ResolvedHost is one concrete
// target produced by resolving a group at run time.
export type ItopsTransport = "ssh" | "winrm" | "psexec" | "auto";

export interface SiteFilter {
  types: string[];
  folderId?: string | null;
}

export interface Site {
  id: string;
  name: string;
  sortOrder: number;
  memberIds: string[];
  filter?: SiteFilter | null;
  transport: ItopsTransport;
  // Custom Site-view (server-room cards) background; reuses the Dashboard
  // background machinery. null/undefined = theme default.
  background?: DashboardBackground | null;
  // Per-server-room backgrounds, keyed by the room's string tag.
  roomBackgrounds?: Record<string, DashboardBackground>;
  // Custom icon (data URL or reicon/lucide/material ref), foreground colour, and background colour.
  iconColor?: string | null;
  iconDataUrl?: string | null;
  iconBackgroundColor?: string | null;
  // Per-server-room icons, keyed by the room's string tag.
  roomIcons?: Record<string, RoomIconEntry>;
}

export interface RoomIconEntry {
  iconColor?: string | null;
  iconDataUrl?: string | null;
  iconBackgroundColor?: string | null;
}

export interface ServerRoom {
  id: string;
  siteId: string;
  name: string;
  /** Durable 2.5D floor finish; validated against the room floor palette. */
  floorColor?: string;
  sortOrder: number;
}

export interface ResolvedHost {
  connectionId: string;
  name: string;
  host: string;
  username: string;
  port?: number | null;
  connectionType: string;
  transport: ItopsTransport;
}

// IT Ops Hosts (docs/ITOPS.md Hosts). A Host is a durable inventory entry for
// one device or guest in a Site, addressed by hostname; a VM/container Host
// points at its carrying device via parentHostId (a soft self reference).
export type HostKind = "physical" | "vm" | "container" | "other";

// The last connectivity-scan snapshot: which remote-orchestration endpoints
// answered a TCP probe. Stored result, not live Session state; a Host without
// one was never scanned.
export interface HostScan {
  ssh: boolean;
  winrm: boolean;
  https: boolean;
  scannedAt?: string | null;
}

export interface SiteHost {
  id: string;
  siteId: string;
  parentHostId?: string | null;
  hostname: string;
  // Optional display name; blank = show the hostname.
  label: string;
  kind: HostKind;
  // Ordered soft references to Connection ids — one Host may bind several
  // Connections (an SSH terminal plus an HTTPS management URL).
  connectionIds: string[];
  scan?: HostScan | null;
  notes: string;
  sortOrder: number;
}

export interface HostImportResult {
  hosts: SiteHost[];
  skipped: number;
}

// Live Host connectivity-scan progress streamed on `itops://host-scan`.
export type HostScanEvent =
  | { kind: "host"; siteId: string; host: SiteHost }
  | { kind: "finished"; siteId: string };

// Site topology (docs/SITE.md Phase B). A Rack belongs to one Site, grouped
// grouped by server room, and holds Rack Devices at U positions.
export type RackItemKind =
  | "connection"
  | "switch"
  | "pdu"
  | "patchPanel"
  // Legacy persisted kinds: retained only so older Site data still loads.
  | "blank"
  | "label"
  | "server"
  | "storage"
  | "router"
  | "firewall"
  | "ups"
  | "kvm"
  | "genericDevice"
  | "kuaiguai";

export type RackItemStatus = "online" | "warning" | "offline";
export type RackMountFace = "front" | "rear";

export type RackServerFormFactor = "rack" | "tower";
// Fractional faceplate width: several small devices (e.g. two modems) can
// share one U row side by side. null/undefined = full width.
export type RackItemWidthFraction = "half" | "quarter";
export type RackServerPanelStyle = "default" | "style1" | "style2";

export type RackPortSpeed = "gigabit" | "10g" | "25g" | "40g" | "100g" | "custom";

export interface RackNetworkPort {
  name: string;
  speed: RackPortSpeed;
  state?: "up" | "down" | "unknown" | null;
  oid?: string | null;
  note?: string | null;
}

export interface RackSnmpHint {
  target: string;
  oid?: string | null;
  communitySecretRef?: string | null;
  lastRefreshedAt?: string | null;
  lastError?: string | null;
}

export interface RackItemMetadata {
  accent?: string | null;
  icon?: string | null;
  notes?: string | null;
  // Presentation status driving the faceplate LEDs/dimming; stored, not live.
  status?: RackItemStatus | null;
  // Faceplate spec counts: ports (switch/router/patch panel), drive bays
  // (server/storage); battery and load are 0–100 percentages.
  ports?: number | null;
  disks?: number | null;
  battery?: number | null;
  load?: number | null;
  /** Nameplate/typical power draw in watts; summed per rack for the power heatmap. */
  powerW?: number | null;
  // Device faceplate shell colour; null/"black" = default metallic black.
  shell?: RackShell | null;
  /** Expiry date for consumables or support windows (ISO yyyy-mm-dd when set). */
  expiry?: string | null;
  /** Faceplate/package rotation in degrees for novelty inventory such as 乖乖. */
  rotation?: number | null;
  /** Faceplate/package yaw in degrees for novelty inventory such as 乖乖. */
  yaw?: number | null;
  /** Freeform comma-separated tag labels for the rack device. */
  tags?: string[] | null;
  /** Additional Connection ids bound to this rack device. */
  connectionIds?: string[] | null;
  /** Soft reference to the IT Ops Host this device is; the Rack View callout
   *  lists the Host and its child Hosts (VMs/containers). */
  hostId?: string | null;
  /** Switch/router port speeds, e.g. gigabit/10g, optionally filled from SNMP polling. */
  networkPorts?: RackNetworkPort[] | string[] | null;
  /** SNMP target or OID hint for polling this device. */
  snmp?: RackSnmpHint | string | null;
  /** 乖乖 package size variant. */
  kuaiguaiSize?: "small" | "regular" | "large" | null;
  /** Standing package (4U) or package laid face-up (1U). */
  kuaiguaiStyle?: "full" | "laidDown" | null;
  /** Optional rack-top corner selected in a Server Room spatial view. */
  rackTopCorner?: 0 | 1 | 2 | 3 | null;
  /** Optional rack-top facing selected by the spatial two-click placement flow. */
  rackTopFacing?: 0 | 1 | 2 | 3 | null;
  /** Hardware model used for the graphical device preview, e.g. Dell 740XD. */
  vendor?: string | null;
  /** Server chassis presentation. Tower servers render at half rack width. */
  formFactor?: RackServerFormFactor | null;
  /** Fractional faceplate width; null/undefined = full rack width. */
  widthFraction?: RackItemWidthFraction | null;
  /** Horizontal slot for a fractional-width device, 0-based from the left in
   *  units of its own width (half: 0–1, quarter: 0–3). null = leftmost. */
  slot?: number | null;
  /** Server front-panel artwork; independent of shell finish and form factor. */
  serverPanelStyle?: RackServerPanelStyle | null;
}

// Skeuomorphic shell finish for a rack cabinet or a device faceplate. White and
// grey shells render with black text; black (the default) uses light text.
export type RackShell = "black" | "white" | "grey";

export interface RackItem {
  id: string;
  rackId: string;
  // Soft reference to a Connection id; null for passive items.
  connectionId?: string | null;
  kind: RackItemKind;
  label: string;
  // Bottom-most U occupied (1-based) and height in U.
  startU: number;
  heightU: number;
  // Structural mounting plane; independent from the Rack's room-facing angle.
  mountFace: RackMountFace;
  metadata: RackItemMetadata;
}

export interface Rack {
  id: string;
  siteId: string;
  name: string;
  // Topology is Site → Server Room → Rack; blank groups under "Unassigned".
  serverRoom: string;
  // Optional group tag within the server room (blank → "Ungrouped").
  rackGroup: string;
  // Cabinet shell colour; null/"black" = default.
  shell?: RackShell | null;
  // Custom single-rack stage background; null/undefined = theme default.
  background?: DashboardBackground | null;
  heightU: number;
  // Physical cabinet depth in millimetres (1000 mm is the default server rack).
  depthMm: number;
  // Optional feed/PDU capacity in watts; null/undefined = unset (power heatmap
  // shows the rack as "no capacity").
  powerCapacityW?: number | null;
  // Durable Server Room View placements: floor-plan free position (px) and
  // 2.5D floor grid cell. null/undefined = automatic layout.
  floorX?: number | null;
  floorY?: number | null;
  gridX?: number | null;
  gridY?: number | null;
  // Durable quarter-turn facing on the room floor grid (0-3, 0 = front toward
  // +y). null/undefined = unset (legacy local store, then the default).
  facing?: number | null;
  sortOrder: number;
  items: RackItem[];
}

// Narrows a Batch Run to part of a Site's rack topology (docs/SITE.md Phase D).
export interface RunScope {
  rackId?: string | null;
  serverRoom?: string | null;
  hostIds?: string[];
}

// One ordered Playbook node: a PTY command/input, cached sudo acquisition, or
// a closed AI decision over the preceding node output.
export interface PlaybookStep {
  /** Stable editor identity; older saved Playbooks may omit it. */
  id?: string;
  /** Command is the backwards-compatible default. */
  kind?: "command" | "sudo" | "ai";
  name: string;
  send: string;
  expect?: string | null;
  timeoutSeconds?: number | null;
  /** Vault reference only. The secret value never enters the Task JSON. */
  secretOwnerId?: string | null;
  /** AI-node instruction applied to the immediately preceding node output. */
  aiInstruction?: string | null;
}

// A Batch Run task (docs/ITOPS.md): a one-shot script, or an interactive
// expect-style Playbook whose steps run in order over a single shell.
export type BatchTask =
  | { kind: "script"; body: string; shell?: string | null }
  | { kind: "playbook"; name: string; steps: PlaybookStep[] };

export type TaskOperatingSystem =
  | "any"
  | "linux"
  | "macos"
  | "windows"
  | "ciscoIos"
  | "ciscoNxos"
  | "fortiOs"
  | "junos"
  | "aristaEos";

// Reusable global Task Library entry. Targets are chosen when the Task runs.
export interface ItopsTask {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  applicableOs: TaskOperatingSystem[];
  builtInKey: string | null;
  task: BatchTask;
}

export interface HostReport {
  connectionId: string;
  name: string;
  host: string;
  transport: ItopsTransport;
  ok: boolean;
  exitCode?: number | null;
  bytesOut: number;
  durationMs: number;
  // Full combined output, persisted so a saved Run Report reopens with output.
  // Absent on history rows written before output was persisted.
  output?: string;
  error?: string | null;
}

export interface RunReport {
  ok: number;
  failed: number;
  total: number;
  hosts: HostReport[];
}

export interface RunHistoryEntry {
  id: string;
  source: string;
  siteId?: string | null;
  taskId?: string | null;
  taskSummary: string;
  startedAt: string;
  finishedAt?: string | null;
  report: RunReport;
}

export interface RunEventHost {
  connectionId: string;
  name: string;
  host: string;
  transport: ItopsTransport;
}

// Live Batch Run progress streamed on the `itops://run` channel.
export type RunEvent =
  | {
      kind: "started";
      runId: string;
      siteId?: string | null;
      taskSummary: string;
      hosts: RunEventHost[];
    }
  | { kind: "hostStarted"; runId: string; connectionId: string }
  | { kind: "hostOutput"; runId: string; connectionId: string; chunk: string }
  | {
      kind: "hostFinished";
      runId: string;
      connectionId: string;
      ok: boolean;
      exitCode?: number | null;
      output: string;
      durationMs: number;
      error?: string | null;
    }
  | { kind: "finished"; runId: string; report: RunReport }
  | { kind: "canceled"; runId: string };

// A durable Automation (docs/ITOPS.md Phase 3+): a Watchdog config plus an
// ordered IT Ops action list run on each trigger fire (Phase 4).
export type NotifyLevel = "inApp" | "toast" | "sound";

export type AutomationAction =
  | { kind: "notify"; level: NotifyLevel }
  | { kind: "popup"; title: string; body: string }
  | { kind: "email"; to: string[]; subject: string; body: string }
  | { kind: "webhook"; url: string; method: string; body?: string | null }
  | { kind: "runBatch"; siteId: string; task: BatchTask };

export interface Automation {
  id: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
  config: WatchdogConfig;
  actions: AutomationAction[];
  // Durable Site binding (soft reference): which Site's Automations segment
  // lists this rule. null/undefined = unbound (legacy rows).
  siteId?: string | null;
}

// Result of a one-shot Automation test (docs/ITOPS.md): samples the trigger now
// and reports whether the condition would fire. Actions are not executed.
export interface AutomationTestResult {
  value: unknown;
  valueAvailable: boolean;
  wouldFire: boolean;
  // Note code the UI translates ("schedule" | "needsSession").
  note?: string | null;
}

export interface CreateConnectionRequest {
  name: string;
  host?: string;
  user?: string;
  type: ConnectionType;
  folderId?: string;
  workspaceId?: string;
  port?: number;
  keyPath?: string;
  proxyJump?: string;
  sshSocksProxy?: string;
  sshSocksProxyUsername?: string;
  sshSocksProxyInheritDefaults?: boolean;
  sshCompression?: SshCompressionMode;
  sshOldProtocols?: SshOldProtocolsMode;
  authMethod?: SshAuthMethod;
  localShell?: string;
  localStartupDirectory?: string;
  localStartupScript?: string;
  serialLine?: string;
  serialSpeed?: number;
  url?: string;
  dataPartition?: string;
  urlUserAgent?: string;
  urlProxy?: string;
  urlProxyInheritDefaults?: boolean;
  useTmuxSessions?: boolean;
  usePsmuxSessions?: boolean;
  rdpOptions?: RdpConnectionOptions;
  vncOptions?: VncConnectionOptions;
  ftpOptions?: FtpConnectionOptions;
  sshPortForwardings?: SshPortForwarding[] | null;
  fileViewOpenExternal?: boolean;
}

export interface CreateConnectionFolderRequest {
  name: string;
  parentFolderId?: string;
  workspaceId?: string;
  iconDataUrl?: string | null;
}

export interface RenameConnectionFolderRequest {
  id: string;
  name: string;
  iconDataUrl?: string | null;
}

export interface RenameConnectionRequest {
  id: string;
  name: string;
}

export interface UpdateConnectionRequest extends CreateConnectionRequest {
  id: string;
}

export interface DuplicateConnectionRequest {
  id: string;
  name?: string;
}

export interface MoveConnectionFolderRequest {
  id: string;
  parentFolderId?: string;
  targetIndex: number;
}

export interface MoveConnectionRequest {
  id: string;
  folderId?: string;
  targetIndex: number;
}

export interface TerminalPane {
  kind?: "terminal";
  id: string;
  childConnectionId?: string;
  title: string;
  toolbarTitle?: string;
  cwd: string;
  buffer: string;
  connection?: Connection;
  fontSize?: number;
  textEncoding?: string;
  terminalBackground?: DashboardBackground | null;
  tmuxSessionId?: string;
  tmuxUnavailable?: boolean;
  x11ForwardingStatus?: "disabled" | "enabled" | "rejected";
  /** Live ids of saved SSH port forwards that failed to start on this Session
   * (e.g. listener port already in use). Drives the warning state on the
   * forwarding toolbar button and the list rows; it is runtime state, not a
   * durable Connection field. */
  sshPortForwardFailures?: string[];
}

export interface UrlPane {
  kind: "webview";
  id: string;
  childConnectionId?: string;
  title: string;
  toolbarTitle?: string;
  connection: Connection;
  url: string;
  dataPartition?: string;
  sshPortForwardSessionId?: string;
  sshPortForwardRemotePort?: number;
}

export interface RemoteDesktopPane {
  kind: "remoteDesktop";
  id: string;
  childConnectionId?: string;
  title: string;
  toolbarTitle?: string;
  connection: Connection;
}

export interface FileBrowserPane {
  kind: "sftp" | "ftp" | "localFiles";
  id: string;
  childConnectionId?: string;
  title: string;
  toolbarTitle?: string;
  connection: Connection;
}

/**
 * A Document Pane (kind `fileViewer`) renders a single local file in the
 * universal viewer/light-editor surface. The target file path is carried on
 * `connection.localStartupDirectory` (the Document reuses that non-secret
 * local-path slot for its file path), so no separate pane field is needed.
 */
export interface FileViewerPane {
  kind: "fileViewer";
  id: string;
  childConnectionId?: string;
  title: string;
  toolbarTitle?: string;
  connection: Connection;
}

export type WorkspacePane =
  | TerminalPane
  | UrlPane
  | RemoteDesktopPane
  | FileBrowserPane
  | FileViewerPane;

export interface QuickCommand {
  id: string;
  label: string;
  command: string;
  iconName: IconName;
  accentName: AccentName;
  sendEnter: boolean;
  confirm: boolean;
}

export type SplitDirection = "right" | "left" | "down" | "up";
export type SplitOrientation = "horizontal" | "vertical";

export type LayoutNode =
  | { type: "leaf"; paneId: string }
  | { type: "split"; orientation: SplitOrientation; children: LayoutNode[] };

export type StoredLayoutNode =
  | { type: "leaf"; paneIndex: number }
  | {
      type: "split";
      orientation: SplitOrientation;
      children: StoredLayoutNode[];
    };

export interface StoredConnectionLayout {
  paneCount: number;
  layout: StoredLayoutNode;
  panes?: StoredLayoutPane[];
}

export interface StoredLayoutPane {
  kind?: WorkspacePane["kind"];
  connection: Connection;
  title?: string;
  cwd?: string;
  fontSize?: number;
  textEncoding?: string;
  terminalBackground?: DashboardBackground | null;
  tmuxSessionId?: string;
  url?: string;
  dataPartition?: string;
}

export type TerminalCursorStyle = "block" | "bar" | "underline";

export interface TerminalCustomShell {
  id: string;
  name: string;
  commandLine: string;
}

export type InstallerDefaultProvider = "winget" | "chocolatey";

export interface GeneralSettings {
  autoBackupEnabled: boolean;
  autoUpdateChecksEnabled: boolean;
  showConnectedConnectionsInRail: boolean;
  showWorkspaceOnRail: boolean;
  showDashboardOnRail: boolean;
  showAllConnectionsInTree: boolean;
  hideTopTabButtons: boolean;
  doubleClickOpensConnection: boolean;
  submitAiAttachmentsDirectly: boolean;
  separateSplitTerminalBackgrounds: boolean;
  showInstallerOnRail: boolean;
  showItOps: boolean;
  showScreenshotsOnRail: boolean;
  showDontSleepOnRail: boolean;
  activityRailOrder: ActivityRailItemId[];
  installerCheckIntervalSeconds: number;
  installerDefaultProvider: InstallerDefaultProvider;
  pinnedConnectionIds: string[];
  allowClipboardRead: boolean;
  autoStartWithWindows: boolean;
  minimizeToTray: boolean;
  dontSleepEnabled: boolean;
  dontSleepForegroundOnly: boolean;
  useDirectxScreenCapture: boolean;
  statusBarEnabled: boolean;
  statusBarMonitorEnabled: boolean;
  statusBarMonitorIntervalSeconds: number;
  advancedDebuggingEnabled: boolean;
  rdpWebviewStability: boolean;
  // Workspace shortcut overrides keyed by keymap action id. A null value
  // explicitly unbinds the action; absent ids keep the catalog default.
  workspaceShortcuts: Record<string, string | null>;
  proxyMode: ProxyMode;
  proxyUrl?: string;
  lastBackupAt?: string | null;
}

export type ProxyMode = "system" | "none" | "manual";

export type ActivityRailItemId =
  | "workspace"
  | "dashboard"
  | "installer"
  | "screenshots"
  | "itops"
  | "dontSleep";

export type SecretStoreKind = "os" | "file";

export interface CredentialSettings {
  secretStore: SecretStoreKind;
}

export interface ConfigureEncryptedFileSecretStoreRequest {
  password: string;
  createIfMissing: boolean;
  resetExisting?: boolean;
}

export interface ConfigureEncryptedFileSecretStoreResult {
  settings: CredentialSettings;
  status: KeychainStatus;
}

export interface ChangeEncryptedFileSecretStorePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CredentialSecretStoreStatus {
  selectedStore: SecretStoreKind;
  backend: string;
  available: boolean;
  encryptedStoreExists: boolean;
  unlocked: boolean;
}

export type AppLauncherLaunchMode = "normal" | "admin" | "differentUser" | "openFolder";
export type AppLauncherViewMode = "icons" | "list" | "details";
export type AppLauncherSortField = "name" | "path" | "type" | "size" | "modified";
export type AppLauncherSortDirection = "asc" | "desc";

export interface AppLauncherSortState {
  field: AppLauncherSortField;
  direction: AppLauncherSortDirection;
}

export interface AppLauncherEntry {
  id: string;
  name: string;
  path: string;
  arguments?: string | null;
  workingDirectory?: string | null;
  iconDataUrl?: string | null;
  railPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppLauncherSettings {
  entries: AppLauncherEntry[];
  viewMode: AppLauncherViewMode;
  listSort: AppLauncherSortState;
  detailsSort: AppLauncherSortState;
  showFileExtensions: boolean;
}

export interface DashboardSettings {
  confirmRemove: boolean;
  defaultLandingView: string;
  /**
   * Hard cap on simultaneously active script widgets per renderer. Backed by
   * the same field on the Rust DashboardSettings struct; validated 1..=100 at
   * the storage boundary. See ADR 0006.
   */
  maxActiveScriptWidgets: number;
  /**
   * Global kill-switch for KK.net.* APIs in script widgets. When false, no
   * widget-origin network Tauri commands run regardless of per-widget flags.
   * Has no effect on AI assistant standalone network tools.
   */
  allowWidgetNetworkTools: boolean;
  /**
   * When true, newly-created Dashboard Views automatically start with a random
   * local dynamic background. Existing Views are unchanged.
   */
  useRandomDynamicBackground: boolean;
  /**
   * How strictly the script-widget iframe forces AI-created layout to fill its
   * frame. Applied live at render time inside the iframe (`buildSrcdoc`), so
   * changing it re-lays-out existing widgets without regenerating them.
   * - `strict`  — #root acts as the widget shell: its outermost content is
   *   forced to fill the surface, neutralizing centered mini-cards and
   *   shrink-to-content wrappers (the dominant "messy layout" failure mode).
   * - `moderate` — the historical behavior; the widget owns its own fill.
   * - `low`     — maximum authoring freedom; content may size to its natural
   *   box and overflow the frame.
   */
  widgetLayoutEnforcement: WidgetLayoutEnforcement;
}

export interface PreparedAppLauncherEntry {
  name: string;
  path: string;
  exists: boolean;
  runnable: boolean;
  iconDataUrl?: string | null;
  fileKind: "file" | "folder" | "missing";
  extension?: string | null;
  sizeBytes?: number | null;
  modifiedAtUnixMs?: number | null;
}

export interface DatabaseBackupInfo {
  path: string;
  filename: string;
  createdAt: string;
}

export interface SelectiveManifest {
  product: string;
  format: string;
  version: number;
  createdAt: string;
  segments: string[];
  encrypted: boolean;
}

export interface SelectiveExportInfo {
  filename: string;
  segments: string[];
  encrypted: boolean;
}

export interface SelectiveImportResult {
  backupFilename: string;
  applied: string[];
}

export interface ImportedDatabaseSnapshot {
  generalSettings: GeneralSettings;
  credentialSettings: CredentialSettings;
  terminalSettings: TerminalSettings;
  appearanceSettings: AppearanceSettings;
  appLauncherSettings: AppLauncherSettings;
  dashboardSettings: DashboardSettings;
  sshSettings: SshSettings;
  sftpSettings: SftpSettings;
  urlSettings: UrlSettings;
  rdpSettings: RdpSettings;
  vncSettings: VncSettings;
  screenshotSettings: ScreenshotSettings;
  aiProviderSettings: AiProviderSettings;
  connectionTree: ConnectionTree;
  backup: DatabaseBackupInfo;
}

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: TerminalCursorStyle;
  scrollbackLines: number;
  defaultTransparency: number;
  useRandomDynamicBackground: boolean;
  copyOnSelect: boolean;
  allowOsc52Clipboard: boolean;
  confirmMultilinePaste: boolean;
  /** Right-click pastes the clipboard instead of opening the context menu
   * (Shift+right-click still opens the menu). */
  rightClickPaste: boolean;
  /** Every new terminal Session starts with recording active, as if the
   * record button was pressed. */
  autoRecordSessions: boolean;
  defaultShell: string;
  customShells: TerminalCustomShell[];
  /** Global default terminal color scheme id; each terminal-type Connection
   * may override it from the Pane actions menu. */
  colorScheme: string;
  enableInlineImages: boolean;
  allowTerminalNotifications: boolean;
  hyperlinkRules: TerminalHyperlinkRule[];
}

/** User-defined regex → URL rule that turns matching terminal text into a
 * Ctrl+click hyperlink. `$0`…`$9` in the URL template substitute capture
 * groups from the match. */
export interface TerminalHyperlinkRule {
  id: string;
  pattern: string;
  urlTemplate: string;
}

export type ColorScheme =
  | "default"
  | "dark"
  | "light"
  | "match-os"
  | "mac"
  | "orange"
  | "purple"
  | "pink"
  | "green-kuai-kuai"
  | "blue-see"
  | "blue-green-white"
  | "confetti"
  | "bubble-tea"
  | "semiconductor"
  | "canarinho"
  | "la-albiceleste"
  | "les-bleus"
  | "oranje"
  | "die-mannschaft"
  | "la-roja"
  | "os-navegadores"
  | "vatreni"
  | "el-tri"
  | "three-lions"
  | "samurai-blue"
  | "stars-and-stripes";

export interface AppearanceSettings {
  appFontFamily: string;
  colorScheme: ColorScheme;
  customFontPath?: string;
}

export interface SystemAccentColor {
  accent: string;
}

export interface CustomFont {
  name: string;
  family: string;
  path: string;
  extension: string;
  weight: number;
  style: "normal" | "italic";
  isMonospace: boolean;
}

export interface SystemFont {
  family: string;
  isMonospace: boolean;
}

export interface SshSettings {
  defaultUser: string;
  defaultPort: number;
  defaultKeyPath?: string;
  defaultProxyJump?: string;
  defaultSshCompression: SshCompressionMode;
  defaultSshOldProtocols: SshOldProtocolsMode;
  /** Trust a never-before-seen host key without the fingerprint confirmation
   * dialog. Changed host keys always still prompt. */
  autoTrustNewHostKeys: boolean;
  bufferLines: number;
  defaultTransparency: number;
  defaultUseTmuxSessions: boolean;
  useRandomDynamicBackground: boolean;
  allowOsc52Clipboard: boolean;
  managedXServerEnabled: boolean;
  xServerPath?: string;
  xServerDisplay: number;
  xServerArgs: string;
}

export type SftpOverwriteBehavior = "fail" | "overwrite";
export type FileExplorerOpenMode = "external" | "inlineEditor";

export interface SftpSettings {
  overwriteBehavior: SftpOverwriteBehavior;
  fileExplorerOpenMode: FileExplorerOpenMode;
  fileExplorerTerminalShell: string;
  fileExplorerTerminalElevated: boolean;
}

export interface UrlSettings {
  ignoreCertificateErrors: boolean;
  defaultDataPartition?: string;
  defaultUserAgent?: string;
}

export type RdpPerformanceProfile = "balanced" | "quality" | "speed";
export type RdpColorDepth = 15 | 16 | 24 | 32;

export type RemoteDesktopViewMode = "fit" | "stretch" | "actualSize" | "fitWidth" | "fitHeight";

export type RdpRemoteResolutionMode = "automatic" | "smartSizing" | "dpiZoom";
export type RdpRemoteResolutionFixed =
  | "1440x900"
  | "1400x1050"
  | "1600x1024"
  | "1600x1200"
  | "1600x1280"
  | "1680x1050"
  | "1900x1200"
  | "1920x1080"
  | "1920x1200"
  | "2048x1536"
  | "2560x2048"
  | "3200x2400"
  | "3840x2400";
export type RdpRemoteResolution = RdpRemoteResolutionMode | RdpRemoteResolutionFixed;

export const RDP_REMOTE_RESOLUTION_FIXED: readonly RdpRemoteResolutionFixed[] = [
  "1440x900",
  "1400x1050",
  "1600x1024",
  "1600x1200",
  "1600x1280",
  "1680x1050",
  "1900x1200",
  "1920x1080",
  "1920x1200",
  "2048x1536",
  "2560x2048",
  "3200x2400",
  "3840x2400",
] as const;

export type RdpDriveSelection =
  | { mode: "all" }
  | { mode: "selected"; drives: string[] };

export interface RdpSettings {
  colorDepth: RdpColorDepth;
  administrativeSession: boolean;
  redirectClipboard: boolean;
  redirectDrives: boolean;
  driveSelection: RdpDriveSelection;
  sharedLocalFolders: string[];
  /** Legacy single-folder setting retained for backward-compatible imports. */
  sharedLocalFolder?: string;
  bitmapCache: boolean;
  performanceProfile: RdpPerformanceProfile;
  remoteResolution: RdpRemoteResolution;
  viewMode: RemoteDesktopViewMode;
}

export interface RdpConnectionOptions {
  inheritDefaults: boolean;
  colorDepth?: RdpColorDepth;
  administrativeSession?: boolean;
  redirectClipboard?: boolean;
  redirectDrives?: boolean;
  driveSelection?: RdpDriveSelection;
  sharedLocalFolders?: string[];
  /** Legacy single-folder setting retained for backward-compatible imports. */
  sharedLocalFolder?: string;
  bitmapCache?: boolean;
  performanceProfile?: RdpPerformanceProfile;
  remoteResolution?: RdpRemoteResolution;
  viewMode?: RemoteDesktopViewMode;
}

export type VncColorLevel = "full" | "256" | "64" | "8";
export type VncPreferredEncoding = "tight" | "zrle" | "raw";

export interface VncSettings {
  sharedSession: boolean;
  viewOnly: boolean;
  colorLevel: VncColorLevel;
  preferredEncoding: VncPreferredEncoding;
  viewMode: RemoteDesktopViewMode;
}

export interface VncConnectionOptions {
  inheritDefaults: boolean;
  sharedSession?: boolean;
  viewOnly?: boolean;
  colorLevel?: VncColorLevel;
  preferredEncoding?: VncPreferredEncoding;
  viewMode?: RemoteDesktopViewMode;
}

export type FtpProtocol = "sftp" | "ftp" | "ftps";
export type FtpTlsMode = "explicit" | "implicit";
export type FtpConnectionMode = "passive" | "active";
export type FtpTransferType = "binary" | "ascii";

export interface FtpConnectionOptions {
  protocol: FtpProtocol;
  mode: FtpConnectionMode;
  tlsMode?: FtpTlsMode;
  transferType: FtpTransferType;
  utf8: boolean;
  showHidden: boolean;
  connectTimeoutSecs?: number;
  ignoreCertErrors: boolean;
  keepaliveSecs?: number;
  /** Start directory for the local pane; empty/undefined = the OS home folder. */
  localPath?: string;
  /** Start directory for the remote pane; empty/undefined = the server's home. */
  remotePath?: string;
}

export type ScreenshotFormat = "png" | "jpeg";
export type ScreenshotCaptureDelivery = "folder" | "clipboard" | "both";
export type ScreenshotBorderStyle = "solid" | "dashed" | "dotted";

export interface ScreenshotSettings {
  folderPath: string;
  format: ScreenshotFormat;
  quality: number;
  captureMode: ScreenshotCaptureDelivery;
  borderEnabled: boolean;
  borderWidth: number;
  borderStyle: ScreenshotBorderStyle;
  borderColor: string;
  includeCursor: boolean;
  regionShortcut: string;
  regionShortcutEnabled: boolean;
  windowShortcut: string;
  windowShortcutEnabled: boolean;
  fullscreenShortcut: string;
  fullscreenShortcutEnabled: boolean;
}

export type AiProviderKind =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "deepseek"
  | "gemini"
  | "grok"
  | "azure-openai"
  | "litellm"
  | "github-copilot"
  | "cursor"
  | "ollama"
  | "ollama-cloud"
  | "nvidia"
  | "opencode"
  | "openai-compatible";

export type AiReasoningEffort = "default" | "low" | "medium" | "high" | "max";
export type AiOpenAiApiMode = "chatCompletions" | "responses";
export type AiToolPermissionMode = "prompt" | "allowAll";

export type AiAssistantToolId =
  | "webSearch"
  | "webFetch"
  | "shellCommand"
  | "appDataFileSearch"
  | "appDataFileRead"
  | "currentTime"
  | "performanceCounters"
  | "email"
  | "dashboard"
  | "itops"
  | "connections"
  | "sessions"
  | "tutorial"
  | "manual"
  | "network"
  | "watchdog"
  | "memory";

export type AiAssistantToolSettings = Record<AiAssistantToolId, boolean>;

export type SearchProvider = "scraper" | "brave" | "tavily" | "searxng";
export type EmailProvider = "resend" | "sendgrid" | "mailgun" | "postmark" | "smtp";
export type SmtpSecurity = "starttls" | "none";

export interface AiProviderSettings {
  providerKind: AiProviderKind;
  baseUrl: string;
  model: string;
  reasoningEffort: AiReasoningEffort;
  outputLanguage: string;
  customInstructions: string;
  apiMode: AiOpenAiApiMode;
  extraHeaders: string;
  allowInsecureTls: boolean;
  allowInsecureMcpHttp: boolean;
  showAllModels: boolean;
  cliExecutionPolicy: "suggestOnly";
  toolPermissionMode: AiToolPermissionMode;
  builtInMcpServerEnabled: boolean;
  builtInMcpAllowAllDangerous: boolean;
  useCodexCli: boolean;
  useClaudeCli: boolean;
  useCursorCli: boolean;
  claudeCliPath?: string;
  codexCliPath?: string;
  cursorCliPath?: string;
  disabledSkillNames: string[];
  customSkillsEnabled: boolean;
  tools: AiAssistantToolSettings;
  searchProvider: SearchProvider;
  searxngUrl: string;
  emailProvider: EmailProvider;
  emailFrom: string;
  mailgunDomain: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpSecurity: SmtpSecurity;
}

export interface WorkspaceTab {
  id: string;
  workspaceId?: string;
  childConnectionId?: string;
  childConnectionGroupParentId?: string;
  title: string;
  displayTitle?: string | null;
  toolbarTitle?: string;
  subtitle: string;
  kind: "terminal" | "sftp" | "webview" | "remoteDesktop" | "ftp" | "localFiles" | "fileViewer";
  panes: WorkspacePane[];
  layout?: LayoutNode;
  focusedPaneId?: string;
  maximizedPaneId?: string;
  quickCommandBarVisible?: boolean;
  connection?: Connection;
  url?: string;
  dataPartition?: string;
  sshPortForwardSessionId?: string;
  sshPortForwardRemotePort?: number;
}

export interface WorkspaceChildConnection {
  id: string;
  workspaceId?: string;
  parentConnectionId: string;
  name: string;
  fileViewPath?: string;
  tmuxSessionId?: string;
  cwd?: string;
  fontSize?: number;
  textEncoding?: string;
  terminalOpacity?: number | null;
  terminalBackground?: DashboardBackground | null;
  iconColor?: string | null;
  iconDataUrl?: string | null;
  iconBackgroundColor?: string | null;
}

export interface FileEntry {
  name: string;
  kind: "file" | "folder" | "symlink" | "other";
  size: string;
  sizeBytes?: number;
  modified: string;
  modifiedTimestamp?: number;
  accessedTimestamp?: number;
  permissions?: number;
  mode?: string;
  uid?: number;
  user?: string;
  gid?: number;
  group?: string;
}

export interface AppBootstrap {
  productName: string;
  version: string;
  logStatus: string;
  storageStatus: string;
  keychainStatus: KeychainStatus;
}

export interface PerformanceSnapshot {
  uptimeMs: number;
  workingSetBytes?: number;
  memorySource: string;
  lastSshTerminalReadyMs?: number;
  lastSshTerminalReadyAtUnixSeconds?: number;
}

export interface HostUsageSnapshot {
  cpuPercent?: number;
  ramPercent?: number;
  networkDownstreamBytesPerSecond?: number;
  networkUpstreamBytesPerSecond?: number;
  sampledAtUnixSeconds: number;
  source: string;
}

export interface SystemPerformanceCountersSnapshot {
  cpuPercent?: number;
  logicalProcessorCount?: number;
  ramPercent?: number;
  ramTotalBytes?: number;
  ramAvailableBytes?: number;
  commitPercent?: number;
  commitTotalBytes?: number;
  commitLimitBytes?: number;
  systemCacheBytes?: number;
  handleCount?: number;
  processCount?: number;
  threadCount?: number;
  networkDownstreamBytesPerSecond?: number;
  networkUpstreamBytesPerSecond?: number;
  appWorkingSetBytes?: number;
  appPrivateBytes?: number;
  appPagefileBytes?: number;
  appReadBytesPerSecond?: number;
  appWriteBytesPerSecond?: number;
  appOtherBytesPerSecond?: number;
  systemUptimeSeconds?: number;
  systemDriveTotalBytes?: number;
  systemDriveFreeBytes?: number;
  systemDriveFreePercent?: number;
  sampledAtUnixSeconds: number;
  source: string;
}

export interface TerminalStartMetric {
  kind: "local" | "ssh" | "telnet" | "serial";
  title: string;
  durationMs: number;
  recordedAt: string;
}

export interface PerformanceMetrics {
  frontendLaunchMs?: number;
  backendUptimeMs?: number;
  workingSetBytes?: number;
  memorySource?: string;
  hostUsage?: HostUsageSnapshot;
  lastTerminalStart?: TerminalStartMetric;
  lastLocalTerminalStart?: TerminalStartMetric;
  lastSshTerminalStart?: TerminalStartMetric;
}

export interface StatusBarNotice {
  id: number;
  message: string;
  tone: "success" | "info" | "warning" | "error";
  durationMs: number;
  expiresAt: number | null;
  progress?: number;
  cancelLabel?: string;
  onCancel?: () => void;
}

export type SecretKind =
  | "connectionPassword"
  | "connectionPassphrase"
  | "sshSocksProxyPassword"
  | "urlPassword"
  | "aiApiKey"
  | "braveSearchApiKey"
  | "tavilySearchApiKey"
  | "emailApiKey"
  | "emailSmtpPassword"
  | "widgetSecret"
  | "itopsTaskSecret";

export interface KeychainStatus {
  available: boolean;
  service: string;
  backend: string;
  selectedStore: SecretStoreKind;
  availableStores: SecretStoreKind[];
  encryptedStoreExists?: boolean;
}

export interface UrlCredentialSummary {
  connectionId: string;
  pageKey: string;
  secretOwnerId: string;
  connectionName: string;
  url?: string;
  pageUrl?: string;
  username: string;
  usernameSelector?: string;
  passwordSelector?: string;
  fieldValues?: string;
  updatedAt: string;
}

export interface UrlDataPartitionSummary {
  name: string;
  connectionCount: number;
}

export interface SecretReferenceRequest {
  kind: SecretKind;
  ownerId: string;
}

export interface StoreSecretRequest extends SecretReferenceRequest {
  secret: string;
}

export interface SecretPresence {
  exists: boolean;
}

export type StoredCredentialKind =
  | "connectionPassword"
  | "urlPassword"
  | "aiApiKey"
  | "emailApiKey"
  | "emailSmtpPassword"
  | "widgetSecret";

export interface StoredCredentialSummary {
  id: string;
  kind: StoredCredentialKind;
  secretKind: SecretKind;
  ownerId: string;
  label: string;
  detail?: string;
  connectionType?: ConnectionType;
  host?: string;
  username?: string;
  updatedAt?: string;
  metadataSource: string;
  exists: boolean;
}

export interface ConnectionPasswordCredentialSummary {
  id: string;
  connectionType: ConnectionType;
  username: string;
  label: string;
  createdFromConnectionId?: string | null;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

export interface ConnectionPasswordCredentialEntry extends ConnectionPasswordCredentialSummary {
  secretExists: boolean;
}

export interface ConnectionPasswordCredentialUsage {
  connectionId: string;
  name: string;
  connectionType: ConnectionType;
  host: string;
  username: string;
}

export interface DeleteStoredCredentialRequest {
  kind: StoredCredentialKind;
  ownerId: string;
}

export type AssistantContextSnippet =
  | {
      id: string;
      kind: "text";
      sourceLabel: string;
      text: string;
      capturedAt: string;
    }
  | {
      id: string;
      kind: "screenshot";
      sourceLabel: string;
      imageDataUrl: string;
      width: number;
      height: number;
      capturedAt: string;
    };

export interface AssistantDirectSubmitRequest {
  id: string;
  prompt: string;
  snippet: AssistantContextSnippet;
}

export type ConnectionType =
  | "local"
  | "ssh"
  | "telnet"
  | "serial"
  | "url"
  | "rdp"
  | "vnc"
  | "ftp";
export type ConnectionStatus = "connected" | "idle" | "offline";
export type SshAuthMethod = "keyFile" | "password" | "agent";

export interface Connection {
  id: string;
  name: string;
  host: string;
  user: string;
  port?: number;
  keyPath?: string;
  proxyJump?: string;
  authMethod?: SshAuthMethod;
  hasPassword?: boolean;
  localShell?: string;
  localStartupDirectory?: string;
  localStartupScript?: string;
  serialLine?: string;
  serialSpeed?: number;
  url?: string;
  dataPartition?: string;
  useTmuxSessions?: boolean;
  tmuxConnectionId?: string;
  urlCredentialUsername?: string;
  hasUrlCredential?: boolean;
  iconDataUrl?: string | null;
  iconBackgroundColor?: string | null;
  rdpOptions?: RdpConnectionOptions;
  vncOptions?: VncConnectionOptions;
  ftpOptions?: FtpConnectionOptions;
  type: ConnectionType;
  status: ConnectionStatus;
}

export interface ConnectionFolder {
  id: string;
  name: string;
  connections: Connection[];
  folders: ConnectionFolder[];
}

export interface ConnectionTree {
  connections: Connection[];
  folders: ConnectionFolder[];
}

export interface CreateConnectionRequest {
  name: string;
  host?: string;
  user?: string;
  type: ConnectionType;
  folderId?: string;
  port?: number;
  keyPath?: string;
  proxyJump?: string;
  authMethod?: SshAuthMethod;
  localShell?: string;
  localStartupDirectory?: string;
  localStartupScript?: string;
  serialLine?: string;
  serialSpeed?: number;
  url?: string;
  dataPartition?: string;
  useTmuxSessions?: boolean;
  rdpOptions?: RdpConnectionOptions;
  vncOptions?: VncConnectionOptions;
  ftpOptions?: FtpConnectionOptions;
}

export interface CreateConnectionFolderRequest {
  name: string;
  parentFolderId?: string;
}

export interface RenameConnectionFolderRequest {
  id: string;
  name: string;
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
  title: string;
  toolbarTitle?: string;
  cwd: string;
  buffer: string;
  connection?: Connection;
  tmuxSessionId?: string;
}

export interface UrlPane {
  kind: "webview";
  id: string;
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
  title: string;
  toolbarTitle?: string;
  connection: Connection;
}

export type WorkspacePane = TerminalPane | UrlPane | RemoteDesktopPane;

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
  connection: Connection;
  title?: string;
  cwd?: string;
  tmuxSessionId?: string;
}

export type TerminalCursorStyle = "block" | "bar" | "underline";

export interface GeneralSettings {
  autoBackupEnabled: boolean;
  autoUpdateChecksEnabled: boolean;
  showConnectedConnectionsInRail: boolean;
  pinnedConnectionIds: string[];
  allowClipboardRead: boolean;
  autoStartWithWindows: boolean;
  minimizeToTray: boolean;
  dontSleepEnabled: boolean;
  lastBackupAt?: string | null;
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

export interface ImportedDatabaseSnapshot {
  generalSettings: GeneralSettings;
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
  copyOnSelect: boolean;
  allowOsc52Clipboard: boolean;
  confirmMultilinePaste: boolean;
  defaultShell: string;
}

export type ColorScheme =
  | "default"
  | "dark"
  | "light"
  | "mac"
  | "orange"
  | "purple"
  | "pink"
  | "green-kuai-kuai"
  | "blue-see"
  | "confetti"
  | "bubble-tea";

export interface AppearanceSettings {
  appFontFamily: string;
  colorScheme: ColorScheme;
  customFontPath?: string;
}

export interface CustomFont {
  name: string;
  path: string;
  extension: string;
}

export interface SshSettings {
  defaultUser: string;
  defaultPort: number;
  defaultKeyPath?: string;
  defaultProxyJump?: string;
  bufferLines: number;
  hideCommonPortRedirects: boolean;
  allowOsc52Clipboard: boolean;
}

export type SftpOverwriteBehavior = "fail" | "overwrite";

export interface SftpSettings {
  overwriteBehavior: SftpOverwriteBehavior;
}

export interface UrlSettings {
  ignoreCertificateErrors: boolean;
}

export type RdpPerformanceProfile = "balanced" | "quality" | "speed";
export type RdpColorDepth = 15 | 16 | 24 | 32;

export interface RdpSettings {
  colorDepth: RdpColorDepth;
  redirectClipboard: boolean;
  redirectDrives: boolean;
  bitmapCache: boolean;
  performanceProfile: RdpPerformanceProfile;
}

export interface RdpConnectionOptions {
  inheritDefaults: boolean;
  colorDepth?: RdpColorDepth;
  redirectClipboard?: boolean;
  redirectDrives?: boolean;
  bitmapCache?: boolean;
  performanceProfile?: RdpPerformanceProfile;
}

export type VncColorLevel = "full" | "256" | "64" | "8";
export type VncPreferredEncoding = "tight" | "zrle" | "raw";

export interface VncSettings {
  sharedSession: boolean;
  viewOnly: boolean;
  colorLevel: VncColorLevel;
  preferredEncoding: VncPreferredEncoding;
}

export interface VncConnectionOptions {
  inheritDefaults: boolean;
  sharedSession?: boolean;
  viewOnly?: boolean;
  colorLevel?: VncColorLevel;
  preferredEncoding?: VncPreferredEncoding;
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
}

export interface ScreenshotSettings {
  folderPath: string;
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
  | "ollama"
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
  | "connections"
  | "sessions"
  | "tutorial"
  | "manual"
  | "network"
  | "watchdog";

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
  showAllModels: boolean;
  cliExecutionPolicy: "suggestOnly";
  toolPermissionMode: AiToolPermissionMode;
  claudeCliPath?: string;
  codexCliPath?: string;
  disabledSkillNames: string[];
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
  title: string;
  toolbarTitle?: string;
  subtitle: string;
  kind: "terminal" | "sftp" | "webview" | "remoteDesktop" | "ftp";
  panes: WorkspacePane[];
  layout?: LayoutNode;
  focusedPaneId?: string;
  connection?: Connection;
  url?: string;
  dataPartition?: string;
  sshPortForwardSessionId?: string;
  sshPortForwardRemotePort?: number;
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
  expiresAt: number;
}

export type SecretKind =
  | "connectionPassword"
  | "connectionPassphrase"
  | "urlPassword"
  | "aiApiKey"
  | "braveSearchApiKey"
  | "tavilySearchApiKey"
  | "emailApiKey"
  | "emailSmtpPassword"
  | "widgetSecret";

export interface KeychainStatus {
  available: boolean;
  service: string;
  backend: string;
}

export interface UrlCredentialSummary {
  connectionId: string;
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
  username?: string;
  updatedAt?: string;
  metadataSource: string;
  exists: boolean;
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

export interface WikiPageSummary {
  id: string;
  parentId?: string | null;
  title: string;
  slug: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WikiPageNode extends WikiPageSummary {
  children: WikiPageNode[];
}

export interface WikiTree {
  roots: WikiPageNode[];
}

export interface WikiAttachment {
  id: string;
  pageId: string;
  filename: string;
  relativePath: string;
  mime?: string | null;
  bytes: number;
  createdAt: string;
}

export interface WikiPage {
  id: string;
  parentId?: string | null;
  title: string;
  slug: string;
  bodyMd: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  connectionIds: string[];
  backlinks: WikiPageReference[];
  tags: string[];
  attachments: WikiAttachment[];
}

export interface WikiSearchHit {
  id: string;
  title: string;
  slug: string;
  snippet: string;
}

export interface WikiPageReference {
  id: string;
  title: string;
  slug: string;
}

export interface WikiExportInfo {
  path: string;
  filename: string;
  pageCount: number;
  attachmentCount: number;
}

export interface CreateWikiPageRequest {
  title: string;
  parentId?: string | null;
}

export interface UpdateWikiPageRequest {
  id: string;
  title?: string;
  bodyMd?: string;
  connectionIds?: string[];
}

export interface MoveWikiPageRequest {
  id: string;
  newParentId?: string | null;
  sortOrder: number;
}

export interface SaveWikiAttachmentRequest {
  pageId: string;
  filename: string;
  dataBase64: string;
  mime?: string;
}

export interface DeleteWikiAttachmentRequest {
  attachmentId: string;
}

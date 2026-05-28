import { invoke, Channel } from "@tauri-apps/api/core";
import { getVersion as getTauriAppVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  confirm as confirmDialog,
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import type { ConfirmDialogOptions } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import i18next from "../i18n/config";
import type {
  AppearanceSettings,
  AiProviderSettings,
  AppBootstrap,
  AppLauncherLaunchMode,
  AppLauncherSettings,
  Connection,
  ConnectionFolder,
  ConnectionTree,
  CustomFont,
  DashboardSettings,
  DatabaseBackupInfo,
  FtpConnectionOptions,
  GeneralSettings,
  HostUsageSnapshot,
  ImportedDatabaseSnapshot,
  CreateConnectionFolderRequest,
  CreateConnectionRequest,
  DuplicateConnectionRequest,
  KeychainStatus,
  MoveConnectionFolderRequest,
  MoveConnectionRequest,
  PerformanceSnapshot,
  PreparedAppLauncherEntry,
  RenameConnectionFolderRequest,
  RenameConnectionRequest,
  RdpSettings,
  SecretPresence,
  SecretReferenceRequest,
  StoredCredentialSummary,
  SftpSettings,
  ScreenshotSettings,
  SshSettings,
  StoreSecretRequest,
  SystemPerformanceCountersSnapshot,
  DeleteStoredCredentialRequest,
  TerminalSettings,
  UpdateConnectionRequest,
  UrlCredentialSummary,
  UrlDataPartitionSummary,
  UrlSettings,
  VncSettings,
} from "../types";
import type {
  DashboardCustomWidget,
  DashboardLoadState,
  DashboardView,
  DashboardWidgetInstance,
  CustomWidgetPatch,
  InstancePatch,
  LayoutEntry,
  ViewPatch,
  WidgetKind,
  WidgetPreset,
  AccentName,
  IconName,
  GridDensity,
} from "../modules/dashboard/types";
import type {
  AiCodingUsageProvider,
  AiCodingUsageProviderState,
  AiCodingUsageState,
} from "../modules/dashboard/widgets/builtin/ai-coding-usage/types";

type BrowserFileHandle = {
  createWritable: () => Promise<{
    close: () => Promise<void>;
    write: (contents: string) => Promise<void>;
  }>;
};

type BrowserSavePicker = (options: {
  suggestedName: string;
  types: Array<{
    accept: Record<string, string[]>;
    description: string;
  }>;
}) => Promise<BrowserFileHandle>;

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: BrowserSavePicker;
};

export interface StartTerminalSessionRequest {
  sessionId?: string;
  title: string;
  type: "local" | "ssh" | "telnet" | "serial";
  host: string;
  user: string;
  url?: string;
  port?: number;
  keyPath?: string;
  proxyJump?: string;
  authMethod?: "keyFile" | "password" | "agent";
  secretOwnerId?: string;
  shell?: string;
  serialLine?: string;
  serialSpeed?: number;
  initialDirectory?: string;
  cols?: number;
  pixelHeight?: number;
  pixelWidth?: number;
  rows?: number;
  useTmux?: boolean;
  tmuxSessionId?: string;
  sshBufferLines?: number;
}

export interface TerminalSessionStarted {
  sessionId: string;
  terminalReadyMs?: number;
}

export interface TerminalOutput {
  sessionId: string;
  data: string;
}

export interface TerminalRecordingInfo {
  sessionId: string;
  connectionId: string;
  connectionName: string;
  startedAtMillis: number;
  path: string;
}

export interface TerminalRecordingEntry {
  fileName: string;
  path: string;
  sizeBytes: number;
  modifiedAtMillis?: number;
}

export interface TmuxSession {
  id: string;
  attached: boolean;
  windows: number;
  created?: number;
  internalId?: string;
}

export interface RemoteLoopbackPort {
  port: number;
  address: string;
}

export interface SshPortForwardStarted {
  forwardId: string;
  localPort: number;
  remotePort: number;
  url: string;
}

export interface StartSftpSessionRequest {
  sessionId?: string;
  title: string;
  host: string;
  user: string;
  url?: string;
  port?: number;
  keyPath?: string;
  proxyJump?: string;
  authMethod?: "keyFile" | "password" | "agent";
  secretOwnerId?: string;
  path?: string;
}

export interface SftpDirectoryEntry {
  name: string;
  kind: "file" | "folder" | "symlink" | "other";
  size?: number;
  modified?: number;
  accessed?: number;
  permissions?: number;
  uid?: number;
  user?: string;
  gid?: number;
  group?: string;
}

export interface SftpDirectoryListing {
  sessionId: string;
  path: string;
  entries: SftpDirectoryEntry[];
}

export interface SftpSessionStarted extends SftpDirectoryListing {}

export interface LocalDirectoryEntry {
  name: string;
  kind: "file" | "folder" | "symlink" | "other";
  size?: number;
  modified?: number;
}

export interface LocalDirectoryListing {
  path: string;
  entries: LocalDirectoryEntry[];
}

export interface SftpTransferResult {
  name: string;
  files: number;
  folders: number;
  bytes: number;
}

export interface SftpTransferProgress {
  transferId: string;
  transferredBytes: number;
  totalBytes: number;
  progress: number;
}

export interface SftpPathProperties {
  path: string;
  name: string;
  kind: "file" | "folder" | "symlink" | "other";
  size?: number;
  modified?: number;
  accessed?: number;
  permissions?: number;
  mode?: string;
  uid?: number;
  user?: string;
  gid?: number;
  group?: string;
}

export interface StartFtpSessionRequest {
  sessionId?: string;
  title: string;
  host: string;
  user: string;
  port?: number;
  secretOwnerId?: string;
  path?: string;
  options: FtpConnectionOptions;
}

export interface FtpDirectoryEntry {
  name: string;
  kind: "file" | "folder" | "symlink" | "other";
  size?: number;
  modified?: number;
  permissions?: number;
  user?: string;
  group?: string;
}

export interface FtpDirectoryListing {
  sessionId: string;
  path: string;
  entries: FtpDirectoryEntry[];
}

export interface FtpSessionStarted extends FtpDirectoryListing {
  welcome?: string;
  features: string[];
}

export interface FtpTransferResult {
  name: string;
  files: number;
  folders: number;
  bytes: number;
}

export interface FtpTransferProgress {
  transferId: string;
  transferredBytes: number;
  totalBytes: number;
  progress: number;
}

export interface FtpPathProperties {
  path: string;
  name: string;
  kind: "file" | "folder" | "symlink" | "other";
  size?: number;
  modified?: number;
  permissions?: number;
  mode?: string;
  user?: string;
  group?: string;
}

export interface SshTransportPlan {
  primaryLibrary: string;
  sftpCandidate: string;
  fallbackLibrary: string;
  systemSshRole: string;
}

export interface SshConfigConnectionDraft extends CreateConnectionRequest {}

export interface UnsupportedSshDirective {
  line: number;
  hostPattern?: string;
  directive: string;
  value: string;
}

export interface SshConfigImportPreview {
  drafts: SshConfigConnectionDraft[];
  unsupportedDirectives: UnsupportedSshDirective[];
}

export type ImportFileFormat = "csv" | "tsv" | "rdcman" | "mobaxterm" | "putty" | "bookmarks";

export interface ImportedConnectionDraft {
  name: string;
  host: string;
  user: string;
  url?: string;
  port?: number;
  type: "local" | "ssh" | "telnet" | "serial" | "url" | "rdp" | "vnc";
  folderPath: string[];
}

export interface ImportFilePreview {
  format: ImportFileFormat;
  drafts: ImportedConnectionDraft[];
  warnings: string[];
}

export interface BookmarkTreeNode {
  id: string;
  name: string;
  type: "folder" | "bookmark";
  url?: string;
  children: BookmarkTreeNode[];
}

export interface BookmarkImportSource {
  id: string;
  label: string;
  browser: string;
  path: string;
  root: BookmarkTreeNode;
  warnings: string[];
}

export interface BrowserBookmarkSourcesResponse {
  sources: BookmarkImportSource[];
}

export interface ScanResultEntry {
  host: string;
  port: number;
  type: "ssh" | "telnet" | "rdp" | "vnc";
}

export interface ScanNetworkResponse {
  results: ScanResultEntry[];
  scannedHosts: number;
}

export interface ScanProgressEvent {
  scanId: string;
  completed: number;
  total: number;
}

export interface SshHostKeyPreview {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  publicKey: string;
  status: "trusted" | "unknown" | "changed";
}

export interface GeneratedSshKeyPair {
  privateKeyPath: string;
  publicKeyPath: string;
}

export interface TransferSshPublicKeyResult {
  publicKeyPath: string;
}

export interface TrayRecentConnection {
  id: string;
  label: string;
}

export interface TrayMenuSnapshot {
  recentConnections: TrayRecentConnection[];
  dontSleepLabel: string;
  exitLabel: string;
}

export interface CommandProposalPlan {
  prompt: string;
  command: string;
  reason: string;
  contextLabel: string;
  riskLabel: string;
  approvalRequired: boolean;
  extraConfirmationRequired: boolean;
  safetyNotes: string[];
}

export interface AgentChatMessage {
  role: "assistant" | "user";
  content: string;
  reasoningContent?: string;
}

export interface AssistantSkillSummary {
  name: string;
  description: string;
  enabled: boolean;
  folderPath: string;
  invalidReason?: string | null;
}

  export interface AgentRunRequest {
    prompt: string;
    contextLabel: string;
    intent?: "chat" | "extensionCreation";
    selectedOutput?: string;
    pageContext?: {
      sourceLabel: string;
      text: string;
    };
    screenshot?: {
      sourceLabel: string;
      dataUrl: string;
  };
  screenshots?: Array<{
    sourceLabel: string;
    dataUrl: string;
  }>;
  files?: Array<{
    sourceLabel: string;
    fileData?: string;
    dataUrl?: string;
    mimeType?: string;
    text?: string;
  }>;
  systemContext?: string;
  messages: AgentChatMessage[];
  outputLanguage?: string;
  allowTools?: boolean;
}

export interface AgentRunResponse {
  providerKind: string;
  model: string;
  content: string;
  reasoningContent?: string;
}

export type AiStreamEvent =
  | { type: "reasoningDelta"; delta: string }
  | { type: "contentDelta"; delta: string }
  | { type: "toolCallStart"; toolId: string; toolName: string }
  | { type: "toolCallEnd"; toolId: string; toolName: string; error?: string }
  | { type: "skillInvocation"; skillName: string }
  | { type: "done"; model: string; providerKind: string }
  | { type: "error"; message: string };

export interface DiagnosticsBundle {
  path: string;
  files: string[];
  warnings: string[];
}

export interface CaptureScreenshotRequest {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AssistantScreenshot {
  dataUrl: string;
  width: number;
  height: number;
}

export interface StoredScreenshot {
  id: string;
  path: string;
  fileName: string;
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
  label: string;
  kind: "region" | "window" | "fullscreen" | "screenshot";
}

export interface ListScreenshotsResponse {
  screenshots: StoredScreenshot[];
  total: number;
  hasMore: boolean;
}

export interface StartWebviewSessionRequest {
  sessionId: string;
  url: string;
  dataPartition?: string;
  ignoreCertificateErrors?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebviewSessionStarted {
  sessionId: string;
  label: string;
  partition: string;
  externalLinkToken: string;
}

export interface UpdateWebviewBoundsRequest {
  sessionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SetWebviewVisibilityRequest {
  sessionId: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebviewNavigateRequest {
  sessionId: string;
  url: string;
}

export interface WebviewSimpleRequest {
  sessionId: string;
}

export interface WebviewCaptureCredentialRequest extends WebviewSimpleRequest {
  nonce: string;
}

export interface FillWebviewCredentialRequest {
  sessionId: string;
  secretOwnerId: string;
  automatic?: boolean;
}

export interface StartRdpSessionRequest {
  sessionId: string;
  host: string;
  user: string;
  url?: string;
  port?: number;
  secretOwnerId?: string;
  password?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  options?: RdpSettings;
}

export interface RdpSessionStarted {
  sessionId: string;
  host: string;
  port: number;
  control: string;
}

export interface RdpSessionStatus {
  sessionId: string;
  connectionState: number;
  connected: boolean;
}

export interface UpdateRdpBoundsRequest {
  sessionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SetRdpVisibilityRequest {
  sessionId: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SyncRdpDisplaySizeRequest {
  sessionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RdpDisplaySizeSync {
  sessionId: string;
  connectionState: number;
  connected: boolean;
  displaySynced: boolean;
  desktopWidth: number;
  desktopHeight: number;
}

export interface RdpSimpleRequest {
  sessionId: string;
}

export type RdpTextMode = "clipboard" | "sendKeys";

export interface SendRdpTextRequest {
  sessionId: string;
  text: string;
  mode?: RdpTextMode;
  pressEnter?: boolean;
}

export interface SendRdpKeyPressRequest {
  sessionId: string;
  key: string;
}

export interface SendRdpMouseClickRequest {
  sessionId: string;
  x: number;
  y: number;
  button: "left" | "right" | "middle";
}

export interface RdpTextSent {
  sessionId: string;
  mode: RdpTextMode;
  fellBack: boolean;
  charCount: number;
}

export interface StartVncSessionRequest {
  sessionId: string;
  host: string;
  port?: number;
  secretOwnerId?: string;
  password?: string;
  options?: VncSettings;
}

export interface VncSessionStarted {
  sessionId: string;
  host: string;
  port: number;
}

export interface VncSessionStatus {
  sessionId: string;
  connected: boolean;
}

export interface VncPointerEventRequest {
  sessionId: string;
  x: number;
  y: number;
  buttonMask: number;
}

export interface VncKeyEventRequest {
  sessionId: string;
  key: number;
  down: boolean;
}

export interface VncSimpleRequest {
  sessionId: string;
}

export interface GitHubCopilotDeviceFlow {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type GitHubCopilotDevicePollStatus = "pending" | "slowDown" | "authorized";

export interface GitHubCopilotDevicePollResponse {
  status: GitHubCopilotDevicePollStatus;
  interval?: number | null;
}

export interface GitHubCopilotModelOption {
  id: string;
  label: string;
  supportsImageInput?: boolean | null;
}

export interface AiProviderModelOption {
  id: string;
  label: string;
  supportsImageInput?: boolean | null;
}

export interface AssistantChatThreadRecord {
  id: string;
  title: string;
  contextLabel: string;
  messagesJson: string;
  createdAt: string;
  updatedAt: string;
}

export type NetError = {
  kind:
    | "timeout" | "refused" | "unreachable" | "hostNotFound" | "permissionDenied"
    | "invalidArgument" | "resolverError" | "cancelled" | "concurrencyLimit"
    | "policyDisabled" | "internal";
  hint?: string;
  reason?: string;
};

type CommandMap = {
  app_bootstrap: {
    args: undefined;
    result: AppBootstrap;
  };
  is_debug_build: {
    args: undefined;
    result: boolean;
  };
  debug_frontend_heartbeat: {
    args: {
      heartbeat: {
        documentHasFocus: boolean;
        visibilityState: string;
        rafAgeMs: number | null;
        pointerAgeMs: number | null;
        keyAgeMs: number | null;
        windowFocusAgeMs: number | null;
        windowBlurAgeMs: number | null;
      };
    };
    result: void;
  };
  list_connection_tree: {
    args: undefined;
    result: ConnectionTree;
  };
  create_connection: {
    args: { request: CreateConnectionRequest };
    result: Connection;
  };
  create_connection_folder: {
    args: { request: CreateConnectionFolderRequest };
    result: ConnectionFolder;
  };
  rename_connection_folder: {
    args: { request: RenameConnectionFolderRequest };
    result: ConnectionFolder;
  };
  delete_connection_folder: {
    args: { folderId: string };
    result: null;
  };
  rename_connection: {
    args: { request: RenameConnectionRequest };
    result: Connection;
  };
  update_connection: {
    args: { request: UpdateConnectionRequest };
    result: Connection;
  };
  update_connection_icon_data_url: {
    args: { connectionId: string; iconDataUrl?: string | null };
    result: Connection | null;
  };
  update_connection_icon_background_color: {
    args: { connectionId: string; iconBackgroundColor?: string | null };
    result: Connection | null;
  };
  update_connection_tab_title: {
    args: { connectionId: string; tabTitle?: string | null };
    result: Connection | null;
  };
  delete_connection: {
    args: { connectionId: string };
    result: null;
  };
  duplicate_connection: {
    args: { request: DuplicateConnectionRequest };
    result: Connection;
  };
  move_connection_folder: {
    args: { request: MoveConnectionFolderRequest };
    result: ConnectionTree;
  };
  move_connection: {
    args: { request: MoveConnectionRequest };
    result: ConnectionTree;
  };
  update_url_connection_icon_from_page: {
    args: { connectionId: string; pageUrl: string };
    result: Connection | null;
  };
  upsert_url_credential: {
    args: {
      request: {
        connectionId: string;
        username: string;
        pageUrl?: string;
        usernameSelector?: string;
        passwordSelector?: string;
        fieldValues?: string;
      };
    };
    result: Connection;
  };
  list_url_credentials: {
    args: undefined;
    result: UrlCredentialSummary[];
  };
  delete_url_credential: {
    args: { connectionId: string };
    result: null;
  };
  list_url_data_partitions: {
    args: undefined;
    result: UrlDataPartitionSummary[];
  };
  clear_url_data_partition: {
    args: { name: string };
    result: null;
  };
  get_general_settings: {
    args: undefined;
    result: GeneralSettings;
  };
  update_general_settings: {
    args: { request: GeneralSettings };
    result: GeneralSettings;
  };
  get_app_launcher_settings: {
    args: undefined;
    result: AppLauncherSettings;
  };
  update_app_launcher_settings: {
    args: { request: AppLauncherSettings };
    result: AppLauncherSettings;
  };
  get_dashboard_settings: {
    args: undefined;
    result: DashboardSettings;
  };
  update_dashboard_settings: {
    args: { request: DashboardSettings };
    result: DashboardSettings;
  };
  prepare_app_launcher_entry: {
    args: { request: { path: string } };
    result: PreparedAppLauncherEntry;
  };
  launch_app_launcher_entry: {
    args: {
      request: {
        path: string;
        arguments?: string | null;
        workingDirectory?: string | null;
        mode: AppLauncherLaunchMode;
      };
    };
    result: null;
  };
  import_settings_database: {
    args: { path: string };
    result: ImportedDatabaseSnapshot;
  };
  export_settings_database: {
    args: { path: string };
    result: DatabaseBackupInfo;
  };
  get_database_folder: {
    args: undefined;
    result: string;
  };
  get_terminal_settings: {
    args: undefined;
    result: TerminalSettings;
  };
  update_terminal_settings: {
    args: { request: TerminalSettings };
    result: TerminalSettings;
  };
  get_appearance_settings: {
    args: undefined;
    result: AppearanceSettings;
  };
  update_appearance_settings: {
    args: { request: AppearanceSettings };
    result: AppearanceSettings;
  };
  get_custom_fonts_folder: {
    args: undefined;
    result: string;
  };
  open_custom_fonts_folder: {
    args: undefined;
    result: void;
  };
  list_custom_fonts: {
    args: undefined;
    result: CustomFont[];
  };
  load_custom_font_data: {
    args: { path: string };
    result: { dataBase64: string };
  };
  get_ssh_settings: {
    args: undefined;
    result: SshSettings;
  };
  update_ssh_settings: {
    args: { request: SshSettings };
    result: SshSettings;
  };
  generate_ssh_key_pair: {
    args: { request: { email: string } };
    result: GeneratedSshKeyPair;
  };
  transfer_ssh_public_key: {
    args: {
      request: {
        host: string;
        port?: number;
        username: string;
        password: string;
        keyPath?: string;
        proxyJump?: string;
      };
    };
    result: TransferSshPublicKeyResult;
  };
  get_sftp_settings: {
    args: undefined;
    result: SftpSettings;
  };
  update_sftp_settings: {
    args: { request: SftpSettings };
    result: SftpSettings;
  };
  get_url_settings: {
    args: undefined;
    result: UrlSettings;
  };
  update_url_settings: {
    args: { request: UrlSettings };
    result: UrlSettings;
  };
  get_rdp_settings: {
    args: undefined;
    result: RdpSettings;
  };
  update_rdp_settings: {
    args: { request: RdpSettings };
    result: RdpSettings;
  };
  get_vnc_settings: {
    args: undefined;
    result: VncSettings;
  };
  update_vnc_settings: {
    args: { request: VncSettings };
    result: VncSettings;
  };
  get_ai_provider_settings: {
    args: undefined;
    result: AiProviderSettings;
  };
  update_ai_provider_settings: {
    args: { request: AiProviderSettings };
    result: AiProviderSettings;
  };
  list_assistant_skills: {
    args: undefined;
    result: AssistantSkillSummary[];
  };
  set_assistant_skill_enabled: {
    args: { name: string; enabled: boolean };
    result: AiProviderSettings;
  };
  open_assistant_skills_folder: {
    args: undefined;
    result: null;
  };
  open_assistant_skill: {
    args: { name: string };
    result: null;
  };
  get_built_in_mcp_command_path: {
    args: undefined;
    result: string;
  };
  open_built_in_mcp_config_location: {
    args: {
      location: "codex" | "claudeCode" | "antigravity" | "githubCopilot" | "openCode";
    };
    result: null;
  };
  list_assistant_chat_threads: {
    args: undefined;
    result: AssistantChatThreadRecord[];
  };
  upsert_assistant_chat_thread: {
    args: { request: AssistantChatThreadRecord };
    result: AssistantChatThreadRecord;
  };
  delete_assistant_chat_thread: {
    args: { threadId: string };
    result: null;
  };
  start_github_copilot_device_flow: {
    args: undefined;
    result: GitHubCopilotDeviceFlow;
  };
  poll_github_copilot_device_flow: {
    args: { request: { deviceCode: string } };
    result: GitHubCopilotDevicePollResponse;
  };
  list_github_copilot_models: {
    args: undefined;
    result: GitHubCopilotModelOption[];
  };
  list_ai_provider_models: {
    args: {
      request: {
        providerKind: string;
        baseUrl: string;
        extraHeaders?: string;
        allowInsecureTls?: boolean;
      };
    };
    result: AiProviderModelOption[];
  };
  plan_command_proposal: {
    args: {
      request: {
        prompt: string;
        command: string;
        reason: string;
        contextLabel: string;
        selectedOutput?: string;
      };
    };
    result: CommandProposalPlan;
  };
  complete_assistant_live_tool_request: {
    args: { completion: { requestId: string; result: string } };
    result: null;
  };
  complete_assistant_tool_approval_request: {
    args: { completion: { requestId: string; approved: boolean } };
    result: null;
  };
  run_ai_agent: {
    args: { request: AgentRunRequest };
    result: AgentRunResponse;
  };
  run_ai_agent_streaming: {
    args: { channel: Channel<AiStreamEvent>; request: AgentRunRequest };
    result: AgentRunResponse;
  };
  ai_coding_usage_load: {
    args: undefined;
    result: AiCodingUsageState;
  };
  ai_coding_usage_connect: {
    args: { provider: AiCodingUsageProvider };
    result: AiCodingUsageProviderState;
  };
  ai_coding_usage_refresh: {
    args: { provider?: AiCodingUsageProvider | null };
    result: AiCodingUsageState;
  };
  ai_coding_usage_reconnect: {
    args: { provider: AiCodingUsageProvider };
    result: AiCodingUsageProviderState;
  };
  ai_coding_usage_disconnect: {
    args: { provider: AiCodingUsageProvider };
    result: AiCodingUsageProviderState;
  };
  keychain_status: {
    args: undefined;
    result: KeychainStatus;
  };
  get_performance_snapshot: {
    args: undefined;
    result: PerformanceSnapshot;
  };
  get_host_usage_snapshot: {
    args: undefined;
    result: HostUsageSnapshot;
  };
  get_system_performance_counters: {
    args: undefined;
    result: SystemPerformanceCountersSnapshot;
  };
  create_diagnostics_bundle: {
    args: undefined;
    result: DiagnosticsBundle;
  };
  get_dont_sleep_enabled: {
    args: undefined;
    result: boolean;
  };
  set_dont_sleep_enabled: {
    args: { enabled: boolean };
    result: boolean;
  };
  update_tray_menu: {
    args: { snapshot: TrayMenuSnapshot };
    result: null;
  };
  capture_screenshot_to_clipboard: {
    args: { request: CaptureScreenshotRequest };
    result: null;
  };
  capture_screenshot_for_assistant: {
    args: { request: CaptureScreenshotRequest };
    result: AssistantScreenshot;
  };
  get_screenshot_settings: {
    args: undefined;
    result: ScreenshotSettings;
  };
  update_screenshot_settings: {
    args: { request: ScreenshotSettings };
    result: ScreenshotSettings;
  };
  capture_fullscreen_screenshot_for_assistant: {
    args: undefined;
    result: AssistantScreenshot;
  };
  capture_screenshot_to_library: {
    args: { request: CaptureScreenshotRequest; kind: StoredScreenshot["kind"] };
    result: StoredScreenshot;
  };
  capture_fullscreen_screenshot_to_library: {
    args: { kind: StoredScreenshot["kind"] };
    result: StoredScreenshot;
  };
  capture_active_window_screenshot_to_library: {
    args: { kind: StoredScreenshot["kind"] };
    result: StoredScreenshot;
  };
  capture_interactive_region_screenshot_to_library: {
    args: { kind: StoredScreenshot["kind"] };
    result: StoredScreenshot;
  };
  list_screenshots: {
    args: { request: { offset?: number; limit?: number } };
    result: ListScreenshotsResponse;
  };
  delete_screenshot: {
    args: { id: string };
    result: null;
  };
  clear_screenshots: {
    args: undefined;
    result: null;
  };
  ssh_transport_plan: {
    args: undefined;
    result: SshTransportPlan;
  };
  import_ssh_config: {
    args: { request: { content: string; folderId?: string } };
    result: SshConfigImportPreview;
  };
  parse_import_file: {
    args: { request: { path: string } };
    result: ImportFilePreview;
  };
  list_browser_bookmark_sources: {
    args: undefined;
    result: BrowserBookmarkSourcesResponse;
  };
  preview_browser_bookmark_import: {
    args: { request: { sourceId: string; selectedNodeIds: string[] } };
    result: ImportFilePreview;
  };
  scan_network_for_connections: {
    args: {
      request: {
        scanId: string;
        target: string;
        ports: number[];
      };
    };
    result: ScanNetworkResponse;
  };
  inspect_ssh_host_key: {
    args: { request: { host: string; port?: number } };
    result: SshHostKeyPreview;
  };
  trust_ssh_host_key: {
    args: { request: { host: string; port?: number; publicKey: string } };
    result: SshHostKeyPreview;
  };
  store_secret: {
    args: { request: StoreSecretRequest };
    result: null;
  };
  secret_exists: {
    args: { request: SecretReferenceRequest };
    result: SecretPresence;
  };
  delete_secret: {
    args: { request: SecretReferenceRequest };
    result: null;
  };
  list_stored_credentials: {
    args: undefined;
    result: StoredCredentialSummary[];
  };
  delete_stored_credential: {
    args: { request: DeleteStoredCredentialRequest };
    result: null;
  };
  start_terminal_session: {
    args: { request: StartTerminalSessionRequest };
    result: TerminalSessionStarted;
  };
  write_terminal_input: {
    args: { request: { sessionId: string; data: number[] } };
    result: null;
  };
  resize_terminal: {
    args: {
      request: {
        sessionId: string;
        cols: number;
        pixelHeight?: number;
        pixelWidth?: number;
        rows: number;
      };
    };
    result: null;
  };
  close_terminal_session: {
    args: { sessionId: string };
    result: null;
  };
  start_terminal_recording: {
    args: {
      request: {
        sessionId: string;
        connectionId: string;
        connectionName: string;
        initialBuffer: string;
      };
    };
    result: TerminalRecordingInfo;
  };
  stop_terminal_recording: {
    args: { sessionId: string };
    result: TerminalRecordingInfo | null;
  };
  list_terminal_recordings: {
    args: {
      request: {
        connectionId: string;
        connectionName: string;
      };
    };
    result: TerminalRecordingEntry[];
  };
  open_terminal_recordings_folder: {
    args: {
      request: {
        connectionId: string;
        connectionName: string;
      };
    };
    result: null;
  };
  open_terminal_recording: {
    args: { path: string };
    result: null;
  };
  list_tmux_sessions: {
    args: {
      request: {
        host: string;
        user: string;
        port?: number;
        keyPath?: string;
        proxyJump?: string;
        authMethod?: "keyFile" | "password" | "agent";
        secretOwnerId?: string;
      };
    };
    result: TmuxSession[];
  };
  set_tmux_mouse: {
    args: {
      request: {
        host: string;
        user: string;
        port?: number;
        keyPath?: string;
        proxyJump?: string;
        authMethod?: "keyFile" | "password" | "agent";
        secretOwnerId?: string;
        tmuxSessionId: string;
        enabled: boolean;
      };
    };
    result: null;
  };
  scroll_tmux_pane: {
    args: {
      request: {
        host: string;
        user: string;
        port?: number;
        keyPath?: string;
        proxyJump?: string;
        authMethod?: "keyFile" | "password" | "agent";
        secretOwnerId?: string;
        tmuxSessionId: string;
        lines: number;
      };
    };
    result: null;
  };
  close_tmux_session: {
    args: {
      request: {
        host: string;
        user: string;
        port?: number;
        keyPath?: string;
        proxyJump?: string;
        authMethod?: "keyFile" | "password" | "agent";
        secretOwnerId?: string;
        tmuxSessionId: string;
      };
    };
    result: null;
  };
  rename_tmux_session: {
    args: {
      request: {
        host: string;
        user: string;
        port?: number;
        keyPath?: string;
        proxyJump?: string;
        authMethod?: "keyFile" | "password" | "agent";
        secretOwnerId?: string;
        tmuxSessionId: string;
        newTmuxSessionId: string;
      };
    };
    result: null;
  };
  capture_tmux_pane: {
    args: {
      request: {
        host: string;
        user: string;
        port?: number;
        keyPath?: string;
        proxyJump?: string;
        authMethod?: "keyFile" | "password" | "agent";
        secretOwnerId?: string;
        tmuxSessionId: string;
        bufferLines?: number;
      };
    };
    result: string;
  };
  inspect_ssh_system_context: {
    args: {
      request: {
        host: string;
        user: string;
        port?: number;
        keyPath?: string;
        proxyJump?: string;
        authMethod?: "keyFile" | "password" | "agent";
        secretOwnerId?: string;
      };
    };
    result: string;
  };
  list_remote_loopback_ports: {
    args: {
      request: {
        host: string;
        user: string;
        port?: number;
        keyPath?: string;
        proxyJump?: string;
        authMethod?: "keyFile" | "password" | "agent";
        secretOwnerId?: string;
      };
    };
    result: RemoteLoopbackPort[];
  };
  start_ssh_port_forward: {
    args: {
      request: {
        host: string;
        user: string;
        port?: number;
        keyPath?: string;
        proxyJump?: string;
        authMethod?: "keyFile" | "password" | "agent";
        secretOwnerId?: string;
        remotePort: number;
      };
    };
    result: SshPortForwardStarted;
  };
  close_ssh_port_forward: {
    args: { request: { forwardId: string } };
    result: null;
  };
  is_app_elevated: {
    args: undefined;
    result: boolean;
  };
  launch_elevated_terminal: {
    args: { request: { shell: string } };
    result: null;
  };
  start_sftp_session: {
    args: { request: StartSftpSessionRequest };
    result: SftpSessionStarted;
  };
  list_sftp_directory: {
    args: { request: { sessionId: string; path: string } };
    result: SftpDirectoryListing;
  };
  list_local_directory: {
    args: { request: { path?: string } };
    result: LocalDirectoryListing;
  };
  upload_sftp_path: {
    args: {
      request: {
        sessionId: string;
        transferId: string;
        localPath: string;
        remoteDirectory: string;
        overwriteBehavior: SftpSettings["overwriteBehavior"];
      };
    };
    result: SftpTransferResult;
  };
  download_sftp_path: {
    args: {
      request: {
        sessionId: string;
        transferId: string;
        remotePath: string;
        localDirectory: string;
        overwriteBehavior: SftpSettings["overwriteBehavior"];
      };
    };
    result: SftpTransferResult;
  };
  cancel_sftp_transfer: {
    args: { request: { transferId: string } };
    result: null;
  };
  create_sftp_folder: {
    args: { request: { sessionId: string; parentPath: string; name: string } };
    result: null;
  };
  rename_sftp_path: {
    args: { request: { sessionId: string; path: string; newName: string } };
    result: null;
  };
  delete_sftp_path: {
    args: { request: { sessionId: string; path: string } };
    result: null;
  };
  sftp_path_properties: {
    args: { request: { sessionId: string; path: string } };
    result: SftpPathProperties;
  };
  update_sftp_path_properties: {
    args: {
      request: {
        sessionId: string;
        path: string;
        permissions?: string;
        uid?: number;
        gid?: number;
      };
    };
    result: SftpPathProperties;
  };
  close_sftp_session: {
    args: { sessionId: string };
    result: null;
  };
  start_ftp_session: {
    args: { request: StartFtpSessionRequest };
    result: FtpSessionStarted;
  };
  list_ftp_directory: {
    args: { request: { sessionId: string; path: string } };
    result: FtpDirectoryListing;
  };
  upload_ftp_path: {
    args: {
      request: {
        sessionId: string;
        transferId: string;
        localPath: string;
        remoteDirectory: string;
        overwriteBehavior: SftpSettings["overwriteBehavior"];
      };
    };
    result: FtpTransferResult;
  };
  download_ftp_path: {
    args: {
      request: {
        sessionId: string;
        transferId: string;
        remotePath: string;
        localDirectory: string;
        overwriteBehavior: SftpSettings["overwriteBehavior"];
      };
    };
    result: FtpTransferResult;
  };
  cancel_ftp_transfer: {
    args: { request: { transferId: string } };
    result: null;
  };
  create_ftp_folder: {
    args: { request: { sessionId: string; parentPath: string; name: string } };
    result: null;
  };
  rename_ftp_path: {
    args: { request: { sessionId: string; path: string; newName: string } };
    result: null;
  };
  delete_ftp_path: {
    args: { request: { sessionId: string; path: string } };
    result: null;
  };
  ftp_path_properties: {
    args: { request: { sessionId: string; path: string } };
    result: FtpPathProperties;
  };
  close_ftp_session: {
    args: { sessionId: string };
    result: null;
  };
  start_webview_session: {
    args: { request: StartWebviewSessionRequest };
    result: WebviewSessionStarted;
  };
  update_webview_bounds: {
    args: { request: UpdateWebviewBoundsRequest };
    result: null;
  };
  set_webview_visibility: {
    args: { request: SetWebviewVisibilityRequest };
    result: null;
  };
  webview_navigate: {
    args: { request: WebviewNavigateRequest };
    result: null;
  };
  webview_reload: {
    args: { request: WebviewSimpleRequest };
    result: null;
  };
  webview_go_back: {
    args: { request: WebviewSimpleRequest };
    result: null;
  };
  webview_go_forward: {
    args: { request: WebviewSimpleRequest };
    result: null;
  };
  fill_webview_credential: {
    args: { request: FillWebviewCredentialRequest };
    result: null;
  };
  capture_webview_credential: {
    args: { request: WebviewCaptureCredentialRequest };
    result: null;
  };
  close_webview_session: {
    args: { request: WebviewSimpleRequest };
    result: null;
  };
  start_rdp_session: {
    args: { request: StartRdpSessionRequest };
    result: RdpSessionStarted;
  };
  update_rdp_bounds: {
    args: { request: UpdateRdpBoundsRequest };
    result: null;
  };
  set_rdp_visibility: {
    args: { request: SetRdpVisibilityRequest };
    result: null;
  };
  sync_rdp_display_size: {
    args: { request: SyncRdpDisplaySizeRequest };
    result: RdpDisplaySizeSync;
  };
  close_rdp_session: {
    args: { request: RdpSimpleRequest };
    result: null;
  };
  get_rdp_session_status: {
    args: { request: RdpSimpleRequest };
    result: RdpSessionStatus;
  };
  send_rdp_ctrl_alt_delete: {
    args: { request: RdpSimpleRequest };
    result: null;
  };
  send_rdp_text: {
    args: { request: SendRdpTextRequest };
    result: RdpTextSent;
  };
  send_rdp_key_press: {
    args: { request: SendRdpKeyPressRequest };
    result: null;
  };
  send_rdp_mouse_click: {
    args: { request: SendRdpMouseClickRequest };
    result: null;
  };
  start_vnc_session: {
    args: { request: StartVncSessionRequest };
    result: VncSessionStarted;
  };
  send_vnc_pointer_event: {
    args: { request: VncPointerEventRequest };
    result: null;
  };
  send_vnc_key_event: {
    args: { request: VncKeyEventRequest };
    result: null;
  };
  refresh_vnc_session: {
    args: { request: VncSimpleRequest };
    result: null;
  };
  close_vnc_session: {
    args: { request: VncSimpleRequest };
    result: null;
  };
  get_vnc_session_status: {
    args: { request: VncSimpleRequest };
    result: VncSessionStatus;
  };
  send_vnc_ctrl_alt_delete: {
    args: { request: VncSimpleRequest };
    result: null;
  };
  dashboard_load_state: {
    args: undefined;
    result: DashboardLoadState;
  };
  dashboard_create_view: {
    args: { title: string; gridDensity?: GridDensity };
    result: DashboardView;
  };
  dashboard_update_view: {
    args: { id: string; patch: ViewPatch };
    result: DashboardView;
  };
  dashboard_remove_view: {
    args: { id: string };
    result: null;
  };
  dashboard_reorder_views: {
    args: { orderedIds: string[] };
    result: null;
  };
  dashboard_add_instance: {
    args: {
      viewId: string; kind: WidgetKind; sourceId: string;
      preset: WidgetPreset; accentName: AccentName; iconName: IconName;
      gridX: number; gridY: number; gridW: number; gridH: number;
    };
    result: DashboardWidgetInstance;
  };
  dashboard_update_instance: {
    args: { id: string; patch: InstancePatch };
    result: DashboardWidgetInstance;
  };
  dashboard_read_widget_secret: {
    args: { instanceId: string; key: string };
    result: string | null;
  };
  dashboard_remove_instance: {
    args: { id: string };
    result: null;
  };
  dashboard_apply_layout: {
    args: { viewId: string; layout: LayoutEntry[] };
    result: null;
  };
  dashboard_create_widget: {
    args: {
      viewId: string; title: string; summary: string;
      category: string; body: unknown; settingsSchema?: unknown;
      preset: WidgetPreset; accentName: AccentName; iconName: IconName;
      gridX: number; gridY: number; gridW: number; gridH: number;
    };
    result: { customWidget: DashboardCustomWidget; instance: DashboardWidgetInstance };
  };
  dashboard_create_custom_widget: {
    args: {
      title: string; summary: string;
      category: string; bodyJson: string; settingsSchemaJson?: string; createdBy: "user" | "agent";
    };
    result: DashboardCustomWidget;
  };
  dashboard_update_custom_widget: {
    args: { id: string; patch: CustomWidgetPatch };
    result: DashboardCustomWidget;
  };
  dashboard_remove_custom_widget: {
    args: { id: string; forceDeleteInstances: boolean };
    result: null;
  };
  dashboard_reset: {
    args: undefined;
    result: null;
  };
  dashboard_import_background_image: {
    args: { sourcePath: string };
    result: string;
  };
  dashboard_load_background_image: {
    args: { file: string };
    result: { dataUrl?: string; path?: string };
  };
  mcp_list_servers: {
    args: undefined;
    result: McpServer[];
  };
  mcp_create_server: {
    args: { request: McpCreateServerRequest };
    result: McpServer;
  };
  mcp_update_server: {
    args: { request: McpUpdateServerRequest };
    result: McpServer;
  };
  mcp_delete_server: {
    args: { id: string };
    result: null;
  };
  mcp_refresh_tools: {
    args: { id: string };
    result: McpServer;
  };
  mcp_call_tool: {
    args: { serverIdOrName: string; toolName: string; arguments: unknown };
    result: McpCallResult;
  };
  list_manual_chapters: {
    args: undefined;
    result: ManualChapter[];
  };
  read_manual_chapter: {
    args: { filename: string };
    result: string;
  };
  network_dns_lookup: {
    args: { host: string; recordType?: string };
    result: { records: Array<{ type: string; value: string; ttl?: number; priority?: number }>; resolverMs: number };
  };
  network_tcp_check: {
    args: { host: string; port: number; timeoutMs?: number };
    result: { open: boolean; rttMs?: number; error?: NetError };
  };
  network_interfaces: {
    args: undefined;
    result: Array<{ name: string; mac?: string; addresses: Array<{ ip: string; family: "v4" | "v6"; cidr?: number }>; isLoopback: boolean; isUp: boolean }>;
  };
  network_wol: {
    args: { mac: string; broadcast?: string; port?: number };
    result: { sent: boolean };
  };
  network_whois: {
    args: { domain: string };
    result: { raw: string; parsed?: Record<string, string> };
  };
  network_ping_start: {
    args: { args: { subscriptionId: string; host: string; count?: number; intervalMs?: number; timeoutMs?: number; ttl?: number; size?: number; fallbackTcpPort?: number } };
    result: void;
  };
  network_port_scan_start: {
    args: { args: { subscriptionId: string; host: string; ports: number[]; concurrency?: number; timeoutMs?: number; jitterMs?: number } };
    result: void;
  };
  network_stream_cancel: {
    args: { subscriptionId: string };
    result: void;
  };
  watchdog_create: {
    args: { config: import("../watchdog/types").WatchdogConfig };
    result: import("../watchdog/types").WatchdogSummary;
  };
  watchdog_list: {
    args: undefined;
    result: import("../watchdog/types").WatchdogSummary[];
  };
  watchdog_cancel: {
    args: { id: string };
    result: void;
  };
  watchdog_get_report: {
    args: { id: string };
    result: import("../watchdog/types").WatchdogReport;
  };
  watchdog_record_intervention: {
    args: { id: string; record: import("../watchdog/types").WatchdogInterventionRecord };
    result: void;
  };
  installer_load_catalog: {
    args: { forceRefresh?: boolean };
    result: import("../modules/installer/types").Catalog;
  };
  installer_detect_all: {
    args: undefined;
    result: Record<string, import("../modules/installer/types").DetectedState>;
  };
  installer_redetect: {
    args: { toolId: string };
    result: import("../modules/installer/types").DetectedState;
  };
  installer_check_latest_versions: {
    args: { toolIds: string[] };
    result: Record<string, string | null>;
  };
  installer_install_recipe: {
    args: {
      toolId: string;
      options?: import("../modules/installer/types").InstallOptions;
    };
    result: void;
  };
  installer_uninstall_recipe: {
    args: { toolId: string };
    result: void;
  };
  installer_cancel: {
    args: { toolId: string };
    result: void;
  };
  installer_get_state: {
    args: undefined;
    result: import("../modules/installer/types").ToolState[];
  };
  installer_set_pinned: {
    args: { toolId: string; pinned: boolean };
    result: void;
  };
};

export interface ManualChapter {
  slug: string;
  order: number;
  filename: string;
  title: string;
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  secretHeaderName: string | null;
  secretValueTemplate: string | null;
  hasSecret: boolean;
  tools: unknown;
  toolsFetchedAt: string | null;
  lastStatus: "ok" | "unreachable" | "auth_error" | "protocol_error" | "unknown";
  lastError: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface McpCreateServerRequest {
  name: string;
  url: string;
  headers?: Record<string, string>;
  secretHeaderName?: string;
  secretValueTemplate?: string;
  secret?: string;
}

export interface McpUpdateServerRequest {
  id: string;
  name?: string;
  url?: string;
  headers?: Record<string, string>;
  secretHeaderName?: string | null;
  secretValueTemplate?: string | null;
  secret?: string | null;
}

export interface McpCallResult {
  content: unknown;
  isError: boolean;
}

export type McpCommandError =
  | { kind: "validation"; reason: string }
  | { kind: "notFound" }
  | { kind: "duplicateName" }
  | { kind: "keychainUnavailable" }
  | { kind: "network"; message: string }
  | { kind: "protocol"; message: string }
  | { kind: "authError"; message: string }
  | { kind: "internal"; message: string };

export function describeMcpError(error: unknown): string {
  if (error && typeof error === "object" && "kind" in error) {
    const err = error as McpCommandError;
    switch (err.kind) {
      case "validation":
        return err.reason;
      case "notFound":
        return i18next.t("settings.mcpErrorNotFound");
      case "duplicateName":
        return i18next.t("settings.mcpErrorDuplicateName");
      case "keychainUnavailable":
        return i18next.t("settings.mcpErrorKeychain");
      case "network":
      case "protocol":
      case "authError":
      case "internal":
        return err.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function invokeCommand<Name extends keyof CommandMap>(
  name: Name,
  args?: CommandMap[Name]["args"],
): Promise<CommandMap[Name]["result"]> {
  if (!isTauriRuntime()) {
    return Promise.reject(new Error("Tauri runtime unavailable"));
  }

  return invoke<CommandMap[Name]["result"]>(name, args);
}

export async function selectSettingsImportFile(options: {
  title: string;
  filterName: string;
}) {
  if (!isTauriRuntime()) {
    return null;
  }

  const selectedPath = await openDialog({
    directory: false,
    filters: [{ name: options.filterName, extensions: ["zip"] }],
    multiple: false,
    title: options.title,
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function selectSettingsExportFile(options: {
  title: string;
  filterName: string;
  defaultFilename: string;
}) {
  if (!isTauriRuntime()) {
    return null;
  }

  const selectedPath = await saveDialog({
    defaultPath: options.defaultFilename,
    filters: [{ name: options.filterName, extensions: ["zip"] }],
    title: options.title,
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function selectConnectionImportFile() {
  if (!isTauriRuntime()) {
    return null;
  }

  const selectedPath = await openDialog({
    directory: false,
    multiple: false,
    title: i18next.t("connections.import.title"),
    filters: [
      {
        name: i18next.t("connections.import.fromFileTitle"),
        extensions: ["csv", "tsv", "txt", "rdg", "mxtsessions", "reg"],
      },
      { name: i18next.t("common.allFilesFilter"), extensions: ["*"] },
    ],
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function selectAppLauncherFile(options: {
  title: string;
  filterName: string;
  allFilesFilterName: string;
  kind: "app" | "file";
}) {
  if (!isTauriRuntime()) {
    return null;
  }

  const filters =
    options.kind === "app"
      ? [
          {
            name: options.filterName,
            extensions: ["exe", "lnk", "bat", "cmd", "ps1"],
          },
        ]
      : [{ name: options.allFilesFilterName, extensions: ["*"] }];

  const selectedPath = await openDialog({
    directory: false,
    filters,
    multiple: false,
    title: options.title,
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function selectAppLauncherFolder(options: {
  title: string;
}) {
  if (!isTauriRuntime()) {
    return null;
  }

  const selectedPath = await openDialog({
    directory: true,
    multiple: false,
    title: options.title,
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function selectKeyFile(defaultPath?: string) {
  if (!isTauriRuntime()) {
    return null;
  }

  const selectedPath = await openDialog({
    defaultPath,
    directory: false,
    multiple: false,
    title: i18next.t("terminal.selectKeyFile"),
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function saveTextFile(defaultFilename: string, contents: string) {
  if (isTauriRuntime()) {
    try {
      const path = await saveDialog({
        defaultPath: defaultFilename,
        filters: [
          { name: i18next.t("terminal.logFiles"), extensions: ["log"] },
          { name: i18next.t("terminal.textFiles"), extensions: ["txt"] },
        ],
        title: i18next.t("terminal.saveDialog"),
      });

      if (!path) {
        return null;
      }

      await writeTextFile(path, contents);
      return path;
    } catch (error) {
      if (!canUseBrowserSaveDialog()) {
        throw error;
      }
    }
  }

  return saveTextFileWithBrowserPicker(defaultFilename, contents);
}

export async function confirmNativeDialog(
  message: string,
  options?: ConfirmDialogOptions,
) {
  if (!isTauriRuntime()) {
    return null;
  }

  return confirmDialog(message, options);
}

async function saveTextFileWithBrowserPicker(
  defaultFilename: string,
  contents: string,
) {
  const picker = (window as WindowWithSavePicker).showSaveFilePicker;
  if (!picker) {
    throw new Error(i18next.t("terminal.noSaveDialog"));
  }

  try {
    const handle = await picker({
      suggestedName: defaultFilename,
      types: [
        {
          accept: { "text/plain": [".log", ".txt"] },
          description: i18next.t("terminal.logFiles"),
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
    return defaultFilename;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
}

function canUseBrowserSaveDialog() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    typeof (window as WindowWithSavePicker).showSaveFilePicker === "function"
  );
}

export function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in
      (window as Window & { __TAURI_INTERNALS__?: unknown })
  );
}

export async function getAppVersion() {
  if (!isTauriRuntime()) {
    return "";
  }
  return getTauriAppVersion();
}

export async function isMainWindowMaximized() {
  if (!isTauriRuntime()) {
    return false;
  }
  return getCurrentWindow().isMaximized();
}

export async function minimizeMainWindow() {
  if (!isTauriRuntime()) {
    return;
  }
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeMainWindow() {
  if (!isTauriRuntime()) {
    return;
  }
  await getCurrentWindow().toggleMaximize();
}

export async function closeMainWindow() {
  if (!isTauriRuntime()) {
    return;
  }
  await getCurrentWindow().close();
}

export async function listenMainWindowResized(handler: () => void) {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  return getCurrentWindow().onResized(handler);
}

export interface WidgetFilePickFilter {
  name: string;
  extensions: string[];
}

export interface WidgetReadFileResult {
  name: string;
  bytes: Uint8Array;
  path: string;
}

/**
 * Open a native file picker and return the selected file's bytes. Used by
 * dashboard script widgets via KK.readLocalFile. Returns null when the user
 * cancels.
 */
export async function pickAndReadFile(
  filters?: WidgetFilePickFilter[],
): Promise<WidgetReadFileResult | null> {
  if (!isTauriRuntime()) {
    throw new Error("File picker is only available in the Tauri runtime.");
  }
  const selection = await openDialog({
    directory: false,
    multiple: false,
    filters: filters && filters.length > 0 ? filters : undefined,
  });
  const path = typeof selection === "string" ? selection : null;
  if (!path) return null;
  const bytes = await readFile(path);
  const name = path.split(/[/\\]/).pop() ?? path;
  return { name, bytes, path };
}

/**
 * Show a native save dialog and write the supplied bytes to the chosen path.
 * Used by dashboard script widgets via KK.saveFile. Returns the chosen path
 * or null if the user cancels.
 */
export async function pickAndSaveFile(
  defaultFilename: string,
  bytes: Uint8Array,
  filters?: WidgetFilePickFilter[],
): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error("Save dialog is only available in the Tauri runtime.");
  }
  const path = await saveDialog({
    defaultPath: defaultFilename,
    filters: filters && filters.length > 0 ? filters : undefined,
  });
  if (typeof path !== "string" || !path) return null;
  await writeFile(path, bytes);
  return path;
}

export async function selectScreenshotFolder(options: {
  defaultPath?: string;
  title: string;
}) {
  if (!isTauriRuntime()) {
    return null;
  }
  const selectedPath = await openDialog({
    defaultPath: options.defaultPath,
    directory: true,
    multiple: false,
    title: options.title,
  });
  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function openFilesystemPath(path: string) {
  if (!isTauriRuntime()) {
    return;
  }
  await openPath(path);
}

export async function openExternalUrl(url: string) {
  if (!isTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await openUrl(url);
}

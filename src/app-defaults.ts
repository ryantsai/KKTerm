import type {
  AppearanceSettings,
  AiProviderSettings,
  CredentialSettings,
  ConnectionTree,
  DashboardSettings,
  GeneralSettings,
  RdpSettings,
  SftpSettings,
  SshSettings,
  UrlSettings,
  VncSettings,
  TerminalSettings,
  WorkspaceTab,
} from "./types";
import { defaultLocalShell } from "./lib/platform";
import { DEFAULT_ACTIVITY_RAIL_ORDER } from "./app/activityRailOrder";

export const connectionTree: ConnectionTree = {
  connections: [],
  folders: [],
};

export const initialTabs: WorkspaceTab[] = [];

export const defaultGeneralSettings: GeneralSettings = {
  autoBackupEnabled: true,
  autoUpdateChecksEnabled: true,
  showConnectedConnectionsInRail: true,
  showWorkspaceOnRail: true,
  showDashboardOnRail: true,
  showAllConnectionsInTree: false,
  hideTopTabButtons: false,
  doubleClickOpensConnection: false,
  submitAiAttachmentsDirectly: true,
  separateSplitTerminalBackgrounds: false,
  showInstallerOnRail: true,
  showItOps: true,
  showScreenshotsOnRail: true,
  showDontSleepOnRail: true,
  activityRailOrder: [...DEFAULT_ACTIVITY_RAIL_ORDER],
  installerCheckIntervalSeconds: 86400,
  installerDefaultProvider: "winget",
  pinnedConnectionIds: [],
  allowClipboardRead: true,
  autoStartWithWindows: false,
  minimizeToTray: true,
  dontSleepEnabled: false,
  dontSleepForegroundOnly: true,
  useDirectxScreenCapture: true,
  statusBarEnabled: true,
  statusBarMonitorEnabled: true,
  statusBarMonitorIntervalSeconds: 5,
  advancedDebuggingEnabled: false,
  rdpWebviewStability: false,
  workspaceShortcuts: {},
  proxyMode: "system",
  proxyUrl: "",
  lastBackupAt: null,
};

export const defaultCredentialSettings: CredentialSettings = {
  secretStore: "os",
};

// Active-widget cap defaults. Mirror the Rust constants in
// `src-tauri/src/storage.rs` (default_max_active_script_widgets and
// MAX_ACTIVE_SCRIPT_WIDGETS_LIMIT). Kept in sync manually — the Settings UI
// and ScriptWidgetHost both read from these constants.
export const MAX_ACTIVE_SCRIPT_WIDGETS_DEFAULT = 8;
export const MAX_ACTIVE_SCRIPT_WIDGETS_LIMIT = 100;
export const MAX_ACTIVE_SCRIPT_WIDGETS_MIN = 1;

export const defaultDashboardSettings: DashboardSettings = {
  confirmRemove: true,
  defaultLandingView: "lastActive",
  maxActiveScriptWidgets: MAX_ACTIVE_SCRIPT_WIDGETS_DEFAULT,
  allowWidgetNetworkTools: true,
  useRandomDynamicBackground: false,
  widgetLayoutEnforcement: "strict",
};

export const defaultTerminalSettings: TerminalSettings = {
  // Resolves per platform via CSS fallback: Cascadia Mono (Windows), SF Mono
  // (macOS), then the bundled JetBrains Mono (Linux / anywhere the others are
  // absent). Keep in sync with the backend default in storage.rs.
  fontFamily: '"Cascadia Mono", "SF Mono", "JetBrains Mono", Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.25,
  cursorStyle: "block",
  scrollbackLines: 5000,
  defaultTransparency: 50,
  useRandomDynamicBackground: false,
  copyOnSelect: false,
  allowOsc52Clipboard: true,
  confirmMultilinePaste: true,
  rightClickPaste: false,
  autoRecordSessions: false,
  defaultShell: defaultLocalShell(),
  customShells: [],
  colorScheme: "kkterm",
  enableInlineImages: true,
  allowTerminalNotifications: true,
  hyperlinkRules: [],
};

export const defaultAppearanceSettings: AppearanceSettings = {
  // Platform-aware default: SF Pro on macOS, bundled Inter on Windows.
  appFontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Inter", ui-sans-serif, system-ui, "Segoe UI", sans-serif',
  colorScheme: "default",
};

export const defaultSshSettings: SshSettings = {
  defaultUser: "admin",
  defaultPort: 22,
  defaultKeyPath: "",
  defaultProxyJump: "",
  defaultSshCompression: "fast",
  defaultSshOldProtocols: "off",
  autoTrustNewHostKeys: true,
  bufferLines: 5000,
  defaultTransparency: 50,
  defaultUseTmuxSessions: true,
  useRandomDynamicBackground: false,
  allowOsc52Clipboard: true,
  managedXServerEnabled: false,
  xServerPath: "",
  xServerDisplay: 0,
  xServerArgs: "-multiwindow -clipboard -wgl",
};

export const defaultSftpSettings: SftpSettings = {
  overwriteBehavior: "fail",
  fileExplorerOpenMode: "external",
  fileExplorerTerminalShell: defaultLocalShell(),
  fileExplorerTerminalElevated: false,
};

export const defaultUrlSettings: UrlSettings = {
  ignoreCertificateErrors: false,
  defaultDataPartition: "",
  defaultUserAgent: "",
};

export const defaultRdpSettings: RdpSettings = {
  colorDepth: 32,
  administrativeSession: false,
  redirectClipboard: true,
  redirectDrives: false,
  driveSelection: { mode: "all" },
  sharedLocalFolders: [],
  sharedLocalFolder: "",
  bitmapCache: true,
  performanceProfile: "balanced",
  remoteResolution: "automatic",
  viewMode: "fit",
};

export const defaultVncSettings: VncSettings = {
  sharedSession: true,
  viewOnly: false,
  colorLevel: "full",
  preferredEncoding: "tight",
  viewMode: "fit",
};

export const defaultAiAssistantToolSettings = {
  webSearch: true,
  webFetch: true,
  shellCommand: true,
  appDataFileSearch: true,
  appDataFileRead: true,
  currentTime: true,
  performanceCounters: true,
  email: false,
  dashboard: true,
  itops: true,
  connections: true,
  sessions: true,
  tutorial: true,
  manual: true,
  network: true,
  watchdog: true,
  memory: true,
};

export const defaultAiProviderSettings: AiProviderSettings = {
  providerKind: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  outputLanguage: "",
  customInstructions: "",
  apiMode: "chatCompletions",
  extraHeaders: "",
  allowInsecureTls: false,
  allowInsecureMcpHttp: false,
  showAllModels: false,
  cliExecutionPolicy: "suggestOnly",
  toolPermissionMode: "prompt",
  builtInMcpServerEnabled: true,
  builtInMcpAllowAllDangerous: false,
  useCodexCli: false,
  useClaudeCli: false,
  useCursorCli: false,
  claudeCliPath: "",
  codexCliPath: "",
  cursorCliPath: "",
  disabledSkillNames: [],
  customSkillsEnabled: true,
  tools: defaultAiAssistantToolSettings,
  searchProvider: "scraper",
  searxngUrl: "",
  emailProvider: "resend",
  emailFrom: "",
  mailgunDomain: "",
  smtpHost: "",
  smtpPort: 587,
  smtpUsername: "",
  smtpSecurity: "starttls",
};

export type AiSuggestion = {
  id: string;
  title: string;
  risk: string;
  command: string;
  reason: string;
};

export const aiSuggestions: AiSuggestion[] = [];

import type {
  AppearanceSettings,
  AiProviderSettings,
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

export const connectionTree: ConnectionTree = {
  connections: [],
  folders: [],
};

export const initialTabs: WorkspaceTab[] = [];

export const defaultGeneralSettings: GeneralSettings = {
  autoBackupEnabled: true,
  autoUpdateChecksEnabled: true,
  showConnectedConnectionsInRail: true,
  pinnedConnectionIds: [],
  allowClipboardRead: true,
  autoStartWithWindows: false,
  minimizeToTray: true,
  dontSleepEnabled: false,
  lastBackupAt: null,
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
};

export const defaultTerminalSettings: TerminalSettings = {
  fontFamily: '"Cascadia Mono", "JetBrains Mono", Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.25,
  cursorStyle: "block",
  scrollbackLines: 5000,
  copyOnSelect: false,
  allowOsc52Clipboard: true,
  confirmMultilinePaste: true,
  defaultShell: "powershell.exe",
};

export const defaultAppearanceSettings: AppearanceSettings = {
  appFontFamily:
    '"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  colorScheme: "default",
};

export const defaultSshSettings: SshSettings = {
  defaultUser: "admin",
  defaultPort: 22,
  defaultKeyPath: "C:\\Users\\ryan\\.ssh\\id_ed25519",
  defaultProxyJump: "",
  bufferLines: 5000,
  hideCommonPortRedirects: true,
  allowOsc52Clipboard: true,
};

export const defaultSftpSettings: SftpSettings = {
  overwriteBehavior: "fail",
};

export const defaultUrlSettings: UrlSettings = {
  ignoreCertificateErrors: false,
};

export const defaultRdpSettings: RdpSettings = {
  colorDepth: 32,
  redirectClipboard: true,
  redirectDrives: false,
  bitmapCache: true,
  performanceProfile: "balanced",
};

export const defaultVncSettings: VncSettings = {
  sharedSession: true,
  viewOnly: false,
  colorLevel: "full",
  preferredEncoding: "tight",
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
  connections: true,
  sessions: true,
  tutorial: true,
  manual: true,
  network: false,
  watchdog: true,
};

export const defaultAiProviderSettings: AiProviderSettings = {
  providerKind: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.4-mini",
  reasoningEffort: "medium",
  outputLanguage: "",
  customInstructions: "",
  apiMode: "chatCompletions",
  extraHeaders: "",
  allowInsecureTls: false,
  showAllModels: false,
  cliExecutionPolicy: "suggestOnly",
  toolPermissionMode: "prompt",
  claudeCliPath: "",
  codexCliPath: "",
  disabledSkillNames: [],
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

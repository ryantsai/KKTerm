export type SettingsSectionId =
  | "general-settings"
  | "appearance-settings"
  | "dashboard-settings"
  | "workspace-settings"
  | "file-explorer-settings"
  | "dont-sleep-settings"
  | "installer-settings"
  | "credentials-settings"
  | "assistant-settings"
  | "ssh-settings"
  | "terminal-settings"
  | "url-settings"
  | "rdp-settings"
  | "vnc-settings"
  | "screenshots-settings"
  | "shortcuts-settings"
  | "proxy-settings"
  | "about-settings";

export type SettingsAssistantContext = {
  contextKind: "settings";
  contextLabel: string;
  connectionLabel: string;
  sourceLabel: string;
  text: string;
};

export type SettingsTutorialTarget = {
  targetId: string;
  titleKey: string;
  bodyKey: string;
};

type Translate = (key: string, fallback: string) => string;

type SettingsControlSummary = {
  key: string;
  description: string;
  tutorialTargetId?: string;
};

type SettingsSectionSummary = {
  labelKey: string;
  fallbackLabel: string;
  tutorialTargetId?: string;
  controls: SettingsControlSummary[];
};

const SETTINGS_SECTIONS: Record<SettingsSectionId, SettingsSectionSummary> = {
  "general-settings": {
    labelKey: "settings.sectionGeneral",
    fallbackLabel: "General",
    controls: [
      {
        key: "settings.language",
        description: "UI language selector.",
        tutorialTargetId: "settings.language",
      },
      {
        key: "settings.workspaceAccess",
        description: "Local runtime permission and startup toggles.",
        tutorialTargetId: "settings.workspaceAccess",
      },
      {
        key: "settings.activityRail",
        description:
          "Visibility and drag-to-reorder controls for Workspace, Dashboard, Install Helper, Screenshots, IT Ops, and Don't Sleep on the Activity Rail.",
        tutorialTargetId: "settings.activityRail",
      },
      {
        key: "settings.useDirectxScreenCapture",
        description: "DXGI Desktop Duplication screenshot acceleration toggle.",
        tutorialTargetId: "settings.useDirectxScreenCapture",
      },
      {
        key: "settings.statusBar",
        description: "Status Bar visibility, CPU/RAM/Network monitor visibility, and polling interval.",
        tutorialTargetId: "settings.statusBar",
      },
      { key: "settings.autoStartWithWindows", description: "Launch KKTerm minimized when the user signs in to Windows." },
      {
        key: "settings.settingsData",
        description: "Export, import, database folder, and reset actions.",
        tutorialTargetId: "settings.settingsData",
      },
      {
        key: "settings.advancedDebugging",
        description: "Advanced Debugging log toggle for full AI Assistant debug logs.",
        tutorialTargetId: "settings.debug",
      },
      {
        key: "settings.rdpWebviewStability",
        description:
          "Forces WebView2 software compositing and disabled occlusion throttling so KKTerm stays responsive when run inside an RDP host; auto-applied in remote sessions.",
        tutorialTargetId: "settings.debug",
      },
    ],
  },
  "appearance-settings": {
    labelKey: "settings.sectionAppearance",
    fallbackLabel: "Appearance",
    controls: [
      {
        key: "settings.appUiFontFamily",
        description: "App UI font family selector.",
        tutorialTargetId: "settings.appUiFontFamily",
      },
      {
        key: "settings.colorScheme",
        description: "App color scheme selector and preview swatches.",
        tutorialTargetId: "settings.appearance.colorScheme",
      },
      {
        key: "settings.resetLayout",
        description: "Workspace chrome and pane layout reset action.",
        tutorialTargetId: "settings.resetLayout",
      },
    ],
  },
  "dashboard-settings": {
    labelKey: "settings.sectionDashboard",
    fallbackLabel: "Dashboard",
    controls: [
      {
        key: "settings.dashboardDefaultLanding",
        description: "Default landing view behavior.",
        tutorialTargetId: "settings.dashboardDefaultLanding",
      },
      {
        key: "settings.dashboardUseRandomDynamicBackground",
        description: "Automatically assign a random dynamic background to new Dashboard Views.",
        tutorialTargetId: "settings.dashboardUseRandomDynamicBackground",
      },
      {
        key: "settings.dashboardMaxActiveScriptWidgets",
        description: "Active script widget iframe cap.",
        tutorialTargetId: "settings.dashboardMaxActiveScriptWidgets",
      },
    ],
  },
  "workspace-settings": {
    labelKey: "settings.sectionWorkspace",
    fallbackLabel: "Workspace",
    tutorialTargetId: "settings.workspace",
    controls: [
      {
        key: "settings.connectedConnectionsRail",
        description: "Show or hide connected Connection icons on the Activity Rail.",
      },
      {
        key: "settings.hideTopTabButtons",
        description: "Enable Child Connection Tabs: hides the top Tab Strip and shows saved Child Connection Tabs under their parent Connections in the Connection Tree.",
      },
      {
        key: "settings.doubleClickOpensConnection",
        description: "Require a double-click to open Connections from the Connection Tree; rename Connections from the right-click Rename action.",
      },
      {
        key: "settings.submitAiAttachmentsDirectly",
        description: "Choose whether Workspace Send to AI Assistant actions submit captured context immediately or only attach it to the composer.",
      },
      {
        key: "settings.separateSplitTerminalBackgrounds",
        description: "Allow split terminal Panes to keep separate backgrounds instead of sharing one terminal workspace background.",
      },
    ],
  },
  "file-explorer-settings": {
    labelKey: "settings.fileExplorer",
    fallbackLabel: "File Explorer",
    tutorialTargetId: "settings.fileExplorer",
    controls: [
      {
        key: "settings.fileExplorerOpenMode",
        description: "Choose whether local files open externally or in the inline Document editor.",
      },
      {
        key: "settings.fileExplorerTerminal",
        description: "Choose the platform shell and Windows elevation mode for Open Terminal Here.",
      },
    ],
  },
  "dont-sleep-settings": {
    labelKey: "settings.sectionDontSleep",
    fallbackLabel: "Don't Sleep",
    tutorialTargetId: "settings.dontSleep",
    controls: [
      {
        key: "settings.dontSleepForegroundOnly",
        description:
          "When enabled, Don't Sleep only asserts while the KKTerm main window is focused and not minimized.",
      },
    ],
  },
  "installer-settings": {
    labelKey: "settings.sectionInstaller",
    fallbackLabel: "Install Helper",
    tutorialTargetId: "settings.installer",
    controls: [
      {
        key: "settings.installerCheckInterval",
        description:
          "How often the Install Helper auto-checks for the latest tool versions when opened (hour/day/week/month; default daily).",
      },
    ],
  },
  "credentials-settings": {
    labelKey: "settings.sectionCredentials",
    fallbackLabel: "Credentials",
    controls: [
      {
        key: "settings.credentialStorage",
        description: "Credential storage backend selector and encrypted database launch prompt policy.",
        tutorialTargetId: "settings.credentialStorage",
      },
      {
        key: "settings.credentialsStored",
        description: "Stored credential summaries and delete actions.",
        tutorialTargetId: "settings.credentialsStored",
      },
      {
        key: "settings.widgetCredentialsStored",
        description: "Stored Dashboard widget secrets.",
        tutorialTargetId: "settings.widgetCredentialsStored",
      },
    ],
  },
  "assistant-settings": {
    labelKey: "settings.sectionAiAssistant",
    fallbackLabel: "AI Assistant",
    controls: [
      {
        key: "settings.aiProvider",
        description: "AI provider and model selection.",
        tutorialTargetId: "settings.aiProvider",
      },
      {
        key: "settings.aiToolsTitle",
        description: "Assistant tool enablement toggles.",
        tutorialTargetId: "settings.aiToolsTitle",
      },
      {
        key: "settings.aiCustomInstructions",
        description: "Assistant custom instruction text.",
        tutorialTargetId: "settings.aiCustomInstructions",
      },
      {
        key: "settings.assistantSkillsTitle",
        description: "Local Assistant Skills management.",
        tutorialTargetId: "settings.assistantSkillsTitle",
      },
      {
        key: "settings.mcpServersTitle",
        description: "MCP server management.",
        tutorialTargetId: "settings.mcpServersTitle",
      },
      {
        key: "settings.allowInsecureMcpHttp",
        description: "Remote MCP plain HTTP exception toggle for trusted local or network servers.",
      },
    ],
  },
  "ssh-settings": {
    labelKey: "settings.sectionSsh",
    fallbackLabel: "SSH",
    controls: [
      {
        key: "settings.defaultUser",
        description: "Default SSH username.",
        tutorialTargetId: "settings.defaultUser",
      },
      {
        key: "settings.defaultPort",
        description: "Default SSH port.",
        tutorialTargetId: "settings.defaultPort",
      },
      {
        key: "settings.defaultKey",
        description: "Default SSH identity file.",
        tutorialTargetId: "settings.defaultKey",
      },
      {
        key: "settings.sshBufferLines",
        description: "SSH terminal buffer behavior.",
        tutorialTargetId: "settings.sshBufferLines",
      },
      {
        key: "settings.defaultTransparency",
        description: "Default SSH terminal transparency for new SSH Connections and Child Connection Tabs.",
      },
      {
        key: "settings.randomDynamicBackgroundOnCreate",
        description: "Random dynamic terminal backgrounds for new SSH Connections, new tabs, and Child Connection Tabs.",
      },
      {
        key: "settings.xServer",
        description: "Managed VcXsrv launcher for SSH Sessions that need local X11 windows.",
      },
    ],
  },
  "terminal-settings": {
    labelKey: "settings.sectionTerminal",
    fallbackLabel: "Terminal",
    controls: [
      {
        key: "settings.terminalFontFamily",
        description: "Local terminal font.",
        tutorialTargetId: "settings.terminalFontFamily",
      },
      {
        key: "settings.terminalFontSize",
        description: "Local terminal font size.",
        tutorialTargetId: "settings.terminalFontSize",
      },
      {
        key: "settings.defaultShell",
        description: "Default local shell.",
        tutorialTargetId: "settings.defaultShell",
      },
      {
        key: "settings.scrollbackLines",
        description: "Terminal scrollback line count.",
        tutorialTargetId: "settings.scrollbackLines",
      },
      {
        key: "settings.defaultTransparency",
        description: "Default local terminal transparency for new terminal Connections and Child Connection Tabs.",
      },
      {
        key: "settings.randomDynamicBackgroundOnCreate",
        description: "Random dynamic terminal backgrounds for new local terminal Connections, new tabs, and Child Connection Tabs.",
      },
    ],
  },
  "url-settings": {
    labelKey: "settings.sectionUrl",
    fallbackLabel: "URL",
    controls: [
      {
        key: "settings.ignoreCertificateErrors",
        description: "URL Connection certificate handling.",
        tutorialTargetId: "settings.ignoreCertificateErrors",
      },
      {
        key: "settings.urlSavedPasswords",
        description: "Saved website password and input-data records.",
        tutorialTargetId: "settings.urlSavedPasswords",
      },
      {
        key: "settings.urlDataShards",
        description: "URL data shard management.",
        tutorialTargetId: "settings.urlDataShards",
      },
    ],
  },
  "rdp-settings": {
    labelKey: "settings.sectionRdp",
    fallbackLabel: "Remote Desktop",
    controls: [
      {
        key: "settings.rdpColorDepth",
        description: "RDP color depth default.",
        tutorialTargetId: "settings.rdpColorDepth",
      },
      {
        key: "settings.rdpPerformanceProfile",
        description: "RDP performance profile default.",
        tutorialTargetId: "settings.rdpPerformanceProfile",
      },
    ],
  },
  "vnc-settings": {
    labelKey: "settings.sectionVnc",
    fallbackLabel: "VNC",
    controls: [
      {
        key: "settings.vncViewOnly",
        description: "VNC view-only default.",
        tutorialTargetId: "settings.vncViewOnly",
      },
      {
        key: "settings.vncColorLevel",
        description: "VNC color level default.",
        tutorialTargetId: "settings.vncColorLevel",
      },
    ],
  },
  "screenshots-settings": {
    labelKey: "settings.sectionScreenshots",
    fallbackLabel: "Screenshots",
    controls: [
      {
        key: "settings.screenshotsFolder",
        description: "Library folder path for captured screenshots.",
        tutorialTargetId: "settings.screenshotsFolder",
      },
      {
        key: "settings.screenshotsFormat",
        description: "Capture save format: PNG (default) or JPEG with a quality value.",
        tutorialTargetId: "settings.screenshotsFormat",
      },
      {
        key: "settings.screenshotsShortcuts",
        description:
          "Global capture hotkeys for region, window, and full-screen captures, each with an enable toggle.",
        tutorialTargetId: "settings.screenshotsShortcuts",
      },
    ],
  },
  "shortcuts-settings": {
    labelKey: "settings.sectionShortcuts",
    fallbackLabel: "Shortcuts",
    tutorialTargetId: "settings.shortcuts",
    controls: [
      {
        key: "settings.sectionShortcuts",
        description:
          "Workspace Module keyboard shortcut bindings: Tab management (new/close/next/previous Tab) and terminal Pane actions (copy, paste, Quick Select, find in scrollback, font size, splits). Click a binding to record a new key combination; actions without a default stay disabled until one is assigned.",
        tutorialTargetId: "settings.shortcuts",
      },
    ],
  },
  "proxy-settings": {
    labelKey: "settings.proxy",
    fallbackLabel: "Proxy",
    tutorialTargetId: "settings.proxy",
    controls: [
      {
        key: "settings.proxy",
        description:
          "Global network proxy mode (system, none, or manual) and manual host/port for all KKTerm activity — connections, app updates, AI providers, and other web requests. A manual SOCKS5 proxy also routes SSH/SFTP and Telnet sessions.",
        tutorialTargetId: "settings.proxy",
      },
    ],
  },
  "about-settings": {
    labelKey: "settings.sectionAbout",
    fallbackLabel: "About",
    controls: [
      {
        key: "settings.aboutVersion",
        description: "Product version and open-source component information.",
        tutorialTargetId: "settings.aboutVersion",
      },
    ],
  },
};

export function buildSettingsAssistantContext(
  sectionId: SettingsSectionId,
  translate: Translate = (_key, fallback) => fallback,
): SettingsAssistantContext {
  const section = SETTINGS_SECTIONS[sectionId];
  const settingsLabel = translate("settings.title", "Settings");
  const sectionLabel = translate(section.labelKey, section.fallbackLabel);
  const controls = section.controls
    .map((control) => {
      const tutorial = control.tutorialTargetId
        ? ` Tutorial target: ${control.tutorialTargetId}.`
        : "";
      return `- ${control.key}: ${control.description}${tutorial}`;
    })
    .join("\n");

  return {
    contextKind: "settings",
    contextLabel: `${settingsLabel} - ${sectionLabel}`,
    connectionLabel: translate("ai.settingsContextLabel", "Current Settings page"),
    sourceLabel: `${settingsLabel} context`,
    text: [
      `Active Settings section: ${sectionLabel} (${sectionId}).`,
      section.tutorialTargetId
        ? `Section tutorial target: ${section.tutorialTargetId}.`
        : "Section tutorial target: use a matching control target below.",
      "Visible controls and i18n keys:",
      controls,
      "For UI help, answer first and offer to navigate when a matching tutorial target is listed. Only call tutorial_highlight after the user accepts; include navigation if the target belongs to another app surface.",
    ].join("\n"),
  };
}

export function settingsTutorialTargetForPrompt(
  prompt: string,
  sectionId: SettingsSectionId,
): SettingsTutorialTarget | undefined {
  const normalized = prompt.toLowerCase();
  if (
    sectionId === "appearance-settings" &&
    /\b(colou?r|theme|scheme|appearance)\b/.test(normalized)
  ) {
    return {
      targetId: "settings.appearance.colorScheme",
      titleKey: "ai.tutorial.colorSchemeTitle",
      bodyKey: "ai.tutorial.colorSchemeBody",
    };
  }
  if (
    sectionId === "general-settings" &&
    /\b(language|locale|translation|translate|english|chinese|japanese|korean|thai|spanish|french|german|portuguese|indonesian)\b/.test(normalized)
  ) {
    return {
      targetId: "settings.language",
      titleKey: "settings.language",
      bodyKey: "settings.language",
    };
  }
  return undefined;
}

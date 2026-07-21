import type { SettingsSectionId } from "./settingsAssistantContext";

export type SettingsSearchSection = {
  id: SettingsSectionId;
  labelKey: string;
  searchKeys: readonly string[];
};

export type SettingsSearchResult = {
  id: SettingsSectionId;
  label: string;
  matches: readonly {
    key: string;
    label: string;
  }[];
};

type Translate = (key: string, language: string) => string;

export const SETTINGS_SEARCH_KEYS: Record<SettingsSectionId, readonly string[]> = {
  "general-settings": [
    "settings.generalDefaults", "settings.softwareUpdates", "settings.language",
    "settings.workspaceAccess", "settings.activityRail",
    "settings.autoStartWithWindows", "settings.minimizeToTray", "settings.autoUpdateChecks",
    "settings.checkForUpdates", "settings.updates", "settings.version",
    "settings.statusBar", "settings.statusBarVisible",
    "settings.statusBarMonitor", "settings.statusBarMonitorInterval", "settings.settingsData",
    "settings.exportSettings", "settings.importSettings", "settings.openDatabaseFolder",
    "settings.portableInstallSection", "settings.portableCreatorAction",
    "settings.portableCreatorIntro",
    "settings.autoBackup", "settings.lastBackup", "settings.lastCheckedAt",
    "settings.sectionDontSleep", "settings.settingsDataActions", "settings.resetAllSettings",
    "settings.debug", "settings.advancedDebugging",
    "settings.openLogFolder", "settings.rdpWebviewStability",
  ],
  "appearance-settings": [
    "settings.typography", "settings.appUiFontFamily", "settings.customFonts",
    "settings.appearanceInterface", "settings.theme", "settings.colorScheme",
    "settings.layout", "settings.resetLayout", "settings.customFont",
    "settings.openCustomFontsFolder", "settings.recommendedFonts",
    "settings.refreshSystemFonts", "settings.systemFonts", "settings.schemeDefault",
    "settings.schemeDark", "settings.schemeLight", "settings.schemeMatchOs",
    "settings.schemeMac", "settings.schemeOrange", "settings.schemePurple",
    "settings.schemePink", "settings.schemeGreenKuaiKuai", "settings.schemeBlueSee",
    "settings.schemeBlueGreenWhite", "settings.schemeConfetti", "settings.schemeBubbleTea",
    "settings.schemeSemiconductor", "settings.schemeCanarinho",
    "settings.schemeLaAlbiceleste", "settings.schemeLesBleus", "settings.schemeOranje",
    "settings.schemeDieMannschaft", "settings.schemeLaRoja",
    "settings.schemeOsNavegadores", "settings.schemeVatreni", "settings.schemeElTri",
    "settings.schemeThreeLions", "settings.schemeSamuraiBlue",
    "settings.schemeStarsAndStripes", "settings.schemeMatchOsBadge",
  ],
  "workspace-settings": [
    "settings.activityRail", "settings.connectedConnectionsRail", "settings.workspaceTabs",
    "settings.hideTopTabButtons", "settings.doubleClickOpensConnection",
    "settings.sectionAiAssistant", "settings.submitAiAttachmentsDirectly",
    "settings.terminalBackgrounds", "settings.separateSplitTerminalBackgrounds",
  ],
  "file-explorer-settings": [
    "settings.fileExplorerOpenMode", "settings.fileExplorerOpenModeExternal",
    "settings.fileExplorerOpenModeInlineEditor", "settings.fileExplorerTerminal",
  ],
  "dashboard-settings": [
    "settings.dashboardGeneral", "settings.dashboardDefaultLanding",
    "settings.dashboardUseRandomDynamicBackground", "settings.dashboardLayoutEnforcement",
    "settings.dashboardPerformance", "settings.dashboardMaxActiveScriptWidgets",
    "settings.dashboardAllowWidgetNetworkTools", "settings.dashboardLandingLast",
    "settings.dashboardLayoutEnforcementLow", "settings.dashboardLayoutEnforcementModerate",
    "settings.dashboardLayoutEnforcementStrict",
  ],
  "installer-settings": [
    "settings.installerUpdateChecks", "settings.installerCheckInterval",
    "settings.installerDefaultProvider", "settings.installerDefaultProviderWinget",
    "settings.installerDefaultProviderChocolatey",
  ],
  "credentials-settings": [
    "settings.credentialStorage", "settings.credentialStorageBackend",
    "settings.credentialsStored", "settings.savedWebsitePasswords",
    "settings.widgetCredentialsStored", "settings.credentialStorageFile",
    "settings.credentialStorageFilePortable", "settings.portableCredentialStorageOsWarning",
    "settings.credentialStorageSwitchNote", "settings.credentialsHint",
    "settings.credentialsTitle", "settings.deleteCredential",
    "settings.encryptedSecretStoreSetupAction", "settings.encryptedSecretStoreUnlockAction",
    "settings.encryptedSecretStoreChangePasswordAction", "settings.encryptedSecretStoreResetAction",
    "settings.widgetCredentialsHint",
    "settings.savedCredentials", "settings.savedCredentialNew",
    "settings.perConnectionPasswords",
  ],
  "assistant-settings": [
    "settings.aiProviderConnection", "settings.provider", "settings.model",
    "settings.customModelId", "settings.apiMode", "settings.endpoint",
    "settings.aiProvider", "settings.aiAllowInsecureTls", "settings.aiCliAuthenticate",
    "settings.aiCliInstall", "settings.aiCliRefreshStatus", "settings.aiToolsDescription",
    "settings.aiToolsSafety", "settings.allowInsecureMcpHttp",
    "settings.apiModeChatCompletions", "settings.apiModeResponses",
    "settings.aiResponseDefaults", "settings.outputLanguage", "settings.reasoningEffort",
    "settings.aiCustomInstructions", "settings.aiToolsTitle", "settings.assistantSkillsTitle",
    "settings.mcpServersTitle", "settings.searchProvider", "settings.emailProvider",
    "settings.builtInMcpConfigTitle", "settings.braveSearchApiKey",
    "settings.builtInMcpAllowAllDangerous", "settings.builtInMcpConfigAgentHeader",
    "settings.builtInMcpConfigCopy", "settings.builtInMcpConfigFormatJson",
    "settings.builtInMcpConfigFormatToml", "settings.builtInMcpConfigGlobalScopeHeader",
    "settings.builtInMcpConfigIntro", "settings.builtInMcpConfigLocationsTitle",
    "settings.builtInMcpConfigMethodHeader", "settings.builtInMcpConfigProjectScopeHeader",
    "settings.builtInMcpServerEnabled", "settings.builtInMcpShowConfig",
    "settings.copilotCliInstallHelp", "settings.copilotConnect",
    "settings.copilotConnectionHint", "settings.copilotDisconnect",
    "settings.copilotOpenDevicePage", "settings.emailApiKey", "settings.emailFrom",
    "settings.extraHeaders", "settings.high", "settings.howToGetApiKey",
    "settings.keychainResetAndRetry", "settings.keychainResetHint", "settings.low",
    "settings.mailgunDomain", "settings.max", "settings.medium",
    "settings.outputLanguageUiLanguage", "settings.providerDefault", "settings.refreshModels",
    "settings.searxngUrl", "settings.showAllModels", "settings.smtpHost",
    "settings.smtpPassword", "settings.smtpPort", "settings.smtpSecurity",
    "settings.smtpUsername", "settings.tavilySearchApiKey", "settings.mcpAddServer",
    "settings.useCodexCli", "settings.useClaudeCli", "settings.useCursorCli",
    "settings.searchProviderScraper",
    "settings.searchProviderBrave", "settings.searchProviderTavily",
    "settings.searchProviderSearxng", "settings.emailProviderResend",
    "settings.emailProviderSendGrid", "settings.emailProviderMailgun",
    "settings.emailProviderPostmark", "settings.emailProviderSmtp",
    "settings.smtpSecurityStartTls", "settings.smtpSecurityNone",
    "settings.mcpDeleteServer", "settings.mcpRefreshTools", "settings.mcpServersHint",
    "settings.assistantCustomSkillsHint", "settings.assistantCustomSkillsOpenFolder",
    "settings.assistantCustomSkillsTitle", "settings.assistantSkillsDisabled",
    "settings.assistantSkillsEnabled", "settings.assistantSkillsHint",
    "settings.assistantSkillsOpen", "settings.assistantSkillsOpenFolder",
  ],
  "ssh-settings": [
    "settings.sshDefaults", "settings.sshConnectionDefaults", "settings.defaultUser",
    "settings.defaultPort", "settings.proxyJump", "settings.sshAuthentication",
    "settings.defaultKey", "settings.generateSshKey", "settings.sshTerminal",
    "settings.sshBufferLines", "settings.defaultTransparency",
    "settings.randomDynamicBackgroundOnCreate", "settings.sshCompression",
    "settings.sshOldProtocols", "settings.allowSshOsc52Clipboard", "settings.xServer",
    "settings.autoTrustNewHostKeys", "settings.defaultSshPortHint",
    "settings.defaultSshUserHint", "settings.sshBufferHint", "settings.sshCompressionFast",
    "settings.sshCompressionOff", "settings.xServerArgs", "settings.xServerDisplay",
    "settings.xServerLaunch", "settings.xServerManaged", "settings.xServerPath",
  ],
  "terminal-settings": [
    "settings.terminalText", "settings.fontFamily", "settings.fontSize",
    "settings.lineHeight", "settings.cursorStyle", "settings.terminalColorScheme",
    "settings.terminalSession", "settings.defaultShell", "settings.customShells",
    "settings.scrollbackLines", "settings.defaultTransparency",
    "settings.randomDynamicBackgroundOnCreate", "settings.terminalBehavior",
    "settings.confirmMultilinePaste", "settings.autoRecordSessions",
    "settings.allowTerminalNotifications", "settings.terminalClipboard",
    "settings.copyOnSelect", "settings.rightClickPaste", "settings.allowLocalOsc52Clipboard",
    "settings.terminalIntegrations", "settings.enableInlineImages", "settings.hyperlinkRules",
    "settings.addCustomShell", "settings.addHyperlinkRule", "settings.bar", "settings.block",
    "settings.customFonts", "settings.customShell", "settings.customShellCommandLine",
    "settings.customShellName", "settings.hyperlinkRule", "settings.hyperlinkRulePattern",
    "settings.hyperlinkRuleUrl", "settings.openCustomFontsFolder",
    "settings.recommendedFonts", "settings.refreshSystemFonts", "settings.scrollbackHint",
    "settings.systemFonts", "settings.underline",
  ],
  "url-settings": [
    "settings.urlSecurity", "settings.ignoreCertificateErrors", "settings.urlUserAgent",
    "settings.savedWebsitePasswords", "settings.urlDataShards", "settings.clearShard",
    "settings.urlDefaults", "settings.urlUserAgentDefault",
  ],
  "rdp-settings": [
    "settings.qualityDefaults", "settings.colorDepth", "settings.networkPerformance",
    "settings.bitmapCache", "settings.display", "settings.remoteDesktopViewMode",
    "settings.rdpRemoteResolution", "settings.rdpRedirectClipboard",
    "settings.rdpAdministrativeSession", "settings.rdpAdministrativeSessionHint",
    "settings.performanceFlags", "settings.rdpBitmapCacheHint",
    "settings.rdpColorDepth15", "settings.rdpColorDepth16", "settings.rdpColorDepth24",
    "settings.rdpColorDepth32", "settings.rdpPerformanceBalanced",
    "settings.rdpPerformanceQuality", "settings.rdpPerformanceSpeed",
    "settings.rdpRemoteResolutionAutomatic", "settings.remoteDesktopViewModeActualSize",
    "settings.remoteDesktopViewModeFit", "settings.remoteDesktopViewModeFitHeight",
    "settings.remoteDesktopViewModeFitWidth", "settings.remoteDesktopViewModeStretch",
  ],
  "vnc-settings": [
    "settings.encoding", "settings.preferredEncoding", "settings.colorLevel",
    "settings.display", "settings.remoteDesktopViewMode", "settings.vncSharedSession",
    "settings.vncViewOnly", "settings.qualityDefaults",
    "settings.remoteDesktopViewModeActualSize", "settings.remoteDesktopViewModeFit",
    "settings.remoteDesktopViewModeFitHeight", "settings.remoteDesktopViewModeFitWidth",
    "settings.remoteDesktopViewModeStretch", "settings.vncColor256", "settings.vncColor64",
    "settings.vncColor8", "settings.vncColorFull", "settings.vncEncodingRaw",
    "settings.vncEncodingTight", "settings.vncEncodingZrle",
  ],
  "screenshots-settings": [
    "settings.screenshotsFolder", "settings.screenshotsCaptureMode",
    "settings.screenshotsCaptureModeFolder", "settings.screenshotsCaptureModeClipboard",
    "settings.screenshotsCaptureModeBoth", "settings.screenshotsFormat",
    "settings.screenshotsFormatPng", "settings.screenshotsFormatJpeg",
    "settings.screenshotsQuality", "settings.useDirectxScreenCapture",
    "settings.screenshotsShortcuts", "settings.screenshotsDefaults",
    "settings.screenshotsBorder", "settings.screenshotsBorderEnabled",
    "settings.screenshotsBorderWidth", "settings.screenshotsBorderStyle",
    "settings.screenshotsBorderColor", "settings.screenshotsIncludeCursor",
  ],
  "dont-sleep-settings": ["settings.dontSleepForegroundOnly"],
  "shortcuts-settings": [
    "settings.workspaceTabs", "settings.sectionTerminal", "settings.shortcutPressKeys",
    "settings.shortcutClear", "settings.shortcutReset", "settings.shortcutResetAll",
    "settings.shortcutsHint", "settings.sectionScreenshots", "settings.screenshotsShortcuts",
    "screenshots.captureRegion", "screenshots.captureWindow", "screenshots.captureFullscreen",
    "settings.screenshotsEditorShortcuts", "screenshots.menu.copy", "common.save",
    "screenshots.editor.saveAs",
  ],
  "proxy-settings": [
    "settings.proxyMode", "settings.proxyModeSystem", "settings.proxyModeNone",
    "settings.proxyModeManual", "settings.proxyProtocol", "settings.proxyHttp",
    "settings.proxyHttps", "settings.proxySocks5", "settings.proxyHost", "settings.proxyPort",
    "settings.proxyHint", "settings.proxyPlatformHint",
  ],
  "about-settings": [
    "settings.version", "settings.developer", "settings.license", "settings.repository",
    "settings.github", "settings.appSlogan", "settings.portableMode",
    "settings.portableDataFolder", "settings.openPortableDataFolder",
  ],
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function settingsSearchDisplayLabel(value: string) {
  return value
    .replace(/{{[^}]+}}/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s:：,，;；-]+$/u, "")
    .trim();
}

export function settingsSearchTextMatchScore(template: string, candidate: string) {
  const normalizedTemplate = normalizeSearchText(template);
  const normalizedCandidate = normalizeSearchText(candidate);
  if (!normalizedTemplate || !normalizedCandidate) {
    return 0;
  }
  if (normalizedCandidate === normalizedTemplate) {
    return 3;
  }
  if (!normalizedTemplate.includes("{{") && normalizedCandidate.includes(normalizedTemplate)) {
    return 2;
  }

  const stableFragments = template
    .split(/{{[^}]+}}/g)
    .map(normalizeSearchText)
    .filter(Boolean);
  return stableFragments.length > 0 &&
    stableFragments.every((fragment) => normalizedCandidate.includes(fragment))
    ? 1
    : 0;
}

export function buildSettingsSearchResults({
  activeLanguage,
  query,
  sections,
  translate,
}: {
  activeLanguage: string;
  query: string;
  sections: readonly SettingsSearchSection[];
  translate: Translate;
}): SettingsSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  return sections.flatMap((section) => {
    const sectionLabel = translate(section.labelKey, activeLanguage);
    const englishSectionLabel = translate(section.labelKey, "en");
    const sectionMatches = [sectionLabel, englishSectionLabel]
      .some((value) => normalizeSearchText(value).includes(normalizedQuery));
    const seenLabels = new Set<string>();
    const searchKeys = section.searchKeys.flatMap((key) => [
      key,
      `${key}Hint`,
      `${key}Desc`,
      `${key}Description`,
    ]).filter((key, index, keys) =>
      keys.indexOf(key) === index && translate(key, "en") !== key,
    );
    const matches = searchKeys.flatMap((key) => {
      const localizedLabel = translate(key, activeLanguage);
      const englishLabel = translate(key, "en");
      const normalizedLabel = normalizeSearchText(localizedLabel);
      if (
        seenLabels.has(normalizedLabel) ||
        ![localizedLabel, englishLabel].some((value) =>
          normalizeSearchText(value).includes(normalizedQuery),
        )
      ) {
        return [];
      }
      seenLabels.add(normalizedLabel);
      return [{ key, label: settingsSearchDisplayLabel(localizedLabel) }];
    });

    if (!sectionMatches && matches.length === 0) {
      return [];
    }
    return [{ id: section.id, label: sectionLabel, matches }];
  });
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SETTINGS_SEARCH_KEYS } from "../src/modules/settings/settingsSearch";
import type { SettingsSectionId } from "../src/modules/settings/settingsAssistantContext";

const SECTION_SOURCES: Record<SettingsSectionId, readonly string[]> = {
  "general-settings": ["GeneralSettings.tsx"],
  "appearance-settings": ["AppearanceSettings.tsx", "ThemeSchemeGrid.tsx"],
  "workspace-settings": ["WorkspaceSettings.tsx"],
  "file-explorer-settings": ["FileExplorerSettings.tsx"],
  "dashboard-settings": ["DashboardSettings.tsx"],
  "installer-settings": ["InstallerSettings.tsx"],
  "credentials-settings": [
    "CredentialsSettings.tsx", "SavedCredentialsManager.tsx",
    "SavedCredentialEditDialog.tsx", "SavedCredentialUsageDialog.tsx",
    "SavedCredentialMergeDialog.tsx", "SavedCredentialConvertDialog.tsx",
  ],
  "assistant-settings": ["AiSettings.tsx", "AssistantSkills.tsx", "McpServers.tsx"],
  "ssh-settings": ["SshSettings.tsx"],
  "terminal-settings": ["TerminalSettings.tsx"],
  "url-settings": ["UrlSettings.tsx"],
  "rdp-settings": ["RdpSettings.tsx"],
  "vnc-settings": ["VncSettings.tsx"],
  "dont-sleep-settings": ["DontSleepSettings.tsx"],
  "shortcuts-settings": ["ShortcutsSettings.tsx"],
  "proxy-settings": ["ProxySettings.tsx"],
  "about-settings": ["AboutSettings.tsx"],
};

const SECTION_LABEL_KEYS: Record<SettingsSectionId, string> = {
  "general-settings": "settings.sectionGeneral",
  "appearance-settings": "settings.sectionAppearance",
  "workspace-settings": "settings.sectionWorkspace",
  "file-explorer-settings": "settings.fileExplorer",
  "dashboard-settings": "settings.sectionDashboard",
  "installer-settings": "settings.sectionInstaller",
  "credentials-settings": "settings.sectionCredentials",
  "assistant-settings": "settings.sectionAiAssistant",
  "ssh-settings": "settings.sectionSsh",
  "terminal-settings": "settings.sectionTerminal",
  "url-settings": "settings.sectionUrl",
  "rdp-settings": "settings.sectionRdp",
  "vnc-settings": "settings.sectionVnc",
  "dont-sleep-settings": "settings.sectionDontSleep",
  "shortcuts-settings": "settings.sectionShortcuts",
  "proxy-settings": "settings.proxy",
  "about-settings": "settings.sectionAbout",
};

// These strings can appear while using a Settings page but do not describe a
// searchable setting. Keep exclusions explicit so every new page string must
// be intentionally indexed or classified by this guard.
const NON_SEARCHABLE_KEYS: Record<SettingsSectionId, readonly string[]> = {
  "general-settings": [
    "settings.generalDefaultsSaved", "settings.importSettingsComplete",
    "settings.lastBackupNever", "settings.lastCheckedNever",
    "settings.resetAllSettingsComplete", "settings.resetAllSettingsConfirm",
  ],
  "appearance-settings": [
    "settings.appearanceSaved", "settings.systemFontsRefreshed",
    "settings.systemFontsUnavailable",
  ],
  "workspace-settings": ["settings.workspaceSaved"],
  "file-explorer-settings": ["settings.fileExplorerSaved"],
  "dashboard-settings": ["settings.dashboardSaved"],
  "installer-settings": ["settings.installerSaved"],
  "credentials-settings": [
    "settings.credentialDeleted", "settings.credentialStorageActive",
    "settings.credentialStorageSaved", "settings.credentialStorageUnavailable",
    "settings.credentialStorageUnknownStatus", "settings.encryptedSecretStoreConfigured",
    "settings.encryptedSecretStorePasswordChanged",
    "settings.widgetCredentialsEmpty",
    "settings.credentialMissingSecret", "settings.deleteCredentialConfirmBody",
    "settings.credentialColumnDetails", "settings.credentialColumnName",
    "settings.credentialColumnStatus",
    "settings.savedCredentialsEmpty", "settings.savedCredentialsSearch",
    "settings.savedCredentialConvert", "settings.savedCredentialConvertExisting",
    "settings.savedCredentialConvertHint", "settings.savedCredentialConvertNew",
    "settings.savedCredentialConvertTitle", "settings.savedCredentialConverted",
    "settings.savedCredentialDeleteUsed", "settings.savedCredentialEditTitle",
    "settings.savedCredentialLinkApply",
    "settings.savedCredentialLinkEmpty", "settings.savedCredentialLinkTitle",
    "settings.savedCredentialMerge", "settings.savedCredentialMergeHint",
    "settings.savedCredentialMergeSelect", "settings.savedCredentialMergeSelected",
    "settings.savedCredentialMergeTitle", "settings.savedCredentialMergeSelectionHint",
    "settings.savedCredentialMerged", "settings.savedCredentialName",
    "settings.savedCredentialNameHint", "settings.savedCredentialNamePlaceholder",
    "settings.savedCredentialPasswordEdit", "settings.savedCredentialSaved",
    "settings.savedCredentialUnlink",
    "settings.savedCredentialUsageEmpty", "settings.savedCredentialUsageTitle",
    "settings.savedCredentialUsageUpdated", "settings.savedCredentialUsedBy",
    "settings.savedCredentialUsername",
  ],
  "assistant-settings": [
    "settings.aiCliAuthStarted", "settings.aiCliInstallFailed",
    "settings.aiCliInstallStarted", "settings.aiCliStatusAuthRequired",
    "settings.aiCliStatusMissing", "settings.aiCliStatusReady",
    "settings.aiCliStatusUnknown", "settings.aiProviderSaved",
    "settings.assistantSkillsEmpty", "settings.builtInMcpConfigCopied",
    "settings.copilotAuthCode", "settings.copilotAuthPending",
    "settings.copilotCliStatusMissing", "settings.copilotCliStatusReady",
    "settings.copilotCliStatusUnknown", "settings.copilotConnected",
    "settings.copilotDisconnected", "settings.extraHeadersPlaceholder",
    "settings.keychainSaveFailedTitle", "settings.lastCheckedAt",
    "settings.mcpAuthBadge", "settings.mcpServersEmpty",
    "settings.mcpStatusAuthError", "settings.mcpStatusOk",
    "settings.mcpStatusProtocolError", "settings.mcpStatusUnknown",
    "settings.mcpStatusUnreachable", "settings.mcpToolsCount",
    "settings.modelListRefreshed", "settings.refreshingModels",
    "settings.secretSaveFailed",
  ],
  "ssh-settings": [
    "settings.defaultKeyPlaceholder", "settings.defaultSshPortRange",
    "settings.defaultSshUserRequired", "settings.defaultTransparencyRange",
    "settings.proxyJumpPlaceholder", "settings.sshBufferRange",
    "settings.sshDefaultsSaved", "settings.sshKeyEmailDialogHint",
    "settings.sshKeyEmailDialogTitle", "settings.sshKeyEmailPlaceholder",
    "settings.sshKeyEmailPrompt", "settings.sshKeyGenerated",
    "settings.sshKeyGenerating", "settings.sshKeyPassphraseConfirm",
    "settings.sshKeyPassphraseMismatch", "settings.sshKeyPassphraseOptional",
    "settings.xServerAlreadyRunning", "settings.xServerDisplayRange",
    "settings.xServerLaunchStarted", "settings.xServerPathPlaceholder",
  ],
  "terminal-settings": [
    "settings.customShellCommandLinePlaceholder", "settings.customShellNamePlaceholder",
    "settings.defaultShellRequired", "settings.defaultTransparencyRange",
    "settings.fontFamilyRequired", "settings.fontSizeRange",
    "settings.hyperlinkRuleIncomplete", "settings.hyperlinkRuleInvalidPattern",
    "settings.hyperlinkRuleUrlInvalid", "settings.includesSsh",
    "settings.lineHeightRange", "settings.removeCustomShell",
    "settings.removeHyperlinkRule", "settings.scrollbackRange",
    "settings.systemFontsRefreshed", "settings.systemFontsUnavailable",
    "settings.terminalSaved",
  ],
  "url-settings": [
    "settings.noUrlDataShards", "settings.urlDataShardCleared",
    "settings.urlSettingsSaved", "settings.urlUserAgentDefaultPlaceholder",
  ],
  "rdp-settings": ["settings.rdpSettingsSaved", "settings.rdpSharedFoldersRequired"],
  "vnc-settings": ["settings.vncSettingsSaved"],
  "dont-sleep-settings": ["settings.dontSleepSettingsSaved"],
  "shortcuts-settings": [
    "settings.shortcutConflict", "settings.shortcutNotSet", "settings.shortcutsSaved",
  ],
  "proxy-settings": ["settings.proxyHostPlaceholder", "settings.proxySettingsSaved"],
  "about-settings": [],
};

function settingsKeysInSource(source: string) {
  const keys = new Set<string>();
  for (const match of source.matchAll(/t\(\s*(["'`])(settings\.[A-Za-z0-9_.-]+)\1/g)) {
    keys.add(match[2]);
  }
  for (const match of source.matchAll(/labelKey:\s*(["'`])(settings\.[A-Za-z0-9_.-]+)\1/g)) {
    keys.add(match[2]);
  }
  return keys;
}

test("every Settings page string is searchable or explicitly non-searchable", () => {
  for (const sectionId of Object.keys(SECTION_SOURCES) as SettingsSectionId[]) {
    const source = SECTION_SOURCES[sectionId]
      .map((name) => readFileSync(
        new URL(`../src/modules/settings/${name}`, import.meta.url),
        "utf8",
      ))
      .join("\n");
    const indexedKeys = new Set(SETTINGS_SEARCH_KEYS[sectionId]);
    const derivedKeys = new Set([...indexedKeys].flatMap((key) => [
      `${key}Hint`, `${key}Desc`, `${key}Description`,
    ]));
    const excludedKeys = new Set(NON_SEARCHABLE_KEYS[sectionId]);
    const unclassified = [...settingsKeysInSource(source)].filter((key) =>
      key !== SECTION_LABEL_KEYS[sectionId] &&
      !indexedKeys.has(key) &&
      !derivedKeys.has(key) &&
      !excludedKeys.has(key),
    );

    assert.deepEqual(
      unclassified,
      [],
      `${sectionId} has new Settings text that must be added to SETTINGS_SEARCH_KEYS ` +
        "or intentionally classified in NON_SEARCHABLE_KEYS",
    );
  }
});

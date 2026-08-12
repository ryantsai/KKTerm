import {
  normalizeTutorialNavigationTarget,
  tutorialNavigationForTarget,
  tutorialSurfaceKindForTarget,
} from "./tutorialNavigationModel.ts";

const appearanceNavigation = tutorialNavigationForTarget("settings.appearance.colorScheme");

if (appearanceNavigation?.page !== "settings") {
  throw new Error("Color scheme tutorial target should navigate to Settings.");
}

if (appearanceNavigation.settingsSectionId !== "appearance-settings") {
  throw new Error("Color scheme tutorial target should navigate to Appearance settings.");
}

const languageNavigation = tutorialNavigationForTarget("settings.language");

if (languageNavigation?.page !== "settings") {
  throw new Error("Language tutorial target should navigate to Settings.");
}

if (languageNavigation.settingsSectionId !== "general-settings") {
  throw new Error("Language tutorial target should navigate to General settings.");
}

const addConnectionNavigation = tutorialNavigationForTarget("connections.addConnection");

if (addConnectionNavigation?.page !== "workspace") {
  throw new Error("Add Connection tutorial target should navigate to Workspace.");
}

if (addConnectionNavigation.settingsSectionId) {
  throw new Error("Add Connection tutorial target should not navigate to Settings.");
}

const workspaceTargets = [
  "app.activityRailWorkspace",
  "app.activityRailNewWorkspace",
  "app.activityRailDashboard",
  "app.connectionRail",
  "app.activityRailDontSleep",
  "app.activityRailSettings",
  "app.connectionsResize",
  "app.aiAssistantResize",
  "assistant.panel",
  "assistant.toolbar",
  "assistant.settings",
  "assistant.newChat",
  "assistant.context",
  "assistant.chatLog",
  "assistant.composer",
  "assistant.addContext",
  "assistant.permissionMode",
  "assistant.model",
  "assistant.send",
  "connections.panel",
  "connections.search",
  "connections.quickConnect",
  "connections.folderControls",
  "connections.tree",
  "workspace.tabStrip",
  "workspace.canvas",
  "workspace.emptyState",
  "workspace.statusBar",
  "workspace.hostUsage",
  "workspace.screenshotMenu",
  "terminal.pane",
  "terminal.tmuxSessions",
  "terminal.sshPortRedirect",
  "terminal.startRecording",
  "terminal.openSftp",
  "terminal.copySelection",
  "terminal.sendToAi",
  "terminal.actions",
  "terminal.searchBar",
  "terminal.surface",
  "sftp.toolbar",
  "sftp.upload",
  "sftp.download",
  "sftp.localPane",
  "sftp.remotePane",
  "sftp.transferQueue",
  "webview.toolbar",
  "webview.address",
  "webview.openExternally",
  "webview.autoRefresh",
  "webview.savePassword",
  "webview.fillCredential",
  "webview.sendToAi",
  "webview.close",
  "webview.surface",
  "remoteDesktop.toolbar",
  "remoteDesktop.sendCtrlAltDel",
  "remoteDesktop.reconnect",
  "remoteDesktop.sendToAi",
  "remoteDesktop.surface",
] as const;

for (const targetId of workspaceTargets) {
  const navigation = tutorialNavigationForTarget(targetId);
  if (navigation?.page !== "workspace") {
    throw new Error(`${targetId} should navigate to Workspace.`);
  }
  if (navigation.settingsSectionId) {
    throw new Error(`${targetId} should not navigate to Settings.`);
  }
}

const dashboardTargets = [
  "dashboard.views",
  "dashboard.addView",
  "dashboard.editLayout",
  "dashboard.addWidget",
  "dashboard.canvas",
] as const;

for (const targetId of dashboardTargets) {
  if (tutorialNavigationForTarget(targetId)?.page !== "dashboard") {
    throw new Error(`${targetId} should navigate to Dashboard.`);
  }
}

const itOpsTargets = [
  "app.activityRailItOps",
  "itops.sitesTree",
  "itops.siteView",
] as const;

for (const targetId of itOpsTargets) {
  if (tutorialNavigationForTarget(targetId)?.page !== "itops") {
    throw new Error(`${targetId} should navigate to IT Ops.`);
  }
}

const itOpsDestinationTargets = [
  ["itops.hostsPanel", "hosts"],
  ["itops.runHistoryPanel", "runHistory"],
  ["itops.taskLibraryNew", "taskLibrary"],
  ["itops.ipam", "ipam"],
  ["itops.ipamNew", "ipam"],
  ["itops.networkMaps", "networkMaps"],
  ["itops.networkMapNew", "networkMaps"],
  ["itops.host:host-1", "hosts"],
  ["itops.run:run-1", "runHistory"],
] as const;

for (const [targetId, destination] of itOpsDestinationTargets) {
  const navigation = tutorialNavigationForTarget(targetId);
  if (navigation?.page !== "itops" || navigation.itopsDestination !== destination) {
    throw new Error(`${targetId} should navigate to the IT Ops ${destination} destination.`);
  }
}

const explicitItOpsNavigation = normalizeTutorialNavigationTarget({
  page: "itops",
  itopsSiteId: "site-1",
  itopsDestination: "hosts",
});

if (
  explicitItOpsNavigation?.itopsSiteId !== "site-1" ||
  explicitItOpsNavigation.itopsDestination !== "hosts"
) {
  throw new Error("Explicit IT Ops navigation should preserve its Site and destination.");
}

if (normalizeTutorialNavigationTarget({ page: "itops", itopsSiteId: 42 })) {
  throw new Error("A non-string IT Ops Site id should be rejected.");
}

const inferredSystemCleanerNavigation = normalizeTutorialNavigationTarget({
  systemCleanerSection: "overview",
});

if (
  inferredSystemCleanerNavigation?.page !== "systemCleaner" ||
  inferredSystemCleanerNavigation.systemCleanerSection !== "overview"
) {
  throw new Error("The System Cleaner Overview should infer System Cleaner navigation.");
}

if (normalizeTutorialNavigationTarget({ systemCleanerSection: "cleanup" })) {
  throw new Error("Removed System Cleaner sub-destinations should be rejected.");
}

const settingsTargets = [
  ["settings.activityRail", "general-settings"],
  ["settings.workspaceAccess", "general-settings"],
  ["settings.statusBar", "general-settings"],
  ["settings.settingsData", "general-settings"],
  ["settings.debug", "general-settings"],
  ["settings.useDirectxScreenCapture", "screenshots-settings"],
  ["settings.appUiFontFamily", "appearance-settings"],
  ["settings.resetLayout", "appearance-settings"],
  ["settings.dashboardDefaultLanding", "dashboard-settings"],
  ["settings.dashboardUseRandomDynamicBackground", "dashboard-settings"],
  ["settings.dashboardMaxActiveScriptWidgets", "dashboard-settings"],
  ["settings.credentialStorage", "credentials-settings"],
  ["settings.credentialsStored", "credentials-settings"],
  ["settings.widgetCredentialsStored", "credentials-settings"],
  ["settings.aiProvider", "assistant-settings"],
  ["settings.aiToolsTitle", "assistant-settings"],
  ["settings.aiCustomInstructions", "assistant-settings"],
  ["settings.assistantSkillsTitle", "assistant-settings"],
  ["settings.mcpServersTitle", "assistant-settings"],
  ["settings.defaultUser", "ssh-settings"],
  ["settings.defaultPort", "ssh-settings"],
  ["settings.defaultKey", "ssh-settings"],
  ["settings.sshBufferLines", "ssh-settings"],
  ["settings.terminalFontFamily", "terminal-settings"],
  ["settings.terminalFontSize", "terminal-settings"],
  ["settings.defaultShell", "terminal-settings"],
  ["settings.scrollbackLines", "terminal-settings"],
  ["settings.ignoreCertificateErrors", "url-settings"],
  ["settings.urlSavedPasswords", "url-settings"],
  ["settings.urlDataShards", "url-settings"],
  ["settings.rdpColorDepth", "rdp-settings"],
  ["settings.rdpPerformanceProfile", "rdp-settings"],
  ["settings.vncViewOnly", "vnc-settings"],
  ["settings.vncColorLevel", "vnc-settings"],
  ["settings.aboutVersion", "about-settings"],
  ["settings.workspace", "workspace-settings"],
  ["settings.fileExplorer", "file-explorer-settings"],
  ["settings.dontSleep", "dont-sleep-settings"],
  ["settings.installer", "installer-settings"],
] as const;

for (const [targetId, settingsSectionId] of settingsTargets) {
  const navigation = tutorialNavigationForTarget(targetId);
  if (navigation?.page !== "settings") {
    throw new Error(`${targetId} should navigate to Settings.`);
  }
  if (navigation.settingsSectionId !== settingsSectionId) {
    throw new Error(`${targetId} should navigate to ${settingsSectionId}.`);
  }
}

const parsedNavigation = normalizeTutorialNavigationTarget({
  page: "settings",
  settingsSectionId: "appearance-settings",
});

if (parsedNavigation?.page !== "settings") {
  throw new Error("Explicit Settings navigation should be accepted.");
}

if (parsedNavigation.settingsSectionId !== "appearance-settings") {
  throw new Error("Explicit Settings section navigation should be preserved.");
}

const invalidSectionNavigation = normalizeTutorialNavigationTarget({
  page: "settings",
  settingsSectionId: "definitely-not-settings",
});

if (invalidSectionNavigation) {
  throw new Error("Unknown Settings section navigation should be rejected.");
}

for (const page of ["itops", "installer"] as const) {
  if (normalizeTutorialNavigationTarget({ page })?.page !== page) {
    throw new Error(`${page} tutorial navigation should be accepted.`);
  }
}

const missingTargetNavigation = tutorialNavigationForTarget("settings.missing.target");

if (missingTargetNavigation) {
  throw new Error("Unknown tutorial targets should not infer navigation.");
}

const surfaceTargets = [
  ["terminal.surface", "terminal"],
  ["terminal.openSftp", "terminal"],
  ["sftp.upload", "sftp"],
  ["webview.address", "webview"],
  ["remoteDesktop.reconnect", "remoteDesktop"],
] as const;

for (const [targetId, surfaceKind] of surfaceTargets) {
  if (tutorialSurfaceKindForTarget(targetId) !== surfaceKind) {
    throw new Error(`${targetId} should map to the ${surfaceKind} Tab surface.`);
  }
}

const chromeTargets = [
  "workspace.tabStrip",
  "workspace.statusBar",
  "connections.tree",
  "app.activityRailWorkspace",
  "app.activityRailNewWorkspace",
  "settings.language",
];

for (const targetId of chromeTargets) {
  if (tutorialSurfaceKindForTarget(targetId) !== undefined) {
    throw new Error(`${targetId} is app chrome and should not require a Tab surface.`);
  }
}

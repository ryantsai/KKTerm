import type { ActivePage } from "./ActivityRail";
import type { SettingsSectionId } from "../modules/settings/settingsAssistantContext";

/** An IT Ops navigator destination the tutorial overlay can open: a Site's
 * predefined virtual pages, or the global Task Library root surface. */
export type ItOpsNavigationDestination =
  | "site"
  | "serverRooms"
  | "hosts"
  | "automations"
  | "runHistory"
  | "taskLibrary";

export type TutorialNavigationTarget = {
  page: ActivePage;
  settingsSectionId?: SettingsSectionId;
  /** IT Ops only: which Site to select (defaults to the active/first Site). */
  itopsSiteId?: string;
  /** IT Ops only: which navigator destination to open for that Site. */
  itopsDestination?: ItOpsNavigationDestination;
};

const ITOPS_NAVIGATION_DESTINATIONS = new Set<ItOpsNavigationDestination>([
  "site",
  "serverRooms",
  "hosts",
  "automations",
  "runHistory",
  "taskLibrary",
]);

const SETTINGS_SECTION_IDS = new Set<SettingsSectionId>([
  "general-settings",
  "appearance-settings",
  "dashboard-settings",
  "workspace-settings",
  "file-explorer-settings",
  "dont-sleep-settings",
  "installer-settings",
  "credentials-settings",
  "assistant-settings",
  "ssh-settings",
  "terminal-settings",
  "url-settings",
  "rdp-settings",
  "vnc-settings",
  "screenshots-settings",
  "shortcuts-settings",
  "proxy-settings",
  "about-settings",
]);

const SETTINGS_TUTORIAL_TARGET_SECTIONS: Record<string, SettingsSectionId> = {
  "settings.language": "general-settings",
  "settings.activityRail": "general-settings",
  "settings.workspaceAccess": "general-settings",
  "settings.useDirectxScreenCapture": "general-settings",
  "settings.statusBar": "general-settings",
  "settings.settingsData": "general-settings",
  "settings.debug": "general-settings",
  "settings.appUiFontFamily": "appearance-settings",
  "settings.appearance.colorScheme": "appearance-settings",
  "settings.resetLayout": "appearance-settings",
  "settings.dashboardDefaultLanding": "dashboard-settings",
  "settings.dashboardUseRandomDynamicBackground": "dashboard-settings",
  "settings.dashboardMaxActiveScriptWidgets": "dashboard-settings",
  "settings.credentialStorage": "credentials-settings",
  "settings.credentialsStored": "credentials-settings",
  "settings.widgetCredentialsStored": "credentials-settings",
  "settings.aiProvider": "assistant-settings",
  "settings.aiToolsTitle": "assistant-settings",
  "settings.aiCustomInstructions": "assistant-settings",
  "settings.assistantSkillsTitle": "assistant-settings",
  "settings.mcpServersTitle": "assistant-settings",
  "settings.defaultUser": "ssh-settings",
  "settings.defaultPort": "ssh-settings",
  "settings.defaultKey": "ssh-settings",
  "settings.sshBufferLines": "ssh-settings",
  "settings.terminalFontFamily": "terminal-settings",
  "settings.terminalFontSize": "terminal-settings",
  "settings.defaultShell": "terminal-settings",
  "settings.scrollbackLines": "terminal-settings",
  "settings.ignoreCertificateErrors": "url-settings",
  "settings.urlSavedPasswords": "url-settings",
  "settings.urlDataShards": "url-settings",
  "settings.rdpColorDepth": "rdp-settings",
  "settings.rdpPerformanceProfile": "rdp-settings",
  "settings.rdpRemoteResolution": "rdp-settings",
  "settings.vncViewOnly": "vnc-settings",
  "settings.vncColorLevel": "vnc-settings",
  "settings.screenshotsFolder": "screenshots-settings",
  "settings.screenshotsFormat": "screenshots-settings",
  "settings.screenshotsShortcuts": "screenshots-settings",
  "settings.shortcuts": "shortcuts-settings",
  "settings.proxy": "proxy-settings",
  "settings.aboutVersion": "about-settings",
  "settings.workspace": "workspace-settings",
  "settings.fileExplorer": "file-explorer-settings",
  "settings.dontSleep": "dont-sleep-settings",
  "settings.installer": "installer-settings",
};

const WORKSPACE_TUTORIAL_TARGET_IDS = [
  "app.activityRailWorkspace",
  "app.activityRailNewWorkspace",
  "app.activityRailDashboard",
  "app.connectionRail",
  "app.activityRailDontSleep",
  "app.activityRailInstaller",
  "app.activityRailSettings",
  "app.connectionsResize",
  "app.aiAssistantResize",
  "connections.panel",
  "connections.search",
  "connections.quickConnect",
  "connections.addConnection",
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
  "remoteDesktop.viewMode",
  "remoteDesktop.sendCtrlAltDel",
  "remoteDesktop.reconnect",
  "remoteDesktop.sendToAi",
  "remoteDesktop.surface",
] as const;

const DASHBOARD_TUTORIAL_TARGET_IDS = [
  "dashboard.views",
  "dashboard.addView",
  "dashboard.editLayout",
  "dashboard.addWidget",
  "dashboard.canvas",
] as const;

const ITOPS_TUTORIAL_TARGET_IDS = [
  "app.activityRailItOps",
  "itops.sitesTree",
  "itops.siteView",
] as const;

// IT Ops destination-page targets: highlighting one first opens its navigator
// destination (Site selection falls back to the active/first Site).
const ITOPS_DESTINATION_TUTORIAL_TARGETS: Record<string, ItOpsNavigationDestination> = {
  "itops.hostsPanel": "hosts",
  "itops.hostsRunTask": "hosts",
  "itops.hostsImport": "hosts",
  "itops.hostsScan": "hosts",
  "itops.automationsPanel": "automations",
  "itops.automationsNew": "automations",
  "itops.runHistoryPanel": "runHistory",
  "itops.taskLibrary": "taskLibrary",
  "itops.taskLibraryNew": "taskLibrary",
};

// Entity-scoped dynamic targets (`itops.<entity>:<id>`), advertised through the
// IT Ops page context rather than the static registry. The prefix picks the
// destination; pass navigation.itopsSiteId when the entity belongs to a Site
// that is not currently selected.
const ITOPS_ENTITY_TARGET_PREFIXES: Record<string, ItOpsNavigationDestination> = {
  "itops.site:": "site",
  "itops.host:": "hosts",
  "itops.automation:": "automations",
  "itops.task:": "taskLibrary",
  "itops.run:": "runHistory",
};

const INSTALLER_TUTORIAL_TARGET_IDS = [
  "installer.updateAll",
  "installer.toolOptions",
] as const;

const SCREENSHOTS_TUTORIAL_TARGET_IDS = [
  "app.activityRailScreenshots",
  "screenshots.captureRegion",
  "screenshots.captureWindow",
  "screenshots.captureFullscreen",
  "screenshots.viewSwitch",
  "screenshots.library",
] as const;

const TUTORIAL_TARGET_NAVIGATION: Record<string, TutorialNavigationTarget> = {
  ...Object.fromEntries(
    DASHBOARD_TUTORIAL_TARGET_IDS.map((targetId) => [
      targetId,
      { page: "dashboard" },
    ]),
  ),
  ...Object.fromEntries(
    ITOPS_TUTORIAL_TARGET_IDS.map((targetId) => [
      targetId,
      { page: "itops" },
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(ITOPS_DESTINATION_TUTORIAL_TARGETS).map(
      ([targetId, itopsDestination]) => [
        targetId,
        { page: "itops", itopsDestination },
      ],
    ),
  ),
  ...Object.fromEntries(
    WORKSPACE_TUTORIAL_TARGET_IDS.map((targetId) => [
      targetId,
      { page: "workspace" },
    ]),
  ),
  ...Object.fromEntries(
    INSTALLER_TUTORIAL_TARGET_IDS.map((targetId) => [
      targetId,
      { page: "installer" },
    ]),
  ),
  ...Object.fromEntries(
    SCREENSHOTS_TUTORIAL_TARGET_IDS.map((targetId) => [
      targetId,
      { page: "screenshots" },
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(SETTINGS_TUTORIAL_TARGET_SECTIONS).map(
      ([targetId, settingsSectionId]) => [
        targetId,
        { page: "settings", settingsSectionId },
      ],
    ),
  ),
};

export function tutorialNavigationForTarget(
  targetId: string,
): TutorialNavigationTarget | undefined {
  const trimmed = targetId.trim();
  const staticTarget = TUTORIAL_TARGET_NAVIGATION[trimmed];
  if (staticTarget) {
    return staticTarget;
  }
  for (const [prefix, itopsDestination] of Object.entries(ITOPS_ENTITY_TARGET_PREFIXES)) {
    if (trimmed.startsWith(prefix) && trimmed.length > prefix.length) {
      return { page: "itops", itopsDestination };
    }
  }
  return undefined;
}

// Tutorial targets that live inside an open Workspace Tab surface can only be
// highlighted when a Tab of the matching kind is active. The prefix of the
// targetId identifies which surface the control belongs to.
export type TutorialSurfaceKind =
  | "terminal"
  | "sftp"
  | "webview"
  | "remoteDesktop";

export function tutorialSurfaceKindForTarget(
  targetId: string,
): TutorialSurfaceKind | undefined {
  const trimmed = targetId.trim();
  if (trimmed.startsWith("terminal.")) {
    return "terminal";
  }
  if (trimmed.startsWith("sftp.")) {
    return "sftp";
  }
  if (trimmed.startsWith("webview.")) {
    return "webview";
  }
  if (trimmed.startsWith("remoteDesktop.")) {
    return "remoteDesktop";
  }
  return undefined;
}

export function normalizeTutorialNavigationTarget(
  value: unknown,
): TutorialNavigationTarget | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const page = normalizeTutorialPage(candidate.page);
  const settingsSectionId = normalizeSettingsSectionId(candidate.settingsSectionId);
  const itopsSiteId = normalizeItopsSiteId(candidate.itopsSiteId);
  const itopsDestination = normalizeItopsDestination(candidate.itopsDestination);

  if (candidate.settingsSectionId !== undefined && !settingsSectionId) {
    return undefined;
  }
  if (candidate.itopsDestination !== undefined && !itopsDestination) {
    return undefined;
  }
  if (candidate.itopsSiteId !== undefined && !itopsSiteId) {
    return undefined;
  }

  const hasItopsFields = Boolean(itopsSiteId || itopsDestination);

  if (page) {
    if (page !== "settings" && settingsSectionId) {
      return undefined;
    }
    if (page !== "itops" && hasItopsFields) {
      return undefined;
    }
    if (settingsSectionId) {
      return { page, settingsSectionId };
    }
    if (hasItopsFields) {
      return {
        page,
        ...(itopsSiteId ? { itopsSiteId } : {}),
        ...(itopsDestination ? { itopsDestination } : {}),
      };
    }
    return { page };
  }

  if (settingsSectionId) {
    return { page: "settings", settingsSectionId };
  }
  if (hasItopsFields) {
    return {
      page: "itops",
      ...(itopsSiteId ? { itopsSiteId } : {}),
      ...(itopsDestination ? { itopsDestination } : {}),
    };
  }
  return undefined;
}

function normalizeTutorialPage(value: unknown): ActivePage | undefined {
  if (
    value === "workspace" ||
    value === "dashboard" ||
    value === "itops" ||
    value === "installer" ||
    value === "screenshots" ||
    value === "settings"
  ) {
    return value;
  }
  return undefined;
}

function normalizeSettingsSectionId(value: unknown): SettingsSectionId | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim() as SettingsSectionId;
  return SETTINGS_SECTION_IDS.has(trimmed) ? trimmed : undefined;
}

function normalizeItopsSiteId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeItopsDestination(value: unknown): ItOpsNavigationDestination | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim() as ItOpsNavigationDestination;
  return ITOPS_NAVIGATION_DESTINATIONS.has(trimmed) ? trimmed : undefined;
}

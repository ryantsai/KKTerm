// Frontend live-tool dispatcher for the Assistant: executes the session_*,
// quick_command_*, screenshot, and tutorial tools that the backend agent loop
// requests over the live tool bridge. Handlers read live state from the
// workspace/dashboard stores and pane registry; the few panel-owned
// capabilities (navigation, tutorial overlay, translations) are injected via
// AssistantLiveToolDeps. Extracted verbatim from AssistantPanel.tsx.
import type { TFunction } from "i18next";
import type { TutorialHighlightRequest } from "../app/TutorialOverlay";
import {
  normalizeTutorialNavigationTarget,
  tutorialNavigationForTarget,
} from "../app/tutorialNavigationModel";
import { invokeCommand, isTauriRuntime } from "../lib/tauri";
import type { CaptureScreenshotRequest } from "../lib/tauri";
import {
  quickCommandTargetForConnection,
  quickCommandsForConnectionState,
  useWorkspaceStore,
} from "../store";
import { isAccentName, isIconName } from "../modules/dashboard/registry/palette";
import { useDashboardStore } from "../modules/dashboard/state/dashboardStore";
import {
  getFileBrowserController,
  getPaneRenderer,
  getRemoteDesktopController,
  writeInputToPane,
} from "../modules/workspace/paneRegistry";
import { prepareAssistantTerminalInput } from "./terminalCommandSend";
import { waitForScreenshotSurface } from "./assistantScreenshotRegion";
import { assistantQuickCommandId } from "./assistantComposer";
import { resolveInstallPlan } from "../modules/installer/dag";
import {
  installRecipeAndWait,
  uninstallRecipeAndWait,
} from "../modules/installer/progress";
import type { InstallOptions } from "../modules/installer/types";
import type { QuickCommand } from "../types";

export interface AssistantLiveToolDeps {
  t: TFunction;
  onOpenWorkspace: () => void;
  onOpenDashboard: (viewId?: string) => void;
  onTutorialRequest: (
    request: TutorialHighlightRequest,
  ) => Promise<{ ok: boolean; error?: string }>;
}

export async function runAssistantLiveTool(
  toolName: string,
  args: Record<string, unknown>,
  deps: AssistantLiveToolDeps,
) {
  switch (toolName) {
    case "tutorial_highlight":
      return assistantTutorialHighlight(args, deps);
    case "session_state":
      return assistantSessionState();
    case "session_activate_tab":
      return assistantActivateTab(args);
    case "session_terminal_read_buffer":
      return assistantTerminalReadBuffer(args);
    case "session_terminal_send_text":
      return assistantTerminalSendText(args);
    case "session_remote_desktop_screenshot":
      return assistantRemoteDesktopScreenshot(args);
    case "workspace_connection_screenshot":
      return assistantWorkspaceConnectionScreenshot(args, deps);
    case "dashboard_view_screenshot":
      return assistantDashboardViewScreenshot(args, deps);
    case "dashboard_widget_screenshot":
      return assistantDashboardWidgetScreenshot(args, deps);
    case "session_remote_desktop_send_text":
      return assistantRemoteDesktopSendText(args);
    case "session_remote_desktop_keypress":
      return assistantRemoteDesktopKeyPress(args);
    case "session_remote_desktop_mouse_click":
      return assistantRemoteDesktopMouseClick(args);
    case "session_file_browser_list":
      return assistantFileBrowserList(args);
    case "session_file_browser_create_folder":
      return assistantFileBrowserCreateFolder(args);
    case "session_file_browser_rename":
      return assistantFileBrowserRename(args);
    case "session_file_browser_delete":
      return assistantFileBrowserDelete(args);
    case "quick_command_list":
      return assistantQuickCommandList(args);
    case "quick_command_read":
      return assistantQuickCommandRead(args);
    case "quick_command_create":
      return assistantQuickCommandCreate(args);
    case "quick_command_edit":
      return assistantQuickCommandEdit(args);
    case "installer_list_tools":
      return assistantInstallerListTools();
    case "installer_check_updates":
      return assistantInstallerCheckUpdates(args);
    case "installer_install":
      return assistantInstallerInstall(args);
    case "installer_uninstall":
      return assistantInstallerUninstall(args);
    case "installer_cancel":
      return assistantInstallerCancel(args);
    case "installer_launch":
      return assistantInstallerLaunch(args);
    default:
      return { ok: false, error: `Unknown live app tool: ${toolName}` };
  }
}

async function assistantInstallerListTools() {
  const catalog = await invokeCommand("installer_load_catalog", {});
  const [detected, state] = await Promise.all([
    invokeCommand("installer_detect_all"),
    invokeCommand("installer_get_state"),
  ]);
  const stateById = new Map(state.map((entry) => [entry.toolId, entry]));
  const tools = catalog.recipes
    .filter((recipe) => recipe.section !== "internal")
    .map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      section: recipe.section,
      description: recipe.descriptionEn,
      needs: recipe.needs ?? [],
      options: recipe.options ?? [],
      provider: recipe.provider.kind,
      alternateProviders: [
        recipe.downloadProvider?.kind,
        recipe.chocolateyProvider?.kind,
        recipe.npmProvider?.kind,
      ].filter((kind): kind is NonNullable<typeof kind> => Boolean(kind)),
      detected: detected[recipe.id] ?? null,
      state: stateById.get(recipe.id) ?? null,
    }));
  return { ok: true, tools };
}

async function assistantInstallerCheckUpdates(args: Record<string, unknown>) {
  const toolIds = Array.isArray(args.toolIds)
    ? args.toolIds.filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : [];
  if (toolIds.length === 0) {
    return { ok: false, error: "toolIds is required." };
  }
  const catalog = await invokeCommand("installer_load_catalog", {});
  const knownIds = new Set(catalog.recipes.map((recipe) => recipe.id));
  const unknown = toolIds.find((toolId) => !knownIds.has(toolId));
  if (unknown) {
    return { ok: false, error: `Unknown Install Helper tool id: ${unknown}` };
  }
  await invokeCommand("installer_check_latest_versions", { toolIds });
  return {
    ok: true,
    started: true,
    toolIds,
    message: "Update checks started. Read the Install Helper tool state again after results stream.",
  };
}

async function assistantInstallerInstall(args: Record<string, unknown>) {
  const toolId = typeof args.toolId === "string" ? args.toolId.trim() : "";
  if (!toolId) {
    return { ok: false, error: "toolId is required." };
  }
  const options =
    args.options && typeof args.options === "object"
      ? (args.options as InstallOptions)
      : undefined;
  const catalog = await invokeCommand("installer_load_catalog", {});
  const detected = await invokeCommand("installer_detect_all");
  if (!catalog.recipes.some((recipe) => recipe.id === toolId)) {
    return { ok: false, error: `Unknown Install Helper tool id: ${toolId}` };
  }
  const plan = resolveInstallPlan(toolId, catalog, detected, options);
  for (const step of plan.actionable) {
    const result = await installRecipeAndWait(
      step.recipe.id,
      step.recipe.id === toolId ? options : undefined,
    );
    if (result.kind !== "completed") {
      return {
        ok: false,
        toolId,
        stepToolId: step.recipe.id,
        result,
        error: result.kind === "failed" ? result.message : "Installation was cancelled.",
      };
    }
  }
  const next = await invokeCommand("installer_redetect", { toolId });
  return { ok: true, toolId, detected: next };
}

async function assistantInstallerUninstall(args: Record<string, unknown>) {
  const toolId = typeof args.toolId === "string" ? args.toolId.trim() : "";
  if (!toolId) {
    return { ok: false, error: "toolId is required." };
  }
  const catalog = await invokeCommand("installer_load_catalog", {});
  if (!catalog.recipes.some((recipe) => recipe.id === toolId)) {
    return { ok: false, error: `Unknown Install Helper tool id: ${toolId}` };
  }
  const result = await uninstallRecipeAndWait(toolId);
  if (result.kind !== "completed") {
    return {
      ok: false,
      toolId,
      result,
      error: result.kind === "failed" ? result.message : "Uninstall was cancelled.",
    };
  }
  const next = await invokeCommand("installer_redetect", { toolId });
  return { ok: true, toolId, detected: next };
}

async function assistantInstallerCancel(args: Record<string, unknown>) {
  const toolId = typeof args.toolId === "string" ? args.toolId.trim() : "";
  if (!toolId) {
    return { ok: false, error: "toolId is required." };
  }
  await invokeCommand("installer_cancel", { toolId });
  return { ok: true, toolId };
}

async function assistantInstallerLaunch(args: Record<string, unknown>) {
  const toolId = typeof args.toolId === "string" ? args.toolId.trim() : "";
  if (!toolId) {
    return { ok: false, error: "toolId is required." };
  }
  const launched = await invokeCommand("installer_launch_app", { toolId });
  return launched
    ? { ok: true, toolId }
    : { ok: false, toolId, error: "The installed app could not be launched." };
}

function attrSelector(name: string, value: string) {
  return `[${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function screenshotRequestForElement(element: HTMLElement): CaptureScreenshotRequest | null {
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }
  return {
    x: Math.max(0, Math.round(bounds.left)),
    y: Math.max(0, Math.round(bounds.top)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

async function waitForElement(selector: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const element = document.querySelector<HTMLElement>(selector);
    const request = element ? screenshotRequestForElement(element) : null;
    if (element && request) {
      return element;
    }
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }
  return null;
}

async function captureElementForLiveTool(element: HTMLElement) {
  const request = screenshotRequestForElement(element);
  if (!request) {
    throw new Error("Screenshot target is not visible.");
  }
  await waitForScreenshotSurface();
  const screenshot = await invokeCommand("capture_screenshot_for_assistant", { request });
  return { screenshot, bounds: request };
}

async function assistantWorkspaceConnectionScreenshot(
  args: Record<string, unknown>,
  deps: AssistantLiveToolDeps,
) {
  if (!isTauriRuntime()) {
    return { ok: false, error: deps.t("workspace.screenshotsRequireRuntime") };
  }
  const connectionId = typeof args.connectionId === "string" ? args.connectionId.trim() : "";
  if (!connectionId) {
    return { ok: false, error: "connectionId is required." };
  }
  const workspace = useWorkspaceStore.getState();
  const tab = workspace.tabs.find(
    (entry) =>
      entry.connection?.id === connectionId ||
      entry.panes.some((pane) => pane.connection?.id === connectionId),
  );
  if (!tab) {
    return { ok: false, error: "Connection is not open in the Workspace." };
  }
  deps.onOpenWorkspace();
  useWorkspaceStore.getState().activateTab(tab.id);
  const target = await waitForElement(attrSelector("data-tutorial-id", "workspace.canvas"));
  if (!target) {
    return { ok: false, error: "Workspace Canvas is not visible." };
  }
  const { screenshot, bounds } = await captureElementForLiveTool(target);
  return { ok: true, connectionId, tabId: tab.id, bounds, screenshot };
}

async function assistantDashboardViewScreenshot(
  args: Record<string, unknown>,
  deps: AssistantLiveToolDeps,
) {
  if (!isTauriRuntime()) {
    return { ok: false, error: deps.t("workspace.screenshotsRequireRuntime") };
  }
  const dashboard = useDashboardStore.getState();
  if (!dashboard.ready) {
    await dashboard.load();
  }
  const state = useDashboardStore.getState();
  const requestedViewId = typeof args.viewId === "string" ? args.viewId.trim() : "";
  const viewId = requestedViewId || state.activeViewId || state.views[0]?.id || "";
  if (!viewId || !state.views.some((view) => view.id === viewId)) {
    return { ok: false, error: "Dashboard View was not found." };
  }
  deps.onOpenDashboard(viewId);
  const target = await waitForElement(attrSelector("data-dashboard-view-id", viewId));
  if (!target) {
    return { ok: false, error: "Dashboard View is not visible." };
  }
  const { screenshot, bounds } = await captureElementForLiveTool(target);
  return { ok: true, viewId, bounds, screenshot };
}

async function assistantDashboardWidgetScreenshot(
  args: Record<string, unknown>,
  deps: AssistantLiveToolDeps,
) {
  if (!isTauriRuntime()) {
    return { ok: false, error: deps.t("workspace.screenshotsRequireRuntime") };
  }
  const instanceId = typeof args.instanceId === "string" ? args.instanceId.trim() : "";
  if (!instanceId) {
    return { ok: false, error: "instanceId is required." };
  }
  const dashboard = useDashboardStore.getState();
  if (!dashboard.ready) {
    await dashboard.load();
  }
  const instance = useDashboardStore.getState().instances.find((entry) => entry.id === instanceId);
  if (!instance) {
    return { ok: false, error: "Dashboard Widget Instance was not found." };
  }
  deps.onOpenDashboard(instance.viewId);
  const target = await waitForElement(attrSelector("data-dashboard-widget-instance-id", instanceId));
  if (!target) {
    return { ok: false, error: "Dashboard Widget Instance is not visible." };
  }
  const { screenshot, bounds } = await captureElementForLiveTool(target);
  return { ok: true, instanceId, viewId: instance.viewId, bounds, screenshot };
}

async function assistantTutorialHighlight(
  args: Record<string, unknown>,
  deps: AssistantLiveToolDeps,
) {
  const targetId = typeof args.targetId === "string" ? args.targetId.trim() : "";
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const body = typeof args.body === "string" ? args.body.trim() : "";
  if (!targetId || !title || !body) {
    return { ok: false, error: deps.t("ai.tutorialInvalidRequest") };
  }
  const navigation =
    normalizeTutorialNavigationTarget(args.navigation) ??
    normalizeTutorialNavigationTarget(args) ??
    tutorialNavigationForTarget(targetId);
  return deps.onTutorialRequest({ targetId, title, body, navigation });
}

function assistantSessionState() {
  const state = useWorkspaceStore.getState();
  return {
    ok: true,
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      kind: tab.kind,
      active: tab.id === state.activeTabId,
      focusedPaneId: tab.focusedPaneId,
      connection: tab.connection
        ? {
            id: tab.connection.id,
            name: tab.connection.name,
            type: tab.connection.type,
            host: tab.connection.host,
            user: tab.connection.user,
          }
        : null,
      panes: tab.panes.map((pane) => ({
        id: pane.id,
        kind: pane.kind ?? "terminal",
        title: pane.title,
        hasTerminalBuffer: Boolean(getPaneRenderer(pane.id)),
        hasRemoteDesktopController: Boolean(getRemoteDesktopController(pane.id)),
      })),
      fileBrowser: tab.kind === "sftp" || tab.kind === "ftp"
        ? getFileBrowserController(tab.id)?.snapshot() ?? null
        : null,
    })),
  };
}

function assistantActivateTab(args: Record<string, unknown>) {
  const tabId = typeof args.tabId === "string" ? args.tabId.trim() : "";
  if (!tabId) {
    return { ok: false, error: "tabId is required." };
  }
  const store = useWorkspaceStore.getState();
  const tab = store.tabs.find((entry) => entry.id === tabId);
  if (!tab) {
    return { ok: false, error: `No open Tab with id ${tabId}.` };
  }
  store.activateTab(tabId);
  const paneId = typeof args.paneId === "string" ? args.paneId.trim() : "";
  if (paneId) {
    if (!tab.panes.some((pane) => pane.id === paneId)) {
      return { ok: false, error: `Tab ${tabId} has no Pane ${paneId}.` };
    }
    store.setFocusedPane(tabId, paneId);
  }
  return {
    ok: true,
    activeTabId: tabId,
    focusedPaneId: paneId || tab.focusedPaneId || null,
  };
}

function activeTerminalPaneIdForLiveTool(paneId: unknown) {
  if (typeof paneId === "string" && paneId.trim()) {
    return paneId.trim();
  }
  const state = useWorkspaceStore.getState();
  const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
  if (!tab || tab.kind !== "terminal") {
    return "";
  }
  return tab.focusedPaneId ?? tab.panes[0]?.id ?? "";
}

function activeRemoteDesktopPaneIdForLiveTool(paneId: unknown) {
  if (typeof paneId === "string" && paneId.trim()) {
    return paneId.trim();
  }
  const state = useWorkspaceStore.getState();
  const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
  if (!tab || tab.kind !== "remoteDesktop") {
    return "";
  }
  return tab.focusedPaneId ?? tab.panes[0]?.id ?? "";
}

function activeFileBrowserTabIdForLiveTool(tabId: unknown) {
  if (typeof tabId === "string" && tabId.trim()) {
    return tabId.trim();
  }
  const state = useWorkspaceStore.getState();
  const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
  if (!tab || (tab.kind !== "sftp" && tab.kind !== "ftp")) {
    return "";
  }
  return tab.id;
}

function assistantTerminalReadBuffer(args: Record<string, unknown>) {
  const paneId = activeTerminalPaneIdForLiveTool(args.paneId);
  const renderer = paneId ? getPaneRenderer(paneId) : undefined;
  if (!paneId || !renderer) {
    return { ok: false, error: "No active terminal Pane is available." };
  }
  const maxChars =
    typeof args.maxChars === "number" && Number.isFinite(args.maxChars)
      ? Math.max(1, Math.min(50_000, Math.trunc(args.maxChars)))
      : 20_000;
  const text = renderer.getBufferText();
  return {
    ok: true,
    paneId,
    text: text.length > maxChars ? text.slice(text.length - maxChars) : text,
    truncated: text.length > maxChars,
  };
}

function assistantTerminalSendText(args: Record<string, unknown>) {
  const paneId = activeTerminalPaneIdForLiveTool(args.paneId);
  const text = typeof args.text === "string" ? args.text : "";
  if (!paneId || !text) {
    return { ok: false, error: "Terminal paneId and text are required." };
  }
  const data = args.pressEnter === false ? text : prepareAssistantTerminalInput(text);
  const sent = writeInputToPane(paneId, data);
  return sent ? { ok: true, paneId } : { ok: false, error: "Terminal Pane is not writable." };
}

async function assistantRemoteDesktopScreenshot(args: Record<string, unknown>) {
  const paneId = activeRemoteDesktopPaneIdForLiveTool(args.paneId);
  const controller = paneId ? getRemoteDesktopController(paneId) : undefined;
  if (!paneId || !controller) {
    return { ok: false, error: "No active remote desktop Session is available." };
  }
  const screenshot = await controller.captureScreenshot();
  return { ok: true, paneId, screenshot };
}

async function assistantRemoteDesktopSendText(args: Record<string, unknown>) {
  const paneId = activeRemoteDesktopPaneIdForLiveTool(args.paneId);
  const controller = paneId ? getRemoteDesktopController(paneId) : undefined;
  const text = typeof args.text === "string" ? args.text : "";
  if (!paneId || !controller || !text) {
    return { ok: false, error: "Remote desktop paneId and text are required." };
  }
  await controller.sendText(text, args.pressEnter !== false);
  return { ok: true, paneId, kind: controller.kind };
}

async function assistantRemoteDesktopKeyPress(args: Record<string, unknown>) {
  const paneId = activeRemoteDesktopPaneIdForLiveTool(args.paneId);
  const controller = paneId ? getRemoteDesktopController(paneId) : undefined;
  const key = typeof args.key === "string" ? args.key : "";
  if (!paneId || !controller || !key) {
    return { ok: false, error: "Remote desktop paneId and key are required." };
  }
  await controller.keyPress(key);
  return { ok: true, paneId, kind: controller.kind, key };
}

async function assistantRemoteDesktopMouseClick(args: Record<string, unknown>) {
  const paneId = activeRemoteDesktopPaneIdForLiveTool(args.paneId);
  const controller = paneId ? getRemoteDesktopController(paneId) : undefined;
  if (!paneId || !controller?.mouseClick) {
    return { ok: false, error: "No active remote desktop Session is available for mouse input." };
  }
  const x = typeof args.x === "number" ? Math.max(0, Math.trunc(args.x)) : 0;
  const y = typeof args.y === "number" ? Math.max(0, Math.trunc(args.y)) : 0;
  const button = args.button === "right" || args.button === "middle" ? args.button : "left";
  await controller.mouseClick(x, y, button);
  return { ok: true, paneId, x, y, button };
}

async function assistantFileBrowserList(args: Record<string, unknown>) {
  const tabId = activeFileBrowserTabIdForLiveTool(args.tabId);
  const controller = tabId ? getFileBrowserController(tabId) : undefined;
  if (!tabId || !controller) {
    return { ok: false, error: "No active SFTP/FTP file browser Session is available." };
  }
  const path = typeof args.path === "string" ? args.path : null;
  const listing = await controller.list(path);
  return { ok: true, tabId, kind: controller.kind, listing };
}

async function assistantFileBrowserCreateFolder(args: Record<string, unknown>) {
  const tabId = activeFileBrowserTabIdForLiveTool(args.tabId);
  const controller = tabId ? getFileBrowserController(tabId) : undefined;
  const parentPath = typeof args.parentPath === "string" ? args.parentPath : "";
  const name = typeof args.name === "string" ? args.name : "";
  if (!tabId || !controller || !parentPath || !name) {
    return { ok: false, error: "File browser tabId, parentPath, and name are required." };
  }
  const result = await controller.createFolder(parentPath, name);
  return { ok: true, tabId, kind: controller.kind, result };
}

async function assistantFileBrowserRename(args: Record<string, unknown>) {
  const tabId = activeFileBrowserTabIdForLiveTool(args.tabId);
  const controller = tabId ? getFileBrowserController(tabId) : undefined;
  const path = typeof args.path === "string" ? args.path : "";
  const newName = typeof args.newName === "string" ? args.newName : "";
  if (!tabId || !controller || !path || !newName) {
    return { ok: false, error: "File browser tabId, path, and newName are required." };
  }
  const result = await controller.rename(path, newName);
  return { ok: true, tabId, kind: controller.kind, result };
}

async function assistantFileBrowserDelete(args: Record<string, unknown>) {
  const tabId = activeFileBrowserTabIdForLiveTool(args.tabId);
  const controller = tabId ? getFileBrowserController(tabId) : undefined;
  const path = typeof args.path === "string" ? args.path : "";
  if (!tabId || !controller || !path) {
    return { ok: false, error: "File browser tabId and path are required." };
  }
  const result = await controller.deletePath(path);
  return { ok: true, tabId, kind: controller.kind, result };
}

// Reads and writes follow the Connection's Quick Command Bundle selection, so
// the assistant edits exactly what that Connection's Quick Command Bar shows.
function quickCommandsForConnection(connectionId: string) {
  const store = useWorkspaceStore.getState();
  store.ensureQuickCommandsLoaded(connectionId);
  return quickCommandsForConnectionState(useWorkspaceStore.getState(), connectionId);
}

function quickCommandTarget(connectionId: string) {
  useWorkspaceStore.getState().ensureQuickCommandsLoaded(connectionId);
  return quickCommandTargetForConnection(useWorkspaceStore.getState(), connectionId);
}

function assistantQuickCommandList(args: Record<string, unknown>) {
  const connectionId = typeof args.connectionId === "string" ? args.connectionId.trim() : "";
  if (!connectionId) {
    return { ok: false, error: "connectionId is required." };
  }
  return {
    ok: true,
    connectionId,
    quickCommands: quickCommandsForConnection(connectionId),
  };
}

function assistantQuickCommandRead(args: Record<string, unknown>) {
  const connectionId = typeof args.connectionId === "string" ? args.connectionId.trim() : "";
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!connectionId || !id) {
    return { ok: false, error: "connectionId and id are required." };
  }
  const command = quickCommandsForConnection(connectionId).find((entry) => entry.id === id);
  if (!command) {
    return { ok: false, error: "Quick Command was not found.", connectionId, id };
  }
  return { ok: true, connectionId, quickCommand: command };
}

function assistantQuickCommandCreate(args: Record<string, unknown>) {
  const connectionId = typeof args.connectionId === "string" ? args.connectionId.trim() : "";
  const label = typeof args.label === "string" ? args.label.trim() : "";
  const commandText = typeof args.command === "string" ? args.command.trim() : "";
  if (!connectionId || !label || !commandText) {
    return { ok: false, error: "connectionId, label, and command are required." };
  }
  const iconName = typeof args.iconName === "string" && isIconName(args.iconName)
    ? args.iconName
    : "Terminal";
  const accentName = typeof args.accentName === "string" && isAccentName(args.accentName)
    ? args.accentName
    : "default";
  const quickCommand: QuickCommand = {
    id: assistantQuickCommandId(),
    label,
    command: commandText,
    iconName,
    accentName,
    sendEnter: args.sendEnter === true,
    confirm: args.confirm === true,
  };
  useWorkspaceStore.getState().addQuickCommand(quickCommandTarget(connectionId), quickCommand);
  return { ok: true, connectionId, quickCommand };
}

function assistantQuickCommandEdit(args: Record<string, unknown>) {
  const connectionId = typeof args.connectionId === "string" ? args.connectionId.trim() : "";
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!connectionId || !id) {
    return { ok: false, error: "connectionId and id are required." };
  }
  const existing = quickCommandsForConnection(connectionId).find((entry) => entry.id === id);
  if (!existing) {
    return { ok: false, error: "Quick Command was not found.", connectionId, id };
  }
  const nextLabel = typeof args.label === "string" ? args.label.trim() : existing.label;
  const nextCommand = typeof args.command === "string" ? args.command.trim() : existing.command;
  if (!nextLabel || !nextCommand) {
    return { ok: false, error: "label and command cannot be empty.", connectionId, id };
  }
  const quickCommand: QuickCommand = {
    ...existing,
    label: nextLabel,
    command: nextCommand,
    iconName: typeof args.iconName === "string" && isIconName(args.iconName)
      ? args.iconName
      : existing.iconName,
    accentName: typeof args.accentName === "string" && isAccentName(args.accentName)
      ? args.accentName
      : existing.accentName,
    sendEnter: typeof args.sendEnter === "boolean" ? args.sendEnter : existing.sendEnter,
    confirm: typeof args.confirm === "boolean" ? args.confirm : existing.confirm,
  };
  useWorkspaceStore.getState().updateQuickCommand(quickCommandTarget(connectionId), quickCommand);
  return { ok: true, connectionId, quickCommand };
}

import type { TFunction } from "i18next";
import type { AssistantToolCallStatus } from "./streamMessage";

export function toolCallLabel(
  toolName: string | undefined,
  status: AssistantToolCallStatus["status"],
  t: TFunction,
): string {
  const normalizedToolName = normalizeAssistantToolName(toolName);
  if (!normalizedToolName) {
    return status === "running" ? t("ai.toolCallRunning") : t("ai.toolCallComplete");
  }
  const runningLabels: Record<string, string> = {
    web_search: t("ai.toolWebSearch"),
    web_fetch: t("ai.toolWebFetch"),
    shell_command: t("ai.toolShellCommand"),
    app_data_file_search: t("ai.toolFileSearch"),
    app_data_file_read: t("ai.toolFileRead"),
    performance_counters: t("ai.toolPerformanceCounters"),
    send_email: t("ai.toolEmail"),
    current_time: t("ai.toolCurrentTime"),
    request_secret_entry: t("ai.toolSecretRequest"),
    dashboard_load_state: t("ai.toolDashboard"),
    dashboard_create_view: t("ai.toolDashboard"),
    dashboard_update_view: t("ai.toolDashboard"),
    dashboard_remove_view: t("ai.toolDashboard"),
    dashboard_reorder_views: t("ai.toolDashboard"),
    dashboard_add_instance: t("ai.toolDashboard"),
    dashboard_update_instance: t("ai.toolDashboard"),
    dashboard_read_widget_source: t("ai.toolDashboard"),
    dashboard_read_widget_secret: t("ai.toolDashboard"),
    dashboard_remove_instance: t("ai.toolDashboard"),
    dashboard_apply_layout: t("ai.toolDashboard"),
    dashboard_create_widget: t("ai.toolDashboard"),
    dashboard_create_custom_widget: t("ai.toolDashboard"),
    dashboard_update_custom_widget: t("ai.toolDashboard"),
    dashboard_remove_custom_widget: t("ai.toolDashboard"),
    dashboard_check_widget_health: t("ai.toolDashboard"),
    dashboard_reset: t("ai.toolDashboard"),
    workspace_list: t("ai.toolConnections"),
    workspace_create: t("ai.toolConnections"),
    workspace_rename: t("ai.toolConnections"),
    workspace_reorder: t("ai.toolConnections"),
    workspace_delete: t("ai.toolConnections"),
    connection_list: t("ai.toolConnections"),
    connection_create: t("ai.toolConnections"),
    connection_open: t("ai.toolConnections"),
    connection_update: t("ai.toolConnections"),
    connection_rename: t("ai.toolConnections"),
    connection_move: t("ai.toolConnections"),
    connection_delete: t("ai.toolConnections"),
    connection_folder_create: t("ai.toolConnections"),
    connection_folder_rename: t("ai.toolConnections"),
    connection_folder_move: t("ai.toolConnections"),
    connection_folder_delete: t("ai.toolConnections"),
    session_state: t("ai.toolSessions"),
    session_terminal_read_buffer: t("ai.toolSessions"),
    session_terminal_send_text: t("ai.toolSessions"),
    session_remote_desktop_screenshot: t("ai.toolSessions"),
    session_remote_desktop_send_text: t("ai.toolSessions"),
    session_remote_desktop_keypress: t("ai.toolSessions"),
    session_remote_desktop_mouse_click: t("ai.toolSessions"),
    session_file_browser_list: t("ai.toolSessions"),
    session_file_browser_create_folder: t("ai.toolSessions"),
    session_file_browser_rename: t("ai.toolSessions"),
    session_file_browser_delete: t("ai.toolSessions"),
    tutorial_highlight: t("ai.toolTutorial"),
  };
  const completedLabels: Record<string, string> = {
    web_search: t("ai.toolWebSearchDone"),
    web_fetch: t("ai.toolWebFetchDone"),
    shell_command: t("ai.toolShellCommandDone"),
    app_data_file_search: t("ai.toolFileSearchDone"),
    app_data_file_read: t("ai.toolFileReadDone"),
    performance_counters: t("ai.toolPerformanceCountersDone"),
    send_email: t("ai.toolEmailDone"),
    current_time: t("ai.toolCurrentTimeDone"),
    request_secret_entry: t("ai.toolSecretRequestDone"),
    dashboard_load_state: t("ai.toolDashboardDone"),
    dashboard_create_view: t("ai.toolDashboardDone"),
    dashboard_update_view: t("ai.toolDashboardDone"),
    dashboard_remove_view: t("ai.toolDashboardDone"),
    dashboard_reorder_views: t("ai.toolDashboardDone"),
    dashboard_add_instance: t("ai.toolDashboardDone"),
    dashboard_update_instance: t("ai.toolDashboardDone"),
    dashboard_read_widget_source: t("ai.toolDashboardDone"),
    dashboard_read_widget_secret: t("ai.toolDashboardDone"),
    dashboard_remove_instance: t("ai.toolDashboardDone"),
    dashboard_apply_layout: t("ai.toolDashboardDone"),
    dashboard_create_widget: t("ai.toolDashboardDone"),
    dashboard_create_custom_widget: t("ai.toolDashboardDone"),
    dashboard_update_custom_widget: t("ai.toolDashboardDone"),
    dashboard_remove_custom_widget: t("ai.toolDashboardDone"),
    dashboard_check_widget_health: t("ai.toolDashboardDone"),
    dashboard_reset: t("ai.toolDashboardDone"),
    workspace_list: t("ai.toolConnectionsDone"),
    workspace_create: t("ai.toolConnectionsDone"),
    workspace_rename: t("ai.toolConnectionsDone"),
    workspace_reorder: t("ai.toolConnectionsDone"),
    workspace_delete: t("ai.toolConnectionsDone"),
    connection_list: t("ai.toolConnectionsDone"),
    connection_create: t("ai.toolConnectionsDone"),
    connection_open: t("ai.toolConnectionsDone"),
    connection_update: t("ai.toolConnectionsDone"),
    connection_rename: t("ai.toolConnectionsDone"),
    connection_move: t("ai.toolConnectionsDone"),
    connection_delete: t("ai.toolConnectionsDone"),
    connection_folder_create: t("ai.toolConnectionsDone"),
    connection_folder_rename: t("ai.toolConnectionsDone"),
    connection_folder_move: t("ai.toolConnectionsDone"),
    connection_folder_delete: t("ai.toolConnectionsDone"),
    session_state: t("ai.toolSessionsDone"),
    session_terminal_read_buffer: t("ai.toolSessionsDone"),
    session_terminal_send_text: t("ai.toolSessionsDone"),
    session_remote_desktop_screenshot: t("ai.toolSessionsDone"),
    session_remote_desktop_send_text: t("ai.toolSessionsDone"),
    session_remote_desktop_keypress: t("ai.toolSessionsDone"),
    session_remote_desktop_mouse_click: t("ai.toolSessionsDone"),
    session_file_browser_list: t("ai.toolSessionsDone"),
    session_file_browser_create_folder: t("ai.toolSessionsDone"),
    session_file_browser_rename: t("ai.toolSessionsDone"),
    session_file_browser_delete: t("ai.toolSessionsDone"),
    tutorial_highlight: t("ai.toolTutorialDone"),
  };
  const labels = status === "running" ? runningLabels : completedLabels;
  if (labels[normalizedToolName]) {
    return labels[normalizedToolName];
  }
  if (normalizedToolName.startsWith("itops_")) {
    return status === "running" ? t("ai.toolItOps") : t("ai.toolItOpsDone");
  }
  if (normalizedToolName.startsWith("installer_")) {
    return status === "running" ? t("ai.toolInstaller") : t("ai.toolInstallerDone");
  }
  if (normalizedToolName.startsWith("screenshot_")) {
    return status === "running" ? t("ai.toolScreenshots") : t("ai.toolScreenshotsDone");
  }
  if (normalizedToolName.startsWith("watchdog_")) {
    return status === "running" ? t("ai.toolWatchdog") : t("ai.toolWatchdogDone");
  }
  return normalizedToolName;
}

export function isDashboardMutatingTool(toolName: unknown) {
  const normalizedToolName = normalizeAssistantToolName(toolName);
  if (!normalizedToolName) {
    return false;
  }
  return normalizedToolName.startsWith("dashboard_") && normalizedToolName !== "dashboard_load_state";
}

export function humanizeAssistantToolName(toolName: string | undefined) {
  return normalizeAssistantToolName(toolName)?.replace(/[_-]+/g, " ") ?? "";
}

export function normalizeAssistantToolName(toolName: unknown) {
  return typeof toolName === "string" && toolName.trim() ? toolName.trim() : undefined;
}

import { invokeCommand, isTauriRuntime, authorizeAppStorePath } from "../../../../../lib/tauri";
import type {
  AppLauncherEntry,
  AppLauncherLaunchMode,
  AppLauncherSettings,
  AppLauncherSortDirection,
  AppLauncherSortField,
  AppLauncherSortState,
  AppLauncherViewMode,
  PreparedAppLauncherEntry,
} from "../../../../../types";

const APP_LAUNCHER_STORAGE_KEY = "kkterm.appLauncher.settings.v1";
const FALLBACK_ICON_DATA_URL =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20x='5'%20y='5'%20width='22'%20height='22'%20rx='5'%20fill='%23eef3fb'%20stroke='%2395a3b8'/%3E%3Cpath%20d='M11%2012h10M11%2016h10M11%2020h6'%20stroke='%23516275'%20stroke-width='2'%20stroke-linecap='round'/%3E%3C/svg%3E";

const DEFAULT_LIST_SORT: AppLauncherSortState = { field: "name", direction: "asc" };
const DEFAULT_DETAILS_SORT: AppLauncherSortState = { field: "name", direction: "asc" };

export function appLauncherSettingsEvent() {
  window.dispatchEvent(new CustomEvent("kkterm:app-launcher-invalidated"));
}

export async function loadAppLauncherSettings(): Promise<AppLauncherSettings> {
  if (isTauriRuntime()) {
    return invokeCommand("get_app_launcher_settings");
  }
  return readPreviewSettings();
}

export async function saveAppLauncherSettings(
  settings: AppLauncherSettings,
): Promise<AppLauncherSettings> {
  const saved = isTauriRuntime()
    ? await invokeCommand("update_app_launcher_settings", { request: settings })
    : writePreviewSettings(settings);
  appLauncherSettingsEvent();
  return saved;
}

export function parseAppLauncherSettingsJson(settingsValuesJson: string): AppLauncherSettings {
  try {
    const parsed = JSON.parse(settingsValuesJson) as Partial<AppLauncherSettings>;
    return normalizeAppLauncherSettings(parsed);
  } catch {
    return defaultAppLauncherSettings();
  }
}

export function serializeAppLauncherSettings(settings: AppLauncherSettings): string {
  return JSON.stringify(normalizeAppLauncherSettings(settings));
}

export async function prepareAppLauncherEntry(
  path: string,
): Promise<PreparedAppLauncherEntry> {
  if (isTauriRuntime()) {
    return invokeCommand("prepare_app_launcher_entry", { request: { path } });
  }
  return {
    name: launcherNameFromPath(path),
    path,
    exists: true,
    runnable: isRunnablePath(path),
    iconDataUrl: FALLBACK_ICON_DATA_URL,
    fileKind: "file",
    extension: pathExtension(path),
    sizeBytes: null,
    modifiedAtUnixMs: null,
  };
}

export async function launchAppLauncherEntry(
  entry: AppLauncherEntry,
  mode: AppLauncherLaunchMode,
) {
  if (!isTauriRuntime()) {
    return true;
  }
  const path = await authorizeAppStorePath(entry.path);
  if (!path) return false;
  const workingDirectory = entry.workingDirectory
    ? await authorizeAppStorePath(entry.workingDirectory, true) : null;
  if (entry.workingDirectory && !workingDirectory) return false;
  await invokeCommand("launch_app_launcher_entry", {
    request: {
      path,
      arguments: entry.arguments ?? null,
      workingDirectory,
      mode,
    },
  });
  return true;
}

export function isRunnablePath(path: string) {
  return /\.(exe|lnk|bat|cmd|ps1)$/i.test(path.trim());
}

export function appLauncherNameFromPath(path: string) {
  return launcherNameFromPath(path);
}

export function reorderAppLauncherEntries(
  entries: AppLauncherEntry[],
  draggedId: string,
  targetId: string,
  placement: "before" | "after" = "before",
) {
  if (draggedId === targetId) {
    return entries;
  }

  const draggedIndex = entries.findIndex((entry) => entry.id === draggedId);
  const targetIndex = entries.findIndex((entry) => entry.id === targetId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return entries;
  }

  const nextEntries = [...entries];
  const [draggedEntry] = nextEntries.splice(draggedIndex, 1);
  const nextTargetIndex = nextEntries.findIndex((entry) => entry.id === targetId);
  const insertIndex = placement === "after" ? nextTargetIndex + 1 : nextTargetIndex;
  nextEntries.splice(insertIndex, 0, draggedEntry);
  return nextEntries;
}

function readPreviewSettings(): AppLauncherSettings {
  if (typeof window === "undefined") {
    return defaultAppLauncherSettings();
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(APP_LAUNCHER_STORAGE_KEY) ?? '{"entries":[]}',
    ) as Partial<AppLauncherSettings>;
    return normalizeAppLauncherSettings(parsed);
  } catch {
    return defaultAppLauncherSettings();
  }
}

function normalizeAppLauncherSettings(settings: Partial<AppLauncherSettings>): AppLauncherSettings {
  return {
    entries: Array.isArray(settings.entries)
      ? settings.entries.filter(isStoredEntry)
      : [],
    viewMode: isAppLauncherViewMode(settings.viewMode) ? settings.viewMode : "icons",
    listSort: normalizeSortState(settings.listSort, DEFAULT_LIST_SORT),
    detailsSort: normalizeSortState(settings.detailsSort, DEFAULT_DETAILS_SORT),
    showFileExtensions: settings.showFileExtensions === true,
  };
}

function writePreviewSettings(settings: AppLauncherSettings) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(APP_LAUNCHER_STORAGE_KEY, JSON.stringify(settings));
  }
  return settings;
}

function isStoredEntry(value: unknown): value is AppLauncherEntry {
  const entry = value as Partial<AppLauncherEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.path === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string"
  );
}

function isAppLauncherViewMode(value: unknown): value is AppLauncherViewMode {
  return value === "icons" || value === "list" || value === "details";
}

function normalizeSortState(
  value: unknown,
  fallback: AppLauncherSortState,
): AppLauncherSortState {
  const sort = value as Partial<AppLauncherSortState>;
  return {
    field: isAppLauncherSortField(sort.field) ? sort.field : fallback.field,
    direction: isAppLauncherSortDirection(sort.direction) ? sort.direction : fallback.direction,
  };
}

function isAppLauncherSortField(value: unknown): value is AppLauncherSortField {
  return (
    value === "name" ||
    value === "path" ||
    value === "type" ||
    value === "size" ||
    value === "modified"
  );
}

function isAppLauncherSortDirection(value: unknown): value is AppLauncherSortDirection {
  return value === "asc" || value === "desc";
}

function defaultAppLauncherSettings(): AppLauncherSettings {
  return {
    entries: [],
    viewMode: "icons",
    listSort: DEFAULT_LIST_SORT,
    detailsSort: DEFAULT_DETAILS_SORT,
    showFileExtensions: false,
  };
}

function launcherNameFromPath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] ?? "Application";
  return fileName.replace(/\.[^.]+$/u, "") || "Application";
}

function pathExtension(path: string) {
  const filename = path.trim().replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex > 0 && dotIndex < filename.length - 1
    ? filename.slice(dotIndex + 1).toLowerCase()
    : null;
}

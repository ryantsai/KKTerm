import type { ActivePage } from "./ActivityRail";

export type BaseModulePage = Exclude<ActivePage, "settings">;

export const ACTIVE_PAGE_STORAGE_KEY = "kkterm.activeModule.v1";
export const ACTIVE_CUSTOM_MODULE_STORAGE_KEY = "kkterm.activeCustomModule.v1";

export function activePageFromStoredValue(value: unknown): BaseModulePage {
  return value === "dashboard" ||
    value === "itops" ||
    value === "installer" ||
    value === "screenshots" ||
    value === "systemCleaner" ||
    value === "customModule" ||
    value === "workspace"
    ? value
    : "workspace";
}

export function baseModulePageForPersistence(
  page: ActivePage,
  previousBasePage: BaseModulePage,
): BaseModulePage {
  return page === "settings" ? previousBasePage : page;
}

export function shouldExpandConnectionPanelOnLaunch(page: BaseModulePage) {
  return page === "workspace";
}

export function loadStoredActivePage(): BaseModulePage {
  if (typeof window === "undefined") {
    return "workspace";
  }
  try {
    return activePageFromStoredValue(window.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY));
  } catch {
    return "workspace";
  }
}

export function persistActivePage(page: BaseModulePage) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, page);
  } catch {
    // Storage may be unavailable (private mode, quota); fail silently.
  }
}

export function loadStoredCustomModuleKey() {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(ACTIVE_CUSTOM_MODULE_STORAGE_KEY);
    return value?.startsWith("custom:") ? value : null;
  } catch {
    return null;
  }
}

export function persistActiveCustomModuleKey(key: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (key) window.localStorage.setItem(ACTIVE_CUSTOM_MODULE_STORAGE_KEY, key);
    else window.localStorage.removeItem(ACTIVE_CUSTOM_MODULE_STORAGE_KEY);
  } catch {
    // Navigation persistence is best-effort, like the built-in active page.
  }
}

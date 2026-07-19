import type { ActivePage } from "./ActivityRail";

export type BaseModulePage = Exclude<ActivePage, "settings">;

export const ACTIVE_PAGE_STORAGE_KEY = "kkterm.activeModule.v1";

export function activePageFromStoredValue(value: unknown): BaseModulePage {
  return value === "dashboard" ||
    value === "itops" ||
    value === "installer" ||
    value === "screenshots" ||
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

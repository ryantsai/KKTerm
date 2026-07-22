import { create } from "zustand";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { ScreenshotSettings } from "../../types";

const browserDefaults: ScreenshotSettings = {
  folderPath: "%USERPROFILE%\\Pictures\\Screenshots",
  format: "png",
  quality: 90,
  captureMode: "both",
  openInEditorAfterCapture: false,
  borderEnabled: true,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#000000",
  includeCursor: false,
  regionShortcut: "Ctrl+Alt+R",
  regionShortcutEnabled: true,
  windowShortcut: "Ctrl+Alt+W",
  windowShortcutEnabled: true,
  fullscreenShortcut: "Ctrl+Alt+F",
  fullscreenShortcutEnabled: true,
};

type ScreenshotSettingsDraftState = {
  saved: ScreenshotSettings | null;
  draft: ScreenshotSettings | null;
  loading: boolean;
  useDirectxSaved: boolean;
  useDirectxDraft: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<ScreenshotSettings>) => void;
  updateUseDirectx: (value: boolean) => void;
  save: () => Promise<boolean>;
};

let loadPromise: Promise<void> | null = null;
let savePromise: Promise<boolean> | null = null;

export const useScreenshotSettingsDraft = create<ScreenshotSettingsDraftState>((set, get) => ({
  saved: null,
  draft: null,
  loading: false,
  useDirectxSaved: useWorkspaceStore.getState().generalSettings.useDirectxScreenCapture,
  useDirectxDraft: useWorkspaceStore.getState().generalSettings.useDirectxScreenCapture,
  load: async () => {
    if (get().draft || loadPromise) {
      return loadPromise ?? Promise.resolve();
    }
    set({ loading: true });
    loadPromise = (async () => {
      try {
        const settings = isTauriRuntime()
          ? await invokeCommand("get_screenshot_settings", undefined)
          : browserDefaults;
        const useDirectx = useWorkspaceStore.getState().generalSettings.useDirectxScreenCapture;
        set({
          saved: settings,
          draft: settings,
          loading: false,
          useDirectxSaved: useDirectx,
          useDirectxDraft: useDirectx,
        });
      } finally {
        set({ loading: false });
        loadPromise = null;
      }
    })();
    return loadPromise;
  },
  update: (patch) => {
    set((state) => ({
      draft: state.draft ? { ...state.draft, ...patch } : state.draft,
    }));
  },
  updateUseDirectx: (value) => set({ useDirectxDraft: value }),
  save: async () => {
    if (savePromise) {
      return savePromise;
    }
    const state = get();
    if (!state.draft || !screenshotSettingsHaveChanges(state)) {
      return false;
    }
    const request = state.draft;
    const requestedUseDirectx = state.useDirectxDraft;
    savePromise = (async () => {
      try {
        const savedSettings = isTauriRuntime()
          ? await invokeCommand("update_screenshot_settings", { request })
          : request;
        const currentGeneral = useWorkspaceStore.getState().generalSettings;
        if (requestedUseDirectx !== currentGeneral.useDirectxScreenCapture) {
          const generalRequest = {
            ...currentGeneral,
            useDirectxScreenCapture: requestedUseDirectx,
          };
          const savedGeneral = isTauriRuntime()
            ? await invokeCommand("update_general_settings", { request: generalRequest })
            : generalRequest;
          useWorkspaceStore.getState().setGeneralSettings(savedGeneral);
        }
        set((current) => ({
          saved: savedSettings,
          draft: current.draft === request ? savedSettings : current.draft,
          useDirectxSaved: requestedUseDirectx,
        }));
        return true;
      } finally {
        savePromise = null;
      }
    })();
    return savePromise;
  },
}));

export function screenshotSettingsHaveChanges(state: Pick<
  ScreenshotSettingsDraftState,
  "saved" | "draft" | "useDirectxSaved" | "useDirectxDraft"
>) {
  return Boolean(state.saved && state.draft) && (
    JSON.stringify(state.saved) !== JSON.stringify(state.draft) ||
    state.useDirectxSaved !== state.useDirectxDraft
  );
}

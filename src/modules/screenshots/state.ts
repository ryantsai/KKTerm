import { create } from "zustand";
import { invokeCommand, type StoredScreenshot } from "../../lib/tauri";

const PAGE_SIZE = 60;

type ScreenshotsState = {
  screenshots: StoredScreenshot[];
  total: number;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  captureInFlight: boolean;
  setCaptureInFlight: (value: boolean) => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  prepend: (screenshot: StoredScreenshot) => void;
  replace: (id: string, screenshot: StoredScreenshot) => void;
  remove: (id: string) => void;
  clear: () => void;
};

export const useScreenshotsStore = create<ScreenshotsState>((set, get) => ({
  screenshots: [],
  total: 0,
  hasMore: false,
  loaded: false,
  loading: false,
  error: null,
  captureInFlight: false,
  setCaptureInFlight: (value) => set({ captureInFlight: value }),
  refresh: async () => {
    if (get().loading) {
      return;
    }
    set({ loading: true, error: null });
    try {
      const response = await invokeCommand("list_screenshots", {
        request: { offset: 0, limit: PAGE_SIZE },
      });
      set({
        screenshots: response.screenshots,
        total: response.total,
        hasMore: response.hasMore,
        loaded: true,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        loaded: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  loadMore: async () => {
    const state = get();
    if (state.loading || !state.hasMore) {
      return;
    }
    set({ loading: true, error: null });
    try {
      const response = await invokeCommand("list_screenshots", {
        request: { offset: state.screenshots.length, limit: PAGE_SIZE },
      });
      const known = new Set(state.screenshots.map((screenshot) => screenshot.id));
      set({
        screenshots: [
          ...get().screenshots,
          ...response.screenshots.filter((screenshot) => !known.has(screenshot.id)),
        ],
        total: response.total,
        hasMore: response.hasMore,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  prepend: (screenshot) =>
    set((state) => ({
      screenshots: [
        screenshot,
        ...state.screenshots.filter((existing) => existing.id !== screenshot.id),
      ],
      total: state.total + 1,
      loaded: true,
    })),
  replace: (id, screenshot) =>
    set((state) => ({
      screenshots: state.screenshots.map((existing) =>
        existing.id === id ? screenshot : existing,
      ),
    })),
  remove: (id) =>
    set((state) => ({
      screenshots: state.screenshots.filter((existing) => existing.id !== id),
      total: Math.max(0, state.total - 1),
    })),
  clear: () => set({ screenshots: [], total: 0, hasMore: false }),
}));

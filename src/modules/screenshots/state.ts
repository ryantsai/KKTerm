import { create } from "zustand";
import { invokeCommand, type StoredScreenshot } from "../../lib/tauri";

const PAGE_SIZE = 60;
let refreshGeneration = 0;

export type ScreenshotSortBy = "name" | "date" | "type";
export type ScreenshotSortDirection = "asc" | "desc";

type ScreenshotsState = {
  screenshots: StoredScreenshot[];
  total: number;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  captureInFlight: boolean;
  editorRequestId: string | null;
  sortBy: ScreenshotSortBy;
  sortDirection: ScreenshotSortDirection;
  setCaptureInFlight: (value: boolean) => void;
  requestEditor: (id: string) => void;
  clearEditorRequest: () => void;
  setSort: (sortBy: ScreenshotSortBy, sortDirection: ScreenshotSortDirection) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  prepend: (screenshot: StoredScreenshot) => void;
  addMany: (screenshots: StoredScreenshot[]) => void;
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
  editorRequestId: null,
  sortBy: "date",
  sortDirection: "desc",
  setCaptureInFlight: (value) => set({ captureInFlight: value }),
  requestEditor: (id) => set({ editorRequestId: id }),
  clearEditorRequest: () => set({ editorRequestId: null }),
  setSort: async (sortBy, sortDirection) => {
    if (get().sortBy === sortBy && get().sortDirection === sortDirection) {
      return;
    }
    set({ sortBy, sortDirection, hasMore: false });
    await get().refresh();
  },
  refresh: async () => {
    const generation = ++refreshGeneration;
    set({ loading: true, error: null });
    try {
      const response = await invokeCommand("list_screenshots", {
        request: {
          offset: 0,
          limit: PAGE_SIZE,
          sortBy: get().sortBy,
          sortDirection: get().sortDirection,
        },
      });
      if (generation !== refreshGeneration) {
        return;
      }
      set({
        screenshots: response.screenshots,
        total: response.total,
        hasMore: response.hasMore,
        loaded: true,
        loading: false,
      });
    } catch (error) {
      if (generation !== refreshGeneration) {
        return;
      }
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
    const generation = refreshGeneration;
    set({ loading: true, error: null });
    try {
      const response = await invokeCommand("list_screenshots", {
        request: {
          offset: state.screenshots.length,
          limit: PAGE_SIZE,
          sortBy: state.sortBy,
          sortDirection: state.sortDirection,
        },
      });
      const known = new Set(state.screenshots.map((screenshot) => screenshot.id));
      if (generation !== refreshGeneration) {
        return;
      }
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
      if (generation !== refreshGeneration) {
        return;
      }
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
  addMany: (screenshots) =>
    set((state) => {
      const addedIds = new Set(screenshots.map((screenshot) => screenshot.id));
      return {
        screenshots: [
          ...screenshots,
          ...state.screenshots.filter((existing) => !addedIds.has(existing.id)),
        ],
        total: state.total + screenshots.filter(
          (screenshot) => !state.screenshots.some((existing) => existing.id === screenshot.id),
        ).length,
        loaded: true,
      };
    }),
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

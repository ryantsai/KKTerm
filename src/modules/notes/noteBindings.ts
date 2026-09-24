import { create } from "zustand";
import { getConnectionNote, listConnectionNoteIds } from "./noteCommands";
import { noteHtmlToTooltipText } from "./noteHtml";

const previewRequests = new Map<
  string,
  { generation: number; promise: Promise<void> }
>();
let previewGeneration = 0;

interface NoteBindingsState {
  /** Connection ids known to own a note. Drives the post-it icon's bound state
   *  in every pane toolbar without loading note bodies. */
  boundIds: Set<string>;
  /** Plain-text previews fetched on demand for Connection Tree tooltips. */
  previewById: Map<string, string>;
  loaded: boolean;
  load: () => Promise<void>;
  loadPreview: (connectionId: string) => Promise<void>;
  setBound: (connectionId: string, bound: boolean) => void;
}

export const useNoteBindings = create<NoteBindingsState>((set, get) => ({
  boundIds: new Set(),
  previewById: new Map(),
  loaded: false,
  async load() {
    const ids = await listConnectionNoteIds().catch(() => null);
    if (!ids) return;
    previewGeneration += 1;
    set({ boundIds: new Set(ids), previewById: new Map(), loaded: true });
  },
  async loadPreview(connectionId) {
    const state = get();
    if (!state.boundIds.has(connectionId) || state.previewById.has(connectionId)) return;

    const generation = previewGeneration;
    const existingRequest = previewRequests.get(connectionId);
    if (existingRequest?.generation === generation) return existingRequest.promise;

    const promise = (async () => {
      const note = await getConnectionNote(connectionId).catch(() => null);
      const current = get();
      if (
        !note ||
        generation !== previewGeneration ||
        !current.boundIds.has(connectionId)
      ) {
        return;
      }
      const previewById = new Map(current.previewById);
      previewById.set(connectionId, noteHtmlToTooltipText(note.contentHtml));
      set({ previewById });
    })().finally(() => {
      if (previewRequests.get(connectionId)?.promise === promise) {
        previewRequests.delete(connectionId);
      }
    });
    previewRequests.set(connectionId, { generation, promise });
    return promise;
  },
  setBound(connectionId, bound) {
    const next = new Set(get().boundIds);
    if (bound) {
      next.add(connectionId);
    } else {
      next.delete(connectionId);
    }
    previewGeneration += 1;
    const previewById = new Map(get().previewById);
    previewById.delete(connectionId);
    set({ boundIds: next, previewById });
  },
}));

/** Whether one Connection currently owns a note. */
export function useConnectionHasNote(connectionId: string | undefined): boolean {
  return useNoteBindings((state) =>
    connectionId ? state.boundIds.has(connectionId) : false,
  );
}

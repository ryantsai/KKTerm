import { create } from "zustand";
import { listConnectionNoteIds } from "./noteCommands";

interface NoteBindingsState {
  /** Connection ids known to own a note. Drives the post-it icon's bound state
   *  in every pane toolbar without loading note bodies. */
  boundIds: Set<string>;
  loaded: boolean;
  load: () => Promise<void>;
  setBound: (connectionId: string, bound: boolean) => void;
}

export const useNoteBindings = create<NoteBindingsState>((set, get) => ({
  boundIds: new Set(),
  loaded: false,
  async load() {
    const ids = await listConnectionNoteIds().catch(() => null);
    if (!ids) return;
    set({ boundIds: new Set(ids), loaded: true });
  },
  setBound(connectionId, bound) {
    const next = new Set(get().boundIds);
    if (bound) {
      next.add(connectionId);
    } else {
      next.delete(connectionId);
    }
    set({ boundIds: next });
  },
}));

/** Whether one Connection currently owns a note. */
export function useConnectionHasNote(connectionId: string | undefined): boolean {
  return useNoteBindings((state) =>
    connectionId ? state.boundIds.has(connectionId) : false,
  );
}

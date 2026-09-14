import { create } from "zustand";
import type { WorkspaceTab } from "../../types";

/** Live attention belongs to a Pane's Session, never to a saved Connection. */
export const useTerminalAttentionStore = create<{
  pending: Record<string, string>;
  ring: (paneId: string, sessionId: string, focused: boolean) => void;
  clear: (paneId: string, sessionId?: string) => void;
}>((set) => ({
  pending: {},
  ring: (paneId, sessionId, focused) => set((state) =>
    focused || state.pending[paneId] === sessionId
      ? state
      : { pending: { ...state.pending, [paneId]: sessionId } },
  ),
  clear: (paneId, sessionId) => set((state) => {
    if (!state.pending[paneId] || (sessionId && state.pending[paneId] !== sessionId)) return state;
    const pending = { ...state.pending };
    delete pending[paneId];
    return { pending };
  }),
}));

// Native focus can change before WebView2 updates document.hasFocus().
let terminalWindowFocused = true;
export function setTerminalWindowFocused(focused: boolean) {
  terminalWindowFocused = focused;
}
export function isTerminalWindowFocused() {
  return terminalWindowFocused;
}

export function terminalAttentionTargets(tabs: WorkspaceTab[], pending: Record<string, string>) {
  return Object.keys(pending).flatMap((paneId) => {
    const tab = tabs.find((entry) => entry.panes.some((pane) => pane.id === paneId));
    const pane = tab?.panes.find((entry) => entry.id === paneId);
    return tab && pane && (!pane.kind || pane.kind === "terminal") ? [{ tab, pane }] : [];
  });
}

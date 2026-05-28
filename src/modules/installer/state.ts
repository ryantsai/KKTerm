// In-memory session state for the Installer Helper Module.
//
// Per ADR 0007 / Q13b: detection is never persisted across restarts. The
// store auto-scans on first Module entry per app session and holds results
// until the user clicks Refresh or quits the app. Catalog is cached on disk
// by the Rust side; the store just mirrors the last-loaded copy.

import { create } from "zustand";
import type {
  Catalog,
  DetectedState,
  ProgressEvent,
  ToolState,
} from "./types";

const MAX_LOG_LINES = 200;

interface InFlight {
  /// "install" or "uninstall"
  operation: "install" | "uninstall";
  currentStep: string | null;
  ratio: number | null;
  log: string[];
}

interface InstallerStoreState {
  catalog: Catalog | null;
  detected: Record<string, DetectedState>;
  toolState: Record<string, ToolState>;
  hasInitialScanned: boolean;
  scanning: boolean;
  inFlight: Record<string, InFlight>;
  /// Terminal status echo for the most recent operation per tool.
  /// `null` means no recent status.
  lastStatus: Record<
    string,
    | { kind: "completed"; installedVersion: string | null }
    | { kind: "failed"; message: string }
    | { kind: "cancelled" }
    | null
  >;
  /// Per-tool detail panel expansion. Closed on Module mount.
  expanded: Record<string, boolean>;
  /// Set to `true` for the rest of the app session once any WSL feature
  /// install completes. Docker (and anything else that `needsWsl`) is then
  /// disabled with a reboot-required hint until the user restarts Windows.
  /// Reset only by restarting KKTerm — a real reboot kills the app anyway.
  wslJustEnabled: boolean;

  setCatalog: (catalog: Catalog) => void;
  setDetected: (detected: Record<string, DetectedState>) => void;
  setOneDetected: (toolId: string, state: DetectedState) => void;
  setToolStates: (states: ToolState[]) => void;
  beginInFlight: (toolId: string, operation: "install" | "uninstall") => void;
  applyProgress: (event: ProgressEvent) => void;
  toggleExpanded: (toolId: string) => void;
  setScanning: (scanning: boolean) => void;
  markInitialScanned: () => void;
  markWslJustEnabled: () => void;
  reset: () => void;
}

const initial: Pick<
  InstallerStoreState,
  | "catalog"
  | "detected"
  | "toolState"
  | "hasInitialScanned"
  | "scanning"
  | "inFlight"
  | "lastStatus"
  | "expanded"
  | "wslJustEnabled"
> = {
  catalog: null,
  detected: {},
  toolState: {},
  hasInitialScanned: false,
  scanning: false,
  inFlight: {},
  lastStatus: {},
  expanded: {},
  wslJustEnabled: false,
};

export const useInstallerStore = create<InstallerStoreState>((set) => ({
  ...initial,
  setCatalog: (catalog) => set({ catalog }),
  setDetected: (detected) => set({ detected }),
  setOneDetected: (toolId, state) =>
    set((s) => ({ detected: { ...s.detected, [toolId]: state } })),
  setToolStates: (states) =>
    set({
      toolState: Object.fromEntries(states.map((s) => [s.toolId, s])),
    }),
  beginInFlight: (toolId, operation) =>
    set((s) => ({
      inFlight: {
        ...s.inFlight,
        [toolId]: { operation, currentStep: null, ratio: null, log: [] },
      },
      lastStatus: { ...s.lastStatus, [toolId]: null },
    })),
  applyProgress: (event) =>
    set((s) => {
      const current = s.inFlight[event.toolId];
      if (!current) return s;
      if (event.kind === "step") {
        return {
          inFlight: {
            ...s.inFlight,
            [event.toolId]: {
              ...current,
              currentStep: event.message,
              log: trimLog([...current.log, `▸ ${event.message}`]),
            },
          },
        };
      }
      if (event.kind === "stdout" || event.kind === "stderr") {
        return {
          inFlight: {
            ...s.inFlight,
            [event.toolId]: {
              ...current,
              log: trimLog([...current.log, event.line]),
            },
          },
        };
      }
      if (event.kind === "progress") {
        return {
          inFlight: {
            ...s.inFlight,
            [event.toolId]: { ...current, ratio: event.ratio },
          },
        };
      }
      // Terminal events: drop in-flight, record lastStatus.
      const { [event.toolId]: _gone, ...restInFlight } = s.inFlight;
      const lastStatus: InstallerStoreState["lastStatus"][string] =
        event.kind === "completed"
          ? { kind: "completed", installedVersion: event.installedVersion }
          : event.kind === "failed"
            ? { kind: "failed", message: event.message }
            : { kind: "cancelled" };
      return {
        inFlight: restInFlight,
        lastStatus: { ...s.lastStatus, [event.toolId]: lastStatus },
      };
    }),
  toggleExpanded: (toolId) =>
    set((s) => ({
      expanded: { ...s.expanded, [toolId]: !s.expanded[toolId] },
    })),
  setScanning: (scanning) => set({ scanning }),
  markInitialScanned: () => set({ hasInitialScanned: true }),
  markWslJustEnabled: () => set({ wslJustEnabled: true }),
  reset: () => set(initial),
}));

function trimLog(lines: string[]): string[] {
  if (lines.length <= MAX_LOG_LINES) return lines;
  return lines.slice(lines.length - MAX_LOG_LINES);
}

export type { InstallerStoreState };

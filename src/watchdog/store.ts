import { useEffect } from "react";
import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeCommand, isTauriRuntime } from "../lib/tauri";
import type {
  WatchdogEvent,
  WatchdogIntervenePayload,
  WatchdogInterventionRecord,
  WatchdogReport,
  WatchdogState,
  WatchdogSummary,
  WatchdogTick,
  WatchdogTriggerEvent,
} from "./types";
import { isTerminalState } from "./types";
import { runIntervention } from "./interventionRunner";
import { generateAiSummary, saveReportAsMarkdown } from "./report";

const EVENT_CHANNEL = "watchdog://event";

/// Per-watchdog ring buffer cap, mirroring the Rust side. Older ticks roll
/// off the front so a long-running watchdog doesn't grow unboundedly.
const TICK_RING_CAP = 200;

/// Frontend-only intervention record. Mirrors the Rust shape but adds an
/// `inFlight` flag so the detail timeline can show "AI thinking…" between
/// the intervene event and the record callback.
export interface WatchdogInterventionEntry extends WatchdogInterventionRecord {
  inFlight: boolean;
}

export interface WatchdogAiSummary {
  text: string;
  generatedAt: number;
}

interface WatchdogStoreState {
  summaries: Record<string, WatchdogSummary>;
  ticks: Record<string, WatchdogTick[]>;
  triggers: Record<string, WatchdogTriggerEvent[]>;
  interventions: Record<string, WatchdogInterventionEntry[]>;
  /// AI-generated lifecycle summary, keyed by watchdog id. Populated on
  /// demand when the user clicks Summarize; persists until dismiss/restart.
  aiSummaries: Record<string, WatchdogAiSummary>;
  /// Watchdog ids currently generating an AI summary — UI shows a spinner.
  summaryInFlight: Record<string, boolean>;
  selectedId: string | null;
  popoverOpen: boolean;
  loaded: boolean;
  subscriberCount: number;
  unlisten: UnlistenFn | null;

  subscribe: () => void;
  unsubscribe: () => void;
  load: () => Promise<void>;
  applyEvent: (event: WatchdogEvent) => void;
  refreshInterventions: (watchdogId: string) => Promise<void>;

  setSelected: (id: string | null) => void;
  setPopoverOpen: (open: boolean) => void;
  togglePopover: () => void;

  cancel: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
  getReport: (id: string) => Promise<WatchdogReport | null>;
  generateSummary: (id: string) => Promise<void>;
  saveReport: (id: string) => Promise<string | null>;
}

export const useWatchdogStore = create<WatchdogStoreState>((set, get) => ({
  summaries: {},
  ticks: {},
  triggers: {},
  interventions: {},
  aiSummaries: {},
  summaryInFlight: {},
  selectedId: null,
  popoverOpen: false,
  loaded: false,
  subscriberCount: 0,
  unlisten: null,

  subscribe() {
    const next = get().subscriberCount + 1;
    set({ subscriberCount: next });
    if (next !== 1) {
      return;
    }
    // First subscriber: install the global event listener + seed state.
    // Idempotent: subsequent subscribers piggyback on the same listener.
    void (async () => {
      try {
        const unlisten = await listen<WatchdogEvent>(EVENT_CHANNEL, (evt) => {
          get().applyEvent(evt.payload);
        });
        set({ unlisten });
      } catch (error) {
        console.error("[watchdog] failed to listen", error);
      }
      void get().load();
    })();
  },

  unsubscribe() {
    const next = Math.max(0, get().subscriberCount - 1);
    set({ subscriberCount: next });
    if (next !== 0) {
      return;
    }
    const unlisten = get().unlisten;
    if (unlisten) {
      unlisten();
    }
    set({ unlisten: null });
  },

  async load() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      const summaries = await invokeCommand("watchdog_list");
      const next: Record<string, WatchdogSummary> = {};
      for (const s of summaries) {
        next[s.id] = s;
      }
      set({ summaries: next, loaded: true });
    } catch (error) {
      console.error("[watchdog] load failed", error);
    }
  },

  applyEvent(event) {
    const { watchdogId, kind, payload } = event;
    if (kind === "tick") {
      const tick: WatchdogTick = {
        at: event.at,
        value: payload.value,
        predicateMet: payload.predicateMet === true,
      };
      set((s) => {
        const existing = s.ticks[watchdogId] ?? [];
        const nextTicks = [...existing, tick];
        if (nextTicks.length > TICK_RING_CAP) {
          nextTicks.splice(0, nextTicks.length - TICK_RING_CAP);
        }
        // Also patch the summary's lastValue + pollCount so the popover
        // updates without waiting for a stateChange.
        const summary = s.summaries[watchdogId];
        const nextSummary = summary
          ? {
              ...summary,
              lastValue: payload.value,
              pollCount:
                typeof payload.pollCount === "number" ? payload.pollCount : summary.pollCount,
            }
          : summary;
        return {
          ticks: { ...s.ticks, [watchdogId]: nextTicks },
          summaries: nextSummary
            ? { ...s.summaries, [watchdogId]: nextSummary }
            : s.summaries,
        };
      });
      return;
    }
    if (kind === "trigger") {
      const trig: WatchdogTriggerEvent = {
        at: event.at,
        valueAtTrigger: payload.value,
      };
      set((s) => {
        const existing = s.triggers[watchdogId] ?? [];
        const summary = s.summaries[watchdogId];
        const nextSummary = summary
          ? {
              ...summary,
              triggerCount:
                typeof payload.triggerCount === "number"
                  ? payload.triggerCount
                  : summary.triggerCount + 1,
            }
          : summary;
        return {
          triggers: { ...s.triggers, [watchdogId]: [...existing, trig] },
          summaries: nextSummary
            ? { ...s.summaries, [watchdogId]: nextSummary }
            : s.summaries,
        };
      });
      return;
    }
    if (kind === "stateChange" || kind === "complete") {
      const nextState = payload.state as WatchdogState | undefined;
      if (!nextState) {
        return;
      }
      set((s) => {
        const summary = s.summaries[watchdogId];
        if (!summary) {
          return s;
        }
        return {
          summaries: {
            ...s.summaries,
            [watchdogId]: { ...summary, state: nextState },
          },
        };
      });
      return;
    }
    if (kind === "intervene") {
      // The Rust loop is now parked waiting for the record callback. Add a
      // placeholder entry to the timeline so the user sees the intervention
      // immediately; the runner replaces it with the final outcome when it
      // calls watchdog_record_intervention (which also unparks the loop).
      const intervene = payload as unknown as WatchdogIntervenePayload;
      set((s) => {
        const existing = s.interventions[watchdogId] ?? [];
        const inFlight: WatchdogInterventionEntry = {
          interventionId: intervene.interventionId,
          at: event.at,
          ok: false,
          summary: "Running intervention…",
          toolCalls: [],
          inFlight: true,
        };
        return {
          interventions: {
            ...s.interventions,
            [watchdogId]: [...existing, inFlight],
          },
        };
      });
      const summary = get().summaries[watchdogId];
      void runIntervention({
        watchdogId,
        watchdogName: summary?.name ?? "(unnamed)",
        payload: intervene,
      }).then(() => {
        // After the runner records via Rust, request a fresh report so the
        // local intervention entry replaces its placeholder with the final
        // outcome. Cheap; only fires once per intervention.
        void get().refreshInterventions(watchdogId);
      });
      return;
    }
  },

  async refreshInterventions(watchdogId) {
    const report = await get().getReport(watchdogId);
    if (!report) return;
    set((s) => ({
      interventions: {
        ...s.interventions,
        [watchdogId]: report.interventions.map((r) => ({ ...r, inFlight: false })),
      },
    }));
  },

  setSelected(id) {
    set({ selectedId: id });
  },

  setPopoverOpen(open) {
    set({ popoverOpen: open });
  },

  togglePopover() {
    set((s) => ({ popoverOpen: !s.popoverOpen }));
  },

  async cancel(id) {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      await invokeCommand("watchdog_cancel", { id });
    } catch (error) {
      console.error("[watchdog] cancel failed", error);
    }
  },

  dismiss(id) {
    // Local-only: removes a terminal watchdog from the popover after the
    // user has reviewed it. The Rust entry stays in the registry until app
    // restart (cheap; session-only), but the user no longer sees it.
    set((s) => {
      const summary = s.summaries[id];
      if (!summary || !isTerminalState(summary.state)) {
        return s;
      }
      const { [id]: _, ...restSummaries } = s.summaries;
      const { [id]: __, ...restTicks } = s.ticks;
      const { [id]: ___, ...restTriggers } = s.triggers;
      const { [id]: ____, ...restInterventions } = s.interventions;
      const { [id]: _____, ...restAiSummaries } = s.aiSummaries;
      return {
        summaries: restSummaries,
        ticks: restTicks,
        triggers: restTriggers,
        interventions: restInterventions,
        aiSummaries: restAiSummaries,
        selectedId: s.selectedId === id ? null : s.selectedId,
      };
    });
  },

  async getReport(id) {
    if (!isTauriRuntime()) {
      return null;
    }
    try {
      return await invokeCommand("watchdog_get_report", { id });
    } catch (error) {
      console.error("[watchdog] getReport failed", error);
      return null;
    }
  },

  async generateSummary(id) {
    if (get().summaryInFlight[id]) {
      return;
    }
    const report = await get().getReport(id);
    if (!report) return;
    set((s) => ({ summaryInFlight: { ...s.summaryInFlight, [id]: true } }));
    try {
      const text = await generateAiSummary(report);
      set((s) => ({
        aiSummaries: {
          ...s.aiSummaries,
          [id]: { text, generatedAt: Date.now() },
        },
      }));
    } catch (error) {
      console.error("[watchdog] summary failed", error);
      set((s) => ({
        aiSummaries: {
          ...s.aiSummaries,
          [id]: {
            text:
              error instanceof Error
                ? `Summary failed: ${error.message}`
                : "Summary failed.",
            generatedAt: Date.now(),
          },
        },
      }));
    } finally {
      set((s) => {
        const { [id]: _, ...rest } = s.summaryInFlight;
        return { summaryInFlight: rest };
      });
    }
  },

  async saveReport(id) {
    const report = await get().getReport(id);
    if (!report) return null;
    const summary = get().aiSummaries[id]?.text ?? null;
    try {
      return await saveReportAsMarkdown(report, summary);
    } catch (error) {
      console.error("[watchdog] saveReport failed", error);
      return null;
    }
  },
}));

/// Hook to keep the store subscribed for the lifetime of the calling component.
/// Mount this once near the root (e.g. inside the status bar component) — it's
/// fine to mount it from multiple places; the subscribe-count is reference-counted.
export function useWatchdogSubscription() {
  const subscribe = useWatchdogStore((s) => s.subscribe);
  const unsubscribe = useWatchdogStore((s) => s.unsubscribe);
  useEffect(() => {
    subscribe();
    return () => unsubscribe();
  }, [subscribe, unsubscribe]);
}

/// Selector helper: array of summaries in createdAt order. Memoized inputs
/// (single Record reference) mean components only re-render when summaries
/// actually change.
export function useWatchdogSummariesSorted(): WatchdogSummary[] {
  const summaries = useWatchdogStore((s) => s.summaries);
  return Object.values(summaries).sort((a, b) => a.createdAt - b.createdAt);
}

/// Active count = anything not in a terminal state. Drives the status bar
/// badge: 0 means the badge is hidden.
export function useWatchdogActiveCount(): number {
  const summaries = useWatchdogStore((s) => s.summaries);
  let n = 0;
  for (const id in summaries) {
    if (!isTerminalState(summaries[id].state)) {
      n += 1;
    }
  }
  return n;
}

/// Total badge count including terminal-but-undismissed watchdogs. Status bar
/// uses this for the badge number; if zero, the icon hides entirely.
export function useWatchdogTotalCount(): number {
  const summaries = useWatchdogStore((s) => s.summaries);
  return Object.keys(summaries).length;
}

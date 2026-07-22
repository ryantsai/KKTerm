// In-memory session state for the Install Helper Module.
//
// Detection streams from the Rust backend. On Module entry, the frontend
// first renders any Windows Registry detection cache, then receives fresh
// per-tool detection results over `installer://progress` as the background
// sweep completes. The store remains in-memory; the registry cache is owned
// by the Rust installer backend.
//
// This module owns two parallel transient slices:
//   * inFlight — current command text, aggregate log and determinate ratio
//     used by tile/header presentation.
//   * stepperState — the staged progress presentation. Every operation starts
//     with the shared default template; a provider's declared `plan` replaces
//     it when more precise lifecycle events are available. stdout/stderr lines
//     are routed to the active stage.

import { create } from "zustand";
import type {
  Catalog,
  DetectedState,
  PlanStep,
  ProgressEvent,
  ToolState,
} from "./types";

const MAX_LOG_LINES = 200;
const MAX_STEP_LOG_LINES = 500;
const GENERAL_STEP_BUCKET = "_general";
const DEFAULT_PREPARE_STEP_ID = "prepare";
const DEFAULT_APPLY_STEP_ID = "apply";
const DEFAULT_VERIFY_STEP_ID = "verify";

interface InFlight {
  /// "install" or "uninstall"
  operation: "install" | "uninstall";
  currentStep: string | null;
  ratio: number | null;
  log: string[];
}

type StepStatus = "pending" | "running" | "done" | "failed" | "cancelled";

interface StepperState {
  isDefaultPlan: boolean;
  plan: PlanStep[];
  status: Record<string, StepStatus>;
  startedAt: Record<string, number>;
  durations: Record<string, number>;
  errors: Record<string, string>;
  logs: Record<string, string[]>;
  activeStepId: string | null;
  startedAtMs: number;
}

interface OpenDialog {
  toolId: string;
  /// "info" — installed/not-installed details. "stepper" — install in
  /// progress or just completed; the dialog body renders the stepper.
  /// "launcher" — mini launcher for installed command-line tools: sample
  /// commands plus an open-terminal action.
  mode: "info" | "stepper" | "launcher";
}

/// Catalog roll-up published by the Install Helper page so the global app
/// status bar can mirror the per-page footer counts while the Module is the
/// visible page. `null` until the page has computed counts at least once.
interface InstallerSummary {
  all: number;
  installed: number;
  updates: number;
  lastCheckedAt: number | null;
}

interface InstallerStoreState {
  catalog: Catalog | null;
  detected: Record<string, DetectedState>;
  toolState: Record<string, ToolState>;
  hasInitialScanned: boolean;
  scanning: boolean;
  /// True for the duration of a streaming check-for-updates sweep. This is
  /// the aggregate signal used by the toolbar (Refresh button, header pill)
  /// and the interval guard. For per-card presentation use `checkingToolIds`
  /// instead — a scoped check (e.g. the post-install refresh of a single
  /// tool) sets this global flag too, so gating a card's "retrieving"
  /// placeholder on it makes every card flicker.
  checking: boolean;
  /// The specific tools whose latest-version lookup is currently in flight.
  /// Cards read per-tool membership so a scoped refresh only shows the
  /// retrieving placeholder on the tool being checked.
  checkingToolIds: Set<string>;
  /// Optional per-tool error from the most recent check sweep (null when
  /// the latest lookup succeeded).
  checkError: Record<string, string | null>;
  inFlight: Record<string, InFlight>;
  /// Per-tool stepper state, parallel to `inFlight`. Retained across
  /// dialog open/close so reopening an in-flight install shows current
  /// progress, and so a just-completed stepper can be reviewed.
  stepperState: Record<string, StepperState>;
  /// Terminal status echo for the most recent operation per tool.
  /// `null` means no recent status.
  lastStatus: Record<
    string,
    | { kind: "completed"; installedVersion: string | null }
    | { kind: "failed"; message: string }
    | { kind: "cancelled" }
    | null
  >;
  /// Tool whose detail dialog is currently open, plus dialog mode. The
  /// dialog reads detected/toolState/stepperState from the store, so it
  /// can be closed and reopened without losing in-flight progress.
  openDialog: OpenDialog | null;
  /// Whether the dynamic WSL distro manager dialog is open. It is layered
  /// above the tool dialog (opened from the installed WSL feature), so it has
  /// its own flag rather than sharing `openDialog`.
  wslManagerOpen: boolean;
  /// Set to `true` for the rest of the app session once any WSL feature
  /// install completes. Docker (and anything else that `needsWsl`) is then
  /// disabled with a reboot-required hint until the user restarts Windows.
  /// Reset only by restarting KKTerm — a real reboot kills the app anyway.
  wslJustEnabled: boolean;
  /// Footer roll-up mirrored into the global status bar. Owned by the page;
  /// `null` until the page first computes counts.
  summary: InstallerSummary | null;

  setCatalog: (catalog: Catalog) => void;
  setDetected: (detected: Record<string, DetectedState>) => void;
  setOneDetected: (toolId: string, state: DetectedState) => void;
  setToolStates: (states: ToolState[]) => void;
  beginInFlight: (toolId: string, operation: "install" | "uninstall") => void;
  applyProgress: (event: ProgressEvent) => void;
  openInfoDialog: (toolId: string) => void;
  openStepperDialog: (toolId: string) => void;
  openLauncherDialog: (toolId: string) => void;
  closeDialog: () => void;
  openWslManager: () => void;
  closeWslManager: () => void;
  setScanning: (scanning: boolean) => void;
  setChecking: (checking: boolean) => void;
  setSummary: (summary: InstallerSummary | null) => void;
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
  | "checking"
  | "checkingToolIds"
  | "checkError"
  | "inFlight"
  | "stepperState"
  | "lastStatus"
  | "openDialog"
  | "wslManagerOpen"
  | "wslJustEnabled"
  | "summary"
> = {
  catalog: null,
  detected: {},
  toolState: {},
  hasInitialScanned: false,
  scanning: false,
  checking: false,
  checkingToolIds: new Set(),
  checkError: {},
  inFlight: {},
  stepperState: {},
  lastStatus: {},
  openDialog: null,
  wslManagerOpen: false,
  wslJustEnabled: false,
  summary: null,
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
    set((s) => {
      const startedAtMs = Date.now();
      return {
        inFlight: {
          ...s.inFlight,
          [toolId]: { operation, currentStep: null, ratio: null, log: [] },
        },
        stepperState: {
          ...s.stepperState,
          [toolId]: defaultStepperState(operation, startedAtMs),
        },
        lastStatus: { ...s.lastStatus, [toolId]: null },
      };
    }),
  applyProgress: (event) =>
    set((s) => {
      // ---- check-for-updates protocol --------------------------------
      if (event.kind === "checkStarted") {
        const cleared: Record<string, string | null> = {};
        for (const id of event.toolIds) cleared[id] = null;
        return {
          checking: true,
          checkingToolIds: new Set(event.toolIds),
          checkError: { ...s.checkError, ...cleared },
        };
      }
      if (event.kind === "checkResult") {
        const nextToolState = { ...s.toolState };
        const existing = nextToolState[event.toolId];
        nextToolState[event.toolId] = {
          toolId: event.toolId,
          pinned: existing?.pinned ?? false,
          latestVersionSeen:
            event.latestVersion ?? existing?.latestVersionSeen ?? null,
          lastCheckAt: Math.floor(Date.now() / 1000),
        };
        // Clear this tool's retrieving state as soon as its own result
        // lands, so each card settles independently instead of waiting for
        // the whole sweep to finish.
        const nextCheckingToolIds = new Set(s.checkingToolIds);
        nextCheckingToolIds.delete(event.toolId);
        return {
          toolState: nextToolState,
          checkingToolIds: nextCheckingToolIds,
          checkError: {
            ...s.checkError,
            [event.toolId]: event.error ?? null,
          },
        };
      }
      if (event.kind === "checkFinished") {
        return { checking: false, checkingToolIds: new Set() };
      }
      if (event.kind === "detectStarted") {
        return { scanning: true };
      }
      if (event.kind === "detectResult") {
        return {
          detected: { ...s.detected, [event.toolId]: event.state },
        };
      }
      if (event.kind === "detectFinished") {
        return {
          scanning: false,
          hasInitialScanned: true,
        };
      }

      // ---- install/uninstall events ---------------------------------
      const toolId = "toolId" in event ? event.toolId : null;
      if (!toolId) return s;

      // Stepper protocol events first; they may exist even when inFlight
      // has not been seeded yet (e.g. plan arrives before beginInFlight
      // commits, though current code paths set beginInFlight first).
      if (event.kind === "plan") {
        const seeded: StepperState = {
          isDefaultPlan: false,
          plan: event.steps,
          status: Object.fromEntries(
            event.steps.map((step) => [step.id, "pending" as StepStatus]),
          ),
          startedAt: {},
          durations: {},
          errors: {},
          logs: {},
          activeStepId: null,
          startedAtMs: s.stepperState[toolId]?.startedAtMs ?? Date.now(),
        };
        return {
          stepperState: { ...s.stepperState, [toolId]: seeded },
        };
      }
      if (event.kind === "stepStarted") {
        const current =
          s.stepperState[toolId] ?? emptyStepperState();
        const status = { ...current.status, [event.stepId]: "running" as StepStatus };
        const startedAt = { ...current.startedAt, [event.stepId]: Date.now() };
        return {
          stepperState: {
            ...s.stepperState,
            [toolId]: {
              ...current,
              status,
              startedAt,
              activeStepId: event.stepId,
            },
          },
        };
      }
      if (event.kind === "stepFinished") {
        const current =
          s.stepperState[toolId] ?? emptyStepperState();
        const startedAt = current.startedAt[event.stepId] ?? Date.now();
        const status: StepStatus = event.ok ? "done" : "failed";
        return {
          stepperState: {
            ...s.stepperState,
            [toolId]: {
              ...current,
              status: { ...current.status, [event.stepId]: status },
              durations: {
                ...current.durations,
                [event.stepId]: Date.now() - startedAt,
              },
              errors: event.error
                ? { ...current.errors, [event.stepId]: event.error }
                : current.errors,
              activeStepId:
                current.activeStepId === event.stepId
                  ? null
                  : current.activeStepId,
            },
          },
        };
      }

      // Legacy inFlight slice — only updated when an install is in flight.
      const current = s.inFlight[toolId];
      const stepperCurrent = s.stepperState[toolId];

      if (event.kind === "step") {
        if (!current) return s;
        const nextStepper = stepperCurrent?.isDefaultPlan
          ? startDefaultApplyStep(stepperCurrent)
          : stepperCurrent;
        return {
          inFlight: {
            ...s.inFlight,
            [toolId]: {
              ...current,
              currentStep: event.message,
              log: trimLog([...current.log, `▸ ${event.message}`]),
            },
          },
          ...(nextStepper
            ? { stepperState: { ...s.stepperState, [toolId]: nextStepper } }
            : {}),
        };
      }
      if (event.kind === "stdout" || event.kind === "stderr") {
        const activeStepper = stepperCurrent?.isDefaultPlan
          ? startDefaultApplyStep(stepperCurrent)
          : stepperCurrent;
        const nextStepper = activeStepper
          ? withStepLog(activeStepper, event.stepId, event.line)
          : activeStepper;
        if (!current) {
          return nextStepper
            ? { stepperState: { ...s.stepperState, [toolId]: nextStepper } }
            : s;
        }
        return {
          inFlight: {
            ...s.inFlight,
            [toolId]: {
              ...current,
              log: trimLog([...current.log, event.line]),
            },
          },
          ...(nextStepper
            ? { stepperState: { ...s.stepperState, [toolId]: nextStepper } }
            : {}),
        };
      }
      if (event.kind === "progress") {
        if (!current) return s;
        const nextStepper = stepperCurrent?.isDefaultPlan
          ? startDefaultApplyStep(stepperCurrent)
          : stepperCurrent;
        return {
          inFlight: {
            ...s.inFlight,
            [toolId]: { ...current, ratio: event.ratio },
          },
          ...(nextStepper
            ? { stepperState: { ...s.stepperState, [toolId]: nextStepper } }
            : {}),
        };
      }

      // Terminal events: drop in-flight, record lastStatus. Stepper state
      // stays around so the user can review what just happened.
      const { [toolId]: _gone, ...restInFlight } = s.inFlight;
      const lastStatus: InstallerStoreState["lastStatus"][string] =
        event.kind === "completed"
          ? { kind: "completed", installedVersion: event.installedVersion }
          : event.kind === "failed"
            ? { kind: "failed", message: event.message }
            : { kind: "cancelled" };
      const finishedStepper = stepperCurrent
        ? finishStepperForTerminalEvent(stepperCurrent, event)
        : stepperCurrent;
      return {
        inFlight: restInFlight,
        lastStatus: { ...s.lastStatus, [toolId]: lastStatus },
        ...(finishedStepper
          ? {
              stepperState: {
                ...s.stepperState,
                [toolId]: finishedStepper,
              },
            }
          : {}),
      };
    }),
  openInfoDialog: (toolId) => set({ openDialog: { toolId, mode: "info" } }),
  openStepperDialog: (toolId) =>
    set({ openDialog: { toolId, mode: "stepper" } }),
  openLauncherDialog: (toolId) =>
    set({ openDialog: { toolId, mode: "launcher" } }),
  closeDialog: () => set({ openDialog: null }),
  openWslManager: () => set({ wslManagerOpen: true }),
  closeWslManager: () => set({ wslManagerOpen: false }),
  setScanning: (scanning) => set({ scanning }),
  setChecking: (checking) => set({ checking }),
  setSummary: (summary) => set({ summary }),
  markInitialScanned: () => set({ hasInitialScanned: true }),
  markWslJustEnabled: () => set({ wslJustEnabled: true }),
  reset: () => set(initial),
}));

function emptyStepperState(): StepperState {
  return {
    isDefaultPlan: false,
    plan: [],
    status: {},
    startedAt: {},
    durations: {},
    errors: {},
    logs: {},
    activeStepId: null,
    startedAtMs: Date.now(),
  };
}

function defaultStepperState(
  operation: "install" | "uninstall",
  startedAtMs: number,
): StepperState {
  const plan: PlanStep[] = [
    {
      id: DEFAULT_PREPARE_STEP_ID,
      labelKey: "installer.steps.resolveDependencyPlan",
    },
    {
      id: DEFAULT_APPLY_STEP_ID,
      labelKey:
        operation === "uninstall"
          ? "installer.dialog.uninstallingTitle"
          : "installer.steps.installNamed",
    },
    { id: DEFAULT_VERIFY_STEP_ID, labelKey: "installer.steps.verify" },
  ];
  return {
    isDefaultPlan: true,
    plan,
    status: {
      [DEFAULT_PREPARE_STEP_ID]: "running",
      [DEFAULT_APPLY_STEP_ID]: "pending",
      [DEFAULT_VERIFY_STEP_ID]: "pending",
    },
    startedAt: { [DEFAULT_PREPARE_STEP_ID]: startedAtMs },
    durations: {},
    errors: {},
    logs: {},
    activeStepId: DEFAULT_PREPARE_STEP_ID,
    startedAtMs,
  };
}

function startDefaultApplyStep(current: StepperState): StepperState {
  if (
    !current.isDefaultPlan ||
    current.status[DEFAULT_APPLY_STEP_ID] !== "pending"
  ) {
    return current;
  }
  const now = Date.now();
  const prepareStartedAt =
    current.startedAt[DEFAULT_PREPARE_STEP_ID] ?? current.startedAtMs;
  return {
    ...current,
    status: {
      ...current.status,
      [DEFAULT_PREPARE_STEP_ID]: "done",
      [DEFAULT_APPLY_STEP_ID]: "running",
    },
    startedAt: { ...current.startedAt, [DEFAULT_APPLY_STEP_ID]: now },
    durations: {
      ...current.durations,
      [DEFAULT_PREPARE_STEP_ID]: now - prepareStartedAt,
    },
    activeStepId: DEFAULT_APPLY_STEP_ID,
  };
}

function finishStepperForTerminalEvent(
  current: StepperState,
  event: Extract<
    ProgressEvent,
    { kind: "completed" | "failed" | "cancelled" }
  >,
): StepperState {
  const now = Date.now();
  if (current.isDefaultPlan && event.kind === "completed") {
    const status = { ...current.status };
    const durations = { ...current.durations };
    for (const step of current.plan) {
      status[step.id] = "done";
      if (durations[step.id] == null) {
        durations[step.id] = Math.max(
          0,
          now - (current.startedAt[step.id] ?? now),
        );
      }
    }
    return { ...current, status, durations, activeStepId: null };
  }

  const activeStepId = current.activeStepId;
  if (!activeStepId) return current;
  const terminalStatus: StepStatus =
    event.kind === "completed"
      ? "done"
      : event.kind === "failed"
        ? "failed"
        : "cancelled";
  return {
    ...current,
    status: { ...current.status, [activeStepId]: terminalStatus },
    durations: {
      ...current.durations,
      [activeStepId]: Math.max(
        0,
        now - (current.startedAt[activeStepId] ?? now),
      ),
    },
    errors:
      event.kind === "failed"
        ? { ...current.errors, [activeStepId]: event.message }
        : current.errors,
    activeStepId: null,
  };
}

function withStepLog(
  current: StepperState,
  stepId: string | undefined,
  line: string,
): StepperState {
  const bucket = stepId ?? current.activeStepId ?? GENERAL_STEP_BUCKET;
  const prev = current.logs[bucket] ?? [];
  const next = prev.length >= MAX_STEP_LOG_LINES
    ? [...prev.slice(prev.length - MAX_STEP_LOG_LINES + 1), line]
    : [...prev, line];
  return { ...current, logs: { ...current.logs, [bucket]: next } };
}

function trimLog(lines: string[]): string[] {
  if (lines.length <= MAX_LOG_LINES) return lines;
  return lines.slice(lines.length - MAX_LOG_LINES);
}

export { GENERAL_STEP_BUCKET };
export type { InstallerStoreState, InstallerSummary, StepperState, StepStatus };

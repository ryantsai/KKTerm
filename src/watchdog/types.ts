// Mirrors src-tauri/src/watchdog/types.rs. Kept thin — only the fields the
// frontend actually reads. New fields can be added without ceremony because
// the Rust side uses `#[serde(rename_all = "camelCase")]` everywhere.

export type WatchdogTargetKind =
  | "mock"
  | "performanceCounter"
  | "sshSessionOutputSilence"
  | "ping"
  | "tcpReachable"
  | "schedule"
  | "logFile"
  | "outputMatch";

export type PerformanceMetric =
  | "cpuPercent"
  | "ramPercent"
  | "commitPercent"
  | "diskFreePercent"
  | "diskUsedPercent"
  | "networkDownBytesPerSec"
  | "networkUpBytesPerSec"
  | "appWorkingSetBytes"
  | "appPrivateBytes"
  | "handleCount"
  | "processCount"
  | "threadCount";

export type WatchdogTarget =
  | { kind: "mock"; step?: number }
  | { kind: "performanceCounter"; metric: PerformanceMetric }
  | { kind: "sshSessionOutputSilence"; sessionId: string }
  | { kind: "ping"; host: string; port?: number }
  | { kind: "tcpReachable"; host: string; port: number }
  | { kind: "schedule"; cron: string }
  | { kind: "logFile"; path: string; pattern: string }
  | { kind: "outputMatch"; sessionId: string; pattern: string };

export type PredicateOp =
  | { op: "gt"; value: number }
  | { op: "lt"; value: number }
  | { op: "gte"; value: number }
  | { op: "lte"; value: number }
  | { op: "eq"; value: number }
  | { op: "ne"; value: number }
  | { op: "contains"; value: string }
  | { op: "silenceFor"; ms: number };

export interface WatchdogTrigger {
  predicate: PredicateOp;
  sustainedForMs?: number;
}

export type WatchdogStop =
  | { kind: "afterDuration"; ms: number }
  | { kind: "afterTriggerCount"; n: number }
  | { kind: "afterFirstTrigger" }
  | { kind: "untilCanceled" }
  | { kind: "afterPollCount"; n: number };

export type WatchdogNotification = "inAppOnly" | "inAppPlusToast" | "inAppPlusSound";

export type WatchdogAction =
  | { kind: "notify" }
  | {
      kind: "aiIntervene";
      goal: string;
      contextSources: string[];
      allowedTools: string[];
      approvalPolicy: string;
      maxInterventions: number;
      suppressionMs: number;
    };

export interface WatchdogConfig {
  name: string;
  target: WatchdogTarget;
  trigger: WatchdogTrigger;
  pollMs: number;
  stop: WatchdogStop;
  notification: WatchdogNotification;
  action: WatchdogAction;
}

export type WatchdogState =
  | { kind: "armed" }
  | { kind: "running"; lastPollAt: number; ticksObserved: number }
  | {
      kind: "triggered";
      firstTriggeredAt: number;
      triggerCount: number;
      lastPollAt: number;
    }
  | { kind: "intervening"; startedAt: number; interventionCount: number }
  | { kind: "suppressed"; until: number; interventionCount: number }
  | { kind: "completed"; reason: string; finishedAt: number }
  | { kind: "canceled"; finishedAt: number }
  | { kind: "error"; message: string; finishedAt: number };

export interface WatchdogSummary {
  id: string;
  name: string;
  state: WatchdogState;
  createdAt: number;
  pollMs: number;
  triggerCount: number;
  pollCount: number;
  lastValue: unknown;
}

export interface WatchdogTick {
  at: number;
  value: unknown;
  predicateMet: boolean;
}

export interface WatchdogTriggerEvent {
  at: number;
  valueAtTrigger: unknown;
}

export interface WatchdogReport {
  id: string;
  name: string;
  config: WatchdogConfig;
  state: WatchdogState;
  ticks: WatchdogTick[];
  triggers: WatchdogTriggerEvent[];
  interventions: WatchdogInterventionRecord[];
  createdAt: number;
  pollCount: number;
}

/// Event payload from Rust `watchdog://event` channel.
export interface WatchdogEvent {
  watchdogId: string;
  kind: "tick" | "stateChange" | "trigger" | "intervene" | "complete";
  at: number;
  payload: Record<string, unknown>;
}

/// Sent from Rust when an aiIntervene trigger fires. The frontend runner
/// uses this to compose the sub-turn request.
export interface WatchdogIntervenePayload {
  interventionId: string;
  goal: string;
  allowedTools: string[];
  contextSources: string[];
  maxInterventions: number;
  suppressionMs: number;
  snapshot: Record<string, unknown>;
}

/// Posted back to Rust via watchdog_record_intervention after the sub-turn
/// completes (success or failure).
export interface WatchdogInterventionRecord {
  interventionId: string;
  at: number;
  ok: boolean;
  summary: string;
  toolCalls: string[];
  completionReason?: string;
  error?: string;
}

/// Terminal states. Centralized so the status bar's "active count" and the
/// detail view's "show dismiss button" agree on what terminal means.
export function isTerminalState(state: WatchdogState): boolean {
  return state.kind === "completed" || state.kind === "canceled" || state.kind === "error";
}

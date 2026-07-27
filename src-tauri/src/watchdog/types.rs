//! Data model for the AI Watchdog feature.
//!
//! See docs/superpowers/specs (forthcoming): the watchdog is a sensor + actor
//! loop. Rust owns polling, predicate evaluation, and lifecycle; JS owns the
//! AI intervention sub-turn that runs at trigger points.
//!
//! Step 1 scope: only the `Mock` target is implemented end-to-end. Real target
//! kinds (performanceCounter, sshSessionOutputSilence, ...) are added in
//! subsequent steps but the shapes are reserved here so the JSON schema is
//! stable across the API boundary.

use serde::{Deserialize, Serialize};

/// Target — what the watchdog samples each poll.
///
/// `Mock` and `PerformanceCounter` are wired (steps 1–2). Other variants exist
/// so the public schema the AI sees doesn't churn as we add real targets.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WatchdogTarget {
    /// Test-only. Emits an incrementing counter each poll, starting at 0.
    Mock {
        #[serde(default = "default_mock_step")]
        step: f64,
    },
    /// Reads `PerformanceMonitor::system_performance_counters_snapshot()` and
    /// extracts one metric per tick. First tick can return null for
    /// rate-based metrics (cpu/network) because the monitor needs two samples
    /// to compute a delta — predicate evaluators must tolerate this.
    PerformanceCounter { metric: PerformanceMetric },
    /// Placeholder for step 7.
    SshSessionOutputSilence { session_id: String },
    /// Liveness check via TCP probe (defaults to port 80). Returns 1.0 if
    /// reachable within the configured timeout, 0.0 otherwise. ICMP ping
    /// would require elevated privileges on Windows; TCP probe works through
    /// firewalls and gives a similar "is the host up" signal. Pair with
    /// `eq 0` predicate to fire when the host stops answering.
    Ping {
        host: String,
        #[serde(default)]
        port: Option<u16>,
    },
    /// Open/closed check for a specific TCP port. Returns 1.0 if the port
    /// accepts a connection, 0.0 otherwise.
    TcpReachable { host: String, port: u16 },
    /// Fires on a 5-field cron schedule (minute hour day-of-month month
    /// day-of-week), evaluated in local time. The sampler returns 1.0 on the
    /// first poll of a matching minute and 0.0 otherwise, so it pairs with a
    /// `gte 1` condition. Poll faster than once a minute so no occurrence is
    /// missed (the create flow sets a 30s poll). IT Ops Phase 5.
    Schedule { cron: String },
    /// Fires when newly-appended content of a local log file contains `pattern`
    /// (literal substring). Tracks the file size between polls so only new lines
    /// are scanned — a steady match doesn't re-fire. Returns 1.0/0.0; pair with
    /// `gte 1`. IT Ops Phase 5.
    LogFile { path: String, pattern: String },
    /// Fires when the recent output of a live SSH Session contains `pattern`
    /// (literal substring). Reads the same rolling output buffer as
    /// `SshSessionOutputSilence`. Returns 1.0/0.0; pair with `gte 1`. Created
    /// programmatically / by the assistant (no create-dialog UI). IT Ops Phase 5.
    OutputMatch { session_id: String, pattern: String },
}

fn default_mock_step() -> f64 {
    1.0
}

/// Typed metric selector. Constrained so the AI can't pass arbitrary
/// strings and silently match nothing. `DiskUsedPercent` is virtual —
/// computed as `100 - systemDriveFreePercent` since the underlying
/// PerformanceMonitor exposes only free, but users naturally say
/// "alert when disk over 85%".
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceMetric {
    CpuPercent,
    RamPercent,
    CommitPercent,
    DiskFreePercent,
    DiskUsedPercent,
    NetworkDownBytesPerSec,
    NetworkUpBytesPerSec,
    AppWorkingSetBytes,
    AppPrivateBytes,
    HandleCount,
    ProcessCount,
    ThreadCount,
}

/// Predicate applied to the sampled value.
///
/// Numeric ops compare against f64. `Contains` is for string/text targets
/// (step 7+). `SilenceFor` is the duration-since-last-event predicate that
/// `SshSessionOutputSilence` needs.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum PredicateOp {
    Gt { value: f64 },
    Lt { value: f64 },
    Gte { value: f64 },
    Lte { value: f64 },
    Eq { value: f64 },
    Ne { value: f64 },
    Contains { value: String },
    SilenceFor { ms: u64 },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogTrigger {
    pub predicate: PredicateOp,
    /// If set, the predicate must remain true for this many ms continuously
    /// before firing. Prevents false positives from momentary spikes.
    #[serde(default)]
    pub sustained_for_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WatchdogStop {
    AfterDuration { ms: u64 },
    AfterTriggerCount { n: u32 },
    AfterFirstTrigger,
    UntilCanceled,
    AfterPollCount { n: u32 },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WatchdogNotification {
    InAppOnly,
    InAppPlusToast,
    InAppPlusSound,
}

/// What happens when the trigger fires.
///
/// `Notify` is the v0 behavior — surface in the status bar, no AI involvement.
/// `AiIntervene` spawns a frontend AI sub-turn with the listed tools. Runtime
/// is responsible for enforcing the allow-list (step 5).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WatchdogAction {
    Notify,
    AiIntervene {
        goal: String,
        #[serde(default)]
        context_sources: Vec<String>,
        allowed_tools: Vec<String>,
        #[serde(default = "default_approval_policy")]
        approval_policy: String,
        max_interventions: u32,
        #[serde(default = "default_suppression_ms")]
        suppression_ms: u64,
    },
}

fn default_approval_policy() -> String {
    "sessionAllow".to_string()
}

fn default_suppression_ms() -> u64 {
    30_000
}

/// User-supplied watchdog configuration. Validated by `WatchdogRegistry::create`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogConfig {
    pub name: String,
    pub target: WatchdogTarget,
    pub trigger: WatchdogTrigger,
    pub poll_ms: u64,
    pub stop: WatchdogStop,
    pub notification: WatchdogNotification,
    pub action: WatchdogAction,
}

/// Runtime state. Mirrors the state-machine diagram in the design doc.
///
/// `Intervening` and `Suppressed` are only entered when `action` is
/// `AiIntervene` (steps 5–6); for `Notify` watchdogs the transition is
/// `Triggered → Running` (or `Completed` if stop is met).
// `Intervening`, `Suppressed`, and `Error` are wired in steps 5–6 (AI
// intervention sub-turn). Keeping them in the enum now so the JSON state
// schema the frontend listens for doesn't churn when those steps land.
#[allow(dead_code)]
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WatchdogState {
    Armed,
    Running {
        last_poll_at: u64,
        ticks_observed: u32,
    },
    Triggered {
        first_triggered_at: u64,
        trigger_count: u32,
        last_poll_at: u64,
    },
    Intervening {
        started_at: u64,
        intervention_count: u32,
    },
    Suppressed {
        until: u64,
        intervention_count: u32,
    },
    Completed {
        reason: String,
        finished_at: u64,
    },
    Canceled {
        finished_at: u64,
    },
    Error {
        message: String,
        finished_at: u64,
    },
}

impl WatchdogState {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            WatchdogState::Completed { .. }
                | WatchdogState::Canceled { .. }
                | WatchdogState::Error { .. }
        )
    }
}

/// One sample. Ring-buffered (cap `WATCHDOG_TICK_RING_CAP`) per watchdog.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogTick {
    pub at: u64,
    pub value: serde_json::Value,
    pub predicate_met: bool,
}

/// Persistent record of every trigger fire, kept for the on-demand report.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogTriggerEvent {
    pub at: u64,
    pub value_at_trigger: serde_json::Value,
}

/// Summary returned by `watchdog_list`. Heavy fields (ticks, trigger log)
/// are loaded only by `watchdog_get_report`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogSummary {
    pub id: String,
    pub name: String,
    pub state: WatchdogState,
    pub created_at: u64,
    pub poll_ms: u64,
    pub trigger_count: u32,
    pub poll_count: u32,
    pub last_value: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogReport {
    pub id: String,
    pub name: String,
    pub config: WatchdogConfig,
    pub state: WatchdogState,
    pub ticks: Vec<WatchdogTick>,
    pub triggers: Vec<WatchdogTriggerEvent>,
    pub interventions: Vec<WatchdogInterventionRecord>,
    pub created_at: u64,
    /// Total polls taken across the watchdog's life. Authoritative count that
    /// does not roll off, unlike `ticks` which is ring-capped.
    pub poll_count: u32,
}

/// One AI intervention sub-turn. Recorded by the frontend after the sub-turn
/// completes (success, denial, or error). The runtime advances the state
/// machine based on `ok` + the intervention count.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogInterventionRecord {
    pub intervention_id: String,
    pub at: u64,
    pub ok: bool,
    /// Brief one-line summary the AI produced (e.g. "Sent '/continue' to
    /// unblock codex"). Shown in the detail timeline.
    pub summary: String,
    /// Names of tools the sub-turn invoked. Always a subset of the
    /// watchdog's allowedTools — the runtime filters at the provider edge.
    #[serde(default)]
    pub tool_calls: Vec<String>,
    /// Set when the AI decided the watchdog should stop (e.g. job finished).
    /// `record_intervention` then transitions the watchdog to Completed.
    #[serde(default)]
    pub completion_reason: Option<String>,
    /// Optional error message when ok is false.
    #[serde(default)]
    pub error: Option<String>,
}

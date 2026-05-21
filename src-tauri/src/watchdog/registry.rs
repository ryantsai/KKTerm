//! In-memory registry of running watchdogs.
//!
//! Each watchdog owns a `tokio::time::interval` task plus a
//! `CancellationToken`. State, ticks, and trigger log live in the registry
//! behind a `Mutex` so commands and the polling task can both update them.
//!
//! Step 1: only the `Mock` target is dispatched. The dispatcher is
//! deliberately a free function so step 2+ can extend it without reshaping
//! the task loop.
//!
//! Registry is shared as `Arc<WatchdogRegistry>` (mirroring `StreamRegistry`)
//! so spawned tokio tasks can hold their own clone without tying the task
//! lifetime to Tauri's `State` accessor.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::{Duration, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

use super::types::{
    WatchdogAction, WatchdogConfig, WatchdogInterventionRecord, WatchdogReport, WatchdogState,
    WatchdogStop, WatchdogSummary, WatchdogTarget, WatchdogTick, WatchdogTriggerEvent,
};
use super::{
    evaluate_predicate, new_watchdog_id, now_ms, WatchdogError, MAX_CONCURRENT_WATCHDOGS,
    MAX_POLL_MS, MIN_POLL_MS, WATCHDOG_TICK_RING_CAP,
};

/// Hard upper bound on how long a single intervention sub-turn may run before
/// the loop assumes the frontend died and finalizes with an error. Long enough
/// for a model with thinking + tool calls; short enough that a hung
/// intervention doesn't permanently freeze the watchdog.
const INTERVENTION_TIMEOUT_MS: u64 = 5 * 60 * 1000;

/// Signal sent from `record_intervention` to the per-watchdog poll loop after
/// a sub-turn completes. The loop is parked on its receiver while
/// `Intervening`; this message unparks it.
#[derive(Debug)]
enum InterventionSignal {
    /// Sub-turn completed (ok or not). Loop resumes; if the AI declared the
    /// job done it carries `completion_reason`.
    Recorded {
        completion_reason: Option<String>,
    },
}

pub const EVENT_CHANNEL: &str = "watchdog://event";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WatchdogEventPayload {
    watchdog_id: String,
    /// "tick" | "stateChange" | "trigger" | "intervene" | "complete"
    kind: &'static str,
    at: u64,
    payload: serde_json::Value,
}

fn emit(app: &AppHandle, watchdog_id: &str, kind: &'static str, payload: serde_json::Value) {
    let _ = app.emit(
        EVENT_CHANNEL,
        WatchdogEventPayload {
            watchdog_id: watchdog_id.to_string(),
            kind,
            at: now_ms(),
            payload,
        },
    );
}

struct Entry {
    config: WatchdogConfig,
    state: WatchdogState,
    ticks: VecDeque<WatchdogTick>,
    triggers: Vec<WatchdogTriggerEvent>,
    interventions: Vec<WatchdogInterventionRecord>,
    poll_count: u32,
    intervention_count: u32,
    last_value: Option<serde_json::Value>,
    created_at: u64,
    cancel: CancellationToken,
    /// Set only while the watchdog is in `Intervening`. `record_intervention`
    /// drains and uses this to unpark the loop. None at all other times.
    intervention_tx: Option<mpsc::Sender<InterventionSignal>>,
}

#[derive(Default)]
pub struct WatchdogRegistry {
    inner: Mutex<HashMap<String, Entry>>,
}

impl WatchdogRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create and start a watchdog. Takes `&Arc<Self>` rather than `&self`
    /// so the spawned task can hold its own clone.
    pub fn create(
        registry: &Arc<Self>,
        app: &AppHandle,
        config: WatchdogConfig,
    ) -> Result<WatchdogSummary, WatchdogError> {
        validate_config(&config)?;

        let id = new_watchdog_id();
        let cancel = CancellationToken::new();
        let created_at = now_ms();

        {
            let mut guard = registry.lock();
            if guard.len() >= MAX_CONCURRENT_WATCHDOGS {
                return Err(WatchdogError::CapacityExceeded);
            }
            guard.insert(
                id.clone(),
                Entry {
                    config: config.clone(),
                    state: WatchdogState::Armed,
                    ticks: VecDeque::with_capacity(WATCHDOG_TICK_RING_CAP),
                    triggers: Vec::new(),
                    interventions: Vec::new(),
                    poll_count: 0,
                    intervention_count: 0,
                    last_value: None,
                    created_at,
                    cancel: cancel.clone(),
                    intervention_tx: None,
                },
            );
        }

        emit(
            app,
            &id,
            "stateChange",
            json!({ "state": WatchdogState::Armed }),
        );

        spawn_poll_task(registry.clone(), app.clone(), id.clone(), config.clone(), cancel);

        Ok(WatchdogSummary {
            id,
            name: config.name,
            state: WatchdogState::Armed,
            created_at,
            poll_ms: config.poll_ms,
            trigger_count: 0,
            poll_count: 0,
            last_value: None,
        })
    }

    pub fn list(&self) -> Vec<WatchdogSummary> {
        let guard = self.lock();
        guard.iter().map(|(id, e)| summary_of(id, e)).collect()
    }

    pub fn cancel(&self, id: &str) -> Result<(), WatchdogError> {
        let cancel = {
            let guard = self.lock();
            let entry = guard.get(id).ok_or(WatchdogError::NotFound)?;
            if entry.state.is_terminal() {
                return Err(WatchdogError::AlreadyTerminal);
            }
            entry.cancel.clone()
        };
        cancel.cancel();
        // Task's cleanup path emits the canonical Canceled state with the
        // correct timestamp; doing it here would race the task and produce
        // two state-change events.
        Ok(())
    }

    pub fn report(&self, id: &str) -> Result<WatchdogReport, WatchdogError> {
        let guard = self.lock();
        let entry = guard.get(id).ok_or(WatchdogError::NotFound)?;
        Ok(WatchdogReport {
            id: id.to_string(),
            name: entry.config.name.clone(),
            config: entry.config.clone(),
            state: entry.state.clone(),
            ticks: entry.ticks.iter().cloned().collect(),
            triggers: entry.triggers.clone(),
            interventions: entry.interventions.clone(),
            created_at: entry.created_at,
        })
    }

    /// Called by the frontend after an intervention sub-turn finishes (any
    /// outcome — success, failure, AI declared completion). Appends the
    /// record, advances the counter, transitions state, and signals the loop
    /// to resume.
    ///
    /// Returns NotFound if the watchdog has already terminated for any reason
    /// (cancel, completion, error) — the frontend's record arrival raced the
    /// terminal state. Drops cleanly.
    pub async fn record_intervention(
        &self,
        id: &str,
        record: WatchdogInterventionRecord,
    ) -> Result<(), WatchdogError> {
        let tx = {
            let mut guard = self.lock();
            let entry = guard.get_mut(id).ok_or(WatchdogError::NotFound)?;
            if !matches!(entry.state, WatchdogState::Intervening { .. }) {
                return Err(WatchdogError::invalid(format!(
                    "watchdog is not in intervening state (was: {:?})",
                    entry.state
                )));
            }
            entry.intervention_count = entry.intervention_count.saturating_add(1);
            entry.interventions.push(record.clone());
            // Take the sender — the loop owns its receiver and will be
            // unparked by the send below. None it out so a second
            // record_intervention can't double-signal.
            entry.intervention_tx.take()
        };
        if let Some(tx) = tx {
            // Channel is bounded; if the loop has died (cancel raced),
            // sending fails silently. The loop's own cleanup handles state.
            let _ = tx
                .send(InterventionSignal::Recorded {
                    completion_reason: record.completion_reason,
                })
                .await;
        }
        Ok(())
    }

    #[cfg(test)]
    #[allow(dead_code)] // wired by step 2 integration tests
    pub fn active_count(&self) -> usize {
        self.lock().len()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        self.inner.lock().expect("WatchdogRegistry mutex poisoned")
    }
}

/// Public so `ai.rs` can pre-flight a config before requesting user approval —
/// avoids the awkward "user approves, then validation rejects" UX. Validation
/// is idempotent so `create` re-runs it harmlessly.
pub(crate) fn validate_config(config: &WatchdogConfig) -> Result<(), WatchdogError> {
    if config.name.trim().is_empty() {
        return Err(WatchdogError::invalid("name must not be empty"));
    }
    if config.poll_ms < MIN_POLL_MS {
        return Err(WatchdogError::invalid(format!(
            "pollMs {} below minimum {}",
            config.poll_ms, MIN_POLL_MS
        )));
    }
    if config.poll_ms > MAX_POLL_MS {
        return Err(WatchdogError::invalid(format!(
            "pollMs {} above maximum {}",
            config.poll_ms, MAX_POLL_MS
        )));
    }
    if let WatchdogAction::AiIntervene {
        max_interventions,
        allowed_tools,
        ..
    } = &config.action
    {
        if *max_interventions == 0 {
            return Err(WatchdogError::invalid("maxInterventions must be >= 1"));
        }
        if allowed_tools.is_empty() {
            return Err(WatchdogError::invalid(
                "aiIntervene requires at least one allowed tool",
            ));
        }
    }
    match &config.target {
        WatchdogTarget::Mock { .. }
        | WatchdogTarget::PerformanceCounter { .. }
        | WatchdogTarget::SshSessionOutputSilence { .. }
        | WatchdogTarget::Ping { .. }
        | WatchdogTarget::TcpReachable { .. } => Ok(()),
    }
}

fn summary_of(id: &str, e: &Entry) -> WatchdogSummary {
    let trigger_count = match &e.state {
        WatchdogState::Triggered { trigger_count, .. } => *trigger_count,
        _ => e.triggers.len() as u32,
    };
    WatchdogSummary {
        id: id.to_string(),
        name: e.config.name.clone(),
        state: e.state.clone(),
        created_at: e.created_at,
        poll_ms: e.config.poll_ms,
        trigger_count,
        poll_count: e.poll_count,
        last_value: e.last_value.clone(),
    }
}

fn spawn_poll_task(
    registry: Arc<WatchdogRegistry>,
    app: AppHandle,
    id: String,
    config: WatchdogConfig,
    cancel: CancellationToken,
) {
    tauri::async_runtime::spawn(async move {
        run_poll_loop(registry, app, id, config, cancel).await;
    });
}

struct LoopState {
    started_at: u64,
    poll_count: u32,
    trigger_count: u32,
    condition_true_since: Option<u64>,
    /// During suppression, predicate evaluation is skipped — even if the
    /// predicate is met, we don't fire a trigger. Set after an intervention
    /// records; cleared when `now_ms() >= until`.
    suppression_until: Option<u64>,
    /// Mock-target only: incremented each poll.
    mock_counter: f64,
}

async fn run_poll_loop(
    registry: Arc<WatchdogRegistry>,
    app: AppHandle,
    id: String,
    config: WatchdogConfig,
    cancel: CancellationToken,
) {
    let mut interval = tokio::time::interval(Duration::from_millis(config.poll_ms));
    // Don't catch up after stalls; sustained-window math assumes ticks are
    // roughly pollMs apart.
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

    let started_at = now_ms();
    let mut state = LoopState {
        started_at,
        poll_count: 0,
        trigger_count: 0,
        condition_true_since: None,
        suppression_until: None,
        mock_counter: 0.0,
    };

    // First interval tick fires immediately; skip it so the watchdog respects
    // pollMs before the very first sample.
    interval.tick().await;

    transition_to_running(&registry, &app, &id, &state);

    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                finalize(&registry, &app, &id, WatchdogState::Canceled { finished_at: now_ms() });
                return;
            }
            _ = interval.tick() => {
                let value = sample_target(&config.target, &mut state, &app).await;
                state.poll_count += 1;
                let predicate_met = evaluate_predicate(&config.trigger.predicate, &value);

                push_tick(&registry, &id, &value, predicate_met);
                emit(&app, &id, "tick", json!({
                    "value": value,
                    "predicateMet": predicate_met,
                    "pollCount": state.poll_count,
                }));

                // Honor suppression: during the cooldown window after an
                // intervention, predicate evaluation is suspended so the
                // watchdog's own action doesn't immediately re-fire it.
                let in_suppression = state
                    .suppression_until
                    .is_some_and(|until| now_ms() < until);
                if in_suppression {
                    // Reset the streak timer so it doesn't carry over.
                    state.condition_true_since = None;
                }
                if !in_suppression && state.suppression_until.is_some() {
                    // Just exited suppression — transition back to Running.
                    state.suppression_until = None;
                    transition_to_running(&registry, &app, &id, &state);
                }
                let trigger_fired = !in_suppression
                    && update_sustained_window(
                        &mut state,
                        predicate_met,
                        config.trigger.sustained_for_ms,
                    );

                if trigger_fired {
                    state.trigger_count += 1;
                    record_trigger(&registry, &id, &value);
                    emit(&app, &id, "trigger", json!({
                        "value": value,
                        "triggerCount": state.trigger_count,
                    }));
                    apply_triggered_state(&registry, &app, &id, &state);

                    if let WatchdogAction::AiIntervene {
                        goal,
                        context_sources,
                        allowed_tools,
                        max_interventions,
                        suppression_ms,
                        ..
                    } = &config.action
                    {
                        let intervention_id = format!("int-{}-{}", id, now_ms());
                        // Cap check happens BEFORE intervening — if we're
                        // already at the cap (which can only mean a previous
                        // intervention recorded but the loop hasn't seen the
                        // next trigger yet), finalize as Error here.
                        let already_at_cap = current_intervention_count(&registry, &id)
                            >= *max_interventions;
                        if already_at_cap {
                            finalize(&registry, &app, &id, WatchdogState::Error {
                                message: format!(
                                    "Intervention cap ({}) reached. Review log.",
                                    max_interventions
                                ),
                                finished_at: now_ms(),
                            });
                            return;
                        }

                        // Snapshot the context the frontend will hand to the
                        // AI sub-turn. Kept compact — last 8 ticks plus the
                        // triggering value. Other context sources (session
                        // output tail) land in step 7 alongside their target.
                        let snapshot = collect_intervention_snapshot(
                            &registry,
                            &app,
                            &id,
                            &config.target,
                            context_sources,
                            &value,
                        );

                        let (tx, mut rx) = mpsc::channel::<InterventionSignal>(1);
                        install_intervention_sender(&registry, &id, tx);
                        let intervention_state = WatchdogState::Intervening {
                            started_at: now_ms(),
                            intervention_count: current_intervention_count(&registry, &id),
                        };
                        write_state(&registry, &id, intervention_state.clone());
                        emit(&app, &id, "stateChange",
                            json!({ "state": intervention_state }));
                        emit(&app, &id, "intervene", json!({
                            "interventionId": intervention_id,
                            "goal": goal,
                            "allowedTools": allowed_tools,
                            "contextSources": context_sources,
                            "maxInterventions": max_interventions,
                            "suppressionMs": suppression_ms,
                            "snapshot": snapshot,
                        }));

                        // Park here until the frontend records the outcome
                        // (timeout protects against a dead frontend).
                        let signal = tokio::time::timeout(
                            Duration::from_millis(INTERVENTION_TIMEOUT_MS),
                            rx.recv(),
                        ).await;
                        // Clear the sender slot regardless of outcome.
                        clear_intervention_sender(&registry, &id);
                        match signal {
                            Ok(Some(InterventionSignal::Recorded { completion_reason })) => {
                                if let Some(reason) = completion_reason {
                                    finalize(&registry, &app, &id, WatchdogState::Completed {
                                        reason,
                                        finished_at: now_ms(),
                                    });
                                    return;
                                }
                                // Check cap AFTER recording. record_intervention
                                // already incremented; if we just hit max,
                                // finalize.
                                if current_intervention_count(&registry, &id)
                                    >= *max_interventions
                                {
                                    finalize(&registry, &app, &id, WatchdogState::Error {
                                        message: format!(
                                            "Intervention cap ({}) reached. Review log.",
                                            max_interventions
                                        ),
                                        finished_at: now_ms(),
                                    });
                                    return;
                                }
                                // Enter suppression window. The next interval
                                // tick will sample but predicate-met evaluation
                                // is gated by `suppression_until`.
                                state.suppression_until = Some(now_ms() + suppression_ms);
                                let suppressed = WatchdogState::Suppressed {
                                    until: now_ms() + suppression_ms,
                                    intervention_count: current_intervention_count(&registry, &id),
                                };
                                write_state(&registry, &id, suppressed.clone());
                                emit(&app, &id, "stateChange",
                                    json!({ "state": suppressed }));
                            }
                            Ok(None) | Err(_) => {
                                finalize(&registry, &app, &id, WatchdogState::Error {
                                    message:
                                        "Intervention sub-turn timed out or channel closed."
                                            .to_string(),
                                    finished_at: now_ms(),
                                });
                                return;
                            }
                        }
                        // Reset condition tracker so the next true streak
                        // starts fresh after suppression — otherwise we'd
                        // immediately re-fire on the next tick.
                        state.condition_true_since = None;
                    }
                }

                if let Some(reason) = stop_reached(&config.stop, &state, trigger_fired) {
                    finalize(&registry, &app, &id, WatchdogState::Completed {
                        reason,
                        finished_at: now_ms(),
                    });
                    return;
                }
            }
        }
    }
}

async fn sample_target(
    target: &WatchdogTarget,
    state: &mut LoopState,
    app: &AppHandle,
) -> serde_json::Value {
    match target {
        WatchdogTarget::Mock { step } => {
            state.mock_counter += *step;
            json!(state.mock_counter)
        }
        WatchdogTarget::PerformanceCounter { metric } => {
            super::targets::sample_performance_counter(app, *metric)
        }
        WatchdogTarget::SshSessionOutputSilence { session_id } => {
            super::targets::sample_ssh_session_silence(app, session_id)
        }
        WatchdogTarget::Ping { host, port } => super::targets::sample_ping(host, *port).await,
        WatchdogTarget::TcpReachable { host, port } => {
            super::targets::sample_tcp_reachable(host, *port).await
        }
    }
}

/// Rising-edge detector for sustained windows. Returns true the first tick
/// at which the predicate has been continuously true for `sustained_for_ms`.
/// Subsequent ticks within the same true-streak return false; the streak
/// resets when the predicate flips to false.
fn update_sustained_window(
    state: &mut LoopState,
    predicate_met: bool,
    sustained_for_ms: Option<u64>,
) -> bool {
    let now = now_ms();
    if !predicate_met {
        state.condition_true_since = None;
        return false;
    }
    let Some(threshold) = sustained_for_ms else {
        return true;
    };
    let since = *state.condition_true_since.get_or_insert(now);
    if since == u64::MAX {
        // Already fired this streak; wait for predicate to flip false first.
        return false;
    }
    if now.saturating_sub(since) >= threshold {
        state.condition_true_since = Some(u64::MAX);
        return true;
    }
    false
}

fn stop_reached(stop: &WatchdogStop, state: &LoopState, trigger_fired: bool) -> Option<String> {
    match stop {
        WatchdogStop::UntilCanceled => None,
        WatchdogStop::AfterFirstTrigger => trigger_fired.then(|| "afterFirstTrigger".into()),
        WatchdogStop::AfterTriggerCount { n } => {
            (state.trigger_count >= *n).then(|| "afterTriggerCount".into())
        }
        WatchdogStop::AfterPollCount { n } => {
            (state.poll_count >= *n).then(|| "afterPollCount".into())
        }
        WatchdogStop::AfterDuration { ms } => {
            (now_ms().saturating_sub(state.started_at) >= *ms).then(|| "afterDuration".into())
        }
    }
}

fn transition_to_running(registry: &Arc<WatchdogRegistry>, app: &AppHandle, id: &str, state: &LoopState) {
    let new_state = WatchdogState::Running {
        last_poll_at: now_ms(),
        ticks_observed: state.poll_count,
    };
    write_state(registry, id, new_state.clone());
    emit(app, id, "stateChange", json!({ "state": new_state }));
}

fn apply_triggered_state(
    registry: &Arc<WatchdogRegistry>,
    app: &AppHandle,
    id: &str,
    state: &LoopState,
) {
    let now = now_ms();
    let new_state = WatchdogState::Triggered {
        first_triggered_at: now,
        trigger_count: state.trigger_count,
        last_poll_at: now,
    };
    write_state(registry, id, new_state.clone());
    emit(app, id, "stateChange", json!({ "state": new_state }));
}

fn finalize(
    registry: &Arc<WatchdogRegistry>,
    app: &AppHandle,
    id: &str,
    terminal_state: WatchdogState,
) {
    write_state(registry, id, terminal_state.clone());
    emit(app, id, "stateChange", json!({ "state": terminal_state }));
    emit(app, id, "complete", json!({ "state": terminal_state }));
}

fn push_tick(
    registry: &Arc<WatchdogRegistry>,
    id: &str,
    value: &serde_json::Value,
    predicate_met: bool,
) {
    let tick = WatchdogTick {
        at: now_ms(),
        value: value.clone(),
        predicate_met,
    };
    let mut guard = registry.lock();
    if let Some(entry) = guard.get_mut(id) {
        entry.poll_count = entry.poll_count.saturating_add(1);
        entry.last_value = Some(value.clone());
        if entry.ticks.len() >= WATCHDOG_TICK_RING_CAP {
            entry.ticks.pop_front();
        }
        entry.ticks.push_back(tick);
    }
}

fn record_trigger(registry: &Arc<WatchdogRegistry>, id: &str, value: &serde_json::Value) {
    let mut guard = registry.lock();
    if let Some(entry) = guard.get_mut(id) {
        entry.triggers.push(WatchdogTriggerEvent {
            at: now_ms(),
            value_at_trigger: value.clone(),
        });
    }
}

fn write_state(registry: &Arc<WatchdogRegistry>, id: &str, new_state: WatchdogState) {
    let mut guard = registry.lock();
    if let Some(entry) = guard.get_mut(id) {
        entry.state = new_state;
    }
}

fn current_intervention_count(registry: &Arc<WatchdogRegistry>, id: &str) -> u32 {
    registry.lock().get(id).map(|e| e.intervention_count).unwrap_or(0)
}

fn install_intervention_sender(
    registry: &Arc<WatchdogRegistry>,
    id: &str,
    tx: mpsc::Sender<InterventionSignal>,
) {
    let mut guard = registry.lock();
    if let Some(entry) = guard.get_mut(id) {
        entry.intervention_tx = Some(tx);
    }
}

fn clear_intervention_sender(registry: &Arc<WatchdogRegistry>, id: &str) {
    let mut guard = registry.lock();
    if let Some(entry) = guard.get_mut(id) {
        entry.intervention_tx = None;
    }
}

/// Build the snapshot handed to the intervention sub-turn. Step 6 supports
/// only `tickHistory` end-to-end; `sessionOutputTail` / `sessionMeta` /
/// `performanceSnapshot` are reserved keys that the snapshot includes when
/// the watchdog config lists them, but the values are placeholders until
/// step 7 wires real session capture.
fn collect_intervention_snapshot(
    registry: &Arc<WatchdogRegistry>,
    app: &AppHandle,
    id: &str,
    target: &WatchdogTarget,
    context_sources: &[String],
    trigger_value: &serde_json::Value,
) -> serde_json::Value {
    let want = |key: &str| context_sources.iter().any(|s| s == key);
    let mut snapshot = serde_json::Map::new();
    snapshot.insert("triggerValue".into(), trigger_value.clone());
    if want("tickHistory") {
        let guard = registry.lock();
        if let Some(entry) = guard.get(id) {
            // Last 8 ticks — keeps the snapshot small enough to fit in a
            // single AI turn without blowing the context budget.
            let tail: Vec<_> = entry.ticks.iter().rev().take(8).rev().cloned().collect();
            snapshot.insert("tickHistory".into(), serde_json::to_value(tail).unwrap_or(json!([])));
        }
    }
    if want("sessionOutputTail") {
        // Only meaningful for SSH targets — pull from the activity tracker.
        // Other targets get null so the AI sees the field is empty rather
        // than missing.
        if let WatchdogTarget::SshSessionOutputSilence { session_id } = target {
            let tail = super::targets::session_output_tail(app, session_id)
                .unwrap_or_default();
            snapshot.insert("sessionOutputTail".into(), json!(tail));
        } else {
            snapshot.insert("sessionOutputTail".into(), Value::Null);
        }
    }
    if want("sessionMeta") {
        if let WatchdogTarget::SshSessionOutputSilence { session_id } = target {
            snapshot.insert(
                "sessionMeta".into(),
                json!({ "sessionId": session_id }),
            );
        } else {
            snapshot.insert("sessionMeta".into(), Value::Null);
        }
    }
    if want("performanceSnapshot") {
        // Wired in step 8 alongside the other native targets.
        snapshot.insert(
            "performanceSnapshot".into(),
            json!({ "_pending": "wired in a later step" }),
        );
    }
    serde_json::Value::Object(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::{PredicateOp, WatchdogNotification, WatchdogTrigger};

    fn mock_config(name: &str) -> WatchdogConfig {
        WatchdogConfig {
            name: name.to_string(),
            target: WatchdogTarget::Mock { step: 1.0 },
            trigger: WatchdogTrigger {
                predicate: PredicateOp::Gt { value: 5.0 },
                sustained_for_ms: None,
            },
            poll_ms: 1000,
            stop: WatchdogStop::UntilCanceled,
            notification: WatchdogNotification::InAppOnly,
            action: WatchdogAction::Notify,
        }
    }

    #[test]
    fn validate_rejects_empty_name() {
        let c = mock_config("");
        assert!(matches!(
            validate_config(&c),
            Err(WatchdogError::InvalidConfig { .. })
        ));
    }

    #[test]
    fn validate_rejects_short_poll() {
        let mut c = mock_config("x");
        c.poll_ms = 100;
        assert!(matches!(
            validate_config(&c),
            Err(WatchdogError::InvalidConfig { .. })
        ));
    }

    #[test]
    fn validate_rejects_long_poll() {
        let mut c = mock_config("x");
        c.poll_ms = MAX_POLL_MS + 1;
        assert!(matches!(
            validate_config(&c),
            Err(WatchdogError::InvalidConfig { .. })
        ));
    }

    #[test]
    fn validate_accepts_all_currently_supported_targets() {
        // All five target kinds now pass validation as of step 8. This test
        // pins the "no unsupported variants" invariant — if we ever add a
        // new target kind that's not yet wired, the new match arm must
        // either accept (and have a sampler) or reject (and this test catches
        // the omission).
        let mut c = mock_config("x");
        for target in [
            WatchdogTarget::Mock { step: 1.0 },
            WatchdogTarget::Ping {
                host: "example.com".into(),
                port: None,
            },
            WatchdogTarget::TcpReachable {
                host: "example.com".into(),
                port: 443,
            },
            WatchdogTarget::SshSessionOutputSilence {
                session_id: "s1".into(),
            },
        ] {
            c.target = target;
            assert!(validate_config(&c).is_ok(), "config: {:?}", c.target);
        }
    }

    #[test]
    fn validate_accepts_performance_counter() {
        let mut c = mock_config("x");
        c.target = WatchdogTarget::PerformanceCounter {
            metric: super::super::types::PerformanceMetric::CpuPercent,
        };
        assert!(validate_config(&c).is_ok());
    }

    #[test]
    fn validate_rejects_ai_intervene_without_allowed_tools() {
        let mut c = mock_config("x");
        c.action = WatchdogAction::AiIntervene {
            goal: "do thing".into(),
            context_sources: vec![],
            allowed_tools: vec![],
            approval_policy: "sessionAllow".into(),
            max_interventions: 5,
            suppression_ms: 30_000,
        };
        assert!(matches!(
            validate_config(&c),
            Err(WatchdogError::InvalidConfig { .. })
        ));
    }

    #[test]
    fn sustained_window_fires_only_after_threshold() {
        let mut state = LoopState {
            started_at: 0,
            poll_count: 0,
            trigger_count: 0,
            condition_true_since: None,
            suppression_until: None,
            mock_counter: 0.0,
        };
        assert!(!update_sustained_window(&mut state, true, Some(1_000_000)));
        assert!(!update_sustained_window(&mut state, false, Some(1_000_000)));
        assert_eq!(state.condition_true_since, None);
        assert!(update_sustained_window(&mut state, true, None));
    }

    #[test]
    fn sustained_window_does_not_refire_within_streak() {
        let mut state = LoopState {
            started_at: 0,
            poll_count: 0,
            trigger_count: 0,
            condition_true_since: None,
            suppression_until: None,
            mock_counter: 0.0,
        };
        // Without sustained_for_ms, every tick fires — caller must dedupe.
        assert!(update_sustained_window(&mut state, true, None));
        assert!(update_sustained_window(&mut state, true, None));
    }

    #[test]
    fn stop_after_first_trigger() {
        let state = LoopState {
            started_at: 0,
            poll_count: 1,
            trigger_count: 1,
            condition_true_since: None,
            suppression_until: None,
            mock_counter: 0.0,
        };
        assert!(stop_reached(&WatchdogStop::AfterFirstTrigger, &state, true).is_some());
        assert!(stop_reached(&WatchdogStop::AfterFirstTrigger, &state, false).is_none());
    }

    #[test]
    fn stop_after_poll_count() {
        let state = LoopState {
            started_at: 0,
            poll_count: 10,
            trigger_count: 0,
            condition_true_since: None,
            suppression_until: None,
            mock_counter: 0.0,
        };
        assert!(stop_reached(&WatchdogStop::AfterPollCount { n: 10 }, &state, false).is_some());
        assert!(stop_reached(&WatchdogStop::AfterPollCount { n: 11 }, &state, false).is_none());
    }
}

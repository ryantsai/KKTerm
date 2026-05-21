//! AI Watchdog feature — session-scoped, multi-instance, sensor + actor loop.
//!
//! Architecture (see design notes in commit history):
//! - Rust owns: registry, polling, predicate evaluation, sustained-window
//!   tracking, stop-condition arbitration, event emission. In-memory only;
//!   nothing persists across app restart.
//! - JS owns: status bar UI, AI intervention sub-turn (model inference,
//!   tool calls), `watchdog_record_intervention` callback.
//!
//! Events flow over a single channel (`watchdog://event`) so the frontend
//! has one subscription point, mirroring `net::commands::EVENT_CHANNEL`.

pub mod catalog;
pub mod commands;
pub mod registry;
pub mod session_activity;
pub mod targets;
pub mod types;

pub use session_activity::SessionActivityTracker;

use serde::Serialize;

pub use registry::WatchdogRegistry;

/// Hard cap on concurrently active watchdogs in this process. Above this
/// the registry refuses `create`. Cap is high enough for reasonable use but
/// low enough that a runaway AI cannot spawn unbounded tokio tasks.
pub const MAX_CONCURRENT_WATCHDOGS: usize = 16;

/// Floor on poll interval. Tighter polls overwhelm the renderer with events
/// and burn battery; the AI is instructed not to request below this.
pub const MIN_POLL_MS: u64 = 500;

/// Ceiling on poll interval (1 hour). Anything longer should be a scheduled
/// job, not a watchdog.
pub const MAX_POLL_MS: u64 = 60 * 60 * 1000;

/// Per-watchdog tick ring buffer cap. Older ticks roll off.
pub const WATCHDOG_TICK_RING_CAP: usize = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WatchdogError {
    CapacityExceeded,
    NotFound,
    InvalidConfig { reason: String },
    /// Reserved for staged rollouts where a new `WatchdogTarget` variant
    /// is added to the schema before its sampler ships — validators can
    /// return this until the wiring completes. Currently no variants are
    /// in that state.
    #[allow(dead_code)]
    UnsupportedTarget { reason: String },
    AlreadyTerminal,
    /// Reserved for step 7+ target dispatchers that can fail at sample time
    /// (network unreachable, SSH session gone, etc.).
    #[allow(dead_code)]
    Internal { reason: String },
}

impl WatchdogError {
    pub fn invalid(reason: impl Into<String>) -> Self {
        Self::InvalidConfig {
            reason: reason.into(),
        }
    }
    #[allow(dead_code)] // paired with `UnsupportedTarget`; see above
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self::UnsupportedTarget {
            reason: reason.into(),
        }
    }
    #[allow(dead_code)] // used by step 7+ target dispatchers
    pub fn internal(reason: impl Into<String>) -> Self {
        Self::Internal {
            reason: reason.into(),
        }
    }
}

/// Monotonic-ish unique watchdog id. Combines timestamp + per-process counter
/// so back-to-back creations in the same millisecond don't collide.
pub fn new_watchdog_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("wd-{ts}-{seq}")
}

/// Runtime allow-list check. Step 6's intervention runner calls this before
/// every tool invocation. Centralized here (not inline) so the policy is
/// independently testable and the same rule applies whether the call comes
/// from the intervention sub-turn or a future debug/replay code path.
#[allow(dead_code)] // wired by step 6 intervention runner
pub fn check_allowed_tool(allowed: &[String], tool_name: &str) -> bool {
    allowed.iter().any(|t| t == tool_name)
}

pub fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Pure-function predicate evaluator. Extracted so trigger logic is
/// independently testable without spinning up tokio tasks.
pub fn evaluate_predicate(op: &types::PredicateOp, value: &serde_json::Value) -> bool {
    use types::PredicateOp;
    match op {
        PredicateOp::Gt { value: v } => value.as_f64().map(|n| n > *v).unwrap_or(false),
        PredicateOp::Lt { value: v } => value.as_f64().map(|n| n < *v).unwrap_or(false),
        PredicateOp::Gte { value: v } => value.as_f64().map(|n| n >= *v).unwrap_or(false),
        PredicateOp::Lte { value: v } => value.as_f64().map(|n| n <= *v).unwrap_or(false),
        PredicateOp::Eq { value: v } => value
            .as_f64()
            .map(|n| (n - *v).abs() < f64::EPSILON)
            .unwrap_or(false),
        PredicateOp::Ne { value: v } => value
            .as_f64()
            .map(|n| (n - *v).abs() >= f64::EPSILON)
            .unwrap_or(false),
        PredicateOp::Contains { value: needle } => value
            .as_str()
            .map(|haystack| haystack.contains(needle))
            .unwrap_or(false),
        // SilenceFor expects the sampler to have produced the elapsed-since-
        // last-activity duration as a numeric value. The
        // `sshSessionOutputSilence` target does exactly this. Predicate
        // fires when elapsed >= threshold.
        PredicateOp::SilenceFor { ms: threshold } => value
            .as_u64()
            .map(|elapsed| elapsed >= *threshold)
            .unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use types::PredicateOp;

    #[test]
    fn gt_compares_numerics() {
        assert!(evaluate_predicate(&PredicateOp::Gt { value: 90.0 }, &json!(95)));
        assert!(!evaluate_predicate(&PredicateOp::Gt { value: 90.0 }, &json!(80)));
    }

    #[test]
    fn gt_returns_false_for_non_numeric() {
        assert!(!evaluate_predicate(&PredicateOp::Gt { value: 1.0 }, &json!("abc")));
    }

    #[test]
    fn contains_matches_substring() {
        assert!(evaluate_predicate(
            &PredicateOp::Contains { value: "stalled".to_string() },
            &json!("process stalled at line 12"),
        ));
    }

    #[test]
    fn silence_for_fires_when_elapsed_exceeds_threshold() {
        // Sampler produces elapsed-ms; predicate fires when at or past threshold.
        assert!(evaluate_predicate(
            &PredicateOp::SilenceFor { ms: 60_000 },
            &json!(60_000_u64),
        ));
        assert!(evaluate_predicate(
            &PredicateOp::SilenceFor { ms: 60_000 },
            &json!(120_000_u64),
        ));
        assert!(!evaluate_predicate(
            &PredicateOp::SilenceFor { ms: 60_000 },
            &json!(30_000_u64),
        ));
        // Null sample (session never spoke) returns false — don't trigger
        // until we've seen at least one byte.
        assert!(!evaluate_predicate(
            &PredicateOp::SilenceFor { ms: 60_000 },
            &json!(null),
        ));
    }

    #[test]
    fn id_generator_avoids_same_ms_collision() {
        let a = new_watchdog_id();
        let b = new_watchdog_id();
        assert_ne!(a, b);
    }

    #[test]
    fn allow_list_blocks_unknown_tools() {
        let allowed: Vec<String> = vec!["session_send_text".into(), "session_state".into()];
        assert!(check_allowed_tool(&allowed, "session_send_text"));
        assert!(!check_allowed_tool(&allowed, "session_kill"));
        assert!(!check_allowed_tool(&allowed, ""));
    }

    #[test]
    fn allow_list_is_exact_match_not_prefix() {
        let allowed: Vec<String> = vec!["session_send".into()];
        // Without exact matching, "session_send_text" would slip through —
        // catching this protects against future tool additions silently
        // widening an allow-list.
        assert!(!check_allowed_tool(&allowed, "session_send_text"));
    }
}

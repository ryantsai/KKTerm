//! Per-target-kind samplers.
//!
//! Each sampler is responsible for taking one observation. They run inside
//! the per-watchdog tokio task and must be cheap; long-running work (network
//! probes etc.) should use `tokio::task::spawn_blocking` or async I/O — never
//! block the poll loop directly because that delays cancellation.
//!
//! Step 2 adds the PerformanceCounter sampler. Mock is dispatched inline in
//! the registry. Future steps (ping, sshSessionOutputSilence) will add
//! samplers here.

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::performance::PerformanceMonitor;

use super::session_activity::SessionActivityTracker;
use super::{now_ms, types::PerformanceMetric};

/// Take a single PerformanceCounter sample. Returns `Value::Null` for
/// metrics that the underlying monitor cannot report (first-tick rates,
/// unsupported platform).
///
/// The snapshot is roundtripped through JSON rather than reading struct
/// fields directly so this module doesn't have to track changes in
/// `performance.rs`'s field set. Cost: one allocation per poll.
pub fn sample_performance_counter(app: &AppHandle, metric: PerformanceMetric) -> Value {
    let Some(monitor) = app.try_state::<PerformanceMonitor>() else {
        return Value::Null;
    };
    let snapshot = monitor.system_performance_counters_snapshot();
    let json = serde_json::to_value(&snapshot).unwrap_or(Value::Null);
    extract_metric(&json, metric)
}

/// Pure: extract one metric from a JSON-serialized
/// `SystemPerformanceCountersSnapshot`. Tested independently with synthetic
/// snapshots — no Tauri runtime required.
pub fn extract_metric(snapshot: &Value, metric: PerformanceMetric) -> Value {
    match metric {
        PerformanceMetric::CpuPercent => field(snapshot, "cpuPercent"),
        PerformanceMetric::RamPercent => field(snapshot, "ramPercent"),
        PerformanceMetric::CommitPercent => field(snapshot, "commitPercent"),
        PerformanceMetric::DiskFreePercent => field(snapshot, "systemDriveFreePercent"),
        // Virtual: users say "disk over 85%" meaning *used*, but the monitor
        // only reports free. Compute the complement when free is known.
        PerformanceMetric::DiskUsedPercent => snapshot
            .get("systemDriveFreePercent")
            .and_then(|v| v.as_f64())
            .map(|free| Value::from(100.0 - free))
            .unwrap_or(Value::Null),
        PerformanceMetric::NetworkDownBytesPerSec => {
            field(snapshot, "networkDownstreamBytesPerSecond")
        }
        PerformanceMetric::NetworkUpBytesPerSec => field(snapshot, "networkUpstreamBytesPerSecond"),
        PerformanceMetric::AppWorkingSetBytes => field(snapshot, "appWorkingSetBytes"),
        PerformanceMetric::AppPrivateBytes => field(snapshot, "appPrivateBytes"),
        PerformanceMetric::HandleCount => field(snapshot, "handleCount"),
        PerformanceMetric::ProcessCount => field(snapshot, "processCount"),
        PerformanceMetric::ThreadCount => field(snapshot, "threadCount"),
    }
}

fn field(snapshot: &Value, key: &str) -> Value {
    snapshot.get(key).cloned().unwrap_or(Value::Null)
}

/// Sample for `sshSessionOutputSilence` — returns milliseconds since the
/// last terminal byte from this session.
///
/// Behavior when the session has never reported activity (never opened, or
/// just opened with no output yet): returns Value::Null, which makes
/// `SilenceFor` not match — we don't want to fire just because we haven't
/// seen first output yet. Once the session has any byte, subsequent silence
/// is measured from that timestamp.
pub fn sample_ssh_session_silence(app: &AppHandle, session_id: &str) -> Value {
    let Some(tracker) = app.try_state::<std::sync::Arc<SessionActivityTracker>>() else {
        return Value::Null;
    };
    let Some(last) = tracker.last_activity_at(session_id) else {
        return Value::Null;
    };
    let elapsed = now_ms().saturating_sub(last);
    Value::from(elapsed)
}

/// Fetch the trailing output bytes for `sessionOutputTail` context. Used by
/// the snapshot collector when an intervention sub-turn requests it.
pub fn session_output_tail(app: &AppHandle, session_id: &str) -> Option<String> {
    app.try_state::<std::sync::Arc<SessionActivityTracker>>()
        .and_then(|tracker| tracker.tail(session_id))
}

/// TCP-based "is host up" check. Returns 1.0 if a TCP connect succeeds to
/// `port` (default 80) within the timeout, 0.0 otherwise. We use TCP instead
/// of ICMP because ICMP needs OS-level privilege on Windows and is often
/// blocked by firewalls — a TCP probe gives a comparable liveness signal
/// without those caveats.
pub async fn sample_ping(host: &str, port: Option<u16>) -> Value {
    let target_port = port.unwrap_or(80);
    let result = crate::net::scan::tcp_check(host, target_port, Some(2000)).await;
    Value::from(if result.open { 1.0 } else { 0.0 })
}

/// Open/closed check for a specific TCP port.
pub async fn sample_tcp_reachable(host: &str, port: u16) -> Value {
    let result = crate::net::scan::tcp_check(host, port, Some(2000)).await;
    Value::from(if result.open { 1.0 } else { 0.0 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fake_snapshot() -> Value {
        json!({
            "cpuPercent": 42.5,
            "ramPercent": 70.0,
            "commitPercent": 60.0,
            "systemDriveFreePercent": 30.0,
            "networkDownstreamBytesPerSecond": 1_000_000.0,
            "networkUpstreamBytesPerSecond": 50_000.0,
            "appWorkingSetBytes": 200_000_000_u64,
            "handleCount": 1234,
            "processCount": 250,
            "threadCount": 3500
        })
    }

    #[test]
    fn extracts_simple_metric() {
        assert_eq!(extract_metric(&fake_snapshot(), PerformanceMetric::CpuPercent), json!(42.5));
        assert_eq!(extract_metric(&fake_snapshot(), PerformanceMetric::RamPercent), json!(70.0));
        assert_eq!(extract_metric(&fake_snapshot(), PerformanceMetric::HandleCount), json!(1234));
    }

    #[test]
    fn disk_used_is_complement_of_free() {
        // 30% free → 70% used. Matches the user's natural "disk over 85%" phrasing.
        assert_eq!(
            extract_metric(&fake_snapshot(), PerformanceMetric::DiskUsedPercent),
            json!(70.0)
        );
    }

    #[test]
    fn missing_field_yields_null() {
        let empty = json!({});
        assert_eq!(extract_metric(&empty, PerformanceMetric::CpuPercent), Value::Null);
        assert_eq!(extract_metric(&empty, PerformanceMetric::DiskUsedPercent), Value::Null);
    }

    #[test]
    fn null_field_yields_null_not_panic() {
        // First-tick CPU is null until two samples have been taken.
        let snapshot = json!({ "cpuPercent": Value::Null });
        assert_eq!(extract_metric(&snapshot, PerformanceMetric::CpuPercent), Value::Null);
    }
}

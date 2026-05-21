//! Tracks terminal-output activity per SSH/local session so the watchdog's
//! `sshSessionOutputSilence` target can measure idle time.
//!
//! Owned by the watchdog module (not sessions.rs) because:
//! - It's read by watchdog target samplers — keeping ownership there avoids
//!   a circular dependency.
//! - It's an opt-in observation surface; sessions.rs's job is to *be* a
//!   terminal, not to record its own metadata for other features.
//!
//! The session manager calls `record(...)` from each terminal-output emit
//! site. Cheap (one Mutex lock + tiny ring-buffer push) so it's safe in
//! the hot path.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use super::now_ms;

/// Per-session ring-buffer cap on captured tail bytes. Sized for "last few
/// screens" of terminal output — large enough to give an intervention
/// sub-turn enough context to identify a stalled CLI, small enough that
/// even hundreds of busy sessions cost only a few MB.
const TAIL_BYTES_CAP: usize = 8 * 1024;

/// Per-session entry. Plain struct under a single Mutex<HashMap> — keeps the
/// activity write path branch-free without async channels.
struct SessionActivity {
    last_activity_at: u64,
    /// Trailing bytes from the terminal stream. Capped at TAIL_BYTES_CAP;
    /// older bytes roll off the front. Bytes (not lines) because terminal
    /// output is binary-ish (ANSI escapes etc.) and the intervention sub-turn
    /// receives it as raw text for the model to interpret.
    tail: VecDeque<u8>,
}

#[derive(Default)]
pub struct SessionActivityTracker {
    inner: Mutex<HashMap<String, SessionActivity>>,
}

impl SessionActivityTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one chunk of terminal output. Updates `last_activity_at` and
    /// appends to the ring buffer. Silent on lock poisoning — the watchdog
    /// will just see stale data and (correctly) fire a silence trigger.
    pub fn record(&self, session_id: &str, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        let Ok(mut guard) = self.inner.lock() else {
            return;
        };
        let entry = guard
            .entry(session_id.to_string())
            .or_insert_with(|| SessionActivity {
                last_activity_at: 0,
                tail: VecDeque::with_capacity(TAIL_BYTES_CAP),
            });
        entry.last_activity_at = now_ms();
        // Push new bytes, then trim the front to cap.
        entry.tail.extend(data.iter().copied());
        let overflow = entry.tail.len().saturating_sub(TAIL_BYTES_CAP);
        if overflow > 0 {
            entry.tail.drain(..overflow);
        }
    }

    /// Last terminal output time in ms-since-epoch. Returns None if the
    /// session has never reported activity (created but no first byte yet).
    pub fn last_activity_at(&self, session_id: &str) -> Option<u64> {
        self.inner
            .lock()
            .ok()
            .and_then(|guard| guard.get(session_id).map(|e| e.last_activity_at))
    }

    /// Tail as a String (lossy UTF-8 — terminal output may contain partial
    /// multibyte sequences at the ring-buffer edges; lossy avoids panic).
    pub fn tail(&self, session_id: &str) -> Option<String> {
        let guard = self.inner.lock().ok()?;
        let entry = guard.get(session_id)?;
        let bytes: Vec<u8> = entry.tail.iter().copied().collect();
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Forget a session — should be called by the session manager when a
    /// terminal closes so the map doesn't grow unboundedly across the app
    /// lifetime. Not yet wired: `close_terminal_session` doesn't carry an
    /// AppHandle. Each entry is small (~8KB), and sessions per process are
    /// bounded, so cleanup is a polish task rather than a leak.
    #[allow(dead_code)]
    pub fn forget(&self, session_id: &str) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.remove(session_id);
        }
    }

    #[cfg(test)]
    pub fn known_session_ids(&self) -> Vec<String> {
        self.inner
            .lock()
            .map(|guard| guard.keys().cloned().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_updates_last_activity() {
        let t = SessionActivityTracker::new();
        assert_eq!(t.last_activity_at("s1"), None);
        t.record("s1", b"hello");
        let at = t.last_activity_at("s1").expect("should have activity");
        assert!(at > 0);
    }

    #[test]
    fn tail_respects_cap_and_drops_oldest() {
        let t = SessionActivityTracker::new();
        // Push more than the cap; only the trailing TAIL_BYTES_CAP should remain.
        let big = vec![b'a'; TAIL_BYTES_CAP + 64];
        t.record("s1", &big);
        let tail = t.tail("s1").expect("tail should exist");
        assert_eq!(tail.len(), TAIL_BYTES_CAP);
    }

    #[test]
    fn forget_removes_session() {
        let t = SessionActivityTracker::new();
        t.record("s1", b"x");
        t.forget("s1");
        assert!(t.last_activity_at("s1").is_none());
    }

    #[test]
    fn empty_record_is_noop() {
        let t = SessionActivityTracker::new();
        t.record("s1", b"");
        assert!(t.last_activity_at("s1").is_none());
    }
}

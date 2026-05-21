//! Single source of truth for the watchdog's supported pattern catalog.
//!
//! ## What lives here
//!
//! Each supported target variant has one `TargetDescriptor` entry below.
//! Both the AI Assistant's JSON schema (`ai.rs::watchdog_create_schema`) and
//! the natural-language `WATCHDOG_INTENT_CONTRACT` system prompt are
//! generated from this catalog — so adding a new pattern requires updating
//! only one place for the AI-facing surface.
//!
//! ## How to add a new pattern
//!
//! 1. Add the variant to `WatchdogTarget` in `types.rs`.
//! 2. Add a sampler in `targets.rs` (sync or async — `sample_target`
//!    awaits where needed).
//! 3. Add a dispatch arm in `registry.rs::sample_target` for the new variant.
//! 4. Add the variant to `registry.rs::validate_config`'s accept list
//!    (compiler-enforced exhaustiveness; tests catch omissions).
//! 5. **Add one `TargetDescriptor` entry below.** That single entry feeds
//!    the JSON schema *and* the system prompt — no other AI-facing files
//!    need touching.
//! 6. If the pattern populates extra snapshot context (e.g. session output
//!    tail), extend `registry.rs::collect_intervention_snapshot` accordingly.
//! 7. Add at least one natural-language example to `ai.watchdogExamples`
//!    in `src/i18n/locales/en.json` so the composer chips advertise it.
//!
//! The catalog is order-stable: descriptors appear here in the order the
//! AI should consider them (most-common first), which is also the order
//! they appear in the generated schema's `oneOf`.

use serde_json::{json, Value};

/// One row in the catalog. Used by the schema generator AND the system
/// prompt builder, so descriptions read both as machine-readable docs and
/// as natural-language hints for the LLM.
pub struct TargetDescriptor {
    /// Discriminator value (matches the `#[serde(tag = "kind")]` rename of
    /// `WatchdogTarget`). Must be camelCase.
    pub kind: &'static str,

    /// One-line title used in the system prompt's catalog summary.
    pub display_name: &'static str,

    /// What this pattern observes, in one or two sentences. Read by the LLM
    /// — write it as if explaining the feature to a new user.
    pub description: &'static str,

    /// Recommended predicate shape (e.g. "gt with a numeric threshold").
    /// Helps the AI pick the right op without guessing.
    pub typical_predicate: &'static str,

    /// Guidance on `sustainedForMs` — when it's important and the typical
    /// range. Pass "n/a" if not applicable (e.g. silenceFor builds the
    /// threshold into the predicate itself).
    pub typical_sustained: &'static str,

    /// Example natural-language request that maps to this pattern. Used in
    /// the system prompt to teach the AI by example.
    pub example_request: &'static str,

    /// Function returning the JSON schema fragment for this target variant.
    /// Will be inlined into the `target.oneOf` of `watchdog_create_schema`.
    pub schema_fragment: fn() -> Value,
}

/// Full catalog of currently-supported targets. Order = AI's preferred
/// consideration order (most common first).
pub fn target_catalog() -> Vec<TargetDescriptor> {
    vec![
        TargetDescriptor {
            kind: "performanceCounter",
            display_name: "Performance counter",
            description: "Reads a low-overhead local system metric (CPU, RAM, disk, network, app process counters). Returns the metric value as a number; first sample for rate-based metrics may be null.",
            typical_predicate: "gt or lt against a numeric threshold (e.g. cpuPercent > 90)",
            typical_sustained: "60_000–300_000 ms (1–5 min) on threshold triggers to ride out brief spikes",
            example_request: "alert when CPU over 90% for 5 min",
            schema_fragment: schema_performance_counter,
        },
        TargetDescriptor {
            kind: "sshSessionOutputSilence",
            display_name: "SSH session output silence",
            description: "Watches a live terminal session; samples the milliseconds since its last terminal byte. Fires when output has been silent for the configured duration — useful for catching stalled CLIs like codex.",
            typical_predicate: "silenceFor { ms: <silence threshold> }",
            typical_sustained: "n/a — the silence threshold is built into silenceFor",
            example_request: "watch my codex CLI session — nudge it if silent for 60 seconds",
            schema_fragment: schema_ssh_session_output_silence,
        },
        TargetDescriptor {
            kind: "ping",
            display_name: "Host reachability (TCP probe)",
            description: "TCP-probe-based liveness check (defaults to port 80). Returns 1.0 if a TCP connect succeeds within 2 s, 0.0 otherwise. ICMP ping needs OS privileges and is often firewalled — TCP probe is the modern equivalent.",
            typical_predicate: "eq with value 0 to fire when host stops answering",
            typical_sustained: "~30_000 ms to absorb flaky network blips",
            example_request: "ping my-server.example.com — alert if it goes offline",
            schema_fragment: schema_ping,
        },
        TargetDescriptor {
            kind: "tcpReachable",
            display_name: "TCP port reachable",
            description: "Check whether a specific TCP port is accepting connections on a host. Returns 1.0 if open, 0.0 if closed/timing out. Good for HTTPS, SSH, database, application port monitors.",
            typical_predicate: "eq with value 0 (port closed) or value 1 (port open) depending on intent",
            typical_sustained: "30_000–60_000 ms",
            example_request: "alert if port 443 on api.example.com closes",
            schema_fragment: schema_tcp_reachable,
        },
        TargetDescriptor {
            kind: "mock",
            display_name: "Mock counter (testing)",
            description: "Emits an incrementing counter each poll. Reserved for testing the watchdog pipeline — do not surface to end users unless they explicitly ask for a test/demo watchdog.",
            typical_predicate: "gt against a small integer threshold",
            typical_sustained: "0 (immediate)",
            example_request: "create a test watchdog that fires after 10 ticks",
            schema_fragment: schema_mock,
        },
    ]
}

/// Render a compact catalog summary for the system prompt. Returns a single
/// pre-formatted string like:
///
/// ```text
/// performanceCounter — Reads a low-overhead… Predicate: gt/lt … Example: alert when…
/// sshSessionOutputSilence — Watches a live terminal session… Predicate: silenceFor … Example: …
/// ```
pub fn target_catalog_prompt_section() -> String {
    target_catalog()
        .iter()
        .map(|d| {
            format!(
                "  • {kind} ({name}): {desc} Typical predicate: {pred}. Sustain: {sustain}. Example: \"{example}\".",
                kind = d.kind,
                name = d.display_name,
                desc = d.description,
                pred = d.typical_predicate,
                sustain = d.typical_sustained,
                example = d.example_request,
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// --- per-target schema fragments. ----------------------------------------
//
// Keep these as fn pointers (not closures) so the catalog vec can be
// constructed at any time without allocating. Each returns a complete JSON
// schema object for one target variant; the schema generator inlines them
// into the top-level `oneOf`.

fn schema_performance_counter() -> Value {
    json!({
        "type": "object",
        "properties": {
            "kind": { "const": "performanceCounter" },
            "metric": {
                "type": "string",
                "enum": [
                    "cpuPercent", "ramPercent", "commitPercent",
                    "diskFreePercent", "diskUsedPercent",
                    "networkDownBytesPerSec", "networkUpBytesPerSec",
                    "appWorkingSetBytes", "appPrivateBytes",
                    "handleCount", "processCount", "threadCount"
                ]
            }
        },
        "required": ["kind", "metric"]
    })
}

fn schema_ssh_session_output_silence() -> Value {
    json!({
        "type": "object",
        "properties": {
            "kind": { "const": "sshSessionOutputSilence" },
            "sessionId": {
                "type": "string",
                "description": "Live terminal session id. Discover via session_state before calling."
            }
        },
        "required": ["kind", "sessionId"]
    })
}

fn schema_ping() -> Value {
    json!({
        "type": "object",
        "properties": {
            "kind": { "const": "ping" },
            "host": { "type": "string" },
            "port": {
                "type": "integer",
                "minimum": 1,
                "maximum": 65535,
                "description": "Optional. Defaults to 80."
            }
        },
        "required": ["kind", "host"]
    })
}

fn schema_tcp_reachable() -> Value {
    json!({
        "type": "object",
        "properties": {
            "kind": { "const": "tcpReachable" },
            "host": { "type": "string" },
            "port": { "type": "integer", "minimum": 1, "maximum": 65535 }
        },
        "required": ["kind", "host", "port"]
    })
}

fn schema_mock() -> Value {
    json!({
        "type": "object",
        "properties": {
            "kind": { "const": "mock" },
            "step": { "type": "number" }
        },
        "required": ["kind"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_kinds_are_unique_and_camel_case() {
        let kinds: Vec<&str> = target_catalog().iter().map(|d| d.kind).collect();
        let mut seen = std::collections::HashSet::new();
        for k in &kinds {
            assert!(seen.insert(*k), "duplicate kind: {}", k);
            assert!(
                k.chars().next().is_some_and(|c| c.is_ascii_lowercase()),
                "kind must be camelCase: {}",
                k
            );
            assert!(
                !k.contains('_') && !k.contains('-'),
                "kind must be camelCase: {}",
                k
            );
        }
    }

    #[test]
    fn catalog_schema_fragments_have_const_kind() {
        // Pin the invariant: every schema fragment must constrain `kind` to
        // the catalog's `kind` value, so the AI can't ship a fragment that
        // doesn't match its discriminator.
        for d in target_catalog() {
            let frag = (d.schema_fragment)();
            let const_kind = frag
                .pointer("/properties/kind/const")
                .and_then(|v| v.as_str())
                .expect("schema fragment missing const kind");
            assert_eq!(const_kind, d.kind, "kind mismatch in fragment for {}", d.kind);
        }
    }

    #[test]
    fn prompt_section_mentions_every_kind() {
        let text = target_catalog_prompt_section();
        for d in target_catalog() {
            assert!(text.contains(d.kind), "prompt section missing {}", d.kind);
            assert!(
                text.contains(d.example_request),
                "prompt section missing example for {}",
                d.kind
            );
        }
    }

    #[test]
    fn catalog_matches_watchdog_target_variants() {
        // If a new variant is added to WatchdogTarget without a catalog
        // entry, this test catches it (or vice versa).
        use crate::watchdog::types::WatchdogTarget;
        // Enumerate by building instances of each known variant; the
        // catalog must cover the same set of kinds.
        let known_variants = [
            WatchdogTarget::Mock { step: 1.0 },
            WatchdogTarget::PerformanceCounter {
                metric: crate::watchdog::types::PerformanceMetric::CpuPercent,
            },
            WatchdogTarget::SshSessionOutputSilence {
                session_id: "x".into(),
            },
            WatchdogTarget::Ping {
                host: "x".into(),
                port: None,
            },
            WatchdogTarget::TcpReachable {
                host: "x".into(),
                port: 80,
            },
        ];
        let variant_kinds: std::collections::HashSet<String> = known_variants
            .iter()
            .map(|t| serde_json::to_value(t).unwrap()["kind"].as_str().unwrap().to_string())
            .collect();
        let catalog_kinds: std::collections::HashSet<String> =
            target_catalog().iter().map(|d| d.kind.to_string()).collect();
        assert_eq!(
            variant_kinds, catalog_kinds,
            "catalog kinds out of sync with WatchdogTarget variants"
        );
    }
}

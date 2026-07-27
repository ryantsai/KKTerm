// IT Ops Automation commands + runtime (docs/ITOPS.md Phase 3). An Automation is
// the durable definition; the live Watchdog is its runtime. Enabling an
// Automation arms a Watchdog in the existing WatchdogRegistry; disabling cancels
// it. Enabled Automations are re-armed at launch by `hydrate_automations`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State};

use crate::watchdog::WatchdogRegistry;
use crate::watchdog::evaluate_predicate;
use crate::watchdog::targets;
use crate::watchdog::types::{WatchdogConfig, WatchdogTarget};

use super::automation_storage as auto_store;
use super::ids::new_itops_id;
use super::types::{Automation, AutomationAction};

/// In-memory map from a durable Automation to its live Watchdog id. Live state
/// only — never persisted (the durable definition is the Automation row).
#[derive(Default)]
pub struct ItopsAutomationRuntime {
    armed: Mutex<HashMap<String, String>>,
}

impl ItopsAutomationRuntime {
    /// Arm (or re-arm) an Automation: cancel any existing live Watchdog for it,
    /// then create a fresh one from its config.
    pub fn arm(
        &self,
        app: &AppHandle,
        registry: &Arc<WatchdogRegistry>,
        automation: &Automation,
    ) -> Result<(), String> {
        self.disarm(registry, &automation.id);
        let mut config = automation.config.clone();
        config.name = automation.name.clone(); // keep the Watchdog label in sync
        // Durable IT Ops Monitors are level-triggered: while their condition
        // remains true, run the ordered action list once per configured poll.
        // Standalone AI Watchdogs retain the safer rising-edge default.
        config.trigger.repeat_while_true = true;
        let summary = WatchdogRegistry::create(registry, app, config)
            .map_err(|error| format!("{error:?}"))?;
        self.armed
            .lock()
            .unwrap()
            .insert(automation.id.clone(), summary.id);
        Ok(())
    }

    pub fn disarm(&self, registry: &Arc<WatchdogRegistry>, automation_id: &str) {
        if let Some(watchdog_id) = self.armed.lock().unwrap().remove(automation_id) {
            let _ = registry.cancel(&watchdog_id);
        }
    }

    /// Which Automation owns this live Watchdog (reverse of the armed map). Used
    /// by the action executor to find the action list when a Watchdog fires.
    pub fn automation_for_watchdog(&self, watchdog_id: &str) -> Option<String> {
        self.armed
            .lock()
            .unwrap()
            .iter()
            .find_map(|(automation_id, armed_watchdog)| {
                (armed_watchdog == watchdog_id).then(|| automation_id.clone())
            })
    }

    fn armed_automation_ids(&self) -> Vec<String> {
        self.armed.lock().unwrap().keys().cloned().collect()
    }
}

/// Install the WatchdogRegistry trigger hook so a firing Watchdog runs its
/// Automation's action list. Called once at startup.
pub fn install_trigger_hook(app: &AppHandle) {
    let registry = app.state::<Arc<WatchdogRegistry>>();
    let hook_app = app.clone();
    registry.set_trigger_hook(Arc::new(
        move |watchdog_id: &str, value: &serde_json::Value| {
            super::actions::on_watchdog_trigger(&hook_app, watchdog_id, value);
        },
    ));
}

fn storage(app: &AppHandle) -> State<'_, crate::storage::Storage> {
    app.state::<crate::storage::Storage>()
}

/// Re-arm every enabled Automation into the live WatchdogRegistry at launch.
/// Runs on the async runtime so the Watchdog poll tasks spawn in a tokio context.
pub fn hydrate_automations(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        reconcile_automations(&app);
    });
}

/// Match the live Watchdog runtimes to the durable Automation rows. Selective
/// import calls this after committing IT Ops data so removed rules stop and
/// newly imported enabled rules begin without waiting for an app restart.
pub fn reconcile_automations(app: &AppHandle) {
    let automations = app
        .state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| auto_store::list_automations(conn).unwrap_or_default());
    let runtime = app.state::<ItopsAutomationRuntime>();
    let registry = app.state::<Arc<WatchdogRegistry>>();
    let enabled_ids = automations
        .iter()
        .filter(|automation| automation.enabled)
        .map(|automation| automation.id.as_str())
        .collect::<std::collections::HashSet<_>>();

    for automation_id in runtime.armed_automation_ids() {
        if !enabled_ids.contains(automation_id.as_str()) {
            runtime.disarm(&registry, &automation_id);
        }
    }
    for automation in automations
        .into_iter()
        .filter(|automation| automation.enabled)
    {
        if let Err(error) = runtime.arm(app, &registry, &automation) {
            eprintln!("failed to arm IT Ops automation {}: {error}", automation.id);
        }
    }
}

#[tauri::command]
pub fn itops_list_automations(app: AppHandle) -> Result<Vec<Automation>, String> {
    storage(&app).with_connection_infallible(|conn| {
        auto_store::list_automations(conn).map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub fn itops_create_automation(
    app: AppHandle,
    registry: State<'_, Arc<WatchdogRegistry>>,
    runtime: State<'_, ItopsAutomationRuntime>,
    name: String,
    config: WatchdogConfig,
    actions: Vec<AutomationAction>,
    enabled: bool,
    site_id: Option<String>,
) -> Result<Automation, String> {
    let id = new_itops_id("auto");
    let automation = storage(&app).with_connection_infallible(|conn| {
        auto_store::create_automation(
            conn,
            &id,
            &name,
            &config,
            &actions,
            enabled,
            site_id.as_deref(),
        )
        .map_err(|error| error.to_string())
    })?;
    if automation.enabled {
        runtime.arm(&app, &registry, &automation)?;
    }
    Ok(automation)
}

#[tauri::command]
pub fn itops_update_automation(
    app: AppHandle,
    registry: State<'_, Arc<WatchdogRegistry>>,
    runtime: State<'_, ItopsAutomationRuntime>,
    id: String,
    name: String,
    config: WatchdogConfig,
    actions: Vec<AutomationAction>,
    site_id: Option<String>,
) -> Result<Automation, String> {
    let automation = storage(&app).with_connection_infallible(|conn| {
        auto_store::update_automation(conn, &id, &name, &config, &actions, site_id.as_deref())
            .map_err(|error| error.to_string())
    })?;
    if automation.enabled {
        runtime.arm(&app, &registry, &automation)?;
    } else {
        runtime.disarm(&registry, &automation.id);
    }
    Ok(automation)
}

#[tauri::command]
pub fn itops_set_automation_enabled(
    app: AppHandle,
    registry: State<'_, Arc<WatchdogRegistry>>,
    runtime: State<'_, ItopsAutomationRuntime>,
    id: String,
    enabled: bool,
) -> Result<Automation, String> {
    let automation = storage(&app).with_connection_infallible(|conn| {
        auto_store::set_automation_enabled(conn, &id, enabled).map_err(|error| error.to_string())
    })?;
    if automation.enabled {
        runtime.arm(&app, &registry, &automation)?;
    } else {
        runtime.disarm(&registry, &automation.id);
    }
    Ok(automation)
}

/// Result of a one-shot Automation test (docs/ITOPS.md). Samples the trigger
/// right now and reports the value plus whether the condition would fire. The
/// action list is NOT executed — the frontend renders a dry-run preview of the
/// actions from the (already-known) action definitions.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTestResult {
    /// The sampled trigger value (number, string, or null when unavailable).
    pub value: serde_json::Value,
    /// False when the sampler could not produce a value (e.g. a rate metric's
    /// first sample, or a referenced Session that is not live).
    pub value_available: bool,
    /// Whether the condition predicate is satisfied by `value` right now.
    pub would_fire: bool,
    /// Optional note code the frontend translates (e.g. "schedule",
    /// "needsSession") to explain a result that needs context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// Sample an Automation's trigger once and evaluate its condition, without
/// running any actions. Backs the editor's "Test" button (sample-once + dry-run
/// per the IT Ops design). Async so the network probes (ping/TCP) can run.
#[tauri::command]
pub async fn itops_test_automation(
    app: AppHandle,
    config: WatchdogConfig,
) -> Result<AutomationTestResult, String> {
    let (value, note) = sample_target_once(&app, &config.target).await;
    let value_available = !value.is_null();
    let would_fire = value_available && evaluate_predicate(&config.trigger.predicate, &value);
    Ok(AutomationTestResult {
        value,
        value_available,
        would_fire,
        note,
    })
}

/// One-shot trigger sample for the Test command. Mirrors the registry's poll-loop
/// dispatcher but with fresh state (no carried log offset / counter), so it is a
/// pure point-in-time probe.
async fn sample_target_once(
    app: &AppHandle,
    target: &WatchdogTarget,
) -> (serde_json::Value, Option<String>) {
    match target {
        WatchdogTarget::Mock { step } => (serde_json::json!(step), None),
        WatchdogTarget::PerformanceCounter { metric } => {
            (targets::sample_performance_counter(app, *metric), None)
        }
        WatchdogTarget::SshSessionOutputSilence { session_id } => (
            targets::sample_ssh_session_silence(app, session_id),
            Some("needsSession".to_string()),
        ),
        WatchdogTarget::Ping { host, port } => (targets::sample_ping(host, *port).await, None),
        WatchdogTarget::TcpReachable { host, port } => {
            (targets::sample_tcp_reachable(host, *port).await, None)
        }
        WatchdogTarget::Schedule { cron } => {
            (targets::sample_schedule(cron), Some("schedule".to_string()))
        }
        WatchdogTarget::LogFile { path, pattern } => {
            let (_size, matched) = targets::scan_log_appended(path, None, pattern);
            (serde_json::json!(if matched { 1.0 } else { 0.0 }), None)
        }
        WatchdogTarget::OutputMatch {
            session_id,
            pattern,
        } => (
            targets::sample_output_match(app, session_id, pattern),
            Some("needsSession".to_string()),
        ),
    }
}

#[tauri::command]
pub fn itops_remove_automation(
    app: AppHandle,
    registry: State<'_, Arc<WatchdogRegistry>>,
    runtime: State<'_, ItopsAutomationRuntime>,
    id: String,
) -> Result<(), String> {
    runtime.disarm(&registry, &id);
    storage(&app).with_connection_infallible(|conn| {
        auto_store::remove_automation(conn, &id).map_err(|error| error.to_string())
    })
}

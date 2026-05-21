//! Tauri command wrappers for the watchdog registry.
//!
//! The AI Assistant calls these via tool_use; the status bar UI calls them
//! directly. All commands are sync (no `.await`) — the actual polling happens
//! inside the registry's spawned tokio tasks.

use std::sync::Arc;
use tauri::{AppHandle, State};

use super::registry::WatchdogRegistry;
use super::types::{
    WatchdogConfig, WatchdogInterventionRecord, WatchdogReport, WatchdogSummary,
};
use super::WatchdogError;

#[tauri::command]
pub fn watchdog_create(
    app: AppHandle,
    registry: State<'_, Arc<WatchdogRegistry>>,
    config: WatchdogConfig,
) -> Result<WatchdogSummary, WatchdogError> {
    WatchdogRegistry::create(&registry, &app, config)
}

#[tauri::command]
pub fn watchdog_list(
    registry: State<'_, Arc<WatchdogRegistry>>,
) -> Result<Vec<WatchdogSummary>, WatchdogError> {
    Ok(registry.list())
}

#[tauri::command]
pub fn watchdog_cancel(
    registry: State<'_, Arc<WatchdogRegistry>>,
    id: String,
) -> Result<(), WatchdogError> {
    registry.cancel(&id)
}

#[tauri::command]
pub fn watchdog_get_report(
    registry: State<'_, Arc<WatchdogRegistry>>,
    id: String,
) -> Result<WatchdogReport, WatchdogError> {
    registry.report(&id)
}

/// Called by the frontend intervention runner after the AI sub-turn finishes
/// (any outcome). Updates the registry log, advances the count, and unparks
/// the watchdog's poll loop so it can enter suppression / re-enter running /
/// finalize per its cap policy.
#[tauri::command]
pub async fn watchdog_record_intervention(
    registry: State<'_, Arc<WatchdogRegistry>>,
    id: String,
    record: WatchdogInterventionRecord,
) -> Result<(), WatchdogError> {
    registry.record_intervention(&id, record).await
}

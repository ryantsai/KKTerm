// Tauri command surface for the Install Helper Module. Commands are kept
// thin — they look up the recipe in the cached catalog, dispatch to
// detect/install/uninstall, and emit ProgressEvents on
// `installer://progress`. Long-running work runs on a dedicated worker
// thread per call; cancellation is cooperative via a shared AtomicBool.

use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use super::cache::{load_detection_cache, write_cached_state};
use super::catalog::load_bundled_catalog;
use super::detect::{
    DetectedState, detect_all, detect_bundle_from_states, detect_one, detect_one_in_catalog,
    invalidate_installed_software_snapshot, refresh_installed_software_snapshot,
};
use super::events::{PROGRESS_EVENT, ProgressEvent};
use super::install::{EventSink, install_recipe};
use super::latest_version::{installer_latest_is_newer, latest_version_in_catalog};
use super::managed_app::{managed_app_data_dir, managed_app_install_dir};
use super::options::InstallOptions;
use super::proc::{no_window, npm_program};
use super::schema::{Catalog, Provider, Recipe};
use super::state as st;
use super::uninstall::uninstall_recipe;
use crate::storage::Storage;

/// Tauri-managed runtime state: cached catalog + per-tool cancellation
/// flags + per-tool in-flight worker handles.
#[derive(Default)]
pub struct InstallerRuntime {
    catalog: Mutex<Option<Catalog>>,
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl InstallerRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    fn cancel_flag_for(&self, tool_id: &str) -> Arc<AtomicBool> {
        let mut map = self.cancel_flags.lock().unwrap();
        map.entry(tool_id.to_string())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone()
    }

    fn reset_cancel(&self, tool_id: &str) {
        let flag = self.cancel_flag_for(tool_id);
        flag.store(false, Ordering::Relaxed);
    }

    fn raise_cancel(&self, tool_id: &str) {
        let flag = self.cancel_flag_for(tool_id);
        flag.store(true, Ordering::Relaxed);
    }
}

fn find_recipe<'a>(catalog: &'a Catalog, id: &str) -> Option<&'a Recipe> {
    catalog.recipes.iter().find(|r| r.id == id)
}

fn provider_kind(provider: &Provider) -> &'static str {
    match provider {
        Provider::Winget { .. } => "winget",
        Provider::Chocolatey { .. } => "chocolatey",
        Provider::Npm { .. } => "npm",
        Provider::UvPip { .. } => "uvPip",
        Provider::DownloadInstaller { .. } => "downloadInstaller",
        Provider::GithubRelease { .. } => "githubRelease",
        Provider::WindowsFeature { .. } => "windowsFeature",
        Provider::WslDistro { .. } => "wslDistro",
        Provider::Bundle { .. } => "bundle",
    }
}

/// Load the bundled catalog. The `_force_refresh` arg is retained for
/// frontend API compatibility but has no effect — the catalog is embedded
/// at compile time, so "refresh" is the same as "the build that's running".
#[tauri::command]
pub async fn installer_load_catalog(
    runtime: State<'_, InstallerRuntime>,
    _force_refresh: Option<bool>,
) -> Result<Catalog, String> {
    crate::logging::installer_helper_debug(
        "command.installer_load_catalog.start",
        &json!({ "forceRefresh": _force_refresh }),
    );
    let catalog =
        tauri::async_runtime::spawn_blocking(|| load_bundled_catalog().map_err(|e| e.to_string()))
            .await
            .map_err(|error| format!("failed to load installer catalog: {error}"))??;
    *runtime.catalog.lock().unwrap() = Some(catalog.clone());
    crate::logging::installer_helper_debug(
        "command.installer_load_catalog.ok",
        &json!({ "recipeCount": catalog.recipes.len() }),
    );
    Ok(catalog)
}

#[tauri::command]
pub async fn installer_detect_all(
    runtime: State<'_, InstallerRuntime>,
) -> Result<HashMap<String, DetectedState>, String> {
    crate::logging::installer_helper_debug("command.installer_detect_all.start", &json!({}));
    let catalog = runtime
        .catalog
        .lock()
        .unwrap()
        .clone()
        .ok_or("catalog not loaded yet — call installer_load_catalog first")?;
    let detected: HashMap<String, DetectedState> =
        tauri::async_runtime::spawn_blocking(move || {
            let now = unix_now_secs();
            detect_all(&catalog)
                .into_iter()
                .map(|(tool_id, state)| {
                    let state = state.with_last_checked_at(Some(now));
                    write_cached_state(&tool_id, &state);
                    (tool_id, state)
                })
                .collect()
        })
        .await
        .map_err(|error| format!("failed to detect installer tools: {error}"))?;
    crate::logging::installer_helper_debug(
        "command.installer_detect_all.ok",
        &json!({ "resultCount": detected.len() }),
    );
    Ok(detected)
}

#[tauri::command]
pub async fn installer_load_detection_cache(
    runtime: State<'_, InstallerRuntime>,
) -> Result<HashMap<String, DetectedState>, String> {
    crate::logging::installer_helper_debug(
        "command.installer_load_detection_cache.start",
        &json!({}),
    );
    let catalog = runtime
        .catalog
        .lock()
        .unwrap()
        .clone()
        .ok_or("catalog not loaded yet — call installer_load_catalog first")?;
    let cache = tauri::async_runtime::spawn_blocking(move || load_detection_cache(&catalog))
        .await
        .map_err(|error| format!("failed to load installer detection cache: {error}"))?;
    crate::logging::installer_helper_debug(
        "command.installer_load_detection_cache.ok",
        &json!({ "hitCount": cache.len() }),
    );
    Ok(cache)
}

#[tauri::command]
pub fn installer_detect_all_streaming(
    app: AppHandle,
    runtime: State<'_, InstallerRuntime>,
) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "command.installer_detect_all_streaming.start",
        &json!({}),
    );
    let catalog = runtime
        .catalog
        .lock()
        .unwrap()
        .clone()
        .ok_or("catalog not loaded yet — call installer_load_catalog first")?;
    std::thread::spawn(move || {
        crate::logging::installer_helper_debug(
            "detect.streaming.worker.start",
            &json!({ "recipeCount": catalog.recipes.len() }),
        );
        let emit = make_emit_sink(app);
        let tool_ids: Vec<String> = catalog.recipes.iter().map(|r| r.id.clone()).collect();
        emit(ProgressEvent::DetectStarted { tool_ids });

        let mut leaves = Vec::new();
        let mut bundles = Vec::new();
        for recipe in &catalog.recipes {
            if matches!(recipe.provider, Provider::Bundle { .. }) {
                bundles.push(recipe.clone());
            } else {
                leaves.push(recipe.clone());
            }
        }

        refresh_installed_software_snapshot();
        let detected = Mutex::new(HashMap::<String, DetectedState>::new());
        let work = Mutex::new(leaves);
        std::thread::scope(|scope| {
            for _ in 0..DETECT_PARALLELISM {
                let work = &work;
                let detected = &detected;
                let emit = &emit;
                scope.spawn(move || {
                    loop {
                        let recipe = {
                            let mut q = work.lock().unwrap();
                            match q.pop() {
                                Some(recipe) => recipe,
                                None => return,
                            }
                        };
                        let state = detect_one(&recipe).with_last_checked_at(Some(unix_now_secs()));
                        write_cached_state(&recipe.id, &state);
                        detected
                            .lock()
                            .unwrap()
                            .insert(recipe.id.clone(), state.clone());
                        emit(ProgressEvent::DetectResult {
                            tool_id: recipe.id,
                            state,
                        });
                    }
                });
            }
        });

        let mut detected_guard = detected.lock().unwrap();
        for bundle in bundles {
            if let Some(state) = detect_bundle_from_states(&bundle, &detected_guard)
                .map(|state| state.with_last_checked_at(Some(unix_now_secs())))
            {
                write_cached_state(&bundle.id, &state);
                detected_guard.insert(bundle.id.clone(), state.clone());
                emit(ProgressEvent::DetectResult {
                    tool_id: bundle.id,
                    state,
                });
            }
        }
        emit(ProgressEvent::DetectFinished);
        crate::logging::installer_helper_debug("detect.streaming.worker.ok", &json!({}));
    });
    Ok(())
}

/// Synthetic cancel-flag key used by the streaming check-for-updates sweep.
/// Routes through the same cancel-flag map as installs so `installer_cancel`
/// with this id aborts the sweep mid-list.
pub const CHECK_UPDATES_CANCEL_ID: &str = "__check_updates__";

/// Bounded parallelism for latest-version lookups. Most operations are
/// network or CLI-bound; 4 in flight saturates a typical home connection
/// without overwhelming winget's source backend.
const CHECK_UPDATES_PARALLELISM: usize = 4;
const DETECT_PARALLELISM: usize = 4;

/// Streaming check-for-updates. Runs on Tauri's worker thread (the UI is
/// never blocked), but emits one `CheckResult` per tool as its lookup
/// lands so the frontend can light rows up incrementally. Lookups run in
/// parallel via a scoped thread pool; the per-tool work is network/CLI
/// bound, so a small pool (`CHECK_UPDATES_PARALLELISM`) is enough to hide
/// the slow legs (winget) behind the fast ones (cached npm).
#[tauri::command]
pub fn installer_check_latest_versions(
    app: AppHandle,
    runtime: State<'_, InstallerRuntime>,
    tool_ids: Vec<String>,
) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "command.installer_check_latest_versions.start",
        &json!({ "toolIds": &tool_ids }),
    );
    let catalog = runtime
        .catalog
        .lock()
        .unwrap()
        .clone()
        .ok_or("catalog not loaded yet")?;
    let cancel = runtime.cancel_flag_for(CHECK_UPDATES_CANCEL_ID);
    runtime.reset_cancel(CHECK_UPDATES_CANCEL_ID);

    let app_for_worker = app.clone();
    let emit: EventSink = make_emit_sink(app);
    emit(ProgressEvent::CheckStarted {
        tool_ids: tool_ids.clone(),
    });
    std::thread::spawn(move || {
        crate::logging::installer_helper_debug(
            "latest.check.worker.start",
            &json!({ "toolIds": &tool_ids }),
        );
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let work: Mutex<Vec<String>> = Mutex::new(tool_ids);
        let catalog_ref = &catalog;
        let emit_ref = &emit;

        std::thread::scope(|scope| {
            for _ in 0..CHECK_UPDATES_PARALLELISM {
                let cancel = cancel.clone();
                let work = &work;
                let app = app_for_worker.clone();
                scope.spawn(move || {
                    loop {
                        if cancel.load(Ordering::Relaxed) {
                            return;
                        }
                        let tool_id = {
                            let mut q = work.lock().unwrap();
                            match q.pop() {
                                Some(id) => id,
                                None => return,
                            }
                        };
                        let (latest, error) = match find_recipe(catalog_ref, &tool_id) {
                            Some(recipe) => match latest_version_in_catalog(recipe, catalog_ref) {
                                Ok(latest) => (latest, None),
                                Err(error) => (None, Some(error)),
                            },
                            None => (None, Some("unknown tool id".to_string())),
                        };
                        if error.is_none() {
                            let storage = app.state::<Storage>();
                            let _ = st::record_latest_version(
                                &storage,
                                &tool_id,
                                latest.as_deref(),
                                now,
                            );
                        } else {
                            // A completed lookup attempt still counts toward the
                            // configured auto-check interval. Keep the cached
                            // latest version, but persist the attempt time so a
                            // provider outage is not retried on every app launch.
                            let storage = app.state::<Storage>();
                            let _ = st::record_check_attempt(&storage, &tool_id, now);
                        }
                        crate::logging::installer_helper_debug(
                            "latest.check.result",
                            &json!({ "toolId": &tool_id, "latestVersion": &latest, "error": &error }),
                        );
                        emit_ref(ProgressEvent::CheckResult {
                            tool_id,
                            latest_version: latest,
                            error,
                        });
                    }
                });
            }
        });

        emit(ProgressEvent::CheckFinished);
        crate::logging::installer_helper_debug("latest.check.worker.ok", &json!({}));
    });
    Ok(())
}

#[tauri::command]
pub async fn installer_get_state(app: AppHandle) -> Result<Vec<st::ToolState>, String> {
    crate::logging::installer_helper_debug("command.installer_get_state.start", &json!({}));
    let state = tauri::async_runtime::spawn_blocking(move || {
        let storage = app.state::<Storage>();
        st::list_all(&storage)
    })
    .await
    .map_err(|error| format!("failed to load installer state: {error}"))?;
    if let Ok(rows) = &state {
        crate::logging::installer_helper_debug(
            "command.installer_get_state.ok",
            &json!({ "rowCount": rows.len() }),
        );
    }
    state
}

#[tauri::command]
pub async fn installer_set_pinned(
    app: AppHandle,
    tool_id: String,
    pinned: bool,
) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "command.installer_set_pinned.start",
        &json!({ "toolId": &tool_id, "pinned": pinned }),
    );
    tauri::async_runtime::spawn_blocking(move || {
        let storage = app.state::<Storage>();
        st::set_pinned(&storage, &tool_id, pinned)
    })
    .await
    .map_err(|error| format!("failed to update installer pin state: {error}"))?
}

#[tauri::command]
pub fn installer_install_recipe(
    app: AppHandle,
    runtime: State<'_, InstallerRuntime>,
    tool_id: String,
    options: Option<InstallOptions>,
) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "command.installer_install_recipe.start",
        &json!({ "toolId": &tool_id, "options": &options }),
    );
    let catalog = runtime
        .catalog
        .lock()
        .unwrap()
        .clone()
        .ok_or("catalog not loaded yet")?;
    let recipe = find_recipe(&catalog, &tool_id)
        .ok_or_else(|| format!("unknown tool id `{tool_id}`"))?
        .clone();
    let cancel = runtime.cancel_flag_for(&tool_id);
    runtime.reset_cancel(&tool_id);
    let app_clone = app.clone();
    let options = options.unwrap_or_default();

    std::thread::spawn(move || {
        crate::logging::installer_helper_debug(
            "install.worker.start",
            &json!({ "toolId": &tool_id, "provider": provider_kind(&recipe.provider) }),
        );
        let emit: EventSink = make_emit_sink(app_clone.clone());
        let result = if let Provider::Bundle { steps } = &recipe.provider {
            run_bundle_install(
                &app_clone,
                &catalog,
                &recipe.id,
                steps,
                &options,
                cancel.clone(),
                &emit,
            )
        } else {
            install_recipe(&recipe, &options, cancel.clone(), &emit)
        };
        crate::logging::installer_helper_debug(
            "install.worker.finished",
            &json!({ "toolId": &tool_id, "result": &result }),
        );
        emit_terminal(&emit, &tool_id, &result, cancel);
    });
    Ok(())
}

#[tauri::command]
pub fn installer_uninstall_recipe(
    app: AppHandle,
    runtime: State<'_, InstallerRuntime>,
    tool_id: String,
) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "command.installer_uninstall_recipe.start",
        &json!({ "toolId": &tool_id }),
    );
    let catalog = runtime
        .catalog
        .lock()
        .unwrap()
        .clone()
        .ok_or("catalog not loaded yet")?;
    let recipe = find_recipe(&catalog, &tool_id)
        .ok_or_else(|| format!("unknown tool id `{tool_id}`"))?
        .clone();
    let cancel = runtime.cancel_flag_for(&tool_id);
    runtime.reset_cancel(&tool_id);

    std::thread::spawn(move || {
        crate::logging::installer_helper_debug(
            "uninstall.worker.start",
            &json!({ "toolId": &tool_id, "provider": provider_kind(&recipe.provider) }),
        );
        let emit: EventSink = make_emit_sink(app.clone());
        let result = if let Provider::Bundle { steps } = &recipe.provider {
            run_bundle_uninstall(&catalog, &recipe.id, steps, cancel.clone(), &emit)
        } else {
            uninstall_recipe(&recipe, cancel.clone(), &emit).map(|_| None)
        };
        crate::logging::installer_helper_debug(
            "uninstall.worker.finished",
            &json!({ "toolId": &tool_id, "result": &result }),
        );
        emit_terminal(&emit, &tool_id, &result, cancel);
    });
    Ok(())
}

#[tauri::command]
pub fn installer_cancel(
    runtime: State<'_, InstallerRuntime>,
    tool_id: String,
) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "command.installer_cancel",
        &json!({ "toolId": &tool_id }),
    );
    runtime.raise_cancel(&tool_id);
    Ok(())
}

#[tauri::command]
pub async fn installer_run_web_ui(tool_id: String) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "command.installer_run_web_ui.start",
        &json!({ "toolId": &tool_id }),
    );
    tauri::async_runtime::spawn_blocking(move || {
        start_web_ui_for_tool(&tool_id)
    })
    .await
    .map_err(|error| format!("failed to start managed web UI: {error}"))?
}

#[tauri::command]
pub async fn installer_get_web_ui_status(tool_id: String) -> Result<ManagedWebUiStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let affordance = web_ui_affordance(&tool_id)
            .ok_or_else(|| format!("tool `{tool_id}` does not expose a managed web UI"))?;
        Ok(web_ui_status(&tool_id, &affordance))
    })
    .await
    .map_err(|error| format!("failed to check managed web UI status: {error}"))?
}

#[tauri::command]
pub async fn installer_stop_web_ui(tool_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || stop_web_ui_for_tool(&tool_id))
        .await
        .map_err(|error| format!("failed to stop managed web UI: {error}"))?
}

#[tauri::command]
pub async fn installer_install_service(
    app: AppHandle,
    runtime: State<'_, InstallerRuntime>,
    tool_id: String,
) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "command.installer_install_service.start",
        &json!({ "toolId": &tool_id }),
    );
    let catalog = runtime
        .catalog
        .lock()
        .unwrap()
        .clone()
        .ok_or("catalog not loaded yet")?;
    tauri::async_runtime::spawn_blocking(move || {
        let emit = make_emit_sink(app);
        ensure_nssm_installed(&catalog, &tool_id, &emit)?;
        let affordance = web_ui_affordance(&tool_id)
            .ok_or_else(|| format!("tool `{tool_id}` does not expose a managed web UI"))?;
        let mut service = service_affordance(&tool_id)
            .ok_or_else(|| format!("tool `{tool_id}` does not expose a managed service helper"))?;
        pin_managed_service_node_runtime(&tool_id, &mut service)?;
        if let Some(port) = port_to_stop_before_service(&affordance) {
            stop_port_listener(port)?;
        }
        run_elevated_cmd_script(
            &service_install_script(&service),
            &format!("install service {}", service.service_name),
        )
    })
    .await
    .map_err(|error| format!("failed to install managed service: {error}"))?
}

#[tauri::command]
pub async fn installer_remove_service(tool_id: String) -> Result<(), String> {
    crate::logging::installer_helper_debug(
        "command.installer_remove_service.start",
        &json!({ "toolId": &tool_id }),
    );
    tauri::async_runtime::spawn_blocking(move || {
        let service = service_affordance(&tool_id)
            .ok_or_else(|| format!("tool `{tool_id}` does not expose a managed service helper"))?;
        run_elevated_cmd_script(
            &service_remove_script(&service.service_name),
            &format!("remove service {}", service.service_name),
        )
    })
    .await
    .map_err(|error| format!("failed to remove managed service: {error}"))?
}

#[tauri::command]
pub async fn installer_redetect(
    runtime: State<'_, InstallerRuntime>,
    tool_id: String,
) -> Result<DetectedState, String> {
    crate::logging::installer_helper_debug(
        "command.installer_redetect.start",
        &json!({ "toolId": &tool_id }),
    );
    let catalog = runtime
        .catalog
        .lock()
        .unwrap()
        .clone()
        .ok_or("catalog not loaded yet")?;
    let recipe = find_recipe(&catalog, &tool_id)
        .ok_or_else(|| format!("unknown tool id `{tool_id}`"))?
        .clone();
    let state = tauri::async_runtime::spawn_blocking({
        let tool_id = tool_id.clone();
        move || {
            // A redetect is the user's signal that the world may have changed
            // (install/uninstall just finished, or they hit Refresh on one row).
            // Drop the cached installed-software snapshot so the next winget recipe
            // re-scans the local uninstall registry.
            invalidate_installed_software_snapshot();
            let state = detect_one_in_catalog(&recipe, &catalog)
                .with_last_checked_at(Some(unix_now_secs()));
            write_cached_state(&tool_id, &state);
            state
        }
    })
    .await
    .map_err(|error| format!("failed to redetect installer tool: {error}"))?;
    crate::logging::installer_helper_debug(
        "command.installer_redetect.ok",
        &json!({ "toolId": &tool_id, "state": &state }),
    );
    Ok(state)
}

// ---- WSL distro management ---------------------------------------------
//
// These commands sit outside the catalog/recipe lifecycle: they reflect the
// live host state (`wsl --list`) so the user can manage every distro, not just
// the catalog ones. Each runs the blocking `wsl.exe` call off the UI thread.

#[tauri::command]
pub async fn installer_wsl_list_distros() -> Result<Vec<super::wsl::WslDistroInfo>, String> {
    tauri::async_runtime::spawn_blocking(super::wsl::list_installed_distros)
        .await
        .map_err(|error| format!("failed to list WSL distros: {error}"))?
}

#[tauri::command]
pub async fn installer_wsl_list_online() -> Result<Vec<super::wsl::WslOnlineDistro>, String> {
    tauri::async_runtime::spawn_blocking(super::wsl::list_online_distros)
        .await
        .map_err(|error| format!("failed to list online WSL distros: {error}"))?
}

#[tauri::command]
pub async fn installer_wsl_set_default(distro: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || super::wsl::set_default_distro(&distro))
        .await
        .map_err(|error| format!("failed to set default WSL distro: {error}"))?
}

#[tauri::command]
pub async fn installer_wsl_unregister(distro: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || super::wsl::unregister_distro(&distro))
        .await
        .map_err(|error| format!("failed to unregister WSL distro: {error}"))?
}

#[tauri::command]
pub async fn installer_wsl_install(distro: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || super::wsl::install_distro(&distro))
        .await
        .map_err(|error| format!("failed to install WSL distro: {error}"))?
}

// ---- helpers -----------------------------------------------------------

fn make_emit_sink(app: AppHandle) -> EventSink {
    Box::new(move |event: ProgressEvent| {
        crate::logging::installer_helper_debug("event.emit", &json!({ "event": &event }));
        let _ = app.emit(PROGRESS_EVENT, event);
    })
}

fn emit_terminal(
    emit: &EventSink,
    tool_id: &str,
    result: &Result<Option<String>, String>,
    cancel: Arc<AtomicBool>,
) {
    match result {
        Ok(installed_version) => emit(ProgressEvent::Completed {
            tool_id: tool_id.into(),
            installed_version: installed_version.clone(),
        }),
        Err(msg) if cancel.load(Ordering::Relaxed) || msg == "cancelled" => {
            emit(ProgressEvent::Cancelled {
                tool_id: tool_id.into(),
            });
        }
        Err(msg) => emit(ProgressEvent::Failed {
            tool_id: tool_id.into(),
            message: msg.clone(),
        }),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WebUiAffordance {
    program: String,
    args: Vec<String>,
    env: Vec<(&'static str, String)>,
    working_dir: String,
    url: &'static str,
    port: u16,
    dynamic_port_file: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ManagedServiceAffordance {
    service_name: String,
    display_name: String,
    program: String,
    args: Vec<String>,
    env: Vec<(&'static str, String)>,
    working_dir: String,
}

#[derive(Debug, Clone)]
struct ManagedNodeRuntime {
    version: String,
    node_path: PathBuf,
    is_lts: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWebUiStatus {
    running: bool,
    service_installed: bool,
    service_state: Option<String>,
    startup: Option<String>,
    node_version: Option<String>,
    node_runtime_version: Option<String>,
    node_requirement: Option<String>,
    url: String,
}

fn web_ui_affordance(tool_id: &str) -> Option<WebUiAffordance> {
    match tool_id {
        "n8n" => Some(WebUiAffordance {
            program: npm_program().into(),
            args: vec![
                "exec".into(),
                "--prefix".into(),
                managed_app_install_dir("n8n")
                    .to_string_lossy()
                    .into_owned(),
                "--".into(),
                "n8n".into(),
                "start".into(),
            ],
            env: vec![(
                "N8N_USER_FOLDER",
                managed_app_data_dir("n8n").to_string_lossy().into_owned(),
            )],
            working_dir: managed_app_install_dir("n8n")
                .to_string_lossy()
                .into_owned(),
            url: "http://localhost:5678",
            port: 5678,
            dynamic_port_file: None,
        }),
        "ollama" => Some(WebUiAffordance {
            program: managed_ollama_program(),
            args: vec!["serve".into()],
            env: vec![(
                "OLLAMA_MODELS",
                managed_app_data_dir("ollama")
                    .join("models")
                    .to_string_lossy()
                    .into_owned(),
            )],
            working_dir: managed_app_install_dir("ollama")
                .to_string_lossy()
                .into_owned(),
            url: "http://localhost:11434",
            port: 11434,
            dynamic_port_file: None,
        }),
        "flowise" => Some(WebUiAffordance {
            program: npm_program().into(),
            args: vec![
                "exec".into(),
                "--prefix".into(),
                managed_app_install_dir("flowise")
                    .to_string_lossy()
                    .into_owned(),
                "--".into(),
                "flowise".into(),
                "start".into(),
            ],
            env: flowise_managed_env(),
            working_dir: managed_app_install_dir("flowise")
                .to_string_lossy()
                .into_owned(),
            url: "http://localhost:3000",
            port: 3000,
            dynamic_port_file: None,
        }),
        "open-webui" => Some(WebUiAffordance {
            program: managed_uv_pip_script("open-webui", "open-webui"),
            args: vec![
                "serve".into(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                "8080".into(),
            ],
            env: vec![(
                "DATA_DIR",
                managed_app_data_dir("open-webui")
                    .to_string_lossy()
                    .into_owned(),
            )],
            working_dir: managed_app_install_dir("open-webui")
                .to_string_lossy()
                .into_owned(),
            url: "http://localhost:8080",
            port: 8080,
            dynamic_port_file: None,
        }),
        "langflow" => Some(WebUiAffordance {
            program: managed_uv_pip_script("langflow", "langflow"),
            args: vec![
                "run".into(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                "7860".into(),
            ],
            env: vec![(
                "LANGFLOW_CONFIG_DIR",
                managed_app_data_dir("langflow")
                    .to_string_lossy()
                    .into_owned(),
            )],
            working_dir: managed_app_install_dir("langflow")
                .to_string_lossy()
                .into_owned(),
            url: "http://localhost:7860",
            port: 7860,
            dynamic_port_file: None,
        }),
        "excalidraw" => Some(WebUiAffordance {
            program: npm_program().into(),
            args: vec![
                "exec".into(),
                "--prefix".into(),
                managed_app_install_dir("excalidraw")
                    .to_string_lossy()
                    .into_owned(),
                "--".into(),
                "vite".into(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                "3021".into(),
            ],
            env: vec![],
            working_dir: managed_app_install_dir("excalidraw")
                .to_string_lossy()
                .into_owned(),
            url: "http://localhost:3021",
            port: 3021,
            dynamic_port_file: None,
        }),
        "bentopdf" => Some(WebUiAffordance {
            program: "node".into(),
            args: vec![
                "kkterm-web-ui-server.mjs".into(),
                "--preferred-port".into(),
                "3022".into(),
            ],
            env: vec![],
            working_dir: managed_app_install_dir("bentopdf")
                .to_string_lossy()
                .into_owned(),
            url: "http://localhost:3022",
            port: 3022,
            dynamic_port_file: Some(
                managed_app_install_dir("bentopdf")
                    .join(".kkterm-web-ui-port")
                    .to_string_lossy()
                    .into_owned(),
            ),
        }),
        "openflowkit" => Some(WebUiAffordance {
            program: "node".into(),
            args: vec![
                "kkterm-web-ui-server.mjs".into(),
                "--preferred-port".into(),
                "3023".into(),
            ],
            env: vec![],
            working_dir: managed_app_install_dir("openflowkit")
                .to_string_lossy()
                .into_owned(),
            url: "http://localhost:3023",
            port: 3023,
            dynamic_port_file: Some(
                managed_app_install_dir("openflowkit")
                    .join(".kkterm-web-ui-port")
                    .to_string_lossy()
                    .into_owned(),
            ),
        }),
        _ => None,
    }
}

struct TerminalLaunchAffordance {
    activate_ps1: Option<String>,
    /// Extra PowerShell lines run after activation and before hints (e.g. local function aliases).
    setup_lines: Vec<String>,
    prefill: String,
    hints: Vec<String>,
}

fn terminal_launch_affordance(tool_id: &str) -> Option<TerminalLaunchAffordance> {
    /// Plain PATH-resolved CLI tool: no venv activation, no setup lines.
    fn plain(prefill: &str, hints: &[&str]) -> Option<TerminalLaunchAffordance> {
        Some(TerminalLaunchAffordance {
            activate_ps1: None,
            setup_lines: vec![],
            prefill: prefill.into(),
            hints: hints.iter().map(|hint| (*hint).to_string()).collect(),
        })
    }
    match tool_id {
        "git" => plain(
            "git status",
            &[
                "git clone <url>  —  copy a remote repository",
                "git status  —  show changed files",
                "git log --oneline -20  —  recent commits",
            ],
        ),
        "winget" => plain(
            "winget search ",
            &[
                "winget search <name>  —  find a package",
                "winget install <id>  —  install a package",
                "winget upgrade --all  —  update everything",
            ],
        ),
        "chocolatey" => plain(
            "choco search ",
            &[
                "choco search <name>  —  find a package",
                "choco install <id>  —  install a package (admin)",
                "choco upgrade all  —  update everything (admin)",
            ],
        ),
        "node-bundle" => plain(
            "node --version",
            &[
                "node --version  —  check the active Node runtime",
                "npm install <package>  —  add a package to a project",
                "nvm list  —  show installed Node versions",
            ],
        ),
        "python-bundle" => plain(
            "python --version",
            &[
                "python --version  —  check the active Python runtime",
                "uv venv  —  create a virtual environment",
                "uv pip install <package>  —  install into the environment",
            ],
        ),
        "wsl" => plain(
            "wsl --list --verbose",
            &[
                "wsl  —  open the default Linux distribution",
                "wsl --list --verbose  —  show installed distributions",
                "wsl --update  —  update the WSL kernel",
            ],
        ),
        "nssm" => plain(
            "nssm",
            &[
                "nssm install <service>  —  register a service (admin)",
                "nssm status <service>  —  check a service",
            ],
        ),
        "oh-my-posh" => plain(
            "oh-my-posh init pwsh | Invoke-Expression",
            &[
                "oh-my-posh init pwsh | Invoke-Expression  —  try it in this session",
                "oh-my-posh font install  —  install a Nerd Font",
            ],
        ),
        "antigravity-cli" => plain("agy", &[]),
        "claude-code-cli" => plain("claude", &[]),
        "codex-cli" => plain("codex", &[]),
        "cursor-cli" => plain("agent", &[]),
        "kimi-code-cli" => plain("kimi", &[]),
        "grok-build" => plain("grok", &[]),
        "opencode" => plain("opencode", &[]),
        "pi" => plain("pi", &[]),
        "oh-my-pi" => plain("omp", &[]),
        "rustup" => plain(
            "rustup show",
            &[
                "rustup show  —  show the active toolchain",
                "rustup update  —  update Rust",
                "cargo new <name>  —  create a project",
            ],
        ),
        "bun" => plain(
            "bun --version",
            &[
                "bun init  —  create a project",
                "bun install  —  install dependencies",
                "bun run <script>  —  run a package script",
            ],
        ),
        "ripgrep" => plain(
            "rg \"TODO\"",
            &[
                "rg \"pattern\"  —  search the current directory",
                "rg -i \"error\" -g \"*.log\"  —  case-insensitive search in .log files",
                "rg --files  —  list searchable files",
            ],
        ),
        "jq" => plain(
            "jq . ",
            &[
                "jq . data.json  —  pretty-print JSON",
                "Get-Content data.json | jq \".items[0]\"  —  pick a field from piped JSON",
            ],
        ),
        "fzf" => plain(
            "fzf",
            &[
                "fzf  —  fuzzy-pick a file from the current directory",
                "Get-ChildItem -Recurse -Name | fzf  —  fuzzy-filter any list",
            ],
        ),
        "ffmpeg" => plain(
            "ffmpeg",
            &[
                "ffmpeg -i input.mp4 output.mp3  —  convert media",
                "ffprobe input.mp4  —  inspect a media file",
            ],
        ),
        "scrcpy" => plain(
            "scrcpy",
            &[
                "scrcpy  —  mirror a USB-connected Android device",
                "scrcpy --tcpip=<ip>  —  connect over Wi-Fi",
            ],
        ),
        "psmux" => plain(
            "psmux",
            &[
                "psmux  —  start a terminal multiplexer session",
                "psmux --help  —  list commands and flags",
            ],
        ),
        "hermes-agent" => plain(
            "hermes setup",
            &[
                "hermes setup  —  configure providers and accounts",
                "hermes postinstall  —  optional dependencies",
                "hermes doctor  —  health check",
                "hermes  —  start chatting",
            ],
        ),
        "openclaw" => {
            let prefix = managed_app_install_dir("openclaw")
                .to_string_lossy()
                .into_owned()
                .replace('\'', "''");
            Some(TerminalLaunchAffordance {
                activate_ps1: None,
                setup_lines: vec![format!(
                    "function openclaw {{ npm exec --prefix '{prefix}' -- openclaw @args }}"
                )],
                prefill: "openclaw onboard --install-daemon".into(),
                hints: vec![
                    "openclaw onboard --install-daemon  —  setup and managed startup".into(),
                    "openclaw doctor  —  check configuration".into(),
                    "openclaw gateway status  —  verify gateway".into(),
                ],
            })
        }
        _ => None,
    }
}

/// `path`, when present, is the working directory to open the terminal in —
/// used by directory-scoped coding agents whose launcher remembers recent
/// project folders. It must name an existing absolute directory.
#[tauri::command]
pub async fn installer_open_terminal_launcher(
    tool_id: String,
    path: Option<String>,
    arguments: Option<String>,
    execute: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut affordance = terminal_launch_affordance(&tool_id)
            .ok_or_else(|| format!("tool `{tool_id}` does not have a terminal launcher"))?;
        let execute = execute.unwrap_or(false);
        if execute && !coding_agent_terminal_launcher(&tool_id) {
            return Err(format!(
                "tool `{tool_id}` does not support direct terminal execution"
            ));
        }
        if let Some(arguments) = validated_launcher_arguments(arguments.as_deref())? {
            affordance.prefill.push(' ');
            affordance.prefill.push_str(&arguments);
        }
        let working_dir = path.as_deref().map(validated_launch_dir).transpose()?;
        spawn_terminal_launcher(&affordance, working_dir.as_deref(), execute)
    })
    .await
    .map_err(|error| format!("failed to open terminal launcher: {error}"))?
}

fn coding_agent_terminal_launcher(tool_id: &str) -> bool {
    matches!(
        tool_id,
        "antigravity-cli"
            | "claude-code-cli"
            | "codex-cli"
            | "cursor-cli"
            | "kimi-code-cli"
            | "grok-build"
            | "opencode"
    )
}

fn validated_launcher_arguments(arguments: Option<&str>) -> Result<Option<String>, String> {
    let Some(arguments) = arguments.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if arguments.len() > 4096 {
        return Err("launcher arguments are too long".into());
    }
    if arguments.chars().any(|ch| matches!(ch, '\r' | '\n' | '\0')) {
        return Err("launcher arguments must be a single line".into());
    }
    Ok(Some(arguments.to_string()))
}

/// Validate a launcher working directory: absolute and existing, so a stale
/// remembered folder fails with a clear message instead of a broken prompt.
fn validated_launch_dir(path: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("launch folder is empty".into());
    }
    let dir = std::path::PathBuf::from(trimmed);
    if !dir.is_absolute() {
        return Err(format!("launch folder `{trimmed}` is not an absolute path"));
    }
    if !dir.is_dir() {
        return Err(format!("launch folder `{trimmed}` no longer exists"));
    }
    Ok(dir)
}

/// One way to locate an installed GUI app's executable. Candidates are tried
/// in order; the first one that resolves is launched.
enum GuiLaunchCandidate {
    /// Bare executable name resolved through the refreshed PATH
    /// (`Get-Command`) and the Windows `App Paths` registry.
    Command(&'static str),
    /// Absolute path with `%VAR%` environment tokens; may contain one `*`
    /// glob (e.g. versioned Blender install directories). When the glob
    /// matches several directories the highest-sorting path wins.
    Path(&'static str),
    /// MSIX/Store app launched via `shell:AppsFolder` by Appx package name.
    Appx(&'static str),
}

/// Curated automatic executable candidates for installed GUI apps that the
/// tile-level Run button can start directly. An explicitly user-selected,
/// validated per-tool path may be tried only after this closed list fails.
fn gui_launch_affordance(tool_id: &str) -> Vec<GuiLaunchCandidate> {
    use GuiLaunchCandidate::{Appx, Command, Path};
    match tool_id {
        "vscode" => vec![
            Path("%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe"),
            Path("%ProgramFiles%\\Microsoft VS Code\\Code.exe"),
            Command("code"),
        ],
        "cursor" => vec![
            Path("%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe"),
            Command("cursor"),
        ],
        "notepadpp" => vec![
            Command("notepad++.exe"),
            Path("%ProgramFiles%\\Notepad++\\notepad++.exe"),
        ],
        "docker-desktop" => vec![Path("%ProgramFiles%\\Docker\\Docker\\Docker Desktop.exe")],
        "comfyui" => vec![Path(
            "%LOCALAPPDATA%\\Programs\\@comfyorgcomfyui-electron\\ComfyUI.exe",
        )],
        "lmstudio" => vec![
            Path("%LOCALAPPDATA%\\Programs\\LM Studio\\LM Studio.exe"),
            Path("%LOCALAPPDATA%\\Programs\\lm-studio\\LM Studio.exe"),
            Path("%LOCALAPPDATA%\\LM-Studio\\LM Studio.exe"),
        ],
        "bruno" => vec![
            Path("%LOCALAPPDATA%\\Programs\\Bruno\\Bruno.exe"),
            Path("%ProgramFiles%\\Bruno\\Bruno.exe"),
        ],
        "claude-desktop" => vec![Path("%LOCALAPPDATA%\\AnthropicClaude\\claude.exe")],
        "codex-desktop" => vec![Appx("OpenAI.Codex")],
        "powertoys" => vec![
            Path("%ProgramFiles%\\PowerToys\\PowerToys.exe"),
            Path("%LOCALAPPDATA%\\PowerToys\\PowerToys.exe"),
        ],
        "powershell-7" => vec![
            Command("pwsh.exe"),
            Path("%ProgramFiles%\\PowerShell\\7\\pwsh.exe"),
        ],
        "everything" => vec![
            Path("%ProgramFiles%\\Everything\\Everything.exe"),
            Path("%ProgramFiles(x86)%\\Everything\\Everything.exe"),
            Command("Everything.exe"),
        ],
        "ditto" => vec![
            Path("%ProgramFiles%\\Ditto\\Ditto.exe"),
            Path("%ProgramFiles(x86)%\\Ditto\\Ditto.exe"),
        ],
        "keepassxc" => vec![
            Path("%ProgramFiles%\\KeePassXC\\KeePassXC.exe"),
            Command("keepassxc.exe"),
        ],
        "7zip" => vec![Path("%ProgramFiles%\\7-Zip\\7zFM.exe")],
        "sharex" => vec![
            Path("%ProgramFiles%\\ShareX\\ShareX.exe"),
            Command("sharex.exe"),
        ],
        "tailscale" => vec![Path("%ProgramFiles%\\Tailscale\\tailscale-ipn.exe")],
        "rustdesk" => vec![
            Path("%ProgramFiles%\\RustDesk\\rustdesk.exe"),
            Command("rustdesk.exe"),
        ],
        "google-chrome" => vec![
            Command("chrome.exe"),
            Path("%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"),
            Path("%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"),
        ],
        "firefox" => vec![
            Command("firefox.exe"),
            Path("%ProgramFiles%\\Mozilla Firefox\\firefox.exe"),
            Path("%LOCALAPPDATA%\\Mozilla Firefox\\firefox.exe"),
        ],
        "acrobat-reader" => vec![
            Command("Acrobat.exe"),
            Path("%ProgramFiles%\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe"),
            Command("AcroRd32.exe"),
        ],
        "obsidian" => vec![
            Path("%LOCALAPPDATA%\\Programs\\Obsidian\\Obsidian.exe"),
            Path("%LOCALAPPDATA%\\Obsidian\\Obsidian.exe"),
        ],
        "drawio" => vec![Path("%ProgramFiles%\\draw.io\\draw.io.exe")],
        "krita" => vec![
            Command("krita.exe"),
            Path("%ProgramFiles%\\Krita (x64)\\bin\\krita.exe"),
        ],
        "inkscape" => vec![
            Command("inkscape.exe"),
            Path("%ProgramFiles%\\Inkscape\\bin\\inkscape.exe"),
        ],
        "blender" => vec![
            Command("blender-launcher.exe"),
            Path("%ProgramFiles%\\Blender Foundation\\Blender *\\blender-launcher.exe"),
            Path("%ProgramFiles%\\Blender Foundation\\Blender *\\blender.exe"),
        ],
        "pencil" => vec![
            Path("%ProgramFiles%\\Pencil\\Pencil.exe"),
            Path("%LOCALAPPDATA%\\Programs\\Pencil\\Pencil.exe"),
        ],
        "vlc" => vec![
            Path("%ProgramFiles%\\VideoLAN\\VLC\\vlc.exe"),
            Command("vlc.exe"),
        ],
        "obs-studio" => vec![Path("%ProgramFiles%\\obs-studio\\bin\\64bit\\obs64.exe")],
        "xnview-mp" => vec![Path("%ProgramFiles%\\XnViewMP\\xnviewmp.exe")],
        "audacity" => vec![Path("%ProgramFiles%\\Audacity\\Audacity.exe")],
        "vcxsrv" => vec![Path("%ProgramFiles%\\VcXsrv\\xlaunch.exe")],
        _ => vec![],
    }
}

/// Launch an installed GUI app from the tile-level Run button. Resolves the
/// curated candidate list in order, then an optional user-selected path, and
/// starts the first hit detached at normal (non-elevated) integrity. Returns
/// false when nothing resolves so the frontend can offer the native picker.
#[tauri::command]
pub async fn installer_launch_app(
    runtime: State<'_, InstallerRuntime>,
    tool_id: String,
    custom_path: Option<String>,
) -> Result<bool, String> {
    let catalog = runtime
        .catalog
        .lock()
        .unwrap()
        .clone()
        .ok_or("catalog not loaded yet — call installer_load_catalog first")?;
    tauri::async_runtime::spawn_blocking(move || {
        let recipe = find_recipe(&catalog, &tool_id)
            .ok_or_else(|| format!("tool `{tool_id}` is not in the installer catalog"))?;
        let candidates = gui_launch_affordance(&tool_id);
        if candidates.is_empty() {
            return Err(format!("tool `{tool_id}` does not have an app launcher"));
        }
        let custom_path = custom_path
            .as_deref()
            .map(validated_custom_gui_launcher)
            .transpose()?;
        run_gui_launch(recipe, &candidates, custom_path)
    })
    .await
    .map_err(|error| format!("failed to launch app: {error}"))?
}

/// PowerShell that tries each candidate in order and starts the first hit.
/// `Start-Process` gets the executable's own directory as the working
/// directory because some apps (e.g. OBS Studio) refuse to start elsewhere.
fn build_gui_launch_ps_command(
    recipe: &Recipe,
    candidates: &[GuiLaunchCandidate],
    custom_path: Option<&Path>,
) -> String {
    let provider_id = match &recipe.provider {
        Provider::Winget { id } => id.as_str(),
        _ => "",
    };
    let mut display_names = recipe.detection.display_names.clone();
    if !display_names
        .iter()
        .any(|name| name.eq_ignore_ascii_case(&recipe.name))
    {
        display_names.push(recipe.name.clone());
    }
    let ps_array = |values: &[String]| {
        format!(
            "@({})",
            values
                .iter()
                .map(|value| ps_single_quote(value))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    let mut allowed_executable_names = candidates
        .iter()
        .filter_map(|candidate| match candidate {
            GuiLaunchCandidate::Command(command) | GuiLaunchCandidate::Path(command) => {
                command.rsplit('\\').next()
            }
            GuiLaunchCandidate::Appx(_) => None,
        })
        .flat_map(|name| {
            let mut names = vec![name.to_string()];
            if !name.to_ascii_lowercase().ends_with(".exe") {
                names.push(format!("{name}.exe"));
            }
            names
        })
        .collect::<Vec<_>>();
    allowed_executable_names.sort_by_key(|name| name.to_ascii_lowercase());
    allowed_executable_names.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    let mut parts: Vec<String> = vec![
        "$ErrorActionPreference = 'SilentlyContinue'".into(),
        "function Start-Hit([string]$exe) { Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe); exit 0 }".into(),
        "function Start-AppId([string]$appId) { Start-Process -FilePath 'explorer.exe' -ArgumentList ('shell:AppsFolder\\' + $appId); exit 0 }".into(),
        r#"function Get-DisplayIconExe([string]$value) { if (-not $value) { return $null }; $expanded = [Environment]::ExpandEnvironmentVariables($value.Trim()); if ($expanded -match '^\s*"([^"]+?\.exe)"') { return $Matches[1] }; if ($expanded -match '^\s*([^,]+?\.exe)(?:,|$)') { return $Matches[1].Trim() }; return $null }"#.into(),
        "function Test-AllowedExe([string]$exe) { if (-not $exe) { return $false }; $leaf = [IO.Path]::GetFileName($exe); return ($allowedExeNames | Where-Object { $leaf -ieq $_ }).Count -gt 0 }".into(),
        "function Test-LaunchableAppId([string]$appId) { if (-not $appId -or $appId -match '^(?i)https?://' -or $appId -match '(?i)\\.(chm|url|html?)$') { return $false }; if ($appId -match '(?i)\\.exe$') { return (Test-AllowedExe $appId) }; return $true }".into(),
        "function Get-VersionSortKey([string]$value) { $parts = @([regex]::Matches($value, '\\d+') | Select-Object -First 4 | ForEach-Object { try { '{0:D12}' -f [int64]$_.Value } catch { '000000000000' } }); return ($parts -join '.') }".into(),
        format!(
            "$allowedExeNames = {}",
            ps_array(&allowed_executable_names)
        ),
        format!("$displayNames = {}", ps_array(&display_names)),
        format!(
            "$displayPrefixes = {}",
            ps_array(&recipe.detection.display_name_prefixes)
        ),
        format!(
            "$registryKeys = {}",
            ps_array(&recipe.detection.registry_keys)
        ),
        format!("$wingetId = {}", ps_single_quote(provider_id)),
    ];

    for family in &recipe.detection.appx_package_family_names {
        let escaped = family.replace('\'', "''");
        parts.push(format!(
            "$pkg = Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object {{ $_.PackageFamilyName -ieq '{escaped}' }} | Select-Object -First 1; \
             if ($pkg) {{ $appId = (Get-AppxPackageManifest $pkg).Package.Applications.Application | Select-Object -First 1 -ExpandProperty Id; \
             if ($appId) {{ Start-AppId ($pkg.PackageFamilyName + '!' + $appId) }} }}"
        ));
    }

    parts.push(
        "$startApps = @(Get-StartApps -ErrorAction SilentlyContinue); $startMatches = @($startApps | Where-Object { $name = $_.Name; (($displayNames | Where-Object { $name -ieq $_ }).Count -gt 0) -and (Test-LaunchableAppId $_.AppID) }); if ($startMatches.Count -eq 1) { Start-AppId $startMatches[0].AppID }; $startMatches = @($startApps | Where-Object { $name = $_.Name; ((($displayNames | Where-Object { $name -ieq $_ }).Count -gt 0) -or (($displayPrefixes | Where-Object { $name -and $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0)) -and (Test-LaunchableAppId $_.AppID) }); if ($startMatches.Count -eq 1) { Start-AppId $startMatches[0].AppID }".into(),
    );
    parts.push(
        "$uninstallRoots = @('Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'Registry::HKEY_CURRENT_USER\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'Registry::HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'Registry::HKEY_LOCAL_MACHINE\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); $registrations = @(Get-ItemProperty -Path $uninstallRoots -ErrorAction SilentlyContinue | Where-Object { $child = $_.PSChildName; $name = $_.DisplayName; ($registryKeys | Where-Object { $child -ieq $_ }).Count -gt 0 -or ($wingetId -and ($child -ieq $wingetId -or ($child -ilike ($wingetId + '_*Microsoft.Winget.Source*')))) -or ($displayNames | Where-Object { $name -ieq $_ -or $name -ieq ($_ + ' (User)') }).Count -gt 0 -or ($displayPrefixes | Where-Object { $name -and $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0 } | Sort-Object -Property @{ Expression = { Get-VersionSortKey $_.DisplayVersion }; Descending = $true }); foreach ($registration in $registrations) { $exe = Get-DisplayIconExe $registration.DisplayIcon; if ((Test-AllowedExe $exe) -and (Test-Path -LiteralPath $exe -PathType Leaf)) { Start-Hit $exe }; if ($registration.InstallLocation) { foreach ($name in $allowedExeNames) { $exe = Join-Path ([Environment]::ExpandEnvironmentVariables($registration.InstallLocation)) $name; if (Test-Path -LiteralPath $exe -PathType Leaf) { Start-Hit $exe } } } }".into(),
    );
    for candidate in candidates {
        match candidate {
            GuiLaunchCandidate::Path(path) => {
                let escaped = path.replace('\'', "''");
                parts.push(format!(
                    "$p = [Environment]::ExpandEnvironmentVariables('{escaped}'); \
                     $hit = Get-Item -Path $p -ErrorAction SilentlyContinue | \
                     Sort-Object -Property FullName -Descending | Select-Object -First 1; \
                     if ($hit) {{ Start-Hit $hit.FullName }}"
                ));
            }
            GuiLaunchCandidate::Command(name) => {
                let escaped = name.replace('\'', "''");
                parts.push(format!(
                    "$cmd = Get-Command '{escaped}' -ErrorAction SilentlyContinue | Select-Object -First 1; \
                     if ($cmd -and $cmd.Source) {{ Start-Hit $cmd.Source }}"
                ));
                parts.push(format!(
                    "$ap = Get-ItemProperty -Path ('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{escaped}'), ('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{escaped}') -ErrorAction SilentlyContinue | Select-Object -First 1; \
                     if ($ap.'(default)') {{ $exe = [Environment]::ExpandEnvironmentVariables($ap.'(default)'.Trim('\"')); if (Test-Path -LiteralPath $exe) {{ Start-Hit $exe }} }}"
                ));
            }
            GuiLaunchCandidate::Appx(package) => {
                let escaped = package.replace('\'', "''");
                parts.push(format!(
                    "$pkg = Get-AppxPackage -Name '{escaped}' -ErrorAction SilentlyContinue | Select-Object -First 1; \
                     if ($pkg) {{ $appId = (Get-AppxPackageManifest $pkg).Package.Applications.Application | Select-Object -First 1 -ExpandProperty Id; \
                     if ($appId) {{ Start-Process ('shell:AppsFolder\\' + $pkg.PackageFamilyName + '!' + $appId); exit 0 }} }}"
                ));
            }
        }
    }
    if let Some(path) = custom_path {
        parts.push(format!(
            "$custom = {}; if (Test-Path -LiteralPath $custom -PathType Leaf) {{ Start-Hit $custom }}",
            ps_single_quote(&path.to_string_lossy())
        ));
    }
    parts.push("exit 1".into());
    parts.join("; ")
}

fn validated_custom_gui_launcher(path: &str) -> Result<&Path, String> {
    let path = Path::new(path.trim());
    if !path.is_absolute() {
        return Err("custom app launcher path must be absolute".into());
    }
    if !path.is_file() {
        return Err("custom app launcher path does not exist or is not a file".into());
    }
    if !is_supported_custom_gui_launcher(path) {
        return Err("custom app launcher must be an executable or .lnk shortcut".into());
    }
    Ok(path)
}

fn is_supported_custom_gui_launcher(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "exe" | "com" | "bat" | "cmd" | "lnk"
    )
}

#[cfg(target_os = "windows")]
fn run_gui_launch(
    recipe: &Recipe,
    candidates: &[GuiLaunchCandidate],
    custom_path: Option<&Path>,
) -> Result<bool, String> {
    let ps = build_gui_launch_ps_command(recipe, candidates, custom_path);
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &ps,
    ]);
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
    if let Some(path) = super::install::refreshed_path_public() {
        cmd.env("PATH", path);
    }
    let output = cmd
        .output()
        .map_err(|error| format!("failed to launch `{}`: {error}", recipe.id))?;
    Ok(output.status.success())
}

#[cfg(not(target_os = "windows"))]
fn run_gui_launch(
    _recipe: &Recipe,
    _candidates: &[GuiLaunchCandidate],
    _custom_path: Option<&Path>,
) -> Result<bool, String> {
    Err("app launch is only available on Windows".into())
}

/// One utility exposed in an installed tool suite's mini launcher. Used by
/// suites — like Sysinternals — that ship many standalone utilities. GUI tools
/// (`cli == false`) get a one-click Launch button; command-line tools
/// (`cli == true`) are list-only, since launching them with no arguments is
/// useless — the dialog offers a single "open command prompt" action instead.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuickLaunchEntry {
    /// Executable name resolved against the refreshed Windows PATH, e.g.
    /// `procexp.exe`. The closed per-tool allow-list below is the only set of
    /// values `installer_launch_quick_command` will spawn.
    pub command: String,
    /// Human-facing tool name, e.g. "Process Explorer".
    pub label: String,
    /// One-line description shown under the name in the launcher list.
    pub description: String,
    /// Command-line tool: list-only, not directly launchable.
    pub cli: bool,
}

/// Curated launcher entries for installed tool suites. Sysinternals ships many
/// utilities that land on PATH after install (WinGet/Store app execution
/// aliases or Chocolatey shims). GUI tools start by name with the refreshed
/// PATH; CLI tools are listed for discovery and run from the command prompt.
/// Returns an empty list for tools without a launcher.
fn quick_launch_affordance(tool_id: &str) -> Vec<QuickLaunchEntry> {
    fn gui(command: &str, label: &str, description: &str) -> QuickLaunchEntry {
        QuickLaunchEntry {
            command: command.into(),
            label: label.into(),
            description: description.into(),
            cli: false,
        }
    }
    fn cli(command: &str, label: &str, description: &str) -> QuickLaunchEntry {
        QuickLaunchEntry {
            command: command.into(),
            label: label.into(),
            description: description.into(),
            cli: true,
        }
    }
    match tool_id {
        "sysinternals-suite" => vec![
            // GUI tools — open a window when launched with no arguments.
            gui(
                "procexp.exe",
                "Process Explorer",
                "Advanced process viewer: handles, loaded DLLs, and the full process tree.",
            ),
            gui(
                "procmon.exe",
                "Process Monitor",
                "Real-time file system, registry, process, thread, and network activity.",
            ),
            gui(
                "autoruns.exe",
                "Autoruns",
                "Everything configured to start automatically at boot and logon.",
            ),
            gui(
                "tcpview.exe",
                "TCPView",
                "Live view of TCP and UDP endpoints and their owning processes.",
            ),
            gui(
                "zoomit.exe",
                "ZoomIt",
                "Screen zoom, drawing, and break-timer tool for presentations.",
            ),
            gui(
                "rammap.exe",
                "RAMMap",
                "Detailed breakdown of how Windows is using physical memory.",
            ),
            gui(
                "vmmap.exe",
                "VMMap",
                "Analyze a process's virtual and physical memory usage.",
            ),
            gui(
                "diskview.exe",
                "DiskView",
                "Graphical map showing where files are located on a disk.",
            ),
            gui(
                "dbgview.exe",
                "DebugView",
                "Capture kernel and application debug output without a debugger.",
            ),
            gui(
                "winobj.exe",
                "WinObj",
                "Browse the Windows Object Manager namespace.",
            ),
            gui(
                "accessenum.exe",
                "AccessEnum",
                "Audit who has access across a file or registry tree.",
            ),
            gui(
                "shareenum.exe",
                "ShareEnum",
                "Scan network file shares and review their security.",
            ),
            gui(
                "adexplorer.exe",
                "AD Explorer",
                "Browse, edit, and snapshot Active Directory databases.",
            ),
            gui(
                "adinsight.exe",
                "ADInsight",
                "Real-time LDAP activity monitor for Active Directory.",
            ),
            gui(
                "bginfo.exe",
                "BgInfo",
                "Paint system information onto the desktop background.",
            ),
            gui(
                "desktops.exe",
                "Desktops",
                "Run applications across up to four virtual desktops.",
            ),
            gui(
                "disk2vhd.exe",
                "Disk2vhd",
                "Capture a VHD image of a live physical disk.",
            ),
            gui(
                "rdcman.exe",
                "RDCMan",
                "Manage many Remote Desktop connections from one window.",
            ),
            gui(
                "diskmon.exe",
                "DiskMon",
                "Capture and display all hard-disk read/write activity.",
            ),
            gui(
                "autologon.exe",
                "Autologon",
                "Configure Windows to log on automatically.",
            ),
            // CLI tools — list-only; run them from the command prompt.
            cli(
                "accesschk.exe",
                "AccessChk",
                "Show effective permissions for files, keys, services, and more.",
            ),
            cli(
                "handle.exe",
                "Handle",
                "List open handles, or find which process has a file open.",
            ),
            cli(
                "listdlls.exe",
                "ListDLLs",
                "List the DLLs loaded into running processes.",
            ),
            cli(
                "procdump.exe",
                "ProcDump",
                "Generate process crash/hang dumps from the command line.",
            ),
            cli("psexec.exe", "PsExec", "Run programs on remote systems."),
            cli(
                "pslist.exe",
                "PsList",
                "List detailed process and thread statistics.",
            ),
            cli(
                "pskill.exe",
                "PsKill",
                "Kill processes by name or PID, locally or remotely.",
            ),
            cli(
                "psinfo.exe",
                "PsInfo",
                "Gather system information, including installed hotfixes.",
            ),
            cli(
                "psservice.exe",
                "PsService",
                "View and control Windows services.",
            ),
            cli(
                "psloggedon.exe",
                "PsLoggedon",
                "Show who is logged on, locally and via shares.",
            ),
            cli(
                "psloglist.exe",
                "PsLogList",
                "Dump event log records from the command line.",
            ),
            cli(
                "psping.exe",
                "PsPing",
                "Measure latency and bandwidth, including TCP/UDP.",
            ),
            cli(
                "psshutdown.exe",
                "PsShutdown",
                "Shut down or restart local and remote computers.",
            ),
            cli(
                "pssuspend.exe",
                "PsSuspend",
                "Suspend and resume processes.",
            ),
            cli(
                "psgetsid.exe",
                "PsGetSid",
                "Display the SID of a computer or user account.",
            ),
            cli(
                "pspasswd.exe",
                "PsPasswd",
                "Change account passwords locally or remotely.",
            ),
            cli(
                "psfile.exe",
                "PsFile",
                "Show files opened remotely over the network.",
            ),
            cli(
                "sigcheck.exe",
                "Sigcheck",
                "Verify file signatures and versions; query VirusTotal.",
            ),
            cli(
                "streams.exe",
                "Streams",
                "Reveal and delete NTFS alternate data streams.",
            ),
            cli(
                "strings.exe",
                "Strings",
                "Extract printable strings from binary files.",
            ),
            cli(
                "sdelete.exe",
                "SDelete",
                "Securely delete files and wipe free space.",
            ),
            cli(
                "du.exe",
                "Disk Usage (DU)",
                "Report disk space used by a directory tree.",
            ),
            cli(
                "coreinfo.exe",
                "Coreinfo",
                "Map logical processors to sockets, cores, and NUMA nodes.",
            ),
            cli("contig.exe", "Contig", "Defragment individual files."),
            cli(
                "ntfsinfo.exe",
                "NTFSInfo",
                "Show detailed NTFS volume information.",
            ),
            cli(
                "junction.exe",
                "Junction",
                "Create and inspect NTFS directory junctions.",
            ),
            cli(
                "movefile.exe",
                "MoveFile",
                "Schedule file move/delete operations for next boot.",
            ),
            cli(
                "pendmoves.exe",
                "PendMoves",
                "List file operations queued for the next boot.",
            ),
            cli(
                "pipelist.exe",
                "PipeList",
                "List named pipes and their instance counts.",
            ),
            cli(
                "logonsessions.exe",
                "LogonSessions",
                "List the active logon sessions on the system.",
            ),
            cli(
                "clockres.exe",
                "ClockRes",
                "Show the resolution of the system clock.",
            ),
            cli(
                "hex2dec.exe",
                "Hex2dec",
                "Convert numbers between hexadecimal and decimal.",
            ),
            cli("sync.exe", "Sync", "Flush cached file data to disk."),
            cli(
                "whois.exe",
                "Whois",
                "Look up domain registration and IP ownership.",
            ),
            cli(
                "regjump.exe",
                "RegJump",
                "Open Registry Editor directly at a given path.",
            ),
            cli(
                "ru.exe",
                "Registry Usage (RU)",
                "Report the registry space used by a key.",
            ),
        ],
        "coreutils" => vec![
            // All command-line: listed for discovery, run from the terminal.
            cli("ls", "ls", "List directory contents."),
            cli("cat", "cat", "Print file contents."),
            cli("cp", "cp", "Copy files and directories."),
            cli("mv", "mv", "Move or rename files and directories."),
            cli("rm", "rm", "Delete files and directories."),
            cli("mkdir", "mkdir", "Create directories."),
            cli("head", "head", "Show the first lines of a file."),
            cli("tail", "tail", "Show the last lines of a file."),
            cli("sort", "sort", "Sort lines of text."),
            cli("uniq", "uniq", "Filter adjacent duplicate lines."),
            cli("wc", "wc", "Count lines, words, and bytes."),
            cli("cut", "cut", "Extract fields or columns from lines."),
            cli("tr", "tr", "Translate or delete characters."),
            cli("tee", "tee", "Copy stdin to stdout and a file."),
            cli("touch", "touch", "Create files or update timestamps."),
            cli("du", "du", "Report disk usage per directory."),
            cli("date", "date", "Print or format the current date and time."),
            cli("seq", "seq", "Print a sequence of numbers."),
            cli("base64", "base64", "Encode or decode base64 data."),
            cli("sha256sum", "sha256sum", "Compute SHA-256 file checksums."),
        ],
        _ => vec![],
    }
}

#[tauri::command]
pub async fn installer_list_quick_launch(tool_id: String) -> Result<Vec<QuickLaunchEntry>, String> {
    Ok(quick_launch_affordance(&tool_id))
}

#[tauri::command]
pub async fn installer_launch_quick_command(
    tool_id: String,
    command: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = quick_launch_affordance(&tool_id)
            .into_iter()
            .find(|entry| entry.command.eq_ignore_ascii_case(&command))
            .ok_or_else(|| {
                format!("`{command}` is not a known quick-launch command for `{tool_id}`")
            })?;
        if entry.cli {
            return Err(format!(
                "`{command}` is a command-line tool — open a command prompt to run it"
            ));
        }
        spawn_quick_launch(&command)
    })
    .await
    .map_err(|error| format!("failed to launch quick command: {error}"))?
}

/// Open a PowerShell prompt so a suite's command-line tools can be run with
/// their own arguments. Sysinternals opens **elevated** because most of its
/// tools require admin integrity (e.g. `handle`, `psexec`, `sigcheck`);
/// Coreutils opens a normal prompt with usage hints. Only available for
/// tools that expose a quick launcher.
#[tauri::command]
pub async fn installer_open_quick_launch_terminal(tool_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || match tool_id.as_str() {
        "sysinternals-suite" => spawn_elevated_powershell(),
        "coreutils" => spawn_terminal_launcher(
            &TerminalLaunchAffordance {
                activate_ps1: None,
                setup_lines: vec![],
                prefill: "ls".into(),
                hints: vec![
                    "Coreutils commands are on PATH — e.g. ls, cat, head, tail, sort, wc.".into(),
                ],
            },
            None,
            false,
        ),
        _ => Err(format!("tool `{tool_id}` does not have a quick launcher")),
    })
    .await
    .map_err(|error| format!("failed to open quick-launch terminal: {error}"))?
}

fn service_affordance(tool_id: &str) -> Option<ManagedServiceAffordance> {
    match tool_id {
        "n8n" => Some(ManagedServiceAffordance {
            service_name: "KKTerm-n8n".into(),
            display_name: "KKTerm n8n".into(),
            program: npm_program().into(),
            args: vec![
                "exec".into(),
                "--prefix".into(),
                managed_app_install_dir("n8n")
                    .to_string_lossy()
                    .into_owned(),
                "--".into(),
                "n8n".into(),
                "start".into(),
            ],
            env: vec![(
                "N8N_USER_FOLDER",
                managed_app_data_dir("n8n").to_string_lossy().into_owned(),
            )],
            working_dir: managed_app_install_dir("n8n")
                .to_string_lossy()
                .into_owned(),
        }),
        "flowise" => Some(ManagedServiceAffordance {
            service_name: "KKTerm-Flowise".into(),
            display_name: "KKTerm Flowise".into(),
            program: npm_program().into(),
            args: vec![
                "exec".into(),
                "--prefix".into(),
                managed_app_install_dir("flowise")
                    .to_string_lossy()
                    .into_owned(),
                "--".into(),
                "flowise".into(),
                "start".into(),
            ],
            env: flowise_managed_env(),
            working_dir: managed_app_install_dir("flowise")
                .to_string_lossy()
                .into_owned(),
        }),
        "open-webui" => Some(ManagedServiceAffordance {
            service_name: "KKTerm-OpenWebUI".into(),
            display_name: "KKTerm Open WebUI".into(),
            program: managed_uv_pip_script("open-webui", "open-webui"),
            args: vec![
                "serve".into(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                "8080".into(),
            ],
            env: vec![(
                "DATA_DIR",
                managed_app_data_dir("open-webui")
                    .to_string_lossy()
                    .into_owned(),
            )],
            working_dir: managed_app_install_dir("open-webui")
                .to_string_lossy()
                .into_owned(),
        }),
        "langflow" => Some(ManagedServiceAffordance {
            service_name: "KKTerm-Langflow".into(),
            display_name: "KKTerm Langflow".into(),
            program: managed_uv_pip_script("langflow", "langflow"),
            args: vec![
                "run".into(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                "7860".into(),
            ],
            env: vec![(
                "LANGFLOW_CONFIG_DIR",
                managed_app_data_dir("langflow")
                    .to_string_lossy()
                    .into_owned(),
            )],
            working_dir: managed_app_install_dir("langflow")
                .to_string_lossy()
                .into_owned(),
        }),
        "excalidraw" => Some(ManagedServiceAffordance {
            service_name: "KKTerm-Excalidraw".into(),
            display_name: "KKTerm Excalidraw".into(),
            program: npm_program().into(),
            args: vec![
                "exec".into(),
                "--prefix".into(),
                managed_app_install_dir("excalidraw")
                    .to_string_lossy()
                    .into_owned(),
                "--".into(),
                "vite".into(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                "3021".into(),
            ],
            env: vec![],
            working_dir: managed_app_install_dir("excalidraw")
                .to_string_lossy()
                .into_owned(),
        }),
        "bentopdf" => Some(ManagedServiceAffordance {
            service_name: "KKTerm-BentoPDF".into(),
            display_name: "KKTerm BentoPDF".into(),
            program: "node".into(),
            args: vec![
                "kkterm-web-ui-server.mjs".into(),
                "--preferred-port".into(),
                "3022".into(),
            ],
            env: vec![],
            working_dir: managed_app_install_dir("bentopdf")
                .to_string_lossy()
                .into_owned(),
        }),
        "openflowkit" => Some(ManagedServiceAffordance {
            service_name: "KKTerm-OpenFlowKit".into(),
            display_name: "KKTerm OpenFlowKit".into(),
            program: "node".into(),
            args: vec![
                "kkterm-web-ui-server.mjs".into(),
                "--preferred-port".into(),
                "3023".into(),
            ],
            env: vec![],
            working_dir: managed_app_install_dir("openflowkit")
                .to_string_lossy()
                .into_owned(),
        }),
        "ollama" => Some(ManagedServiceAffordance {
            service_name: "KKTerm-Ollama".into(),
            display_name: "KKTerm Ollama".into(),
            program: managed_ollama_program(),
            args: vec!["serve".into()],
            env: vec![(
                "OLLAMA_MODELS",
                managed_app_data_dir("ollama")
                    .join("models")
                    .to_string_lossy()
                    .into_owned(),
            )],
            working_dir: managed_app_install_dir("ollama")
                .to_string_lossy()
                .into_owned(),
        }),
        _ => None,
    }
}

fn flowise_managed_env() -> Vec<(&'static str, String)> {
    let data_dir = managed_app_data_dir("flowise");
    vec![
        (
            "DATABASE_PATH",
            data_dir
                .join("database.sqlite")
                .to_string_lossy()
                .into_owned(),
        ),
        (
            "SECRETKEY_PATH",
            data_dir.join("secret.key").to_string_lossy().into_owned(),
        ),
        (
            "LOG_PATH",
            data_dir.join("logs").to_string_lossy().into_owned(),
        ),
        (
            "BLOB_STORAGE_PATH",
            data_dir.join("storage").to_string_lossy().into_owned(),
        ),
        ("STORAGE_TYPE", "local".into()),
    ]
}

fn managed_npm_package_for_tool(tool_id: &str) -> Option<&'static str> {
    match tool_id {
        "n8n" => Some("n8n"),
        "flowise" => Some("flowise"),
        _ => None,
    }
}

fn read_managed_npm_package_manifest(
    tool_id: &str,
) -> Result<Option<(PathBuf, serde_json::Value)>, String> {
    let Some(package) = managed_npm_package_for_tool(tool_id) else {
        return Ok(None);
    };
    let package_dir = package.split('/').fold(
        managed_app_install_dir(tool_id).join("node_modules"),
        |path, part| path.join(part),
    );
    let manifest = package_dir.join("package.json");
    let text = std::fs::read_to_string(&manifest)
        .map_err(|error| format!("failed to read {}: {error}", manifest.display()))?;
    let package_json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("failed to parse {}: {error}", manifest.display()))?;
    Ok(Some((package_dir, package_json)))
}

fn managed_node_engine_range(tool_id: &str) -> Result<Option<String>, String> {
    let Some((_, package_json)) = read_managed_npm_package_manifest(tool_id)? else {
        return Ok(None);
    };
    Ok(package_json
        .get("engines")
        .and_then(|engines| engines.get("node"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string))
}

#[cfg(target_os = "windows")]
fn compatible_managed_node_runtime(tool_id: &str) -> Result<Option<ManagedNodeRuntime>, String> {
    let Some(engine_range) = managed_node_engine_range(tool_id)? else {
        return Ok(None);
    };
    let Some(nvm_home) = super::install::refreshed_nvm_home_public() else {
        return Ok(None);
    };
    let mut candidates = Vec::new();
    let entries = std::fs::read_dir(&nvm_home)
        .map_err(|error| format!("failed to inspect Node runtimes in {nvm_home}: {error}"))?;
    for entry in entries.flatten() {
        let version_dir = entry.path();
        let node_path = version_dir.join("node.exe");
        if !node_path.is_file() {
            continue;
        }
        let mut probe = Command::new(&node_path);
        probe.args([
            "-p",
            "process.versions.node + '\\t' + (process.release.lts ? 'lts' : '')",
        ]);
        let Ok(output) = no_window(&mut probe).output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let probe_text = String::from_utf8_lossy(&output.stdout);
        let mut fields = probe_text.trim().split('\t');
        let Some(version) = fields.next().filter(|value| !value.is_empty()) else {
            continue;
        };
        candidates.push(ManagedNodeRuntime {
            version: version.to_string(),
            node_path,
            is_lts: fields.next() == Some("lts"),
        });
    }

    let selected = select_compatible_node_runtime(candidates, |candidate| {
        node_engine_satisfied(candidate, &engine_range)
    });
    selected.map(Some).ok_or_else(|| {
        format!(
            "{tool_id} requires Node {engine_range}, but no compatible installed Node LTS was found. Update the Node.js LTS bundle in Install Helper."
        )
    })
}

#[cfg(not(target_os = "windows"))]
fn compatible_managed_node_runtime(_tool_id: &str) -> Result<Option<ManagedNodeRuntime>, String> {
    Ok(None)
}

fn select_compatible_node_runtime(
    candidates: Vec<ManagedNodeRuntime>,
    mut satisfies: impl FnMut(&ManagedNodeRuntime) -> bool,
) -> Option<ManagedNodeRuntime> {
    let mut selected: Option<ManagedNodeRuntime> = None;
    for candidate in candidates {
        if !candidate.is_lts || !satisfies(&candidate) {
            continue;
        }
        let replace = selected.as_ref().is_none_or(|current| {
            installer_latest_is_newer(&candidate.version, &current.version)
        });
        if replace {
            selected = Some(candidate);
        }
    }
    selected
}

#[cfg(target_os = "windows")]
fn node_engine_satisfied(candidate: &ManagedNodeRuntime, engine_range: &str) -> bool {
    let semver_cli = candidate
        .node_path
        .parent()
        .unwrap_or(Path::new(""))
        .join("node_modules")
        .join("npm")
        .join("node_modules")
        .join("semver")
        .join("bin")
        .join("semver.js");
    if !semver_cli.is_file() {
        return false;
    }
    let mut command = Command::new(&candidate.node_path);
    command
        .arg(&semver_cli)
        .arg(&candidate.version)
        .args(["-r", engine_range]);
    no_window(&mut command)
        .output()
        .is_ok_and(|output| output.status.success())
}

fn current_node_version() -> Option<String> {
    let mut command = Command::new("node");
    command.arg("--version");
    if let Some(path) = super::install::refreshed_path_public() {
        command.env("PATH", path);
    }
    let output = no_window(&mut command).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_start_matches('v')
        .to_string();
    (!version.is_empty()).then_some(version)
}

fn managed_node_package_entrypoint(tool_id: &str) -> Result<PathBuf, String> {
    let package = managed_npm_package_for_tool(tool_id)
        .ok_or_else(|| format!("tool `{tool_id}` is not a managed npm app"))?;
    let Some((package_dir, package_json)) = read_managed_npm_package_manifest(tool_id)? else {
        return Err(format!("package metadata is unavailable for `{tool_id}`"));
    };
    let bin = package_json
        .get("bin")
        .ok_or_else(|| format!("package `{package}` does not declare an executable"))?;
    let relative = match bin {
        serde_json::Value::String(value) => Some(value.as_str()),
        serde_json::Value::Object(entries) => entries
            .get(package)
            .or_else(|| entries.get(tool_id))
            .and_then(serde_json::Value::as_str),
        _ => None,
    }
    .ok_or_else(|| format!("package `{package}` does not declare its managed executable"))?;
    let entrypoint = package_dir.join(relative);
    if !entrypoint.is_file() {
        return Err(format!(
            "managed executable is missing: {}",
            entrypoint.display()
        ));
    }
    Ok(entrypoint)
}

fn npm_exec_command_tail(args: &[String]) -> Result<Vec<String>, String> {
    let separator = args
        .iter()
        .position(|arg| arg == "--")
        .ok_or_else(|| "managed npm launch command is missing `--`".to_string())?;
    if args.len() <= separator + 1 {
        return Err("managed npm launch command is missing its executable".to_string());
    }
    Ok(args.iter().skip(separator + 2).cloned().collect())
}

fn managed_npm_direct_launch_args(
    tool_id: &str,
    existing_args: &[String],
) -> Result<Vec<String>, String> {
    let mut args = vec![
        managed_node_package_entrypoint(tool_id)?
            .to_string_lossy()
            .into_owned(),
    ];
    args.extend(npm_exec_command_tail(existing_args)?);
    Ok(args)
}

fn pin_managed_service_node_runtime(
    tool_id: &str,
    service: &mut ManagedServiceAffordance,
) -> Result<bool, String> {
    let Some(runtime) = compatible_managed_node_runtime(tool_id)? else {
        return Ok(false);
    };
    service.args = managed_npm_direct_launch_args(tool_id, &service.args)?;
    service.program = runtime.node_path.to_string_lossy().into_owned();
    Ok(true)
}

fn pin_managed_web_ui_node_runtime(
    tool_id: &str,
    affordance: &mut WebUiAffordance,
) -> Result<bool, String> {
    let Some(runtime) = compatible_managed_node_runtime(tool_id)? else {
        return Ok(false);
    };
    affordance.args = managed_npm_direct_launch_args(tool_id, &affordance.args)?;
    affordance.program = runtime.node_path.to_string_lossy().into_owned();
    Ok(true)
}

fn ensure_nssm_installed(catalog: &Catalog, tool_id: &str, emit: &EventSink) -> Result<(), String> {
    let nssm_recipe = find_recipe(catalog, "nssm")
        .ok_or_else(|| "catalog is missing the NSSM service helper recipe".to_string())?;
    if detect_one(nssm_recipe).installed {
        return Ok(());
    }

    emit(ProgressEvent::Step {
        tool_id: tool_id.into(),
        message: "Installing NSSM service helper".into(),
    });
    install_recipe(
        nssm_recipe,
        &InstallOptions::default(),
        Arc::new(AtomicBool::new(false)),
        emit,
    )?;
    Ok(())
}

fn service_install_script(service: &ManagedServiceAffordance) -> String {
    let service_name = quote_cmd_always(&service.service_name);
    let (program_setup_lines, service_program, service_prefix_args) =
        service_program_for_install_script(&service.program);
    let log_dir = service_log_dir(service);
    let stdout_log = service_log_path(service, "stdout");
    let stderr_log = service_log_path(service, "stderr");
    let mut install_line = format!("nssm install {} {}", service_name, service_program);
    for arg in &service_prefix_args {
        install_line.push(' ');
        install_line.push_str(arg);
    }
    for arg in &service.args {
        install_line.push(' ');
        install_line.push_str(&quote_cmd_arg(arg));
    }

    let mut lines = vec![
        "@echo off".to_string(),
        "setlocal".to_string(),
        "where nssm >nul 2>nul".to_string(),
        "if errorlevel 1 (".to_string(),
        "  echo NSSM is required. Install NSSM from KKTerm Install Helper first.".to_string(),
        "  exit /b 2".to_string(),
        ")".to_string(),
    ];
    lines.extend(program_setup_lines);
    lines.extend([
        format!(
            "if not exist {} mkdir {}",
            quote_cmd_arg(&log_dir),
            quote_cmd_arg(&log_dir)
        ),
        format!("nssm stop {} >nul 2>nul", service_name),
        format!("nssm remove {} confirm >nul 2>nul", service_name),
        install_line,
        format!(
            "nssm set {} DisplayName {}",
            service_name,
            quote_cmd_arg(&service.display_name)
        ),
        format!(
            "nssm set {} AppDirectory {}",
            service_name,
            quote_cmd_arg(&service.working_dir)
        ),
        format!(
            "nssm set {} AppStdout {}",
            service_name,
            quote_cmd_arg(&stdout_log)
        ),
        format!(
            "nssm set {} AppStderr {}",
            service_name,
            quote_cmd_arg(&stderr_log)
        ),
    ]);
    if !service.env.is_empty() {
        let env_values = service
            .env
            .iter()
            .map(|(key, value)| quote_cmd_arg(&format!("{key}={value}")))
            .collect::<Vec<_>>()
            .join(" ");
        lines.push(format!(
            "nssm set {} AppEnvironmentExtra {}",
            service_name, env_values
        ));
    }
    lines.push(format!(
        "nssm set {} Start SERVICE_AUTO_START",
        service_name
    ));
    lines.push(format!("nssm set {} AppExit Default Exit", service_name));
    lines.push(format!("nssm start {}", service_name));
    lines.join("\r\n")
}

fn service_log_dir(service: &ManagedServiceAffordance) -> String {
    Path::new(&service.working_dir)
        .join("logs")
        .to_string_lossy()
        .into_owned()
}

fn service_log_path(service: &ManagedServiceAffordance, stream: &str) -> String {
    Path::new(&service_log_dir(service))
        .join(format!("{}.{}.log", service.service_name, stream))
        .to_string_lossy()
        .into_owned()
}

fn service_program_for_install_script(program: &str) -> (Vec<String>, String, Vec<String>) {
    if cfg!(target_os = "windows")
        && (program.eq_ignore_ascii_case("node") || program.eq_ignore_ascii_case("node.exe"))
    {
        return (
            vec![
                "set \"KKTERM_SERVICE_NODE=\"".to_string(),
                "for %%I in (node.exe) do set \"KKTERM_SERVICE_NODE=%%~$PATH:I\"".to_string(),
                "if not defined KKTERM_SERVICE_NODE (".to_string(),
                "  echo node.exe is required. Install Node.js from KKTerm Install Helper first."
                    .to_string(),
                "  exit /b 2".to_string(),
                ")".to_string(),
            ],
            "\"%KKTERM_SERVICE_NODE%\"".to_string(),
            Vec::new(),
        );
    }
    if cfg!(target_os = "windows") && program.eq_ignore_ascii_case(npm_program()) {
        return (
            vec![
                "set \"KKTERM_SERVICE_NODE=\"".to_string(),
                "set \"KKTERM_NPM_CMD=\"".to_string(),
                "set \"KKTERM_NPM_CLI=\"".to_string(),
                "for %%I in (node.exe) do set \"KKTERM_SERVICE_NODE=%%~$PATH:I\"".to_string(),
                format!(
                    "for %%I in ({}) do set \"KKTERM_NPM_CMD=%%~$PATH:I\"",
                    npm_program()
                ),
                "if not defined KKTERM_SERVICE_NODE (".to_string(),
                "  echo node.exe is required. Install Node.js from KKTerm Install Helper first."
                    .to_string(),
                "  exit /b 2".to_string(),
                ")".to_string(),
                "if not defined KKTERM_NPM_CMD (".to_string(),
                "  echo npm.cmd is required. Install Node.js from KKTerm Install Helper first."
                    .to_string(),
                "  exit /b 2".to_string(),
                ")".to_string(),
                "for %%I in (\"%KKTERM_NPM_CMD%\") do set \"KKTERM_NPM_CLI=%%~dpInode_modules\\npm\\bin\\npm-cli.js\"".to_string(),
                "if not exist \"%KKTERM_NPM_CLI%\" (".to_string(),
                "  echo npm-cli.js was not found beside npm.cmd. Reinstall Node.js from KKTerm Install Helper.".to_string(),
                "  exit /b 2".to_string(),
                ")".to_string(),
            ],
            "\"%KKTERM_SERVICE_NODE%\"".to_string(),
            vec!["\"%KKTERM_NPM_CLI%\"".to_string()],
        );
    }
    (Vec::new(), quote_cmd_arg(program), Vec::new())
}

fn service_remove_script(service_name: &str) -> String {
    let service_name = quote_cmd_always(service_name);
    [
        "@echo off".to_string(),
        "setlocal".to_string(),
        "where nssm >nul 2>nul".to_string(),
        "if errorlevel 1 (".to_string(),
        "  echo NSSM is required. Install NSSM from KKTerm Install Helper first.".to_string(),
        "  exit /b 2".to_string(),
        ")".to_string(),
        format!("nssm stop {} >nul 2>nul", service_name),
        format!("nssm remove {} confirm", service_name),
    ]
    .join("\r\n")
}

fn service_control_script(service_name: &str, action: &str) -> String {
    let service_name = quote_cmd_always(service_name);
    [
        "@echo off".to_string(),
        "setlocal".to_string(),
        "where nssm >nul 2>nul".to_string(),
        "if errorlevel 1 (".to_string(),
        "  echo NSSM is required. Install NSSM from KKTerm Install Helper first.".to_string(),
        "  exit /b 2".to_string(),
        ")".to_string(),
        format!("nssm {action} {}", service_name),
    ]
    .join("\r\n")
}

fn service_runtime_start_script(service: &ManagedServiceAffordance, action: &str) -> String {
    let service_name = quote_cmd_always(&service.service_name);
    let parameters = service
        .args
        .iter()
        .map(|arg| quote_cmd_arg(arg))
        .collect::<Vec<_>>()
        .join(" ");
    [
        "@echo off".to_string(),
        "setlocal".to_string(),
        "where nssm >nul 2>nul".to_string(),
        "if errorlevel 1 (".to_string(),
        "  echo NSSM is required. Install NSSM from KKTerm Install Helper first.".to_string(),
        "  exit /b 2".to_string(),
        ")".to_string(),
        format!(
            "nssm set {} Application {}",
            service_name,
            quote_cmd_arg(&service.program)
        ),
        format!("nssm set {} AppParameters {}", service_name, parameters),
        format!("nssm {action} {}", service_name),
    ]
    .join("\r\n")
}

fn web_ui_status(tool_id: &str, affordance: &WebUiAffordance) -> ManagedWebUiStatus {
    let service = service_affordance(tool_id);
    let service_state = service
        .as_ref()
        .and_then(|service| query_service_state(&service.service_name));
    let service_installed = service_state.is_some();
    let effective_port = effective_web_ui_port(affordance);
    let running = matches!(service_state.as_deref(), Some("RUNNING"))
        || effective_port.map(is_local_port_listening).unwrap_or(false);
    let startup = service
        .as_ref()
        .and_then(|service| query_service_startup(&service.service_name));
    let node_requirement = managed_node_engine_range(tool_id).ok().flatten();
    let (node_version, node_runtime_version) = if node_requirement.is_some() {
        (
            current_node_version(),
            compatible_managed_node_runtime(tool_id)
                .ok()
                .flatten()
                .map(|runtime| runtime.version),
        )
    } else {
        (None, None)
    };
    ManagedWebUiStatus {
        running,
        service_installed,
        service_state,
        startup,
        node_version,
        node_runtime_version,
        node_requirement,
        url: effective_port
            .map(|port| format!("http://localhost:{port}"))
            .unwrap_or_else(|| affordance.url.to_string()),
    }
}

fn start_web_ui_for_tool(tool_id: &str) -> Result<(), String> {
    let mut affordance = web_ui_affordance(tool_id)
        .ok_or_else(|| format!("tool `{tool_id}` does not expose a managed web UI"))?;
    if let Some(mut service) = service_affordance(tool_id) {
        let pinned_runtime = pin_managed_service_node_runtime(tool_id, &mut service)?;
        match query_service_state(&service.service_name).as_deref() {
            Some("RUNNING" | "START_PENDING") => return Ok(()),
            Some(_) => {
                let script = if pinned_runtime {
                    service_runtime_start_script(&service, "start")
                } else {
                    service_control_script(&service.service_name, "start")
                };
                return run_elevated_cmd_script(
                    &script,
                    &format!("start service {}", service.service_name),
                );
            }
            None => {}
        }
    }
    pin_managed_web_ui_node_runtime(tool_id, &mut affordance)?;
    spawn_web_ui_affordance(&affordance)
}

fn stop_web_ui_for_tool(tool_id: &str) -> Result<(), String> {
    let affordance = web_ui_affordance(tool_id)
        .ok_or_else(|| format!("tool `{tool_id}` does not expose a managed web UI"))?;
    if let Some(service) = service_affordance(tool_id).filter(|s| {
        matches!(
            query_service_state(&s.service_name).as_deref(),
            Some("RUNNING")
        )
    }) {
        run_elevated_cmd_script(
            &service_control_script(&service.service_name, "stop"),
            &format!("stop service {}", service.service_name),
        )?;
        if let Some(port) = effective_web_ui_port(&affordance) {
            stop_port_listener(port)?;
        }
        return Ok(());
    }
    effective_web_ui_port(&affordance)
        .ok_or_else(|| format!("tool `{tool_id}` does not have a recorded web UI port"))
        .and_then(stop_port_listener)
}

fn effective_web_ui_port(affordance: &WebUiAffordance) -> Option<u16> {
    affordance
        .dynamic_port_file
        .as_deref()
        .and_then(read_managed_web_ui_port)
        .or_else(|| {
            if affordance.dynamic_port_file.is_some() {
                None
            } else {
                Some(affordance.port)
            }
        })
}

fn port_to_stop_before_service(affordance: &WebUiAffordance) -> Option<u16> {
    if affordance.dynamic_port_file.is_some() {
        affordance
            .dynamic_port_file
            .as_deref()
            .and_then(read_managed_web_ui_port)
    } else {
        Some(affordance.port)
    }
}

fn read_managed_web_ui_port(path: &str) -> Option<u16> {
    let raw = std::fs::read_to_string(path).ok()?;
    raw.trim().parse::<u16>().ok()
}

fn is_local_port_listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

#[cfg(target_os = "windows")]
fn query_service_state(service_name: &str) -> Option<String> {
    let mut command = Command::new("sc");
    command.args(["query", service_name]);
    let output = no_window(&mut command).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("STATE") {
            return line.split_whitespace().last().map(|s| s.to_string());
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn query_service_state(_service_name: &str) -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn query_service_startup(service_name: &str) -> Option<String> {
    let mut command = Command::new("sc");
    command.args(["qc", service_name]);
    let output = no_window(&mut command).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("START_TYPE") {
            return line
                .split_once(':')
                .map(|(_, value)| value.trim().to_string());
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn query_service_startup(_service_name: &str) -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn stop_port_listener(port: u16) -> Result<(), String> {
    let command = format!(
        "$ids = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); foreach ($id in $ids) {{ Stop-Process -Id $id -Force -ErrorAction Stop }}"
    );
    let mut powershell = Command::new("powershell");
    powershell.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &command,
    ]);
    let status = no_window(&mut powershell)
        .status()
        .map_err(|error| format!("failed to stop localhost:{port}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("stop localhost:{port} exited with status {status}"))
    }
}

#[cfg(not(target_os = "windows"))]
fn stop_port_listener(_port: u16) -> Result<(), String> {
    Err("managed web UI stop is only available on Windows".into())
}

#[cfg(target_os = "windows")]
fn run_elevated_cmd_script(script: &str, label: &str) -> Result<(), String> {
    let script_path = std::env::temp_dir().join(format!(
        "kkterm-installer-service-{}-{}.cmd",
        sanitize_filename(label),
        unix_now_secs()
    ));
    std::fs::write(&script_path, script).map_err(|error| error.to_string())?;
    let script_arg = ps_single_quote(&script_path.to_string_lossy());
    let command = format!(
        "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/C', {script_arg}) -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
    );
    let mut powershell = Command::new("powershell");
    powershell.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &command,
    ]);
    if let Some(path) = super::install::refreshed_path_public() {
        powershell.env("PATH", path);
    }
    let status = powershell
        .status()
        .map_err(|error| format!("failed to start elevated service helper: {error}"))?;
    let _ = std::fs::remove_file(&script_path);
    if status.success() {
        Ok(())
    } else {
        Err(format!("service helper exited with status {status}"))
    }
}

#[cfg(not(target_os = "windows"))]
fn run_elevated_cmd_script(_script: &str, _label: &str) -> Result<(), String> {
    Err("Windows service helpers are only available on Windows".into())
}

fn sanitize_filename(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn ps_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(target_os = "windows")]
fn spawn_terminal_launcher(
    affordance: &TerminalLaunchAffordance,
    working_dir: Option<&std::path::Path>,
    execute: bool,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    // KKTerm's release binary uses the Windows GUI subsystem and therefore has
    // no interactive standard handles to inherit. `Command::spawn` with
    // CREATE_NEW_CONSOLE can leave the delegated Windows Terminal tab blank;
    // ShellExecute creates the console through the Windows shell instead.
    let parameters = build_terminal_launcher_shell_parameters(
        affordance,
        super::install::refreshed_path_public().as_deref(),
        execute,
    );
    let file = "powershell.exe"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    let parameters = parameters
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    let working_directory = working_dir.map(|dir| {
        dir.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>()
    });
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            null(),
            file.as_ptr(),
            parameters.as_ptr(),
            working_directory
                .as_ref()
                .map(|value| value.as_ptr())
                .unwrap_or(null()),
            SW_SHOWNORMAL,
        )
    } as isize;

    if result <= 32 {
        return Err(format!(
            "failed to spawn terminal (ShellExecuteW code {result})"
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn spawn_terminal_launcher(
    _affordance: &TerminalLaunchAffordance,
    _working_dir: Option<&std::path::Path>,
    _execute: bool,
) -> Result<(), String> {
    Err("terminal launcher is only available on Windows".into())
}

/// PowerShell that resolves a quick-launch executable against the refreshed
/// PATH and starts it **elevated**. Many Sysinternals GUI tools embed a
/// `requireAdministrator` manifest, so a plain CreateProcess fails with
/// `os error 740` ("requires elevation"); launching every tool through
/// `Start-Process -Verb RunAs` shows the normal UAC consent prompt instead.
fn build_quick_launch_ps_command(command: &str) -> String {
    let escaped = command.replace('\'', "''");
    format!(
        "$ErrorActionPreference = 'Stop'; \
         $exe = (Get-Command '{escaped}' -ErrorAction SilentlyContinue).Source; \
         if (-not $exe) {{ Write-Error 'not found on PATH'; exit 1 }}; \
         Start-Process -FilePath $exe -Verb RunAs"
    )
}

fn build_elevated_powershell_ps_command(refreshed_path: Option<&str>) -> String {
    let mut elevated_parts = vec![
        "$host.UI.RawUI.WindowTitle = 'KKTerm Sysinternals tools'".to_string(),
        "Write-Host 'Sysinternals command-line tools are on PATH — e.g. handle, psexec, sigcheck, strings, sdelete.' -ForegroundColor Cyan".to_string(),
    ];
    if let Some(path) = refreshed_path {
        elevated_parts.insert(0, format!("$env:PATH = {}", ps_single_quote(path)));
    }
    let elevated_command = ps_single_quote(&elevated_parts.join("; "));
    format!(
        "Start-Process -FilePath 'powershell' -ArgumentList @('-NoExit', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', {elevated_command}) -Verb RunAs"
    )
}

#[cfg(target_os = "windows")]
fn spawn_quick_launch(command: &str) -> Result<(), String> {
    let ps = build_quick_launch_ps_command(command);
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &ps,
    ]);
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
    if let Some(path) = super::install::refreshed_path_public() {
        cmd.env("PATH", path);
    }
    cmd.spawn()
        .map_err(|error| format!("failed to launch `{command}`: {error}"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn spawn_quick_launch(_command: &str) -> Result<(), String> {
    Err("quick launch is only available on Windows".into())
}

/// Open a standard elevated Windows PowerShell window so a suite's
/// command-line tools (e.g. Sysinternals `handle`, `psexec`) can be run with
/// their own arguments at admin integrity. The launcher process stays hidden
/// and only relays the UAC consent prompt.
#[cfg(target_os = "windows")]
fn spawn_elevated_powershell() -> Result<(), String> {
    let refreshed_path = super::install::refreshed_path_public();
    let ps = build_elevated_powershell_ps_command(refreshed_path.as_deref());
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &ps,
    ]);
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
        .map_err(|error| format!("failed to open elevated PowerShell: {error}"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn spawn_elevated_powershell() -> Result<(), String> {
    Err("elevated PowerShell is only available on Windows".into())
}

fn build_terminal_launcher_ps_command(
    affordance: &TerminalLaunchAffordance,
    execute: bool,
) -> String {
    let mut parts: Vec<String> = vec![
        "$host.UI.RawUI.WindowTitle = 'KKTerm terminal'".into(),
    ];
    if !execute {
        parts.push("Import-Module PSReadLine -ErrorAction SilentlyContinue".into());
    }
    if let Some(activate) = &affordance.activate_ps1 {
        let escaped = activate.replace('\'', "''");
        parts.push(format!("& '{escaped}'"));
    }
    parts.extend(affordance.setup_lines.iter().cloned());
    parts.push("Write-Host ''".into());
    for hint in &affordance.hints {
        let escaped = hint.replace('\'', "''");
        parts.push(format!("Write-Host '  {escaped}' -ForegroundColor Cyan"));
    }
    parts.push("Write-Host ''".into());
    if execute {
        let (program, arguments) = affordance
            .prefill
            .split_once(' ')
            .map_or((affordance.prefill.as_str(), None), |(program, arguments)| {
                (program, Some(arguments))
            });
        parts.push("$ErrorActionPreference = 'Stop'".into());
        let executable_names = [".exe", ".com", ".cmd", ".bat"]
            .map(|extension| ps_single_quote(&format!("{program}{extension}")))
            .join(", ");
        parts.push(format!(
            "$__kkt_launcher = @({executable_names}) | ForEach-Object {{ Get-Command $_ -ErrorAction SilentlyContinue }} | Select-Object -First 1"
        ));
        parts.push(format!(
            "if (-not $__kkt_launcher) {{ throw {} }}",
            ps_single_quote(&format!("{program} was not found on PATH"))
        ));
        let mut launch = "Start-Process -FilePath $__kkt_launcher.Source".to_string();
        if let Some(arguments) = arguments {
            launch.push_str(&format!(
                " -ArgumentList {}",
                ps_single_quote(arguments)
            ));
        }
        launch.push_str(" -NoNewWindow -Wait");
        parts.push(launch);
    } else {
        let prefill_escaped = affordance.prefill.replace('\'', "''");
        parts.push(format!(
            "$null = Register-EngineEvent -SourceIdentifier PowerShell.OnIdle -MaxTriggerCount 1 -Action {{ if (Get-Module PSReadLine) {{ [Microsoft.PowerShell.PSConsoleReadLine]::Insert('{prefill_escaped}') }} }}"
        ));
    }
    parts.join("; ")
}

fn build_terminal_launcher_shell_parameters(
    affordance: &TerminalLaunchAffordance,
    refreshed_path: Option<&str>,
    execute: bool,
) -> String {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let mut ps_command = build_terminal_launcher_ps_command(affordance, execute);
    if let Some(path) = refreshed_path {
        ps_command = format!(
            "$__kkt_refreshed_path = {}; $__kkt_path_entries = [System.Collections.Generic.List[string]]::new(); foreach ($__kkt_path_entry in @(($env:PATH -split ';') + ($__kkt_refreshed_path -split ';'))) {{ if ($__kkt_path_entry -and -not ($__kkt_path_entries -contains $__kkt_path_entry)) {{ $__kkt_path_entries.Add($__kkt_path_entry) }} }}; $env:PATH = $__kkt_path_entries -join ';'; Remove-Variable __kkt_refreshed_path, __kkt_path_entries, __kkt_path_entry -ErrorAction SilentlyContinue; {ps_command}",
            ps_single_quote(path)
        );
    }
    let utf16_le = ps_command
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<u8>>();
    format!(
        "-NoExit -NoLogo -ExecutionPolicy Bypass -EncodedCommand {}",
        STANDARD.encode(utf16_le)
    )
}

#[cfg(target_os = "windows")]
fn spawn_web_ui_affordance(affordance: &WebUiAffordance) -> Result<(), String> {
    let mut command = Command::new(&affordance.program);
    command
        .args(&affordance.args)
        .envs(affordance.env.iter().map(|(key, value)| (*key, value)))
        .current_dir(&affordance.working_dir);
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
    if let Some(path) = super::install::refreshed_path_public() {
        command.env("PATH", path);
    }
    command.spawn().map_err(|error| {
        format!(
            "failed to run `{}`: {error}",
            web_ui_command_line(affordance)
        )
    })?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn spawn_web_ui_affordance(affordance: &WebUiAffordance) -> Result<(), String> {
    Command::new(&affordance.program)
        .args(&affordance.args)
        .envs(affordance.env.iter().map(|(key, value)| (*key, value)))
        .current_dir(&affordance.working_dir)
        .spawn()
        .map_err(|error| {
            format!(
                "failed to run `{}`: {error}",
                std::iter::once(affordance.program.clone())
                    .chain(affordance.args.iter().cloned())
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        })?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn web_ui_command_line(affordance: &WebUiAffordance) -> String {
    std::iter::once(affordance.program.as_str())
        .chain(affordance.args.iter().map(String::as_str))
        .map(quote_cmd_arg)
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_cmd_arg(arg: &str) -> String {
    if arg.is_empty()
        || arg.chars().any(|ch| {
            ch.is_whitespace()
                || matches!(
                    ch,
                    '&' | '('
                        | ')'
                        | '['
                        | ']'
                        | '{'
                        | '}'
                        | '^'
                        | '='
                        | ';'
                        | '!'
                        | '\''
                        | '+'
                        | ','
                        | '`'
                        | '~'
                )
        })
    {
        format!("\"{}\"", arg.replace('"', "\"\""))
    } else {
        arg.to_string()
    }
}

fn quote_cmd_always(arg: &str) -> String {
    format!("\"{}\"", arg.replace('"', "\"\""))
}

fn managed_ollama_program() -> String {
    let local_exe = managed_app_install_dir("ollama")
        .join("app")
        .join("ollama.exe");
    if local_exe.exists() {
        return local_exe.to_string_lossy().into_owned();
    }
    "ollama".into()
}

fn managed_uv_pip_script(tool_id: &str, script: &str) -> String {
    let venv = managed_app_install_dir(tool_id).join(".venv");
    let local_exe = if cfg!(target_os = "windows") {
        venv.join("Scripts").join(format!("{script}.exe"))
    } else {
        venv.join("bin").join(script)
    };
    local_exe.to_string_lossy().into_owned()
}

fn unix_now_secs() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn run_bundle_install(
    _app: &AppHandle,
    catalog: &Catalog,
    bundle_id: &str,
    steps: &[String],
    options: &InstallOptions,
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    emit(ProgressEvent::Step {
        tool_id: bundle_id.into(),
        message: format!("Installing bundle ({} step(s))", steps.len()),
    });
    for step_id in steps {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let step_recipe = find_recipe(catalog, step_id)
            .ok_or_else(|| format!("bundle step `{step_id}` not found"))?;
        let detected = detect_one(step_recipe);
        if detected.installed {
            let latest = latest_version_in_catalog(step_recipe, catalog)
                .ok()
                .flatten();
            if !installed_bundle_step_has_update(&detected, latest.as_deref()) {
                emit(ProgressEvent::Stdout {
                    tool_id: bundle_id.into(),
                    step_id: None,
                    line: format!("Step `{step_id}` already installed, skipping"),
                });
                continue;
            }
            emit(ProgressEvent::Stdout {
                tool_id: bundle_id.into(),
                step_id: None,
                line: format!(
                    "Step `{step_id}` update available ({} → {}), installing",
                    detected.installed_version.as_deref().unwrap_or("unknown"),
                    latest.as_deref().unwrap_or("unknown")
                ),
            });
        }
        emit(ProgressEvent::Step {
            tool_id: bundle_id.into(),
            message: format!("→ {step_id}"),
        });
        install_recipe(step_recipe, options, cancel.clone(), emit)?;
    }
    for (program, args) in bundle_followup_install_commands(bundle_id) {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        emit(ProgressEvent::Step {
            tool_id: bundle_id.into(),
            message: format!("{program} {}", args.join(" ")),
        });
        let args: Vec<String> = args.iter().map(|arg| (*arg).into()).collect();
        super::install::run_streamed_with_refreshed_path_public(
            program,
            &args,
            bundle_id,
            cancel.clone(),
            emit,
        )?;
    }
    Ok(None)
}

fn installed_bundle_step_has_update(
    detected: &DetectedState,
    latest_version: Option<&str>,
) -> bool {
    let Some(installed_version) = detected.installed_version.as_deref() else {
        return false;
    };
    let Some(latest_version) = latest_version else {
        return false;
    };
    installer_latest_is_newer(latest_version, installed_version)
}

fn bundle_followup_install_commands(bundle_id: &str) -> Vec<(&'static str, Vec<&'static str>)> {
    match bundle_id {
        "node-bundle" => vec![("nvm", vec!["install", "lts"]), ("nvm", vec!["use", "lts"])],
        "python-bundle" => vec![
            ("uv", vec!["python", "install", "3.13", "--default"]),
            ("uv", vec!["python", "pin", "--global", "3.13"]),
        ],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_bundle_followup_installs_and_uses_lts() {
        let commands = bundle_followup_install_commands("node-bundle");

        assert_eq!(
            commands,
            vec![("nvm", vec!["install", "lts"]), ("nvm", vec!["use", "lts"]),]
        );
    }

    #[test]
    fn python_bundle_followup_installs_default_python_313() {
        let commands = bundle_followup_install_commands("python-bundle");

        assert_eq!(
            commands,
            vec![
                ("uv", vec!["python", "install", "3.13", "--default"]),
                ("uv", vec!["python", "pin", "--global", "3.13"]),
            ]
        );
    }

    #[test]
    fn installed_bundle_step_installs_when_latest_is_newer() {
        let detected = DetectedState::installed(Some("0.11.15".into()));

        assert!(installed_bundle_step_has_update(&detected, Some("0.11.17")));
    }

    #[test]
    fn installed_bundle_step_skips_when_latest_is_equal_or_unknown() {
        let detected = DetectedState::installed(Some("0.11.17".into()));

        assert!(!installed_bundle_step_has_update(
            &detected,
            Some("0.11.17")
        ));
        assert!(!installed_bundle_step_has_update(
            &detected,
            Some("0.11.17.0")
        ));
        assert!(!installed_bundle_step_has_update(&detected, None));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn n8n_web_ui_affordance_runs_start_and_opens_localhost() {
        let affordance = web_ui_affordance("n8n").expect("n8n should expose a web UI");

        assert_eq!(affordance.url, "http://localhost:5678");
        assert_eq!(affordance.program, "npm.cmd");
        assert!(affordance.args.iter().any(|arg| arg == "--prefix"));
        assert!(affordance.args.iter().any(|arg| arg == "n8n"));
        assert!(affordance.env.iter().any(|(key, value)| {
            *key == "N8N_USER_FOLDER" && value.ends_with(r"installer\apps\n8n\data")
        }));
    }

    #[test]
    fn requested_managed_web_apps_expose_local_web_ui_affordances() {
        let cases = [
            ("flowise", "http://localhost:3000", "flowise"),
            ("open-webui", "http://localhost:8080", "open-webui"),
            ("langflow", "http://localhost:7860", "langflow"),
            ("excalidraw", "http://localhost:3021", "vite"),
            ("bentopdf", "http://localhost:3022", "node"),
            ("openflowkit", "http://localhost:3023", "node"),
        ];

        for (tool_id, url, command_name) in cases {
            let affordance =
                web_ui_affordance(tool_id).unwrap_or_else(|| panic!("{tool_id} should run"));
            assert_eq!(affordance.url, url);
            assert!(
                affordance.program.contains(command_name)
                    || affordance.args.iter().any(|arg| arg == command_name),
                "{tool_id} should run {command_name}"
            );
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn ollama_web_ui_affordance_runs_server_with_app_local_models() {
        let affordance = web_ui_affordance("ollama").expect("Ollama should expose a local server");

        assert_eq!(affordance.url, "http://localhost:11434");
        assert_eq!(affordance.args, vec!["serve"]);
        assert!(affordance.env.iter().any(|(key, value)| {
            *key == "OLLAMA_MODELS" && value.ends_with(r"installer\apps\ollama\data\models")
        }));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn web_ui_command_line_quotes_windows_paths_with_spaces() {
        let affordance = WebUiAffordance {
            program:
                r"C:\Users\Ryan User\AppData\Local\KKTerm\installer\apps\ollama\app\ollama.exe"
                    .into(),
            args: vec!["serve".into()],
            env: vec![],
            working_dir: r"C:\Users\Ryan User\AppData\Local\KKTerm\installer\apps\ollama".into(),
            url: "http://localhost:11434",
            port: 11434,
            dynamic_port_file: None,
        };

        assert_eq!(
            web_ui_command_line(&affordance),
            r#""C:\Users\Ryan User\AppData\Local\KKTerm\installer\apps\ollama\app\ollama.exe" serve"#
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn web_ui_runs_without_cmd_title_window() {
        let source = include_str!("commands.rs");
        let spawn_body = source
            .split("fn spawn_web_ui_affordance")
            .nth(1)
            .and_then(|rest| rest.split("#[cfg(not(target_os = \"windows\"))]").next())
            .expect("Windows web UI spawn helper should exist");

        assert!(spawn_body.contains("CREATE_NO_WINDOW"));
        assert!(!spawn_body.contains("KKTerm web tool"));
        assert!(!spawn_body.contains(".args([\"/K\""));
    }

    #[test]
    fn terminal_launcher_prefill_preserves_profile_prompt() {
        use base64::{Engine as _, engine::general_purpose::STANDARD};

        let affordance = TerminalLaunchAffordance {
            activate_ps1: None,
            setup_lines: vec![],
            prefill: "hermes setup".into(),
            hints: vec![],
        };

        let command = build_terminal_launcher_ps_command(&affordance, false);

        assert!(command.contains("Import-Module PSReadLine"));
        assert!(command.contains("[Microsoft.PowerShell.PSConsoleReadLine]::Insert"));
        assert!(!command.contains("PSReadLine.PSConsoleReadLine"));
        assert!(command.contains("PowerShell.OnIdle"));
        assert!(!command.contains("function global:prompt"));

        let parameters =
            build_terminal_launcher_shell_parameters(
                &affordance,
                Some(r"C:\Tools;C:\Windows"),
                false,
            );
        let encoded = parameters
            .split_whitespace()
            .last()
            .expect("encoded command argument");
        let bytes = STANDARD.decode(encoded).expect("valid base64 command");
        let words = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        let decoded = String::from_utf16(&words).expect("valid UTF-16LE command");

        assert!(!parameters.contains("-NoProfile"));
        assert!(parameters.contains("-EncodedCommand"));
        assert!(decoded.contains("$__kkt_refreshed_path = 'C:\\Tools;C:\\Windows'"));
        assert!(decoded.contains("$env:PATH -split ';'"));
        assert!(decoded.contains("$__kkt_refreshed_path -split ';'"));
        assert!(!decoded.starts_with("$env:PATH ="));
        assert!(decoded.contains("hermes setup"));
    }

    #[test]
    fn terminal_launcher_execute_starts_command_in_current_console() {
        let affordance = TerminalLaunchAffordance {
            activate_ps1: None,
            setup_lines: vec![],
            prefill: "claude --model 'opus'".into(),
            hints: vec![],
        };

        let command = build_terminal_launcher_ps_command(&affordance, true);

        assert!(command.contains("'claude.exe', 'claude.com', 'claude.cmd', 'claude.bat'"));
        assert!(command.contains("Start-Process -FilePath $__kkt_launcher.Source"));
        assert!(command.contains("-ArgumentList '--model ''opus'''"));
        assert!(command.contains("-NoNewWindow -Wait"));
        assert!(!command.contains("PSConsoleReadLine]::Insert"));
    }

    #[test]
    fn terminal_launch_affordances_match_upstream_setup_commands() {
        let hermes = terminal_launch_affordance("hermes-agent")
            .expect("Hermes should expose a terminal launcher");
        assert_eq!(hermes.prefill, "hermes setup");
        assert!(
            hermes
                .hints
                .iter()
                .any(|hint| hint.starts_with("hermes setup")),
            "Hermes launcher should point users to the official setup wizard"
        );

        let openclaw =
            terminal_launch_affordance("openclaw").expect("OpenClaw should expose a launcher");
        assert_eq!(openclaw.prefill, "openclaw onboard --install-daemon");
        assert!(
            openclaw
                .hints
                .iter()
                .any(|hint| hint.starts_with("openclaw onboard --install-daemon")),
            "OpenClaw launcher should point users to onboarding"
        );
    }

    #[test]
    fn cli_terminal_launchers_cover_curated_command_line_tools() {
        for tool_id in [
            "git",
            "winget",
            "chocolatey",
            "node-bundle",
            "python-bundle",
            "wsl",
            "nssm",
            "oh-my-posh",
            "antigravity-cli",
            "claude-code-cli",
            "codex-cli",
            "cursor-cli",
            "kimi-code-cli",
            "grok-build",
            "opencode",
            "pi",
            "oh-my-pi",
            "rustup",
            "bun",
            "ripgrep",
            "jq",
            "fzf",
            "ffmpeg",
            "scrcpy",
            "psmux",
            "hermes-agent",
            "openclaw",
        ] {
            let affordance = terminal_launch_affordance(tool_id)
                .unwrap_or_else(|| panic!("`{tool_id}` should expose a terminal launcher"));
            assert!(
                !affordance.prefill.is_empty(),
                "`{tool_id}` launcher should prefill a starter command"
            );
        }
        for tool_id in [
            "antigravity-cli",
            "claude-code-cli",
            "codex-cli",
            "cursor-cli",
            "kimi-code-cli",
            "grok-build",
            "opencode",
            "pi",
            "oh-my-pi",
        ] {
            assert!(
                terminal_launch_affordance(tool_id)
                    .expect("coding agent launcher")
                    .hints
                    .is_empty(),
                "coding-agent launchers should use option controls instead of samples"
            );
        }
        assert!(
            terminal_launch_affordance("vscode").is_none(),
            "GUI apps launch directly instead of through the terminal launcher"
        );
    }

    #[test]
    fn launch_dir_validation_requires_an_existing_absolute_directory() {
        assert!(validated_launch_dir("").is_err());
        assert!(validated_launch_dir("   ").is_err());
        assert!(validated_launch_dir("relative\\project").is_err());

        let temp = std::env::temp_dir();
        assert_eq!(
            validated_launch_dir(temp.to_string_lossy().as_ref()).as_deref(),
            Ok(temp.as_path())
        );

        let missing = temp.join("kkterm-launch-dir-that-does-not-exist");
        assert!(validated_launch_dir(missing.to_string_lossy().as_ref()).is_err());
    }

    #[test]
    fn gui_launch_affordance_is_a_closed_allow_list() {
        // GUI apps expose at least one executable candidate.
        for tool_id in [
            "vscode",
            "google-chrome",
            "firefox",
            "acrobat-reader",
            "blender",
            "obs-studio",
            "7zip",
        ] {
            assert!(
                !gui_launch_affordance(tool_id).is_empty(),
                "`{tool_id}` should expose GUI launch candidates"
            );
        }

        // CLI tools and unknown ids resolve to nothing.
        assert!(gui_launch_affordance("git").is_empty());
        assert!(gui_launch_affordance("ripgrep").is_empty());
        assert!(gui_launch_affordance("does-not-exist").is_empty());
    }

    #[test]
    fn terminal_launcher_arguments_are_bounded_and_single_line() {
        assert_eq!(
            validated_launcher_arguments(Some("  --auto --model test  ")),
            Ok(Some("--auto --model test".into()))
        );
        assert_eq!(validated_launcher_arguments(Some("  ")), Ok(None));
        assert!(validated_launcher_arguments(Some("--auto\nwhoami")).is_err());
        assert!(validated_launcher_arguments(Some(&"x".repeat(4097))).is_err());
    }

    #[test]
    fn gui_launch_ps_resolves_paths_commands_and_appx() {
        let catalog = load_bundled_catalog().expect("bundled catalog");
        let recipe = find_recipe(&catalog, "blender").expect("Blender recipe");
        let command = build_gui_launch_ps_command(
            recipe,
            &[
                GuiLaunchCandidate::Path(
                    "%ProgramFiles%\\Blender Foundation\\Blender *\\blender.exe",
                ),
                GuiLaunchCandidate::Command("chrome.exe"),
                GuiLaunchCandidate::Appx("OpenAI.Codex"),
            ],
            None,
        );

        // Env tokens expand at resolve time; globs pick the highest match.
        assert!(command.contains("[Environment]::ExpandEnvironmentVariables"));
        assert!(command.contains("Sort-Object -Property FullName -Descending"));
        // Bare names consult PATH and the App Paths registry.
        assert!(command.contains("Get-Command 'chrome.exe'"));
        assert!(command.contains("App Paths\\chrome.exe"));
        // Prefer authoritative Windows app registrations over fallback paths.
        assert!(command.contains("Get-StartApps"));
        assert!(command.contains("DisplayIcon"));
        assert!(command.contains("Test-AllowedExe"));
        assert!(command.contains("Test-LaunchableAppId"));
        assert!(command.contains("Get-VersionSortKey"));
        // Store apps launch through shell:AppsFolder.
        assert!(command.contains("Get-AppxPackage -Name 'OpenAI.Codex'"));
        assert!(command.contains("shell:AppsFolder"));
        // Apps start from their own directory (OBS refuses to start elsewhere).
        assert!(command.contains("-WorkingDirectory (Split-Path -Parent $exe)"));
        // No hit is an error the frontend can surface.
        assert!(command.ends_with("exit 1"));
    }

    #[test]
    fn custom_gui_launchers_accept_windows_executables_and_shortcuts_only() {
        for path in ["tool.exe", "tool.COM", "tool.bat", "tool.cmd", "tool.lnk"] {
            assert!(is_supported_custom_gui_launcher(Path::new(path)), "{path}");
        }
        for path in ["tool.ps1", "tool.msi", "tool.url", "tool.txt"] {
            assert!(!is_supported_custom_gui_launcher(Path::new(path)), "{path}");
        }
        assert!(validated_custom_gui_launcher("relative.exe").is_err());
        let existing = std::env::temp_dir().join(format!(
            "kkterm-custom-launcher-test-{}.exe",
            std::process::id()
        ));
        std::fs::write(&existing, []).expect("create launcher fixture");
        assert!(validated_custom_gui_launcher(&existing.to_string_lossy()).is_ok());
        std::fs::remove_file(existing).expect("remove launcher fixture");
    }

    #[test]
    fn custom_gui_launcher_is_the_final_resolver_candidate() {
        let catalog = load_bundled_catalog().expect("bundled catalog");
        let recipe = find_recipe(&catalog, "obsidian").expect("Obsidian recipe");
        let command = build_gui_launch_ps_command(
            recipe,
            &gui_launch_affordance("obsidian"),
            Some(Path::new(r"C:\Custom Apps\Obsidian.lnk")),
        );
        let custom = command
            .rfind("C:\\Custom Apps\\Obsidian.lnk")
            .expect("custom path in script");
        let automatic = command
            .rfind("%LOCALAPPDATA%")
            .expect("automatic candidates in script");
        assert!(custom > automatic);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn all_gui_launch_scripts_parse_in_windows_powershell() {
        let catalog = load_bundled_catalog().expect("bundled catalog");
        for tool_id in [
            "vscode",
            "cursor",
            "notepadpp",
            "docker-desktop",
            "comfyui",
            "lmstudio",
            "bruno",
            "claude-desktop",
            "codex-desktop",
            "powertoys",
            "powershell-7",
            "everything",
            "ditto",
            "keepassxc",
            "7zip",
            "sharex",
            "tailscale",
            "rustdesk",
            "google-chrome",
            "firefox",
            "acrobat-reader",
            "obsidian",
            "drawio",
            "krita",
            "inkscape",
            "blender",
            "pencil",
            "vlc",
            "obs-studio",
            "xnview-mp",
            "audacity",
            "vcxsrv",
        ] {
            let recipe = find_recipe(&catalog, tool_id).expect("GUI recipe");
            let custom_path =
                (tool_id == "obsidian").then(|| Path::new(r"C:\Custom Apps\Selected Launcher.lnk"));
            let script =
                build_gui_launch_ps_command(recipe, &gui_launch_affordance(tool_id), custom_path);
            let parse_only = format!(
                "$null = [ScriptBlock]::Create({})",
                ps_single_quote(&script)
            );
            let output = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &parse_only])
                .output()
                .expect("Windows PowerShell should be available");
            assert!(
                output.status.success(),
                "{tool_id} launch script should parse: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    #[test]
    fn coreutils_quick_launch_lists_cli_utilities() {
        let entries = quick_launch_affordance("coreutils");
        assert!(entries.len() >= 15);
        assert!(
            entries.iter().all(|entry| entry.cli),
            "Coreutils utilities are terminal commands, not launchable GUI tools"
        );
        assert!(
            entries
                .iter()
                .any(|entry| entry.command.eq_ignore_ascii_case("ls"))
        );
    }

    #[test]
    fn sysinternals_quick_launch_exposes_gui_and_cli_tools() {
        let entries = quick_launch_affordance("sysinternals-suite");

        // Process Explorer is a GUI tool that can be launched directly.
        let procexp = entries
            .iter()
            .find(|entry| entry.command.eq_ignore_ascii_case("procexp.exe"))
            .expect("Sysinternals quick launch should offer Process Explorer");
        assert!(!procexp.cli, "Process Explorer is a GUI tool");

        // PsExec is a command-line tool: listed for discovery, not launchable.
        let psexec = entries
            .iter()
            .find(|entry| entry.command.eq_ignore_ascii_case("psexec.exe"))
            .expect("Sysinternals quick launch should list PsExec");
        assert!(psexec.cli, "PsExec is a command-line tool");

        // Every entry carries a label and a description for the searchable list.
        assert!(
            entries
                .iter()
                .all(|entry| !entry.label.is_empty() && !entry.description.is_empty())
        );
        // The suite ships dozens of tools, including both GUI and CLI ones.
        assert!(entries.len() > 30);
        assert!(entries.iter().any(|entry| entry.cli));
        assert!(entries.iter().any(|entry| !entry.cli));

        // Tools without a curated launcher list return nothing.
        assert!(quick_launch_affordance("git").is_empty());
    }

    #[test]
    fn quick_launch_runs_elevated_after_resolving_on_path() {
        let command = build_quick_launch_ps_command("procexp.exe");
        // Resolve the exe against the (refreshed) PATH, then elevate via RunAs.
        assert!(command.contains("Get-Command 'procexp.exe'"));
        assert!(command.contains("Start-Process -FilePath $exe -Verb RunAs"));
    }

    #[test]
    fn quick_launch_terminal_forwards_refreshed_path_to_elevated_shell() {
        let command = build_elevated_powershell_ps_command(Some("C:\\Tools;C:\\Sysinternals"));
        assert!(command.contains("Start-Process -FilePath 'powershell'"));
        assert!(command.contains("-Verb RunAs"));
        assert!(command.contains("$env:PATH = ''C:\\Tools;C:\\Sysinternals''"));
        assert!(command.contains("-NoExit"));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn managed_web_ui_affordances_run_from_app_local_working_dir() {
        for tool_id in [
            "open-webui",
            "langflow",
            "excalidraw",
            "bentopdf",
            "openflowkit",
            "n8n",
            "flowise",
        ] {
            let affordance =
                web_ui_affordance(tool_id).unwrap_or_else(|| panic!("{tool_id} should run"));

            assert!(
                affordance
                    .working_dir
                    .ends_with(&format!(r"installer\apps\{tool_id}")),
                "{tool_id} should run from its managed app directory"
            );
        }
    }

    #[test]
    fn unknown_tools_do_not_get_web_ui_affordances() {
        assert!(web_ui_affordance("git").is_none());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn n8n_service_affordance_uses_managed_app_command_and_data_dir() {
        let service =
            service_affordance("n8n").expect("n8n should expose a Windows service helper");

        assert_eq!(service.service_name, "KKTerm-n8n");
        assert_eq!(service.display_name, "KKTerm n8n");
        assert_eq!(service.program, "npm.cmd");
        assert!(service.args.iter().any(|arg| arg == "--prefix"));
        assert!(service.args.iter().any(|arg| arg == "n8n"));
        assert!(service.env.iter().any(|(key, value)| {
            *key == "N8N_USER_FOLDER" && value.ends_with(r"installer\apps\n8n\data")
        }));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn flowise_affordances_use_managed_app_data_paths() {
        for env in [
            web_ui_affordance("flowise")
                .expect("Flowise should expose a web UI helper")
                .env,
            service_affordance("flowise")
                .expect("Flowise should expose a Windows service helper")
                .env,
        ] {
            assert!(env.iter().any(|(key, value)| {
                *key == "DATABASE_PATH"
                    && value.ends_with(r"installer\apps\flowise\data\database.sqlite")
            }));
            assert!(env.iter().any(|(key, value)| {
                *key == "SECRETKEY_PATH"
                    && value.ends_with(r"installer\apps\flowise\data\secret.key")
            }));
            assert!(env.iter().any(|(key, value)| {
                *key == "LOG_PATH" && value.ends_with(r"installer\apps\flowise\data\logs")
            }));
            assert!(env.iter().any(|(key, value)| {
                *key == "BLOB_STORAGE_PATH"
                    && value.ends_with(r"installer\apps\flowise\data\storage")
            }));
            assert!(
                env.iter()
                    .any(|(key, value)| *key == "STORAGE_TYPE" && value == "local")
            );
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn ollama_service_affordance_uses_app_local_models_dir() {
        let service =
            service_affordance("ollama").expect("Ollama should expose a Windows service helper");

        assert_eq!(service.service_name, "KKTerm-Ollama");
        assert_eq!(service.args, vec!["serve"]);
        assert!(service.env.iter().any(|(key, value)| {
            *key == "OLLAMA_MODELS" && value.ends_with(r"installer\apps\ollama\data\models")
        }));
    }

    #[test]
    fn managed_web_ui_apps_expose_service_affordances() {
        for tool_id in [
            "ollama",
            "n8n",
            "open-webui",
            "flowise",
            "langflow",
            "excalidraw",
            "bentopdf",
            "openflowkit",
        ] {
            assert!(
                service_affordance(tool_id).is_some(),
                "{tool_id} should expose a Windows service helper"
            );
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn service_install_script_uses_nssm_and_quoted_command() {
        let service = ManagedServiceAffordance {
            service_name: "KKTerm-Test".into(),
            display_name: "KKTerm Test".into(),
            program: r"C:\Program Files\Test App\app.exe".into(),
            args: vec!["serve".into()],
            env: vec![("TEST_HOME", r"C:\Users\Ryan User\AppData\Local\Test".into())],
            working_dir: r"C:\Users\Ryan User\AppData\Local\Test".into(),
        };
        let script = service_install_script(&service);

        assert!(
            script.contains(
                r#"nssm install "KKTerm-Test" "C:\Program Files\Test App\app.exe" serve"#
            )
        );
        assert!(script.contains(
            r#"nssm set "KKTerm-Test" AppDirectory "C:\Users\Ryan User\AppData\Local\Test""#
        ));
        assert!(script.contains(
            r#"if not exist "C:\Users\Ryan User\AppData\Local\Test\logs" mkdir "C:\Users\Ryan User\AppData\Local\Test\logs""#
        ));
        assert!(script.contains(
            r#"nssm set "KKTerm-Test" AppStdout "C:\Users\Ryan User\AppData\Local\Test\logs\KKTerm-Test.stdout.log""#
        ));
        assert!(script.contains(
            r#"nssm set "KKTerm-Test" AppStderr "C:\Users\Ryan User\AppData\Local\Test\logs\KKTerm-Test.stderr.log""#
        ));
        assert!(script.contains(r#"nssm set "KKTerm-Test" AppEnvironmentExtra "TEST_HOME=C:\Users\Ryan User\AppData\Local\Test""#));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn service_install_script_registers_node_instead_of_npm_cmd_shim() {
        let service = ManagedServiceAffordance {
            service_name: "KKTerm-Test".into(),
            display_name: "KKTerm Test".into(),
            program: npm_program().into(),
            args: vec!["exec".into(), "--".into(), "vite".into()],
            env: vec![],
            working_dir: r"C:\Users\Ryan User\AppData\Local\Test".into(),
        };
        let script = service_install_script(&service);

        assert!(
            script.contains(r#"for %%I in (node.exe) do set "KKTERM_SERVICE_NODE=%%~$PATH:I""#)
        );
        assert!(script.contains(r#"for %%I in (npm.cmd) do set "KKTERM_NPM_CMD=%%~$PATH:I""#));
        assert!(script.contains(r#"node_modules\npm\bin\npm-cli.js"#));
        assert!(script.contains(
            r#"nssm install "KKTerm-Test" "%KKTERM_SERVICE_NODE%" "%KKTERM_NPM_CLI%" exec -- vite"#
        ));
        assert!(!script.contains(r#"nssm install "KKTerm-Test" "%KKTERM_SERVICE_APP%""#));
        assert!(!script.contains(r#"nssm install "KKTerm-Test" npm.cmd"#));
    }

    #[test]
    fn service_install_script_registers_auto_start_and_starts_after_port_cleanup() {
        let service = ManagedServiceAffordance {
            service_name: "KKTerm-Test".into(),
            display_name: "KKTerm Test".into(),
            program: "test.exe".into(),
            args: vec![],
            env: vec![],
            working_dir: r"C:\Test".into(),
        };
        let script = service_install_script(&service);

        assert!(script.contains(r#"nssm set "KKTerm-Test" Start SERVICE_AUTO_START"#));
        assert!(script.contains(r#"nssm set "KKTerm-Test" AppExit Default Exit"#));
        assert!(
            script.contains(r#"nssm start "KKTerm-Test""#),
            "the command handler clears the normal localhost run before registration, so the service can start in the background"
        );
    }

    #[test]
    fn managed_node_runtime_prefers_newest_compatible_lts() {
        let candidate = |version: &str, is_lts| ManagedNodeRuntime {
            version: version.into(),
            node_path: PathBuf::from(format!(r"C:\nvm\v{version}\node.exe")),
            is_lts,
        };
        let selected = select_compatible_node_runtime(
            vec![
                candidate("22.16.0", true),
                candidate("24.13.0", true),
                candidate("26.4.0", false),
            ],
            |runtime| runtime.version != "22.16.0",
        )
        .expect("a compatible LTS should be selected");

        assert_eq!(selected.version, "24.13.0");
    }

    #[test]
    fn managed_npm_launch_bypasses_npm_runtime_shim() {
        let args = vec![
            "exec".into(),
            "--prefix".into(),
            r"C:\Apps\n8n".into(),
            "--".into(),
            "n8n".into(),
            "start".into(),
        ];

        assert_eq!(npm_exec_command_tail(&args).unwrap(), vec!["start"]);
    }

    #[test]
    fn service_runtime_start_repins_node_before_starting() {
        let service = ManagedServiceAffordance {
            service_name: "KKTerm-n8n".into(),
            display_name: "KKTerm n8n".into(),
            program: r"C:\nvm\v24.13.0\node.exe".into(),
            args: vec![
                r"C:\Apps\n8n\node_modules\n8n\bin\n8n".into(),
                "start".into(),
            ],
            env: vec![],
            working_dir: r"C:\Apps\n8n".into(),
        };
        let script = service_runtime_start_script(&service, "start");

        assert!(script.contains(
            r#"nssm set "KKTerm-n8n" Application C:\nvm\v24.13.0\node.exe"#
        ));
        assert!(script.contains("AppParameters"));
        assert!(script.contains(r"C:\Apps\n8n\node_modules\n8n\bin\n8n"));
        assert!(!script.contains("npm-cli.js"));
        assert!(script.contains(r#"nssm start "KKTerm-n8n""#));
    }

    #[test]
    fn stop_web_ui_service_path_cleans_up_recorded_port() {
        let source = include_str!("commands.rs");
        let service_stop = source
            .split("fn stop_web_ui_for_tool")
            .nth(1)
            .expect("stop helper should exist");

        assert!(service_stop.contains("service_control_script"));
        assert!(
            service_stop.contains("stop_port_listener(port)?"),
            "service stop should also kill the managed web UI process listening on the recorded port"
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn bentopdf_service_runs_dynamic_port_server() {
        let service = service_affordance("bentopdf")
            .expect("BentoPDF should expose a Windows service helper");

        assert_eq!(service.service_name, "KKTerm-BentoPDF");
        assert_eq!(service.display_name, "KKTerm BentoPDF");
        assert_eq!(service.program, "node");
        assert!(
            service
                .args
                .iter()
                .any(|arg| arg == "kkterm-web-ui-server.mjs")
        );

        let script = service_install_script(&service);
        assert!(
            script.contains(r#"for %%I in (node.exe) do set "KKTERM_SERVICE_NODE=%%~$PATH:I""#)
        );
        assert!(script.contains(
            r#"nssm install "KKTerm-BentoPDF" "%KKTERM_SERVICE_NODE%" kkterm-web-ui-server.mjs --preferred-port 3022"#
        ));
    }

    #[test]
    fn stop_web_ui_for_tool_rejects_unknown_tool_ids() {
        let error = stop_web_ui_for_tool("git").expect_err("git has no managed web UI");

        assert!(error.contains("does not expose a managed web UI"));
    }
}

fn run_bundle_uninstall(
    catalog: &Catalog,
    bundle_id: &str,
    steps: &[String],
    cancel: Arc<AtomicBool>,
    emit: &EventSink,
) -> Result<Option<String>, String> {
    emit(ProgressEvent::Step {
        tool_id: bundle_id.into(),
        message: format!("Uninstalling bundle ({} step(s))", steps.len()),
    });
    // Reverse order: uninstall consumers before dependencies.
    for step_id in steps.iter().rev() {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let step_recipe = find_recipe(catalog, step_id)
            .ok_or_else(|| format!("bundle step `{step_id}` not found"))?;
        let detected = detect_one(step_recipe);
        if !detected.installed {
            continue;
        }
        emit(ProgressEvent::Step {
            tool_id: bundle_id.into(),
            message: format!("→ uninstall {step_id}"),
        });
        uninstall_recipe(step_recipe, cancel.clone(), emit)?;
    }
    Ok(None)
}

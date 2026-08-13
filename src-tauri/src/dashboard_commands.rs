use std::collections::HashSet;
use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::dashboard_ids::new_dashboard_id;
use crate::dashboard_storage::{
    self as ds, CustomWidgetPatch, DashboardCustomWidget, DashboardLoadState, DashboardView,
    DashboardWidgetInstance, InstancePatch, LayoutEntry, ViewPatch,
};
use crate::secrets;

/// Portable widget-file format marker. A single export holds one widget; an
/// "export all" holds many — the same `widgets` array shape covers both, so a
/// single importer handles either file.
const WIDGET_EXPORT_FORMAT: &str = "kkterm-widgets";
const WIDGET_EXPORT_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetExportFile {
    pub product: String,
    pub format: String,
    pub version: u32,
    pub widgets: Vec<WidgetExportEntry>,
}

/// One widget's portable definition. Excludes id/createdAt/createdBy on purpose:
/// those are machine-local and reassigned fresh on import so a shared file never
/// collides with or shadows the importer's existing rows.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetExportEntry {
    pub title: String,
    pub summary: String,
    pub category: String,
    pub body_json: String,
    pub settings_schema_json: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DashboardCommandError {
    Validation {
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    NotFound,
    InstancesExist {
        instance_ids: Vec<String>,
    },
    Internal {
        message: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCreatedWidget {
    pub custom_widget: DashboardCustomWidget,
    pub instance: DashboardWidgetInstance,
}

impl From<ds::DashboardStorageError> for DashboardCommandError {
    fn from(value: ds::DashboardStorageError) -> Self {
        match value {
            ds::DashboardStorageError::Validation { kind, detail } => {
                DashboardCommandError::Validation {
                    reason: format!("{:?}", kind),
                    detail,
                }
            }
            ds::DashboardStorageError::NotFound => DashboardCommandError::NotFound,
            ds::DashboardStorageError::InstancesExist { instance_ids } => {
                DashboardCommandError::InstancesExist { instance_ids }
            }
            ds::DashboardStorageError::Sqlite(e) => DashboardCommandError::Internal {
                message: e.to_string(),
            },
        }
    }
}

fn storage(app: &AppHandle) -> State<'_, crate::storage::Storage> {
    app.state::<crate::storage::Storage>()
}

#[tauri::command]
pub async fn dashboard_load_state(
    app: AppHandle,
) -> Result<DashboardLoadState, DashboardCommandError> {
    crate::storage::run_blocking_db(|| {
        storage(&app).with_connection_infallible(|conn| ds::load_state(conn).map_err(Into::into))
    })
}

#[tauri::command]
pub fn dashboard_create_view(
    app: AppHandle,
    title: String,
    grid_density: Option<String>,
) -> Result<DashboardView, DashboardCommandError> {
    let id = new_dashboard_id("view");
    storage(&app).with_connection_infallible(|conn| {
        ds::create_view(conn, &id, &title, grid_density.as_deref()).map_err(Into::into)
    })
}

#[tauri::command]
pub fn dashboard_update_view(
    app: AppHandle,
    id: String,
    patch: ViewPatch,
) -> Result<DashboardView, DashboardCommandError> {
    let result = storage(&app).with_connection_infallible(
        |conn| -> Result<DashboardView, DashboardCommandError> {
            ds::update_view(conn, &id, &patch).map_err(Into::into)
        },
    )?;
    crate::prune_unreferenced_backgrounds(&app);
    Ok(result)
}

#[tauri::command]
pub fn dashboard_remove_view(app: AppHandle, id: String) -> Result<(), DashboardCommandError> {
    storage(&app).with_connection_infallible(|conn| -> Result<(), DashboardCommandError> {
        ds::remove_view(conn, &id).map_err(Into::into)
    })?;
    crate::prune_unreferenced_backgrounds(&app);
    Ok(())
}

#[tauri::command]
pub fn dashboard_reorder_views(
    app: AppHandle,
    ordered_ids: Vec<String>,
) -> Result<(), DashboardCommandError> {
    storage(&app).with_connection_infallible(|conn| {
        ds::reorder_views(conn, &ordered_ids).map_err(Into::into)
    })
}

#[tauri::command]
pub fn dashboard_add_instance(
    app: AppHandle,
    view_id: String,
    kind: String,
    source_id: String,
    preset: String,
    accent_name: String,
    icon_name: String,
    grid_x: i64,
    grid_y: i64,
    grid_w: i64,
    grid_h: i64,
) -> Result<DashboardWidgetInstance, DashboardCommandError> {
    let id = new_dashboard_id("inst");
    storage(&app).with_connection_infallible(|conn| {
        ds::add_instance(
            conn,
            &id,
            &view_id,
            &kind,
            &source_id,
            &preset,
            &accent_name,
            &icon_name,
            grid_x,
            grid_y,
            grid_w,
            grid_h,
        )
        .map_err(Into::into)
    })
}

#[tauri::command]
pub fn dashboard_update_instance(
    app: AppHandle,
    id: String,
    patch: InstancePatch,
) -> Result<DashboardWidgetInstance, DashboardCommandError> {
    storage(&app).with_connection_infallible(|conn| {
        ds::update_instance(conn, &id, &patch).map_err(Into::into)
    })
}

#[tauri::command]
pub fn dashboard_read_widget_secret(
    app: AppHandle,
    secrets: State<'_, secrets::Secrets>,
    instance_id: String,
    key: String,
) -> Result<Option<String>, DashboardCommandError> {
    let owner_id = storage(&app).with_connection_infallible(|conn| {
        ds::widget_secret_owner_id_for_instance(conn, &instance_id, &key)
            .map_err(DashboardCommandError::from)
    })?;
    match owner_id {
        Some(owner_id) => secrets
            .read_widget_secret(owner_id)
            .map_err(|message| DashboardCommandError::Internal { message }),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn dashboard_remove_instance(app: AppHandle, id: String) -> Result<(), DashboardCommandError> {
    storage(&app)
        .with_connection_infallible(|conn| ds::remove_instance(conn, &id).map_err(Into::into))
}

#[tauri::command]
pub fn dashboard_apply_layout(
    app: AppHandle,
    view_id: String,
    layout: Vec<LayoutEntry>,
) -> Result<(), DashboardCommandError> {
    storage(&app).with_connection_infallible(|conn| {
        ds::apply_layout(conn, &view_id, &layout).map_err(Into::into)
    })
}

#[tauri::command]
pub fn dashboard_create_widget(
    app: AppHandle,
    view_id: String,
    title: String,
    summary: String,
    category: String,
    body: Value,
    settings_schema: Option<Value>,
    preset: String,
    accent_name: String,
    icon_name: String,
    grid_x: i64,
    grid_y: i64,
    grid_w: i64,
    grid_h: i64,
) -> Result<DashboardCreatedWidget, DashboardCommandError> {
    let body_json =
        serde_json::to_string(&body).map_err(|error| DashboardCommandError::Internal {
            message: error.to_string(),
        })?;
    let settings_schema_json = settings_schema
        .map(|schema| {
            serde_json::to_string(&schema).map_err(|error| DashboardCommandError::Internal {
                message: error.to_string(),
            })
        })
        .transpose()?;
    let custom_widget_id = new_dashboard_id("cw");
    let instance_id = new_dashboard_id("inst");
    storage(&app).with_connection_infallible(|conn| {
        let custom_widget = ds::create_custom_widget(
            conn,
            &custom_widget_id,
            &title,
            &summary,
            &category,
            &body_json,
            settings_schema_json.as_deref(),
            "agent",
        )?;
        let instance = match ds::add_instance(
            conn,
            &instance_id,
            &view_id,
            "script",
            &custom_widget_id,
            &preset,
            &accent_name,
            &icon_name,
            grid_x,
            grid_y,
            grid_w,
            grid_h,
        ) {
            Ok(instance) => instance,
            Err(error) => {
                let _ = ds::remove_custom_widget(conn, &custom_widget_id, true);
                return Err(error.into());
            }
        };
        Ok(DashboardCreatedWidget {
            custom_widget,
            instance,
        })
    })
}

#[tauri::command]
pub fn dashboard_create_custom_widget(
    app: AppHandle,
    title: String,
    summary: String,
    category: String,
    body_json: String,
    settings_schema_json: Option<String>,
    created_by: String,
) -> Result<DashboardCustomWidget, DashboardCommandError> {
    let id = new_dashboard_id("cw");
    storage(&app).with_connection_infallible(|conn| {
        ds::create_custom_widget(
            conn,
            &id,
            &title,
            &summary,
            &category,
            &body_json,
            settings_schema_json.as_deref(),
            &created_by,
        )
        .map_err(Into::into)
    })
}

#[tauri::command]
pub fn dashboard_update_custom_widget(
    app: AppHandle,
    id: String,
    patch: CustomWidgetPatch,
) -> Result<DashboardCustomWidget, DashboardCommandError> {
    storage(&app).with_connection_infallible(|conn| {
        ds::update_custom_widget(conn, &id, &patch).map_err(Into::into)
    })
}

#[tauri::command]
pub fn dashboard_remove_custom_widget(
    app: AppHandle,
    id: String,
    force_delete_instances: bool,
) -> Result<(), DashboardCommandError> {
    storage(&app).with_connection_infallible(|conn| {
        ds::remove_custom_widget(conn, &id, force_delete_instances).map_err(Into::into)
    })
}

#[tauri::command]
pub fn dashboard_reset(app: AppHandle) -> Result<(), DashboardCommandError> {
    storage(&app).with_connection_infallible(|conn| -> Result<(), DashboardCommandError> {
        ds::reset_dashboard(conn).map_err(Into::into)
    })?;
    crate::prune_unreferenced_backgrounds(&app);
    Ok(())
}

/// Write the named custom widgets (or all of them when `ids` is empty) to a
/// `.kkwidget` JSON file at `path`. The file is portable and secret-free: widget
/// definitions never contain credentials (instance secrets live separately).
#[tauri::command]
pub fn export_dashboard_widgets(
    app: AppHandle,
    path: String,
    ids: Vec<String>,
) -> Result<usize, DashboardCommandError> {
    let widgets = storage(&app).with_connection_infallible(|conn| {
        ds::list_custom_widgets_for_export(conn, &ids).map_err(DashboardCommandError::from)
    })?;
    if widgets.is_empty() {
        return Err(DashboardCommandError::NotFound);
    }
    let file = WidgetExportFile {
        product: "KKTerm".to_string(),
        format: WIDGET_EXPORT_FORMAT.to_string(),
        version: WIDGET_EXPORT_VERSION,
        widgets: widgets
            .into_iter()
            .map(|widget| WidgetExportEntry {
                title: widget.title,
                summary: widget.summary,
                category: widget.category,
                body_json: widget.body_json,
                settings_schema_json: widget.settings_schema_json,
            })
            .collect(),
    };
    let count = file.widgets.len();
    let serialized =
        serde_json::to_string_pretty(&file).map_err(|error| DashboardCommandError::Internal {
            message: error.to_string(),
        })?;
    fs::write(&path, serialized).map_err(|error| DashboardCommandError::Internal {
        message: format!("failed to write widget export {path}: {error}"),
    })?;
    Ok(count)
}

/// Import widgets from a `.kkwidget` JSON file, inserting each as a new
/// imported custom widget with a fresh id. Additive — never overwrites
/// existing widgets; on a title collision the imported title gets a suffix so it
/// stays distinguishable in the catalog. Returns the created rows so the store
/// can append them live without a reload.
#[tauri::command]
pub fn import_dashboard_widgets(
    app: AppHandle,
    path: String,
) -> Result<Vec<DashboardCustomWidget>, DashboardCommandError> {
    let raw = fs::read_to_string(&path).map_err(|error| DashboardCommandError::Internal {
        message: format!("failed to read widget file {path}: {error}"),
    })?;
    import_dashboard_widgets_from_json(app, raw)
}

#[tauri::command]
pub fn read_dashboard_widget_import_file(path: String) -> Result<String, DashboardCommandError> {
    fs::read_to_string(&path).map_err(|error| DashboardCommandError::Internal {
        message: format!("failed to read widget file {path}: {error}"),
    })
}

#[tauri::command]
pub fn import_dashboard_widgets_json(
    app: AppHandle,
    raw_json: String,
) -> Result<Vec<DashboardCustomWidget>, DashboardCommandError> {
    import_dashboard_widgets_from_json(app, raw_json)
}

fn import_dashboard_widgets_from_json(
    app: AppHandle,
    raw_json: String,
) -> Result<Vec<DashboardCustomWidget>, DashboardCommandError> {
    let parsed: WidgetExportFile =
        serde_json::from_str(&raw_json).map_err(|error| DashboardCommandError::Validation {
            reason: "InvalidWidgetFile".to_string(),
            detail: Some(error.to_string()),
        })?;
    if parsed.format != WIDGET_EXPORT_FORMAT {
        return Err(DashboardCommandError::Validation {
            reason: "InvalidWidgetFile".to_string(),
            detail: Some(format!(
                "unsupported widget file format {:?}",
                parsed.format
            )),
        });
    }
    if parsed.version > WIDGET_EXPORT_VERSION {
        return Err(DashboardCommandError::Validation {
            reason: "InvalidWidgetFile".to_string(),
            detail: Some(format!(
                "widget file version {} is newer than supported ({WIDGET_EXPORT_VERSION})",
                parsed.version
            )),
        });
    }
    if parsed.widgets.is_empty() {
        return Err(DashboardCommandError::Validation {
            reason: "InvalidWidgetFile".to_string(),
            detail: Some("widget file contains no widgets".to_string()),
        });
    }

    storage(&app).with_connection_infallible(|conn| {
        let mut taken = ds::custom_widget_titles(conn).map_err(DashboardCommandError::from)?;
        let mut created = Vec::with_capacity(parsed.widgets.len());
        for (index, entry) in parsed.widgets.into_iter().enumerate() {
            let title = unique_widget_title(&entry.title, &taken);
            // new_dashboard_id is millisecond-stamped, so a multi-widget import
            // would collide within the same tick; the index disambiguates.
            let id = format!("{}-{index}", new_dashboard_id("cw"));
            let widget = ds::create_custom_widget(
                conn,
                &id,
                &title,
                &entry.summary,
                &entry.category,
                &entry.body_json,
                Some(&entry.settings_schema_json),
                "imported",
            )?;
            taken.insert(widget.title.clone());
            created.push(widget);
        }
        Ok(created)
    })
}

/// Pick a title not already present in `taken`, appending "(imported)" and then a
/// counter so repeated imports of the same widget stay distinct.
fn unique_widget_title(base: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(base) {
        return base.to_string();
    }
    let suffixed = format!("{base} (imported)");
    if !taken.contains(&suffixed) {
        return suffixed;
    }
    for counter in 2.. {
        let candidate = format!("{base} (imported {counter})");
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    unreachable!("counter range is unbounded")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_title_suffixes_on_collision() {
        let mut taken = HashSet::new();
        assert_eq!(unique_widget_title("Clock", &taken), "Clock");
        taken.insert("Clock".to_string());
        assert_eq!(unique_widget_title("Clock", &taken), "Clock (imported)");
        taken.insert("Clock (imported)".to_string());
        assert_eq!(unique_widget_title("Clock", &taken), "Clock (imported 2)");
    }
}

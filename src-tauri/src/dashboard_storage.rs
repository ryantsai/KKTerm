use std::collections::HashSet;

use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};
use serde::{Deserialize, Deserializer, Serialize};

use crate::dashboard_validation::{
    ValidationError, dashboard_widget_secret_owner_id, validate_accent,
    validate_custom_body_json_detailed, validate_dashboard_tab_color, validate_grid_bounds,
    validate_grid_density, validate_icon, validate_kind, validate_preset,
    validate_settings_schema_json, validate_settings_values_for_schema_json, validate_title,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardView {
    pub id: String,
    pub title: String,
    pub sort_order: i64,
    pub grid_density: String,
    #[serde(default)]
    pub background: Option<DashboardBackground>,
    #[serde(default)]
    pub tab_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DashboardBackground {
    Preset { preset: String },
    Image { file: String, fit: String, dim: i64 },
    Video { file: String, fit: String, dim: i64 },
    Dynamic { dynamic: String },
}

impl DashboardBackground {
    pub fn validate(&self) -> Result<(), ValidationError> {
        match self {
            DashboardBackground::Preset { preset } => {
                crate::dashboard_validation::validate_background_preset(preset)
            }
            DashboardBackground::Image { file, fit, dim } => {
                crate::dashboard_validation::validate_background_image(file, fit, *dim)
            }
            DashboardBackground::Video { file, fit, dim } => {
                crate::dashboard_validation::validate_background_video(file, fit, *dim)
            }
            DashboardBackground::Dynamic { dynamic } => {
                crate::dashboard_validation::validate_dynamic_background(dynamic)
            }
        }
    }
}

fn background_from_json(raw: Option<String>) -> Option<DashboardBackground> {
    // Defensive on reads: a database written by a different/older KKTerm build
    // may contain a shape we cannot parse. Treat anything unparseable as
    // "theme default" rather than failing the whole load.
    raw.and_then(|json| serde_json::from_str::<DashboardBackground>(&json).ok())
}

fn background_to_json(
    background: &Option<DashboardBackground>,
) -> Result<Option<String>, DashboardStorageError> {
    match background {
        None => Ok(None),
        Some(bg) => {
            bg.validate()?;
            serde_json::to_string(bg)
                .map(Some)
                .map_err(|_| DashboardStorageError::validation(ValidationError::InvalidBackground))
        }
    }
}

fn normalize_loaded_preset(preset: String) -> String {
    if matches!(preset.as_str(), "mono" | "tile" | "action") {
        "panel".to_string()
    } else {
        preset
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardWidgetInstance {
    pub id: String,
    pub view_id: String,
    pub kind: String,
    pub source_id: String,
    pub preset: String,
    pub accent_name: String,
    pub icon_name: String,
    pub custom_title: Option<String>,
    pub glass: bool,
    pub hide_title: bool,
    pub action_direction: Option<String>,
    pub settings_values_json: String,
    pub body_opacity: Option<i64>,
    pub grid_x: i64,
    pub grid_y: i64,
    pub grid_w: i64,
    pub grid_h: i64,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCustomWidget {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub category: String,
    pub body_json: String,
    pub settings_schema_json: String,
    pub created_by: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardLoadState {
    pub views: Vec<DashboardView>,
    pub instances: Vec<DashboardWidgetInstance>,
    pub custom_widgets: Vec<DashboardCustomWidget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstancePatch {
    #[serde(default)]
    pub preset: Option<String>,
    #[serde(default)]
    pub accent_name: Option<String>,
    #[serde(default)]
    pub icon_name: Option<String>,
    #[serde(default)]
    pub custom_title: Option<Option<String>>,
    #[serde(default)]
    pub glass: Option<bool>,
    #[serde(default)]
    pub hide_title: Option<bool>,
    #[serde(default)]
    pub action_direction: Option<Option<String>>,
    #[serde(default)]
    pub settings_values_json: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub body_opacity: Option<Option<i64>>,
    #[serde(default)]
    pub grid_x: Option<i64>,
    #[serde(default)]
    pub grid_y: Option<i64>,
    #[serde(default)]
    pub grid_w: Option<i64>,
    #[serde(default)]
    pub grid_h: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub grid_density: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub background: Option<Option<DashboardBackground>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub tab_color: Option<Option<String>>,
}

fn deserialize_nullable_patch<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomWidgetPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub body_json: Option<String>,
    #[serde(default)]
    pub settings_schema_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutEntry {
    pub id: String,
    pub grid_x: i64,
    pub grid_y: i64,
    pub grid_w: i64,
    pub grid_h: i64,
}

#[derive(Debug)]
pub enum DashboardStorageError {
    Validation {
        kind: ValidationError,
        detail: Option<String>,
    },
    Sqlite(rusqlite::Error),
    NotFound,
    InstancesExist {
        instance_ids: Vec<String>,
    },
}

impl DashboardStorageError {
    pub fn validation(kind: ValidationError) -> Self {
        Self::Validation { kind, detail: None }
    }

    pub fn validation_with_detail(kind: ValidationError, detail: Option<String>) -> Self {
        Self::Validation { kind, detail }
    }
}

impl std::fmt::Display for DashboardStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation { kind, detail: None } => {
                write!(f, "Validation({kind:?})")
            }
            Self::Validation {
                kind,
                detail: Some(reason),
            } => write!(f, "Validation({kind:?}): {reason}"),
            Self::NotFound => write!(f, "NotFound"),
            Self::InstancesExist { instance_ids } => {
                write!(f, "InstancesExist({instance_ids:?})")
            }
            Self::Sqlite(error) => write!(f, "Sqlite: {error}"),
        }
    }
}

impl From<rusqlite::Error> for DashboardStorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

impl From<ValidationError> for DashboardStorageError {
    fn from(value: ValidationError) -> Self {
        Self::Validation {
            kind: value,
            detail: None,
        }
    }
}

impl From<(ValidationError, Option<String>)> for DashboardStorageError {
    fn from((kind, detail): (ValidationError, Option<String>)) -> Self {
        Self::Validation { kind, detail }
    }
}

pub fn load_state(conn: &SqliteConnection) -> Result<DashboardLoadState, DashboardStorageError> {
    let mut views_stmt = conn.prepare(
        "SELECT id, title, sort_order, grid_density, background_json, tab_color FROM dashboard_views ORDER BY sort_order"
    )?;
    let views = views_stmt
        .query_map([], |row| {
            Ok(DashboardView {
                id: row.get(0)?,
                title: row.get(1)?,
                sort_order: row.get(2)?,
                grid_density: row.get(3)?,
                background: background_from_json(row.get(4)?),
                tab_color: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut inst_stmt = conn.prepare(
        "SELECT id, view_id, kind, source_id, preset, accent_name, icon_name, custom_title,
                glass, hide_title, action_direction, settings_values_json, body_opacity,
                grid_x, grid_y, grid_w, grid_h, sort_order
         FROM dashboard_widget_instances
         ORDER BY view_id, sort_order",
    )?;
    let instances = inst_stmt
        .query_map([], |row| {
            Ok(DashboardWidgetInstance {
                id: row.get(0)?,
                view_id: row.get(1)?,
                kind: row.get(2)?,
                source_id: row.get(3)?,
                preset: normalize_loaded_preset(row.get(4)?),
                accent_name: row.get(5)?,
                icon_name: row.get(6)?,
                custom_title: row.get(7)?,
                glass: row.get::<_, i64>(8)? != 0,
                hide_title: row.get::<_, i64>(9)? != 0,
                action_direction: row.get(10)?,
                settings_values_json: row.get(11)?,
                body_opacity: row.get(12)?,
                grid_x: row.get(13)?,
                grid_y: row.get(14)?,
                grid_w: row.get(15)?,
                grid_h: row.get(16)?,
                sort_order: row.get(17)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut custom_stmt = conn.prepare(
        "SELECT id, title, summary, category, body_json, settings_schema_json, created_by, created_at FROM dashboard_custom_widgets"
    )?;
    let custom_widgets = custom_stmt
        .query_map([], |row| {
            Ok(DashboardCustomWidget {
                id: row.get(0)?,
                title: row.get(1)?,
                summary: row.get(2)?,
                category: row.get(3)?,
                body_json: row.get(4)?,
                settings_schema_json: row.get(5)?,
                created_by: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(DashboardLoadState {
        views,
        instances,
        custom_widgets,
    })
}

pub fn create_view(
    conn: &SqliteConnection,
    id: &str,
    title: &str,
    grid_density: Option<&str>,
) -> Result<DashboardView, DashboardStorageError> {
    validate_title(title)?;
    let density = grid_density.unwrap_or("default");
    validate_grid_density(density)?;

    let next_sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM dashboard_views",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO dashboard_views (id, title, sort_order, grid_density) VALUES (?, ?, ?, ?)",
        params![id, title, next_sort, density],
    )?;
    Ok(DashboardView {
        id: id.to_string(),
        title: title.to_string(),
        sort_order: next_sort,
        grid_density: density.to_string(),
        background: None,
        tab_color: None,
    })
}

pub fn update_view(
    conn: &SqliteConnection,
    id: &str,
    patch: &ViewPatch,
) -> Result<DashboardView, DashboardStorageError> {
    if let Some(ref title) = patch.title {
        validate_title(title)?;
    }
    if let Some(ref d) = patch.grid_density {
        validate_grid_density(d)?;
    }
    if let Some(Some(ref color)) = patch.tab_color {
        validate_dashboard_tab_color(color)?;
    }

    let current: Option<DashboardView> = conn.query_row(
        "SELECT id, title, sort_order, grid_density, background_json, tab_color FROM dashboard_views WHERE id = ?",
        params![id],
        |row| Ok(DashboardView {
            id: row.get(0)?,
            title: row.get(1)?,
            sort_order: row.get(2)?,
            grid_density: row.get(3)?,
            background: background_from_json(row.get(4)?),
            tab_color: row.get(5)?,
        }),
    ).optional()?;
    let mut current = current.ok_or(DashboardStorageError::NotFound)?;

    if let Some(t) = patch.title.clone() {
        current.title = t;
    }
    if let Some(d) = patch.grid_density.clone() {
        current.grid_density = d;
    }
    if let Some(s) = patch.sort_order {
        current.sort_order = s;
    }
    if let Some(bg) = patch.background.clone() {
        current.background = bg;
    }
    if let Some(tab_color) = patch.tab_color.clone() {
        current.tab_color = tab_color;
    }

    let background_json = background_to_json(&current.background)?;

    conn.execute(
        "UPDATE dashboard_views SET title = ?, sort_order = ?, grid_density = ?, background_json = ?, tab_color = ? WHERE id = ?",
        params![current.title, current.sort_order, current.grid_density, background_json, current.tab_color, current.id],
    )?;
    Ok(current)
}

pub fn referenced_background_image_files(
    conn: &SqliteConnection,
) -> Result<HashSet<String>, DashboardStorageError> {
    let mut files = HashSet::new();
    collect_background_column(conn, "dashboard_views", "background_json", &mut files)?;
    collect_background_column(conn, "itops_sites", "background_json", &mut files)?;
    collect_background_column(conn, "itops_site_racks", "background_json", &mut files)?;
    collect_background_column(conn, "connections", "terminal_background_json", &mut files)?;
    collect_background_map_column(conn, "itops_sites", "room_backgrounds_json", &mut files)?;
    Ok(files)
}

fn collect_background_column(
    conn: &SqliteConnection,
    table: &str,
    column: &str,
    files: &mut HashSet<String>,
) -> Result<(), DashboardStorageError> {
    if !column_exists(conn, table, column)? {
        return Ok(());
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT {column} FROM {table} WHERE {column} IS NOT NULL"
    ))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    for json in rows {
        collect_background_file(files, &json?);
    }
    Ok(())
}

fn collect_background_map_column(
    conn: &SqliteConnection,
    table: &str,
    column: &str,
    files: &mut HashSet<String>,
) -> Result<(), DashboardStorageError> {
    if !column_exists(conn, table, column)? {
        return Ok(());
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT {column} FROM {table} WHERE {column} IS NOT NULL"
    ))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    for json in rows {
        let json = json?;
        let Ok(backgrounds) =
            serde_json::from_str::<std::collections::HashMap<String, DashboardBackground>>(&json)
        else {
            continue;
        };
        for background in backgrounds.values() {
            collect_background_value(files, background);
        }
    }
    Ok(())
}

fn column_exists(
    conn: &SqliteConnection,
    table: &str,
    column: &str,
) -> Result<bool, DashboardStorageError> {
    let escaped_table = table.replace('\'', "''");
    let mut stmt = conn.prepare(&format!("PRAGMA table_info('{escaped_table}')"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in rows {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn collect_background_file(files: &mut HashSet<String>, json: &str) {
    if let Ok(background) = serde_json::from_str::<DashboardBackground>(json) {
        collect_background_value(files, &background);
    }
}

fn collect_background_value(files: &mut HashSet<String>, background: &DashboardBackground) {
    match background {
        DashboardBackground::Image { file, .. } | DashboardBackground::Video { file, .. } => {
            files.insert(file.clone());
        }
        DashboardBackground::Preset { .. } | DashboardBackground::Dynamic { .. } => {}
    }
}

pub fn remove_view(conn: &SqliteConnection, id: &str) -> Result<(), DashboardStorageError> {
    let affected = conn.execute("DELETE FROM dashboard_views WHERE id = ?", params![id])?;
    if affected == 0 {
        return Err(DashboardStorageError::NotFound);
    }
    Ok(())
}

pub fn reorder_views(
    conn: &SqliteConnection,
    ordered_ids: &[String],
) -> Result<(), DashboardStorageError> {
    let tx = conn.unchecked_transaction()?;
    let mut statement = tx.prepare("UPDATE dashboard_views SET sort_order = ? WHERE id = ?")?;
    for (idx, id) in ordered_ids.iter().enumerate() {
        statement.execute(params![idx as i64, id])?;
    }
    drop(statement);
    tx.commit()?;
    Ok(())
}

pub fn add_instance(
    conn: &SqliteConnection,
    id: &str,
    view_id: &str,
    kind: &str,
    source_id: &str,
    preset: &str,
    accent_name: &str,
    icon_name: &str,
    x: i64,
    y: i64,
    w: i64,
    h: i64,
) -> Result<DashboardWidgetInstance, DashboardStorageError> {
    validate_kind(kind)?;
    validate_preset(preset)?;
    validate_accent(accent_name)?;
    validate_icon(icon_name)?;
    validate_grid_bounds(x, y, w, h)?;
    let hide_title = preset == "ambient";

    let next_sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM dashboard_widget_instances WHERE view_id = ?",
        params![view_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO dashboard_widget_instances
            (id, view_id, kind, source_id, preset, accent_name, icon_name, custom_title,
             glass, hide_title, action_direction, settings_values_json, body_opacity,
             grid_x, grid_y, grid_w, grid_h, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, NULL, '{}', NULL, ?, ?, ?, ?, ?)",
        params![
            id,
            view_id,
            kind,
            source_id,
            preset,
            accent_name,
            icon_name,
            hide_title as i64,
            x,
            y,
            w,
            h,
            next_sort
        ],
    )?;
    Ok(DashboardWidgetInstance {
        id: id.to_string(),
        view_id: view_id.to_string(),
        kind: kind.to_string(),
        source_id: source_id.to_string(),
        preset: preset.to_string(),
        accent_name: accent_name.to_string(),
        icon_name: icon_name.to_string(),
        custom_title: None,
        glass: false,
        hide_title,
        action_direction: None,
        settings_values_json: "{}".to_string(),
        body_opacity: None,
        grid_x: x,
        grid_y: y,
        grid_w: w,
        grid_h: h,
        sort_order: next_sort,
    })
}

pub fn update_instance(
    conn: &SqliteConnection,
    id: &str,
    patch: &InstancePatch,
) -> Result<DashboardWidgetInstance, DashboardStorageError> {
    if let Some(ref p) = patch.preset {
        validate_preset(p)?;
    }
    if let Some(ref a) = patch.accent_name {
        validate_accent(a)?;
    }
    if let Some(ref i) = patch.icon_name {
        validate_icon(i)?;
    }
    let mut current: DashboardWidgetInstance = conn
        .query_row(
            "SELECT id, view_id, kind, source_id, preset, accent_name, icon_name, custom_title,
                glass, hide_title, action_direction, settings_values_json, body_opacity,
                grid_x, grid_y, grid_w, grid_h, sort_order
         FROM dashboard_widget_instances WHERE id = ?",
            params![id],
            |row| {
                Ok(DashboardWidgetInstance {
                    id: row.get(0)?,
                    view_id: row.get(1)?,
                    kind: row.get(2)?,
                    source_id: row.get(3)?,
                    preset: normalize_loaded_preset(row.get(4)?),
                    accent_name: row.get(5)?,
                    icon_name: row.get(6)?,
                    custom_title: row.get(7)?,
                    glass: row.get::<_, i64>(8)? != 0,
                    hide_title: row.get::<_, i64>(9)? != 0,
                    action_direction: row.get(10)?,
                    settings_values_json: row.get(11)?,
                    body_opacity: row.get(12)?,
                    grid_x: row.get(13)?,
                    grid_y: row.get(14)?,
                    grid_w: row.get(15)?,
                    grid_h: row.get(16)?,
                    sort_order: row.get(17)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DashboardStorageError::NotFound,
            other => DashboardStorageError::Sqlite(other),
        })?;

    let preset_changed_to_ambient = patch.preset.as_deref() == Some("ambient");
    if let Some(p) = patch.preset.clone() {
        current.preset = p;
    }
    if let Some(a) = patch.accent_name.clone() {
        current.accent_name = a;
    }
    if let Some(i) = patch.icon_name.clone() {
        current.icon_name = i;
    }
    if let Some(ct) = patch.custom_title.clone() {
        current.custom_title = ct;
    }
    if let Some(g) = patch.glass {
        current.glass = g;
    }
    if let Some(ht) = patch.hide_title {
        current.hide_title = ht;
    } else if preset_changed_to_ambient {
        current.hide_title = true;
    }
    if let Some(ad) = patch.action_direction.clone() {
        current.action_direction = ad;
    }
    if let Some(values) = patch.settings_values_json.clone() {
        current.settings_values_json = values;
    }
    if let Some(opacity) = patch.body_opacity {
        if let Some(value) = opacity {
            if !(0..=100).contains(&value) {
                return Err(DashboardStorageError::validation_with_detail(
                    ValidationError::InvalidBodyOpacity,
                    Some(format!(
                        "body_opacity must be between 0 and 100; got {value}"
                    )),
                ));
            }
        }
        current.body_opacity = opacity;
    }
    if let Some(x) = patch.grid_x {
        current.grid_x = x;
    }
    if let Some(y) = patch.grid_y {
        current.grid_y = y;
    }
    if let Some(w) = patch.grid_w {
        current.grid_w = w;
    }
    if let Some(h) = patch.grid_h {
        current.grid_h = h;
    }

    validate_grid_bounds(
        current.grid_x,
        current.grid_y,
        current.grid_w,
        current.grid_h,
    )?;
    validate_instance_settings_values(conn, &current)?;

    conn.execute(
        "UPDATE dashboard_widget_instances
            SET preset = ?, accent_name = ?, icon_name = ?, custom_title = ?,
                glass = ?, hide_title = ?, action_direction = ?, settings_values_json = ?,
                body_opacity = ?, grid_x = ?, grid_y = ?, grid_w = ?, grid_h = ?
            WHERE id = ?",
        params![
            current.preset,
            current.accent_name,
            current.icon_name,
            current.custom_title,
            current.glass as i64,
            current.hide_title as i64,
            current.action_direction,
            current.settings_values_json,
            current.body_opacity,
            current.grid_x,
            current.grid_y,
            current.grid_w,
            current.grid_h,
            current.id,
        ],
    )?;
    Ok(current)
}

fn validate_instance_settings_values(
    conn: &SqliteConnection,
    instance: &DashboardWidgetInstance,
) -> Result<(), DashboardStorageError> {
    if instance.kind != "script" {
        return Ok(());
    }
    let schema_json: Option<String> = conn
        .query_row(
            "SELECT settings_schema_json FROM dashboard_custom_widgets WHERE id = ?",
            params![instance.source_id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(schema_json) = schema_json {
        validate_settings_values_for_schema_json(
            &schema_json,
            &instance.settings_values_json,
            &instance.id,
        )?;
    }
    Ok(())
}

pub fn remove_instance(conn: &SqliteConnection, id: &str) -> Result<(), DashboardStorageError> {
    let affected = conn.execute(
        "DELETE FROM dashboard_widget_instances WHERE id = ?",
        params![id],
    )?;
    if affected == 0 {
        return Err(DashboardStorageError::NotFound);
    }
    Ok(())
}

pub fn apply_layout(
    conn: &SqliteConnection,
    view_id: &str,
    layout: &[LayoutEntry],
) -> Result<(), DashboardStorageError> {
    for entry in layout {
        validate_grid_bounds(entry.grid_x, entry.grid_y, entry.grid_w, entry.grid_h)?;
    }
    let tx_savepoint = conn.unchecked_transaction()?;
    let mut statement = tx_savepoint.prepare(
        "UPDATE dashboard_widget_instances
            SET grid_x = ?, grid_y = ?, grid_w = ?, grid_h = ?, sort_order = ?
            WHERE id = ? AND view_id = ?",
    )?;
    for (idx, entry) in layout.iter().enumerate() {
        statement.execute(params![
            entry.grid_x,
            entry.grid_y,
            entry.grid_w,
            entry.grid_h,
            idx as i64,
            entry.id,
            view_id
        ])?;
    }
    drop(statement);
    tx_savepoint.commit()?;
    Ok(())
}

pub fn create_custom_widget(
    conn: &SqliteConnection,
    id: &str,
    title: &str,
    summary: &str,
    category: &str,
    body_json: &str,
    settings_schema_json: Option<&str>,
    created_by: &str,
) -> Result<DashboardCustomWidget, DashboardStorageError> {
    validate_title(title)?;
    validate_custom_body_json_detailed(body_json)?;
    let settings_schema_json = settings_schema_json.unwrap_or(r#"{"fields":[]}"#);
    validate_settings_schema_json(settings_schema_json)?;
    if !matches!(created_by, "user" | "agent" | "imported") {
        return Err(DashboardStorageError::validation_with_detail(
            ValidationError::InvalidCustomWidgetKind,
            Some(format!(
                "createdBy must be 'user', 'agent', or 'imported'; got {created_by:?}"
            )),
        ));
    }
    conn.execute(
        "INSERT INTO dashboard_custom_widgets
            (id, title, summary, category, body_json, settings_schema_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            title,
            summary,
            category,
            body_json,
            settings_schema_json,
            created_by
        ],
    )?;
    let created_at: String = conn.query_row(
        "SELECT created_at FROM dashboard_custom_widgets WHERE id = ?",
        params![id],
        |row| row.get(0),
    )?;
    Ok(DashboardCustomWidget {
        id: id.to_string(),
        title: title.to_string(),
        summary: summary.to_string(),
        category: category.to_string(),
        body_json: body_json.to_string(),
        settings_schema_json: settings_schema_json.to_string(),
        created_by: created_by.to_string(),
        created_at,
    })
}

/// Read custom widgets for export. When `ids` is empty, all custom widgets are
/// returned (the "export all" case); otherwise only the named ids, in the order
/// they are stored. Unknown ids are silently skipped — the caller already chose
/// them from the live catalog, so a missing row just means a concurrent delete.
pub fn list_custom_widgets_for_export(
    conn: &SqliteConnection,
    ids: &[String],
) -> Result<Vec<DashboardCustomWidget>, DashboardStorageError> {
    let wanted: Option<HashSet<&str>> = if ids.is_empty() {
        None
    } else {
        Some(ids.iter().map(String::as_str).collect())
    };
    let mut stmt = conn.prepare(
        "SELECT id, title, summary, category, body_json, settings_schema_json, created_by, created_at
         FROM dashboard_custom_widgets ORDER BY created_at DESC, id",
    )?;
    let widgets = stmt
        .query_map([], |row| {
            Ok(DashboardCustomWidget {
                id: row.get(0)?,
                title: row.get(1)?,
                summary: row.get(2)?,
                category: row.get(3)?,
                body_json: row.get(4)?,
                settings_schema_json: row.get(5)?,
                created_by: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|widget| {
            wanted
                .as_ref()
                .is_none_or(|set| set.contains(widget.id.as_str()))
        })
        .collect();
    Ok(widgets)
}

/// All custom widget titles currently in the catalog, used to de-duplicate
/// titles on import so an imported widget never silently shadows an existing one.
pub fn custom_widget_titles(
    conn: &SqliteConnection,
) -> Result<HashSet<String>, DashboardStorageError> {
    let mut stmt = conn.prepare("SELECT title FROM dashboard_custom_widgets")?;
    let titles = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(titles)
}

pub fn update_custom_widget(
    conn: &SqliteConnection,
    id: &str,
    patch: &CustomWidgetPatch,
) -> Result<DashboardCustomWidget, DashboardStorageError> {
    let mut current: DashboardCustomWidget = conn
        .query_row(
            "SELECT id, title, summary, category, body_json, settings_schema_json, created_by, created_at
         FROM dashboard_custom_widgets WHERE id = ?",
            params![id],
            |row| {
                Ok(DashboardCustomWidget {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    summary: row.get(2)?,
                    category: row.get(3)?,
                    body_json: row.get(4)?,
                    settings_schema_json: row.get(5)?,
                    created_by: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DashboardStorageError::NotFound,
            other => DashboardStorageError::Sqlite(other),
        })?;

    if let Some(t) = patch.title.clone() {
        validate_title(&t)?;
        current.title = t;
    }
    if let Some(s) = patch.summary.clone() {
        current.summary = s;
    }
    if let Some(c) = patch.category.clone() {
        current.category = c;
    }
    if let Some(b) = patch.body_json.clone() {
        validate_custom_body_json_detailed(&b)?;
        current.body_json = b;
    }
    if let Some(schema) = patch.settings_schema_json.clone() {
        validate_settings_schema_json(&schema)?;
        current.settings_schema_json = schema;
    }

    conn.execute(
        "UPDATE dashboard_custom_widgets
            SET title = ?, summary = ?, category = ?, body_json = ?, settings_schema_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?",
        params![current.title, current.summary, current.category, current.body_json, current.settings_schema_json, current.id],
    )?;
    Ok(current)
}

pub fn remove_custom_widget(
    conn: &SqliteConnection,
    id: &str,
    force_delete_instances: bool,
) -> Result<(), DashboardStorageError> {
    let mut stmt = conn.prepare(
        "SELECT id FROM dashboard_widget_instances WHERE source_id = ? AND kind = 'script'",
    )?;
    let instance_ids: Vec<String> = stmt
        .query_map(params![id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    if !instance_ids.is_empty() && !force_delete_instances {
        return Err(DashboardStorageError::InstancesExist { instance_ids });
    }
    let tx = conn.unchecked_transaction()?;
    if !instance_ids.is_empty() {
        tx.execute(
            "DELETE FROM dashboard_widget_instances WHERE source_id = ? AND kind = 'script'",
            params![id],
        )?;
    }
    tx.execute(
        "DELETE FROM dashboard_custom_widgets WHERE id = ?",
        params![id],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn reset_dashboard(conn: &SqliteConnection) -> Result<(), DashboardStorageError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM dashboard_widget_instances", [])?;
    tx.execute("DELETE FROM dashboard_custom_widgets", [])?;
    tx.execute("DELETE FROM dashboard_views", [])?;
    tx.commit()?;
    seed_default(conn)?;
    Ok(())
}

pub fn widget_secret_owner_id_for_instance(
    conn: &SqliteConnection,
    instance_id: &str,
    key: &str,
) -> Result<Option<String>, DashboardStorageError> {
    let instance: DashboardWidgetInstance = conn
        .query_row(
            "SELECT id, view_id, kind, source_id, preset, accent_name, icon_name, custom_title,
                glass, hide_title, action_direction, settings_values_json, body_opacity,
                grid_x, grid_y, grid_w, grid_h, sort_order
         FROM dashboard_widget_instances WHERE id = ?",
            params![instance_id],
            |row| {
                Ok(DashboardWidgetInstance {
                    id: row.get(0)?,
                    view_id: row.get(1)?,
                    kind: row.get(2)?,
                    source_id: row.get(3)?,
                    preset: normalize_loaded_preset(row.get(4)?),
                    accent_name: row.get(5)?,
                    icon_name: row.get(6)?,
                    custom_title: row.get(7)?,
                    glass: row.get::<_, i64>(8)? != 0,
                    hide_title: row.get::<_, i64>(9)? != 0,
                    action_direction: row.get(10)?,
                    settings_values_json: row.get(11)?,
                    body_opacity: row.get(12)?,
                    grid_x: row.get(13)?,
                    grid_y: row.get(14)?,
                    grid_w: row.get(15)?,
                    grid_h: row.get(16)?,
                    sort_order: row.get(17)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DashboardStorageError::NotFound,
            other => DashboardStorageError::Sqlite(other),
        })?;

    if instance.kind != "script" {
        return Ok(None);
    }
    let schema_json: String = conn.query_row(
        "SELECT settings_schema_json FROM dashboard_custom_widgets WHERE id = ?",
        params![instance.source_id],
        |row| row.get(0),
    )?;
    validate_settings_values_for_schema_json(
        &schema_json,
        &instance.settings_values_json,
        &instance.id,
    )?;
    let schema: serde_json::Value = serde_json::from_str(&schema_json)
        .map_err(|_| DashboardStorageError::validation(ValidationError::InvalidSettingsSchema))?;
    let secret_field_exists = schema
        .get("fields")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|fields| {
            fields.iter().any(|field| {
                field.get("type").and_then(serde_json::Value::as_str) == Some("secret")
                    && field.get("key").and_then(serde_json::Value::as_str) == Some(key)
            })
        });
    if !secret_field_exists {
        return Ok(None);
    }
    let values: serde_json::Value = serde_json::from_str(&instance.settings_values_json)
        .map_err(|_| DashboardStorageError::validation(ValidationError::InvalidSettingsValues))?;
    let expected_owner_id = dashboard_widget_secret_owner_id(&instance.id, key);
    let has_ref = values
        .get(key)
        .and_then(serde_json::Value::as_object)
        .is_some_and(|secret_ref| {
            secret_ref.get("type").and_then(serde_json::Value::as_str) == Some("secretRef")
                && secret_ref
                    .get("ownerId")
                    .and_then(serde_json::Value::as_str)
                    == Some(expected_owner_id.as_str())
                && secret_ref
                    .get("hasSecret")
                    .and_then(serde_json::Value::as_bool)
                    == Some(true)
        });
    Ok(has_ref.then_some(expected_owner_id))
}

pub fn seed_default(conn: &SqliteConnection) -> Result<(), DashboardStorageError> {
    let view_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM dashboard_views LIMIT 1)",
        [],
        |row| row.get(0),
    )?;
    if view_exists {
        return Ok(());
    }
    create_view(conn, "default", "Default", Some("default"))?;
    add_instance(
        conn,
        "inst-app-launcher",
        "default",
        "builtIn",
        "appLauncher",
        "panel",
        "blue",
        "Wrench",
        0,
        0,
        4,
        3,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        // Apply the relevant subset of CURRENT_SCHEMA needed for these tests.
        conn.execute_batch(
            r#"
            CREATE TABLE dashboard_views (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, sort_order INTEGER NOT NULL,
                grid_density TEXT NOT NULL DEFAULT 'default'
                    CHECK (grid_density IN ('compact', 'default', 'roomy')),
                background_json TEXT,
                tab_color TEXT
            );
            CREATE TABLE dashboard_custom_widgets (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT 'custom',
                body_json TEXT NOT NULL,
                settings_schema_json TEXT NOT NULL DEFAULT '{"fields":[]}',
                created_by TEXT NOT NULL CHECK (created_by IN ('user','agent','imported')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE dashboard_widget_instances (
                id TEXT PRIMARY KEY,
                view_id TEXT NOT NULL REFERENCES dashboard_views(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('builtIn','script')),
                source_id TEXT NOT NULL, preset TEXT NOT NULL, accent_name TEXT NOT NULL,
                icon_name TEXT NOT NULL, custom_title TEXT,
                glass INTEGER NOT NULL DEFAULT 0,
                hide_title INTEGER NOT NULL DEFAULT 0,
                action_direction TEXT,
                settings_values_json TEXT NOT NULL DEFAULT '{}',
                body_opacity INTEGER,
                grid_x INTEGER NOT NULL, grid_y INTEGER NOT NULL,
                grid_w INTEGER NOT NULL, grid_h INTEGER NOT NULL,
                sort_order INTEGER NOT NULL
            );
        "#,
        )
        .unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn
    }

    #[test]
    fn seed_creates_default_view_and_app_launcher() {
        let conn = open_test_db();
        seed_default(&conn).unwrap();
        let state = load_state(&conn).unwrap();
        assert_eq!(state.views.len(), 1);
        assert_eq!(state.views[0].id, "default");
        assert_eq!(state.instances.len(), 1);
        assert_eq!(state.instances[0].source_id, "appLauncher");
    }

    #[test]
    fn seed_is_idempotent() {
        let conn = open_test_db();
        seed_default(&conn).unwrap();
        seed_default(&conn).unwrap();
        let state = load_state(&conn).unwrap();
        assert_eq!(state.views.len(), 1);
    }

    #[test]
    fn add_and_update_instance_round_trip() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        let inst = add_instance(
            &conn,
            "i1",
            "v1",
            "builtIn",
            "hashCalculator",
            "panel",
            "indigo",
            "Hash",
            0,
            0,
            3,
            2,
        )
        .unwrap();
        assert_eq!(inst.grid_w, 3);
        let updated = update_instance(
            &conn,
            "i1",
            &InstancePatch {
                preset: Some("ambient".into()),
                accent_name: None,
                icon_name: None,
                custom_title: None,
                glass: None,
                hide_title: None,
                action_direction: None,
                settings_values_json: None,
                body_opacity: None,
                grid_x: None,
                grid_y: None,
                grid_w: None,
                grid_h: None,
            },
        )
        .unwrap();
        assert_eq!(updated.preset, "ambient");
    }

    #[test]
    fn update_instance_round_trips_hidden_title() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        add_instance(
            &conn,
            "i1",
            "v1",
            "builtIn",
            "hashCalculator",
            "ambient",
            "indigo",
            "Hash",
            0,
            0,
            3,
            2,
        )
        .unwrap();
        let updated = update_instance(
            &conn,
            "i1",
            &InstancePatch {
                preset: None,
                accent_name: None,
                icon_name: None,
                custom_title: None,
                glass: None,
                action_direction: None,
                hide_title: Some(true),
                settings_values_json: None,
                body_opacity: None,
                grid_x: None,
                grid_y: None,
                grid_w: None,
                grid_h: None,
            },
        )
        .unwrap();
        assert!(updated.hide_title);

        let state = load_state(&conn).unwrap();
        assert!(state.instances[0].hide_title);
    }

    #[test]
    fn ambient_instance_hides_title_by_default() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        let inst = add_instance(
            &conn,
            "i1",
            "v1",
            "builtIn",
            "hashCalculator",
            "ambient",
            "indigo",
            "Hash",
            0,
            0,
            3,
            2,
        )
        .unwrap();
        assert!(inst.hide_title);

        let state = load_state(&conn).unwrap();
        assert!(state.instances[0].hide_title);
    }

    #[test]
    fn switching_to_ambient_hides_title_by_default() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        add_instance(
            &conn,
            "i1",
            "v1",
            "builtIn",
            "hashCalculator",
            "panel",
            "indigo",
            "Hash",
            0,
            0,
            3,
            2,
        )
        .unwrap();
        let updated = update_instance(
            &conn,
            "i1",
            &InstancePatch {
                preset: Some("ambient".into()),
                accent_name: None,
                icon_name: None,
                custom_title: None,
                glass: None,
                action_direction: None,
                hide_title: None,
                settings_values_json: None,
                body_opacity: None,
                grid_x: None,
                grid_y: None,
                grid_w: None,
                grid_h: None,
            },
        )
        .unwrap();
        assert!(updated.hide_title);
    }

    #[test]
    fn invalid_grid_rejected() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        let err = add_instance(
            &conn, "i-bad", "v1", "builtIn", "x", "panel", "blue", "Hash", 10, 0, 5, 1,
        );
        assert!(matches!(
            err,
            Err(DashboardStorageError::Validation {
                kind: ValidationError::InvalidGridBounds,
                ..
            })
        ));
    }

    #[test]
    fn cascade_on_view_delete() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        add_instance(
            &conn, "i1", "v1", "builtIn", "x", "panel", "blue", "Hash", 0, 0, 3, 2,
        )
        .unwrap();
        remove_view(&conn, "v1").unwrap();
        let state = load_state(&conn).unwrap();
        assert_eq!(state.instances.len(), 0);
    }

    #[test]
    fn remove_custom_widget_blocks_when_referenced() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        create_custom_widget(
            &conn,
            "cw1",
            "My Script",
            "",
            "custom",
            r#"{"source":"const root = document.getElementById('root'); root.textContent = 'ok';","permissions":{"network":false,"pollSeconds":null},"htmlShim":null,"libraries":[]}"#,
            None,
            "agent",
        )
        .unwrap();
        add_instance(
            &conn, "inst", "v1", "script", "cw1", "panel", "blue", "Hash", 0, 0, 3, 2,
        )
        .unwrap();
        let err = remove_custom_widget(&conn, "cw1", false);
        assert!(matches!(
            err,
            Err(DashboardStorageError::InstancesExist { .. })
        ));
        remove_custom_widget(&conn, "cw1", true).unwrap();
        let state = load_state(&conn).unwrap();
        assert_eq!(state.instances.len(), 0);
        assert_eq!(state.custom_widgets.len(), 0);
    }

    #[test]
    fn imported_custom_widget_origin_round_trips() {
        let conn = open_test_db();
        create_custom_widget(
            &conn,
            "cw-imported",
            "Imported Widget",
            "Imported elsewhere",
            "custom",
            r#"{"source":"const root = document.getElementById('root'); root.textContent = 'ok';","permissions":{"network":false}}"#,
            None,
            "imported",
        )
        .unwrap();

        let state = load_state(&conn).unwrap();
        assert_eq!(state.custom_widgets.len(), 1);
        assert_eq!(state.custom_widgets[0].created_by, "imported");
    }

    #[test]
    fn secret_instance_settings_store_references_only() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        create_custom_widget(
            &conn,
            "cw1",
            "API Widget",
            "",
            "custom",
            r#"{"source":"console.log(1)","permissions":{"network":false}}"#,
            Some(r#"{"fields":[{"type":"secret","key":"apiKey","label":"API key"}]}"#),
            "agent",
        )
        .unwrap();
        add_instance(
            &conn, "inst", "v1", "script", "cw1", "panel", "blue", "Key", 0, 0, 3, 2,
        )
        .unwrap();
        let err = update_instance(
            &conn,
            "inst",
            &InstancePatch {
                preset: None,
                accent_name: None,
                icon_name: None,
                custom_title: None,
                glass: None,
                hide_title: None,
                action_direction: None,
                settings_values_json: Some(r#"{"apiKey":"plain-text"}"#.into()),
                body_opacity: None,
                grid_x: None,
                grid_y: None,
                grid_w: None,
                grid_h: None,
            },
        );
        assert!(matches!(
            err,
            Err(DashboardStorageError::Validation {
                kind: ValidationError::InvalidSettingsValues,
                ..
            })
        ));

        let updated = update_instance(&conn, "inst", &InstancePatch {
            preset: None, accent_name: None, icon_name: None, custom_title: None,
            glass: None, hide_title: None, action_direction: None,
            settings_values_json: Some(r#"{"apiKey":{"type":"secretRef","ownerId":"dashboard-widget-secret:inst:apiKey","hasSecret":true}}"#.into()),
            body_opacity: None,
            grid_x: None, grid_y: None, grid_w: None, grid_h: None,
        }).unwrap();
        assert!(updated.settings_values_json.contains("secretRef"));
        assert_eq!(
            widget_secret_owner_id_for_instance(&conn, "inst", "apiKey")
                .unwrap()
                .as_deref(),
            Some("dashboard-widget-secret:inst:apiKey"),
        );
    }

    #[test]
    fn apply_layout_updates_in_one_pass() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        add_instance(
            &conn, "i1", "v1", "builtIn", "x", "panel", "blue", "Hash", 0, 0, 3, 2,
        )
        .unwrap();
        add_instance(
            &conn, "i2", "v1", "builtIn", "x", "panel", "blue", "Hash", 3, 0, 3, 2,
        )
        .unwrap();
        apply_layout(
            &conn,
            "v1",
            &[
                LayoutEntry {
                    id: "i1".into(),
                    grid_x: 4,
                    grid_y: 1,
                    grid_w: 4,
                    grid_h: 2,
                },
                LayoutEntry {
                    id: "i2".into(),
                    grid_x: 0,
                    grid_y: 0,
                    grid_w: 4,
                    grid_h: 1,
                },
            ],
        )
        .unwrap();
        let state = load_state(&conn).unwrap();
        let i1 = state.instances.iter().find(|i| i.id == "i1").unwrap();
        assert_eq!((i1.grid_x, i1.grid_y, i1.grid_w, i1.grid_h), (4, 1, 4, 2));
    }

    #[test]
    fn new_view_has_no_background() {
        let conn = open_test_db();
        let view = create_view(&conn, "v1", "First", None).unwrap();
        assert_eq!(view.background, None);
        let state = load_state(&conn).unwrap();
        assert_eq!(state.views[0].background, None);
    }

    #[test]
    fn update_view_sets_and_clears_background() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();

        let preset = DashboardBackground::Preset {
            preset: "mist".into(),
        };
        let updated = update_view(
            &conn,
            "v1",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: Some(Some(preset.clone())),
                tab_color: None,
            },
        )
        .unwrap();
        assert_eq!(updated.background, Some(preset.clone()));
        assert_eq!(load_state(&conn).unwrap().views[0].background, Some(preset));

        let cleared = update_view(
            &conn,
            "v1",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: Some(None),
                tab_color: None,
            },
        )
        .unwrap();
        assert_eq!(cleared.background, None);
    }

    #[test]
    fn update_view_sets_and_clears_tab_color() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();

        let updated = update_view(
            &conn,
            "v1",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: None,
                tab_color: Some(Some("g-dawn".into())),
            },
        )
        .unwrap();
        assert_eq!(updated.tab_color.as_deref(), Some("g-dawn"));
        assert_eq!(
            load_state(&conn).unwrap().views[0].tab_color.as_deref(),
            Some("g-dawn"),
        );

        let cleared = update_view(
            &conn,
            "v1",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: None,
                tab_color: Some(None),
            },
        )
        .unwrap();
        assert_eq!(cleared.tab_color, None);
    }

    #[test]
    fn view_patch_deserializes_null_background_as_clear() {
        let patch: ViewPatch = serde_json::from_value(serde_json::json!({
            "background": null
        }))
        .unwrap();
        assert_eq!(patch.background, Some(None));

        let patch: ViewPatch = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(patch.background, None);
    }

    #[test]
    fn update_view_rejects_invalid_background() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        let err = update_view(
            &conn,
            "v1",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: Some(Some(DashboardBackground::Preset {
                    preset: "not-real".into(),
                })),
                tab_color: None,
            },
        );
        assert!(matches!(
            err,
            Err(DashboardStorageError::Validation {
                kind: ValidationError::InvalidBackground,
                ..
            })
        ));
    }

    #[test]
    fn update_view_leaves_background_untouched_when_not_patched() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        let preset = DashboardBackground::Preset {
            preset: "sky".into(),
        };
        update_view(
            &conn,
            "v1",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: Some(Some(preset.clone())),
                tab_color: None,
            },
        )
        .unwrap();
        // Patch only the title; background must survive.
        let updated = update_view(
            &conn,
            "v1",
            &ViewPatch {
                title: Some("Renamed".into()),
                grid_density: None,
                sort_order: None,
                background: None,
                tab_color: None,
            },
        )
        .unwrap();
        assert_eq!(updated.background, Some(preset));
    }

    #[test]
    fn referenced_background_image_files_collects_media_files_only() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        create_view(&conn, "v2", "Second", None).unwrap();
        create_view(&conn, "v3", "Third", None).unwrap();
        create_view(&conn, "v4", "Fourth", None).unwrap();
        create_view(&conn, "v5", "Fifth", None).unwrap();
        update_view(
            &conn,
            "v1",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: Some(Some(DashboardBackground::Image {
                    file: "bg-aaa.jpg".into(),
                    fit: "fill".into(),
                    dim: 0,
                })),
                tab_color: None,
            },
        )
        .unwrap();
        update_view(
            &conn,
            "v2",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: Some(Some(DashboardBackground::Preset {
                    preset: "mist".into(),
                })),
                tab_color: None,
            },
        )
        .unwrap();
        update_view(
            &conn,
            "v4",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: Some(Some(DashboardBackground::Video {
                    file: "bg-bbb.mp4".into(),
                    fit: "fill".into(),
                    dim: 0,
                })),
                tab_color: None,
            },
        )
        .unwrap();
        update_view(
            &conn,
            "v5",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: Some(Some(DashboardBackground::Dynamic {
                    dynamic: "aurora".into(),
                })),
                tab_color: None,
            },
        )
        .unwrap();
        // v3 left as theme default (NULL).
        let files = referenced_background_image_files(&conn).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files.contains("bg-aaa.jpg"));
        assert!(files.contains("bg-bbb.mp4"));
    }

    #[test]
    fn referenced_background_image_files_includes_shared_picker_surfaces() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE itops_sites (
                id TEXT PRIMARY KEY,
                background_json TEXT,
                room_backgrounds_json TEXT
            );
            CREATE TABLE itops_site_racks (
                id TEXT PRIMARY KEY,
                background_json TEXT
            );
            CREATE TABLE connections (
                id TEXT PRIMARY KEY,
                terminal_background_json TEXT
            );
            "#,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itops_sites (id, background_json, room_backgrounds_json)
             VALUES ('site-1', ?, ?)",
            params![
                r#"{"kind":"image","file":"itops-site.svg","fit":"fit","dim":0}"#,
                r#"{"Room A":{"kind":"video","file":"itops-room.mp4","fit":"fill","dim":0},
                    "Room B":{"kind":"dynamic","dynamic":"starfield"}}"#,
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itops_site_racks (id, background_json) VALUES ('rack-1', ?)",
            params![r#"{"kind":"image","file":"itops-rack.webp","fit":"fill","dim":0}"#],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO connections (id, terminal_background_json) VALUES ('conn-1', ?)",
            params![r#"{"kind":"image","file":"connection-bg.png","fit":"fill","dim":0}"#],
        )
        .unwrap();

        let files = referenced_background_image_files(&conn).unwrap();
        assert!(files.contains("itops-site.svg"));
        assert!(files.contains("itops-room.mp4"));
        assert!(files.contains("itops-rack.webp"));
        assert!(files.contains("connection-bg.png"));
    }

    #[test]
    fn update_view_sets_dynamic_background() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();

        let dynamic = DashboardBackground::Dynamic {
            dynamic: "matrix".into(),
        };
        let updated = update_view(
            &conn,
            "v1",
            &ViewPatch {
                title: None,
                grid_density: None,
                sort_order: None,
                background: Some(Some(dynamic.clone())),
                tab_color: None,
            },
        )
        .unwrap();

        assert_eq!(updated.background, Some(dynamic.clone()));
        assert_eq!(
            load_state(&conn).unwrap().views[0].background,
            Some(dynamic)
        );
    }

    #[test]
    fn corrupt_background_json_loads_as_none() {
        let conn = open_test_db();
        create_view(&conn, "v1", "First", None).unwrap();
        conn.execute(
            "UPDATE dashboard_views SET background_json = ? WHERE id = ?",
            rusqlite::params!["{not valid json", "v1"],
        )
        .unwrap();
        let state = load_state(&conn).unwrap();
        assert_eq!(state.views[0].background, None);
    }
}

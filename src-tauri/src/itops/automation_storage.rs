// IT Ops Automation storage (docs/ITOPS.md Phase 3). Durable definitions of
// Watchdogs; the live runtime stays in-memory in the WatchdogRegistry. The
// WatchdogConfig is stored verbatim in config_json.

use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};

use crate::watchdog::types::WatchdogConfig;

use super::types::{Automation, AutomationAction};

#[derive(Debug)]
pub enum AutomationStorageError {
    Validation(String),
    NotFound,
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for AutomationStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(reason) => write!(f, "{reason}"),
            Self::NotFound => write!(f, "automation not found"),
            Self::Sqlite(error) => write!(f, "{error}"),
        }
    }
}

impl From<rusqlite::Error> for AutomationStorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

type Result<T> = std::result::Result<T, AutomationStorageError>;

fn validate_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AutomationStorageError::Validation(
            "automation name must not be empty".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

fn config_to_json(config: &WatchdogConfig) -> Result<String> {
    serde_json::to_string(config)
        .map_err(|error| AutomationStorageError::Validation(error.to_string()))
}

fn parse_config(raw: &str) -> Result<WatchdogConfig> {
    serde_json::from_str(raw).map_err(|error| AutomationStorageError::Validation(error.to_string()))
}

fn actions_to_json(actions: &[AutomationAction]) -> Result<String> {
    serde_json::to_string(actions)
        .map_err(|error| AutomationStorageError::Validation(error.to_string()))
}

/// Tolerant: a malformed actions blob loads as an empty list rather than failing
/// the whole Automation (it still samples + fires; it just runs no actions).
fn parse_actions(raw: &str) -> Vec<AutomationAction> {
    serde_json::from_str(raw).unwrap_or_default()
}

/// Normalize a Site binding: a blank id means "unbound" and stores as NULL.
fn normalize_site_id(site_id: Option<&str>) -> Option<String> {
    site_id
        .map(str::trim)
        .filter(|trimmed| !trimmed.is_empty())
        .map(str::to_string)
}

type AutomationRow = (String, String, i64, i64, String, String, Option<String>);

const SELECT_COLUMNS: &str =
    "id, name, sort_order, enabled, config_json, actions_json, site_id FROM itops_automations";

fn row_to_automation(row: AutomationRow) -> Result<Automation> {
    let (id, name, sort_order, enabled, config_json, actions_json, site_id) = row;
    Ok(Automation {
        id,
        name,
        sort_order,
        enabled: enabled != 0,
        config: parse_config(&config_json)?,
        actions: parse_actions(&actions_json),
        site_id,
    })
}

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationRow> {
    Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, i64>(2)?,
        row.get::<_, i64>(3)?,
        row.get::<_, String>(4)?,
        row.get::<_, String>(5)?,
        row.get::<_, Option<String>>(6)?,
    ))
}

pub fn list_automations(conn: &SqliteConnection) -> Result<Vec<Automation>> {
    let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLUMNS} ORDER BY sort_order"))?;
    let rows = stmt
        .query_map([], read_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter().map(row_to_automation).collect()
}

pub fn get_automation(conn: &SqliteConnection, id: &str) -> Result<Option<Automation>> {
    let row = conn
        .query_row(
            &format!("SELECT {SELECT_COLUMNS} WHERE id = ?"),
            params![id],
            read_row,
        )
        .optional()?;
    row.map(row_to_automation).transpose()
}

pub fn create_automation(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    config: &WatchdogConfig,
    actions: &[AutomationAction],
    enabled: bool,
    site_id: Option<&str>,
) -> Result<Automation> {
    let name = validate_name(name)?;
    let site_id = normalize_site_id(site_id);
    let next_sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_automations",
        [],
        |row| row.get(0),
    )?;
    let config_json = config_to_json(config)?;
    let actions_json = actions_to_json(actions)?;
    conn.execute(
        "INSERT INTO itops_automations (id, name, sort_order, enabled, config_json, actions_json, site_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![id, name, next_sort, i64::from(enabled), config_json, actions_json, site_id],
    )?;
    Ok(Automation {
        id: id.to_string(),
        name,
        sort_order: next_sort,
        enabled,
        config: config.clone(),
        actions: actions.to_vec(),
        site_id,
    })
}

pub fn update_automation(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    config: &WatchdogConfig,
    actions: &[AutomationAction],
    site_id: Option<&str>,
) -> Result<Automation> {
    let name = validate_name(name)?;
    let site_id = normalize_site_id(site_id);
    let existing = get_automation(conn, id)?.ok_or(AutomationStorageError::NotFound)?;
    let config_json = config_to_json(config)?;
    let actions_json = actions_to_json(actions)?;
    conn.execute(
        "UPDATE itops_automations
         SET name = ?, config_json = ?, actions_json = ?, site_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![name, config_json, actions_json, site_id, id],
    )?;
    Ok(Automation {
        id: id.to_string(),
        name,
        sort_order: existing.sort_order,
        enabled: existing.enabled,
        config: config.clone(),
        actions: actions.to_vec(),
        site_id,
    })
}

pub fn set_automation_enabled(
    conn: &SqliteConnection,
    id: &str,
    enabled: bool,
) -> Result<Automation> {
    let affected = conn.execute(
        "UPDATE itops_automations SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params![i64::from(enabled), id],
    )?;
    if affected == 0 {
        return Err(AutomationStorageError::NotFound);
    }
    get_automation(conn, id)?.ok_or(AutomationStorageError::NotFound)
}

pub fn remove_automation(conn: &SqliteConnection, id: &str) -> Result<()> {
    let affected = conn.execute("DELETE FROM itops_automations WHERE id = ?", params![id])?;
    if affected == 0 {
        return Err(AutomationStorageError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watchdog::types::{
        PerformanceMetric, PredicateOp, WatchdogAction, WatchdogConfig, WatchdogNotification,
        WatchdogStop, WatchdogTarget, WatchdogTrigger,
    };

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE itops_automations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                config_json TEXT NOT NULL,
                actions_json TEXT NOT NULL DEFAULT '[]',
                site_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )
        .unwrap();
        conn
    }

    fn sample_config(name: &str, threshold: f64) -> WatchdogConfig {
        WatchdogConfig {
            name: name.to_string(),
            target: WatchdogTarget::PerformanceCounter {
                metric: PerformanceMetric::DiskUsedPercent,
            },
            trigger: WatchdogTrigger {
                predicate: PredicateOp::Gt { value: threshold },
                sustained_for_ms: None,
                repeat_while_true: false,
            },
            poll_ms: 60_000,
            stop: WatchdogStop::UntilCanceled,
            notification: WatchdogNotification::InAppPlusToast,
            action: WatchdogAction::Notify,
        }
    }

    #[test]
    fn create_list_update_enable_remove_roundtrip() {
        let conn = open_test_db();
        let actions = vec![AutomationAction::Notify {
            level: crate::itops::types::NotifyLevel::Toast,
        }];
        let created = create_automation(
            &conn,
            "a-1",
            "  Disk > 85%  ",
            &sample_config("Disk > 85%", 85.0),
            &actions,
            true,
            Some("site-1"),
        )
        .unwrap();
        assert_eq!(created.name, "Disk > 85%"); // trimmed
        assert_eq!(created.sort_order, 0);
        assert!(created.enabled);
        assert_eq!(created.actions.len(), 1);
        assert_eq!(created.site_id.as_deref(), Some("site-1"));

        let listed = list_automations(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].config.poll_ms, 60_000);
        assert_eq!(listed[0].actions.len(), 1);
        assert_eq!(listed[0].site_id.as_deref(), Some("site-1"));

        let updated = update_automation(
            &conn,
            "a-1",
            "Disk > 90%",
            &sample_config("Disk > 90%", 90.0),
            &[],
            Some("  "), // blank binding clears to NULL
        )
        .unwrap();
        assert!(updated.actions.is_empty()); // actions replaced
        assert_eq!(updated.name, "Disk > 90%");
        assert_eq!(updated.sort_order, 0); // preserved
        assert!(updated.enabled); // preserved
        assert_eq!(updated.site_id, None); // blank binding cleared

        let disabled = set_automation_enabled(&conn, "a-1", false).unwrap();
        assert!(!disabled.enabled);

        remove_automation(&conn, "a-1").unwrap();
        assert!(list_automations(&conn).unwrap().is_empty());
        assert!(matches!(
            set_automation_enabled(&conn, "a-1", true),
            Err(AutomationStorageError::NotFound)
        ));
    }

    #[test]
    fn empty_name_is_rejected() {
        let conn = open_test_db();
        assert!(matches!(
            create_automation(
                &conn,
                "a-x",
                "  ",
                &sample_config("x", 1.0),
                &[],
                true,
                None
            ),
            Err(AutomationStorageError::Validation(_))
        ));
    }

    #[test]
    fn config_survives_roundtrip() {
        let conn = open_test_db();
        create_automation(
            &conn,
            "a-2",
            "CPU",
            &sample_config("CPU", 90.0),
            &[],
            false,
            None,
        )
        .unwrap();
        let loaded = &list_automations(&conn).unwrap()[0];
        assert!(!loaded.enabled);
        assert_eq!(loaded.site_id, None);
        assert!(matches!(
            loaded.config.target,
            WatchdogTarget::PerformanceCounter {
                metric: PerformanceMetric::DiskUsedPercent
            }
        ));
        assert!(matches!(
            loaded.config.trigger.predicate,
            PredicateOp::Gt { value } if (value - 90.0).abs() < f64::EPSILON
        ));
    }
}

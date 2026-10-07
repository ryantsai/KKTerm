// IPAM custom metadata. Credential values contain vault references only.
use std::collections::{BTreeMap, HashSet};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::ids::new_itops_id;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldDefinition {
    pub id: String,
    pub name: String,
    pub record_kind: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub options: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldValue {
    pub field_id: String,
    pub record_kind: String,
    pub record_id: String,
    pub value: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSnapshot {
    pub fields: Vec<FieldDefinition>,
    pub values: Vec<FieldValue>,
}

pub type FieldValues = BTreeMap<String, Value>;

fn owner_table(kind: &str) -> Result<&'static str, String> {
    match kind {
        "prefix" => Ok("itops_ip_prefixes"),
        "address" => Ok("itops_ip_address_records"),
        "vlan" => Ok("itops_vlans"),
        _ => Err("Unknown custom field record kind".into()),
    }
}

fn read_field(row: &rusqlite::Row<'_>) -> rusqlite::Result<FieldDefinition> {
    let options: String = row.get(4)?;
    Ok(FieldDefinition {
        id: row.get(0)?,
        name: row.get(1)?,
        record_kind: row.get(2)?,
        field_type: row.get(3)?,
        options: serde_json::from_str(&options).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
    })
}

pub fn snapshot(conn: &Connection) -> Result<FieldSnapshot, String> {
    let mut stmt = conn.prepare(
        "SELECT id, name, record_kind, field_type, options_json FROM itops_custom_fields ORDER BY sort_order, id"
    ).map_err(|e| e.to_string())?;
    let fields = stmt
        .query_map([], read_field)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT field_id, record_kind, record_id, value_json FROM itops_custom_field_values ORDER BY field_id, record_id"
    ).map_err(|e| e.to_string())?;
    let values = stmt
        .query_map([], |row| {
            let json: String = row.get(3)?;
            Ok(FieldValue {
                field_id: row.get(0)?,
                record_kind: row.get(1)?,
                record_id: row.get(2)?,
                value: serde_json::from_str(&json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(FieldSnapshot { fields, values })
}

fn valid_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return false;
    }
    let year: u32 = text[..4].parse().unwrap_or(0);
    let month: u32 = text[5..7].parse().unwrap_or(0);
    let day: u32 = text[8..].parse().unwrap_or(0);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    year > 0 && day > 0 && day <= days
}

fn valid_reference(value: &Value, kind: &str, keys: &[&str]) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == keys.len() + 1
        && value.get("kind").and_then(Value::as_str) == Some(kind)
        && keys.iter().all(|key| {
            value.get(key).and_then(Value::as_str).is_some_and(|text| {
                !text.trim().is_empty() && text.len() <= 256 && text == text.trim()
            })
        })
}

pub fn validate_value(field: &FieldDefinition, value: &Value) -> Result<(), String> {
    if value.is_null() {
        return Ok(());
    }
    let text = value.as_str();
    let valid = match field.field_type.as_str() {
        "text" | "multiline" => text.is_some_and(|text| text.len() <= 16384),
        "number" => value.as_f64().is_some_and(f64::is_finite),
        "boolean" => value.is_boolean(),
        "date" => text.is_some_and(valid_date),
        "select" => text.is_some_and(|text| field.options.iter().any(|option| option == text)),
        "url" => text.is_some_and(|text| {
            text.len() <= 2048
                && url::Url::parse(text).is_ok_and(|url| {
                    matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
                })
        }),
        "credential" => valid_reference(value, "credential", &["credentialId"]),
        "link" => {
            valid_reference(value, "connection", &["connectionId"])
                || valid_reference(value, "rack", &["siteId", "rackId"])
                || valid_reference(value, "rackItem", &["siteId", "rackId", "rackItemId"])
                || valid_reference(value, "networkNode", &["mapId", "nodeId"])
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid value for custom field '{}'", field.name))
    }
}

pub fn set_fields(
    conn: &Connection,
    mut fields: Vec<FieldDefinition>,
) -> Result<FieldSnapshot, String> {
    if fields.len() > 128 {
        return Err("At most 128 custom fields are supported".into());
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for field in &mut fields {
        field.name = field.name.trim().to_string();
        owner_table(&field.record_kind)?;
        if field.id.trim().is_empty()
            || field.id.len() > 128
            || !ids.insert(field.id.clone())
            || field.name.is_empty()
            || field.name.chars().count() > 120
            || !names.insert((field.record_kind.clone(), field.name.to_lowercase()))
            || !matches!(
                field.field_type.as_str(),
                "text"
                    | "multiline"
                    | "number"
                    | "boolean"
                    | "date"
                    | "select"
                    | "url"
                    | "credential"
                    | "link"
            )
        {
            return Err(
                "Custom fields need unique names per record kind and a supported type".into(),
            );
        }
        if field.field_type == "select" {
            let mut options = HashSet::new();
            for option in &mut field.options {
                *option = option.trim().to_string();
                if option.is_empty() || option.chars().count() > 120 || !options.insert(option.clone()) {
                    return Err("Choice options must be non-empty and unique".into());
                }
            }
            if field.options.is_empty() || field.options.len() > 100 {
                return Err("A choice field needs 1–100 options".into());
            }
        } else {
            field.options.clear();
        }
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let existing = snapshot(&tx)?;
    for field in &fields {
        if let Some(old) = existing.fields.iter().find(|old| old.id == field.id) {
            if old.record_kind != field.record_kind || old.field_type != field.field_type {
                return Err(
                    "The type and record kind of a saved custom field cannot change".into(),
                );
            }
        }
        for entry in existing
            .values
            .iter()
            .filter(|entry| entry.field_id == field.id)
        {
            validate_value(field, &entry.value)?;
        }
    }
    for old in &existing.fields {
        if !ids.contains(&old.id) {
            tx.execute("DELETE FROM itops_custom_fields WHERE id = ?", [&old.id])
                .map_err(|e| e.to_string())?;
        }
    }
    for (position, field) in fields.iter().enumerate() {
        tx.execute(
            "INSERT INTO itops_custom_fields (id, name, record_kind, field_type, options_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, options_json=excluded.options_json, sort_order=excluded.sort_order",
            params![field.id, field.name, field.record_kind, field.field_type, serde_json::to_string(&field.options).map_err(|e| e.to_string())?, position as i64],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    snapshot(conn)
}

/// The record and its custom values commit together. None keeps old callers compatible.
pub fn with_record_values<T>(
    conn: &Connection,
    kind: &str,
    id: &str,
    values: Option<FieldValues>,
    write: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let Some(values) = values else {
        return write(conn);
    };
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (field_id, value) in &values {
        let field = tx.query_row(
            "SELECT id, name, record_kind, field_type, options_json FROM itops_custom_fields WHERE id = ?",
            [field_id], read_field,
        ).optional().map_err(|e| e.to_string())?.ok_or("Custom field no longer exists")?;
        if field.record_kind != kind {
            return Err("Custom field belongs to a different record kind".into());
        }
        validate_value(&field, value)?;
    }
    let result = write(&tx)?;
    let table = owner_table(kind)?;
    let exists: bool = tx
        .query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?)"),
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("Custom field record no longer exists".into());
    }
    for (field_id, value) in values {
        if value.is_null() {
            tx.execute(
                "DELETE FROM itops_custom_field_values WHERE field_id = ? AND record_id = ?",
                params![field_id, id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            tx.execute(
                "INSERT INTO itops_custom_field_values (id, field_id, record_kind, record_id, value_json) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(field_id, record_id) DO UPDATE SET value_json=excluded.value_json",
                params![new_itops_id("cfvalue"), field_id, kind, id, value.to_string()],
            ).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn itops_custom_field_snapshot(app: AppHandle) -> Result<FieldSnapshot, String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(snapshot)
}

#[tauri::command]
pub fn itops_set_custom_fields(
    app: AppHandle,
    fields: Vec<FieldDefinition>,
) -> Result<FieldSnapshot, String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| set_fields(conn, fields))
}

#[cfg(test)]
#[path = "custom_fields_tests.rs"]
mod tests;

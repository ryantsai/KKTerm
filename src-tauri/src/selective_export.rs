//! Selective, category-aware export/import of the KKTerm SQLite store.
//!
//! Unlike the whole-database export (`storage::export_database`) which packs and
//! replaces the entire file, this module lets the user pick *which* categories
//! ("segments") to carry and, on import, choose per segment whether to skip, add
//! (merge) or replace. The driving use case from issue #378 is sharing SSH/URL
//! Connections with a colleague **without** passwords, while still allowing a
//! passphrase-protected full personal backup.
//!
//! Secrets never travel in the clear: when credentials are included they are
//! pulled from the active credential backend, bundled into `secrets.enc`, and
//! encrypted with an Argon2id-derived AES-256-GCM key (the same envelope the
//! encrypted SQLite secret store uses), unlocked on import with the passphrase.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use aes_gcm::aead::{Aead, Generate, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rusqlite::Connection as SqliteConnection;
use rusqlite::types::{Value as SqlValue, ValueRef};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, State};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::secrets::{Secrets, StoreSecretRequest};
use crate::storage::{DEFAULT_WORKSPACE_ID, Storage};

const SELECTIVE_FORMAT: &str = "kkterm-selective-export";
const SELECTIVE_VERSION: u32 = 2;

/// Lowest bundle version able to carry the chosen segments. v1 shipped
/// workspaces/connections/dashboards/settings/mcpServers; v2 added the
/// itops and assistant segments. Writing the minimum keeps bundles without
/// the newer segments importable by older app versions.
fn required_bundle_version(segments: &[String]) -> u32 {
    if segments
        .iter()
        .any(|segment| segment == "itops" || segment == "assistant")
    {
        2
    } else {
        1
    }
}
const SECRETS_AAD: &[u8] = b"kkterm-selective-secrets";
const AES_GCM_NONCE_LENGTH: usize = 12;

/// Per-table primary-key handling used when merging rows into an existing store.
enum Pk {
    /// A standalone text `id` column, regenerated to a fresh id on "add" so a
    /// shared file never collides with the importer's existing rows.
    Generated(&'static str),
    /// A composite/leaf table with no remappable standalone key
    /// (e.g. `connection_tags`); only its foreign keys are rewritten.
    Composite,
    /// A natural key that is upserted rather than remapped (`settings.key`).
    Natural,
}

struct TableSpec {
    name: &'static str,
    pk: Pk,
    /// `(column, referenced_table)` foreign keys to rewrite on merge.
    fks: &'static [(&'static str, &'static str)],
}

/// Tables that make up each segment, listed parent-before-child so inserts honour
/// the `foreign_keys = ON` pragma (deletes for "replace" run in reverse).
fn segment_tables(segment: &str) -> Option<&'static [TableSpec]> {
    match segment {
        "workspaces" => Some(&[TableSpec {
            name: "workspaces",
            pk: Pk::Generated("ws"),
            fks: &[],
        }]),
        "connections" => Some(&[
            TableSpec {
                name: "connection_password_credentials",
                pk: Pk::Generated("cpc"),
                fks: &[("created_from_connection_id", "connections")],
            },
            TableSpec {
                name: "connection_folders",
                pk: Pk::Generated("folder"),
                fks: &[
                    ("parent_folder_id", "connection_folders"),
                    ("workspace_id", "workspaces"),
                ],
            },
            TableSpec {
                name: "connections",
                pk: Pk::Generated("conn"),
                fks: &[
                    ("folder_id", "connection_folders"),
                    ("workspace_id", "workspaces"),
                    ("password_credential_id", "connection_password_credentials"),
                ],
            },
            TableSpec {
                name: "connection_tags",
                pk: Pk::Composite,
                fks: &[("connection_id", "connections")],
            },
            TableSpec {
                name: "url_credentials",
                pk: Pk::Composite,
                fks: &[("connection_id", "connections")],
            },
        ]),
        "dashboards" => Some(&[
            TableSpec {
                name: "dashboard_views",
                pk: Pk::Generated("view"),
                fks: &[],
            },
            TableSpec {
                name: "dashboard_custom_widgets",
                pk: Pk::Generated("cw"),
                fks: &[],
            },
            TableSpec {
                name: "dashboard_widget_instances",
                pk: Pk::Generated("inst"),
                // source_id -> dashboard_custom_widgets only when kind = 'script';
                // built-in source ids are constants and handled specially below.
                fks: &[("view_id", "dashboard_views")],
            },
        ]),
        "settings" => Some(&[TableSpec {
            name: "settings",
            pk: Pk::Natural,
            fks: &[],
        }]),
        "mcpServers" => Some(&[TableSpec {
            name: "mcp_servers",
            pk: Pk::Generated("mcp"),
            fks: &[],
        }]),
        // IT Ops Module data (docs/ITOPS.md). Sites soft-reference Connections
        // (member_ids_json), rack items and Hosts soft-reference connections.id,
        // and Automations / run history soft-reference Sites and Tasks — all
        // handled in `rewrite_soft_references` because none carries an FK
        // constraint. JSON-contained references in filters, rack metadata,
        // Automation actions, and run reports are remapped there as well.
        "itops" => Some(&[
            TableSpec {
                name: "itops_sites",
                pk: Pk::Generated("site"),
                fks: &[],
            },
            TableSpec {
                name: "itops_server_rooms",
                pk: Pk::Generated("room"),
                fks: &[("site_id", "itops_sites")],
            },
            TableSpec {
                name: "itops_site_racks",
                pk: Pk::Generated("rack"),
                fks: &[("site_id", "itops_sites")],
            },
            TableSpec {
                name: "itops_site_rack_items",
                pk: Pk::Generated("ri"),
                // connection_id is a soft reference kept as a "ghost" when the
                // Connection is absent, so it is not listed as an FK here.
                fks: &[("rack_id", "itops_site_racks")],
            },
            TableSpec {
                name: "itops_room_objects",
                pk: Pk::Generated("robj"),
                fks: &[("site_id", "itops_sites")],
            },
            TableSpec {
                name: "itops_hosts",
                pk: Pk::Generated("host"),
                fks: &[("site_id", "itops_sites")],
            },
            TableSpec {
                name: "itops_tasks",
                pk: Pk::Generated("task"),
                fks: &[],
            },
            TableSpec {
                name: "itops_automations",
                pk: Pk::Generated("auto"),
                fks: &[],
            },
            TableSpec {
                name: "itops_run_history",
                pk: Pk::Generated("run"),
                fks: &[],
            },
        ]),
        // AI Assistant chat history and durable memories. Memory scope
        // ("connection:<id>") follows a Connection imported in the same bundle.
        "assistant" => Some(&[
            TableSpec {
                name: "assistant_chat_threads",
                pk: Pk::Generated("thread"),
                fks: &[],
            },
            TableSpec {
                name: "assistant_memories",
                pk: Pk::Generated("mem"),
                fks: &[],
            },
        ]),
        // Intentionally not exportable: encrypted_secret_store_entries (secrets
        // never travel outside secrets.enc), ai_coding_usage_accounts /
        // ai_coding_usage_snapshots (machine-local auth state and usage cache),
        // and installer_tool_state (per-machine tool detection cache).
        _ => None,
    }
}

/// Fixed processing order so parent segments are imported before segments that
/// may reference them (connections -> dashboards is irrelevant here, but
/// workspaces must precede connections for cross-segment foreign keys).
const SEGMENT_ORDER: &[&str] = &[
    "workspaces",
    "connections",
    "dashboards",
    "settings",
    "mcpServers",
    "itops",
    "assistant",
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectiveManifest {
    pub product: String,
    pub format: String,
    pub version: u32,
    pub created_at: String,
    pub segments: Vec<String>,
    pub encrypted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectiveExportInfo {
    pub filename: String,
    pub segments: Vec<String>,
    pub encrypted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectiveImportResult {
    pub backup_filename: String,
    pub applied: Vec<String>,
}

/// One credential carried in `secrets.enc`. `owner_id` is the source-machine id;
/// it is rewritten through the import remap so it lands on the merged rows.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretEntry {
    kind: String,
    owner_id: String,
    secret: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedBlob {
    kdf: String,
    cipher: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

// ── Export ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn export_selective_database(
    storage: State<'_, Storage>,
    secrets: State<'_, Secrets>,
    path: String,
    segments: Vec<String>,
    include_credentials: bool,
    passphrase: Option<String>,
) -> Result<SelectiveExportInfo, String> {
    if segments.is_empty() {
        return Err("select at least one category to export".to_string());
    }
    for segment in &segments {
        if segment_tables(segment).is_none() {
            return Err(format!("unknown export category {segment:?}"));
        }
    }
    if include_credentials {
        if !segments.iter().any(|segment| segment == "connections") {
            return Err("including credentials requires exporting Connections".to_string());
        }
        if passphrase.as_deref().unwrap_or("").is_empty() {
            return Err("a passphrase is required to include credentials".to_string());
        }
    }

    // Serialize the chosen segments' rows.
    let data: Map<String, Value> = storage.with_connection(|conn| {
        let mut data = Map::new();
        for segment in &segments {
            let tables = segment_tables(segment).expect("segment validated above");
            let mut segment_map = Map::new();
            for table in tables {
                let rows = read_table(conn, table.name)?;
                segment_map.insert(table.name.to_string(), Value::Array(rows));
            }
            data.insert(segment.clone(), Value::Object(segment_map));
        }
        Ok(data)
    })?;

    // Collect + encrypt connection secrets when requested.
    let encrypted = include_credentials;
    let secrets_blob = if include_credentials {
        let entries = collect_connection_secrets(&secrets, &data)?;
        let plaintext = serde_json::to_vec(&entries)
            .map_err(|error| format!("failed to serialize secrets: {error}"))?;
        let blob = encrypt_blob(passphrase.as_deref().unwrap_or(""), &plaintext)?;
        Some(
            serde_json::to_vec(&blob)
                .map_err(|error| format!("failed to encode secrets: {error}"))?,
        )
    } else {
        None
    };

    let manifest = SelectiveManifest {
        product: "KKTerm".to_string(),
        format: SELECTIVE_FORMAT.to_string(),
        version: required_bundle_version(&segments),
        created_at: OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "unknown".to_string()),
        segments: segments.clone(),
        encrypted,
    };

    write_bundle(
        Path::new(&path),
        &manifest,
        &Value::Object(data),
        secrets_blob.as_deref(),
    )?;

    Ok(SelectiveExportInfo {
        filename: Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&path)
            .to_string(),
        segments,
        encrypted,
    })
}

/// Read every connection-related secret referenced by the exported rows, from
/// the active credential backend. Missing secrets are skipped silently — a
/// Connection may simply not have a saved password.
fn collect_connection_secrets(
    secrets: &Secrets,
    data: &Map<String, Value>,
) -> Result<Vec<SecretEntry>, String> {
    let mut entries = Vec::new();
    let Some(connections) = data.get("connections").and_then(Value::as_object) else {
        return Ok(entries);
    };

    if let Some(rows) = connections
        .get("connection_password_credentials")
        .and_then(Value::as_array)
    {
        for row in rows {
            if let Some(id) = row.get("id").and_then(Value::as_str) {
                if let Some(secret) = secrets.read_connection_password(id.to_string())? {
                    entries.push(SecretEntry {
                        kind: "connectionPassword".to_string(),
                        owner_id: id.to_string(),
                        secret,
                    });
                }
            }
        }
    }

    if let Some(rows) = connections.get("url_credentials").and_then(Value::as_array) {
        for row in rows {
            let Some(owner_id) = row
                .get("secret_owner_id")
                .or_else(|| row.get("connection_id"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            if let Some(secret) = secrets.read_url_password(owner_id.to_string())? {
                entries.push(SecretEntry {
                    kind: "urlPassword".to_string(),
                    owner_id: owner_id.to_string(),
                    secret,
                });
            }
        }
    }

    if let Some(rows) = connections.get("connections").and_then(Value::as_array) {
        for row in rows {
            let Some(id) = row.get("id").and_then(Value::as_str) else {
                continue;
            };
            let connection_type = row
                .get("connection_type")
                .and_then(Value::as_str)
                .unwrap_or("");
            if connection_type == "ssh" {
                if let Some(secret) = secrets.read_connection_passphrase(id.to_string())? {
                    entries.push(SecretEntry {
                        kind: "connectionPassphrase".to_string(),
                        owner_id: id.to_string(),
                        secret,
                    });
                }
            }
            let has_socks = row
                .get("ssh_socks_proxy")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty());
            if has_socks {
                if let Some(secret) = secrets.read_ssh_socks_proxy_password(id.to_string())? {
                    entries.push(SecretEntry {
                        kind: "sshSocksProxyPassword".to_string(),
                        owner_id: id.to_string(),
                        secret,
                    });
                }
            }
        }
    }

    Ok(entries)
}

// ── Inspect ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn inspect_selective_database(path: String) -> Result<SelectiveManifest, String> {
    let (manifest, _data, _secrets) = read_bundle(Path::new(&path))?;
    Ok(manifest)
}

// ── Import ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn import_selective_database(
    app: AppHandle,
    storage: State<'_, Storage>,
    secrets: State<'_, Secrets>,
    path: String,
    actions: HashMap<String, String>,
    passphrase: Option<String>,
) -> Result<SelectiveImportResult, String> {
    let (manifest, data, secrets_blob) = read_bundle(Path::new(&path))?;
    if manifest.format != SELECTIVE_FORMAT {
        return Err(format!("unsupported bundle format {:?}", manifest.format));
    }
    if manifest.version > SELECTIVE_VERSION {
        return Err(format!(
            "bundle version {} is newer than supported ({SELECTIVE_VERSION})",
            manifest.version
        ));
    }
    validate_import_actions(&actions)?;

    // Decrypt secrets up-front so a wrong passphrase fails before any DB write.
    let credential_action = actions
        .get("credentials")
        .map(String::as_str)
        .unwrap_or("skip");
    let secret_entries: Vec<SecretEntry> = if credential_action != "skip" {
        match secrets_blob {
            Some(bytes) => {
                let passphrase = passphrase.as_deref().unwrap_or("");
                if passphrase.is_empty() {
                    return Err("a passphrase is required to import credentials".to_string());
                }
                let blob: EncryptedBlob = serde_json::from_slice(&bytes)
                    .map_err(|error| format!("invalid secrets payload: {error}"))?;
                let plaintext = decrypt_blob(passphrase, &blob)?;
                serde_json::from_slice(&plaintext)
                    .map_err(|error| format!("invalid secrets payload: {error}"))?
            }
            None => Vec::new(),
        }
    } else {
        Vec::new()
    };

    // Safety backup before mutating the live store.
    let backup = storage.backup_database()?;

    // Remap captured across all segments so cross-segment foreign keys resolve.
    let mut remap: HashMap<(String, String), String> = HashMap::new();
    let mut applied: Vec<String> = Vec::new();

    let data_obj = data.as_object().ok_or("bundle data is malformed")?;

    storage.with_connection_mut(|conn| {
        let tx = conn
            .transaction()
            .map_err(|error| format!("failed to begin import: {error}"))?;
        tx.pragma_update(None, "defer_foreign_keys", "ON")
            .map_err(|error| format!("failed to defer import foreign keys: {error}"))?;

        for segment in SEGMENT_ORDER {
            let action = actions.get(*segment).map(String::as_str).unwrap_or("skip");
            if action == "skip" {
                continue;
            }
            let Some(segment_data) = data_obj.get(*segment).and_then(Value::as_object) else {
                continue;
            };
            let tables =
                segment_tables(segment).ok_or_else(|| format!("unknown segment {segment}"))?;
            apply_segment(&tx, tables, segment_data, action, &mut remap)?;
            applied.push((*segment).to_string());
        }

        tx.commit()
            .map_err(|error| format!("failed to commit import: {error}"))?;
        Ok::<(), String>(())
    })?;

    if applied.iter().any(|segment| segment == "itops") {
        crate::itops::automation_commands::reconcile_automations(&app);
    }

    // Write credentials into the active backend, owner ids rewritten via remap.
    if credential_action != "skip" {
        write_secrets(&secrets, &secret_entries, &remap)?;
    }

    Ok(SelectiveImportResult {
        backup_filename: backup.filename().to_string(),
        applied,
    })
}

fn validate_import_actions(actions: &HashMap<String, String>) -> Result<(), String> {
    for (segment, action) in actions {
        if segment != "credentials" && !SEGMENT_ORDER.contains(&segment.as_str()) {
            return Err(format!("unknown import category {segment:?}"));
        }
        if !matches!(action.as_str(), "skip" | "add" | "replace") {
            return Err(format!("unknown import action {action:?} for {segment}"));
        }
    }
    if actions.get("workspaces").map(String::as_str) == Some("replace")
        && actions.get("connections").map(String::as_str) != Some("replace")
    {
        return Err(
            "replacing Workspaces also requires replacing Connections to avoid orphaned or deleted Connections"
                .to_string(),
        );
    }
    Ok(())
}

fn apply_segment(
    tx: &rusqlite::Transaction<'_>,
    tables: &[TableSpec],
    segment_data: &Map<String, Value>,
    action: &str,
    remap: &mut HashMap<(String, String), String>,
) -> Result<(), String> {
    // For "replace", clear the segment's tables child-before-parent first.
    if action == "replace" {
        for table in tables.iter().rev() {
            tx.execute(&format!("DELETE FROM {}", table.name), [])
                .map_err(|error| format!("failed to clear {}: {error}", table.name))?;
        }
    }

    // Pass 1 — assign new primary keys for "add" so nothing collides.
    if action == "add" {
        for table in tables {
            if let Pk::Generated(prefix) = table.pk {
                if let Some(rows) = segment_data.get(table.name).and_then(Value::as_array) {
                    for row in rows {
                        if let Some(old) = row.get("id").and_then(Value::as_str) {
                            // Built-in IT Ops Tasks carry a deterministic
                            // `builtin-task-<key>` id seeded on every install;
                            // keep it so the importer's own copy wins and Task
                            // soft references still resolve.
                            let new = if is_builtin_task_row(table.name, row) {
                                old.to_string()
                            } else {
                                generate_id(prefix)
                            };
                            remap.insert((table.name.to_string(), old.to_string()), new);
                        }
                    }
                }
            }
        }
    } else {
        // "replace" preserves ids; record identity mappings so cross-segment
        // foreign keys from other segments still resolve to these rows.
        for table in tables {
            if matches!(table.pk, Pk::Generated(_)) {
                if let Some(rows) = segment_data.get(table.name).and_then(Value::as_array) {
                    for row in rows {
                        if let Some(id) = row.get("id").and_then(Value::as_str) {
                            remap
                                .entry((table.name.to_string(), id.to_string()))
                                .or_insert_with(|| id.to_string());
                        }
                    }
                }
            }
        }
    }

    // Pass 2 — rewrite + insert parent-before-child.
    for table in tables {
        let Some(rows) = segment_data.get(table.name).and_then(Value::as_array) else {
            continue;
        };
        for row in rows {
            let Some(row_obj) = row.as_object() else {
                continue;
            };
            if table.name == "settings" {
                upsert_setting(tx, row_obj, action)?;
                continue;
            }
            let mut rewritten = row_obj.clone();
            rewrite_row(tx, table, &mut rewritten, remap)?;
            // On "add", a built-in Task the importer already has (same
            // deterministic id / built_in_key) is kept as-is rather than
            // duplicated; one the importer lacks is inserted.
            let keep_existing = action == "add" && is_builtin_task_row(table.name, row);
            insert_row(tx, table.name, &rewritten, keep_existing)?;
        }
    }

    Ok(())
}

/// A bundled IT Ops Task row that is part of the seeded built-in catalog
/// (non-empty `built_in_key`), which every install carries with the same ids.
fn is_builtin_task_row(table: &str, row: &Value) -> bool {
    table == "itops_tasks"
        && row
            .get("built_in_key")
            .and_then(Value::as_str)
            .is_some_and(|key| !key.is_empty())
}

/// Rewrite a row's primary key and foreign keys against the accumulated remap.
fn rewrite_row(
    tx: &rusqlite::Transaction<'_>,
    table: &TableSpec,
    row: &mut Map<String, Value>,
    remap: &HashMap<(String, String), String>,
) -> Result<(), String> {
    // Primary key.
    match &table.pk {
        Pk::Generated(_) => {
            if let Some(old) = row.get("id").and_then(Value::as_str).map(str::to_string) {
                if let Some(new) = remap.get(&(table.name.to_string(), old)) {
                    row.insert("id".to_string(), Value::String(new.clone()));
                }
            }
        }
        Pk::Composite | Pk::Natural => {}
    }

    // Workspaces gain a default flag conflict if two rows claim default; on add
    // we keep only the importer's existing default.
    if table.name == "workspaces" && row.contains_key("is_default") {
        row.insert("is_default".to_string(), Value::from(0));
    }

    // mcp_servers.name is UNIQUE; on merge a same-named local server would
    // fail the whole import, so suffix the imported one instead. (On
    // "replace" the table was already cleared, so the name passes untouched.)
    if table.name == "mcp_servers" {
        if let Some(name) = row.get("name").and_then(Value::as_str).map(str::to_string) {
            let unique = unique_value(tx, "mcp_servers", "name", &name)?;
            if unique != name {
                row.insert("name".to_string(), Value::String(unique));
            }
        }
    }

    let old_url_secret_owner = if table.name == "url_credentials" {
        row.get("secret_owner_id")
            .and_then(Value::as_str)
            .map(str::to_string)
    } else {
        None
    };

    // Foreign keys.
    for (column, referenced) in table.fks {
        let Some(old) = row.get(*column).and_then(Value::as_str).map(str::to_string) else {
            continue; // null or absent
        };
        let mut resolved = resolve_fk(tx, referenced, &old, remap)?;
        if *column == "workspace_id" && resolved.is_none() {
            resolved = Some(DEFAULT_WORKSPACE_ID.to_string());
        }
        row.insert((*column).to_string(), value_or_null(resolved));
    }

    if table.name == "url_credentials" {
        if let Some(old_owner) = old_url_secret_owner {
            if let Some(new_owner) = remap_url_password_owner(&old_owner, remap) {
                row.insert("secret_owner_id".to_string(), Value::String(new_owner));
            }
        } else if let Some(connection_id) = row.get("connection_id").and_then(Value::as_str) {
            row.insert(
                "secret_owner_id".to_string(),
                Value::String(connection_id.to_string()),
            );
        }
    }

    // dashboard_widget_instances.source_id references a custom widget only for
    // script widgets; built-in source ids are constants kept verbatim.
    if table.name == "dashboard_widget_instances"
        && row.get("kind").and_then(Value::as_str) == Some("script")
    {
        if let Some(old) = row
            .get("source_id")
            .and_then(Value::as_str)
            .map(str::to_string)
        {
            let resolved = resolve_fk(tx, "dashboard_custom_widgets", &old, remap)?;
            row.insert("source_id".to_string(), value_or_null(resolved));
        }
    }

    rewrite_soft_references(table.name, row, remap);

    Ok(())
}

/// Rewrite the soft references (columns without an FK constraint) that the IT
/// Ops and assistant tables carry. Unlike `resolve_fk`, an id whose target was
/// not imported in the same bundle is kept verbatim rather than nulled: the
/// schema treats these as tolerated dangling references (e.g. "ghost" rack
/// items), so the merged row behaves exactly like the source machine's row.
fn rewrite_soft_references(
    table: &str,
    row: &mut Map<String, Value>,
    remap: &HashMap<(String, String), String>,
) {
    match table {
        "itops_sites" => {
            remap_id_array(row, "member_ids_json", "connections", remap);
            rewrite_json_column(row, "filter_json", |filter| {
                remap_json_id(filter, "folderId", "connection_folders", remap);
            });
        }
        "itops_site_rack_items" => {
            remap_soft_id(row, "connection_id", "connections", remap);
            rewrite_json_column(row, "metadata_json", |metadata| {
                remap_json_id_array(metadata, "connectionIds", "connections", remap);
                remap_json_id(metadata, "hostId", "itops_hosts", remap);
            });
        }
        "itops_hosts" => {
            remap_soft_id(row, "parent_host_id", "itops_hosts", remap);
            remap_id_array(row, "connection_ids_json", "connections", remap);
        }
        "itops_automations" => {
            remap_soft_id(row, "site_id", "itops_sites", remap);
            rewrite_json_column(row, "actions_json", |actions| {
                if let Some(actions) = actions.as_array_mut() {
                    for action in actions {
                        if action.get("kind").and_then(Value::as_str) == Some("runBatch") {
                            remap_json_id(action, "siteId", "itops_sites", remap);
                            if let Some(task) = action.get_mut("task") {
                                clear_secret_owner_ids(task);
                            }
                        }
                    }
                }
            });
        }
        "itops_run_history" => {
            remap_soft_id(row, "site_id", "itops_sites", remap);
            remap_soft_id(row, "task_id", "itops_tasks", remap);
            // source is 'manual' or 'automation:<automation_id>'.
            if let Some(rest) = row
                .get("source")
                .and_then(Value::as_str)
                .and_then(|source| source.strip_prefix("automation:"))
            {
                if let Some(new) = remap.get(&("itops_automations".to_string(), rest.to_string())) {
                    row.insert(
                        "source".to_string(),
                        Value::String(format!("automation:{new}")),
                    );
                }
            }
            rewrite_json_column(row, "report_json", |report| {
                if let Some(hosts) = report.get_mut("hosts").and_then(Value::as_array_mut) {
                    for host in hosts {
                        remap_json_id(host, "connectionId", "connections", remap);
                    }
                }
            });
        }
        "itops_tasks" => {
            // The selective bundle does not carry IT Ops vault entries. Drop
            // their opaque owner ids so an imported Task cannot bind to an
            // unrelated local secret that happens to use the same identifier.
            rewrite_json_column(row, "task_json", clear_secret_owner_ids);
        }
        "assistant_memories" => {
            // scope is "global" or "connection:<id>".
            if let Some(rest) = row
                .get("scope")
                .and_then(Value::as_str)
                .and_then(|scope| scope.strip_prefix("connection:"))
            {
                if let Some(new) = remap.get(&("connections".to_string(), rest.to_string())) {
                    row.insert(
                        "scope".to_string(),
                        Value::String(format!("connection:{new}")),
                    );
                }
            }
        }
        _ => {}
    }
}

fn rewrite_json_column(
    row: &mut Map<String, Value>,
    column: &str,
    rewrite: impl FnOnce(&mut Value),
) {
    let Some(text) = row.get(column).and_then(Value::as_str) else {
        return;
    };
    let Ok(mut value) = serde_json::from_str::<Value>(text) else {
        return;
    };
    rewrite(&mut value);
    if let Ok(encoded) = serde_json::to_string(&value) {
        row.insert(column.to_string(), Value::String(encoded));
    }
}

fn remap_json_id(
    value: &mut Value,
    field: &str,
    referenced: &str,
    remap: &HashMap<(String, String), String>,
) {
    let Some(old) = value.get(field).and_then(Value::as_str) else {
        return;
    };
    if let Some(new) = remap.get(&(referenced.to_string(), old.to_string())) {
        if let Some(object) = value.as_object_mut() {
            object.insert(field.to_string(), Value::String(new.clone()));
        }
    }
}

fn remap_json_id_array(
    value: &mut Value,
    field: &str,
    referenced: &str,
    remap: &HashMap<(String, String), String>,
) {
    let Some(ids) = value.get_mut(field).and_then(Value::as_array_mut) else {
        return;
    };
    for id in ids {
        let Some(old) = id.as_str() else {
            continue;
        };
        if let Some(new) = remap.get(&(referenced.to_string(), old.to_string())) {
            *id = Value::String(new.clone());
        }
    }
}

fn clear_secret_owner_ids(value: &mut Value) {
    match value {
        Value::Object(object) => {
            object.remove("secretOwnerId");
            for child in object.values_mut() {
                clear_secret_owner_ids(child);
            }
        }
        Value::Array(values) => {
            for child in values {
                clear_secret_owner_ids(child);
            }
        }
        _ => {}
    }
}

/// Remap a single soft-reference column when its target was imported in the
/// same bundle; leave it untouched otherwise.
fn remap_soft_id(
    row: &mut Map<String, Value>,
    column: &str,
    referenced: &str,
    remap: &HashMap<(String, String), String>,
) {
    let Some(old) = row.get(column).and_then(Value::as_str) else {
        return;
    };
    if let Some(new) = remap.get(&(referenced.to_string(), old.to_string())) {
        row.insert(column.to_string(), Value::String(new.clone()));
    }
}

/// Remap every id inside a JSON-array-of-strings column (e.g. a Site's ordered
/// Connection members) through the accumulated remap, keeping unmatched ids.
fn remap_id_array(
    row: &mut Map<String, Value>,
    column: &str,
    referenced: &str,
    remap: &HashMap<(String, String), String>,
) {
    let Some(text) = row.get(column).and_then(Value::as_str) else {
        return;
    };
    let Ok(Value::Array(ids)) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let rewritten: Vec<Value> = ids
        .into_iter()
        .map(|value| match value.as_str() {
            Some(id) => remap
                .get(&(referenced.to_string(), id.to_string()))
                .map(|new| Value::String(new.clone()))
                .unwrap_or(value),
            None => value,
        })
        .collect();
    if let Ok(encoded) = serde_json::to_string(&Value::Array(rewritten)) {
        row.insert(column.to_string(), Value::String(encoded));
    }
}

/// Resolve a foreign-key value: prefer the remap, fall back to an existing local
/// row, otherwise drop the link (the column is nullable for every cross-segment
/// case in our schema).
fn resolve_fk(
    tx: &rusqlite::Transaction<'_>,
    referenced: &str,
    old: &str,
    remap: &HashMap<(String, String), String>,
) -> Result<Option<String>, String> {
    if let Some(new) = remap.get(&(referenced.to_string(), old.to_string())) {
        return Ok(Some(new.clone()));
    }
    if id_exists(tx, referenced, old)? {
        return Ok(Some(old.to_string()));
    }
    Ok(None)
}

/// First free value for a UNIQUE text column: the value itself, else
/// "value (2)", "value (3)", … checked against the live transaction state.
fn unique_value(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    column: &str,
    value: &str,
) -> Result<String, String> {
    let taken = |candidate: &str| -> Result<bool, String> {
        tx.query_row(
            &format!("SELECT 1 FROM {table} WHERE {column} = ?1 LIMIT 1"),
            [candidate],
            |_| Ok(true),
        )
        .map_or_else(
            |error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(format!("failed to check {table}.{column}: {other}")),
            },
            |_| Ok(true),
        )
    };
    if !taken(value)? {
        return Ok(value.to_string());
    }
    for suffix in 2_u32.. {
        let candidate = format!("{value} ({suffix})");
        if !taken(&candidate)? {
            return Ok(candidate);
        }
    }
    unreachable!("unique_value counter exhausted")
}

fn id_exists(tx: &rusqlite::Transaction<'_>, table: &str, id: &str) -> Result<bool, String> {
    tx.query_row(
        &format!("SELECT 1 FROM {table} WHERE id = ?1 LIMIT 1"),
        [id],
        |_| Ok(true),
    )
    .map_or_else(
        |error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(false),
            other => Err(format!("failed to check {table}: {other}")),
        },
        |_| Ok(true),
    )
}

fn upsert_setting(
    tx: &rusqlite::Transaction<'_>,
    row: &Map<String, Value>,
    action: &str,
) -> Result<(), String> {
    let Some(key) = row.get("key").and_then(Value::as_str) else {
        return Ok(());
    };
    let value = row.get("value").and_then(Value::as_str).unwrap_or("");
    // "add" leaves an existing key untouched; "replace" overwrites it.
    let verb = if action == "add" {
        "INSERT OR IGNORE"
    } else {
        "INSERT OR REPLACE"
    };
    tx.execute(
        &format!("{verb} INTO settings (key, value) VALUES (?1, ?2)"),
        rusqlite::params![key, value],
    )
    .map_err(|error| format!("failed to import setting {key}: {error}"))?;
    Ok(())
}

fn write_secrets(
    secrets: &Secrets,
    entries: &[SecretEntry],
    remap: &HashMap<(String, String), String>,
) -> Result<(), String> {
    for entry in entries {
        let (table, kind) = match entry.kind.as_str() {
            "connectionPassword" => ("connection_password_credentials", "connectionPassword"),
            "connectionPassphrase" => ("connections", "connectionPassphrase"),
            "urlPassword" => ("connections", "urlPassword"),
            "sshSocksProxyPassword" => ("connections", "sshSocksProxyPassword"),
            other => {
                return Err(format!("unsupported credential kind {other:?}"));
            }
        };
        // Map the owner id to the merged row; if the owning Connection was not
        // imported, drop the secret rather than orphan it.
        let owner = if kind == "urlPassword" {
            remap_url_password_owner(&entry.owner_id, remap)
        } else {
            remap
                .get(&(table.to_string(), entry.owner_id.clone()))
                .cloned()
        };
        let Some(owner) = owner else {
            continue;
        };
        let request = match kind {
            "connectionPassword" => {
                StoreSecretRequest::connection_password(owner, entry.secret.clone())
            }
            "connectionPassphrase" => {
                StoreSecretRequest::connection_passphrase(owner, entry.secret.clone())
            }
            "urlPassword" => StoreSecretRequest::url_password(owner, entry.secret.clone()),
            _ => StoreSecretRequest::ssh_socks_proxy_password(owner, entry.secret.clone()),
        };
        secrets.store_secret(request)?;
    }
    Ok(())
}

fn remap_url_password_owner(
    owner_id: &str,
    remap: &HashMap<(String, String), String>,
) -> Option<String> {
    if let Some(mapped) = remap.get(&("connections".to_string(), owner_id.to_string())) {
        return Some(mapped.clone());
    }
    let rest = owner_id.strip_prefix("url:")?;
    let (connection_id, page_hash) = rest.rsplit_once(':')?;
    remap
        .get(&("connections".to_string(), connection_id.to_string()))
        .map(|mapped| format!("url:{mapped}:{page_hash}"))
}

// ── Generic row IO ──────────────────────────────────────────────────────────

fn read_table(conn: &SqliteConnection, table: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {table}"))
        .map_err(|error| format!("failed to read {table}: {error}"))?;
    let columns: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|name| name.to_string())
        .collect();
    let rows = stmt
        .query_map([], |row| {
            let mut map = Map::with_capacity(columns.len());
            for (index, name) in columns.iter().enumerate() {
                map.insert(name.clone(), value_ref_to_json(row.get_ref(index)?));
            }
            Ok(Value::Object(map))
        })
        .map_err(|error| format!("failed to read {table}: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read {table}: {error}"))?;
    Ok(rows)
}

fn insert_row(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    row: &Map<String, Value>,
    keep_existing: bool,
) -> Result<(), String> {
    let columns: Vec<&String> = row.keys().collect();
    if columns.is_empty() {
        return Ok(());
    }
    let placeholders = (1..=columns.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let column_list = columns
        .iter()
        .map(|name| name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let verb = if keep_existing {
        "INSERT OR IGNORE"
    } else {
        "INSERT"
    };
    let sql = format!("{verb} INTO {table} ({column_list}) VALUES ({placeholders})");
    let params: Vec<SqlValue> = columns
        .iter()
        .map(|name| json_to_sql(&row[*name]))
        .collect();
    tx.execute(&sql, rusqlite::params_from_iter(params))
        .map_err(|error| format!("failed to insert into {table}: {error}"))?;
    Ok(())
}

fn value_ref_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(integer) => Value::from(integer),
        ValueRef::Real(real) => Value::from(real),
        ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(bytes) => Value::String(BASE64.encode(bytes)),
    }
}

fn json_to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                SqlValue::Integer(integer)
            } else {
                SqlValue::Real(number.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(text) => SqlValue::Text(text.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn value_or_null(value: Option<String>) -> Value {
    value.map_or(Value::Null, Value::String)
}

// ── Bundle (zip) IO ─────────────────────────────────────────────────────────

fn write_bundle(
    path: &Path,
    manifest: &SelectiveManifest,
    data: &Value,
    secrets: Option<&[u8]>,
) -> Result<(), String> {
    let file = File::create(path)
        .map_err(|error| format!("failed to create export {}: {error}", path.display()))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("manifest.json", options)
        .map_err(|error| format!("failed to write manifest: {error}"))?;
    zip.write_all(
        serde_json::to_string_pretty(manifest)
            .map_err(|error| format!("failed to encode manifest: {error}"))?
            .as_bytes(),
    )
    .map_err(|error| format!("failed to write manifest: {error}"))?;

    zip.start_file("data.json", options)
        .map_err(|error| format!("failed to write data: {error}"))?;
    zip.write_all(
        serde_json::to_string(data)
            .map_err(|error| format!("failed to encode data: {error}"))?
            .as_bytes(),
    )
    .map_err(|error| format!("failed to write data: {error}"))?;

    if let Some(secrets) = secrets {
        zip.start_file("secrets.enc", options)
            .map_err(|error| format!("failed to write secrets: {error}"))?;
        zip.write_all(secrets)
            .map_err(|error| format!("failed to write secrets: {error}"))?;
    }

    zip.finish()
        .map_err(|error| format!("failed to finish export: {error}"))?;
    Ok(())
}

fn read_bundle(path: &Path) -> Result<(SelectiveManifest, Value, Option<Vec<u8>>), String> {
    let file = File::open(path)
        .map_err(|error| format!("failed to open import {}: {error}", path.display()))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("import file is not a valid bundle: {error}"))?;

    let manifest: SelectiveManifest = {
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|_| "bundle is missing manifest.json".to_string())?;
        let mut text = String::new();
        entry
            .read_to_string(&mut text)
            .map_err(|error| format!("failed to read manifest: {error}"))?;
        serde_json::from_str(&text).map_err(|error| format!("invalid manifest: {error}"))?
    };

    let data: Value = {
        let mut entry = archive
            .by_name("data.json")
            .map_err(|_| "bundle is missing data.json".to_string())?;
        let mut text = String::new();
        entry
            .read_to_string(&mut text)
            .map_err(|error| format!("failed to read data: {error}"))?;
        serde_json::from_str(&text).map_err(|error| format!("invalid data: {error}"))?
    };

    let secrets = match archive.by_name("secrets.enc") {
        Ok(mut entry) => {
            let mut bytes = Vec::new();
            entry
                .read_to_end(&mut bytes)
                .map_err(|error| format!("failed to read secrets: {error}"))?;
            Some(bytes)
        }
        Err(_) => None,
    };

    Ok((manifest, data, secrets))
}

// ── Passphrase crypto (Argon2id + AES-256-GCM) ──────────────────────────────

fn encrypt_blob(passphrase: &str, plaintext: &[u8]) -> Result<EncryptedBlob, String> {
    let salt = rand::random::<[u8; AES_GCM_NONCE_LENGTH]>();
    let nonce = Nonce::generate();
    let key = derive_key(passphrase, &salt)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| "failed to initialize cipher".to_string())?;
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: SECRETS_AAD,
            },
        )
        .map_err(|_| "failed to encrypt secrets".to_string())?;
    Ok(EncryptedBlob {
        kdf: "argon2id".to_string(),
        cipher: "aes-256-gcm".to_string(),
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(ciphertext),
    })
}

fn decrypt_blob(passphrase: &str, blob: &EncryptedBlob) -> Result<Vec<u8>, String> {
    if blob.kdf != "argon2id" || blob.cipher != "aes-256-gcm" {
        return Err("unsupported secrets encryption".to_string());
    }
    let salt = BASE64
        .decode(&blob.salt)
        .map_err(|error| format!("failed to decode salt: {error}"))?;
    let nonce_bytes = BASE64
        .decode(&blob.nonce)
        .map_err(|error| format!("failed to decode nonce: {error}"))?;
    let ciphertext = BASE64
        .decode(&blob.ciphertext)
        .map_err(|error| format!("failed to decode ciphertext: {error}"))?;
    let key = derive_key(passphrase, &salt)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| "failed to initialize cipher".to_string())?;
    let nonce = Nonce::try_from(nonce_bytes.as_slice())
        .map_err(|_| "failed to decode nonce: invalid length".to_string())?;
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: ciphertext.as_ref(),
                aad: SECRETS_AAD,
            },
        )
        .map_err(|_| "could not decrypt credentials; check the passphrase".to_string())
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|error| format!("failed to derive key: {error}"))?;
    Ok(key)
}

// ── id generation ──────────────────────────────────────────────────────────

static IMPORT_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Unique id for a merged row. The atomic counter guarantees uniqueness even
/// when many rows are remapped within the same millisecond.
fn generate_id(prefix: &str) -> String {
    let timestamp = OffsetDateTime::now_utc().unix_timestamp_nanos();
    let serial = IMPORT_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-imp-{timestamp}-{serial}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_round_trips_and_rejects_wrong_passphrase() {
        let plaintext = br#"[{"kind":"connectionPassword","ownerId":"cpc-1","secret":"hunter2"}]"#;
        let blob = encrypt_blob("correct horse", plaintext).expect("encrypt");
        let restored = decrypt_blob("correct horse", &blob).expect("decrypt");
        assert_eq!(restored, plaintext);
        assert!(decrypt_blob("wrong passphrase", &blob).is_err());
    }

    /// Minimal subset of the live schema exercised by the connections segment,
    /// with foreign keys enforced so ordering/remap bugs surface.
    fn connections_schema(conn: &SqliteConnection) {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                 is_default INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL);
             CREATE TABLE connection_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                 parent_folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
                 workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
                 sort_order INTEGER NOT NULL);
             CREATE TABLE connection_password_credentials (id TEXT PRIMARY KEY,
                 label TEXT NOT NULL,
                 created_from_connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL);
             CREATE TABLE connections (id TEXT PRIMARY KEY,
                 folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
                 workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
                 name TEXT NOT NULL, connection_type TEXT NOT NULL,
                 ssh_socks_proxy TEXT,
                 password_credential_id TEXT REFERENCES connection_password_credentials(id) ON DELETE SET NULL,
                 sort_order INTEGER NOT NULL);
             CREATE TABLE connection_tags (connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                 tag TEXT NOT NULL, sort_order INTEGER NOT NULL, PRIMARY KEY (connection_id, tag));
             CREATE TABLE url_credentials (
                 connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                 page_key TEXT NOT NULL DEFAULT '__legacy__',
                 secret_owner_id TEXT NOT NULL,
                 username TEXT NOT NULL,
                 PRIMARY KEY (connection_id, page_key)
             );",
        )
        .expect("schema");
    }

    #[test]
    fn merge_remaps_ids_and_foreign_keys() {
        // Source DB with a workspace -> folder -> connection chain, a reusable
        // password credential, and a tag.
        let src = SqliteConnection::open_in_memory().unwrap();
        connections_schema(&src);
        src.execute_batch(
            "INSERT INTO workspaces (id, name, is_default, sort_order) VALUES ('ws1','Work',1,0);
             INSERT INTO connection_folders (id, name, parent_folder_id, workspace_id, sort_order)
                 VALUES ('f1','Prod',NULL,'ws1',0);
             INSERT INTO connection_password_credentials (id, label, created_from_connection_id)
                 VALUES ('cpc1','root@host',NULL);
             INSERT INTO connections (id, folder_id, workspace_id, name, connection_type,
                 ssh_socks_proxy, password_credential_id, sort_order)
                 VALUES ('c1','f1','ws1','db','ssh',NULL,'cpc1',0);
             INSERT INTO connection_tags (connection_id, tag, sort_order) VALUES ('c1','prod',0);",
        )
        .unwrap();

        let mut ws_seg = Map::new();
        ws_seg.insert(
            "workspaces".to_string(),
            Value::Array(read_table(&src, "workspaces").unwrap()),
        );
        let mut conn_seg = Map::new();
        for spec in segment_tables("connections").unwrap() {
            conn_seg.insert(
                spec.name.to_string(),
                Value::Array(read_table(&src, spec.name).unwrap()),
            );
        }

        // Destination DB starts empty; merge both segments.
        let mut dst = SqliteConnection::open_in_memory().unwrap();
        connections_schema(&dst);
        let mut remap: HashMap<(String, String), String> = HashMap::new();
        {
            let tx = dst.transaction().unwrap();
            apply_segment(
                &tx,
                segment_tables("workspaces").unwrap(),
                &ws_seg,
                "add",
                &mut remap,
            )
            .unwrap();
            apply_segment(
                &tx,
                segment_tables("connections").unwrap(),
                &conn_seg,
                "add",
                &mut remap,
            )
            .unwrap();
            tx.commit().unwrap();
        }

        // The connection landed with fully remapped, internally consistent fks.
        let (conn_id, folder_id, workspace_id, credential_id): (String, String, String, String) =
            dst.query_row(
                "SELECT id, folder_id, workspace_id, password_credential_id FROM connections",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_ne!(conn_id, "c1", "connection id should be regenerated on add");
        assert_eq!(
            folder_id,
            *remap
                .get(&("connection_folders".to_string(), "f1".to_string()))
                .unwrap()
        );
        assert_eq!(
            workspace_id,
            *remap
                .get(&("workspaces".to_string(), "ws1".to_string()))
                .unwrap()
        );
        assert_eq!(
            credential_id,
            *remap
                .get(&(
                    "connection_password_credentials".to_string(),
                    "cpc1".to_string()
                ))
                .unwrap()
        );

        // The tag followed the connection to its new id.
        let tag_owner: String = dst
            .query_row("SELECT connection_id FROM connection_tags", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(tag_owner, conn_id);
    }

    #[test]
    fn merge_allows_credential_and_connection_cross_references() {
        let src = SqliteConnection::open_in_memory().unwrap();
        connections_schema(&src);
        src.execute_batch(
            "BEGIN;
             PRAGMA defer_foreign_keys = ON;
             INSERT INTO workspaces (id, name, is_default, sort_order) VALUES ('ws1','Work',1,0);
             INSERT INTO connection_password_credentials (id, label, created_from_connection_id)
                 VALUES ('cpc1','root@host','c1');
             INSERT INTO connections (id, folder_id, workspace_id, name, connection_type,
                 ssh_socks_proxy, password_credential_id, sort_order)
                 VALUES ('c1',NULL,'ws1','db','ssh',NULL,'cpc1',0);
             COMMIT;",
        )
        .unwrap();

        let mut ws_seg = Map::new();
        ws_seg.insert(
            "workspaces".to_string(),
            Value::Array(read_table(&src, "workspaces").unwrap()),
        );
        let mut conn_seg = Map::new();
        for spec in segment_tables("connections").unwrap() {
            conn_seg.insert(
                spec.name.to_string(),
                Value::Array(read_table(&src, spec.name).unwrap()),
            );
        }

        let mut dst = SqliteConnection::open_in_memory().unwrap();
        connections_schema(&dst);
        let mut remap: HashMap<(String, String), String> = HashMap::new();
        {
            let tx = dst.transaction().unwrap();
            tx.pragma_update(None, "defer_foreign_keys", "ON").unwrap();
            apply_segment(
                &tx,
                segment_tables("workspaces").unwrap(),
                &ws_seg,
                "add",
                &mut remap,
            )
            .unwrap();
            apply_segment(
                &tx,
                segment_tables("connections").unwrap(),
                &conn_seg,
                "add",
                &mut remap,
            )
            .unwrap();
            tx.commit().unwrap();
        }

        let (credential_owner, connection_credential): (String, String) = dst
            .query_row(
                "SELECT cpc.created_from_connection_id, c.password_credential_id
                 FROM connection_password_credentials cpc
                 JOIN connections c ON c.password_credential_id = cpc.id",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            credential_owner,
            *remap
                .get(&("connections".to_string(), "c1".to_string()))
                .unwrap()
        );
        assert_eq!(
            connection_credential,
            *remap
                .get(&(
                    "connection_password_credentials".to_string(),
                    "cpc1".to_string()
                ))
                .unwrap()
        );
    }

    #[test]
    fn validate_import_actions_rejects_unknown_segments_and_actions() {
        let mut actions = HashMap::new();
        actions.insert("connections".to_string(), "add".to_string());
        actions.insert("credentials".to_string(), "skip".to_string());
        assert!(validate_import_actions(&actions).is_ok());

        actions.insert("connections".to_string(), "merge".to_string());
        assert!(validate_import_actions(&actions).is_err());

        actions.clear();
        actions.insert("unknown".to_string(), "add".to_string());
        assert!(validate_import_actions(&actions).is_err());

        actions.clear();
        actions.insert("workspaces".to_string(), "replace".to_string());
        actions.insert("connections".to_string(), "add".to_string());
        assert!(validate_import_actions(&actions).is_err());

        actions.insert("connections".to_string(), "replace".to_string());
        assert!(validate_import_actions(&actions).is_ok());
    }

    #[test]
    fn connections_without_workspace_segment_land_in_default_workspace() {
        let src = SqliteConnection::open_in_memory().unwrap();
        connections_schema(&src);
        src.execute_batch(
            "INSERT INTO workspaces (id, name, is_default, sort_order) VALUES ('ws-source','Work',1,0);
             INSERT INTO connections (id, folder_id, workspace_id, name, connection_type,
                 ssh_socks_proxy, password_credential_id, sort_order)
                 VALUES ('c1',NULL,'ws-source','db','ssh',NULL,NULL,0);",
        )
        .unwrap();

        let mut conn_seg = Map::new();
        for spec in segment_tables("connections").unwrap() {
            conn_seg.insert(
                spec.name.to_string(),
                Value::Array(read_table(&src, spec.name).unwrap()),
            );
        }

        let mut dst = SqliteConnection::open_in_memory().unwrap();
        connections_schema(&dst);
        dst.execute(
            "INSERT INTO workspaces (id, name, is_default, sort_order) VALUES (?1,'Default',1,0)",
            [DEFAULT_WORKSPACE_ID],
        )
        .unwrap();
        let mut remap: HashMap<(String, String), String> = HashMap::new();
        {
            let tx = dst.transaction().unwrap();
            tx.pragma_update(None, "defer_foreign_keys", "ON").unwrap();
            apply_segment(
                &tx,
                segment_tables("connections").unwrap(),
                &conn_seg,
                "add",
                &mut remap,
            )
            .unwrap();
            tx.commit().unwrap();
        }

        let workspace_id: String = dst
            .query_row("SELECT workspace_id FROM connections", [], |row| row.get(0))
            .unwrap();
        assert_eq!(workspace_id, DEFAULT_WORKSPACE_ID);
    }

    /// Minimal subset of the live IT Ops schema: enough columns to exercise the
    /// hard FK chain (site -> room/rack -> rack item) and every soft reference.
    fn itops_schema(conn: &SqliteConnection) {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE itops_sites (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                 sort_order INTEGER NOT NULL, member_ids_json TEXT NOT NULL DEFAULT '[]',
                 filter_json TEXT);
             CREATE TABLE itops_server_rooms (id TEXT PRIMARY KEY,
                 site_id TEXT NOT NULL REFERENCES itops_sites(id) ON DELETE CASCADE,
                 name TEXT NOT NULL, sort_order INTEGER NOT NULL);
             CREATE TABLE itops_site_racks (id TEXT PRIMARY KEY,
                 site_id TEXT NOT NULL REFERENCES itops_sites(id) ON DELETE CASCADE,
                 name TEXT NOT NULL, sort_order INTEGER NOT NULL);
             CREATE TABLE itops_site_rack_items (id TEXT PRIMARY KEY,
                 rack_id TEXT NOT NULL REFERENCES itops_site_racks(id) ON DELETE CASCADE,
                 connection_id TEXT, kind TEXT NOT NULL, start_u INTEGER NOT NULL,
                 metadata_json TEXT NOT NULL DEFAULT '{}');
             CREATE TABLE itops_room_objects (id TEXT PRIMARY KEY,
                 site_id TEXT NOT NULL REFERENCES itops_sites(id) ON DELETE CASCADE,
                 kind TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL);
             CREATE TABLE itops_hosts (id TEXT PRIMARY KEY,
                 site_id TEXT NOT NULL REFERENCES itops_sites(id) ON DELETE CASCADE,
                 parent_host_id TEXT, hostname TEXT NOT NULL,
                 connection_ids_json TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL);
             CREATE TABLE itops_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                 sort_order INTEGER NOT NULL, task_json TEXT NOT NULL);
             CREATE TABLE itops_automations (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                 sort_order INTEGER NOT NULL, config_json TEXT NOT NULL,
                 actions_json TEXT NOT NULL DEFAULT '[]', site_id TEXT);
             CREATE TABLE itops_run_history (id TEXT PRIMARY KEY, source TEXT NOT NULL,
                 site_id TEXT, task_id TEXT, task_summary TEXT NOT NULL, started_at TEXT NOT NULL,
                 report_json TEXT NOT NULL DEFAULT '{}');",
        )
        .expect("itops schema");
    }

    #[test]
    fn itops_merge_remaps_hierarchy_and_soft_references() {
        let src = SqliteConnection::open_in_memory().unwrap();
        itops_schema(&src);
        src.execute_batch(
            "INSERT INTO itops_sites (id, name, sort_order, member_ids_json, filter_json)
                 VALUES ('s1','HQ',0,'[\"c1\",\"c-foreign\"]','{\"types\":[\"ssh\"],\"folderId\":\"f1\"}');
             INSERT INTO itops_server_rooms (id, site_id, name, sort_order) VALUES ('rm1','s1','Room A',0);
             INSERT INTO itops_site_racks (id, site_id, name, sort_order) VALUES ('rk1','s1','A12',0);
             INSERT INTO itops_site_rack_items
                 (id, rack_id, connection_id, kind, start_u, metadata_json)
                 VALUES ('it1','rk1','c1','connection',1,
                 '{\"connectionIds\":[\"c1\",\"c-foreign\"],\"hostId\":\"h1\"}');
             INSERT INTO itops_room_objects (id, site_id, kind, x, y) VALUES ('ob1','s1','camera',0,0);
             INSERT INTO itops_hosts (id, site_id, parent_host_id, hostname, connection_ids_json, sort_order)
                 VALUES ('h1','s1',NULL,'esx01','[\"c1\"]',0);
             INSERT INTO itops_hosts (id, site_id, parent_host_id, hostname, connection_ids_json, sort_order)
                 VALUES ('h2','s1','h1','vm-web','[]',1);
             INSERT INTO itops_tasks (id, name, sort_order, task_json) VALUES
                 ('t1','Reboot',0,
                 '{\"kind\":\"playbook\",\"steps\":[{\"secretOwnerId\":\"vault-1\"}]}');
             INSERT INTO itops_automations
                 (id, name, sort_order, config_json, actions_json, site_id) VALUES
                 ('a1','Watch',0,'{}',
                 '[{\"kind\":\"runBatch\",\"siteId\":\"s1\",\"task\":{\"kind\":\"playbook\",\"steps\":[{\"secretOwnerId\":\"vault-2\"}]}}]',
                 's1');
             INSERT INTO itops_run_history
                 (id, source, site_id, task_id, task_summary, started_at, report_json) VALUES
                 ('r1','automation:a1','s1','t1','Reboot','2026-01-01T00:00:00Z',
                 '{\"ok\":1,\"failed\":0,\"total\":1,\"hosts\":[{\"connectionId\":\"c1\"}]}');",
        )
        .unwrap();

        let mut seg = Map::new();
        for spec in segment_tables("itops").unwrap() {
            seg.insert(
                spec.name.to_string(),
                Value::Array(read_table(&src, spec.name).unwrap()),
            );
        }

        let mut dst = SqliteConnection::open_in_memory().unwrap();
        itops_schema(&dst);
        // Simulate a connections segment already merged in the same import.
        let mut remap: HashMap<(String, String), String> = HashMap::new();
        remap.insert(
            ("connections".to_string(), "c1".to_string()),
            "conn-new".to_string(),
        );
        remap.insert(
            ("connection_folders".to_string(), "f1".to_string()),
            "folder-new".to_string(),
        );
        {
            let tx = dst.transaction().unwrap();
            apply_segment(
                &tx,
                segment_tables("itops").unwrap(),
                &seg,
                "add",
                &mut remap,
            )
            .unwrap();
            tx.commit().unwrap();
        }

        let new_site = remap
            .get(&("itops_sites".to_string(), "s1".to_string()))
            .unwrap()
            .clone();
        // Site members follow the connections remap; unknown ids stay verbatim.
        let members: String = dst
            .query_row("SELECT member_ids_json FROM itops_sites", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(members, "[\"conn-new\",\"c-foreign\"]");
        let filter: String = dst
            .query_row("SELECT filter_json FROM itops_sites", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&filter).unwrap()["folderId"],
            "folder-new"
        );
        // Hard FKs land on the remapped site/rack.
        let room_site: String = dst
            .query_row("SELECT site_id FROM itops_server_rooms", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(room_site, new_site);
        let (item_rack, item_conn): (String, String) = dst
            .query_row(
                "SELECT rack_id, connection_id FROM itops_site_rack_items",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            item_rack,
            *remap
                .get(&("itops_site_racks".to_string(), "rk1".to_string()))
                .unwrap()
        );
        assert_eq!(item_conn, "conn-new");
        let item_metadata: String = dst
            .query_row(
                "SELECT metadata_json FROM itops_site_rack_items",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let item_metadata: Value = serde_json::from_str(&item_metadata).unwrap();
        assert_eq!(item_metadata["connectionIds"][0], "conn-new");
        assert_eq!(item_metadata["connectionIds"][1], "c-foreign");
        assert_eq!(
            item_metadata["hostId"],
            *remap
                .get(&("itops_hosts".to_string(), "h1".to_string()))
                .unwrap()
        );
        // The VM host re-points at its carrier host's new id.
        let parent: String = dst
            .query_row(
                "SELECT parent_host_id FROM itops_hosts WHERE hostname = 'vm-web'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            parent,
            *remap
                .get(&("itops_hosts".to_string(), "h1".to_string()))
                .unwrap()
        );
        // Automation + run history soft references follow their new owners.
        let automation_site: String = dst
            .query_row("SELECT site_id FROM itops_automations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(automation_site, new_site);
        let actions: String = dst
            .query_row("SELECT actions_json FROM itops_automations", [], |row| {
                row.get(0)
            })
            .unwrap();
        let actions: Value = serde_json::from_str(&actions).unwrap();
        assert_eq!(actions[0]["siteId"], new_site);
        assert!(
            actions[0]["task"]["steps"][0]
                .get("secretOwnerId")
                .is_none()
        );
        let (run_source, run_site, run_task): (String, String, String) = dst
            .query_row(
                "SELECT source, site_id, task_id FROM itops_run_history",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            run_source,
            format!(
                "automation:{}",
                remap
                    .get(&("itops_automations".to_string(), "a1".to_string()))
                    .unwrap()
            )
        );
        assert_eq!(run_site, new_site);
        assert_eq!(
            run_task,
            *remap
                .get(&("itops_tasks".to_string(), "t1".to_string()))
                .unwrap()
        );
        let report: String = dst
            .query_row("SELECT report_json FROM itops_run_history", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&report).unwrap()["hosts"][0]["connectionId"],
            "conn-new"
        );
        let task: String = dst
            .query_row("SELECT task_json FROM itops_tasks", [], |row| row.get(0))
            .unwrap();
        assert!(
            serde_json::from_str::<Value>(&task).unwrap()["steps"][0]
                .get("secretOwnerId")
                .is_none()
        );
    }

    #[test]
    fn assistant_memory_scope_follows_imported_connection() {
        let src = SqliteConnection::open_in_memory().unwrap();
        src.execute_batch(
            "CREATE TABLE assistant_memories (id TEXT PRIMARY KEY, scope TEXT NOT NULL,
                 content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             INSERT INTO assistant_memories VALUES ('m1','connection:c1','uses fish shell','t','t');
             INSERT INTO assistant_memories VALUES ('m2','global','prefers dark mode','t','t');",
        )
        .unwrap();
        let mut seg = Map::new();
        seg.insert(
            "assistant_memories".to_string(),
            Value::Array(read_table(&src, "assistant_memories").unwrap()),
        );

        let mut dst = SqliteConnection::open_in_memory().unwrap();
        dst.execute_batch(
            "CREATE TABLE assistant_memories (id TEXT PRIMARY KEY, scope TEXT NOT NULL,
                 content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
        )
        .unwrap();
        let mut remap: HashMap<(String, String), String> = HashMap::new();
        remap.insert(
            ("connections".to_string(), "c1".to_string()),
            "conn-new".to_string(),
        );
        {
            let tx = dst.transaction().unwrap();
            apply_segment(
                &tx,
                segment_tables("assistant").unwrap(),
                &seg,
                "add",
                &mut remap,
            )
            .unwrap();
            tx.commit().unwrap();
        }

        let scopes: Vec<String> = {
            let mut stmt = dst
                .prepare("SELECT scope FROM assistant_memories ORDER BY scope")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(
            scopes,
            vec!["connection:conn-new".to_string(), "global".to_string()]
        );
        let ids: Vec<String> = {
            let mut stmt = dst.prepare("SELECT id FROM assistant_memories").unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert!(
            ids.iter().all(|id| id != "m1" && id != "m2"),
            "memory ids are regenerated on add"
        );
    }

    #[test]
    fn bundle_version_stays_v1_without_new_segments() {
        let v1 = vec!["connections".to_string(), "settings".to_string()];
        assert_eq!(required_bundle_version(&v1), 1);
        let v2 = vec!["connections".to_string(), "itops".to_string()];
        assert_eq!(required_bundle_version(&v2), 2);
        assert_eq!(required_bundle_version(&["assistant".to_string()]), 2);
    }

    /// Guard against the export silently falling behind the live schema: every
    /// table must either belong to a segment or be listed here as an
    /// intentional exclusion. Adding a table to `storage::CURRENT_SCHEMA`
    /// without deciding its export story fails this test.
    #[test]
    fn every_live_table_is_exported_or_intentionally_excluded() {
        let dir = tempfile::tempdir().expect("temp dir");
        let storage = Storage::open(dir.path().join("kkterm.sqlite3")).expect("storage opens");
        let tables: Vec<String> = storage
            .with_connection(|conn| {
                let mut stmt = conn
                    .prepare(
                        "SELECT name FROM sqlite_master
                         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
                    )
                    .map_err(|error| error.to_string())?;
                let names = stmt
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(|error| error.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| error.to_string())?;
                Ok(names)
            })
            .expect("list tables");

        // Machine-local state that must never travel in a selective bundle.
        const EXCLUDED: &[&str] = &[
            "encrypted_secret_store_entries",
            "ai_coding_usage_accounts",
            "ai_coding_usage_snapshots",
            "installer_tool_state",
            // Durable frontend UI state (Quick Commands, Child Connection Tabs,
            // Notes content, favorites, CLI labels, IT Ops layout). Rides in the
            // whole-database backup but stays out of shareable connection
            // bundles so a user's local workspace notes/favorites are not
            // leaked when exporting selected Connections.
            "durable_ui_state",
        ];
        let covered: Vec<&str> = SEGMENT_ORDER
            .iter()
            .flat_map(|segment| segment_tables(segment).expect("segment exists"))
            .map(|table| table.name)
            .collect();

        for table in &tables {
            assert!(
                covered.contains(&table.as_str()) || EXCLUDED.contains(&table.as_str()),
                "table {table} is neither exported by a segment nor intentionally excluded; \
                 update segment_tables() or the exclusion list in this test"
            );
        }
        // And every declared segment table must actually exist in the schema.
        for name in covered {
            assert!(
                tables.iter().any(|table| table == name),
                "segment table {name} does not exist in the live schema"
            );
        }
    }

    /// Full round trip over the real schema: rows written into one Storage,
    /// exported with `read_table`, merged into a second Storage with "add".
    #[test]
    fn itops_and_assistant_round_trip_through_the_real_schema() {
        let dir = tempfile::tempdir().expect("temp dir");
        let src = Storage::open(dir.path().join("src.sqlite3")).expect("src storage");
        src.with_connection_mut(|conn| {
            conn.execute_batch(
                "INSERT INTO itops_sites (id, name, sort_order, member_ids_json) VALUES ('s1','HQ',0,'[]');
                 INSERT INTO itops_server_rooms (id, site_id, name, sort_order) VALUES ('rm1','s1','Room A',0);
                 INSERT INTO itops_site_racks (id, site_id, name, sort_order) VALUES ('rk1','s1','A12',0);
                 INSERT INTO itops_site_rack_items (id, rack_id, kind, label, start_u) VALUES ('it1','rk1','server','db01',1);
                 INSERT INTO itops_room_objects (id, site_id, kind, x, y) VALUES ('ob1','s1','camera',0,0);
                 INSERT INTO itops_hosts (id, site_id, hostname, sort_order) VALUES ('h1','s1','esx01',0);
                 INSERT INTO itops_tasks (id, name, sort_order, task_json) VALUES ('t1','Reboot',0,'{}');
                 INSERT INTO itops_automations (id, name, sort_order, config_json) VALUES ('a1','Watch',0,'{}');
                 INSERT INTO itops_run_history (id, source, task_summary, started_at)
                     VALUES ('r1','manual','Reboot','2026-01-01T00:00:00Z');
                 INSERT INTO assistant_chat_threads (id, title, context_label, messages_json, created_at, updated_at)
                     VALUES ('th1','Session','global','[]','t','t');
                 INSERT INTO assistant_memories (id, scope, content, created_at, updated_at)
                     VALUES ('m1','global','note','t','t');",
            )
            .map_err(|error| error.to_string())
        })
        .expect("seed src");

        let mut bundles: Vec<(&str, Map<String, Value>)> = Vec::new();
        for segment in ["itops", "assistant"] {
            let mut seg = Map::new();
            src.with_connection(|conn| {
                for spec in segment_tables(segment).expect("segment exists") {
                    seg.insert(
                        spec.name.to_string(),
                        Value::Array(read_table(conn, spec.name)?),
                    );
                }
                Ok(())
            })
            .expect("export segment");
            bundles.push((segment, seg));
        }

        const ROUND_TRIP_TABLES: [&str; 11] = [
            "itops_sites",
            "itops_server_rooms",
            "itops_site_racks",
            "itops_site_rack_items",
            "itops_room_objects",
            "itops_hosts",
            "itops_tasks",
            "itops_automations",
            "itops_run_history",
            "assistant_chat_threads",
            "assistant_memories",
        ];
        let counts = |storage: &Storage| -> Vec<i64> {
            storage
                .with_connection(|conn| {
                    ROUND_TRIP_TABLES
                        .iter()
                        .map(|table| {
                            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                                row.get(0)
                            })
                            .map_err(|error| format!("count {table}: {error}"))
                        })
                        .collect()
                })
                .expect("count tables")
        };

        let dst = Storage::open(dir.path().join("dst.sqlite3")).expect("dst storage");
        // A fresh store is not empty: the built-in Task catalog is seeded.
        let before = counts(&dst);
        dst.with_connection_mut(|conn| {
            let tx = conn.transaction().map_err(|error| error.to_string())?;
            tx.pragma_update(None, "defer_foreign_keys", "ON")
                .map_err(|error| error.to_string())?;
            let mut remap: HashMap<(String, String), String> = HashMap::new();
            for (segment, seg) in &bundles {
                apply_segment(
                    &tx,
                    segment_tables(segment).expect("segment exists"),
                    seg,
                    "add",
                    &mut remap,
                )?;
            }
            tx.commit().map_err(|error| error.to_string())
        })
        .expect("import segments");

        // Exactly the one user-created row lands per table; the bundled
        // built-in Tasks deduplicate against the importer's seeded catalog.
        let after = counts(&dst);
        for (index, table) in ROUND_TRIP_TABLES.iter().enumerate() {
            assert_eq!(
                after[index],
                before[index] + 1,
                "imported row count for {table}"
            );
        }
    }

    /// mcp_servers.name is UNIQUE; a merge with a same-named local server must
    /// rename the imported one instead of failing the import.
    #[test]
    fn mcp_merge_renames_conflicting_server_names() {
        let dir = tempfile::tempdir().expect("temp dir");
        let seed = "INSERT INTO mcp_servers (id, name, url, sort_order)
             VALUES ('mcp1','github','https://example.test/mcp',0)";
        let src = Storage::open(dir.path().join("src.sqlite3")).expect("src storage");
        src.with_connection_mut(|conn| conn.execute(seed, []).map_err(|error| error.to_string()))
            .expect("seed src");
        let mut seg = Map::new();
        src.with_connection(|conn| {
            seg.insert(
                "mcp_servers".to_string(),
                Value::Array(read_table(conn, "mcp_servers")?),
            );
            Ok(())
        })
        .expect("export mcp");

        let dst = Storage::open(dir.path().join("dst.sqlite3")).expect("dst storage");
        dst.with_connection_mut(|conn| {
            conn.execute(seed, []).map_err(|error| error.to_string())?;
            let tx = conn.transaction().map_err(|error| error.to_string())?;
            let mut remap = HashMap::new();
            apply_segment(
                &tx,
                segment_tables("mcpServers").expect("segment exists"),
                &seg,
                "add",
                &mut remap,
            )?;
            tx.commit().map_err(|error| error.to_string())
        })
        .expect("import mcp");

        let names: Vec<String> = dst
            .with_connection(|conn| {
                let mut stmt = conn
                    .prepare("SELECT name FROM mcp_servers ORDER BY name")
                    .map_err(|error| error.to_string())?;
                stmt.query_map([], |row| row.get(0))
                    .map_err(|error| error.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| error.to_string())
            })
            .expect("list names");
        assert_eq!(names, vec!["github".to_string(), "github (2)".to_string()]);
    }

    #[test]
    fn replace_clears_then_inserts_preserving_ids() {
        let src = SqliteConnection::open_in_memory().unwrap();
        connections_schema(&src);
        src.execute(
            "INSERT INTO workspaces (id, name, is_default, sort_order) VALUES ('ws-src','Imported',0,0)",
            [],
        )
        .unwrap();
        let mut ws_seg = Map::new();
        ws_seg.insert(
            "workspaces".to_string(),
            Value::Array(read_table(&src, "workspaces").unwrap()),
        );

        let mut dst = SqliteConnection::open_in_memory().unwrap();
        connections_schema(&dst);
        dst.execute(
            "INSERT INTO workspaces (id, name, is_default, sort_order) VALUES ('ws-old','Old',0,0)",
            [],
        )
        .unwrap();
        let mut remap = HashMap::new();
        {
            let tx = dst.transaction().unwrap();
            apply_segment(
                &tx,
                segment_tables("workspaces").unwrap(),
                &ws_seg,
                "replace",
                &mut remap,
            )
            .unwrap();
            tx.commit().unwrap();
        }
        let ids: Vec<String> = {
            let mut stmt = dst
                .prepare("SELECT id FROM workspaces ORDER BY id")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(
            ids,
            vec!["ws-src".to_string()],
            "replace wipes old rows and keeps bundle ids"
        );
    }
}

// Host inventory storage (docs/ITOPS.md Hosts): CRUD, hostname-list import,
// and connectivity-scan persistence for `itops_hosts`. Mirrors the conventions
// in `itops/site_storage.rs` (free functions over `&SqliteConnection`, JSON
// `TEXT` for non-relational fields, integer `sort_order`). Reuses
// `ItopsStorageError`.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};

use super::storage::ItopsStorageError;
use super::types::{HostExecutionConfig, HostKind, HostScan, SiteHost};

type Result<T> = std::result::Result<T, ItopsStorageError>;

/// Bound on one import batch so a stray paste can't create thousands of rows.
const MAX_IMPORT_HOSTS: usize = 500;

// ── Validation ──────────────────────────────────────────────────────────────

/// A hostname (or address) must be non-empty and contain no whitespace; it is
/// stored trimmed and matched case-insensitively for duplicates.
fn validate_hostname(hostname: &str) -> Result<String> {
    let trimmed = hostname.trim();
    if trimmed.is_empty() {
        return Err(ItopsStorageError::Validation(
            "hostname must not be empty".to_string(),
        ));
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err(ItopsStorageError::Validation(format!(
            "hostname must not contain whitespace: {trimmed}"
        )));
    }
    Ok(trimmed.to_string())
}

/// Validate a parent reference: the parent must exist, belong to the same
/// Site, and not be `id` itself or one of its descendants (no cycles).
fn validate_parent(
    conn: &SqliteConnection,
    site_id: &str,
    id: &str,
    parent_host_id: Option<&str>,
) -> Result<Option<String>> {
    let Some(parent_id) = parent_host_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    if parent_id == id {
        return Err(ItopsStorageError::Validation(
            "a host cannot be its own parent".to_string(),
        ));
    }
    // Walk up from the proposed parent; hitting `id` means the parent is a
    // descendant of this host and the edge would form a cycle.
    let mut cursor = parent_id.to_string();
    let mut hops = 0u32;
    loop {
        let row: Option<(String, Option<String>)> = conn
            .query_row(
                "SELECT site_id, parent_host_id FROM itops_hosts WHERE id = ?",
                params![cursor],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((parent_site, next)) = row else {
            return Err(ItopsStorageError::Validation(
                "parent host does not exist".to_string(),
            ));
        };
        if parent_site != site_id {
            return Err(ItopsStorageError::Validation(
                "parent host belongs to a different site".to_string(),
            ));
        }
        match next {
            Some(next) if next == id => {
                return Err(ItopsStorageError::Validation(
                    "host parent would create a cycle".to_string(),
                ));
            }
            Some(next) => {
                cursor = next;
                hops += 1;
                if hops > 64 {
                    return Err(ItopsStorageError::Validation(
                        "host parent chain is too deep".to_string(),
                    ));
                }
            }
            None => break,
        }
    }
    Ok(Some(parent_id.to_string()))
}

fn hostname_taken(
    conn: &SqliteConnection,
    site_id: &str,
    hostname: &str,
    ignore_id: Option<&str>,
) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM itops_hosts
            WHERE site_id = ? AND hostname = ? COLLATE NOCASE AND id <> COALESCE(?, '')
         )",
        params![site_id, hostname, ignore_id],
        |row| row.get(0),
    )?)
}

fn normalize_connection_ids(connection_ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    connection_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .collect()
}

fn connection_ids_to_json(connection_ids: &[String]) -> Result<String> {
    serde_json::to_string(connection_ids)
        .map_err(|error| ItopsStorageError::Validation(error.to_string()))
}

fn scan_to_json(scan: &Option<HostScan>) -> Result<Option<String>> {
    match scan {
        None => Ok(None),
        Some(scan) => serde_json::to_string(scan)
            .map(Some)
            .map_err(|error| ItopsStorageError::Validation(error.to_string())),
    }
}

fn execution_to_json(execution: &HostExecutionConfig) -> Result<String> {
    serde_json::to_string(execution)
        .map_err(|error| ItopsStorageError::Validation(error.to_string()))
}

// ── Reads ───────────────────────────────────────────────────────────────────

const SELECT_HOST_COLUMNS: &str = "id, site_id, parent_host_id, hostname, label, kind, \
     connection_ids_json, scan_json, execution_json, notes, sort_order FROM itops_hosts";

fn row_to_host(row: &rusqlite::Row<'_>) -> rusqlite::Result<SiteHost> {
    let kind: String = row.get(5)?;
    let connection_ids_json: String = row.get(6)?;
    let scan_json: Option<String> = row.get(7)?;
    let execution_json: String = row.get(8)?;
    Ok(SiteHost {
        id: row.get(0)?,
        site_id: row.get(1)?,
        parent_host_id: row.get(2)?,
        hostname: row.get(3)?,
        label: row.get(4)?,
        kind: HostKind::from_db_str(&kind).unwrap_or(HostKind::Other),
        connection_ids: serde_json::from_str(&connection_ids_json).unwrap_or_default(),
        scan: scan_json.and_then(|json| serde_json::from_str(&json).ok()),
        execution: serde_json::from_str(&execution_json).unwrap_or_default(),
        notes: row.get(9)?,
        sort_order: row.get(10)?,
    })
}

/// All Hosts of one Site, ordered by `sort_order` (flat; the frontend builds
/// the parent/child tree from `parent_host_id`).
pub fn list_hosts(conn: &SqliteConnection, site_id: &str) -> Result<Vec<SiteHost>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_HOST_COLUMNS} WHERE site_id = ? ORDER BY sort_order"
    ))?;
    Ok(stmt
        .query_map(params![site_id], row_to_host)?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_host(conn: &SqliteConnection, id: &str) -> Result<SiteHost> {
    conn.query_row(
        &format!("SELECT {SELECT_HOST_COLUMNS} WHERE id = ?"),
        params![id],
        row_to_host,
    )
    .optional()?
    .ok_or(ItopsStorageError::NotFound)
}

// ── Mutations ───────────────────────────────────────────────────────────────

pub fn create_host(
    conn: &SqliteConnection,
    id: &str,
    site_id: &str,
    hostname: &str,
    label: &str,
    kind: HostKind,
    parent_host_id: Option<&str>,
    notes: &str,
) -> Result<SiteHost> {
    let hostname = validate_hostname(hostname)?;
    if hostname_taken(conn, site_id, &hostname, None)? {
        return Err(ItopsStorageError::Validation(format!(
            "a host named {hostname} already exists in this site"
        )));
    }
    let parent_host_id = validate_parent(conn, site_id, id, parent_host_id)?;
    let next_sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_hosts WHERE site_id = ?",
        params![site_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO itops_hosts
         (id, site_id, parent_host_id, hostname, label, kind, notes, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            site_id,
            parent_host_id,
            hostname,
            label.trim(),
            kind.as_db_str(),
            notes.trim(),
            next_sort
        ],
    )?;
    get_host(conn, id)
}

/// Update a Host's identity, parent, Connection bindings, and notes. The scan
/// snapshot is written separately by `set_host_scan`.
#[allow(clippy::too_many_arguments)]
pub fn update_host(
    conn: &SqliteConnection,
    id: &str,
    hostname: &str,
    label: &str,
    kind: HostKind,
    parent_host_id: Option<&str>,
    connection_ids: Vec<String>,
    notes: &str,
) -> Result<SiteHost> {
    let existing = get_host(conn, id)?;
    let hostname = validate_hostname(hostname)?;
    if hostname_taken(conn, &existing.site_id, &hostname, Some(id))? {
        return Err(ItopsStorageError::Validation(format!(
            "a host named {hostname} already exists in this site"
        )));
    }
    let parent_host_id = validate_parent(conn, &existing.site_id, id, parent_host_id)?;
    let connection_ids = normalize_connection_ids(connection_ids);
    conn.execute(
        "UPDATE itops_hosts
         SET hostname = ?, label = ?, kind = ?, parent_host_id = ?,
             connection_ids_json = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![
            hostname,
            label.trim(),
            kind.as_db_str(),
            parent_host_id,
            connection_ids_to_json(&connection_ids)?,
            notes.trim(),
            id
        ],
    )?;
    get_host(conn, id)
}

/// Persist one Host's connectivity-scan snapshot.
pub fn set_host_scan(
    conn: &SqliteConnection,
    id: &str,
    scan: Option<HostScan>,
) -> Result<SiteHost> {
    let affected = conn.execute(
        "UPDATE itops_hosts SET scan_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params![scan_to_json(&scan)?, id],
    )?;
    if affected == 0 {
        return Err(ItopsStorageError::NotFound);
    }
    get_host(conn, id)
}

/// Update only the remote-execution policy. This stays separate from identity
/// editing so a credentials/settings dialog cannot accidentally rewrite Host
/// names, topology, or Connection bindings from stale UI state.
pub fn set_host_execution(
    conn: &SqliteConnection,
    id: &str,
    mut execution: HostExecutionConfig,
) -> Result<SiteHost> {
    if execution.winrm_port == Some(0) {
        return Err(ItopsStorageError::Validation(
            "WinRM port must be between 1 and 65535".to_string(),
        ));
    }
    execution.credential_id = execution
        .credential_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let affected = conn.execute(
        "UPDATE itops_hosts SET execution_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params![execution_to_json(&execution)?, id],
    )?;
    if affected == 0 {
        return Err(ItopsStorageError::NotFound);
    }
    get_host(conn, id)
}

/// Delete a Host. Its child Hosts are re-parented to the deleted Host's own
/// parent (top level when it had none) so a guest inventory never vanishes
/// with the device row.
pub fn delete_host(conn: &SqliteConnection, id: &str) -> Result<()> {
    let existing = get_host(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE itops_hosts SET parent_host_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE parent_host_id = ?",
        params![existing.parent_host_id, id],
    )?;
    tx.execute("DELETE FROM itops_hosts WHERE id = ?", params![id])?;
    tx.commit()?;
    Ok(())
}

/// The outcome of one Host import. `hosts` contains created or reconciled rows;
/// counts distinguish newly created, updated, and unchanged/invalid inputs.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostImportResult {
    pub hosts: Vec<SiteHost>,
    pub skipped: usize,
    #[serde(default)]
    pub created: usize,
    #[serde(default)]
    pub updated: usize,
}

/// Import a pasted hostname list into a Site. Entries are trimmed; blanks,
/// whitespace-bearing values, and case-insensitive duplicates (within the list
/// or against existing Hosts) are counted in `skipped` rather than failing the
/// batch. Ids come from `new_id` so the id scheme stays with the caller.
pub fn import_hosts(
    conn: &SqliteConnection,
    site_id: &str,
    hostnames: &[String],
    mut new_id: impl FnMut() -> String,
) -> Result<HostImportResult> {
    if hostnames.len() > MAX_IMPORT_HOSTS {
        return Err(ItopsStorageError::Validation(format!(
            "too many hosts in one import (max {MAX_IMPORT_HOSTS})"
        )));
    }
    let mut seen: HashSet<String> = list_hosts(conn, site_id)?
        .into_iter()
        .map(|host| host.hostname.to_ascii_lowercase())
        .collect();
    let mut created = Vec::new();
    let mut skipped = 0usize;
    let tx = conn.unchecked_transaction()?;
    let mut next_sort: i64 = tx.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_hosts WHERE site_id = ?",
        params![site_id],
        |row| row.get(0),
    )?;
    for raw in hostnames {
        let Ok(hostname) = validate_hostname(raw) else {
            skipped += 1;
            continue;
        };
        if !seen.insert(hostname.to_ascii_lowercase()) {
            skipped += 1;
            continue;
        }
        let id = new_id();
        tx.execute(
            "INSERT INTO itops_hosts (id, site_id, hostname, kind, sort_order)
             VALUES (?, ?, ?, 'physical', ?)",
            params![id, site_id, hostname, next_sort],
        )?;
        next_sort += 1;
        created.push(id);
    }
    tx.commit()?;
    let hosts = created
        .iter()
        .map(|id| get_host(conn, id))
        .collect::<Result<Vec<_>>>()?;
    let created_count = hosts.len();
    Ok(HostImportResult {
        hosts,
        skipped,
        created: created_count,
        updated: 0,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImportConnectionHost {
    pub id: String,
    pub hostname: String,
}

fn normalized_endpoint(hostname: &str) -> String {
    hostname.trim().trim_end_matches('.').to_ascii_lowercase()
}

/// Import network Connections as Host inventory. Connections that resolve to
/// the same normalized hostname/IP become one Host with all of the Connection
/// ids bound in input order. Existing Hosts are reconciled by adding missing
/// bindings; unchanged duplicates remain write-free.
pub fn import_connection_hosts(
    conn: &SqliteConnection,
    site_id: &str,
    connections: &[ImportConnectionHost],
    mut new_id: impl FnMut() -> String,
) -> Result<HostImportResult> {
    if connections.len() > MAX_IMPORT_HOSTS {
        return Err(ItopsStorageError::Validation(format!(
            "too many connections in one import (max {MAX_IMPORT_HOSTS})"
        )));
    }

    let existing = list_hosts(conn, site_id)?;
    let mut existing_by_endpoint: HashMap<String, SiteHost> = existing
        .into_iter()
        .map(|host| (normalized_endpoint(&host.hostname), host))
        .collect();
    let mut grouped: Vec<(String, String, Vec<String>)> = Vec::new();
    let mut group_index = HashMap::<String, usize>::new();
    let mut skipped = 0usize;
    for connection in connections {
        let Ok(hostname) = validate_hostname(&connection.hostname) else {
            skipped += 1;
            continue;
        };
        let key = normalized_endpoint(&hostname);
        if key.is_empty() || connection.id.trim().is_empty() {
            skipped += 1;
            continue;
        }
        if let Some(index) = group_index.get(&key).copied() {
            let ids = &mut grouped[index].2;
            if !ids.iter().any(|id| id == connection.id.trim()) {
                ids.push(connection.id.trim().to_string());
            }
            continue;
        }
        group_index.insert(key.clone(), grouped.len());
        grouped.push((key, hostname, vec![connection.id.trim().to_string()]));
    }

    let tx = conn.unchecked_transaction()?;
    let mut next_sort: i64 = tx.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_hosts WHERE site_id = ?",
        params![site_id],
        |row| row.get(0),
    )?;
    let mut changed_ids = Vec::new();
    let mut created = 0usize;
    let mut updated = 0usize;
    for (key, hostname, connection_ids) in grouped {
        if let Some(mut host) = existing_by_endpoint.remove(&key) {
            let before = host.connection_ids.len();
            for connection_id in connection_ids {
                if !host.connection_ids.contains(&connection_id) {
                    host.connection_ids.push(connection_id);
                }
            }
            if host.connection_ids.len() == before {
                skipped += 1;
                continue;
            }
            tx.execute(
                "UPDATE itops_hosts SET connection_ids_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                params![connection_ids_to_json(&host.connection_ids)?, host.id],
            )?;
            changed_ids.push(host.id);
            updated += 1;
            continue;
        }

        let id = new_id();
        tx.execute(
            "INSERT INTO itops_hosts (id, site_id, hostname, connection_ids_json, kind, sort_order)
             VALUES (?, ?, ?, ?, 'physical', ?)",
            params![
                id,
                site_id,
                hostname,
                connection_ids_to_json(&connection_ids)?,
                next_sort
            ],
        )?;
        next_sort += 1;
        changed_ids.push(id);
        created += 1;
    }
    tx.commit()?;
    let hosts = changed_ids
        .iter()
        .map(|id| get_host(conn, id))
        .collect::<Result<Vec<_>>>()?;
    Ok(HostImportResult {
        hosts,
        skipped,
        created,
        updated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE itops_hosts (
                id                  TEXT PRIMARY KEY,
                site_id             TEXT NOT NULL,
                parent_host_id      TEXT,
                hostname            TEXT NOT NULL,
                label               TEXT NOT NULL DEFAULT '',
                kind                TEXT NOT NULL DEFAULT 'physical',
                connection_ids_json TEXT NOT NULL DEFAULT '[]',
                scan_json           TEXT,
                execution_json      TEXT NOT NULL DEFAULT '{}',
                notes               TEXT NOT NULL DEFAULT '',
                sort_order          INTEGER NOT NULL,
                created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )
        .unwrap();
        conn
    }

    #[test]
    fn host_create_update_delete_roundtrip() {
        let conn = open_test_db();
        let host = create_host(
            &conn,
            "h1",
            "s1",
            "  web-01.example  ",
            " Web 01 ",
            HostKind::Physical,
            None,
            " Initial notes ",
        )
        .unwrap();
        assert_eq!(host.hostname, "web-01.example");
        assert_eq!(host.label, "Web 01");
        assert_eq!(host.notes, "Initial notes");
        assert_eq!(host.sort_order, 0);
        assert!(host.scan.is_none());

        // Duplicate hostname (case-insensitive) in the same site is rejected.
        assert!(matches!(
            create_host(
                &conn,
                "h2",
                "s1",
                "WEB-01.EXAMPLE",
                "",
                HostKind::Physical,
                None,
                ""
            ),
            Err(ItopsStorageError::Validation(_))
        ));
        // The same hostname in another site is fine.
        assert!(
            create_host(
                &conn,
                "h3",
                "s2",
                "web-01.example",
                "",
                HostKind::Physical,
                None,
                ""
            )
            .is_ok()
        );

        let updated = update_host(
            &conn,
            "h1",
            "web-01",
            "",
            HostKind::Physical,
            None,
            vec![
                " conn-1 ".into(),
                "conn-1".into(),
                "conn-2".into(),
                "".into(),
            ],
            "  notes  ",
        )
        .unwrap();
        assert_eq!(updated.hostname, "web-01");
        assert_eq!(updated.connection_ids, vec!["conn-1", "conn-2"]);
        assert_eq!(updated.notes, "notes");

        delete_host(&conn, "h1").unwrap();
        assert!(matches!(
            get_host(&conn, "h1"),
            Err(ItopsStorageError::NotFound)
        ));
        assert!(matches!(
            delete_host(&conn, "h1"),
            Err(ItopsStorageError::NotFound)
        ));
    }

    #[test]
    fn hostname_rejects_blank_and_whitespace() {
        let conn = open_test_db();
        assert!(matches!(
            create_host(&conn, "h1", "s1", "   ", "", HostKind::Physical, None, ""),
            Err(ItopsStorageError::Validation(_))
        ));
        assert!(matches!(
            create_host(
                &conn,
                "h1",
                "s1",
                "bad host",
                "",
                HostKind::Physical,
                None,
                ""
            ),
            Err(ItopsStorageError::Validation(_))
        ));
    }

    #[test]
    fn parent_links_validate_site_and_cycles() {
        let conn = open_test_db();
        create_host(
            &conn,
            "dev",
            "s1",
            "esx-01",
            "",
            HostKind::Physical,
            None,
            "",
        )
        .unwrap();
        let vm = create_host(
            &conn,
            "vm",
            "s1",
            "vm-01",
            "",
            HostKind::Vm,
            Some("dev"),
            "",
        )
        .unwrap();
        assert_eq!(vm.parent_host_id.as_deref(), Some("dev"));
        let nested = create_host(
            &conn,
            "ct",
            "s1",
            "ct-01",
            "",
            HostKind::Container,
            Some("vm"),
            "",
        )
        .unwrap();
        assert_eq!(nested.parent_host_id.as_deref(), Some("vm"));

        // Unknown parent, cross-site parent, self-parent, and cycles all fail.
        assert!(matches!(
            create_host(
                &conn,
                "x1",
                "s1",
                "x-01",
                "",
                HostKind::Vm,
                Some("nope"),
                ""
            ),
            Err(ItopsStorageError::Validation(_))
        ));
        create_host(
            &conn,
            "other",
            "s2",
            "other-01",
            "",
            HostKind::Physical,
            None,
            "",
        )
        .unwrap();
        assert!(matches!(
            create_host(
                &conn,
                "x2",
                "s1",
                "x-02",
                "",
                HostKind::Vm,
                Some("other"),
                ""
            ),
            Err(ItopsStorageError::Validation(_))
        ));
        assert!(matches!(
            update_host(
                &conn,
                "dev",
                "esx-01",
                "",
                HostKind::Physical,
                Some("dev"),
                vec![],
                ""
            ),
            Err(ItopsStorageError::Validation(_))
        ));
        // dev -> ct would cycle: ct's chain already contains dev.
        assert!(matches!(
            update_host(
                &conn,
                "dev",
                "esx-01",
                "",
                HostKind::Physical,
                Some("ct"),
                vec![],
                ""
            ),
            Err(ItopsStorageError::Validation(_))
        ));
    }

    #[test]
    fn deleting_a_host_promotes_children_to_its_parent() {
        let conn = open_test_db();
        create_host(
            &conn,
            "dev",
            "s1",
            "esx-01",
            "",
            HostKind::Physical,
            None,
            "",
        )
        .unwrap();
        create_host(
            &conn,
            "vm",
            "s1",
            "vm-01",
            "",
            HostKind::Vm,
            Some("dev"),
            "",
        )
        .unwrap();
        create_host(
            &conn,
            "ct",
            "s1",
            "ct-01",
            "",
            HostKind::Container,
            Some("vm"),
            "",
        )
        .unwrap();

        // Removing the middle VM re-parents its container onto the device.
        delete_host(&conn, "vm").unwrap();
        assert_eq!(
            get_host(&conn, "ct").unwrap().parent_host_id.as_deref(),
            Some("dev")
        );
        // Removing the device promotes the container to top level.
        delete_host(&conn, "dev").unwrap();
        assert_eq!(get_host(&conn, "ct").unwrap().parent_host_id, None);
    }

    #[test]
    fn import_skips_blank_and_duplicate_hostnames() {
        let conn = open_test_db();
        create_host(
            &conn,
            "h0",
            "s1",
            "existing",
            "",
            HostKind::Physical,
            None,
            "",
        )
        .unwrap();
        let mut next = 0;
        let result = import_hosts(
            &conn,
            "s1",
            &[
                "web-01".to_string(),
                "  web-02  ".to_string(),
                "".to_string(),
                "WEB-01".to_string(),
                "Existing".to_string(),
                "bad host".to_string(),
            ],
            move || {
                next += 1;
                format!("h{next}")
            },
        )
        .unwrap();
        assert_eq!(
            result
                .hosts
                .iter()
                .map(|host| host.hostname.as_str())
                .collect::<Vec<_>>(),
            vec!["web-01", "web-02"]
        );
        assert_eq!(result.skipped, 4);
        assert_eq!(list_hosts(&conn, "s1").unwrap().len(), 3);
        // Imported rows keep appending to the site's sort order.
        assert_eq!(result.hosts[0].sort_order, 1);
        assert_eq!(result.hosts[1].sort_order, 2);
    }

    #[test]
    fn connection_import_deduplicates_hosts_and_reconciles_bindings() {
        let conn = open_test_db();
        create_host(
            &conn,
            "existing",
            "s1",
            "db-01.example.com.",
            "",
            HostKind::Physical,
            None,
            "",
        )
        .unwrap();
        let result = import_connection_hosts(
            &conn,
            "s1",
            &[
                ImportConnectionHost {
                    id: "ssh-web".into(),
                    hostname: "WEB-01.example.com".into(),
                },
                ImportConnectionHost {
                    id: "rdp-web".into(),
                    hostname: "web-01.EXAMPLE.com.".into(),
                },
                ImportConnectionHost {
                    id: "rdp-db".into(),
                    hostname: "db-01.example.com".into(),
                },
            ],
            || "new-host".into(),
        )
        .unwrap();
        assert_eq!(result.created, 1);
        assert_eq!(result.updated, 1);
        assert_eq!(result.hosts.len(), 2);
        assert_eq!(
            get_host(&conn, "new-host").unwrap().connection_ids,
            vec!["ssh-web", "rdp-web"]
        );
        assert_eq!(
            get_host(&conn, "existing").unwrap().connection_ids,
            vec!["rdp-db"]
        );

        let unchanged = import_connection_hosts(
            &conn,
            "s1",
            &[ImportConnectionHost {
                id: "ssh-web".into(),
                hostname: "web-01.example.com".into(),
            }],
            || "unused".into(),
        )
        .unwrap();
        assert_eq!(unchanged.created, 0);
        assert_eq!(unchanged.updated, 0);
        assert_eq!(unchanged.skipped, 1);
        assert!(unchanged.hosts.is_empty());
    }

    #[test]
    fn scan_snapshot_persists_and_clears() {
        let conn = open_test_db();
        create_host(
            &conn,
            "h1",
            "s1",
            "web-01",
            "",
            HostKind::Physical,
            None,
            "",
        )
        .unwrap();
        let scanned = set_host_scan(
            &conn,
            "h1",
            Some(HostScan {
                ssh: true,
                winrm: false,
                https: true,
                scanned_at: Some("2026-07-09T00:00:00Z".to_string()),
                ..Default::default()
            }),
        )
        .unwrap();
        let scan = scanned.scan.expect("scan stored");
        assert!(scan.ssh && !scan.winrm && scan.https);

        let cleared = set_host_scan(&conn, "h1", None).unwrap();
        assert!(cleared.scan.is_none());
        assert!(matches!(
            set_host_scan(&conn, "missing", None),
            Err(ItopsStorageError::NotFound)
        ));
    }
}

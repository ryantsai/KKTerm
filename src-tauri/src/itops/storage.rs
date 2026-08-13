// IT Ops durable storage (docs/ITOPS.md). Phase 1: the `itops_sites`
// repository plus the run-time resolver that turns a Site into a concrete
// ordered list of site targets. Mirrors the dashboard_storage.rs conventions
// (free functions over `&SqliteConnection`, JSON `TEXT` columns, `sort_order`).

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection as SqliteConnection, OptionalExtension, params, params_from_iter};

use super::types::{RackItemKind, ResolvedHost, RoomIcon, RunScope, Site, SiteFilter, Transport};
use crate::dashboard_storage::DashboardBackground;

#[derive(Debug)]
pub enum ItopsStorageError {
    Validation(String),
    NotFound,
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for ItopsStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(reason) => write!(f, "{reason}"),
            Self::NotFound => write!(f, "site not found"),
            Self::Sqlite(error) => write!(f, "{error}"),
        }
    }
}

impl From<rusqlite::Error> for ItopsStorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

type Result<T> = std::result::Result<T, ItopsStorageError>;

// Stored id is intentionally the legacy "default-fleet" literal: it is an opaque
// internal primary key referenced by existing rows (racks, run history), so the
// Fleet -> Site rename keeps the value to avoid orphaning data on upgrade.
pub const DEFAULT_SITE_ID: &str = "default-fleet";
pub const DEFAULT_SITE_NAME: &str = "Default Site";

fn validate_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ItopsStorageError::Validation(
            "site name must not be empty".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

fn member_ids_to_json(member_ids: &[String]) -> Result<String> {
    serde_json::to_string(member_ids)
        .map_err(|error| ItopsStorageError::Validation(error.to_string()))
}

fn parse_member_ids(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

/// Serialize a filter to JSON, collapsing an empty filter to NULL so a Host
/// Group never claims dynamic membership it does not have.
fn filter_to_json(filter: &Option<SiteFilter>) -> Result<Option<String>> {
    match filter {
        Some(filter) if !filter.is_empty() => {
            Ok(Some(serde_json::to_string(filter).map_err(|error| {
                ItopsStorageError::Validation(error.to_string())
            })?))
        }
        _ => Ok(None),
    }
}

fn parse_filter(raw: Option<String>) -> Option<SiteFilter> {
    let raw = raw?;
    serde_json::from_str::<SiteFilter>(&raw)
        .ok()
        .filter(|filter| !filter.is_empty())
}

/// Parse a stored `DashboardBackground` JSON blob; unparseable/absent → None
/// (theme default), defensively, like the dashboard's own reader.
fn parse_background(raw: Option<String>) -> Option<DashboardBackground> {
    raw.and_then(|json| serde_json::from_str::<DashboardBackground>(&json).ok())
}

fn background_to_json(background: &Option<DashboardBackground>) -> Result<Option<String>> {
    match background {
        None => Ok(None),
        Some(bg) => {
            bg.validate()
                .map_err(|error| ItopsStorageError::Validation(format!("{error:?}")))?;
            serde_json::to_string(bg)
                .map(Some)
                .map_err(|error| ItopsStorageError::Validation(error.to_string()))
        }
    }
}

fn parse_room_backgrounds(raw: Option<String>) -> HashMap<String, DashboardBackground> {
    raw.and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn room_backgrounds_to_json(map: &HashMap<String, DashboardBackground>) -> Result<String> {
    serde_json::to_string(map).map_err(|error| ItopsStorageError::Validation(error.to_string()))
}

fn parse_room_icons(raw: Option<String>) -> HashMap<String, RoomIcon> {
    raw.and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn room_icons_to_json(map: &HashMap<String, RoomIcon>) -> Result<String> {
    serde_json::to_string(map).map_err(|error| ItopsStorageError::Validation(error.to_string()))
}

fn row_to_group(row: &rusqlite::Row<'_>) -> rusqlite::Result<Site> {
    let member_ids: String = row.get(3)?;
    let filter_json: Option<String> = row.get(4)?;
    let transport: String = row.get(5)?;
    Ok(Site {
        id: row.get(0)?,
        name: row.get(1)?,
        sort_order: row.get(2)?,
        member_ids: parse_member_ids(&member_ids),
        filter: parse_filter(filter_json),
        transport: Transport::from_db_str(&transport).unwrap_or(Transport::Auto),
        background: parse_background(row.get(6)?),
        room_backgrounds: parse_room_backgrounds(row.get(7)?),
        icon_color: row.get(8)?,
        icon_data_url: row.get(9)?,
        icon_background_color: row.get(10)?,
        room_icons: parse_room_icons(row.get(11)?),
    })
}

const SELECT_GROUP_COLUMNS: &str = "id, name, sort_order, member_ids_json, filter_json, transport, \
     background_json, room_backgrounds_json, icon_color, icon_data_url, icon_background_color, \
     room_icons_json FROM itops_sites";

/// Re-read one Site by id (used after a mutation to return preserved fields
/// such as backgrounds that the mutation does not touch).
fn load_site(conn: &SqliteConnection, id: &str) -> Result<Site> {
    conn.query_row(
        &format!("SELECT {SELECT_GROUP_COLUMNS} WHERE id = ?"),
        params![id],
        row_to_group,
    )
    .optional()?
    .ok_or(ItopsStorageError::NotFound)
}

fn ensure_default_site(conn: &SqliteConnection) -> Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM itops_sites", [], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO itops_sites (id, name, sort_order, member_ids_json, filter_json, transport)
         VALUES (?, ?, 0, '[]', NULL, 'auto')",
        params![DEFAULT_SITE_ID, DEFAULT_SITE_NAME],
    )?;
    Ok(())
}

pub fn list_sites(conn: &SqliteConnection) -> Result<Vec<Site>> {
    ensure_default_site(conn)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_GROUP_COLUMNS} ORDER BY sort_order"
    ))?;
    let groups = stmt
        .query_map([], row_to_group)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(groups)
}

pub fn create_site(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    member_ids: Vec<String>,
    filter: Option<SiteFilter>,
    transport: Transport,
    icon_color: Option<&str>,
    icon_data_url: Option<&str>,
    icon_background_color: Option<&str>,
) -> Result<Site> {
    let name = validate_name(name)?;
    let next_sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_sites",
        [],
        |row| row.get(0),
    )?;
    let member_json = member_ids_to_json(&member_ids)?;
    let filter_json = filter_to_json(&filter)?;
    conn.execute(
        "INSERT INTO itops_sites (id, name, sort_order, member_ids_json, filter_json, transport, icon_color, icon_data_url, icon_background_color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, name, next_sort, member_json, filter_json, transport.as_db_str(), icon_color, icon_data_url, icon_background_color],
    )?;
    Ok(Site {
        id: id.to_string(),
        name,
        sort_order: next_sort,
        member_ids,
        filter: filter.filter(|filter| !filter.is_empty()),
        transport,
        icon_color: icon_color.map(|s| s.to_string()),
        background: None,
        room_backgrounds: HashMap::new(),
        icon_data_url: icon_data_url.map(|s| s.to_string()),
        icon_background_color: icon_background_color.map(|s| s.to_string()),
        room_icons: HashMap::new(),
    })
}

pub fn update_site(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    member_ids: Vec<String>,
    filter: Option<SiteFilter>,
    transport: Transport,
    icon_color: Option<&str>,
    icon_data_url: Option<&str>,
    icon_background_color: Option<&str>,
) -> Result<Site> {
    let name = validate_name(name)?;
    // Existence check (returns NotFound before the UPDATE).
    let _sort_order: i64 = conn
        .query_row(
            "SELECT sort_order FROM itops_sites WHERE id = ?",
            params![id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(ItopsStorageError::NotFound)?;
    let member_json = member_ids_to_json(&member_ids)?;
    let filter_json = filter_to_json(&filter)?;
    conn.execute(
        "UPDATE itops_sites
         SET name = ?, member_ids_json = ?, filter_json = ?, transport = ?, icon_color = ?, icon_data_url = ?, icon_background_color = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![name, member_json, filter_json, transport.as_db_str(), icon_color, icon_data_url, icon_background_color, id],
    )?;
    // Re-read so preserved fields (backgrounds, room icons) round-trip into the response.
    load_site(conn, id)
}

/// Set (or clear with `None`) the Site-view background. Returns the saved Site.
pub fn set_site_background(
    conn: &SqliteConnection,
    id: &str,
    background: Option<DashboardBackground>,
) -> Result<Site> {
    let json = background_to_json(&background)?;
    let affected = conn.execute(
        "UPDATE itops_sites SET background_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params![json, id],
    )?;
    if affected == 0 {
        return Err(ItopsStorageError::NotFound);
    }
    load_site(conn, id)
}

/// Set (or clear) one server room's background in the Site's room map.
pub fn set_server_room_background(
    conn: &SqliteConnection,
    site_id: &str,
    server_room: &str,
    background: Option<DashboardBackground>,
) -> Result<Site> {
    let mut site = load_site(conn, site_id)?;
    match background {
        Some(bg) => {
            bg.validate()
                .map_err(|error| ItopsStorageError::Validation(format!("{error:?}")))?;
            site.room_backgrounds.insert(server_room.to_string(), bg);
        }
        None => {
            site.room_backgrounds.remove(server_room);
        }
    }
    let json = room_backgrounds_to_json(&site.room_backgrounds)?;
    conn.execute(
        "UPDATE itops_sites SET room_backgrounds_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params![json, site_id],
    )?;
    load_site(conn, site_id)
}

/// Set (or clear with `None`) a server room's icon. Stored on the owning Site.
pub fn set_room_icon(
    conn: &SqliteConnection,
    site_id: &str,
    server_room: &str,
    icon: Option<RoomIcon>,
) -> Result<Site> {
    let mut site = load_site(conn, site_id)?;
    match icon {
        Some(entry) => {
            site.room_icons.insert(server_room.to_string(), entry);
        }
        None => {
            site.room_icons.remove(server_room);
        }
    }
    let json = room_icons_to_json(&site.room_icons)?;
    conn.execute(
        "UPDATE itops_sites SET room_icons_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params![json, site_id],
    )?;
    load_site(conn, site_id)
}

pub fn remove_site(conn: &SqliteConnection, id: &str) -> Result<()> {
    if id == DEFAULT_SITE_ID {
        return Err(ItopsStorageError::Validation(
            "Default Site cannot be deleted".to_string(),
        ));
    }
    let affected = conn.execute("DELETE FROM itops_sites WHERE id = ?", params![id])?;
    if affected == 0 {
        return Err(ItopsStorageError::NotFound);
    }
    Ok(())
}

pub fn reorder_sites(conn: &SqliteConnection, ordered_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let mut statement = tx.prepare("UPDATE itops_sites SET sort_order = ? WHERE id = ?")?;
    for (index, id) in ordered_ids.iter().enumerate() {
        statement.execute(params![index as i64, id])?;
    }
    drop(statement);
    tx.commit()?;
    Ok(())
}

fn fetch_resolved_host(
    conn: &SqliteConnection,
    connection_id: &str,
    transport: Transport,
) -> Result<Option<ResolvedHost>> {
    conn.query_row(
        "SELECT id, name, host, username, port, connection_type FROM connections WHERE id = ?",
        params![connection_id],
        |row| {
            Ok(ResolvedHost {
                host_id: None,
                connection_id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                username: row.get(3)?,
                port: row.get(4)?,
                connection_type: row.get(5)?,
                transport,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn fetch_filtered_hosts(
    conn: &SqliteConnection,
    filter: &SiteFilter,
    transport: Transport,
) -> Result<Vec<ResolvedHost>> {
    let mut sql = String::from(
        "SELECT id, name, host, username, port, connection_type FROM connections WHERE 1 = 1",
    );
    let mut bind: Vec<String> = Vec::new();
    if !filter.types.is_empty() {
        let placeholders = vec!["?"; filter.types.len()].join(", ");
        sql.push_str(&format!(" AND connection_type IN ({placeholders})"));
        bind.extend(filter.types.iter().cloned());
    }
    if let Some(folder_id) = &filter.folder_id {
        sql.push_str(" AND folder_id = ?");
        bind.push(folder_id.clone());
    }
    sql.push_str(" ORDER BY sort_order");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params_from_iter(bind.iter()), |row| {
            Ok(ResolvedHost {
                host_id: None,
                connection_id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                username: row.get(3)?,
                port: row.get(4)?,
                connection_type: row.get(5)?,
                transport,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Resolve a Site into a concrete ordered list of site targets at call
/// time: explicit members first (in stored order, skipping any since-deleted
/// Connections), then dynamic-filter matches not already included. Deduplicated
/// by Connection id so a member that also matches the filter appears once.
pub fn resolve_site(conn: &SqliteConnection, group: &Site) -> Result<Vec<ResolvedHost>> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut resolved: Vec<ResolvedHost> = Vec::new();

    for member_id in &group.member_ids {
        if let Some(host) = fetch_resolved_host(conn, member_id, group.transport)? {
            if seen.insert(host.connection_id.clone()) {
                resolved.push(host);
            }
        }
    }

    if let Some(filter) = &group.filter {
        if !filter.is_empty() {
            for host in fetch_filtered_hosts(conn, filter, group.transport)? {
                if seen.insert(host.connection_id.clone()) {
                    resolved.push(host);
                }
            }
        }
    }

    Ok(resolved)
}

/// Resolve only the placed Connection items in the racks matching `scope`
/// (docs/SITE.md Phase D) — the seam for Rack / Server Room scoped Batch Runs.
/// Uses the Site's transport default. Returns hosts in rack order, then U
/// order (top of rack first), deduplicated by Connection id.
pub fn resolve_site_scoped(
    conn: &SqliteConnection,
    site: &Site,
    scope: &RunScope,
) -> Result<Vec<ResolvedHost>> {
    if !scope.host_ids.is_empty() {
        let wanted: HashSet<&str> = scope.host_ids.iter().map(String::as_str).collect();
        let mut seen = HashSet::new();
        let mut resolved = Vec::new();
        for host in super::host_storage::list_hosts(conn, &site.id)? {
            if !wanted.contains(host.id.as_str()) {
                continue;
            }
            let configured_transport = host.execution.transport;
            if matches!(configured_transport, Transport::Auto | Transport::Ssh) {
                // Auto prefers the established SSH binding. This preserves the
                // existing behavior for Windows hosts that run OpenSSH.
                for connection_id in &host.connection_ids {
                    let Some(mut target) =
                        fetch_resolved_host(conn, connection_id, Transport::Ssh)?
                    else {
                        continue;
                    };
                    if target.connection_type == "ssh" && seen.insert(target.connection_id.clone())
                    {
                        target.host_id = Some(host.id.clone());
                        resolved.push(target);
                        break;
                    }
                }
                if resolved
                    .last()
                    .is_some_and(|target| target.host_id.as_deref() == Some(host.id.as_str()))
                {
                    continue;
                }
            }

            let windows_transport = match configured_transport {
                Transport::Winrm => Some(Transport::Winrm),
                Transport::Psexec => Some(Transport::Psexec),
                Transport::Auto if host.execution.credential_id.is_some() => {
                    let scan = host.scan.as_ref();
                    if scan.is_some_and(|scan| scan.winrm) {
                        Some(Transport::Winrm)
                    } else if scan.is_some_and(|scan| scan.psexec) {
                        Some(Transport::Psexec)
                    } else {
                        None
                    }
                }
                _ => None,
            };
            if let Some(transport) = windows_transport {
                let target_id = format!("host:{}", host.id);
                if seen.insert(target_id.clone()) {
                    resolved.push(ResolvedHost {
                        host_id: Some(host.id.clone()),
                        connection_id: target_id,
                        name: if host.label.trim().is_empty() {
                            host.hostname.clone()
                        } else {
                            host.label.clone()
                        },
                        host: host.hostname,
                        username: String::new(),
                        port: host.execution.winrm_port.map(i64::from),
                        connection_type: "itopsHost".to_string(),
                        transport,
                    });
                }
            }
        }
        return Ok(resolved);
    }

    let racks = super::site_storage::list_racks(conn, &site.id)?;
    let mut seen: HashSet<String> = HashSet::new();
    let mut resolved: Vec<ResolvedHost> = Vec::new();
    for rack in racks {
        if !rack_matches_scope(&rack, scope) {
            continue;
        }
        // Top of rack first: items come back ascending by start_u, so reverse.
        let mut items = rack.items;
        items.sort_by(|a, b| b.start_u.cmp(&a.start_u));
        for item in items {
            if item.kind != RackItemKind::Connection {
                continue;
            }
            let Some(connection_id) = item.connection_id else {
                continue;
            };
            if !seen.insert(connection_id.clone()) {
                continue;
            }
            if let Some(host) = fetch_resolved_host(conn, &connection_id, site.transport)? {
                resolved.push(host);
            }
        }
    }
    Ok(resolved)
}

/// A rack matches a scope when every provided (non-empty) scope field matches.
fn rack_matches_scope(rack: &super::types::Rack, scope: &RunScope) -> bool {
    let matches = |field: &Option<String>, value: &str| match field.as_deref() {
        Some(wanted) if !wanted.is_empty() => wanted == value,
        _ => true,
    };
    matches(&scope.rack_id, &rack.id) && matches(&scope.server_room, &rack.server_room)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::itops::types::Rack;

    fn test_rack(server_room: &str) -> Rack {
        Rack {
            id: "r1".into(),
            site_id: "f1".into(),
            name: "A12".into(),
            server_room: server_room.into(),
            rack_group: String::new(),
            shell: None,
            background: None,
            height_u: 42,
            depth_mm: 1000,
            power_capacity_w: None,
            floor_x: None,
            floor_y: None,
            grid_x: None,
            grid_y: None,
            facing: None,
            sort_order: 0,
            items: Vec::new(),
        }
    }

    #[test]
    fn scope_matching_treats_empty_fields_as_wildcards() {
        let rack = test_rack("Room B");
        // Empty scope matches anything.
        assert!(rack_matches_scope(&rack, &RunScope::default()));
        // Exact rack id matches.
        assert!(rack_matches_scope(
            &rack,
            &RunScope {
                rack_id: Some("r1".into()),
                ..Default::default()
            }
        ));
        // Wrong rack id does not.
        assert!(!rack_matches_scope(
            &rack,
            &RunScope {
                rack_id: Some("other".into()),
                ..Default::default()
            }
        ));
        // Server room matches; a mismatched server room does not.
        assert!(rack_matches_scope(
            &rack,
            &RunScope {
                server_room: Some("Room B".into()),
                ..Default::default()
            }
        ));
        assert!(!rack_matches_scope(
            &rack,
            &RunScope {
                server_room: Some("Room C".into()),
                ..Default::default()
            }
        ));
    }

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE itops_sites (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                member_ids_json TEXT NOT NULL DEFAULT '[]',
                filter_json TEXT,
                transport TEXT NOT NULL DEFAULT 'auto'
                    CHECK (transport IN ('ssh', 'winrm', 'psexec', 'auto')),
                background_json TEXT,
                room_backgrounds_json TEXT,
                icon_color TEXT,
                icon_data_url TEXT,
                icon_background_color TEXT,
                room_icons_json TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE connections (
                id TEXT PRIMARY KEY,
                folder_id TEXT,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                username TEXT NOT NULL,
                port INTEGER,
                connection_type TEXT NOT NULL,
                sort_order INTEGER NOT NULL
            );
            CREATE TABLE itops_hosts (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                parent_host_id TEXT,
                hostname TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'physical',
                connection_ids_json TEXT NOT NULL DEFAULT '[]',
                scan_json TEXT,
                execution_json TEXT NOT NULL DEFAULT '{}',
                notes TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL
            );
            "#,
        )
        .unwrap();
        conn
    }

    #[test]
    fn host_scope_resolves_each_selected_hosts_first_bound_ssh_connection() {
        let conn = open_test_db();
        insert_connection(&conn, "ssh-1", "ssh", None, 0);
        insert_connection(&conn, "url-1", "url", None, 1);
        let site = create_site(
            &conn,
            "site-1",
            "Site",
            vec!["ssh-1".into(), "url-1".into()],
            None,
            Transport::Auto,
            None,
            None,
            None,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itops_hosts
             (id, site_id, hostname, connection_ids_json, sort_order)
             VALUES ('host-1', 'site-1', 'web-01', '[\"url-1\",\"ssh-1\"]', 0),
                    ('host-2', 'site-1', 'web-02', '[\"url-1\"]', 1)",
            [],
        )
        .unwrap();

        let resolved = resolve_site_scoped(
            &conn,
            &site,
            &RunScope {
                host_ids: vec!["host-1".into()],
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].connection_id, "ssh-1");

        let unrunnable = resolve_site_scoped(
            &conn,
            &site,
            &RunScope {
                host_ids: vec!["host-2".into()],
                ..Default::default()
            },
        )
        .unwrap();
        assert!(unrunnable.is_empty());
    }

    #[test]
    fn host_scope_resolves_explicit_winrm_without_an_ssh_binding() {
        let conn = open_test_db();
        let site = create_site(
            &conn,
            "site-1",
            "Site",
            Vec::new(),
            None,
            Transport::Auto,
            None,
            None,
            None,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itops_hosts
             (id, site_id, hostname, execution_json, sort_order)
             VALUES ('host-1', 'site-1', 'windows-01',
                '{\"transport\":\"winrm\",\"credentialId\":\"cred-1\",\"winrmUseTls\":true,\"winrmPort\":5986,\"winrmAcceptInvalidCerts\":false,\"psexecContext\":\"system\"}', 0)",
            [],
        )
        .unwrap();

        let resolved = resolve_site_scoped(
            &conn,
            &site,
            &RunScope {
                host_ids: vec!["host-1".into()],
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].host_id.as_deref(), Some("host-1"));
        assert_eq!(resolved[0].connection_id, "host:host-1");
        assert_eq!(resolved[0].host, "windows-01");
        assert_eq!(resolved[0].port, Some(5986));
        assert_eq!(resolved[0].transport, Transport::Winrm);
    }

    fn insert_connection(
        conn: &SqliteConnection,
        id: &str,
        kind: &str,
        folder_id: Option<&str>,
        sort_order: i64,
    ) {
        conn.execute(
            "INSERT INTO connections (id, folder_id, name, host, username, port, connection_type, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![id, folder_id, id, format!("{id}.example"), "deploy", 22, kind, sort_order],
        )
        .unwrap();
    }

    #[test]
    fn create_list_update_remove_roundtrip() {
        let conn = open_test_db();
        let created = create_site(
            &conn,
            "hg-1",
            "  Production Web  ",
            vec!["c1".into(), "c2".into()],
            None,
            Transport::Ssh,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(created.name, "Production Web"); // trimmed
        assert_eq!(created.sort_order, 0);
        assert_eq!(created.transport, Transport::Ssh);
        assert!(created.filter.is_none());

        let listed = list_sites(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].member_ids, vec!["c1", "c2"]);

        let updated = update_site(
            &conn,
            "hg-1",
            "Web",
            vec!["c2".into()],
            Some(SiteFilter {
                types: vec!["ssh".into()],
                folder_id: Some("f1".into()),
            }),
            Transport::Auto,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(updated.name, "Web");
        assert_eq!(updated.sort_order, 0); // preserved
        assert!(updated.filter.is_some());

        remove_site(&conn, "hg-1").unwrap();
        let listed_after_delete = list_sites(&conn).unwrap();
        assert_eq!(listed_after_delete.len(), 1);
        assert_eq!(listed_after_delete[0].id, DEFAULT_SITE_ID);
        assert!(matches!(
            remove_site(&conn, "hg-1"),
            Err(ItopsStorageError::NotFound)
        ));
    }

    #[test]
    fn site_background_roundtrips_through_list_sites() {
        let conn = open_test_db();
        create_site(
            &conn,
            "hg-bg",
            "Background Site",
            vec![],
            None,
            Transport::Auto,
            None,
            None,
            None,
        )
        .unwrap();

        let background = DashboardBackground::Preset {
            preset: "mist".into(),
        };
        let updated = set_site_background(&conn, "hg-bg", Some(background.clone())).unwrap();
        assert_eq!(updated.background, Some(background.clone()));

        let listed = list_sites(&conn).unwrap();
        assert_eq!(listed[0].background, Some(background));
    }

    #[test]
    fn empty_name_is_rejected() {
        let conn = open_test_db();
        assert!(matches!(
            create_site(
                &conn,
                "hg-x",
                "   ",
                vec![],
                None,
                Transport::Auto,
                None,
                None,
                None
            ),
            Err(ItopsStorageError::Validation(_))
        ));
    }

    #[test]
    fn empty_filter_is_stored_as_none() {
        let conn = open_test_db();
        let group = create_site(
            &conn,
            "hg-2",
            "Group",
            vec![],
            Some(SiteFilter::default()),
            Transport::Auto,
            None,
            None,
            None,
        )
        .unwrap();
        assert!(group.filter.is_none());
        assert!(list_sites(&conn).unwrap()[0].filter.is_none());
    }

    #[test]
    fn resolve_orders_members_then_filter_and_dedupes() {
        let conn = open_test_db();
        insert_connection(&conn, "c1", "ssh", Some("prod"), 0);
        insert_connection(&conn, "c2", "ssh", Some("prod"), 1);
        insert_connection(&conn, "c3", "rdp", Some("prod"), 2);
        insert_connection(&conn, "gone", "ssh", None, 3);

        let group = create_site(
            &conn,
            "hg-3",
            "Mixed",
            // explicit members: c2 first, then a deleted-style id, then c1 also in filter
            vec!["c2".into(), "missing".into()],
            Some(SiteFilter {
                types: vec!["ssh".into()],
                folder_id: Some("prod".into()),
            }),
            Transport::Ssh,
            None,
            None,
            None,
        )
        .unwrap();

        let resolved = resolve_site(&conn, &group).unwrap();
        let ids: Vec<&str> = resolved.iter().map(|h| h.connection_id.as_str()).collect();
        // c2 explicit first; "missing" skipped; then filter adds c1 (ssh+prod);
        // c3 excluded (rdp); "gone" excluded (folder None); c2 not duplicated.
        assert_eq!(ids, vec!["c2", "c1"]);
        assert!(resolved.iter().all(|h| h.transport == Transport::Ssh));
    }

    #[test]
    fn reorder_rewrites_sort_order() {
        let conn = open_test_db();
        create_site(
            &conn,
            "a",
            "A",
            vec![],
            None,
            Transport::Auto,
            None,
            None,
            None,
        )
        .unwrap();
        create_site(
            &conn,
            "b",
            "B",
            vec![],
            None,
            Transport::Auto,
            None,
            None,
            None,
        )
        .unwrap();
        reorder_sites(&conn, &["b".to_string(), "a".to_string()]).unwrap();
        let order: Vec<String> = list_sites(&conn)
            .unwrap()
            .into_iter()
            .map(|g| g.id)
            .collect();
        assert_eq!(order, vec!["b", "a"]);
    }

    #[test]
    fn list_seeds_default_site_and_default_cannot_be_deleted() {
        let conn = open_test_db();

        let listed = list_sites(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, DEFAULT_SITE_ID);
        assert_eq!(listed[0].name, DEFAULT_SITE_NAME);
        assert_eq!(listed[0].sort_order, 0);

        assert!(matches!(
            remove_site(&conn, DEFAULT_SITE_ID),
            Err(ItopsStorageError::Validation(_))
        ));

        let listed_again = list_sites(&conn).unwrap();
        assert_eq!(listed_again.len(), 1);
        assert_eq!(listed_again[0].id, DEFAULT_SITE_ID);
    }
}

// Durable IPAM storage (docs/ITOPS.md). Prefixes and Address Records are
// global to the Module like the Task Library: a Site binding is optional
// metadata, not a scope. Hierarchy and utilization are never stored — every
// list recomputes them from `ipv4` so the tree cannot drift from its rows.

use std::collections::HashMap;

use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};

use super::ipv4::{self, Prefix};
use super::types::{AddressStatus, IpAddressRecord, IpPrefix, IpamPrefixNode, IpamSnapshot, PrefixStatus};

#[derive(Debug)]
pub enum IpamStorageError {
    Validation(String),
    NotFound,
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for IpamStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(reason) => write!(f, "{reason}"),
            Self::NotFound => write!(f, "IPAM record not found"),
            Self::Sqlite(error) => write!(f, "{error}"),
        }
    }
}

impl From<rusqlite::Error> for IpamStorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

type Result<T> = std::result::Result<T, IpamStorageError>;

fn invalid(reason: impl Into<String>) -> IpamStorageError {
    IpamStorageError::Validation(reason.into())
}

fn prefix_status_key(status: PrefixStatus) -> &'static str {
    match status {
        PrefixStatus::Container => "container",
        PrefixStatus::Active => "active",
        PrefixStatus::Reserved => "reserved",
        PrefixStatus::Deprecated => "deprecated",
    }
}

fn prefix_status_from_key(key: &str) -> PrefixStatus {
    match key {
        "container" => PrefixStatus::Container,
        "reserved" => PrefixStatus::Reserved,
        "deprecated" => PrefixStatus::Deprecated,
        _ => PrefixStatus::Active,
    }
}

fn address_status_key(status: AddressStatus) -> &'static str {
    match status {
        AddressStatus::Active => "active",
        AddressStatus::Reserved => "reserved",
        AddressStatus::Deprecated => "deprecated",
    }
}

fn address_status_from_key(key: &str) -> AddressStatus {
    match key {
        "reserved" => AddressStatus::Reserved,
        "deprecated" => AddressStatus::Deprecated,
        _ => AddressStatus::Active,
    }
}

/// Trims free text and collapses a blank optional id to `None` so the UI's
/// empty select value never lands in the database as an empty soft reference.
fn optional_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

// ── Prefixes ─────────────────────────────────────────────────────────────────

const PREFIX_COLUMNS: &str = "id, cidr, vrf, role, status, description, site_id";

fn read_prefix(row: &rusqlite::Row<'_>) -> rusqlite::Result<IpPrefix> {
    let status: String = row.get(4)?;
    Ok(IpPrefix {
        id: row.get(0)?,
        cidr: row.get(1)?,
        vrf: row.get(2)?,
        role: row.get(3)?,
        status: prefix_status_from_key(&status),
        description: row.get(5)?,
        site_id: row.get(6)?,
    })
}

fn list_prefix_rows(conn: &SqliteConnection) -> Result<Vec<IpPrefix>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PREFIX_COLUMNS} FROM itops_ip_prefixes ORDER BY vrf, cidr"
    ))?;
    let rows = stmt
        .query_map([], read_prefix)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

const ADDRESS_COLUMNS: &str =
    "id, address, vrf, status, dns_name, description, host_id, connection_id, rack_item_id";

fn read_address(row: &rusqlite::Row<'_>) -> rusqlite::Result<IpAddressRecord> {
    let status: String = row.get(3)?;
    Ok(IpAddressRecord {
        id: row.get(0)?,
        address: row.get(1)?,
        vrf: row.get(2)?,
        status: address_status_from_key(&status),
        dns_name: row.get(4)?,
        description: row.get(5)?,
        host_id: row.get(6)?,
        connection_id: row.get(7)?,
        rack_item_id: row.get(8)?,
    })
}

fn list_address_rows(conn: &SqliteConnection) -> Result<Vec<IpAddressRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ADDRESS_COLUMNS} FROM itops_ip_address_records ORDER BY vrf, id"
    ))?;
    let rows = stmt
        .query_map([], read_address)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Rebuilds the whole IPAM view: parent links, depths, and utilization.
/// Addresses sort numerically (string order would put .10 before .9) and
/// prefixes sort by network then length so a parent always precedes its
/// children in the returned list — the UI renders the tree by walking it once.
pub fn snapshot(conn: &SqliteConnection) -> Result<IpamSnapshot> {
    let rows = list_prefix_rows(conn)?;
    let mut addresses = list_address_rows(conn)?;
    addresses.sort_by_key(|record| {
        (
            record.vrf.clone(),
            ipv4::parse_address(&record.address).unwrap_or(0),
        )
    });
    Ok(IpamSnapshot {
        prefixes: build_prefix_nodes(&rows, &addresses),
        addresses,
    })
}

/// The pure half of `snapshot`, split out so the arithmetic is unit-testable
/// without a database.
fn build_prefix_nodes(rows: &[IpPrefix], addresses: &[IpAddressRecord]) -> Vec<IpamPrefixNode> {
    // Rows whose cidr somehow failed to parse (hand-edited database) are
    // dropped from the derived view rather than crashing the destination.
    let mut parsed: Vec<(IpPrefix, Prefix)> = rows
        .iter()
        .filter_map(|row| Prefix::parse(&row.cidr).map(|prefix| (row.clone(), prefix)))
        .collect();
    parsed.sort_by_key(|(row, prefix)| (row.vrf.clone(), prefix.network, prefix.length));

    // Parent resolution is per-VRF: the same RFC 1918 space in two VRFs are
    // unrelated trees.
    let mut parent_ids: Vec<Option<String>> = vec![None; parsed.len()];
    let mut child_counts: Vec<u32> = vec![0; parsed.len()];
    let mut covered: Vec<u64> = vec![0; parsed.len()];
    let mut index_by_id: HashMap<&str, usize> = HashMap::new();
    for (index, (row, _)) in parsed.iter().enumerate() {
        index_by_id.insert(row.id.as_str(), index);
    }

    for vrf_group in group_indices_by_vrf(&parsed) {
        let prefixes: Vec<Prefix> = vrf_group.iter().map(|&index| parsed[index].1).collect();
        for (local, &index) in vrf_group.iter().enumerate() {
            let Some(parent_local) = ipv4::parent_index(&prefixes, local) else {
                continue;
            };
            let parent = vrf_group[parent_local];
            parent_ids[index] = Some(parsed[parent].0.id.clone());
            child_counts[parent] += 1;
            covered[parent] += prefixes[local].size();
        }
    }

    // Address counts: an address belongs to the innermost prefix containing it
    // in its VRF, so a container's own count stays 0 while its leaves fill up.
    let mut address_counts: Vec<u32> = vec![0; parsed.len()];
    for record in addresses {
        let Some(value) = ipv4::parse_address(&record.address) else {
            continue;
        };
        let mut best: Option<usize> = None;
        for (index, (row, prefix)) in parsed.iter().enumerate() {
            if row.vrf != record.vrf || !prefix.contains_address(value) {
                continue;
            }
            if best.is_none_or(|current| parsed[current].1.length < prefix.length) {
                best = Some(index);
            }
        }
        if let Some(index) = best {
            address_counts[index] += 1;
        }
    }

    let mut depths: Vec<u32> = vec![0; parsed.len()];
    for index in 0..parsed.len() {
        let mut depth = 0u32;
        let mut cursor = parent_ids[index].clone();
        // Depth walks up the already-acyclic parent chain; the bound is a
        // belt-and-braces guard against a hand-edited database.
        while let Some(parent_id) = cursor {
            let Some(&parent) = index_by_id.get(parent_id.as_str()) else {
                break;
            };
            depth += 1;
            if depth > 32 {
                break;
            }
            cursor = parent_ids[parent].clone();
        }
        depths[index] = depth;
    }

    parsed
        .into_iter()
        .enumerate()
        .map(|(index, (row, prefix))| {
            let usable = prefix.usable();
            let container = row.status == PrefixStatus::Container;
            let used = if container {
                covered[index]
            } else {
                u64::from(address_counts[index])
            };
            let denominator = if container { prefix.size() } else { usable };
            let utilization = if denominator == 0 {
                0.0
            } else {
                (used as f64 / denominator as f64).clamp(0.0, 1.0)
            };
            // /31 and /32 have no host range distinct from the network itself.
            let (first_usable, last_usable) = if prefix.length >= 31 {
                (prefix.network, prefix.last())
            } else {
                (prefix.network + 1, prefix.last() - 1)
            };
            IpamPrefixNode {
                parent_id: parent_ids[index].clone(),
                depth: depths[index],
                network: ipv4::format_address(prefix.network),
                broadcast: ipv4::format_address(prefix.last()),
                first_usable: ipv4::format_address(first_usable),
                last_usable: ipv4::format_address(last_usable),
                usable,
                used,
                utilization,
                child_count: child_counts[index],
                address_count: address_counts[index],
                prefix: row,
            }
        })
        .collect()
}

/// Index groups sharing a VRF. `parsed` is already sorted by VRF, so groups are
/// contiguous runs.
fn group_indices_by_vrf(parsed: &[(IpPrefix, Prefix)]) -> Vec<Vec<usize>> {
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for (index, (row, _)) in parsed.iter().enumerate() {
        match groups.last_mut() {
            Some(group) if parsed[group[0]].0.vrf == row.vrf => group.push(index),
            _ => groups.push(vec![index]),
        }
    }
    groups
}

fn canonical_cidr(cidr: &str) -> Result<String> {
    Prefix::parse(cidr)
        .map(Prefix::to_cidr)
        .ok_or_else(|| invalid(format!("'{}' is not a valid IPv4 prefix (expected a.b.c.d/len)", cidr.trim())))
}

pub fn create_prefix(
    conn: &SqliteConnection,
    id: &str,
    cidr: &str,
    vrf: &str,
    role: &str,
    status: PrefixStatus,
    description: &str,
    site_id: Option<&str>,
) -> Result<IpPrefix> {
    let cidr = canonical_cidr(cidr)?;
    let vrf = vrf.trim().to_string();
    let prefix = IpPrefix {
        id: id.to_string(),
        cidr,
        vrf,
        role: role.trim().to_string(),
        status,
        description: description.trim().to_string(),
        site_id: optional_id(site_id),
    };
    let affected = conn.execute(
        "INSERT OR IGNORE INTO itops_ip_prefixes
            (id, cidr, vrf, role, status, description, site_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            prefix.id,
            prefix.cidr,
            prefix.vrf,
            prefix.role,
            prefix_status_key(prefix.status),
            prefix.description,
            prefix.site_id
        ],
    )?;
    if affected == 0 {
        return Err(invalid(format!(
            "prefix {} already exists in this VRF",
            prefix.cidr
        )));
    }
    Ok(prefix)
}

pub fn update_prefix(
    conn: &SqliteConnection,
    id: &str,
    cidr: &str,
    vrf: &str,
    role: &str,
    status: PrefixStatus,
    description: &str,
    site_id: Option<&str>,
) -> Result<IpPrefix> {
    let cidr = canonical_cidr(cidr)?;
    let vrf = vrf.trim().to_string();
    let clash: Option<String> = conn
        .query_row(
            "SELECT id FROM itops_ip_prefixes WHERE cidr = ? AND vrf = ? AND id <> ?",
            params![cidr, vrf, id],
            |row| row.get(0),
        )
        .optional()?;
    if clash.is_some() {
        return Err(invalid(format!("prefix {cidr} already exists in this VRF")));
    }
    let prefix = IpPrefix {
        id: id.to_string(),
        cidr,
        vrf,
        role: role.trim().to_string(),
        status,
        description: description.trim().to_string(),
        site_id: optional_id(site_id),
    };
    let affected = conn.execute(
        "UPDATE itops_ip_prefixes
         SET cidr = ?, vrf = ?, role = ?, status = ?, description = ?, site_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![
            prefix.cidr,
            prefix.vrf,
            prefix.role,
            prefix_status_key(prefix.status),
            prefix.description,
            prefix.site_id,
            id
        ],
    )?;
    if affected == 0 {
        return Err(IpamStorageError::NotFound);
    }
    Ok(prefix)
}

/// Deletes a prefix only. Child prefixes and the Address Records inside it are
/// left alone: they re-parent to the next enclosing prefix on the following
/// read, which is what an operator merging two subnets expects.
pub fn remove_prefix(conn: &SqliteConnection, id: &str) -> Result<()> {
    let affected = conn.execute("DELETE FROM itops_ip_prefixes WHERE id = ?", params![id])?;
    if affected == 0 {
        return Err(IpamStorageError::NotFound);
    }
    Ok(())
}

// ── Address Records ──────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub fn create_address(
    conn: &SqliteConnection,
    id: &str,
    address: &str,
    vrf: &str,
    status: AddressStatus,
    dns_name: &str,
    description: &str,
    host_id: Option<&str>,
    connection_id: Option<&str>,
    rack_item_id: Option<&str>,
) -> Result<IpAddressRecord> {
    let value = ipv4::parse_address(address)
        .ok_or_else(|| invalid(format!("'{}' is not a valid IPv4 address", address.trim())))?;
    let record = IpAddressRecord {
        id: id.to_string(),
        address: ipv4::format_address(value),
        vrf: vrf.trim().to_string(),
        status,
        dns_name: dns_name.trim().to_string(),
        description: description.trim().to_string(),
        host_id: optional_id(host_id),
        connection_id: optional_id(connection_id),
        rack_item_id: optional_id(rack_item_id),
    };
    let affected = conn.execute(
        "INSERT OR IGNORE INTO itops_ip_address_records
            (id, address, vrf, status, dns_name, description, host_id, connection_id, rack_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            record.id,
            record.address,
            record.vrf,
            address_status_key(record.status),
            record.dns_name,
            record.description,
            record.host_id,
            record.connection_id,
            record.rack_item_id
        ],
    )?;
    if affected == 0 {
        return Err(invalid(format!(
            "{} is already assigned in this VRF",
            record.address
        )));
    }
    Ok(record)
}

#[allow(clippy::too_many_arguments)]
pub fn update_address(
    conn: &SqliteConnection,
    id: &str,
    address: &str,
    vrf: &str,
    status: AddressStatus,
    dns_name: &str,
    description: &str,
    host_id: Option<&str>,
    connection_id: Option<&str>,
    rack_item_id: Option<&str>,
) -> Result<IpAddressRecord> {
    let value = ipv4::parse_address(address)
        .ok_or_else(|| invalid(format!("'{}' is not a valid IPv4 address", address.trim())))?;
    let address = ipv4::format_address(value);
    let vrf = vrf.trim().to_string();
    let clash: Option<String> = conn
        .query_row(
            "SELECT id FROM itops_ip_address_records WHERE address = ? AND vrf = ? AND id <> ?",
            params![address, vrf, id],
            |row| row.get(0),
        )
        .optional()?;
    if clash.is_some() {
        return Err(invalid(format!("{address} is already assigned in this VRF")));
    }
    let record = IpAddressRecord {
        id: id.to_string(),
        address,
        vrf,
        status,
        dns_name: dns_name.trim().to_string(),
        description: description.trim().to_string(),
        host_id: optional_id(host_id),
        connection_id: optional_id(connection_id),
        rack_item_id: optional_id(rack_item_id),
    };
    let affected = conn.execute(
        "UPDATE itops_ip_address_records
         SET address = ?, vrf = ?, status = ?, dns_name = ?, description = ?,
             host_id = ?, connection_id = ?, rack_item_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![
            record.address,
            record.vrf,
            address_status_key(record.status),
            record.dns_name,
            record.description,
            record.host_id,
            record.connection_id,
            record.rack_item_id,
            id
        ],
    )?;
    if affected == 0 {
        return Err(IpamStorageError::NotFound);
    }
    Ok(record)
}

pub fn remove_address(conn: &SqliteConnection, id: &str) -> Result<()> {
    let affected = conn.execute(
        "DELETE FROM itops_ip_address_records WHERE id = ?",
        params![id],
    )?;
    if affected == 0 {
        return Err(IpamStorageError::NotFound);
    }
    Ok(())
}

/// The lowest unassigned usable addresses in `cidr`, at most `limit` of them —
/// the "next free IP" every IPAM tool offers when documenting a new device.
pub fn suggest_free_addresses(
    conn: &SqliteConnection,
    cidr: &str,
    vrf: &str,
    limit: u32,
) -> Result<Vec<String>> {
    let prefix = Prefix::parse(cidr)
        .ok_or_else(|| invalid(format!("'{}' is not a valid IPv4 prefix", cidr.trim())))?;
    let vrf = vrf.trim().to_string();
    let taken: Vec<u32> = list_address_rows(conn)?
        .into_iter()
        .filter(|record| record.vrf == vrf)
        .filter_map(|record| ipv4::parse_address(&record.address))
        .filter(|value| prefix.contains_address(*value))
        .collect();
    let (first, last) = if prefix.length >= 31 {
        (prefix.network, prefix.last())
    } else {
        (prefix.network + 1, prefix.last() - 1)
    };
    let mut free = Vec::new();
    let mut candidate = first;
    while free.len() < limit as usize {
        if !taken.contains(&candidate) {
            free.push(ipv4::format_address(candidate));
        }
        if candidate == last {
            break;
        }
        candidate += 1;
    }
    Ok(free)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE itops_ip_prefixes (
                id TEXT PRIMARY KEY,
                cidr TEXT NOT NULL,
                vrf TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                description TEXT NOT NULL DEFAULT '',
                site_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(vrf, cidr)
            );
            CREATE TABLE itops_ip_address_records (
                id TEXT PRIMARY KEY,
                address TEXT NOT NULL,
                vrf TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                dns_name TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                host_id TEXT,
                connection_id TEXT,
                rack_item_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(vrf, address)
            );",
        )
        .unwrap();
        conn
    }

    fn add_prefix(conn: &SqliteConnection, id: &str, cidr: &str, status: PrefixStatus) {
        create_prefix(conn, id, cidr, "", "", status, "", None).unwrap();
    }

    #[test]
    fn canonicalizes_and_rejects_bad_prefixes() {
        let conn = open_test_db();
        let created = create_prefix(
            &conn,
            "p1",
            " 10.1.2.77/24 ",
            " ",
            " Access ",
            PrefixStatus::Active,
            " floor 2 ",
            Some("  "),
        )
        .unwrap();
        assert_eq!(created.cidr, "10.1.2.0/24");
        assert_eq!(created.role, "Access");
        assert_eq!(created.description, "floor 2");
        assert!(created.site_id.is_none());
        assert!(create_prefix(&conn, "p2", "10.1.2.0/33", "", "", PrefixStatus::Active, "", None).is_err());
        // Same canonical network in the same VRF is a duplicate.
        assert!(create_prefix(&conn, "p3", "10.1.2.9/24", "", "", PrefixStatus::Active, "", None).is_err());
    }

    #[test]
    fn builds_hierarchy_and_container_utilization() {
        let conn = open_test_db();
        add_prefix(&conn, "root", "10.0.0.0/8", PrefixStatus::Container);
        add_prefix(&conn, "mid", "10.1.0.0/16", PrefixStatus::Container);
        add_prefix(&conn, "leaf", "10.1.2.0/24", PrefixStatus::Active);
        create_address(&conn, "a1", "10.1.2.10", "", AddressStatus::Active, "", "", None, None, None).unwrap();
        create_address(&conn, "a2", "10.1.2.11", "", AddressStatus::Active, "", "", None, None, None).unwrap();

        let snapshot = snapshot(&conn).unwrap();
        let by_id = |id: &str| {
            snapshot
                .prefixes
                .iter()
                .find(|node| node.prefix.id == id)
                .unwrap()
                .clone()
        };
        let root = by_id("root");
        let mid = by_id("mid");
        let leaf = by_id("leaf");
        assert_eq!(root.parent_id, None);
        assert_eq!(root.depth, 0);
        assert_eq!(mid.parent_id.as_deref(), Some("root"));
        assert_eq!(leaf.parent_id.as_deref(), Some("mid"));
        assert_eq!(leaf.depth, 2);
        // Container utilization is covered child space, not addresses.
        assert_eq!(mid.used, 256);
        assert_eq!(mid.address_count, 0);
        assert_eq!(root.child_count, 1);
        // Leaf utilization is assigned addresses over usable hosts.
        assert_eq!(leaf.used, 2);
        assert_eq!(leaf.usable, 254);
        assert!((leaf.utilization - 2.0 / 254.0).abs() < 1e-9);
        assert_eq!(leaf.first_usable, "10.1.2.1");
        assert_eq!(leaf.last_usable, "10.1.2.254");
    }

    #[test]
    fn keeps_vrfs_as_separate_trees() {
        let conn = open_test_db();
        create_prefix(&conn, "a", "10.0.0.0/8", "blue", "", PrefixStatus::Container, "", None).unwrap();
        create_prefix(&conn, "b", "10.1.0.0/16", "red", "", PrefixStatus::Active, "", None).unwrap();
        // Same CIDR in another VRF is not a duplicate.
        create_prefix(&conn, "c", "10.0.0.0/8", "red", "", PrefixStatus::Container, "", None).unwrap();
        let snapshot = snapshot(&conn).unwrap();
        let red_child = snapshot
            .prefixes
            .iter()
            .find(|node| node.prefix.id == "b")
            .unwrap();
        assert_eq!(red_child.parent_id.as_deref(), Some("c"));
    }

    #[test]
    fn suggests_the_lowest_free_addresses() {
        let conn = open_test_db();
        add_prefix(&conn, "leaf", "192.168.5.0/24", PrefixStatus::Active);
        create_address(&conn, "a1", "192.168.5.1", "", AddressStatus::Active, "", "", None, None, None).unwrap();
        create_address(&conn, "a2", "192.168.5.3", "", AddressStatus::Active, "", "", None, None, None).unwrap();
        let free = suggest_free_addresses(&conn, "192.168.5.0/24", "", 3).unwrap();
        assert_eq!(free, vec!["192.168.5.2", "192.168.5.4", "192.168.5.5"]);
        // A /31 has no network/broadcast pair to skip.
        add_prefix(&conn, "p2p", "10.9.9.0/31", PrefixStatus::Active);
        assert_eq!(
            suggest_free_addresses(&conn, "10.9.9.0/31", "", 4).unwrap(),
            vec!["10.9.9.0", "10.9.9.1"]
        );
    }

    #[test]
    fn updates_and_removes_records() {
        let conn = open_test_db();
        add_prefix(&conn, "leaf", "172.16.0.0/24", PrefixStatus::Active);
        create_address(&conn, "a1", "172.16.0.5", "", AddressStatus::Active, "", "", None, None, None).unwrap();
        create_address(&conn, "a2", "172.16.0.6", "", AddressStatus::Active, "", "", None, None, None).unwrap();
        // Moving onto a taken address is rejected before anything is written.
        assert!(update_address(&conn, "a1", "172.16.0.6", "", AddressStatus::Active, "", "", None, None, None).is_err());
        let updated = update_address(
            &conn,
            "a1",
            "172.16.0.7",
            "",
            AddressStatus::Reserved,
            " gw.example ",
            "",
            Some(""),
            Some("conn-1"),
            None,
        )
        .unwrap();
        assert_eq!(updated.address, "172.16.0.7");
        assert_eq!(updated.dns_name, "gw.example");
        assert!(updated.host_id.is_none());
        assert_eq!(updated.connection_id.as_deref(), Some("conn-1"));
        remove_address(&conn, "a1").unwrap();
        assert!(remove_address(&conn, "a1").is_err());
        // Deleting a prefix leaves its addresses documented.
        remove_prefix(&conn, "leaf").unwrap();
        assert_eq!(snapshot(&conn).unwrap().addresses.len(), 1);
    }

    #[test]
    fn sorts_addresses_numerically() {
        let conn = open_test_db();
        for (index, address) in ["10.0.0.20", "10.0.0.3", "10.0.0.100"].iter().enumerate() {
            create_address(
                &conn,
                &format!("a{index}"),
                address,
                "",
                AddressStatus::Active,
                "",
                "",
                None,
                None,
                None,
            )
            .unwrap();
        }
        let ordered: Vec<String> = snapshot(&conn)
            .unwrap()
            .addresses
            .into_iter()
            .map(|record| record.address)
            .collect();
        assert_eq!(ordered, vec!["10.0.0.3", "10.0.0.20", "10.0.0.100"]);
    }
}

// Durable VLAN storage (docs/ITOPS.md VLAN). VLANs are global to the Module
// like the Task Library and IPAM: a Site binding labels a VLAN, it does not
// scope its visibility.
//
// This is a table rather than a field inside a Network Map's graph_json because
// VLAN 30 drawn on two maps has to be the same VLAN. Map-local VLANs would make
// that a coincidence of spelling and would need a dedup migration across every
// saved graph the moment anything wanted to join them to IPAM.

use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};

use super::types::{VLAN_ID_MAX, VLAN_ID_MIN, Vlan};

#[derive(Debug)]
pub enum VlanStorageError {
    Validation(String),
    NotFound,
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for VlanStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(reason) => write!(f, "{reason}"),
            Self::NotFound => write!(f, "VLAN not found"),
            Self::Sqlite(error) => write!(f, "{error}"),
        }
    }
}

impl From<rusqlite::Error> for VlanStorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

type Result<T> = std::result::Result<T, VlanStorageError>;

const COLUMNS: &str = "id, vid, name, description, site_id, accent";

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Vlan> {
    let vid: i64 = row.get(1)?;
    let accent: i64 = row.get(5)?;
    Ok(Vlan {
        id: row.get(0)?,
        vid: vid.clamp(i64::from(VLAN_ID_MIN), i64::from(VLAN_ID_MAX)) as u16,
        name: row.get(2)?,
        description: row.get(3)?,
        site_id: row.get(4)?,
        accent: accent.clamp(0, i64::from(u8::MAX)) as u8,
    })
}

fn validate_vid(vid: u16) -> Result<u16> {
    if !(VLAN_ID_MIN..=VLAN_ID_MAX).contains(&vid) {
        return Err(VlanStorageError::Validation(format!(
            "VLAN id must be between {VLAN_ID_MIN} and {VLAN_ID_MAX}"
        )));
    }
    Ok(vid)
}

/// Trims free text and collapses a blank optional id to `None` so the UI's
/// empty select value never lands in the database as an empty soft reference.
fn optional_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

pub fn list_vlans(conn: &SqliteConnection) -> Result<Vec<Vlan>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM itops_vlans ORDER BY vid"))?;
    let rows = stmt
        .query_map([], read_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn create_vlan(
    conn: &SqliteConnection,
    id: &str,
    vid: u16,
    name: &str,
    description: &str,
    site_id: Option<&str>,
    accent: u8,
) -> Result<Vlan> {
    let vlan = Vlan {
        id: id.to_string(),
        vid: validate_vid(vid)?,
        name: name.trim().to_string(),
        description: description.trim().to_string(),
        site_id: optional_id(site_id),
        accent,
    };
    let affected = conn.execute(
        "INSERT OR IGNORE INTO itops_vlans (id, vid, name, description, site_id, accent)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![
            vlan.id,
            vlan.vid,
            vlan.name,
            vlan.description,
            vlan.site_id,
            vlan.accent
        ],
    )?;
    if affected == 0 {
        return Err(VlanStorageError::Validation(format!(
            "VLAN {} already exists",
            vlan.vid
        )));
    }
    Ok(vlan)
}

pub fn update_vlan(
    conn: &SqliteConnection,
    id: &str,
    vid: u16,
    name: &str,
    description: &str,
    site_id: Option<&str>,
    accent: u8,
) -> Result<Vlan> {
    let vid = validate_vid(vid)?;
    let clash: Option<String> = conn
        .query_row(
            "SELECT id FROM itops_vlans WHERE vid = ? AND id <> ?",
            params![vid, id],
            |row| row.get(0),
        )
        .optional()?;
    if clash.is_some() {
        return Err(VlanStorageError::Validation(format!(
            "VLAN {vid} already exists"
        )));
    }
    let vlan = Vlan {
        id: id.to_string(),
        vid,
        name: name.trim().to_string(),
        description: description.trim().to_string(),
        site_id: optional_id(site_id),
        accent,
    };
    let affected = conn.execute(
        "UPDATE itops_vlans
         SET vid = ?, name = ?, description = ?, site_id = ?, accent = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![
            vlan.vid,
            vlan.name,
            vlan.description,
            vlan.site_id,
            vlan.accent,
            vlan.id
        ],
    )?;
    if affected == 0 {
        return Err(VlanStorageError::NotFound);
    }
    Ok(vlan)
}

/// Deleting a VLAN clears the soft reference on any IP Prefix that pointed at
/// it. A prefix documents addressing whether or not its VLAN still exists, so
/// the prefix itself is never deleted here. Network Link references live inside
/// each map's `graph_json` and resolve to "unknown VLAN" at render time.
pub fn remove_vlan(conn: &SqliteConnection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let affected = tx.execute("DELETE FROM itops_vlans WHERE id = ?", params![id])?;
    if affected == 0 {
        return Err(VlanStorageError::NotFound);
    }
    tx.execute(
        "UPDATE itops_ip_prefixes SET vlan_id = NULL WHERE vlan_id = ?",
        params![id],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE itops_vlans (
                id          TEXT PRIMARY KEY,
                vid         INTEGER NOT NULL UNIQUE CHECK (vid BETWEEN 1 AND 4094),
                name        TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                site_id     TEXT,
                accent      INTEGER NOT NULL DEFAULT 0 CHECK (accent BETWEEN 0 AND 255),
                created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE itops_ip_prefixes (
                id      TEXT PRIMARY KEY,
                cidr    TEXT NOT NULL,
                vlan_id TEXT
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn creates_trims_and_rejects_duplicate_or_out_of_range_ids() {
        let conn = open_test_db();
        let created =
            create_vlan(&conn, "v1", 30, "  Voice  ", "  phones ", Some("  "), 3).unwrap();
        assert_eq!(created.name, "Voice");
        assert_eq!(created.description, "phones");
        assert!(created.site_id.is_none());

        assert!(create_vlan(&conn, "v2", 30, "Dup", "", None, 0).is_err());
        assert!(create_vlan(&conn, "v3", 0, "Reserved", "", None, 0).is_err());
        assert!(create_vlan(&conn, "v4", 4095, "Reserved", "", None, 0).is_err());
        assert_eq!(list_vlans(&conn).unwrap().len(), 1);
    }

    #[test]
    fn updates_reject_a_taken_vid_and_deletes_unlink_prefixes() {
        let conn = open_test_db();
        create_vlan(&conn, "v1", 10, "Data", "", None, 0).unwrap();
        create_vlan(&conn, "v2", 20, "Voice", "", None, 1).unwrap();
        conn.execute(
            "INSERT INTO itops_ip_prefixes (id, cidr, vlan_id) VALUES ('p1', '10.20.0.0/24', 'v2')",
            [],
        )
        .unwrap();

        assert!(update_vlan(&conn, "v2", 10, "Voice", "", None, 1).is_err());
        let renamed = update_vlan(&conn, "v2", 21, "Voice", "", Some("site-1"), 4).unwrap();
        assert_eq!(renamed.vid, 21);
        assert_eq!(renamed.site_id.as_deref(), Some("site-1"));
        assert!(update_vlan(&conn, "ghost", 99, "", "", None, 0).is_err());

        remove_vlan(&conn, "v2").unwrap();
        let orphaned: Option<String> = conn
            .query_row("SELECT vlan_id FROM itops_ip_prefixes", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(orphaned.is_none());
        assert!(remove_vlan(&conn, "v2").is_err());
        assert_eq!(list_vlans(&conn).unwrap().len(), 1);
    }

    #[test]
    fn delete_rolls_back_when_unlinking_a_prefix_fails() {
        let conn = open_test_db();
        create_vlan(&conn, "v1", 30, "Voice", "", None, 0).unwrap();
        conn.execute(
            "INSERT INTO itops_ip_prefixes (id, cidr, vlan_id)
             VALUES ('p1', '10.20.30.0/24', 'v1')",
            [],
        )
        .unwrap();
        conn.execute_batch(
            "CREATE TRIGGER reject_vlan_unlink
             BEFORE UPDATE OF vlan_id ON itops_ip_prefixes
             BEGIN
                 SELECT RAISE(ABORT, 'unlink failed');
             END;",
        )
        .unwrap();

        assert!(remove_vlan(&conn, "v1").is_err());
        assert_eq!(list_vlans(&conn).unwrap().len(), 1);
        let vlan_id: Option<String> = conn
            .query_row("SELECT vlan_id FROM itops_ip_prefixes", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(vlan_id.as_deref(), Some("v1"));
    }
}

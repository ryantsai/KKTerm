// Durable Network Map storage (docs/ITOPS.md). One row per map holds the whole
// graph as JSON, following the Automation `actions_json` precedent: the canvas
// saves as a whole document, so per-node rows would only add round trips
// without buying a query the UI ever makes.

use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};

use std::collections::HashSet;

use super::types::{NetworkGraph, NetworkLink, NetworkLinkStrand, NetworkMap};

/// Ceiling on parallel physical links recorded for one drawn link. The canvas
/// draws at most four strands; beyond that the count carries the truth and the
/// list in the inspector stays the authoritative record.
const MAX_STRANDS: usize = 64;

#[derive(Debug)]
pub enum NetworkMapStorageError {
    Validation(String),
    NotFound,
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for NetworkMapStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(reason) => write!(f, "{reason}"),
            Self::NotFound => write!(f, "network map not found"),
            Self::Sqlite(error) => write!(f, "{error}"),
        }
    }
}

impl From<rusqlite::Error> for NetworkMapStorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

type Result<T> = std::result::Result<T, NetworkMapStorageError>;
type MapRow = (String, String, String, Option<String>, i64, String);

const SELECT_COLUMNS: &str = "id, name, description, site_id, sort_order, graph_json";

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MapRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
    ))
}

fn row_to_map(row: MapRow) -> NetworkMap {
    let (id, name, description, site_id, sort_order, graph_json) = row;
    let graph = serde_json::from_str(&graph_json).unwrap_or_default();
    NetworkMap {
        id,
        name,
        description,
        site_id,
        sort_order,
        // A map with an unreadable blob still lists (as an empty canvas) rather
        // than failing the whole destination. Sanitize valid blobs too because
        // selective imports write rows directly instead of using create/update.
        graph: sanitize_graph(&graph),
    }
}

fn validate_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(NetworkMapStorageError::Validation(
            "network map name must not be empty".to_string(),
        ));
    }
    Ok(name.to_string())
}

/// Drops links whose endpoints do not exist and links a node to itself, so a
/// stale client payload can never persist a graph the reachability walk would
/// have to defend against. Also normalizes each link's strands and VLAN
/// membership; VLAN ids themselves are soft references into `itops_vlans` and
/// are deliberately not validated here, so a map keeps documenting VLAN 30
/// after the record is renamed or deleted.
fn sanitize_graph(graph: &NetworkGraph) -> NetworkGraph {
    let node_ids: Vec<&str> = graph.nodes.iter().map(|node| node.id.as_str()).collect();
    NetworkGraph {
        nodes: graph.nodes.clone(),
        links: graph
            .links
            .iter()
            .filter(|link| {
                link.from != link.to
                    && node_ids.contains(&link.from.as_str())
                    && node_ids.contains(&link.to.as_str())
            })
            .cloned()
            .map(sanitize_link)
            .collect(),
        roots: graph
            .roots
            .iter()
            .filter(|root| node_ids.contains(&root.as_str()))
            .cloned()
            .collect(),
    }
}

fn sanitize_link(mut link: NetworkLink) -> NetworkLink {
    link.strands = migrate_strands(&link);
    // A native VLAN is untagged by definition, so listing it as tagged too is
    // a contradiction rather than extra information.
    let native = link.native_vlan_id.take().and_then(non_empty);
    let mut seen: HashSet<String> = HashSet::new();
    link.tagged_vlan_ids = link
        .tagged_vlan_ids
        .drain(..)
        .filter_map(non_empty)
        .filter(|id| Some(id) != native.as_ref() && seen.insert(id.clone()))
        .collect();
    link.native_vlan_id = native;
    link.connection_count = None;
    link.speed = None;
    link
}

/// Strand list for one link, folding the pre-strand `connectionCount`/`speed`
/// pair from older saved graphs into the list. Never returns an empty list: a
/// drawn link always stands for at least one physical link.
fn migrate_strands(link: &NetworkLink) -> Vec<NetworkLinkStrand> {
    let mut strands: Vec<NetworkLinkStrand> = link
        .strands
        .iter()
        .take(MAX_STRANDS)
        .enumerate()
        .map(|(index, strand)| NetworkLinkStrand {
            id: non_empty(strand.id.clone())
                .unwrap_or_else(|| format!("{}-strand-{index}", link.id)),
            name: strand.name.trim().to_string(),
            speed: strand.speed.trim().to_string(),
        })
        .collect();
    if strands.is_empty() {
        let legacy_speed = link.speed.clone().unwrap_or_default().trim().to_string();
        let count = usize::from(link.connection_count.unwrap_or(1)).clamp(1, MAX_STRANDS);
        strands = (0..count)
            .map(|index| NetworkLinkStrand {
                id: format!("{}-strand-{index}", link.id),
                // The pre-strand model had one speed for the whole bundle and
                // no per-member port names, so every member inherits it.
                name: String::new(),
                speed: legacy_speed.clone(),
            })
            .collect();
    }
    strands
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn graph_to_json(graph: &NetworkGraph) -> Result<String> {
    serde_json::to_string(graph)
        .map_err(|error| NetworkMapStorageError::Validation(error.to_string()))
}

pub fn list_maps(conn: &SqliteConnection) -> Result<Vec<NetworkMap>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM itops_network_maps ORDER BY sort_order"
    ))?;
    let rows = stmt
        .query_map([], read_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows.into_iter().map(row_to_map).collect())
}

pub fn get_map(conn: &SqliteConnection, id: &str) -> Result<Option<NetworkMap>> {
    let row = conn
        .query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM itops_network_maps WHERE id = ?"),
            params![id],
            read_row,
        )
        .optional()?;
    Ok(row.map(row_to_map))
}

pub fn create_map(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    description: &str,
    site_id: Option<&str>,
    graph: &NetworkGraph,
) -> Result<NetworkMap> {
    let name = validate_name(name)?;
    let description = description.trim().to_string();
    let site_id = site_id
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    let graph = sanitize_graph(graph);
    let sort_order = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_network_maps",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO itops_network_maps
            (id, name, description, site_id, sort_order, graph_json)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![
            id,
            name,
            description,
            site_id,
            sort_order,
            graph_to_json(&graph)?
        ],
    )?;
    Ok(NetworkMap {
        id: id.to_string(),
        name,
        description,
        site_id,
        sort_order,
        graph,
    })
}

pub fn update_map(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    description: &str,
    site_id: Option<&str>,
    graph: &NetworkGraph,
) -> Result<NetworkMap> {
    let existing = get_map(conn, id)?.ok_or(NetworkMapStorageError::NotFound)?;
    let name = validate_name(name)?;
    let description = description.trim().to_string();
    let site_id = site_id
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    let graph = sanitize_graph(graph);
    conn.execute(
        "UPDATE itops_network_maps
         SET name = ?, description = ?, site_id = ?, graph_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![
            name,
            description,
            site_id,
            graph_to_json(&graph)?,
            id
        ],
    )?;
    Ok(NetworkMap {
        id: id.to_string(),
        name,
        description,
        site_id,
        sort_order: existing.sort_order,
        graph,
    })
}

pub fn remove_map(conn: &SqliteConnection, id: &str) -> Result<()> {
    let affected = conn.execute("DELETE FROM itops_network_maps WHERE id = ?", params![id])?;
    if affected == 0 {
        return Err(NetworkMapStorageError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::itops::types::{
        NetworkLinkKind, NetworkMapStatus, NetworkNode, NetworkNodeKind,
    };

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE itops_network_maps (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                site_id TEXT,
                sort_order INTEGER NOT NULL,
                graph_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .unwrap();
        conn
    }

    fn node(id: &str) -> NetworkNode {
        NetworkNode {
            id: id.to_string(),
            label: id.to_string(),
            kind: NetworkNodeKind::Switch,
            ..NetworkNode::default()
        }
    }

    fn link(id: &str, from: &str, to: &str) -> NetworkLink {
        NetworkLink {
            id: id.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            kind: NetworkLinkKind::Ethernet,
            ..NetworkLink::default()
        }
    }

    fn strand(id: &str, name: &str, speed: &str) -> NetworkLinkStrand {
        NetworkLinkStrand {
            id: id.to_string(),
            name: name.to_string(),
            speed: speed.to_string(),
        }
    }

    #[test]
    fn round_trips_a_graph_and_drops_dangling_links() {
        let conn = open_test_db();
        let mut primary_link = link("l1", "core", "edge");
        primary_link.strands = vec![
            strand("s1", " Gi1/0/1 ", " 10 Gbps "),
            strand("", "Gi1/0/2", "10 Gbps"),
        ];
        primary_link.native_vlan_id = Some(" vlan-10 ".to_string());
        primary_link.tagged_vlan_ids = vec![
            "vlan-20".into(),
            "vlan-20".into(),
            " ".into(),
            "vlan-10".into(),
        ];
        primary_link.status = NetworkMapStatus::Warning;
        let graph = NetworkGraph {
            nodes: vec![node("core"), node("edge")],
            links: vec![
                primary_link,
                link("l2", "core", "ghost"),
                link("l3", "core", "core"),
            ],
            roots: vec!["core".into(), "ghost".into()],
        };
        let created = create_map(&conn, "map-1", " Campus ", " main ", Some("  "), &graph).unwrap();
        assert_eq!(created.name, "Campus");
        assert_eq!(created.description, "main");
        assert!(created.site_id.is_none());
        assert_eq!(created.graph.links.len(), 1);
        assert_eq!(created.graph.roots, vec!["core".to_string()]);

        let listed = list_maps(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].graph.nodes.len(), 2);
        let stored = &listed[0].graph.links[0];
        assert_eq!(stored.id, "l1");
        assert_eq!(stored.strands.len(), 2);
        assert_eq!(stored.strands[0].name, "Gi1/0/1");
        assert_eq!(stored.strands[0].speed, "10 Gbps");
        // A blank strand id is backfilled so React keys and edits stay stable.
        assert_eq!(stored.strands[1].id, "l1-strand-1");
        assert_eq!(stored.native_vlan_id.as_deref(), Some("vlan-10"));
        // Blanks, duplicates, and the native VLAN drop out of the tagged set.
        assert_eq!(stored.tagged_vlan_ids, vec!["vlan-20".to_string()]);
        assert_eq!(stored.status, NetworkMapStatus::Warning);
    }

    #[test]
    fn folds_pre_strand_links_into_strands() {
        let conn = open_test_db();
        conn.execute(
            "INSERT INTO itops_network_maps (id, name, sort_order, graph_json)
             VALUES ('map-1', 'Legacy', 0, ?)",
            [r#"{
                "nodes":[{"id":"core"},{"id":"edge"},{"id":"leaf"}],
                "links":[
                    {"id":"lag","from":"core","to":"edge","connectionCount":3,"speed":" 10 Gbps "},
                    {"id":"single","from":"core","to":"leaf"}
                ],
                "roots":[]
            }"#],
        )
        .unwrap();

        let loaded = get_map(&conn, "map-1").unwrap().unwrap();
        let lag = &loaded.graph.links[0];
        assert_eq!(lag.strands.len(), 3);
        assert!(lag.strands.iter().all(|strand| strand.speed == "10 Gbps"));
        assert!(lag.strands.iter().all(|strand| strand.name.is_empty()));
        assert_eq!(lag.strands[2].id, "lag-strand-2");
        // A link that never had a count still stands for one physical link.
        assert_eq!(loaded.graph.links[1].strands.len(), 1);

        // The legacy pair is never written back once folded in.
        update_map(&conn, "map-1", "Legacy", "", None, &loaded.graph).unwrap();
        let stored: String = conn
            .query_row("SELECT graph_json FROM itops_network_maps", [], |row| {
                row.get(0)
            })
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&stored).unwrap();
        let first = &value["links"][0];
        assert!(first.get("connectionCount").is_none());
        assert!(first.get("speed").is_none());
        assert_eq!(first["strands"][0]["speed"], "10 Gbps");
    }

    #[test]
    fn updates_keep_sort_order_and_reject_blank_names() {
        let conn = open_test_db();
        create_map(&conn, "map-1", "First", "", None, &NetworkGraph::default()).unwrap();
        create_map(&conn, "map-2", "Second", "", None, &NetworkGraph::default()).unwrap();
        let updated = update_map(
            &conn,
            "map-2",
            "Renamed",
            "",
            Some("site-1"),
            &NetworkGraph::default(),
        )
        .unwrap();
        assert_eq!(updated.sort_order, 1);
        assert_eq!(updated.site_id.as_deref(), Some("site-1"));
        assert!(update_map(&conn, "map-2", "  ", "", None, &NetworkGraph::default()).is_err());
        remove_map(&conn, "map-2").unwrap();
        assert!(remove_map(&conn, "map-2").is_err());
        assert_eq!(list_maps(&conn).unwrap().len(), 1);
    }

    #[test]
    fn sanitizes_graphs_loaded_from_direct_imports() {
        let conn = open_test_db();
        conn.execute(
            "INSERT INTO itops_network_maps (id, name, sort_order, graph_json)
             VALUES ('map-1', 'Imported', 0, ?)",
            [r#"{
                "nodes":[{"id":"core","label":"Core"},{"id":"edge","label":"Edge"}],
                "links":[
                    {"id":"valid","from":"core","to":"edge"},
                    {"id":"dangling","from":"core","to":"ghost"},
                    {"id":"self","from":"core","to":"core"}
                ],
                "roots":["core","ghost"]
            }"#],
        )
        .unwrap();

        let loaded = get_map(&conn, "map-1").unwrap().unwrap();
        assert_eq!(loaded.graph.links.len(), 1);
        assert_eq!(loaded.graph.links[0].id, "valid");
        assert_eq!(loaded.graph.links[0].strands.len(), 1);
        assert_eq!(loaded.graph.roots, vec!["core".to_string()]);
    }
}

// Durable Network Map storage (docs/ITOPS.md). One row per map holds the whole
// graph as JSON, following the Automation `actions_json` precedent: the canvas
// saves as a whole document, so per-node rows would only add round trips
// without buying a query the UI ever makes.

use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};

use super::types::{NetworkGraph, NetworkMap};

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
/// have to defend against.
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
            .map(|mut link| {
                link.connection_count = link.connection_count.clamp(1, 64);
                link.speed = link.speed.trim().to_string();
                link
            })
            .collect(),
        roots: graph
            .roots
            .iter()
            .filter(|root| node_ids.contains(&root.as_str()))
            .cloned()
            .collect(),
    }
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
        NetworkLink, NetworkLinkKind, NetworkMapStatus, NetworkNode, NetworkNodeKind,
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
            label: String::new(),
            kind: NetworkLinkKind::Ethernet,
            connection_count: 1,
            speed: String::new(),
            status: Default::default(),
        }
    }

    #[test]
    fn round_trips_a_graph_and_drops_dangling_links() {
        let conn = open_test_db();
        let mut primary_link = link("l1", "core", "edge");
        primary_link.connection_count = 4;
        primary_link.speed = " 100 Gbps ".to_string();
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
        assert_eq!(listed[0].graph.links[0].id, "l1");
        assert_eq!(listed[0].graph.links[0].connection_count, 4);
        assert_eq!(listed[0].graph.links[0].speed, "100 Gbps");
        assert_eq!(listed[0].graph.links[0].status, NetworkMapStatus::Warning);
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
        assert_eq!(loaded.graph.links[0].connection_count, 1);
        assert_eq!(loaded.graph.roots, vec!["core".to_string()]);
    }
}

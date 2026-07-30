// Durable Network Map storage (docs/ITOPS.md). One row per map holds the whole
// graph as JSON: the canvas
// saves as a whole document, so per-node rows would only add round trips
// without buying a query the UI ever makes.

use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};

use std::collections::HashSet;

use super::types::{
    NetworkGeomapViewport, NetworkGraph, NetworkLink, NetworkLinkStrand, NetworkMap,
    NetworkMapNote, NetworkNode, NetworkNodeDeepLinkKind, NetworkNodeInterface, NetworkNodeKind,
    NetworkNodeShape,
};

/// Ceiling on parallel physical links recorded for one drawn link. The canvas
/// draws every strand or one bundled line, while the Properties list remains
/// the authoritative inventory.
const MAX_STRANDS: usize = 64;
/// Practical no-limit ceiling kept finite for durable JSON and canvas safety.
const MAX_NODE_DIMENSION: f64 = 1_000_000.0;

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
    let nodes: Vec<NetworkNode> = graph.nodes.iter().cloned().map(sanitize_node).collect();
    let node_ids: HashSet<String> = nodes.iter().map(|node| node.id.clone()).collect();
    let links = graph
        .links
        .iter()
        .filter(|link| {
            link.from != link.to && node_ids.contains(&link.from) && node_ids.contains(&link.to)
        })
        .cloned()
        .map(|link| sanitize_link(link, &nodes))
        .collect();
    let roots = graph
        .roots
        .iter()
        .filter(|root| node_ids.contains(*root))
        .cloned()
        .collect();
    NetworkGraph {
        nodes,
        links,
        notes: graph.notes.iter().cloned().map(sanitize_note).collect(),
        roots,
    }
}

fn sanitize_node(mut node: NetworkNode) -> NetworkNode {
    node.icon_background_color = node
        .icon_background_color
        .take()
        .and_then(sanitize_hex_color);
    if node.interfaces.is_empty() {
        if node.addresses.is_empty() {
            node.addresses
                .push(std::mem::take(&mut node.legacy_address));
        }
        node.interfaces = node
            .addresses
            .drain(..)
            .filter_map(non_empty)
            .enumerate()
            .map(|(index, address)| NetworkNodeInterface {
                id: format!("{}-interface-{index}", node.id),
                name: String::new(),
                address,
            })
            .collect();
    }
    node.addresses.clear();
    node.legacy_address.clear();
    let mut seen_ids = HashSet::new();
    let mut seen_values = HashSet::new();
    node.interfaces = node
        .interfaces
        .drain(..)
        .enumerate()
        .filter_map(|(index, mut interface)| {
            interface.name = interface.name.trim().to_string();
            interface.address = interface.address.trim().to_string();
            if interface.name.is_empty() && interface.address.is_empty() {
                return None;
            }
            let preferred = non_empty(interface.id);
            interface.id = unique_interface_id(&mut seen_ids, &node.id, index, preferred);
            seen_values
                .insert((interface.name.clone(), interface.address.clone()))
                .then_some(interface)
        })
        .take(32)
        .collect();
    node.icon_kind = if node.kind == NetworkNodeKind::Generic {
        match node.icon_kind {
            Some(NetworkNodeKind::Generic) | None => Some(NetworkNodeKind::Switch),
            selected => selected,
        }
    } else {
        None
    };
    let mut seen_deep_link_ids = HashSet::new();
    let mut seen_deep_link_targets = HashSet::new();
    node.deep_links = node
        .deep_links
        .drain(..)
        .enumerate()
        .filter_map(|(index, mut link)| {
            link.connection_id = link.connection_id.take().and_then(non_empty);
            link.site_id = link.site_id.take().and_then(non_empty);
            link.server_room = link.server_room.take().and_then(non_empty);
            link.rack_id = link.rack_id.take().and_then(non_empty);
            link.rack_item_id = link.rack_item_id.take().and_then(non_empty);
            let target = match link.kind {
                NetworkNodeDeepLinkKind::Connection => {
                    link.site_id = None;
                    link.server_room = None;
                    link.rack_id = None;
                    link.rack_item_id = None;
                    format!("connection:{}", link.connection_id.as_ref()?)
                }
                NetworkNodeDeepLinkKind::Site => {
                    link.connection_id = None;
                    link.server_room = None;
                    link.rack_id = None;
                    link.rack_item_id = None;
                    format!("site:{}", link.site_id.as_ref()?)
                }
                NetworkNodeDeepLinkKind::ServerRoom => {
                    link.connection_id = None;
                    link.rack_id = None;
                    link.rack_item_id = None;
                    format!(
                        "serverRoom:{}:{}",
                        link.site_id.as_ref()?,
                        link.server_room.as_ref()?
                    )
                }
                NetworkNodeDeepLinkKind::RackItem => {
                    link.connection_id = None;
                    link.server_room = None;
                    format!(
                        "rackItem:{}:{}:{}",
                        link.site_id.as_ref()?,
                        link.rack_id.as_ref()?,
                        link.rack_item_id.as_ref()?
                    )
                }
            };
            if !seen_deep_link_targets.insert(target) {
                return None;
            }
            link.id =
                unique_deep_link_id(&mut seen_deep_link_ids, &node.id, index, non_empty(link.id));
            Some(link)
        })
        .take(32)
        .collect();
    if node.kind == NetworkNodeKind::Geomap {
        node.shape = NetworkNodeShape::Rectangle;
        node.width = node.width.max(120.0);
        node.height = node.height.max(44.0);
    } else {
        node.width = node.width.clamp(120.0, MAX_NODE_DIMENSION);
        node.height = node.height.clamp(44.0, MAX_NODE_DIMENSION);
        if node.shape != NetworkNodeShape::Rectangle {
            let size = node.width.max(node.height);
            node.width = size;
            node.height = size;
        }
    }
    node.geomap_viewport = if node.kind == NetworkNodeKind::Geomap {
        let mut viewport = node
            .geomap_viewport
            .unwrap_or(NetworkGeomapViewport {
                zoom: 1.0,
                x: 50.0,
                y: 50.0,
            });
        viewport.zoom = finite_or(viewport.zoom, 1.0).clamp(1.0, 4.0);
        viewport.x = finite_or(viewport.x, 50.0).clamp(0.0, 100.0);
        viewport.y = finite_or(viewport.y, 50.0).clamp(0.0, 100.0);
        Some(viewport)
    } else {
        None
    };
    node
}

fn finite_or(value: f64, fallback: f64) -> f64 {
    value.is_finite().then_some(value).unwrap_or(fallback)
}

fn sanitize_hex_color(value: String) -> Option<String> {
    let value = value.trim();
    if value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        Some(value.to_ascii_lowercase())
    } else {
        None
    }
}

fn sanitize_note(mut note: NetworkMapNote) -> NetworkMapNote {
    note.text = note.text.trim().to_string();
    note.width = note.width.clamp(180.0, 600.0);
    note.height = note.height.clamp(90.0, 400.0);
    note.background_color = note.background_color.take().and_then(sanitize_hex_color);
    note
}

fn sanitize_link(mut link: NetworkLink, nodes: &[NetworkNode]) -> NetworkLink {
    link.strands = migrate_strands(&link);
    let from_interfaces = nodes
        .iter()
        .find(|node| node.id == link.from)
        .map(|node| node.interfaces.as_slice())
        .unwrap_or_default();
    let to_interfaces = nodes
        .iter()
        .find(|node| node.id == link.to)
        .map(|node| node.interfaces.as_slice())
        .unwrap_or_default();
    for strand in &mut link.strands {
        strand.from_interface_id = strand
            .from_interface_id
            .take()
            .and_then(non_empty)
            .filter(|id| from_interfaces.iter().any(|interface| interface.id == *id));
        strand.to_interface_id = strand
            .to_interface_id
            .take()
            .and_then(non_empty)
            .filter(|id| to_interfaces.iter().any(|interface| interface.id == *id));
    }
    if let Some(first) = link.strands.first_mut() {
        if first.from_interface_id.is_none() {
            first.from_interface_id = link
                .from_address
                .take()
                .and_then(non_empty)
                .and_then(|address| {
                    from_interfaces
                        .iter()
                        .find(|interface| interface.address == address)
                        .map(|interface| interface.id.clone())
                });
        }
        if first.to_interface_id.is_none() {
            first.to_interface_id = link
                .to_address
                .take()
                .and_then(non_empty)
                .and_then(|address| {
                    to_interfaces
                        .iter()
                        .find(|interface| interface.address == address)
                        .map(|interface| interface.id.clone())
                });
        }
    }
    link.from_address = None;
    link.to_address = None;
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
    let mut seen_ids = HashSet::new();
    let mut strands: Vec<NetworkLinkStrand> = link
        .strands
        .iter()
        .take(MAX_STRANDS)
        .enumerate()
        .map(|(index, strand)| NetworkLinkStrand {
            id: unique_strand_id(&mut seen_ids, &link.id, index, non_empty(strand.id.clone())),
            name: strand.name.trim().to_string(),
            from_interface_id: strand.from_interface_id.clone(),
            to_interface_id: strand.to_interface_id.clone(),
            speed: strand.speed.trim().to_string(),
        })
        .collect();
    if strands.is_empty() {
        let legacy_speed = link.speed.clone().unwrap_or_default().trim().to_string();
        let count = usize::from(link.connection_count.unwrap_or(1)).clamp(1, MAX_STRANDS);
        strands = (0..count)
            .map(|index| NetworkLinkStrand {
                id: unique_strand_id(&mut seen_ids, &link.id, index, None),
                // The pre-strand model had one speed for the whole bundle and
                // no per-member port names, so every member inherits it.
                name: String::new(),
                from_interface_id: None,
                to_interface_id: None,
                speed: legacy_speed.clone(),
            })
            .collect();
    }
    strands
}

fn unique_interface_id(
    seen: &mut HashSet<String>,
    node_id: &str,
    index: usize,
    preferred: Option<String>,
) -> String {
    if let Some(id) = preferred
        && seen.insert(id.clone())
    {
        return id;
    }
    let base = format!("{node_id}-interface-{index}");
    if seen.insert(base.clone()) {
        return base;
    }
    for suffix in 2.. {
        let candidate = format!("{base}-{suffix}");
        if seen.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!()
}

fn unique_strand_id(
    seen: &mut HashSet<String>,
    link_id: &str,
    index: usize,
    preferred: Option<String>,
) -> String {
    if let Some(id) = preferred
        && seen.insert(id.clone())
    {
        return id;
    }
    let base = format!("{link_id}-strand-{index}");
    if seen.insert(base.clone()) {
        return base;
    }
    for suffix in 2.. {
        let candidate = format!("{base}-{suffix}");
        if seen.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!("the numeric suffix always yields another candidate")
}

fn unique_deep_link_id(
    seen: &mut HashSet<String>,
    node_id: &str,
    index: usize,
    preferred: Option<String>,
) -> String {
    if let Some(id) = preferred
        && seen.insert(id.clone())
    {
        return id;
    }
    let base = format!("{node_id}-deep-link-{index}");
    if seen.insert(base.clone()) {
        return base;
    }
    for suffix in 2.. {
        let candidate = format!("{base}-{suffix}");
        if seen.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!("the numeric suffix always yields another candidate")
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
        params![name, description, site_id, graph_to_json(&graph)?, id],
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
        NetworkGeomapViewport, NetworkLinkKind, NetworkLinkStatus, NetworkLinkStrandDisplay,
        NetworkMapNote, NetworkNode, NetworkNodeDeepLink, NetworkNodeDeepLinkKind, NetworkNodeKind,
        NetworkNodeShape,
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
            ..NetworkLinkStrand::default()
        }
    }

    #[test]
    fn round_trips_a_graph_and_drops_dangling_links() {
        let conn = open_test_db();
        let mut primary_link = link("l1", "core", "edge");
        primary_link.strands = vec![
            strand("s1", " Gi1/0/1 ", " 10 Gbps "),
            strand("s1", "Gi1/0/2", "10 Gbps"),
            strand("", "Gi1/0/3", "10 Gbps"),
        ];
        primary_link.native_vlan_id = Some(" vlan-10 ".to_string());
        primary_link.tagged_vlan_ids = vec![
            "vlan-20".into(),
            "vlan-20".into(),
            " ".into(),
            "vlan-10".into(),
        ];
        primary_link.strands[0].from_interface_id = Some("core-uplink".into());
        primary_link.strands[0].to_interface_id = Some("edge-uplink".into());
        primary_link.strands[1].from_interface_id = Some("missing".into());
        primary_link.status = NetworkLinkStatus::Warning;
        primary_link.strand_display = NetworkLinkStrandDisplay::Bundle;
        let mut core = node("core");
        core.shape = NetworkNodeShape::Diamond;
        core.interfaces = vec![
            NetworkNodeInterface {
                id: "core-uplink".into(),
                name: " Gi1/0/1 ".into(),
                address: " 10.20.0.1 ".into(),
            },
            NetworkNodeInterface {
                id: "core-uplink".into(),
                name: "Gi1/0/2".into(),
                address: "2001:db8::1".into(),
            },
        ];
        core.width = 500.0;
        core.height = 40.0;
        let mut edge = node("edge");
        edge.interfaces = vec![NetworkNodeInterface {
            id: "edge-uplink".into(),
            name: "eth0".into(),
            address: "10.20.0.2".into(),
        }];
        let graph = NetworkGraph {
            nodes: vec![core, edge],
            links: vec![
                primary_link,
                link("l2", "core", "ghost"),
                link("l3", "core", "core"),
            ],
            notes: vec![NetworkMapNote {
                id: "note-1".into(),
                text: " Maintenance boundary ".into(),
                width: 100.0,
                height: 800.0,
                background_color: Some(" #DDEEFF ".into()),
                locked: true,
                ..NetworkMapNote::default()
            }],
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
        let core_interfaces = &listed[0].graph.nodes[0].interfaces;
        assert_eq!(core_interfaces.len(), 2);
        assert_eq!(core_interfaces[0].id, "core-uplink");
        assert_eq!(core_interfaces[0].name, "Gi1/0/1");
        assert_eq!(core_interfaces[0].address, "10.20.0.1");
        assert_eq!(core_interfaces[1].id, "core-interface-1");
        assert_eq!(listed[0].graph.nodes[0].width, 500.0);
        assert_eq!(listed[0].graph.nodes[0].height, 500.0);
        assert_eq!(listed[0].graph.nodes[0].shape, NetworkNodeShape::Diamond);
        assert_eq!(listed[0].graph.notes[0].text, "Maintenance boundary");
        assert_eq!(listed[0].graph.notes[0].width, 180.0);
        assert_eq!(listed[0].graph.notes[0].height, 400.0);
        assert_eq!(
            listed[0].graph.notes[0].background_color.as_deref(),
            Some("#ddeeff")
        );
        assert!(listed[0].graph.notes[0].locked);
        let stored = &listed[0].graph.links[0];
        assert_eq!(stored.id, "l1");
        assert_eq!(stored.strands.len(), 3);
        assert_eq!(stored.strands[0].name, "Gi1/0/1");
        assert_eq!(stored.strands[0].speed, "10 Gbps");
        // Duplicate and blank strand ids are backfilled so React keys and edits
        // stay stable and one row can never patch or remove another.
        assert_eq!(stored.strands[1].id, "l1-strand-1");
        assert_eq!(stored.strands[2].id, "l1-strand-2");
        assert_eq!(
            stored.strand_display,
            NetworkLinkStrandDisplay::Bundle
        );
        assert_eq!(stored.native_vlan_id.as_deref(), Some("vlan-10"));
        // Blanks, duplicates, and the native VLAN drop out of the tagged set.
        assert_eq!(stored.tagged_vlan_ids, vec!["vlan-20".to_string()]);
        assert_eq!(
            stored.strands[0].from_interface_id.as_deref(),
            Some("core-uplink")
        );
        assert_eq!(
            stored.strands[0].to_interface_id.as_deref(),
            Some("edge-uplink")
        );
        assert!(stored.strands[1].from_interface_id.is_none());
        assert_eq!(stored.status, NetworkLinkStatus::Warning);
    }

    #[test]
    fn clamps_geomap_viewports_and_clears_them_from_other_nodes() {
        let mut map = node("map");
        map.kind = NetworkNodeKind::Geomap;
        map.shape = NetworkNodeShape::Circle;
        map.width = 2400.0;
        map.height = 1300.0;
        map.geomap_viewport = Some(NetworkGeomapViewport {
            zoom: 12.0,
            x: -20.0,
            y: 140.0,
        });
        let mut switch = node("switch");
        switch.geomap_viewport = Some(NetworkGeomapViewport {
            zoom: 2.0,
            x: 25.0,
            y: 75.0,
        });

        let sanitized = sanitize_graph(&NetworkGraph {
            nodes: vec![map, switch],
            ..NetworkGraph::default()
        });

        assert_eq!(
            sanitized.nodes[0].geomap_viewport,
            Some(NetworkGeomapViewport {
                zoom: 4.0,
                x: 0.0,
                y: 100.0,
            })
        );
        assert_eq!(sanitized.nodes[0].width, 2400.0);
        assert_eq!(sanitized.nodes[0].height, 1300.0);
        assert_eq!(sanitized.nodes[0].shape, NetworkNodeShape::Rectangle);
        assert!(sanitized.nodes[1].geomap_viewport.is_none());
    }

    #[test]
    fn keeps_generic_artwork_and_sanitizes_soft_deep_links() {
        let mut generic = node("generic");
        generic.kind = NetworkNodeKind::Generic;
        generic.icon_kind = Some(NetworkNodeKind::Generic);
        generic.icon_background_color = Some(" #AABBCC ".into());
        generic.locked = true;
        generic.deep_links = vec![
            NetworkNodeDeepLink {
                id: String::new(),
                kind: NetworkNodeDeepLinkKind::Connection,
                connection_id: Some(" connection-1 ".into()),
                site_id: Some("discarded".into()),
                server_room: None,
                rack_id: None,
                rack_item_id: None,
            },
            NetworkNodeDeepLink {
                id: "duplicate-target".into(),
                kind: NetworkNodeDeepLinkKind::Connection,
                connection_id: Some("connection-1".into()),
                site_id: None,
                server_room: None,
                rack_id: None,
                rack_item_id: None,
            },
            NetworkNodeDeepLink {
                id: "room-link".into(),
                kind: NetworkNodeDeepLinkKind::ServerRoom,
                connection_id: None,
                site_id: Some("site-1".into()),
                server_room: Some(" Room A ".into()),
                rack_id: Some("discarded".into()),
                rack_item_id: None,
            },
            NetworkNodeDeepLink {
                id: "invalid".into(),
                kind: NetworkNodeDeepLinkKind::RackItem,
                connection_id: None,
                site_id: Some("site-1".into()),
                server_room: None,
                rack_id: Some("rack-1".into()),
                rack_item_id: None,
            },
        ];
        let mut switch = node("switch");
        switch.icon_kind = Some(NetworkNodeKind::Router);
        switch.icon_background_color = Some("not-a-color".into());

        let sanitized = sanitize_graph(&NetworkGraph {
            nodes: vec![generic, switch],
            ..NetworkGraph::default()
        });
        let generic = &sanitized.nodes[0];
        assert_eq!(generic.icon_kind, Some(NetworkNodeKind::Switch));
        assert_eq!(generic.icon_background_color.as_deref(), Some("#aabbcc"));
        assert!(generic.locked);
        assert_eq!(generic.deep_links.len(), 2);
        assert_eq!(generic.deep_links[0].id, "generic-deep-link-0");
        assert_eq!(
            generic.deep_links[0].connection_id.as_deref(),
            Some("connection-1")
        );
        assert!(generic.deep_links[0].site_id.is_none());
        assert_eq!(generic.deep_links[1].server_room.as_deref(), Some("Room A"));
        assert!(generic.deep_links[1].rack_id.is_none());
        assert!(sanitized.nodes[1].icon_kind.is_none());
        assert!(sanitized.nodes[1].icon_background_color.is_none());
    }

    #[test]
    fn folds_pre_strand_links_into_strands() {
        let conn = open_test_db();
        conn.execute(
            "INSERT INTO itops_network_maps (id, name, sort_order, graph_json)
             VALUES ('map-1', 'Legacy', 0, ?)",
            [r#"{
                "nodes":[
                    {"id":"core","addresses":[" 10.0.0.1 "]},
                    {"id":"edge","addresses":["10.0.0.2"]},
                    {"id":"leaf"}
                ],
                "links":[
                    {
                        "id":"lag",
                        "from":"core",
                        "to":"edge",
                        "fromAddress":"10.0.0.1",
                        "toAddress":"10.0.0.2",
                        "connectionCount":3,
                        "speed":" 10 Gbps "
                    },
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
        assert_eq!(
            lag.strand_display,
            NetworkLinkStrandDisplay::Separate
        );
        // A link that never had a count still stands for one physical link.
        assert_eq!(loaded.graph.links[1].strands.len(), 1);
        assert_eq!(loaded.graph.nodes[0].width, 120.0);
        assert_eq!(loaded.graph.nodes[0].height, 44.0);
        assert_eq!(loaded.graph.nodes[0].interfaces.len(), 1);
        assert_eq!(loaded.graph.nodes[0].interfaces[0].address, "10.0.0.1");
        assert_eq!(
            lag.strands[0].from_interface_id.as_deref(),
            Some("core-interface-0")
        );
        assert_eq!(
            lag.strands[0].to_interface_id.as_deref(),
            Some("edge-interface-0")
        );

        // The legacy pair is never written back once folded in.
        update_map(&conn, "map-1", "Legacy", "", None, &loaded.graph).unwrap();
        let stored: String = conn
            .query_row("SELECT graph_json FROM itops_network_maps", [], |row| {
                row.get(0)
            })
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&stored).unwrap();
        let first = &value["links"][0];
        assert!(value["nodes"][0].get("address").is_none());
        assert!(value["nodes"][0].get("addresses").is_none());
        assert_eq!(value["nodes"][0]["interfaces"][0]["address"], "10.0.0.1");
        assert!(first.get("fromAddress").is_none());
        assert!(first.get("toAddress").is_none());
        assert!(first.get("connectionCount").is_none());
        assert!(first.get("speed").is_none());
        assert_eq!(
            first["strands"][0]["fromInterfaceId"],
            "core-interface-0"
        );
        assert_eq!(
            first["strands"][0]["toInterfaceId"],
            "edge-interface-0"
        );
        assert_eq!(first["strands"][0]["speed"], "10 Gbps");
        assert_eq!(first["strandDisplay"], "separate");
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
        assert_eq!(loaded.graph.nodes[0].shape, NetworkNodeShape::Rectangle);
    }
}

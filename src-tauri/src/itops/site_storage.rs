// Site topology storage (docs/SITE.md Phase B): CRUD for Racks and Rack Devices
// plus the pure U-span overlap/fit validator. Mirrors the conventions in
// `itops/storage.rs` (free functions over `&SqliteConnection`, JSON `TEXT` for
// non-relational fields, integer `sort_order`). Reuses `ItopsStorageError`.

use std::collections::HashMap;

use rusqlite::{Connection as SqliteConnection, OptionalExtension, Transaction, params};

use super::inventory::normalize_metadata;
use super::storage::ItopsStorageError;
use super::types::{
    Rack, RackFacingEntry, RackItem, RackItemKind, RackItemMetadata, RackMountFace,
    RackPlacementEntry, RoomObject, ServerRoom,
};
use crate::dashboard_storage::DashboardBackground;

type Result<T> = std::result::Result<T, ItopsStorageError>;

/// Hard ceiling on rack height so a single rack can't claim an absurd U count.
const MAX_RACK_HEIGHT_U: u32 = 100;
const MAX_RACK_DEPTH_MM: u32 = 5000;
/// Generous ceiling on a rack's power capacity (1 MW) — a sanity bound, not a
/// physical model.
const MAX_RACK_POWER_W: u32 = 1_000_000;
const ISO_FLOOR_COLORS: [&str; 5] = ["default", "concrete", "graphite", "green", "blue"];

// ── Pure placement validation ───────────────────────────────────────────────

/// A `[start_u, start_u + height_u)` half-open U span (1-based start) plus the
/// horizontal quarter-unit strip `[x_start, x_start + x_quarters)` the face
/// occupies, so fractional-width devices (e.g. two half-width modems) can
/// share one U row side by side. A full-width device spans `[0, 4)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start_u: u32,
    pub height_u: u32,
    pub x_start: u32,
    pub x_quarters: u32,
}

impl Span {
    /// Exclusive top edge: the first U *above* this item.
    fn end_exclusive(&self) -> u32 {
        self.start_u + self.height_u
    }
}

/// Horizontal quarter-unit strip a device face occupies, from its metadata:
/// full width is `(0, 4)`; "half"/"quarter" widths occupy 2/1 quarters
/// starting at `slot * width`.
fn metadata_x_span(metadata: &RackItemMetadata) -> (u32, u32) {
    let x_quarters = match metadata.width_fraction.as_deref() {
        Some("half") => 2,
        Some("quarter") => 1,
        _ => return (0, 4),
    };
    let slot = metadata.slot.unwrap_or(0).min(4 / x_quarters - 1);
    (slot * x_quarters, x_quarters)
}

/// Two spans overlap when they intersect on both the U axis and the
/// horizontal quarter-unit axis.
pub fn spans_overlap(a: Span, b: Span) -> bool {
    a.start_u < b.end_exclusive()
        && b.start_u < a.end_exclusive()
        && a.x_start < b.x_start + b.x_quarters
        && b.x_start < a.x_start + a.x_quarters
}

/// Validate that `candidate` is a legal placement in a rack of `rack_height_u`:
/// positive, in-bounds, and not overlapping any of `existing` (each tagged with
/// its item id so an update/move can exclude itself via `ignore_id`).
pub fn validate_placement(
    rack_height_u: u32,
    existing: &[(String, Span)],
    ignore_id: Option<&str>,
    candidate: Span,
) -> Result<()> {
    if candidate.start_u < 1 || candidate.height_u < 1 {
        return Err(ItopsStorageError::Validation(
            "rack item must start at U1 or higher and be at least 1U tall".to_string(),
        ));
    }
    // Top occupied U = start + height - 1; must fit within the rack.
    if candidate.start_u + candidate.height_u - 1 > rack_height_u {
        return Err(ItopsStorageError::Validation(format!(
            "rack item does not fit: it would occupy up to U{} in a {}U rack",
            candidate.start_u + candidate.height_u - 1,
            rack_height_u
        )));
    }
    for (id, span) in existing {
        if ignore_id == Some(id.as_str()) {
            continue;
        }
        if spans_overlap(candidate, *span) {
            return Err(ItopsStorageError::Validation(format!(
                "rack item overlaps an existing device at U{}",
                span.start_u
            )));
        }
    }
    Ok(())
}

/// Rack-top placement is deliberately narrow: only a Kuai Kuai package may
/// occupy the virtual position immediately above the cabinet. Everything else
/// continues through the ordinary in-cabinet U-span validator.
fn validate_item_placement(
    kind: RackItemKind,
    rack_height_u: u32,
    existing: &[(String, Span)],
    ignore_id: Option<&str>,
    candidate: Span,
) -> Result<()> {
    if candidate.start_u != rack_height_u + 1 {
        return validate_placement(rack_height_u, existing, ignore_id, candidate);
    }
    if kind != RackItemKind::Kuaiguai {
        return Err(ItopsStorageError::Validation(
            "only a Kuai Kuai package may be placed on top of a rack".to_string(),
        ));
    }
    if candidate.height_u < 1 {
        return Err(ItopsStorageError::Validation(
            "a rack-top Kuai Kuai package must be at least 1U tall".to_string(),
        ));
    }
    if existing
        .iter()
        .any(|(id, span)| ignore_id != Some(id.as_str()) && span.start_u == rack_height_u + 1)
    {
        return Err(ItopsStorageError::Validation(
            "the rack top already holds a Kuai Kuai package".to_string(),
        ));
    }
    Ok(())
}

// ── Serialization helpers ───────────────────────────────────────────────────

fn validate_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ItopsStorageError::Validation(
            "rack name must not be empty".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

fn validate_height(height_u: u32) -> Result<u32> {
    if !(1..=MAX_RACK_HEIGHT_U).contains(&height_u) {
        return Err(ItopsStorageError::Validation(format!(
            "rack height must be between 1 and {MAX_RACK_HEIGHT_U}U"
        )));
    }
    Ok(height_u)
}

fn validate_depth(depth_mm: u32) -> Result<u32> {
    if !(1..=MAX_RACK_DEPTH_MM).contains(&depth_mm) {
        return Err(ItopsStorageError::Validation(format!(
            "rack depth must be between 1 and {MAX_RACK_DEPTH_MM} mm"
        )));
    }
    Ok(depth_mm)
}

/// 0/None mean "capacity unset"; anything else must be a sane wattage.
fn validate_power_capacity(power_capacity_w: Option<u32>) -> Result<Option<u32>> {
    match power_capacity_w {
        None | Some(0) => Ok(None),
        Some(watts) if watts <= MAX_RACK_POWER_W => Ok(Some(watts)),
        Some(_) => Err(ItopsStorageError::Validation(format!(
            "rack power capacity must be at most {MAX_RACK_POWER_W} W"
        ))),
    }
}

pub fn list_server_rooms(conn: &SqliteConnection, site_id: &str) -> Result<Vec<ServerRoom>> {
    let mut statement = conn.prepare(
        "SELECT id, site_id, name, floor_color, sort_order FROM itops_server_rooms WHERE site_id = ? ORDER BY sort_order",
    )?;
    Ok(statement
        .query_map(params![site_id], |row| {
            Ok(ServerRoom {
                id: row.get(0)?,
                site_id: row.get(1)?,
                name: row.get(2)?,
                floor_color: row.get(3)?,
                sort_order: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn create_server_room(
    conn: &SqliteConnection,
    id: &str,
    site_id: &str,
    name: &str,
    floor_color: &str,
) -> Result<ServerRoom> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ItopsStorageError::Validation(
            "server room name must not be empty".to_string(),
        ));
    }
    let floor_color = validate_floor_color(floor_color)?;
    let next_sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_server_rooms WHERE site_id = ?",
        params![site_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO itops_server_rooms (id, site_id, name, floor_color, sort_order) VALUES (?, ?, ?, ?, ?)",
        params![id, site_id, name, floor_color, next_sort],
    )?;
    Ok(ServerRoom {
        id: id.to_string(),
        site_id: site_id.to_string(),
        name: name.to_string(),
        floor_color,
        sort_order: next_sort,
    })
}

fn validate_floor_color(value: &str) -> Result<String> {
    let value = value.trim();
    if ISO_FLOOR_COLORS.contains(&value) {
        Ok(value.to_string())
    } else {
        Err(ItopsStorageError::Validation(
            "invalid server room floor color".to_string(),
        ))
    }
}

fn rename_json_map_key(
    raw: Option<String>,
    old_name: &str,
    new_name: &str,
) -> Result<Option<String>> {
    if old_name == new_name {
        return Ok(raw);
    }
    let Some(raw) = raw else {
        return Ok(None);
    };
    let Ok(mut map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&raw)
    else {
        return Ok(Some(raw));
    };
    if let Some(value) = map.remove(old_name) {
        map.insert(new_name.to_string(), value);
    }
    serde_json::to_string(&map)
        .map(Some)
        .map_err(|error| ItopsStorageError::Validation(error.to_string()))
}

fn remove_json_map_key(raw: Option<String>, name: &str) -> Result<Option<String>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let Ok(mut map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&raw)
    else {
        return Ok(Some(raw));
    };
    map.remove(name);
    serde_json::to_string(&map)
        .map(Some)
        .map_err(|error| ItopsStorageError::Validation(error.to_string()))
}

fn copy_json_map_key(
    raw: Option<String>,
    source_name: &str,
    duplicate_name: &str,
) -> Result<Option<String>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let Ok(mut map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&raw)
    else {
        return Ok(Some(raw));
    };
    if let Some(value) = map.get(source_name).cloned() {
        map.insert(duplicate_name.to_string(), value);
    }
    serde_json::to_string(&map)
        .map(Some)
        .map_err(|error| ItopsStorageError::Validation(error.to_string()))
}

/// Update first-class Server Room properties. Renames every name-keyed
/// dependent in one transaction so racks, fixtures, icons, and backgrounds
/// cannot split across two room names.
pub fn update_server_room(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    floor_color: &str,
) -> Result<ServerRoom> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ItopsStorageError::Validation(
            "server room name must not be empty".to_string(),
        ));
    }
    let floor_color = validate_floor_color(floor_color)?;
    let (site_id, old_name, sort_order): (String, String, i64) = conn
        .query_row(
            "SELECT site_id, name, sort_order FROM itops_server_rooms WHERE id = ?",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or(ItopsStorageError::NotFound)?;
    let duplicate: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM itops_server_rooms
            WHERE site_id = ? AND id <> ? AND name = ? COLLATE NOCASE
         )",
        params![site_id, id, name],
        |row| row.get(0),
    )?;
    if duplicate {
        return Err(ItopsStorageError::Validation(
            "a server room with that name already exists".to_string(),
        ));
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE itops_server_rooms
         SET name = ?, floor_color = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![name, floor_color, id],
    )?;
    if old_name != name {
        tx.execute(
            "UPDATE itops_site_racks SET server_room = ?, updated_at = CURRENT_TIMESTAMP
             WHERE site_id = ? AND server_room = ?",
            params![name, site_id, old_name],
        )?;
        tx.execute(
            "UPDATE itops_room_objects SET server_room = ?, updated_at = CURRENT_TIMESTAMP
             WHERE site_id = ? AND server_room = ?",
            params![name, site_id, old_name],
        )?;
        let metadata: Option<(Option<String>, Option<String>)> = tx
            .query_row(
                "SELECT room_backgrounds_json, room_icons_json FROM itops_sites WHERE id = ?",
                params![site_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((backgrounds, icons)) = metadata {
            tx.execute(
                "UPDATE itops_sites
                 SET room_backgrounds_json = ?, room_icons_json = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?",
                params![
                    rename_json_map_key(backgrounds, &old_name, name)?,
                    rename_json_map_key(icons, &old_name, name)?,
                    site_id
                ],
            )?;
        }
    }
    tx.commit()?;
    Ok(ServerRoom {
        id: id.to_string(),
        site_id,
        name: name.to_string(),
        floor_color,
        sort_order,
    })
}

pub fn delete_server_room(conn: &SqliteConnection, id: &str) -> Result<()> {
    // Room Objects are scoped by site + room name (like racks), so drop the
    // room's objects with it rather than leaving orphans behind the name.
    let room: Option<(String, String)> = conn
        .query_row(
            "SELECT site_id, name FROM itops_server_rooms WHERE id = ?",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((site_id, name)) = room else {
        return Err(ItopsStorageError::NotFound);
    };
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM itops_room_objects WHERE site_id = ? AND server_room = ?",
        params![site_id, name],
    )?;
    // Drop the room's racks too (their items cascade via the FK). The Rack
    // View delete flow removes racks itself before this call; the assistant /
    // MCP path relies on this so a deleted room cannot leave orphaned racks
    // whose name tag resurrects a ghost room grouping.
    tx.execute(
        "DELETE FROM itops_site_racks WHERE site_id = ? AND server_room = ?",
        params![site_id, name],
    )?;
    let metadata: Option<(Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT room_backgrounds_json, room_icons_json FROM itops_sites WHERE id = ?",
            params![site_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((backgrounds, icons)) = metadata {
        tx.execute(
            "UPDATE itops_sites
             SET room_backgrounds_json = ?, room_icons_json = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?",
            params![
                remove_json_map_key(backgrounds, &name)?,
                remove_json_map_key(icons, &name)?,
                site_id
            ],
        )?;
    }
    tx.execute("DELETE FROM itops_server_rooms WHERE id = ?", params![id])?;
    tx.commit()?;
    Ok(())
}

pub fn duplicate_server_room(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    floor_color: &str,
    mut new_id: impl FnMut(&str) -> String,
) -> Result<ServerRoom> {
    let source = conn
        .query_row(
            "SELECT id, site_id, name, floor_color, sort_order
             FROM itops_server_rooms WHERE id = ?",
            params![id],
            |row| {
                Ok(ServerRoom {
                    id: row.get(0)?,
                    site_id: row.get(1)?,
                    name: row.get(2)?,
                    floor_color: row.get(3)?,
                    sort_order: row.get(4)?,
                })
            },
        )
        .optional()?
        .ok_or(ItopsStorageError::NotFound)?;
    let duplicate_name = name.trim();
    if duplicate_name.is_empty() {
        return Err(ItopsStorageError::Validation(
            "server room name must not be empty".to_string(),
        ));
    }
    let duplicate: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM itops_server_rooms
            WHERE site_id = ? AND name = ? COLLATE NOCASE
         )",
        params![source.site_id, duplicate_name],
        |row| row.get(0),
    )?;
    if duplicate {
        return Err(ItopsStorageError::Validation(
            "a server room with that name already exists".to_string(),
        ));
    }
    let floor_color = validate_floor_color(floor_color)?;
    let source_racks = list_racks(conn, &source.site_id)?
        .into_iter()
        .filter(|rack| rack.server_room == source.name)
        .collect::<Vec<_>>();
    let source_objects = list_room_objects(conn, &source.site_id, &source.name)?;
    let metadata: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT room_backgrounds_json, room_icons_json FROM itops_sites WHERE id = ?",
            params![source.site_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let duplicate_id = new_id("room");
    let next_sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_server_rooms WHERE site_id = ?",
        params![source.site_id],
        |row| row.get(0),
    )?;

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO itops_server_rooms (id, site_id, name, floor_color, sort_order)
         VALUES (?, ?, ?, ?, ?)",
        params![
            duplicate_id,
            source.site_id,
            duplicate_name,
            floor_color,
            next_sort
        ],
    )?;
    for rack in &source_racks {
        insert_rack_clone(
            &tx,
            rack,
            &new_id("rack"),
            &rack.name,
            &duplicate_name,
            true,
            &mut new_id,
        )?;
    }
    for object in source_objects {
        tx.execute(
            "INSERT INTO itops_room_objects (id, site_id, server_room, kind, x, y, z, rot, corner)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                new_id("room-object"),
                source.site_id,
                duplicate_name,
                object.kind,
                object.x,
                object.y,
                object.z,
                object.rot,
                object.corner
            ],
        )?;
    }
    if let Some((backgrounds, icons)) = metadata {
        tx.execute(
            "UPDATE itops_sites
             SET room_backgrounds_json = ?, room_icons_json = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?",
            params![
                copy_json_map_key(backgrounds, &source.name, &duplicate_name)?,
                copy_json_map_key(icons, &source.name, &duplicate_name)?,
                source.site_id
            ],
        )?;
    }
    tx.commit()?;

    Ok(ServerRoom {
        id: duplicate_id,
        site_id: source.site_id,
        name: duplicate_name.to_string(),
        floor_color,
        sort_order: next_sort,
    })
}

fn validate_server_room(conn: &SqliteConnection, site_id: &str, name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ItopsStorageError::Validation(
            "rack must belong to a server room".to_string(),
        ));
    }
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM itops_server_rooms WHERE site_id = ? AND name = ? COLLATE NOCASE)",
        params![site_id, name], |row| row.get(0),
    )?;
    if !exists {
        return Err(ItopsStorageError::Validation(
            "server room does not belong to this site".to_string(),
        ));
    }
    Ok(name.to_string())
}

fn metadata_to_json(metadata: &RackItemMetadata) -> Result<String> {
    serde_json::to_string(&normalize_metadata(metadata.clone()))
        .map_err(|error| ItopsStorageError::Validation(error.to_string()))
}

fn normalize_item_metadata(kind: RackItemKind, metadata: RackItemMetadata) -> RackItemMetadata {
    let mut metadata = normalize_metadata(metadata);
    if !matches!(
        kind,
        RackItemKind::Switch | RackItemKind::Router | RackItemKind::GenericDevice
    ) {
        metadata.width_fraction = None;
        metadata.slot = None;
    }
    metadata
}

fn parse_metadata(kind: RackItemKind, raw: &str) -> RackItemMetadata {
    serde_json::from_str(raw)
        .map(|metadata| normalize_item_metadata(kind, metadata))
        .unwrap_or_default()
}

// ── Item reads ──────────────────────────────────────────────────────────────

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<RackItem> {
    let kind_raw: String = row.get(3)?;
    let kind = RackItemKind::from_db_str(&kind_raw).unwrap_or(RackItemKind::Blank);
    let metadata_json: String = row.get(8)?;
    Ok(RackItem {
        id: row.get(0)?,
        rack_id: row.get(1)?,
        connection_id: row.get(2)?,
        kind,
        label: row.get(4)?,
        start_u: row.get(5)?,
        height_u: row.get(6)?,
        mount_face: RackMountFace::from_db_str(&row.get::<_, String>(7)?),
        metadata: parse_metadata(kind, &metadata_json),
    })
}

const SELECT_ITEM_COLUMNS: &str = "id, rack_id, connection_id, kind, label, start_u, height_u, mount_face, metadata_json \
     FROM itops_site_rack_items";

fn list_items_for_rack(conn: &SqliteConnection, rack_id: &str) -> Result<Vec<RackItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_ITEM_COLUMNS} WHERE rack_id = ? ORDER BY start_u"
    ))?;
    let items = stmt
        .query_map(params![rack_id], row_to_item)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(items)
}

fn list_items_for_site(
    conn: &SqliteConnection,
    site_id: &str,
) -> Result<HashMap<String, Vec<RackItem>>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_ITEM_COLUMNS}
         WHERE rack_id IN (SELECT id FROM itops_site_racks WHERE site_id = ?)
         ORDER BY rack_id, start_u"
    ))?;
    let mut items_by_rack: HashMap<String, Vec<RackItem>> = HashMap::new();
    for item in stmt.query_map(params![site_id], row_to_item)? {
        let item = item?;
        items_by_rack
            .entry(item.rack_id.clone())
            .or_default()
            .push(item);
    }
    Ok(items_by_rack)
}

/// Existing spans in a rack, paired with their item ids (for overlap checks).
fn existing_spans(
    conn: &SqliteConnection,
    rack_id: &str,
    mount_face: RackMountFace,
    rack_height_u: u32,
) -> Result<Vec<(String, Span)>> {
    Ok(list_items_for_rack(conn, rack_id)?
        .into_iter()
        // Rack-top objects are face-independent; in-cabinet devices collide
        // only with other devices on the same mounting plane.
        .filter(|item| item.mount_face == mount_face || item.start_u == rack_height_u + 1)
        .map(|item| {
            let (x_start, x_quarters) = metadata_x_span(&item.metadata);
            (
                item.id,
                Span {
                    start_u: item.start_u,
                    height_u: item.height_u,
                    x_start,
                    x_quarters,
                },
            )
        })
        .collect())
}

fn fetch_rack_height(conn: &SqliteConnection, rack_id: &str) -> Result<u32> {
    conn.query_row(
        "SELECT height_u FROM itops_site_racks WHERE id = ?",
        params![rack_id],
        |row| row.get(0),
    )
    .optional()?
    .ok_or(ItopsStorageError::NotFound)
}

// ── Rack CRUD ───────────────────────────────────────────────────────────────

fn row_to_rack(row: &rusqlite::Row<'_>) -> rusqlite::Result<Rack> {
    let background: Option<String> = row.get(6)?;
    Ok(Rack {
        id: row.get(0)?,
        site_id: row.get(1)?,
        name: row.get(2)?,
        server_room: row.get(3)?,
        rack_group: row.get(4)?,
        shell: row.get(5)?,
        background: background.and_then(|json| serde_json::from_str(&json).ok()),
        height_u: row.get(7)?,
        depth_mm: row.get(8)?,
        sort_order: row.get(9)?,
        power_capacity_w: row.get(10)?,
        floor_x: row.get(11)?,
        floor_y: row.get(12)?,
        grid_x: row.get(13)?,
        grid_y: row.get(14)?,
        facing: row.get(15)?,
        items: Vec::new(),
    })
}

const SELECT_RACK_COLUMNS: &str = "id, site_id, name, server_room, rack_group, shell, \
     background_json, height_u, depth_mm, sort_order, power_capacity_w, \
     floor_x, floor_y, grid_x, grid_y, facing FROM itops_site_racks";

/// Normalize a shell choice to a stored value: blank/"black"/None → NULL (the
/// default), otherwise the trimmed colour name.
fn normalize_shell(shell: Option<&str>) -> Option<String> {
    match shell.map(str::trim) {
        Some(value) if !value.is_empty() && value != "black" => Some(value.to_string()),
        _ => None,
    }
}

/// Serialize a rack background for storage, validating first.
fn rack_background_to_json(background: &Option<DashboardBackground>) -> Result<Option<String>> {
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

/// All Racks in a Site, ordered by `sort_order`, each with its items hydrated.
pub fn list_racks(conn: &SqliteConnection, site_id: &str) -> Result<Vec<Rack>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_RACK_COLUMNS} WHERE site_id = ? ORDER BY sort_order"
    ))?;
    let mut racks = stmt
        .query_map(params![site_id], row_to_rack)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if racks.is_empty() {
        return Ok(racks);
    }
    let mut items_by_rack = list_items_for_site(conn, site_id)?;
    for rack in &mut racks {
        rack.items = items_by_rack.remove(&rack.id).unwrap_or_default();
    }
    Ok(racks)
}

#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
pub fn create_rack(
    conn: &SqliteConnection,
    id: &str,
    site_id: &str,
    name: &str,
    server_room: &str,
    rack_group: &str,
    shell: Option<&str>,
    height_u: u32,
    depth_mm: u32,
    power_capacity_w: Option<u32>,
) -> Result<Rack> {
    let name = validate_name(name)?;
    let server_room = validate_server_room(conn, site_id, server_room)?;
    let height_u = validate_height(height_u)?;
    let depth_mm = validate_depth(depth_mm)?;
    let power_capacity_w = validate_power_capacity(power_capacity_w)?;
    let shell = normalize_shell(shell);
    let next_sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_site_racks WHERE site_id = ?",
        params![site_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO itops_site_racks
            (id, site_id, name, server_room, rack_group, shell, height_u, depth_mm,
             power_capacity_w, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            site_id,
            name,
            server_room,
            rack_group.trim(),
            shell,
            height_u,
            depth_mm,
            power_capacity_w,
            next_sort
        ],
    )?;
    Ok(Rack {
        id: id.to_string(),
        site_id: site_id.to_string(),
        name,
        server_room,
        rack_group: rack_group.trim().to_string(),
        shell,
        background: None,
        height_u,
        depth_mm,
        power_capacity_w,
        floor_x: None,
        floor_y: None,
        grid_x: None,
        grid_y: None,
        facing: None,
        sort_order: next_sort,
        items: Vec::new(),
    })
}

/// Update a Rack's name/server-room/group/shell/height. Shrinking the height is
/// rejected if any existing item would no longer fit, so the layout never breaks.
#[allow(clippy::too_many_arguments)]
pub fn update_rack(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    server_room: &str,
    rack_group: &str,
    shell: Option<&str>,
    height_u: u32,
    depth_mm: u32,
    power_capacity_w: Option<u32>,
) -> Result<Rack> {
    let name = validate_name(name)?;
    let height_u = validate_height(height_u)?;
    let depth_mm = validate_depth(depth_mm)?;
    let power_capacity_w = validate_power_capacity(power_capacity_w)?;
    let shell = normalize_shell(shell);
    // Existence check (returns NotFound early before the height-shrink scan).
    let (site_id, _sort_order, old_height_u): (String, i64, u32) = conn
        .query_row(
            "SELECT site_id, sort_order, height_u FROM itops_site_racks WHERE id = ?",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or(ItopsStorageError::NotFound)?;
    let server_room = validate_server_room(conn, &site_id, server_room)?;
    for item in list_items_for_rack(conn, id)? {
        if item.kind == RackItemKind::Kuaiguai && item.start_u == old_height_u + 1 {
            continue;
        }
        if item.start_u + item.height_u - 1 > height_u {
            return Err(ItopsStorageError::Validation(format!(
                "cannot shrink to {height_u}U: an item occupies U{}",
                item.start_u + item.height_u - 1
            )));
        }
    }
    conn.execute(
        "UPDATE itops_site_racks
         SET name = ?, server_room = ?, rack_group = ?, shell = ?, height_u = ?, depth_mm = ?,
             power_capacity_w = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![
            name,
            server_room,
            rack_group.trim(),
            shell,
            height_u,
            depth_mm,
            power_capacity_w,
            id
        ],
    )?;
    if old_height_u != height_u {
        conn.execute(
            "UPDATE itops_site_rack_items
             SET start_u = ?, updated_at = CURRENT_TIMESTAMP
             WHERE rack_id = ? AND kind = 'kuaiguai' AND start_u = ?",
            params![height_u + 1, id, old_height_u + 1],
        )?;
    }
    fetch_rack(conn, id)
}

/// Re-read one Rack by id (with items hydrated), preserving fields a partial
/// update does not touch (e.g. background).
fn fetch_rack(conn: &SqliteConnection, id: &str) -> Result<Rack> {
    let mut rack = conn
        .query_row(
            &format!("SELECT {SELECT_RACK_COLUMNS} WHERE id = ?"),
            params![id],
            row_to_rack,
        )
        .optional()?
        .ok_or(ItopsStorageError::NotFound)?;
    rack.items = list_items_for_rack(conn, id)?;
    Ok(rack)
}

/// Set (or clear) the single-rack stage background.
pub fn set_rack_background(
    conn: &SqliteConnection,
    id: &str,
    background: Option<DashboardBackground>,
) -> Result<Rack> {
    let json = rack_background_to_json(&background)?;
    let affected = conn.execute(
        "UPDATE itops_site_racks SET background_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params![json, id],
    )?;
    if affected == 0 {
        return Err(ItopsStorageError::NotFound);
    }
    fetch_rack(conn, id)
}

pub fn delete_rack(conn: &SqliteConnection, id: &str) -> Result<()> {
    // Items cascade via the FK ON DELETE CASCADE.
    let affected = conn.execute("DELETE FROM itops_site_racks WHERE id = ?", params![id])?;
    if affected == 0 {
        return Err(ItopsStorageError::NotFound);
    }
    Ok(())
}

fn insert_rack_clone(
    tx: &Transaction<'_>,
    source: &Rack,
    duplicate_id: &str,
    duplicate_name: &str,
    server_room: &str,
    preserve_placement: bool,
    new_id: &mut impl FnMut(&str) -> String,
) -> Result<()> {
    let next_sort: i64 = tx.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_site_racks WHERE site_id = ?",
        params![source.site_id],
        |row| row.get(0),
    )?;
    let background_json = rack_background_to_json(&source.background)?;
    tx.execute(
        "INSERT INTO itops_site_racks
            (id, site_id, name, server_room, rack_group, shell, background_json, height_u,
             depth_mm, power_capacity_w, floor_x, floor_y, grid_x, grid_y, facing, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            duplicate_id,
            source.site_id,
            duplicate_name,
            server_room,
            source.rack_group,
            source.shell,
            background_json,
            source.height_u,
            source.depth_mm,
            source.power_capacity_w,
            preserve_placement.then_some(source.floor_x).flatten(),
            preserve_placement.then_some(source.floor_y).flatten(),
            preserve_placement.then_some(source.grid_x).flatten(),
            preserve_placement.then_some(source.grid_y).flatten(),
            preserve_placement.then_some(source.facing).flatten(),
            next_sort
        ],
    )?;
    for item in &source.items {
        tx.execute(
            "INSERT INTO itops_site_rack_items
                (id, rack_id, connection_id, kind, label, start_u, height_u, mount_face, metadata_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                new_id("ri"),
                duplicate_id,
                item.connection_id,
                item.kind.as_db_str(),
                item.label,
                item.start_u,
                item.height_u,
                item.mount_face.as_db_str(),
                metadata_to_json(&item.metadata)?
            ],
        )?;
    }
    Ok(())
}

pub fn duplicate_rack(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    server_room: &str,
    rack_group: &str,
    shell: Option<&str>,
    height_u: u32,
    depth_mm: u32,
    power_capacity_w: Option<u32>,
    grid_x: Option<i64>,
    grid_y: Option<i64>,
    facing: Option<i64>,
    mut new_id: impl FnMut(&str) -> String,
) -> Result<Rack> {
    let placement = match (grid_x, grid_y, facing) {
        (None, None, None) => None,
        (Some(x), Some(y), Some(facing)) if x >= 0 && y >= 0 && (0..=3).contains(&facing) => {
            Some((x, y, facing))
        }
        (Some(_), Some(_), Some(facing)) if !(0..=3).contains(&facing) => {
            return Err(ItopsStorageError::Validation(format!(
                "rack facing must be 0..=3, got {facing}"
            )));
        }
        (Some(x), Some(y), Some(_)) => {
            return Err(ItopsStorageError::Validation(format!(
                "rack grid coordinates must be non-negative, got ({x}, {y})"
            )));
        }
        _ => {
            return Err(ItopsStorageError::Validation(
                "rack clone placement requires grid_x, grid_y, and facing together".to_string(),
            ));
        }
    };
    let mut source = fetch_rack(conn, id)?;
    let old_height_u = source.height_u;
    source.name = validate_name(name)?;
    source.server_room = validate_server_room(conn, &source.site_id, server_room)?;
    source.rack_group = rack_group.trim().to_string();
    source.shell = normalize_shell(shell);
    source.height_u = validate_height(height_u)?;
    source.depth_mm = validate_depth(depth_mm)?;
    source.power_capacity_w = validate_power_capacity(power_capacity_w)?;
    for item in &mut source.items {
        if item.kind == RackItemKind::Kuaiguai && item.start_u == old_height_u + 1 {
            item.start_u = source.height_u + 1;
            continue;
        }
        if item.start_u + item.height_u - 1 > source.height_u {
            return Err(ItopsStorageError::Validation(format!(
                "cannot shrink to {}U: an item occupies U{}",
                source.height_u,
                item.start_u + item.height_u - 1
            )));
        }
    }
    let duplicate_id = new_id("rack");
    let tx = conn.unchecked_transaction()?;
    insert_rack_clone(
        &tx,
        &source,
        &duplicate_id,
        &source.name,
        &source.server_room,
        false,
        &mut new_id,
    )?;
    if let Some((grid_x, grid_y, facing)) = placement {
        tx.execute(
            "UPDATE itops_site_racks SET grid_x = ?, grid_y = ?, facing = ? WHERE id = ?",
            params![grid_x, grid_y, facing, duplicate_id],
        )?;
    }
    tx.commit()?;
    fetch_rack(conn, &duplicate_id)
}

pub fn reorder_racks(conn: &SqliteConnection, site_id: &str, ordered_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let mut statement =
        tx.prepare("UPDATE itops_site_racks SET sort_order = ? WHERE id = ? AND site_id = ?")?;
    for (index, id) in ordered_ids.iter().enumerate() {
        statement.execute(params![index as i64, id, site_id])?;
    }
    drop(statement);
    tx.commit()?;
    Ok(())
}

/// Which Server Room View layout a placement update targets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RackPlacementKind {
    /// Top-down floor plan free position, px.
    Floor,
    /// 2.5D view floor grid cell (col/row), rounded and clamped to >= 0.
    Grid,
}

impl RackPlacementKind {
    pub fn from_str(value: &str) -> Result<Self> {
        match value {
            "floor" => Ok(RackPlacementKind::Floor),
            "grid" => Ok(RackPlacementKind::Grid),
            other => Err(ItopsStorageError::Validation(format!(
                "unknown rack placement kind: {other}"
            ))),
        }
    }
}

/// Persist Server Room View placements for a batch of racks (a drag can move
/// two cabinets at once when they swap tiles). Ids that no longer exist are
/// skipped: a rack deleted mid-drag must not fail the rest of the batch.
pub fn set_rack_placements(
    conn: &SqliteConnection,
    kind: RackPlacementKind,
    entries: &[RackPlacementEntry],
) -> Result<()> {
    for entry in entries {
        if !entry.x.is_finite() || !entry.y.is_finite() {
            return Err(ItopsStorageError::Validation(
                "rack placement coordinates must be finite".to_string(),
            ));
        }
    }
    let tx = conn.unchecked_transaction()?;
    match kind {
        RackPlacementKind::Floor => {
            let mut statement = tx.prepare(
                "UPDATE itops_site_racks
                 SET floor_x = ?, floor_y = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?",
            )?;
            for entry in entries {
                statement.execute(params![entry.x.max(0.0), entry.y.max(0.0), entry.id])?;
            }
        }
        RackPlacementKind::Grid => {
            let mut statement = tx.prepare(
                "UPDATE itops_site_racks
                 SET grid_x = ?, grid_y = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?",
            )?;
            for entry in entries {
                statement.execute(params![
                    entry.x.round().max(0.0) as i64,
                    entry.y.round().max(0.0) as i64,
                    entry.id
                ])?;
            }
        }
    }
    tx.commit()?;
    Ok(())
}

/// Persist quarter-turn facings for a batch of racks. Like placements, ids
/// that no longer exist are skipped so a rack deleted mid-edit doesn't fail
/// the rest of the batch.
pub fn set_rack_facings(conn: &SqliteConnection, entries: &[RackFacingEntry]) -> Result<()> {
    for entry in entries {
        if !(0..=3).contains(&entry.facing) {
            return Err(ItopsStorageError::Validation(format!(
                "rack facing must be 0..=3, got {}",
                entry.facing
            )));
        }
    }
    let tx = conn.unchecked_transaction()?;
    let mut statement = tx.prepare(
        "UPDATE itops_site_racks
         SET facing = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
    )?;
    for entry in entries {
        statement.execute(params![entry.facing, entry.id])?;
    }
    drop(statement);
    tx.commit()?;
    Ok(())
}

// ── Room objects (docs/SITE.md Room Object) ─────────────────────────────────

/// The finite set of Room Object kinds the frontend can place. Kept in sync
/// with `ROOM_OBJECT_KINDS` in `src/modules/itops/roomObjects.ts`.
const ROOM_OBJECT_KINDS: &[&str] = &[
    "camera",
    "aircon",
    "fireExtinguisher",
    "ups",
    "sensor",
    "smokeDetector",
    "crashCart",
    "wall",
    "kuaikuai",
];

/// Sanity bound matching ROOM_CEILING_U in roomObjects.ts (an object's bottom
/// can never start at or above the ceiling).
const MAX_ROOM_OBJECT_Z: i64 = 58;
/// Bound on a room's object count so a replace-all write stays sane.
const MAX_ROOM_OBJECTS: usize = 512;

fn validate_room_object(object: &RoomObject) -> Result<()> {
    if object.id.trim().is_empty() {
        return Err(ItopsStorageError::Validation(
            "room object id must not be empty".to_string(),
        ));
    }
    if !ROOM_OBJECT_KINDS.contains(&object.kind.as_str()) {
        return Err(ItopsStorageError::Validation(format!(
            "unknown room object kind: {}",
            object.kind
        )));
    }
    if object.x < 0 || object.y < 0 {
        return Err(ItopsStorageError::Validation(
            "room object cell must not be negative".to_string(),
        ));
    }
    if !(0..MAX_ROOM_OBJECT_Z).contains(&object.z) {
        return Err(ItopsStorageError::Validation(format!(
            "room object level must be 0..{MAX_ROOM_OBJECT_Z}, got {}",
            object.z
        )));
    }
    if !(0..=3).contains(&object.rot) {
        return Err(ItopsStorageError::Validation(format!(
            "room object rotation must be 0..=3, got {}",
            object.rot
        )));
    }
    if let Some(corner) = object.corner {
        if !(0..=3).contains(&corner) {
            return Err(ItopsStorageError::Validation(format!(
                "room object corner must be 0..=3, got {corner}"
            )));
        }
    }
    Ok(())
}

/// All Room Objects of one Server Room (matched by name, like racks).
pub fn list_room_objects(
    conn: &SqliteConnection,
    site_id: &str,
    server_room: &str,
) -> Result<Vec<RoomObject>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, x, y, z, rot, corner FROM itops_room_objects
         WHERE site_id = ? AND server_room = ? ORDER BY created_at, id",
    )?;
    Ok(stmt
        .query_map(params![site_id, server_room.trim()], |row| {
            Ok(RoomObject {
                id: row.get(0)?,
                kind: row.get(1)?,
                x: row.get(2)?,
                y: row.get(3)?,
                z: row.get(4)?,
                rot: row.get(5)?,
                corner: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Replace one Server Room's Room Objects in a single transaction. The layout
/// is small and edited as a whole (place/drag/rotate/level/delete all rewrite
/// the set), so replace-all keeps the storage as simple as the placement
/// writes above.
pub fn set_room_objects(
    conn: &SqliteConnection,
    site_id: &str,
    server_room: &str,
    objects: &[RoomObject],
) -> Result<()> {
    if objects.len() > MAX_ROOM_OBJECTS {
        return Err(ItopsStorageError::Validation(format!(
            "too many room objects (max {MAX_ROOM_OBJECTS})"
        )));
    }
    for object in objects {
        validate_room_object(object)?;
    }
    let server_room = server_room.trim();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM itops_room_objects WHERE site_id = ? AND server_room = ?",
        params![site_id, server_room],
    )?;
    let mut statement = tx.prepare(
        "INSERT INTO itops_room_objects (id, site_id, server_room, kind, x, y, z, rot, corner)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )?;
    for object in objects {
        statement.execute(params![
            object.id,
            site_id,
            server_room,
            object.kind,
            object.x,
            object.y,
            object.z,
            object.rot,
            object.corner
        ])?;
    }
    drop(statement);
    tx.commit()?;
    Ok(())
}

// ── Rack Device CRUD ────────────────────────────────────────────────────────

/// Validate that a Connection-backed item carries a connection id, and passive
/// items do not masquerade as openable.
fn normalize_item_connection(
    kind: RackItemKind,
    connection_id: Option<String>,
) -> Result<Option<String>> {
    match (kind, connection_id) {
        (RackItemKind::Connection, Some(connection_id)) if !connection_id.trim().is_empty() => {
            Ok(Some(connection_id))
        }
        (RackItemKind::Connection, _) => Err(ItopsStorageError::Validation(
            "a connection rack item requires a connectionId".to_string(),
        )),
        _ => Ok(None),
    }
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub fn place_rack_item(
    conn: &SqliteConnection,
    id: &str,
    rack_id: &str,
    connection_id: Option<String>,
    kind: RackItemKind,
    label: &str,
    start_u: u32,
    height_u: u32,
    metadata: RackItemMetadata,
) -> Result<RackItem> {
    place_rack_item_on_face(
        conn,
        id,
        rack_id,
        connection_id,
        kind,
        label,
        start_u,
        height_u,
        RackMountFace::Front,
        metadata,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn place_rack_item_on_face(
    conn: &SqliteConnection,
    id: &str,
    rack_id: &str,
    connection_id: Option<String>,
    kind: RackItemKind,
    label: &str,
    start_u: u32,
    height_u: u32,
    mount_face: RackMountFace,
    metadata: RackItemMetadata,
) -> Result<RackItem> {
    let connection_id = normalize_item_connection(kind, connection_id)?;
    let metadata = normalize_item_metadata(kind, metadata);
    let rack_height = fetch_rack_height(conn, rack_id)?;
    let existing = existing_spans(conn, rack_id, mount_face, rack_height)?;
    let (x_start, x_quarters) = metadata_x_span(&metadata);
    validate_item_placement(
        kind,
        rack_height,
        &existing,
        None,
        Span {
            start_u,
            height_u,
            x_start,
            x_quarters,
        },
    )?;
    let metadata_json = metadata_to_json(&metadata)?;
    conn.execute(
        "INSERT INTO itops_site_rack_items
            (id, rack_id, connection_id, kind, label, start_u, height_u, mount_face, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            rack_id,
            connection_id,
            kind.as_db_str(),
            label.trim(),
            start_u,
            height_u,
            mount_face.as_db_str(),
            metadata_json
        ],
    )?;
    Ok(RackItem {
        id: id.to_string(),
        rack_id: rack_id.to_string(),
        connection_id,
        kind,
        label: label.trim().to_string(),
        start_u,
        height_u,
        mount_face,
        metadata,
    })
}

/// Update a Rack Device's properties and, when supplied by the properties
/// editor, its final U span in one validated database write.
pub fn update_rack_item(
    conn: &SqliteConnection,
    id: &str,
    kind: RackItemKind,
    connection_id: Option<String>,
    label: &str,
    metadata: RackItemMetadata,
    placement: Option<(u32, u32)>,
) -> Result<RackItem> {
    update_rack_item_on_face(
        conn,
        id,
        kind,
        connection_id,
        label,
        metadata,
        placement,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn update_rack_item_on_face(
    conn: &SqliteConnection,
    id: &str,
    kind: RackItemKind,
    connection_id: Option<String>,
    label: &str,
    metadata: RackItemMetadata,
    placement: Option<(u32, u32)>,
    mount_face: Option<RackMountFace>,
) -> Result<RackItem> {
    let current = fetch_item(conn, id)?;
    let mount_face = mount_face.unwrap_or(current.mount_face);
    let rack_height = fetch_rack_height(conn, &current.rack_id)?;
    if current.start_u == rack_height + 1 && kind != RackItemKind::Kuaiguai {
        return Err(ItopsStorageError::Validation(
            "move a rack-top Kuai Kuai package inside the cabinet before changing its type"
                .to_string(),
        ));
    }
    let connection_id = normalize_item_connection(kind, connection_id)?;
    let metadata = normalize_item_metadata(kind, metadata);
    let (start_u, height_u) = placement.unwrap_or((current.start_u, current.height_u));
    // Width/slot and height changes alter the final footprint: validate the
    // combined state before storing any part of the edit.
    let (x_start, x_quarters) = metadata_x_span(&metadata);
    let existing = existing_spans(conn, &current.rack_id, mount_face, rack_height)?;
    validate_item_placement(
        kind,
        rack_height,
        &existing,
        Some(id),
        Span {
            start_u,
            height_u,
            x_start,
            x_quarters,
        },
    )?;
    let metadata_json = metadata_to_json(&metadata)?;
    let affected = conn.execute(
        "UPDATE itops_site_rack_items
         SET kind = ?, connection_id = ?, label = ?, start_u = ?, height_u = ?,
             mount_face = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![
            kind.as_db_str(),
            connection_id,
            label.trim(),
            start_u,
            height_u,
            mount_face.as_db_str(),
            metadata_json,
            id
        ],
    )?;
    if affected == 0 {
        return Err(ItopsStorageError::NotFound);
    }
    fetch_item(conn, id)
}

/// Move and/or resize a Rack Device — possibly into a different Rack. Re-validates
/// the placement against the target rack (excluding this item). `slot` moves a
/// fractional-width device to another horizontal slot in the same call; None
/// keeps the stored slot (and is ignored for full-width devices).
#[cfg(test)]
pub fn move_rack_item(
    conn: &SqliteConnection,
    id: &str,
    rack_id: &str,
    start_u: u32,
    height_u: u32,
    slot: Option<u32>,
) -> Result<RackItem> {
    move_rack_item_to_face(conn, id, rack_id, start_u, height_u, slot, None)
}

pub fn move_rack_item_to_face(
    conn: &SqliteConnection,
    id: &str,
    rack_id: &str,
    start_u: u32,
    height_u: u32,
    slot: Option<u32>,
    mount_face: Option<RackMountFace>,
) -> Result<RackItem> {
    let current = fetch_item(conn, id)?;
    let mount_face = mount_face.unwrap_or(current.mount_face);
    let mut metadata = current.metadata.clone();
    if slot.is_some() && metadata.width_fraction.is_some() {
        metadata.slot = slot;
        metadata = normalize_metadata(metadata);
    }
    let rack_height = fetch_rack_height(conn, rack_id)?;
    let existing = existing_spans(conn, rack_id, mount_face, rack_height)?;
    let (x_start, x_quarters) = metadata_x_span(&metadata);
    validate_item_placement(
        current.kind,
        rack_height,
        &existing,
        Some(id),
        Span {
            start_u,
            height_u,
            x_start,
            x_quarters,
        },
    )?;
    let metadata_json = metadata_to_json(&metadata)?;
    let affected = conn.execute(
        "UPDATE itops_site_rack_items
         SET rack_id = ?, start_u = ?, height_u = ?, mount_face = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![rack_id, start_u, height_u, mount_face.as_db_str(), metadata_json, id],
    )?;
    if affected == 0 {
        return Err(ItopsStorageError::NotFound);
    }
    fetch_item(conn, id)
}

pub fn remove_rack_item(conn: &SqliteConnection, id: &str) -> Result<()> {
    let affected = conn.execute(
        "DELETE FROM itops_site_rack_items WHERE id = ?",
        params![id],
    )?;
    if affected == 0 {
        return Err(ItopsStorageError::NotFound);
    }
    Ok(())
}

fn fetch_item(conn: &SqliteConnection, id: &str) -> Result<RackItem> {
    conn.query_row(
        &format!("SELECT {SELECT_ITEM_COLUMNS} WHERE id = ?"),
        params![id],
        row_to_item,
    )
    .optional()?
    .ok_or(ItopsStorageError::NotFound)
}

pub fn get_rack_item(conn: &SqliteConnection, id: &str) -> Result<RackItem> {
    fetch_item(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE itops_site_racks (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                name TEXT NOT NULL,
                server_room TEXT NOT NULL DEFAULT '',
                rack_group TEXT NOT NULL DEFAULT '',
                shell TEXT,
                background_json TEXT,
                height_u INTEGER NOT NULL DEFAULT 42,
                depth_mm INTEGER NOT NULL DEFAULT 1000,
                power_capacity_w INTEGER,
                floor_x REAL,
                floor_y REAL,
                grid_x INTEGER,
                grid_y INTEGER,
                facing INTEGER,
                sort_order INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE itops_room_objects (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                server_room TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL,
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                z INTEGER NOT NULL DEFAULT 0,
                rot INTEGER NOT NULL DEFAULT 0,
                corner INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE itops_server_rooms (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                name TEXT NOT NULL,
                floor_color TEXT NOT NULL DEFAULT 'default',
                sort_order INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(site_id, name)
            );
            CREATE TABLE itops_sites (
                id TEXT PRIMARY KEY,
                room_backgrounds_json TEXT,
                room_icons_json TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO itops_sites (id, room_backgrounds_json, room_icons_json)
            VALUES ('f1', '{"Room B":{"kind":"preset","preset":"paper"}}',
                    '{"Room B":{"iconColor":"red"}}');
            INSERT INTO itops_server_rooms (id, site_id, name, sort_order)
            VALUES ('room-b', 'f1', 'Room B', 0), ('room-c', 'f1', 'Room C', 1);
            CREATE TABLE itops_site_rack_items (
                id TEXT PRIMARY KEY,
                rack_id TEXT NOT NULL,
                connection_id TEXT,
                kind TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                start_u INTEGER NOT NULL,
                height_u INTEGER NOT NULL,
                mount_face TEXT NOT NULL DEFAULT 'front',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (rack_id) REFERENCES itops_site_racks(id) ON DELETE CASCADE
            );
            "#,
        )
        .unwrap();
        conn
    }

    fn span(start_u: u32, height_u: u32) -> Span {
        Span {
            start_u,
            height_u,
            x_start: 0,
            x_quarters: 4,
        }
    }

    fn fractional(start_u: u32, height_u: u32, x_start: u32, x_quarters: u32) -> Span {
        Span {
            start_u,
            height_u,
            x_start,
            x_quarters,
        }
    }

    #[test]
    fn duplicate_rack_clones_devices_and_resets_room_coordinates() {
        let conn = open_test_db();
        create_rack(
            &conn,
            "r1",
            "f1",
            "Rack-1",
            "Room B",
            "Row A",
            Some("white"),
            42,
            1000,
            Some(8000),
        )
        .unwrap();
        conn.execute(
            "UPDATE itops_site_racks
             SET background_json = '{\"kind\":\"preset\",\"preset\":\"mist\"}',
                 floor_x = 10, floor_y = 20, grid_x = 3, grid_y = 4, facing = 2
             WHERE id = 'r1'",
            [],
        )
        .unwrap();
        place_rack_item(
            &conn,
            "item-1",
            "r1",
            None,
            RackItemKind::Switch,
            "Core switch",
            10,
            2,
            RackItemMetadata::default(),
        )
        .unwrap();

        let mut sequence = 0;
        let duplicated = duplicate_rack(
            &conn,
            "r1",
            "Rack-1#2",
            "Room B",
            "Row A",
            Some("white"),
            42,
            1000,
            Some(8000),
            None,
            None,
            None,
            |prefix| {
                sequence += 1;
                format!("{prefix}-copy-{sequence}")
            },
        )
        .unwrap();

        assert_eq!(duplicated.name, "Rack-1#2");
        assert_eq!(duplicated.rack_group, "Row A");
        assert_eq!(duplicated.shell.as_deref(), Some("white"));
        assert_eq!(duplicated.power_capacity_w, Some(8000));
        assert_eq!(
            duplicated.background,
            Some(DashboardBackground::Preset {
                preset: "mist".to_string()
            })
        );
        assert_eq!(duplicated.items.len(), 1);
        assert_eq!(duplicated.items[0].label, "Core switch");
        assert_eq!(duplicated.floor_x, None);
        assert_eq!(duplicated.floor_y, None);
        assert_eq!(duplicated.grid_x, None);
        assert_eq!(duplicated.grid_y, None);
        assert_eq!(duplicated.facing, None);
    }

    #[test]
    fn duplicate_rack_can_commit_directly_to_a_grid_cell_with_facing() {
        let conn = open_test_db();
        create_rack(
            &conn, "r1", "f1", "Rack-1", "Room B", "", None, 42, 1000, None,
        )
        .unwrap();

        let duplicated = duplicate_rack(
            &conn,
            "r1",
            "Rack-1#2",
            "Room B",
            "",
            None,
            42,
            1000,
            None,
            Some(5),
            Some(6),
            Some(3),
            |prefix| format!("{prefix}-copy"),
        )
        .unwrap();

        assert_eq!(duplicated.grid_x, Some(5));
        assert_eq!(duplicated.grid_y, Some(6));
        assert_eq!(duplicated.facing, Some(3));
    }

    #[test]
    fn duplicate_server_room_clones_topology_and_room_metadata() {
        let conn = open_test_db();
        create_rack(
            &conn, "r1", "f1", "Rack-1", "Room B", "", None, 42, 1000, None,
        )
        .unwrap();
        conn.execute(
            "UPDATE itops_site_racks SET grid_x = 3, grid_y = 4, facing = 1 WHERE id = 'r1'",
            [],
        )
        .unwrap();
        place_rack_item(
            &conn,
            "item-1",
            "r1",
            None,
            RackItemKind::Pdu,
            "PDU",
            1,
            1,
            RackItemMetadata::default(),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itops_room_objects (id, site_id, server_room, kind, x, y, z, rot, corner)
             VALUES ('object-1', 'f1', 'Room B', 'camera', 2, 3, 4, 1, 2)",
            [],
        )
        .unwrap();

        let mut sequence = 0;
        let duplicated = duplicate_server_room(&conn, "room-b", "Room B#2", "blue", |prefix| {
            sequence += 1;
            format!("{prefix}-copy-{sequence}")
        })
        .unwrap();

        assert_eq!(duplicated.name, "Room B#2");
        assert_eq!(duplicated.floor_color, "blue");
        let racks = list_racks(&conn, "f1").unwrap();
        let duplicated_rack = racks
            .iter()
            .find(|rack| rack.server_room == duplicated.name)
            .unwrap();
        assert_eq!(duplicated_rack.name, "Rack-1");
        assert_eq!(duplicated_rack.grid_x, Some(3));
        assert_eq!(duplicated_rack.grid_y, Some(4));
        assert_eq!(duplicated_rack.facing, Some(1));
        assert_eq!(duplicated_rack.items.len(), 1);
        assert_eq!(
            list_room_objects(&conn, "f1", &duplicated.name)
                .unwrap()
                .len(),
            1
        );
        let (backgrounds, icons): (String, String) = conn
            .query_row(
                "SELECT room_backgrounds_json, room_icons_json FROM itops_sites WHERE id = 'f1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(backgrounds.contains("\"Room B#2\""));
        assert!(icons.contains("\"Room B#2\""));
    }

    #[test]
    fn overlap_detection_is_half_open() {
        // 1U at U10 and 1U at U11 are adjacent, not overlapping.
        assert!(!spans_overlap(span(10, 1), span(11, 1)));
        // A 2U device at U10 occupies U10-U11, colliding with a 1U at U11.
        assert!(spans_overlap(span(10, 2), span(11, 1)));
        assert!(spans_overlap(span(10, 2), span(10, 1)));
    }

    #[test]
    fn fractional_widths_share_a_u_row_without_overlapping() {
        // Two half-width devices side by side in the same U do not collide.
        assert!(!spans_overlap(
            fractional(10, 1, 0, 2),
            fractional(10, 1, 2, 2)
        ));
        // Same slot collides; a full-width device collides with either half.
        assert!(spans_overlap(
            fractional(10, 1, 0, 2),
            fractional(10, 1, 0, 2)
        ));
        assert!(spans_overlap(span(10, 1), fractional(10, 1, 2, 2)));
        // Four quarter-width devices tile one U; adjacent quarters don't touch.
        assert!(!spans_overlap(
            fractional(10, 1, 0, 1),
            fractional(10, 1, 1, 1)
        ));
        // A half at the left overlaps a quarter in x-slot 1 but not slot 2.
        assert!(spans_overlap(
            fractional(10, 1, 0, 2),
            fractional(10, 1, 1, 1)
        ));
        assert!(!spans_overlap(
            fractional(10, 1, 0, 2),
            fractional(10, 1, 2, 1)
        ));
        // Different U rows never collide regardless of x overlap.
        assert!(!spans_overlap(
            fractional(10, 1, 0, 2),
            fractional(11, 1, 0, 2)
        ));
    }

    #[test]
    fn placement_rejects_out_of_bounds_and_overlap() {
        let existing = vec![("a".to_string(), span(10, 2))]; // U10-U11
        // Fits in the gap above.
        assert!(validate_placement(42, &existing, None, span(12, 1)).is_ok());
        // Overlaps the existing device.
        assert!(validate_placement(42, &existing, None, span(11, 1)).is_err());
        // Exceeds rack height.
        assert!(validate_placement(42, &existing, None, span(42, 2)).is_err());
        // Zero height / zero start are invalid.
        assert!(validate_placement(42, &[], None, span(1, 0)).is_err());
        assert!(validate_placement(42, &[], None, span(0, 1)).is_err());
        // A move can ignore its own current span.
        assert!(validate_placement(42, &existing, Some("a"), span(10, 2)).is_ok());
    }

    #[test]
    fn only_one_kuaiguai_package_may_occupy_the_rack_top() {
        let top = span(43, 4);
        assert!(validate_item_placement(RackItemKind::Kuaiguai, 42, &[], None, top).is_ok());
        assert!(validate_item_placement(RackItemKind::Server, 42, &[], None, top).is_err());
        assert!(
            validate_item_placement(
                RackItemKind::Kuaiguai,
                42,
                &[("kk".to_string(), top)],
                None,
                span(43, 1),
            )
            .is_err()
        );
    }

    #[test]
    fn rack_create_list_update_delete_roundtrip() {
        let conn = open_test_db();
        let rack = create_rack(
            &conn,
            "r1",
            "f1",
            "  A12  ",
            " Room B ",
            " G1 ",
            Some("white"),
            42,
            1000,
            None,
        )
        .unwrap();
        assert_eq!(rack.name, "A12");
        assert_eq!(rack.server_room, "Room B");
        assert_eq!(rack.rack_group, "G1");
        assert_eq!(rack.shell.as_deref(), Some("white"));
        assert_eq!(rack.depth_mm, 1000);
        assert_eq!(rack.sort_order, 0);

        let listed = list_racks(&conn, "f1").unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].items.is_empty());
        assert_eq!(listed[0].server_room, "Room B");
        assert_eq!(listed[0].rack_group, "G1");

        let updated = update_rack(
            &conn,
            "r1",
            "A13",
            "Room C",
            "G2",
            None,
            24,
            1200,
            Some(8000),
        )
        .unwrap();
        assert_eq!(updated.rack_group, "G2");
        assert_eq!(updated.name, "A13");
        assert_eq!(updated.height_u, 24);
        assert_eq!(updated.depth_mm, 1200);
        assert_eq!(updated.power_capacity_w, Some(8000));
        assert_eq!(updated.sort_order, 0); // preserved

        delete_rack(&conn, "r1").unwrap();
        assert!(list_racks(&conn, "f1").unwrap().is_empty());
        assert!(matches!(
            delete_rack(&conn, "r1"),
            Err(ItopsStorageError::NotFound)
        ));
    }

    #[test]
    fn list_racks_preserves_rack_and_item_order_with_empty_racks() {
        let conn = open_test_db();
        conn.execute_batch(
            "INSERT INTO itops_site_racks (id, site_id, name, sort_order) VALUES
                ('rack-late', 'f1', 'Late', 2),
                ('rack-empty', 'f1', 'Empty', 1),
                ('rack-early', 'f1', 'Early', 0),
                ('rack-other', 'f2', 'Other Site', 0);
             INSERT INTO itops_site_rack_items
                (id, rack_id, kind, label, start_u, height_u) VALUES
                ('late-high', 'rack-late', 'server', 'Late high', 20, 1),
                ('early-high', 'rack-early', 'server', 'Early high', 11, 1),
                ('late-low', 'rack-late', 'server', 'Late low', 2, 1),
                ('early-low', 'rack-early', 'server', 'Early low', 3, 1),
                ('other-item', 'rack-other', 'server', 'Other', 1, 1);",
        )
        .unwrap();

        let racks = list_racks(&conn, "f1").unwrap();
        assert_eq!(
            racks
                .iter()
                .map(|rack| rack.id.as_str())
                .collect::<Vec<_>>(),
            vec!["rack-early", "rack-empty", "rack-late"]
        );
        assert_eq!(
            racks[0]
                .items
                .iter()
                .map(|item| (item.id.as_str(), item.start_u))
                .collect::<Vec<_>>(),
            vec![("early-low", 3), ("early-high", 11)]
        );
        assert!(racks[1].items.is_empty());
        assert_eq!(
            racks[2]
                .items
                .iter()
                .map(|item| (item.id.as_str(), item.start_u))
                .collect::<Vec<_>>(),
            vec![("late-low", 2), ("late-high", 20)]
        );
    }

    #[test]
    fn rack_power_capacity_normalizes_and_validates() {
        let conn = open_test_db();
        // 0 means "unset" and stores as NULL.
        let rack = create_rack(
            &conn,
            "r1",
            "f1",
            "A12",
            "Room B",
            "",
            None,
            42,
            1000,
            Some(0),
        )
        .unwrap();
        assert_eq!(rack.power_capacity_w, None);
        let updated = update_rack(
            &conn,
            "r1",
            "A12",
            "Room B",
            "",
            None,
            42,
            1000,
            Some(12_000),
        )
        .unwrap();
        assert_eq!(updated.power_capacity_w, Some(12_000));
        assert_eq!(
            list_racks(&conn, "f1").unwrap()[0].power_capacity_w,
            Some(12_000)
        );
        // Beyond the sanity ceiling is rejected.
        assert!(matches!(
            update_rack(
                &conn,
                "r1",
                "A12",
                "Room B",
                "",
                None,
                42,
                1000,
                Some(1_000_001)
            ),
            Err(ItopsStorageError::Validation(_))
        ));
    }

    #[test]
    fn rack_placements_persist_per_layout_and_skip_missing_ids() {
        let conn = open_test_db();
        create_rack(&conn, "a", "f1", "A", "Room B", "", None, 42, 1000, None).unwrap();
        create_rack(&conn, "b", "f1", "B", "Room B", "", None, 42, 1000, None).unwrap();

        // Grid cells round to whole non-negative cells; floor keeps px floats.
        set_rack_placements(
            &conn,
            RackPlacementKind::Grid,
            &[
                RackPlacementEntry {
                    id: "a".into(),
                    x: 2.4,
                    y: -1.0,
                },
                RackPlacementEntry {
                    id: "gone".into(),
                    x: 1.0,
                    y: 1.0,
                },
            ],
        )
        .unwrap();
        set_rack_placements(
            &conn,
            RackPlacementKind::Floor,
            &[RackPlacementEntry {
                id: "b".into(),
                x: 118.5,
                y: 42.0,
            }],
        )
        .unwrap();

        let racks = list_racks(&conn, "f1").unwrap();
        let a = racks.iter().find(|rack| rack.id == "a").unwrap();
        let b = racks.iter().find(|rack| rack.id == "b").unwrap();
        assert_eq!((a.grid_x, a.grid_y), (Some(2), Some(0)));
        assert_eq!((a.floor_x, a.floor_y), (None, None));
        assert_eq!((b.floor_x, b.floor_y), (Some(118.5), Some(42.0)));
        assert_eq!((b.grid_x, b.grid_y), (None, None));

        // Non-finite coordinates are rejected outright.
        assert!(matches!(
            set_rack_placements(
                &conn,
                RackPlacementKind::Floor,
                &[RackPlacementEntry {
                    id: "a".into(),
                    x: f64::NAN,
                    y: 0.0
                }],
            ),
            Err(ItopsStorageError::Validation(_))
        ));
    }

    #[test]
    fn rack_facings_persist_and_reject_out_of_range_turns() {
        let conn = open_test_db();
        create_rack(&conn, "a", "f1", "A", "Room B", "", None, 42, 1000, None).unwrap();

        set_rack_facings(
            &conn,
            &[
                RackFacingEntry {
                    id: "a".into(),
                    facing: 3,
                },
                // Missing ids are skipped like placement writes.
                RackFacingEntry {
                    id: "gone".into(),
                    facing: 1,
                },
            ],
        )
        .unwrap();
        let racks = list_racks(&conn, "f1").unwrap();
        assert_eq!(racks[0].facing, Some(3));

        assert!(matches!(
            set_rack_facings(
                &conn,
                &[RackFacingEntry {
                    id: "a".into(),
                    facing: 4
                }]
            ),
            Err(ItopsStorageError::Validation(_))
        ));
    }

    #[test]
    fn room_objects_replace_per_room_and_validate() {
        let conn = open_test_db();
        let object = |id: &str, kind: &str, z: i64| RoomObject {
            id: id.into(),
            kind: kind.into(),
            x: 1,
            y: 2,
            z,
            rot: 1,
            corner: Some(2),
        };

        set_room_objects(
            &conn,
            "f1",
            "Room B",
            &[object("o1", "camera", 52), object("o2", "kuaikuai", 42)],
        )
        .unwrap();
        set_room_objects(&conn, "f1", "Room C", &[object("o3", "ups", 0)]).unwrap();

        // Replace-all rewrites only the addressed room.
        set_room_objects(&conn, "f1", "Room B", &[object("o4", "wall", 0)]).unwrap();
        let room_b = list_room_objects(&conn, "f1", "Room B").unwrap();
        assert_eq!(
            room_b,
            vec![RoomObject {
                id: "o4".into(),
                kind: "wall".into(),
                x: 1,
                y: 2,
                z: 0,
                rot: 1,
                corner: Some(2)
            }]
        );
        assert_eq!(list_room_objects(&conn, "f1", "Room C").unwrap().len(), 1);

        // Unknown kinds, negative cells, and out-of-range z/rot are rejected.
        assert!(matches!(
            set_room_objects(&conn, "f1", "Room B", &[object("bad", "sofa", 0)]),
            Err(ItopsStorageError::Validation(_))
        ));
        assert!(matches!(
            set_room_objects(&conn, "f1", "Room B", &[object("bad", "camera", 58)]),
            Err(ItopsStorageError::Validation(_))
        ));
        let mut negative = object("bad", "camera", 0);
        negative.x = -1;
        assert!(matches!(
            set_room_objects(&conn, "f1", "Room B", &[negative]),
            Err(ItopsStorageError::Validation(_))
        ));
        let mut spun = object("bad", "camera", 0);
        spun.rot = 9;
        assert!(matches!(
            set_room_objects(&conn, "f1", "Room B", &[spun]),
            Err(ItopsStorageError::Validation(_))
        ));
        let mut cornered = object("bad", "camera", 0);
        cornered.corner = Some(4);
        assert!(matches!(
            set_room_objects(&conn, "f1", "Room B", &[cornered]),
            Err(ItopsStorageError::Validation(_))
        ));
        // A failed write leaves the previous layout intact.
        assert_eq!(list_room_objects(&conn, "f1", "Room B").unwrap().len(), 1);
    }

    #[test]
    fn rack_depth_rejects_out_of_range_values() {
        let conn = open_test_db();
        assert!(matches!(
            create_rack(&conn, "r1", "f1", "A12", "Room B", "", None, 42, 0, None),
            Err(ItopsStorageError::Validation(_))
        ));
        assert!(matches!(
            create_rack(&conn, "r2", "f1", "A13", "Room B", "", None, 42, 5001, None),
            Err(ItopsStorageError::Validation(_))
        ));
    }

    #[test]
    fn place_move_and_remove_items() {
        let conn = open_test_db();
        create_rack(&conn, "r1", "f1", "A12", "Room B", "", None, 42, 1000, None).unwrap();

        let item = place_rack_item(
            &conn,
            "i1",
            "r1",
            Some("c1".into()),
            RackItemKind::Connection,
            "web-01",
            40,
            2,
            RackItemMetadata::default(),
        )
        .unwrap();
        assert_eq!(item.start_u, 40);

        // Overlapping placement is rejected.
        assert!(matches!(
            place_rack_item(
                &conn,
                "i2",
                "r1",
                None,
                RackItemKind::Switch,
                "sw",
                41,
                1,
                RackItemMetadata::default(),
            ),
            Err(ItopsStorageError::Validation(_))
        ));

        // A passive item below it fits.
        place_rack_item(
            &conn,
            "i2",
            "r1",
            None,
            RackItemKind::Pdu,
            "pdu",
            1,
            1,
            RackItemMetadata::default(),
        )
        .unwrap();

        // A connection item without a connection id is rejected.
        assert!(matches!(
            place_rack_item(
                &conn,
                "i3",
                "r1",
                None,
                RackItemKind::Connection,
                "bad",
                20,
                1,
                RackItemMetadata::default(),
            ),
            Err(ItopsStorageError::Validation(_))
        ));

        let passive = place_rack_item(
            &conn,
            "i4",
            "r1",
            Some("stale-connection".into()),
            RackItemKind::Switch,
            "sw2",
            20,
            1,
            RackItemMetadata::default(),
        )
        .unwrap();
        assert_eq!(passive.connection_id, None);

        // Move the web host down; it must clear the PDU at U1.
        let moved = move_rack_item(&conn, "i1", "r1", 10, 2, None).unwrap();
        assert_eq!(moved.start_u, 10);

        let racks = list_racks(&conn, "f1").unwrap();
        assert_eq!(racks[0].items.len(), 3);

        remove_rack_item(&conn, "i1").unwrap();
        assert_eq!(list_racks(&conn, "f1").unwrap()[0].items.len(), 2);
    }

    #[test]
    fn front_and_rear_mounting_faces_validate_independently() {
        let conn = open_test_db();
        create_rack(&conn, "r1", "f1", "A12", "Room B", "", None, 42, 1000, None).unwrap();

        let front = place_rack_item_on_face(
            &conn,
            "front-device",
            "r1",
            None,
            RackItemKind::Server,
            "front",
            20,
            2,
            RackMountFace::Front,
            RackItemMetadata::default(),
        )
        .unwrap();
        let rear = place_rack_item_on_face(
            &conn,
            "rear-device",
            "r1",
            None,
            RackItemKind::Switch,
            "rear",
            20,
            2,
            RackMountFace::Rear,
            RackItemMetadata::default(),
        )
        .unwrap();
        assert_eq!(front.mount_face, RackMountFace::Front);
        assert_eq!(rear.mount_face, RackMountFace::Rear);

        assert!(matches!(
            place_rack_item_on_face(
                &conn,
                "rear-overlap",
                "r1",
                None,
                RackItemKind::Pdu,
                "blocked",
                21,
                1,
                RackMountFace::Rear,
                RackItemMetadata::default(),
            ),
            Err(ItopsStorageError::Validation(_))
        ));

        assert!(matches!(
            move_rack_item_to_face(
                &conn,
                "front-device",
                "r1",
                20,
                2,
                None,
                Some(RackMountFace::Rear),
            ),
            Err(ItopsStorageError::Validation(_))
        ));

        let moved = move_rack_item_to_face(
            &conn,
            "front-device",
            "r1",
            10,
            2,
            None,
            Some(RackMountFace::Rear),
        )
        .unwrap();
        assert_eq!(moved.mount_face, RackMountFace::Rear);

        let items = &list_racks(&conn, "f1").unwrap()[0].items;
        assert_eq!(
            items
                .iter()
                .filter(|item| item.mount_face == RackMountFace::Rear)
                .count(),
            2
        );
    }

    #[test]
    fn fractional_width_devices_place_move_and_update_side_by_side() {
        let conn = open_test_db();
        create_rack(&conn, "r1", "f1", "A12", "Room B", "", None, 42, 1000, None).unwrap();
        let half = |slot: u32| RackItemMetadata {
            width_fraction: Some("half".to_string()),
            slot: Some(slot),
            ..RackItemMetadata::default()
        };

        // Fractional occupancy is limited to the small-device kinds exposed by
        // the editor. Unsupported kinds normalize back to full width.
        let server = place_rack_item(
            &conn,
            "server",
            "r1",
            None,
            RackItemKind::Server,
            "server",
            7,
            1,
            half(1),
        )
        .unwrap();
        assert_eq!(server.metadata.width_fraction, None);
        assert_eq!(server.metadata.slot, None);

        // Two half-width modems share U5: left slot then right slot.
        place_rack_item(
            &conn,
            "m1",
            "r1",
            None,
            RackItemKind::GenericDevice,
            "modem-a",
            5,
            1,
            half(0),
        )
        .unwrap();
        place_rack_item(
            &conn,
            "m2",
            "r1",
            None,
            RackItemKind::GenericDevice,
            "modem-b",
            5,
            1,
            half(1),
        )
        .unwrap();

        // A third device cannot take an occupied slot, nor can a full-width
        // device take the row.
        assert!(matches!(
            place_rack_item(
                &conn,
                "m3",
                "r1",
                None,
                RackItemKind::GenericDevice,
                "modem-c",
                5,
                1,
                half(1)
            ),
            Err(ItopsStorageError::Validation(_))
        ));
        assert!(matches!(
            place_rack_item(
                &conn,
                "s1",
                "r1",
                None,
                RackItemKind::Switch,
                "sw",
                5,
                1,
                RackItemMetadata::default()
            ),
            Err(ItopsStorageError::Validation(_))
        ));

        // A quarter-width device fits beside a half in another row.
        let quarter = RackItemMetadata {
            width_fraction: Some("quarter".to_string()),
            slot: Some(3),
            ..RackItemMetadata::default()
        };
        place_rack_item(
            &conn,
            "q1",
            "r1",
            None,
            RackItemKind::Router,
            "r",
            6,
            1,
            quarter,
        )
        .unwrap();

        // Moving into the other half's slot is rejected; a free row works and
        // the slot moves with the device.
        assert!(matches!(
            move_rack_item(&conn, "m1", "r1", 5, 1, Some(1)),
            Err(ItopsStorageError::Validation(_))
        ));
        let moved = move_rack_item(&conn, "m1", "r1", 6, 1, Some(0)).unwrap();
        assert_eq!(moved.start_u, 6);
        assert_eq!(moved.metadata.slot, Some(0));

        // Updating a half to full width where the row is shared is rejected.
        assert!(matches!(
            update_rack_item(
                &conn,
                "q1",
                RackItemKind::Router,
                None,
                "r",
                RackItemMetadata::default(),
                None
            ),
            Err(ItopsStorageError::Validation(_))
        ));
        // Widening where the row is otherwise free is allowed.
        update_rack_item(
            &conn,
            "m2",
            RackItemKind::GenericDevice,
            None,
            "modem-b",
            RackItemMetadata::default(),
            None,
        )
        .unwrap();
    }

    #[test]
    fn rack_item_property_update_and_resize_are_atomic() {
        let conn = open_test_db();
        create_rack(&conn, "r1", "f1", "A12", "Room B", "", None, 42, 1000, None).unwrap();
        let half = |slot: u32| RackItemMetadata {
            width_fraction: Some("half".to_string()),
            slot: Some(slot),
            ..RackItemMetadata::default()
        };
        place_rack_item(
            &conn,
            "moving",
            "r1",
            None,
            RackItemKind::GenericDevice,
            "moving",
            42,
            1,
            half(0),
        )
        .unwrap();
        place_rack_item(
            &conn,
            "blocker",
            "r1",
            None,
            RackItemKind::GenericDevice,
            "blocker",
            41,
            1,
            half(1),
        )
        .unwrap();

        // The proposed slot change is valid at U42 by itself, but the combined
        // 2U resize would collide at U41. Neither part may persist on failure.
        assert!(matches!(
            update_rack_item(
                &conn,
                "moving",
                RackItemKind::GenericDevice,
                None,
                "moving",
                half(1),
                Some((41, 2)),
            ),
            Err(ItopsStorageError::Validation(_))
        ));
        let unchanged = fetch_item(&conn, "moving").unwrap();
        assert_eq!(unchanged.start_u, 42);
        assert_eq!(unchanged.height_u, 1);
        assert_eq!(unchanged.metadata.slot, Some(0));
    }

    #[test]
    fn updating_to_passive_item_clears_connection_id() {
        let conn = open_test_db();
        create_rack(&conn, "r1", "f1", "A12", "Room B", "", None, 42, 1000, None).unwrap();
        place_rack_item(
            &conn,
            "i1",
            "r1",
            Some("c1".into()),
            RackItemKind::Connection,
            "web-01",
            10,
            1,
            RackItemMetadata::default(),
        )
        .unwrap();

        let updated = update_rack_item(
            &conn,
            "i1",
            RackItemKind::Switch,
            Some("c1".into()),
            "top switch",
            RackItemMetadata::default(),
            None,
        )
        .unwrap();

        assert_eq!(updated.kind, RackItemKind::Switch);
        assert_eq!(updated.connection_id, None);
        assert_eq!(
            list_racks(&conn, "f1").unwrap()[0].items[0].connection_id,
            None
        );
    }

    #[test]
    fn shrinking_rack_below_an_item_is_rejected() {
        let conn = open_test_db();
        create_rack(&conn, "r1", "f1", "A12", "Room B", "", None, 42, 1000, None).unwrap();
        place_rack_item(
            &conn,
            "i1",
            "r1",
            None,
            RackItemKind::Server,
            "srv",
            40,
            2,
            RackItemMetadata::default(),
        )
        .unwrap();
        // Item occupies U40-U41; shrinking to 24U must fail.
        assert!(matches!(
            update_rack(&conn, "r1", "A12", "Room B", "", None, 24, 1000, None),
            Err(ItopsStorageError::Validation(_))
        ));
    }

    #[test]
    fn rack_top_kuaiguai_follows_a_rack_height_change() {
        let conn = open_test_db();
        create_rack(&conn, "r1", "f1", "A12", "Room B", "", None, 42, 1000, None).unwrap();
        place_rack_item(
            &conn,
            "kk1",
            "r1",
            None,
            RackItemKind::Kuaiguai,
            "",
            43,
            4,
            RackItemMetadata::default(),
        )
        .unwrap();

        let updated = update_rack(&conn, "r1", "A12", "Room B", "", None, 48, 1000, None).unwrap();
        assert_eq!(updated.items[0].start_u, 49);
    }

    #[test]
    fn reorder_scopes_to_site() {
        let conn = open_test_db();
        create_rack(&conn, "a", "f1", "A", "Room B", "", None, 42, 1000, None).unwrap();
        create_rack(&conn, "b", "f1", "B", "Room B", "", None, 42, 1000, None).unwrap();
        reorder_racks(&conn, "f1", &["b".to_string(), "a".to_string()]).unwrap();
        let order: Vec<String> = list_racks(&conn, "f1")
            .unwrap()
            .into_iter()
            .map(|rack| rack.id)
            .collect();
        assert_eq!(order, vec!["b", "a"]);
    }

    #[test]
    fn server_room_persists_without_a_rack() {
        let conn = open_test_db();
        let created =
            create_server_room(&conn, "room-empty", "f1", " Empty Room ", "default").unwrap();
        assert_eq!(created.name, "Empty Room");
        assert!(
            list_server_rooms(&conn, "f1")
                .unwrap()
                .iter()
                .any(|room| room.id == "room-empty")
        );
        assert!(list_racks(&conn, "f1").unwrap().is_empty());
    }

    #[test]
    fn server_room_properties_rename_dependents() {
        let conn = open_test_db();
        create_rack(&conn, "r1", "f1", "A12", "Room B", "", None, 42, 1000, None).unwrap();
        conn.execute(
            "INSERT INTO itops_room_objects (id, site_id, server_room, kind, x, y, z, rot)
             VALUES ('obj-1', 'f1', 'Room B', 'sensor', 0, 0, 0, 0)",
            [],
        )
        .unwrap();

        let updated = update_server_room(&conn, "room-b", " Core Room ", "blue").unwrap();
        assert_eq!(updated.name, "Core Room");
        assert_eq!(updated.floor_color, "blue");
        assert_eq!(list_racks(&conn, "f1").unwrap()[0].server_room, "Core Room");
        assert_eq!(
            list_room_objects(&conn, "f1", "Core Room").unwrap().len(),
            1
        );

        let (backgrounds, icons): (String, String) = conn
            .query_row(
                "SELECT room_backgrounds_json, room_icons_json FROM itops_sites WHERE id = 'f1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(backgrounds.contains("Core Room"));
        assert!(!backgrounds.contains("Room B"));
        assert!(icons.contains("Core Room"));
        assert!(!icons.contains("Room B"));
    }

    #[test]
    fn deleting_a_server_room_removes_its_topology_only() {
        let conn = open_test_db();
        create_rack(&conn, "r1", "f1", "A12", "Room B", "", None, 42, 1000, None).unwrap();
        place_rack_item(
            &conn,
            "item-1",
            "r1",
            None,
            RackItemKind::Server,
            "server",
            1,
            1,
            RackItemMetadata::default(),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itops_room_objects (id, site_id, server_room, kind, x, y, z, rot)
             VALUES ('obj-1', 'f1', 'Room B', 'sensor', 0, 0, 0, 0)",
            [],
        )
        .unwrap();

        delete_server_room(&conn, "room-b").unwrap();

        assert!(list_racks(&conn, "f1").unwrap().is_empty());
        assert!(list_room_objects(&conn, "f1", "Room B").unwrap().is_empty());
        assert!(
            list_server_rooms(&conn, "f1")
                .unwrap()
                .iter()
                .all(|room| room.id != "room-b")
        );
        let item_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM itops_site_rack_items WHERE id = 'item-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(item_count, 0);
        let (backgrounds, icons): (String, String) = conn
            .query_row(
                "SELECT room_backgrounds_json, room_icons_json FROM itops_sites WHERE id = 'f1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(!backgrounds.contains("Room B"));
        assert!(!icons.contains("Room B"));
    }

    #[test]
    fn rack_requires_a_server_room_owned_by_its_site() {
        let conn = open_test_db();
        assert!(matches!(
            create_rack(&conn, "r-empty", "f1", "A", "", "", None, 42, 1000, None),
            Err(ItopsStorageError::Validation(_))
        ));
        assert!(matches!(
            create_rack(
                &conn,
                "r-missing",
                "f1",
                "A",
                "Unknown",
                "",
                None,
                42,
                1000,
                None
            ),
            Err(ItopsStorageError::Validation(_))
        ));
        assert!(
            create_rack(
                &conn, "r-valid", "f1", "A", "Room B", "", None, 42, 1000, None
            )
            .is_ok()
        );
    }
}

# Site Management — Design and Reference

Status: **Shipped** — rename, rack data model, Site View / Server Room View /
Rack View with the dialogs-first editor, click-to-connect with ghost handling,
Server Room / Rack scoped Batch Runs, drag-to-place, rack page-context
awareness and accent colour-coding, the approval-gated rack-layout assistant
tools with `itops-changed` live reload, and selective export/import inclusion
of racks and rack items. Remaining polish (drag-resize refinement) is best
verified with the desktop app running.
This document is the design reference and current product terminology for IT Ops
**Site** management with a visual virtual-datacenter (rack elevation) layer.
It extends `docs/ITOPS.md`
(which remains the source of truth for shipped IT Ops architecture) and follows
the same durable-vs-live split. When this doc conflicts with `docs/ITOPS.md`
for Site-internal concerns, this doc wins; for everything else `docs/ITOPS.md`
and `docs/ARCHITECTURE.md` win.

## Summary

The IT Ops Module now opens directly into **Sites**: durable named selections
of Connections that can also be arranged as a visible topology. This work does
two things:

1. **Renames Host Group → Site** across the product (term, code, schema, i18n,
   docs). A Site keeps the same batch-target role.
2. **Adds a virtual-datacenter layer**: each Site can be arranged as one or
   more **Racks** grouped by **Server Room**, drawn as realistic 42U
   **rack elevations**. A rack holds **Rack Devices** — either a placed
   **Connection** (clickable to open ssh/rdp/vnc/etc.) or a **passive item**
   (switch, PDU, patch panel, blank filler, label) for a faithful picture.

The payoff: IT Ops stops being a list you configure and becomes a site you
*see and operate* — open a host by clicking its slot, or run a Batch Run on a
whole Server Room or Rack.

## Decisions (resolved with the product owner)

| Fork | Decision | Consequence |
| --- | --- | --- |
| Topology scope | **Per-Site topology** | Racks belong to a Site and are grouped by Server Room. The same Connection may be placed in multiple Sites' racks. Placement is stored per `(rack, device)`, never globally on the Connection. |
| Rack contents | **Connections + passive Rack Devices** | A Rack Device either references a Connection id (openable) or is a standalone passive device (switch/PDU/patch panel/blank/label). |
| Visual fidelity | **Full rack elevation** | Fixed-height rack (default 42U), each Rack Device has a `start_u` and `height_u` (1U/2U/4U...), empty slots are visible, drag-to-place. |

These three are deliberately the durable-data-model forks; everything below
builds on them.

## Why this stays inside IT Ops (not a new Module)

A Site is the renamed Host Group plus a visual arrangement of the same
Connections. Batch Runs target a Site by id; adding a topology layer keeps that wiring
intact. The rack view is a new *visualization and launch surface* over the
existing site-targeting model — not a new execution model. No new rail Module.

## Terminology

Replaces the **Host Group** entry in `CONTEXT.md`; adds the rest. Follows the
`_Avoid_` convention.

- **Sites** — the IT Ops collection and left-column navigator for Site
  records. It is plural UI, not a separate durable entity. The visible Module
  currently opens directly into this Site topology surface.
- **Site** — a durable, named selection of existing Connections (plus an
  optional dynamic filter by type/folder) used as the target for Batch Runs
  and optionally arranged into a virtual
  datacenter of Racks. Stored in `itops_sites`. References Connection ids;
  owns no Session and no secret. It is not a Connection type. _Avoid_: host
  group, inventory, host list, connection group (as a Connection type).
- **Default Site** — the undeletable fallback Site seeded when IT Ops has no
  Site rows. It keeps the Site topology from starting without a parent
  container; users can add their own Sites beside it.
- **Site View** — the top-level right-side view for one selected Site. It
  shows the Site's Server Rooms as cards and is the entry point into the
  topology drill-down. _Avoid_: members view, list mode.
- **Server Room** — a durable Site-owned row in `itops_server_rooms`. It nests
  the Sites tree and scopes a Batch Run. A Server Room can be empty; each new
  Rack must belong to a room owned by the same Site. It also owns the durable
  2.5D floor finish edited through Server Room Properties. _Avoid_: zone, site object.
- **Server Room View** — the drill-down view for one Server Room. It has
  three layouts: rack elevations (default, optionally grouped by each Rack's
  `rack_group` tag), a blueprint-style top-down floor plan, and a 2.5D
  axonometric room. The floor plan and 2.5D room share one grid placement
  (cell + facing per Rack), paint Racks in their cabinet shell finish (no
  status colouring) with compact utilisation/power tags, and hold
  **Room Objects**. _Avoid_: area view, region view.
- **Room Object** — a non-rack fixture or structure on the Server Room floor
  grid (security camera, air conditioner, fire extinguisher, UPS,
  environment sensor, smoke detector, crash cart, partition wall, 乖乖). A
  Room Object has a facing and a vertical position in rack units, so occupants
  can share a floor cell while their vertical spans don't intersect. Resting
  objects settle on the lowest fitting support surface, while top-hung fixtures such
  as cameras and detectors keep their overhead placement. A 乖乖 pack is never
  a Room Object while on a cabinet top: a rack-top drop (or a legacy rack-top
  Room Object found on load) becomes that Rack's single rack-top 乖乖 Rack
  Device, so the Rack View and the room views share one object; only a
  floor-standing pack remains a Room Object. Footprints follow real-world size against the 1200 mm
  floor cell: small hand-sized fixtures (camera, fire extinguisher, sensor,
  smoke detector, 乖乖) occupy one cell quadrant chosen by a durable
  `corner` property (clockwise 0=NW..3=SW). Larger fixtures use the exact
  one-cell proportions from `Server Room Objects.dc.html` (for example CRAC
  0.94×0.62 and UPS 0.6×0.6) and block their snapped
  cell for stacking. A partition wall is a floor-standing 0.15 m × 2.4 m
  structure that auto-connects to walls on orthogonally adjacent cells,
  forming straight runs, corners, tees, and crosses. Durable in
  `itops_room_objects`, scoped by Site + Server Room name like racks (the
  pure model lives in `roomObjects.ts`; the pre-durable localStorage scope
  remains a legacy fallback). Rack facing is a durable `facing` column on
  `itops_site_racks`. _Avoid_: fixture entity, prop.
- **Rack** — a durable, fixed-height (default 42U) cabinet that belongs to one
  Site, grouped by **Server Room** (topology Site → Server Room → Rack), with
  an optional **shell** finish (black/white/grey). Holds Rack Devices at U
  positions on independent Front and Rear mounting faces. Stored in
  `itops_site_racks`. _Avoid_: cabinet group, shelf.
- **Rack View** — the single-Rack drill-down stage. It centers one mounting
  face when only that face is occupied and shows labeled Front and Rear
  elevations side by side when both are occupied (and while editing). Dual-face
  callouts use separate outer lanes—Front on the left and Rear on the right—so
  leaders never cross between cabinets; they include truncated model/notes
  metadata. A rack-top 乖乖 renders the artwork appropriate to both visible
  faces but owns one face-neutral callout. It is the place where a user opens
  or edits a Rack Device. _Avoid_: floor plan, topology graph.
- **Rack Device** — one device occupying a contiguous
  `start_u..start_u+height_u` span on a Rack's Front or Rear mounting face.
  Occupancy is validated independently per face. Either **Connection-backed**
  (carries a `connection_id`, clickable to open its Session) or **passive** (a
  switch, PDU, patch panel, blank filler, or label — inventory/visual only, not
  openable). Stored in `itops_site_rack_items`; code and schema may still use
  the older `RackItem` / Rack Item names. _Avoid_: slot, node, host card.
- **Rack Device Type** — the finite visual/device kind for a Rack Device:
  connection, server, storage, switch, router, firewall, PDU, UPS, KVM, patch
  panel, generic device, 乖乖, blank, or label. It controls faceplate
  rendering and editing fields; it is not a Connection type.
- **Rack Device Properties** — non-secret presentation metadata for a Rack
  Device: label, status, accent, notes, tags, additional Connection bindings,
  typed port rows, SNMP target/OID hints for user-triggered refresh, shell/model
  preview data, 乖乖 package expiry/size/style/rotation, ports, disks, battery,
  load, icon, and placement. Never store credentials, secrets, or live Session
  state here. SNMP refresh is manual rather than a background polling service.

`Watchdog`, `Batch Run`, `Playbook`, and `Transport` are unchanged.

## Data Model

Mirrors `src-tauri/src/itops/storage.rs` conventions: free functions over
`&SqliteConnection`, JSON `TEXT` for non-relational fields, integer
`sort_order`, idempotent `CREATE TABLE IF NOT EXISTS` appended to
`CURRENT_SCHEMA`, and versioned upgrades selected through `PRAGMA user_version`.
All later topology schema changes must preserve the current-version startup fast
path and follow `docs/ARCHITECTURE.md` → "Schema initialization and migrations",
including the explicit audit for any ongoing seed reconciliation.

### Schema migration (bump `SCHEMA_USER_VERSION` 33 → 34)

The migration has two parts and must be additive + reversible-safe per the
existing migration style in `src-tauri/src/storage.rs`:

1. **Rename `itops_host_groups` → `itops_sites`.** SQLite supports
   `ALTER TABLE itops_host_groups RENAME TO itops_sites;` guarded by an
   existence check (only run when the old table exists and the new one does
   not). The column shape is unchanged. `itops_run_history.host_group_id` is a
   **soft reference** (no FK) so renaming the table does not require touching
   run history rows; the column itself is renamed in step 2 for clarity.
2. **Rename soft-reference columns** for naming consistency:
   `itops_run_history.host_group_id → site_id`
   (`ALTER TABLE … RENAME COLUMN`, guarded). The `idx_itops_run_history_source`
   index is unaffected (it indexes `source, started_at`).
3. **Add the two new topology tables** (below).

`CURRENT_SCHEMA` is updated so fresh installs create `itops_sites` and the new
tables directly; the rename branch only runs for upgrades. Add a focused
migration test mirroring the existing storage tests.

```sql
-- A Rack belongs to one Site; grouped by server_room (Site → Server Room →
-- Rack). The legacy region/datacenter/area columns are retired in place.
CREATE TABLE IF NOT EXISTS itops_site_racks (
    id          TEXT PRIMARY KEY,
    site_id    TEXT NOT NULL REFERENCES itops_sites(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,           -- e.g. "A12"
    server_room TEXT NOT NULL DEFAULT '',
    shell       TEXT,                    -- cabinet finish: black|white|grey
    height_u    INTEGER NOT NULL DEFAULT 42,
    depth_mm    INTEGER NOT NULL DEFAULT 1000,
    sort_order  INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_itops_site_racks_site
    ON itops_site_racks(site_id, sort_order);

-- One device occupying a contiguous U span in a Rack. Connection-backed when
-- connection_id is set; passive otherwise. connection_id is a SOFT reference
-- (no FK): a placed host whose Connection is later deleted becomes a "ghost"
-- item the UI flags, rather than silently vanishing the rack layout.
CREATE TABLE IF NOT EXISTS itops_site_rack_items (
    id            TEXT PRIMARY KEY,
    rack_id       TEXT NOT NULL REFERENCES itops_site_racks(id) ON DELETE CASCADE,
    -- Soft ref to connections.id; NULL for passive items.
    connection_id TEXT,
    -- 'connection' | 'switch' | 'pdu' | 'patchPanel' | 'blank' | 'label' |
    -- 'server' | 'storage' | 'router' | 'firewall' | 'ups' | 'kvm' |
    -- 'genericDevice' — passive catch-all hardware with a generic faceplate.
    kind          TEXT NOT NULL,
    -- Display label (passive items, or an override for a connection item).
    label         TEXT NOT NULL DEFAULT '',
    start_u       INTEGER NOT NULL,        -- bottom-most U occupied (1-based)
    height_u      INTEGER NOT NULL DEFAULT 1,
    mount_face    TEXT NOT NULL DEFAULT 'front', -- 'front' | 'rear'
    -- Presentation only: accent color, icon, notes, plus faceplate fields
    -- (status, ports, disks, battery, load). No secrets, no live state.
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_itops_site_rack_items_rack
    ON itops_site_rack_items(rack_id, start_u);
```

The `itops_sites` table keeps the current Host Group columns verbatim
(`id, name, sort_order, member_ids_json, filter_json, transport, ...`). Racks and
items are **additive** — a Site with no racks behaves exactly like today's
flat Site target.

### Overlap / validation rule

A rack item must not overlap another item's occupied area in the same rack,
and must fit within `1..=height_u`. Occupancy is two-dimensional: besides its
U span, each item covers a horizontal strip of the rack width in quarter
units, derived from metadata `widthFraction` ("half" | "quarter"; unset =
full width) and `slot` (0-based from the left in units of its own width). Two
items collide only when both their U spans and their horizontal strips
intersect, so two half-width devices (e.g. modems) may share one U row side
by side. The sole exception is one 乖乖 package on the rack top, stored at the
virtual position `height_u + 1`; changing the Rack height moves that
package's virtual position with the top. Validate in `itops/site_storage.rs`
on insert/update/move (pure helper, unit-tested) and re-check in the UI
before a drag-drop commit. Keep the overlap and special placement rules in
small pure functions so they remain testable without a DB.

### Rust types (`src-tauri/src/itops/types.rs`)

Rename `HostGroup → Site`, `HostGroupFilter → SiteFilter` (serde
`rename_all = "camelCase"` is unchanged, so the wire shape only changes field
names that reference the group). Add:

```rust
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rack {
    pub id: String,
    pub site_id: String,
    pub name: String,
    pub server_room: String,
    pub shell: Option<String>, // cabinet finish: black|white|grey
    pub height_u: u32,         // default 42
    pub depth_mm: u32,         // physical depth; default 1000 mm
    pub sort_order: i64,
    pub items: Vec<RackItem>,  // hydrated on read
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RackItemKind {
    Connection, Switch, Pdu, PatchPanel, Blank, Label, Server,
    Storage, Router, Firewall, Ups, Kvm, Equipment, General,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RackItem {
    pub id: String,
    pub rack_id: String,
    pub connection_id: Option<String>, // None = passive
    pub kind: RackItemKind,
    pub label: String,
    pub start_u: u32,
    pub height_u: u32,
    #[serde(default)]
    pub mount_face: RackMountFace,
    #[serde(default)]
    pub metadata: RackItemMetadata,   // non-secret rack inventory/presentation metadata
}
```

Batch targeting is renamed from `host_group_id` to `site_id` as a coordinated
frontend/backend change. `BatchTask`, `PlaybookStep`, `Transport`, and
`ResolvedHost` are otherwise unchanged.

### Site resolution semantics (batch targeting)

`resolve_host_group` becomes `resolve_site`. A Site resolves to an ordered,
deduplicated `Vec<ResolvedHost>` from the union of:

1. explicit `member_ids` (stored order, skipping deleted Connections), then
2. **placed Connection-backed rack items** not already included (rack
   `sort_order`, then `start_u` descending — top-of-rack first), then
3. dynamic `filter` matches not already included.

So placing a host in a rack automatically makes it a batch target, and a Site
with no racks resolves exactly as a flat Site does. A new
`resolve_site_scoped(site, scope)` variant accepts an optional
`{ serverRoom?, rackId? }` scope so the Rack View can launch a Batch Run on
one Server Room or Rack (Phase D).

## Backend changes

- **`src-tauri/src/itops/storage.rs`** → rename Host Group repo functions to
  `*_site`; keep the resolver here. Add the placed-item union to `resolve_site`.
- **New `src-tauri/src/itops/site_storage.rs`** → CRUD + reorder for racks and
  rack items, plus the pure overlap/fit validator. Mirrors `dashboard_storage.rs`.
- **`src-tauri/src/itops/commands.rs`** → rename existing host-group commands
  (`itops_create_host_group` → `itops_create_site`, etc.; keep parameter
  shapes), add rack/item commands:
  `itops_list_racks(siteId)`, `itops_create_rack`, `itops_update_rack`,
  `itops_delete_rack`, `itops_reorder_racks`,
  `itops_place_rack_item`, `itops_update_rack_item`, `itops_move_rack_item`
  (rack_id + start_u, validated), `itops_remove_rack_item`. Register in
  `generate_handler!` (`src-tauri/src/lib.rs`).
- **`itops_start_batch_run`** gains an optional `scope` arg for Server Room /
  Rack
  runs; default (no scope) is unchanged.
- **`src-tauri/src/itops/run_storage.rs`** → `host_group_id` field → `site_id`.
- **`src-tauri/src/itops/actions.rs`** → `RunBatch` reads `site_id`.
- Emit the existing `itops-changed` event on any site/rack mutation so the
  store reloads (mirrors `dashboard-changed`).

All DB work stays on `spawn_blocking`/the command runtime per
`docs/ARCHITECTURE.md`; no blocking on the UI/native thread.

## Frontend changes

`src/modules/itops/` (rename files: `HostGroupsTab.tsx → SitesTab.tsx`,
`HostGroupDialog.tsx → SiteDialog.tsx`; update `state.ts`, `ItOpsModule.tsx`,
`BatchRunsTab.tsx`, `BatchRunDialog.tsx`, `icons.tsx`,
`itops.css`). Wire-level renames in `src/types.ts`, `src/lib/tauri.ts`
(`hostGroupId → siteId`).

### Site topology layout

The visible IT Ops Module opens directly into the Site topology surface:

- **Sites tree** — the left column contains the Module title/icon and the
  searchable Site → Server Room → Rack navigator. The whole column is
  resizable, and the IT Ops title-bar Sites button hides or shows it. Width
  and hidden state persist. A native right-click menu exposes Delete followed
  by a separator and final Properties item for each Site, Server Room, or Rack.
  A Server Room prepends `itops.racks.addRackAction`. Properties reopens the
  existing add dialog in edit mode; Delete always opens the shared confirmation
  sheet. The undeletable Default Site keeps a disabled Delete item.
  Right-clicking the virtual Server Rooms row instead exposes
  `itops.racks.addServerRoomAction` for that Site.
- **Site View** — selecting a Site shows Server Room cards.
- **Server Room View** — selecting a Server Room shows its Racks in one of
  three layouts: rack elevations (default, optionally grouped by each Rack's
  `rack_group` tag), a blueprint-style top-down floor plan
  (`ServerRoomFloorPlan.tsx`), or a 2.5D axonometric room
  (`ServerRoomIsoView.tsx`). The two spatial layouts share one floor grid
  (cell placement + facing, `roomIsoLayout.ts`), paint Racks in their shell
  finish (no status colouring) with always-on utilisation/power tags
  (`roomFloorPlan.ts` metrics), and hold
  non-rack room objects with vertical stacking (`roomObjects.ts`). A Rack
  footprint spans its full cell side-to-side, but its displayed depth tracks
  the Rack's `depth_mm` against the 1200 mm cell (600 mm = half a cell,
  ratio in between, anything ≥ 1200 mm = the full cell; `rackDepthFrac` in
  `roomIsoLayout.ts`) with the front face flush on the cell borderline the
  facing points at. Both grow
  their floor grid to cover the whole view, carry a zoom stepper (50%–200%,
  also Ctrl+scroll; the level persists locally per layout), and pan with a
  middle-mouse drag or the arrow keys. In 2.5D, Rack names are top-face
  stickers aligned to facing, object type badges are edit-only, and item
  controls render only for the clicked selection. Empty-space right-click
  opens the shared Dashboard background picker; the room floor finish is a
  durable Server Room property rather than an always-visible canvas palette.
- **Rack View** — selecting a Rack centers its occupied mounting face, or shows
  Front and Rear side by side when both contain devices; Edit mode always shows
  both as drop targets. The Rack name/specifications live in the
  top-middle toolbar. An armed Rack Device remains under the pointer outside the
  cabinet, magnetically snaps to a nearby U, and cancels on right-click, Escape,
  picker disarm, or navigation. 乖乖 alone can also snap to the rack top (the
  durable virtual position `start_u = height_u + 1`): `full` stands at 4U and
  `laidDown` faces upward at 1U. Rack View and the Server Room elevation rows
  always reserve 4U of headroom above the cabinet (`KUAIGUAI_TOP_CLEARANCE_U`)
  so a rack-top package fits without shifting the rack. Floor views hide 乖乖
  stored inside the cabinet and show only a rack-top package. The floor plan
  and 2.5D views place the same rack-top Rack Device when their picker's 乖乖
  is dropped on a cabinet top. Those spatial views preserve the selected one
  of four rack-top corners in Rack Device metadata, while Rack View and the
  elevation always draw it center top. A package with an
  expiry date desaturates linearly over the last 30 days before the date,
  rendering fully black and white on and after it (`kuaiKuaiGrayscale` in
  `KuaiKuaiBag.tsx`, applied in every view through the shared bag artwork).

  Server Room floor-plan and 2.5D pickers use the same single-item placement
  contract: choosing a fixture arms one ghost immediately, while a Rack first
  collects its properties; the armed object stays under the pointer outside
  the floor, snaps to every visible grid cell inside it (including cells added
  when the floor grows to fill the viewport), and is consumed by one successful
  placement. Right-click, Escape, picker disarm, edit-mode exit, layout change,
  or navigation cancels it (discarding a configured but unplaced Rack); a
  blocked cell keeps it armed for another target.

Batch Runs remain part of IT Ops, but their top-level management tab chrome
is hidden while the Site-only UI is active.

### Rack elevation component (`RackElevation.tsx`)

- Renders a fixed `height_u` column of U slots (the U-number gutter is left on
  Front and right on Rear, numbered top-down as real racks are). Pure
  SVG/flex/CSS — **no new heavy
  dependency**; reuse design tokens from `src/styles/colorSchemes.css`
  (never hard-code hex, per `AGENTS.md`/`docs/DESIGN_LANGUAGE.md`).
- Each Rack Device is a block spanning its U range, showing icon + label +
  (for Connection items) a live status dot reusing the existing connection
  status source. Empty U slots are visible, drop-targetable, and faintly ruled.
- **Drag-to-place / move / resize** with the overlap validator gating commits;
  invalid drops show the standard `showStatusBarNotice` warning tone (no inline
  toast — High-Risk Invariant). Persist via `itops_move_rack_item` /
  `itops_update_rack_item`.
- **Click a device with bound Connections → connect popover**
  (`RackItemConnectPopover.tsx`): a faceplate-anchored popover lists every
  bound Connection (the primary placed `connection_id` first, then the
  `metadata.connectionIds` bindings) with its icon, name, and host. A row
  without an open Session connects via
  `useWorkspaceStore().openConnection(connection)` — the exact path the
  Connection Tree uses; DOM-rendered kinds (terminals, FTP, File Explorer,
  Document) open in the background with a `showStatusBarNotice` confirmation
  so the user keeps working the rack, while native-surface kinds (URL / RDP /
  VNC) navigate to the Workspace Module because those Sessions must come up
  while the Workspace is visible. A row whose Session is already open shows
  "Go to session" and jumps to its Workspace tab. Devices with no bound
  Connections open the edit dialog on click.
- **Ghost items**: a Connection-backed item whose `connection_id` no longer
  resolves renders dimmed with a "missing Connection" badge and an unplace
  action — never a crash or a silent disappearance.

### Editing affordances

- "Add Rack" (name, server_room, group, shell, height_u, depth_mm) and "Add Item" (choose a Site
  member Connection, or a passive device kind) via dialogs built from
  `src/app/ui/dialog` primitives, footer order per host platform
  (`docs/DESIGN_LANGUAGE.md`).
- Right-click a rack item → native context menu (`src/lib/nativeContextMenu.ts`)
  with Open / Open in New Tab / Edit / Unplace / Run task on this rack.
- A Rack-scoped "Run task" and Server Room-scoped run feed
  `itops_start_batch_run` with the matching `scope`.

## Click-to-connect across Connection kinds

`openConnection` already dispatches by Connection `type` (ssh terminal, rdp,
vnc, url, ftp, …), so the Rack View gets ssh/rdp/vnc/ftp/url launch for free by
delegating to it. No kind-specific launch code lives in IT Ops. SFTP-vs-SSH and
RDP/VNC native-surface invariants are the workspace layer's concern and are not
re-implemented here.

## AI Assistant integration

Extend the existing approval-gated IT Ops tools (`docs/ITOPS.md` → "AI Assistant
integration"):

- The page-context projection gains compact rack metadata: per Site, the rack
  count and Server Room names (never device-level detail, no secrets).
- New mutating tools (approval-gated) let the assistant **draft a rack layout**
  from a Site's members — e.g. "arrange my prod-web Site into two racks by
  row." Mutations emit `itops-changed`. The assistant cannot open a Session or
  run a site task without the existing approval flow.

## Export / import (ADR 0010)

Sites already participate in selective export/import as non-secret metadata.
Add `itops_site_racks` and `itops_site_rack_items` to the same shape (pure
metadata; `connection_id` is a soft ref, so import tolerates missing
Connections by importing ghost items the user can re-bind). No secret ever
enters the export.

## i18n

- Rename the `itops` namespace keys that say "host group" → "site"
  (`itops.tabs.groups → itops.tabs.sites`, `itops.hostGroups.* →
  itops.sites.*`, `itops.batchRuns.hostGroupLabel → siteLabel`, etc.).
  English keys change first in `src/i18n/locales/en.json`; every change follows
  `docs/localization_todo/README.md` (one pending file per new/changed key if
  translations don't land in the same change).
- Add new keys for Site View, Server Room View, Rack View, passive item kinds, drag/overlap
  warnings, and the new dialogs.
- **zh-TW gate**: use Taiwan terminology (e.g. 機櫃 for rack, 機房 for
  datacenter) — never Mainland terms; never convert from `zh-CN.json`. See
  `AGENTS.md` and `docs/manual/16-localization.md`.

## Docs, manual, tutorial

- **`CONTEXT.md`** — replace the Host Group entry with Site; add Sites,
  Site View, Server Room, Server Room View, Rack, Rack View, Rack Device,
  Rack Device Type, and Rack Device Properties terms; update the IT Ops Module entry and any
  "Host Group" mentions (3 refs today).
- **`docs/ITOPS.md`** — update the renamed term and add a "Site topology" note
  pointing here.
- **`docs/manual/12-it-ops.md`** — keep the Site section aligned with Site +
  Rack View; reference i18n keys, not English labels; add grep hints and
  synonyms (rack, cabinet, datacenter, U position, region, area).
- **Tutorial** — if the Rack View is tutorial-capable, add a stable
  `data-tutorial-id`, a `src/app/tutorialNavigationModel.ts` entry, matching
  `tutorial_highlight` metadata in `src-tauri/src/ai.rs`, and manual grep hints;
  `npm run check` validates these mappings.
- **`docs/ADR/0011-it-ops-module.md`** and `docs/ROADMAP.md` — note the Site
  rename and the topology layer (ROADMAP "IT Ops Center" section).

## Delivery history

All phases shipped: the Host Group → Site rename (schema 33→34), the rack
topology data model (`itops_site_racks` / `itops_site_rack_items`, schema 35,
with the pure overlap/fit validator and rack/item commands), Site View → Server
Room View → Rack View with the dialogs-first editor and drag-to-place,
click-to-connect with ghost handling plus rack/Server Room scoped Batch Runs,
and the AI pass — rack-topology page context, the approval-gated rack-layout
assistant tools, the `itops-changed` live-reload listener, per-device accent
colour-coding, and selective export/import inclusion of racks and rack items.
Drag-resize inside the Rack View remains the one open visual polish item; every
other behavior in this document reflects shipped code.

## Risks & open questions

- **Rename blast radius** (26 frontend files incl. 14 locales, 9 backend files,
  8 docs, the `itops_host_groups` table, and `host_group_id` columns/wire
  fields). Phase A isolates it so the topology work reviews cleanly on top.
- **Connection hydration in the Rack View** — the Site store holds
  `ResolvedHost` summaries, not full `Connection`s; click-to-connect needs the
  full object. Resolve via a selector over the existing connections store
  rather than widening `ResolvedHost`.
- **Server Room entity** — Server Rooms are first-class Site-owned rows so they
  can exist without Racks and accept more relationships later. Rack rows retain
  the room name for compatibility while storage validates same-Site ownership.
- **Multi-Site placement** (chosen model) means a host can occupy slots in
  several Sites — intended, but the UI should make a host's other placements
  discoverable so users don't think a host is "missing."

## Checks before handoff (per phase, per `AGENTS.md`)

`npm run check` && `npm run build` && `cargo check`/`cargo test`
(`--manifest-path src-tauri/Cargo.toml`). Native rack drag/drop, click-to-open
across ssh/rdp/vnc, and keychain-backed opens must be validated in the real
Tauri desktop runtime, not Vite/browser preview.

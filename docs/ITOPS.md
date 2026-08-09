# IT Ops Module Architecture

The IT Ops Module is a built-in Activity Rail destination for site
operations: organizing Sites and their topology, maintaining Host inventory,
and running reusable Tasks across selected Hosts.

This document describes the durable architecture. The decision record and
its trade-offs live in `docs/ADR/0011-it-ops-module.md`. When this doc
conflicts with `docs/ARCHITECTURE.md`, this doc wins for IT-Ops-internal
concerns.

## Scope

The IT Ops Module owns:

- **Sites** — durable named selections of existing Connections used as site
  targets, plus the optional Site → Server Room → Rack topology.
- **Hosts** — a per-Site durable inventory of devices and their VM/container
  guests, imported from hostname lists and scanned for remote-access
  endpoints (see "Hosts" below).
- **Tasks** — global reusable script or Playbook definitions. A Task owns what
  to execute but never owns targets; a Site or Host selection supplies targets
  when the Task launches.
- **Batch Runs** — fan-out task execution across a Site with
  per-host live output and a consolidated, saved run report.
- **IPAM** — the global VLAN / IP Prefix / IP Address Record plan, with VLAN
  and IP Prefix rows in one typed grid plus derived Prefix containment nesting
  and utilization (see "IPAM" below).
- **Network Maps** — global hand-drawn logical link diagrams (see "Network
  Map" below).
- The Tauri commands the AI Assistant uses to draft and manage Sites, Hosts,
  Tasks, topology, and Batch Runs.
- The IT Ops page-context projection supplied to the shared AI Assistant
  panel.

It does not own:

- The durable **Connection** model or Connection Tree (it only references
  Connection ids; `src/modules/workspace/`).
- **Secret** storage (SMTP/webhook/WinRM credentials live in the OS
  keychain under existing secret owners).
- The **Install Helper** catalog (the PsExec recipe is a normal catalog
  entry; `src-tauri/installer/`).
- Selective export/import shape (extends the ADR-0010 flow; it does not
  fork it).

## Why this is one Module, not separate features

Sites, Host inventory, Tasks, Batch Runs, and Run History share one target
model and one fan-out executor. The UI keeps the primitive explicit:
**Task + targets → Batch Run**. Tasks are global to IT Ops so the same
definition can run against several Sites without duplication.

## Domain Concepts

**Site** — a durable, named selection of site targets, stored in
`itops_sites`. It carries an ordered set of Connection ids plus an
optional dynamic filter (by Connection type and/or folder) resolved at
run time. A Site is **not** a Connection and owns no Session and no
secret. Resolving a Site yields a concrete list of Connections at
the moment a run starts; dynamic filters mean later-added Connections are
picked up automatically.
_Avoid_: host list, inventory, connection group (as a Connection type)

**Site View** — the top-level topology view for one selected Site. It shows
Server Rooms and is the entry point into Server Room View and Rack View.

**Server Room** — a plain-text grouping tag on a Rack inside a Site. It is
not a first-class database entity and owns no Connections, Sessions, or
credentials.

**Server Room View** — the drill-down view for one Server Room, showing its
Racks grouped by the optional per-Rack `rack_group` tag.

**Rack** — a durable fixed-height cabinet in one Site and one Server Room.
It stores Rack Devices at U positions on independent Front and Rear mounting
faces but owns no live Session state.

**Rack View** — the single-Rack drill-down stage where Rack Devices are
opened, placed, or edited. It shows Front and Rear elevations side by side
when both faces contain devices, and always exposes both while editing.

**Rack Device** — a visual device occupying a U span on a Rack's Front or Rear
mounting face. Each face validates U-space independently; a rack-top 乖乖 item
belongs to the whole cabinet. A device may be Connection-backed or passive. It
is stored in `itops_site_rack_items`; older code/schema may still use the
`RackItem` name.

**Rack Device Type** — the finite device kind that controls faceplate
rendering and properties; it is not a Connection type.

**Rack Device Properties** — non-secret presentation metadata for a Rack
Device. Never store credentials or live Session state here.
Server Rack Devices may use a rack or tower form factor; tower is a half-width
faceplate presentation and does not change vertical U occupancy. A Server may
also select Default, Style 1, or Style 2 front-panel artwork independently of
its form factor and shell finish. Style 1 uses height-specific chassis artwork:
3–4U has a two-row lattice over a deep drive wall, while 5U and taller keeps
the lattice in the upper faceplate and exposes a separate lower expansion-card
and grille section instead of vertically stretching the 1U design.

**Host** — a durable inventory entry for one device or guest in a Site,
addressed by hostname and stored in `itops_hosts`. The device itself can be a
Host; a Host may carry **child Hosts** (its VMs or containers) via a soft
`parent_host_id` self reference — deleting a Host re-parents its children one
level up rather than dropping them. A Host binds any number of Connections at
once (`connection_ids_json`, ordered soft refs) — e.g. an SSH terminal plus an
HTTPS URL Connection to its management interface. Hosts are imported from a
pasted hostname list (blank/duplicate lines skipped) and then scanned with
bounded-concurrency TCP probes for SSH (22), WinRM (5985/5986), and HTTPS
(443); the scan snapshot is stored on the Host (`scan_json`) as data, never
live Session state and never a secret, and per-host results stream on the
`itops://host-scan` event channel. A Rack Device may reference a Host through
`metadata.hostId` so the Rack View balloon callout lists the Host and its
child Hosts. Storage lives in `src-tauri/src/itops/host_storage.rs`; the
Site-owned Hosts page is implemented by `src/modules/itops/HostsPanel.tsx`.
Each Host row also shows its current Batch Run state (queued, running,
succeeded, or failed) while a run is active, plus the newest persisted run
result for that Host in a separate Last run status column. That page owns
manual execution targeting: the operator selects Hosts with SSH
Connection bindings, chooses a reusable Task or ad-hoc Script Batch Task, and starts a
Batch Run scoped to exactly those Host ids.
_Avoid_: node, agent, connection host field

**Transport** — how a Batch Run reaches one host. Per host (derived from
the Connection, overridable per Site/run):

| Transport | Reaches | Backend |
| --- | --- | --- |
| `ssh` | SSH/Linux hosts and Windows hosts running OpenSSH | existing `russh` exec channel — no new transport code |
| `winrm` | Windows hosts over WS-Man/HTTP(S) | pure-Rust WinRM client; standard path for Windows Update playbooks |
| `psexec` | Windows hosts over SMB/named pipes | Sysinternals `PsExec` shipped via an Install Helper recipe |

**Batch Task** — what a run executes on every targeted host. Two kinds:

- `script` — a free-form command/script body the user supplies, sent to
  each host's transport.
- `playbook` — an **interactive, expect-style step sequence** the user
  authors: an ordered list of steps where each step **sends** a command or
  input into the host's PTY shell and optionally **waits for** a literal
  output substring (a prompt) before the next step runs. This handles
  flows a one-shot script cannot — e.g. answer a `[sudo] password:` or
  `Continue? [Y/n]` prompt mid-command. A step whose `expect` does not
  appear within its timeout fails, which **stops the playbook on that
  host** (other hosts continue). Steps run over a **single shell per
  host**, so later steps see the state earlier steps left behind.

**Task** — a durable reusable Batch Task stored in `itops_tasks`. A Task has a
name, optional description, and one script or Playbook definition. It has no
Site id, Host ids, plaintext credentials, or live state. A sudo node may keep
an opaque secret-vault reference; the password itself never enters Task JSON.
The operator chooses targets at
launch time. Deleting or editing a Task never rewrites completed Run History, whose report
keeps a redacted task-summary snapshot. The Task Library editor supports both
script Tasks and reusable Playbooks. Playbooks use an ordered node-canvas
language and remain a linear chain rather than a free-form DAG.
_Avoid_: Site task, saved Batch Run

**Batch Run** — one execution of a Batch Task against a resolved Host
Site. Live run state (per-host status, streamed stdout/stderr, exit
codes, cancellation) is **in-memory**; on completion a consolidated
report is written to `itops_run_history`. Concurrency is bounded
(mirroring the Connection Batch Importer's network-scan fan-out in
`src-tauri/src/import.rs`); a single slow or black-holed host must not
stall the others or the UI thread.

**IP Prefix** — a durable IPv4 CIDR block in `itops_ip_prefixes`, with a
role, status (`container` / `active` / `reserved` / `deprecated`), optional
VRF, optional soft Site reference, and description. Host bits are cleared on
save, so the stored `cidr` is always the network address. `/31` and `/32`
keep every address (RFC 3021).
_Avoid_: subnet record, network object

**IP Address Record** — a durable single IPv4 address in
`itops_ip_address_records`, with an optional hostname, broad device type,
free-text device model, status, VRF, description, optional direct Site binding,
and soft references back to the Host, Connection, or Rack Device it was
imported from. Binding a Host implies that Host's Site; a Site binding remains
valid without a Host. With neither, the record inherits the Site of its
most-specific containing IP Prefix. It is a documentation record, not a lease
or a reservation KKTerm enforces anywhere.
_Avoid_: IP entry, host record (that is **Host**)

**VLAN** — a durable global record of an 802.1Q VLAN in `itops_vlans`: `vid`
(1–4094, unique), name, description, an optional soft `site_id` that only
labels it, and an `accent` **index** into the frontend `IT_ACCENTS` list
(resolved modulo its length, so no stored value can be invalid — never a hex
colour, per `docs/DESIGN_LANGUAGE.md`). A VLAN is a table rather than a field
inside a Network Map's `graph_json` because VLAN 30 drawn on two maps has to
be the same VLAN; map-local VLANs would make that a coincidence of spelling
and would need a dedup migration across every saved graph to promote later.
An **IP Prefix** joins to it through a soft `vlan_id`, which documents
"VLAN 30 is 10.20.30.0/24" without conflating the two — a prefix references a
VLAN, it is not one, so IPAM's _Avoid: VLAN_ stays literally true. Deleting a
VLAN clears that reference and deletes nothing else.
_Avoid_: subnet, broadcast domain (as the stored entity), IP Prefix

**IPAM** — the global Module surface over those three durable tables, standing
outside the Site tree in the navigator's Networking section next to Network
Maps. VLANs and IP Prefixes appear in one typed record grid; IP Address
Records remain nested beneath their containing Prefix. Its
tree nesting, per-prefix `depth`, child counts, and utilization are
**derived on every snapshot** from containment and VRF, never stored: adding
a wider prefix silently re-parents everything it now contains, and no
migration or repair pass is needed. Utilization counts documented addresses
against usable addresses; nothing is scanned or probed automatically.

**Network Node** — one resizable shape on a Network Map: id, label, kind,
rectangle/circle/diamond/triangle/hexagon silhouette, canvas position and size,
Network Map palette or custom icon background, lock state,
interface inventory, optional note, documented status (`up` / `warning`), and
ordered soft deep links. Kinds are grouped in the designer as Core & Routing (`router`,
`gateway`, `switch`, `switchL3`, `hub`), Security (`firewall`, `vpnGateway`,
`idsIps`), Traffic Management (`loadBalancer`, `proxy`, `dns`), Compute &
Storage (`server`, `database`, `storage`), Cloud & WAN (`cloud`, `isp`),
Wireless (`accessPoint`, `wirelessController`), and Endpoints (`desktop`,
`laptop`, `smartphone`, `iot`, `voip`, `printer`, `camera`). The bottom Others
group contains Generic (`generic`), Geomap (`geomap`), and Note. A Generic node
remains behaviorally generic while its `icon_kind`
chooses any built-in device artwork. A Geomap is resizable cosmetic artwork backed by the built-in
world-map SVG; its normalized zoom and pan viewport are saved with the node so
the Properties dialog can select a crop from 100% through 10,000% before
placement. Its Properties dialog accepts pixel width and height without an
upper cap, so it can span the full drawing as geographic background artwork;
Geomaps do not expose canvas resize handles. The canvas Geomap shows only that
artwork, without label, caption, note, status, interface handles, or extra
status text. Its Properties dialog exposes only the artwork tint and map viewport; it
does not expose device label, type, status, interface, or note fields. A Geomap
cannot be an endpoint for a new Network Link. The address is a
caption drawn under the label; it is not a foreign key into IPAM. Status is
operator-authored documentation, not a polled device state.

**Deep Link** — an in-app navigation relationship from one KKTerm app element
to another. For Network Maps, the source app element is a Network Node and the
destination app element is selected through one durable soft reference. The
closed destination kinds are Connection
(`connection_id`), Site (`site_id`), Server Room (`site_id` plus the durable
room name), and Rack Device (`site_id`, `rack_id`, and `rack_item_id`). Deep
Links are not web URLs, external app links, bindings, or Network Links, and
never imply verified connectivity. Storage trims and
deduplicates them but deliberately does not validate the target: if a target is
later deleted, the map still loads and shows an unavailable destination that
can be removed from Node Properties.

**Network Link** — one **undirected** edge between two Network Nodes, with
an optional label naming the whole link (a circuit id, an uplink name — **not**
a port and **not** a VLAN, both of which are now structured), a kind
(`ethernet` / `fiber` / `wan` / `wireless`), documented status (`up` /
`warning` / `down`), an ordered list of **strands**, and its VLAN membership.
Undirected is deliberate: a link documents the relationship between its
endpoints, not a traffic direction or a verified connection. The stored link
carries no handle/anchor fields — the canvas picks the two anchors
geometrically at render time. The canvas draws an animated traffic trace over
each route: green means healthy, amber means degraded, and red means down.

**Network Link Strand** — one of the parallel physical links a drawn Network
Link stands for: an id, a free-text port name, and a free-text speed. Port
names and speeds live per strand rather than per link because a 2×10G LAG
lands on a different port at each end of each member. `sanitize_graph`
guarantees at least one strand and folds the pre-strand `connectionCount` /
`speed` pair from older saved graphs into the list on read, then stops writing
those fields back. `strand_display` is either `separate` (the default for
existing maps, with every strand drawn) or `bundle` (one thicker line). Both
presentations keep the complete per-strand speed inventory in the opaque edge
readout.

**VLAN membership on a Network Link** — `native_vlan_id` (the untagged VLAN)
and `tagged_vlan_ids` (the 802.1Q VLANs it trunks), both soft references into
`itops_vlans` and both `#[serde(default)]`, so saved graphs need no migration.
A non-empty tagged set makes the link a trunk. The native VLAN is dropped from
the tagged set on save because untagged-and-tagged is a contradiction, not
extra information. VLAN ids are deliberately **not** validated against
`itops_vlans` on save: a map keeps documenting the VLAN it was drawn with
after the record is renamed or deleted. **Network Nodes carry no VLAN field** —
"VLANs terminated here" for an L3 switch is tempting and speculative.
Rendering rules: VLANs are never mapped onto the strands (a 2×10G LAG carrying
six VLANs is two strands, not six), there is no VLAN node kind (a VLAN is not
a box on the canvas), and the overlay is a side-panel legend whose selection
dims every link that does not carry the VLAN through `.nm-edge.dimmed`.

**Network Map** — a durable named canvas in `itops_network_maps`, global
like IPAM with an optional soft Site reference that only tags it. The whole
graph (nodes, links, and notes) is persisted as one `graph_json` document,
following the Room Objects JSON precedent rather than a row per node.
_Avoid_: topology, topology map, network topology — "topology" is already
the physical Site → Server Room → Rack drill-down and must not be reused.

Network Maps currently have no entry-point registration, reachability
analysis, connection verification, discovery, or polling. A later verification
flow must define its own explicit semantics instead of inferring health from
whether a hand-drawn node is connected to the first node in document order.

## Persistence

Three SQLite tables (new schema version):

- `itops_sites` — id, name, ordered Connection ids, optional dynamic filter,
  and a legacy transport fallback retained for storage compatibility. Site
  Properties does not expose transport; new Sites use `auto`, and current Host
  execution resolves from bound Connections.
- `itops_site_racks` / `itops_site_rack_items` — Site topology and Rack
  Devices. Pure metadata; Connection ids are soft references.
- `itops_hosts` — per-Site Host inventory: hostname, label, kind
  (physical/vm/container/other), soft `parent_host_id` self reference for
  child Hosts, ordered soft Connection references, and the last
  connectivity-scan snapshot. No secret, no live state.
- `itops_automations` — retained legacy definitions only. Schema version 55
  sets `enabled = 0` and stamps `obsolete_at` without rewriting the saved
  trigger, condition, actions, or runtime JSON. The table remains in full
  backups and selective IT Ops exports but has no product execution path.
- `itops_run_history` — id, source (manual run or retained legacy source), task
  summary, started/finished, per-host outcome summary, consolidated
  report blob. Local-first; no telemetry.
- `itops_tasks` — global reusable Task definitions: id, name, description,
  ordered position, and typed `BatchTask` JSON. No target or live state.
- `itops_vlans` — global VLAN records: id, `vid` (unique 1–4094), name,
  description, an optional soft `site_id`, and an `accent` index. Deleting a
  row clears the soft `vlan_id` on any IP Prefix that referenced it; Network
  Link references live inside each map's `graph_json` and simply stop
  resolving, which the canvas renders as an unknown VLAN.
- `itops_ip_prefixes` — global IP Prefixes: id, normalized `cidr`, `vrf`,
  role, status, description, an optional soft `site_id`, an optional soft
  `vlan_id` into `itops_vlans`, unique on `(vrf, cidr)`. Parent, depth, child counts, and utilization are **not**
  columns; they are recomputed on every snapshot from containment.
- `itops_ip_address_records` — global IP Address Records: id, `address`,
  `vrf`, status, hostname (`dns_name`), optional broad `device_type`, free-text
  `device_model`, description, plus soft `site_id` / `host_id` /
  `connection_id` / `rack_item_id` references, unique on `(vrf, address)`.
  A record belongs to a prefix by containment and matching VRF, not by a
  stored parent id. A valid Host binding makes its owning Site authoritative;
  `site_id` may also stand alone when no Host is selected. With neither
  binding, the snapshot derives the Site from the most-specific containing
  p…8901 tokens truncated…umented-free addresses; atomically import a create-only structured batch;
read an explicitly named `.xlsx` workbook; and run the explicit Prefix scan.
When the user pastes prose, a copied table, CSV, or rough notes, the model first
reads the snapshot and VLANs, converts only explicit facts into the typed batch,
and submits one `itops_import_ipam` call for new records. Existing records use
their typed update tool so full-value fields and bindings can be preserved.
Material ambiguities are presented to the user instead of invented. Every
write remains approval-gated in the in-app assistant. Built-in MCP publishes
the same operations under `kkterm.itops.ipam.*`; local workbook reads and
active network scans are in the `dangerous` namespace.

Network Maps remain UI-only. The assistant sees the destination and loaded
counts so it can navigate and highlight it, but it does not read or rewrite
saved graph documents.

## Retired Monitor data

Schema version 55 retires the former durable Monitor feature. The migration
adds `obsolete_at`, sets every legacy `itops_automations.enabled` value to
false, and stamps rows once while preserving their remaining payload exactly.
The table stays in the IT Ops selective-export segment and full database
backups. Selective import applies the same obsolescence update inside its
transaction. No frontend destination, startup hydration, Tauri command,
assistant tool, or built-in MCP tool reads these rows as runnable definitions.
The standalone in-memory Watchdog remains independent.

## Concrete Data Model

This historical section grounds the original durable shape in the existing
storage conventions (`src-tauri/src/storage.rs`). `CURRENT_SCHEMA` defines the
current baseline with idempotent `CREATE TABLE IF NOT EXISTS` statements, while
`PRAGMA user_version` selects either the migration path or the current-version
startup fast path. Adding tables requires updating `CURRENT_SCHEMA`, bumping
`SCHEMA_USER_VERSION`, adding a version-gated upgrade, and auditing whether any
ongoing seed reconciliation must also run on the fast path; follow
`docs/ARCHITECTURE.md` → "Schema initialization and migrations". The original
change described here was schema 26 → 27.
Ordered lists use an integer `sort_order` column, matching
`dashboard_widget_instances`. It predates the Site rename and topology tables;
use the Scope, Domain Concepts, and `docs/SITE.md` sections above for current
terminology. Heavy/structured fields that are not queried
relationally are stored as JSON `TEXT` columns, matching
`dashboard_custom_widgets.body_json` and `settings_schema_json`.

### SQLite tables (appended to `CURRENT_SCHEMA`)

```sql
-- A named selection of existing Connections used as a site target.
CREATE TABLE IF NOT EXISTS itops_host_groups (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    sort_order      INTEGER NOT NULL,
    -- Ordered Connection ids: JSON array of strings, e.g. ["conn-1","conn-2"].
    member_ids_json TEXT NOT NULL DEFAULT '[]',
    -- Optional dynamic filter resolved at run time: {"types":["ssh"],"folderId":"..."}.
    filter_json     TEXT,
    -- Per-host-group transport default: 'ssh' | 'winrm' | 'psexec' | 'auto'.
    transport       TEXT NOT NULL DEFAULT 'auto'
        CHECK (transport IN ('ssh', 'winrm', 'psexec', 'auto')),
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Retained obsolete Monitor definitions. No runtime reads this table.
CREATE TABLE IF NOT EXISTS itops_automations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    sort_order    INTEGER NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 0,
    -- Retained legacy JSON payloads.
    trigger_json  TEXT NOT NULL,
    -- Tagged-enum JSON of PredicateOp, or NULL for unconditional triggers.
    condition_json TEXT,
    -- JSON array of typed actions, executed in order.
    actions_json  TEXT NOT NULL DEFAULT '[]',
    -- Optional durable Site binding (soft reference; NULL = unbound).
    site_id       TEXT,
    -- Loop settings (poll_ms, stop, sustained_for_ms, suppression_ms): JSON object.
    runtime_json  TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    obsolete_at   TEXT
);

-- One completed Batch Run. Append-only.
CREATE TABLE IF NOT EXISTS itops_run_history (
    id             TEXT PRIMARY KEY,
    -- New runs use 'manual'; old rows may retain 'automation:<legacy_id>'.
    source         TEXT NOT NULL,
    host_group_id  TEXT,            -- soft reference; runs survive group deletion
    task_summary   TEXT NOT NULL,   -- redacted one-line task label, never the script body of secrets
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    -- Consolidated report: per-host {connectionId,host,transport,exitCode,ok,
    -- bytesOut,output} rows. `output` is the captured combined stdout/stderr,
    -- capped per host (runner::cap_output) so the Run Report viewer can replay it.
    report_json    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_itops_run_history_source
    ON itops_run_history(source, started_at);

-- A reusable global Task definition. Targets are supplied when launched.
CREATE TABLE IF NOT EXISTS itops_tasks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL,
    task_json   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- IPAM. Only what the operator typed is stored: hierarchy, depth, and
-- utilization are recomputed on every read, so the tree can never disagree
-- with its rows. UNIQUE(vrf, cidr) lets overlapping RFC 1918 space coexist
-- in different routing tables.
CREATE TABLE IF NOT EXISTS itops_ip_prefixes (
    id          TEXT PRIMARY KEY,
    -- Canonical 'a.b.c.d/len' with host bits cleared.
    cidr        TEXT NOT NULL,
    vrf         TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL DEFAULT '',
    -- 'container' | 'active' | 'reserved' | 'deprecated'.
    status      TEXT NOT NULL DEFAULT 'active',
    description TEXT NOT NULL DEFAULT '',
    site_id     TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vrf, cidr)
);

-- One documented address. site_id / host_id / connection_id / rack_item_id
-- are SOFT references: an address stays documented after whatever it pointed
-- at is deleted, which is the whole point of an address record. A Host binding
-- implies its owning Site, while site_id can stand alone.
CREATE TABLE IF NOT EXISTS itops_ip_address_records (
    id            TEXT PRIMARY KEY,
    address       TEXT NOT NULL,
    vrf           TEXT NOT NULL DEFAULT '',
    -- 'active' | 'reserved' | 'deprecated'.
    status        TEXT NOT NULL DEFAULT 'active',
    dns_name      TEXT NOT NULL DEFAULT '',
    device_type   TEXT NOT NULL DEFAULT '',
    device_model  TEXT NOT NULL DEFAULT '',
    description   TEXT NOT NULL DEFAULT '',
    site_id       TEXT,
    host_id       TEXT,
    connection_id TEXT,
    rack_item_id  TEXT,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vrf, address)
);

-- A Network Map. graph_json holds the whole document (nodes, links, and
-- notes); the canvas is
-- always saved as a unit, so per-node rows would buy no query the UI makes.
CREATE TABLE IF NOT EXISTS itops_network_maps (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    site_id     TEXT,
    sort_order  INTEGER NOT NULL,
    graph_json  TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`itops_run_history` uses a **soft** `host_group_id` (no `REFERENCES`) so
deleting a Host Group does not erase its run history; the Dashboard tables
use hard `ON DELETE CASCADE` where cascade is desired, and this is the
deliberate opposite choice for an audit log.

### Rust types (`src-tauri/src/itops/types.rs`)

```rust
/// What a Batch Run executes on each targeted host.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BatchTask {
    Script { body: String, shell: Option<String> },
    Playbook { name: String, steps: Vec<PlaybookStep> },
}

/// One interactive step: send text into the host's PTY shell, then (optionally)
/// wait until `expect` appears in the output before the next step runs. A step
/// that times out waiting for `expect` fails and stops the playbook on that host.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybookStep {
    pub id: Option<String>,            // stable editor identity
    pub kind: PlaybookStepKind,        // command (default) or sudo
    pub name: String,
    pub send: String,
    pub expect: Option<String>,        // literal substring; None = don't wait
    pub timeout_seconds: Option<u64>,  // falls back to the run default
    pub secret_owner_id: Option<String>, // vault reference only; sudo nodes
    pub ai_instruction: Option<String>, // closed decision prompt; AI nodes
}

/// Common transport interface; SSH/WinRM/PsExec each implement it.
pub trait Transport {
    /// Bounded, non-blocking; streams output frames on the returned channel.
    fn exec(&self, host: &ResolvedHost, task: &BatchTask) -> ExecStream;
}
```

### Secrets

Reuse the existing keychain owner model (`src-tauri/src/secrets.rs`) for
transport and Task credentials. SQLite stores only non-secret references;
Playbook sudo secrets use Task-owned vault references.

## Implementation Phases

Sequenced so each phase ships something testable and the Watchdog keeps
working throughout. Each phase is one reviewable PR unless noted.

**Phase 0 — Module shell (no behavior change).** Add `ActivePage`
`"itops"`, the rail button + `itops.railLabel` i18n key, the `App.tsx`
mount/route arm (mirroring `installerMounted`), an empty
`src/modules/itops/` page with three placeholder tabs, and the `itops`
i18n namespace. No backend. Proves navigation and unblocks parallel work.

**Phase 1 — Host Groups (durable CRUD).** Schema bump to 27 with
`itops_host_groups`; `src-tauri/src/itops/storage.rs` repository
(add/list/update/remove/reorder) mirroring `dashboard_storage.rs`; typed
commands in `itops/commands.rs` registered in `generate_handler!`; the
Host Groups tab UI with a Connection multi-select + optional filter.
Resolver function turns a group into a concrete `Vec<Connection>` at run
time. Include Host Groups in selective export/import (ADR 0010).

**Phase 2 — Batch Run executor over SSH.** `itops/runner.rs` worker pool
reusing the `import.rs` `Semaphore`/atomic-progress/`app.emit` pattern;
the `Transport` trait with the SSH adapter built on the existing `russh`
exec path; live per-host run grid UI fed by an `itops://run` event
channel; write the consolidated report to `itops_run_history` on finish.
`BatchTask::Script` only. This delivers the headline "send a script to all
SSH hosts and get results back."

**Retired phases 3–5.** The former Monitor persistence, action catalog, and
trigger extensions were removed at schema version 55. Their stored definitions
remain obsolete for recovery only, as described above.

**Phase 6 — WinRM + PsExec transports.** The thin WinRM/WS-Man client per
ADR 0012 (`reqwest` + `sspi` + `quick-xml`, new `WinrmPassword` secret);
the PsExec adapter with its Install Helper catalog recipe. Both implement
the same `Transport` trait, so the Phase 2 runner and UI are unchanged.

**Phase 7 — Interactive playbooks.** `BatchTask::Playbook` as an ordered,
expect-style step sequence (`send` + optional `expect` + per-step
timeout) run over a single PTY shell per host via
`ssh::run_playbook_capture_streaming`. A step that times out waiting for
its `expect` stops the playbook on that host; the live grid and saved Run
Report reuse the Script path's per-host streaming and report shapes
unchanged. SSH first; WinRM/PsExec inherit the same step model once those
transports grow an interactive channel.

**Phase 8 — AI Assistant integration.** Register IT Ops mutating commands
as approval-gated assistant tools; emit `itops-changed` and add the
store-reload listener (mirroring `dashboard-changed`); add the compact,
metadata-only page-context projection.

**Phase 9 — IPAM and Network Maps.** Schema bump to 51 with
`itops_ip_prefixes`, `itops_ip_address_records`, and `itops_network_maps`;
pure IPv4 maths in `src-tauri/src/itops/ipv4.rs`; repository +
snapshot-derives-everything reads in `ipam_storage.rs` and
`network_map_storage.rs`; twelve Tauri commands; two global Networking
destinations in the navigator (`IpamPanel.tsx`, `NetworkMapDesigner.tsx`);
and the hand-drawn Network Map canvas. No assistant or MCP tools yet, and **no
dependency on live device state** — the SNMP scaffolding stays future
preparation.

**IPAM Address Site binding.** `itops_ip_address_records.site_id` is an
optional soft direct binding. Schema v52 repairs v51 databases whose already
created IPAM tables predated the nullable `site_id` columns; no data backfill is
needed. New writes derive Site from a valid Host binding,
while Site-only records remain valid. Snapshot reads also derive Site from the
most-specific containing bound prefix when the address has neither, preserving
the containment model without a stored prefix id or reconciliation writes.

**Phase 10 — IPAM discovery and optional-Site repair.** Schema bump to 52
adds the version-gated nullable `site_id` repair for both IPAM tables. The
explicit scan combines ping, SNMP, and common TCP full-connect probes over
operator-selected Prefixes, with a 4,096-address request cap and transient
results that are durable only after an explicit import.

**Phase 11 — IPAM device identity.** Schema bump to 53 adds optional
`device_type` and `device_model` columns to IP Address Records. Explicit scans
enrich responsive results with bounded PTR reverse DNS, SNMP MIB-II
`sysDescr` / `sysObjectID` / `sysName`, and conservative distinctive-port
fallbacks. Existing and uncertain records remain blank; there is no current-
version startup reconciliation.

**Phase 12 — VLANs and per-link parallel-link records.** Schema bump to 54
adds `itops_vlans` and the version-gated nullable `vlan_id` on
`itops_ip_prefixes` (the table itself is covered by `CREATE TABLE IF NOT
EXISTS`; only the column on an existing prefix table needs backfilling — the
same failure v52 repaired for `site_id`). Four Tauri commands, VLAN management
integrated into the IPAM destination (`IpamPanel.tsx` and its shared
`VlanDialog`), the soft `vlanId` on the IP Prefix dialog, and on a Network Link
a `strands` list plus `nativeVlanId` /
`taggedVlanIds`, all `#[serde(default)]` so saved graphs need no migration —
`sanitize_graph` folds the pre-strand `connectionCount` / `speed` pair into
`strands` on read. The designer gains the VLAN spotlight overlay.

Two deliberate non-goals in this phase. **Network Maps do not verify
connectivity or infer reachability from VLAN membership**: the VLAN spotlight
is a visual documentation filter only. **Nothing auto-parses "VLAN 30" out of
existing free-text link labels**: silently reinterpreting operator prose as
structured data is how you get wrong documentation that looks authoritative.
`linkLabelHint` therefore stopped advertising VLAN when the structured field
landed, so the two are never double-entered.

The shipped phases are historical implementation notes; the retired Monitor
phases are not part of the current product.

## Planned / Deferred Enhancements

The plumbing above is complete (Sites, SSH Batch Runs, playbooks, and AI
integration), but from an
operator's seat the Module today is mostly a transport: it returns N raw
per-host output blobs and a flat list of names. The enhancements below turn it
into something that produces _answers_ and a site you _see_. They are captured
here so the design is not lost; sequence them by demand.

**Site management (implemented, detailed in `docs/SITE.md`).** Host Group is
renamed to **Site** across the product: the table is `itops_sites`, the
run-history soft reference is `site_id`, and commands/i18n use the Site term.
The Site topology layer adds per-Site **Server Rooms**, **Racks**, and **Rack
Devices**. Racks are drawn as full rack elevations with independent Front and
Rear mounting planes and may hold placed
Connections (click to open ssh/rdp/vnc/etc.) or passive items (switch, PDU,
patch panel). Scoped Batch Runs use Server Room / Rack scope. See
`docs/SITE.md` for the detailed data model and product terminology.

The following are noted for later consideration (not yet planned in detail):

1. **Run result synthesis (low-hanging).** A Batch Run already persists
   per-host `{exitCode, ok, output}` in `itops_run_history.report_json` and
   `RunReportView` replays the text. Add a synthesis layer over that _existing_
   data: an **aggregate view** (group hosts by identical output / exit code —
   "27 OK, 2 disk 94%, 1 unreachable"), an **outlier/diff** mode (show only
   hosts whose output differs from the majority — site drift), and an
   **AI run summary** that reads the finished report and writes a verdict.
   Mostly frontend + AI over data the backend already stores; highest
   value-per-effort. Reframes a run from "30 transcripts" to "one answer."

2. **Built-in task library (cheap quick win).** A new Batch Run today is an
   empty textarea. Ship a curated, per-OS task catalog (disk/mem/uptime,
   who's-logged-in, service status, package-update dry-run, security-patch
   status) so the tool is usable in the first 30 seconds. Matches the ROADMAP
   "reusable workflow templates" item.

## `CONTEXT.md` Vocabulary

> **Watchdog**:
> An ad-hoc live check that samples a target (performance counter, SSH Session
> output silence, ping, or TCP reachability) against a predicate. Its
> running state —
> ticks, trigger log, state machine, suppression window — is **in-memory
> only and does not persist across app restart**. Surfaced through the **Watchdog Status Bar**
> indicator and a detail panel, not as a Connection or Session. See
> `src-tauri/src/watchdog/` and `src/watchdog/`.
> _Avoid_: monitor profile, durable watcher, automation rule
>
> **IT Ops Module**:
> A built-in Activity Rail Module for site operations: **Sites**,
> **Hosts**, **Tasks**, and **Batch Runs**. Its current primary UI is the Site
> topology surface. Lives with Dashboard and Install Helper above Settings.
> Not a Connection, Session, or Dashboard widget. See `docs/ITOPS.md` and
> `docs/ADR/0011-it-ops-module.md`.
> _Avoid_: operations center, site manager, orchestrator
>
> **Site**:
> A durable, named selection of existing Connections (plus an optional
> dynamic filter by type/folder) used as the site target for Batch Runs.
> Stored in `itops_sites`; it
> references Connection ids and owns no Session and no secret. It is not a
> Connection type.
> _Avoid_: host group, inventory, host list, connection group (as a Connection type)
>
> **Batch Run**:
> One execution of a Batch Task (a one-shot script or an interactive,
> expect-style playbook) across a resolved Site, fanned out with
> bounded concurrency over a per-host transport (SSH, WinRM, or PsExec).
> Live per-host progress and
> streamed output are in-memory; a consolidated report is written to
> `itops_run_history` on completion. The run is live runtime, not a
> durable definition.
> _Avoid_: broadcast, job, deployment

The matching `Namespace` entry in `CONTEXT.md` also gains an `itops`
namespace, and the **Activity Rail** entry lists IT Ops among the
built-in Modules.

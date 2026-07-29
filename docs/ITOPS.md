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
- **Network Maps** — global hand-drawn logical link diagrams plus the pure
  What-If reachability analysis over them (see "Network Map" below).
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

**Network Node** — one box on a Network Map: id, label, kind, canvas
position and size, Network Map palette or custom icon background, lock state,
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
artwork, without label, caption, note, status, interface handles, or entry-point
text. Its Properties dialog exposes only the artwork tint and map viewport; it
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
never affect reachability. Storage trims and
deduplicates them but deliberately does not validate the target: if a target is
later deleted, the map still loads and shows an unavailable destination that
can be removed from Node Properties.

**Network Link** — one **undirected** edge between two Network Nodes, with
an optional label naming the whole link (a circuit id, an uplink name — **not**
a port and **not** a VLAN, both of which are now structured), a kind
(`ethernet` / `fiber` / `wan` / `wireless`), documented status (`up` /
`warning` / `down`), an ordered list of **strands**, and its VLAN membership.
Undirected is deliberate: a link asserts mutual reachability, not a traffic
direction, and the reachability maths treats it symmetrically. The stored link
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
dims every link that does not carry the VLAN, reusing the dimming
`.nm-edge.severed` already establishes.

**Network Map** — a durable named canvas in `itops_network_maps`, global
like IPAM with an optional soft Site reference that only tags it. The whole
graph (nodes, links, and the `roots` entry-point id list) is persisted as
one `graph_json` document, following the Room Objects JSON precedent rather
than a row per node.
_Avoid_: topology, topology map, network topology — "topology" is already
the physical Site → Server Room → Rack drill-down and must not be reused.

**Entry point** — a Network Node id listed in the map's `roots`.
Reachability is measured from the entry points; with none marked, the first
node stands in so a half-drawn map still analyses.

**What-If** — the second mode of the Network Map designer. The operator
switches nodes and links off on the canvas and the panel reports which nodes
lose every path to an entry point, plus the **single points of failure**
(each node and each link that, alone, would cut something off) and any
stranded nodes with no link at all. This is pure graph maths over the drawn
map, in `src/modules/itops/reachability.ts`. **KKTerm has no live device
binding**: the existing `RackNetworkPort` / `RackSnmpHint` scaffolding and
`net::snmp::refresh_ports` are future preparation and feed nothing here.
The "down" set is only ever what the operator toggled, so a later SNMP or
polling feed can supply the same pure input without changing the analysis.

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
  prefix, so changing a prefix's Site immediately changes its otherwise-unbound
  records without rewriting them. The soft references let an address stay
  documented after whatever it pointed at is deleted.
- `itops_network_maps` — one row per Network Map: id, name, description,
  optional soft `site_id`, `sort_order`, and the whole node/link/roots graph
  as `graph_json`. Node and link ids are map-local; the one exception is each
  link's `nativeVlanId` / `taggedVlanIds`, which are soft references into
  `itops_vlans` and are remapped on selective import like any other soft id.

Durable definitions only. **Live state never persists**: in-flight Batch
Run progress stays in memory in the runtime layer, consistent with the
High-Risk Invariant against putting Session/runtime state in durable models.
Current-version startup does not reconcile legacy Monitor data because there
is no runtime capable of loading it. Selective IT Ops import marks imported
legacy rows obsolete inside the import transaction.

Secrets (WinRM/PsExec credentials)
live in the OS keychain under existing secret-owner ids; SQLite stores
only non-secret metadata and credential references. IT Ops state is
included in the selective export/import shape (ADR-0010) as non-secret
metadata.

## Runtime

The Batch Run executor is a worker pool: resolve the Site,
open one transport task per host under a concurrency cap, stream progress
events on a channel, and assemble the report. SSH reuses the existing
transport; WinRM and PsExec are new transport adapters behind a common
`exec(host, task) -> stream` shape.

All exec and WinRM/PsExec I/O run through
`spawn_blocking`/worker tasks and report by event — never blocking the
UI/native thread (`docs/ARCHITECTURE.md` command-runtime boundaries).

## Frontend

`src/modules/itops/` owns the Module shell. The visible shell uses one
resizable/collapsible operational navigator. Only the active Site needs to be
expanded. Each Site exposes predefined virtual destinations — **Server Rooms**,
**Hosts**, and **Run History** — while its topology continues
to drill down Server Room → Rack beneath Server Rooms. These destinations are
navigation state, not durable database entities or copied containers.

The global **Task Library** is a sibling of Sites rather than a child of every
Site. Opening a Task shows and manages its definition. Manual execution starts
only from selected Hosts; the Host-scoped launcher offers reusable definitions
from the Task Library alongside an ad-hoc Script option. This prevents duplicated
per-Site scripts and keeps target selection explicit.

Every Task carries multi-select Applicable OS metadata: `any`, `linux`, `macos`,
`windows`, `ciscoIos`, `ciscoNxos`, `fortiOs`, `junos`, or `aristaEos`. `any` is
exclusive with the specific values. This metadata drives Task Library display,
search, and filtering only; Hosts do not currently have a trusted OS identity,
so launch-time target selection does not silently exclude Hosts.

The app syncs a stable built-in diagnostic catalog into `itops_tasks` on startup.
It covers system identity, uptime, resource usage, network interfaces, routing
and DNS, and recent-log inspection for Linux, macOS, Windows, Cisco IOS,
Cisco NX-OS, FortiOS, Juniper Junos, and Arista EOS. Built-ins use stable ids and
catalog keys so Run History references survive catalog upgrades.
They are app-owned, read-only, non-deletable definitions; the UI duplicates a
built-in into an ordinary user Task before customization. Catalog commands are
inspection-only and must not install, reboot, reconfigure, or delete anything.

Creating or editing a Playbook opens a full ordered workflow editor. Command
nodes send text through one shared interactive shell. A sudo node runs
`sudo -S -v`, waits for a dedicated prompt, retrieves its password from the
configured secret vault, and validates elevation before later nodes continue.
Only the vault owner id is durable; plaintext is resolved in memory immediately
before the Batch Run and is never copied into SQLite or Run History. Removing a
sudo node or deleting its Task removes the associated vault entry.

An AI node evaluates the immediately preceding node output with the currently
configured AI Assistant provider. KKTerm sends that output as explicitly
untrusted data with tools disabled and requires one parsed JSON decision:
`continue` runs the next ordered node, `success` ends that Host successfully,
and `fail` stops that Host as failed. Any provider error, invalid JSON, or value
outside this closed enum fails the Host. AI nodes never turn model text into a
shell command or choose an arbitrary graph edge.

Hosts, Run History, and the global Batch Tasks and Networking
destinations (Task Library, IPAM, Network Maps) share one destination-page frame: the same content inset, compact title/description
header, right-aligned primary actions, divider, and bordered-row rhythm. The
Task Library keeps its spreadsheet-style Task table inside that frame rather
than owning a separate full-height chrome layout. Each row shows Task kind, Applicable OS,
execution count, failed-host count, and a link to the most recent Site Run
History containing that Task. Statistics use the Task's stable id; ad-hoc
and older unattributed history rows are never guessed by label.

IPAM (`src/modules/itops/IpamPanel.tsx`) reuses the Task Library's
spreadsheet-style table inside the same frame. Its Add button opens a menu for
creating either an IP Prefix or VLAN; both record types share the grid and have
an explicit Type column. Rows are grouped by their
optional Site tag, with Site-less or stale soft references collected under All
Sites. Within each Site group, Prefix rows retain the snapshot's containment order and
are indented by the server-derived `depth`, so indentation always matches real
containment; a twisty expands an IP Prefix to reveal its IP Address Records. The CIDR field
previews the network address, usable range, and usable count live while
typing (`previewCidr` in `ipamModel.ts`), and the address dialog suggests
free addresses from the same pure helpers. `collectClaimCandidates` derives
importable addresses from existing Connections and Hosts. Before import,
`suggestMissingPrefixes` groups selected uncovered addresses into editable `/24`
CIDR suggestions; every address must be covered by a confirmed suggestion or an
existing IP Prefix. The import creates those IP Prefixes before their Address Records
and probes nothing. Records that have no containing Prefix remain visible in an
Unassigned addresses group rather than disappearing from the IP Prefix-only tree.

The separate file import in `IpamImportDialog.tsx` accepts the canonical
create-only table format as CSV, TSV, or `.xlsx`. CSV/TSV parsing reuses the
already-bundled Papa Parse dependency; `.xlsx` parsing runs off the UI thread in
the Rust backend through Calamine with optional features disabled, reads the
first non-empty worksheet, and does not require Excel or downloaded runtime
code. `ipamImportModel.ts` validates and previews every row, resolves Site names
case-insensitively only when the match is unique, resolves Prefix VLAN references
by 802.1Q id, and skips existing identities or later duplicates without
overwriting them. The backend revalidates and creates VLANs, then Prefixes, then
Address Records in one SQLite transaction; any non-duplicate failure rolls the
whole batch back. The dialog generates the canonical CSV sample locally.

The IPAM toolbar's `itops.actions.export` menu saves every VLAN, IP Prefix, and
Address Record as `itops.export.csv`, `itops.export.tsv`, or
`itops.export.xlsx`. `ipamExportModel.ts` projects each format into the same
canonical columns accepted by file import instead of creating a second report
schema. CSV and TSV include a UTF-8 byte-order mark for desktop spreadsheet
compatibility. XLSX is a real Office Open XML workbook with one `IPAM`
worksheet, a frozen header row, and a column filter.

The explicit IPAM scan sheet is a separate operator action. It scans only
checked IP Prefixes and treats an address as used when ICMP ping, an SNMPv2c
identity request, or one of the common TCP management/service ports answers.
For responsive addresses, a bounded reverse-DNS PTR lookup supplies the
hostname, with SNMP `sysName` as fallback. SNMP `sysDescr` supplies model/product
detail and takes precedence when inferring a broad device type; only distinctive
service ports (printing, RTSP camera, or SIP) provide a port-only type fallback.
Ambiguous evidence leaves device type and model blank rather than inventing a
match.
The backend deduplicates overlap per VRF, caps a request at 4,096 usable
addresses, and limits address-level concurrency. Results are transient: the
scan itself writes nothing, already documented addresses are read-only in the
result list, and only checked new results become Address Records. A scanned
record copies the selected Prefix's optional soft Site tag; a Prefix with no
Site imports a record with `site_id = NULL`.

Network Maps (`src/modules/itops/NetworkMapDesigner.tsx`) is the one IT Ops
destination with a canvas. Its initial state is a card list of every map,
with a compact animated SVG preview and graph counts. The card list responds
to the destination's available width from one to four columns, and its search
matches map metadata plus every saved Network Node and Network Link field.
The overview alone owns its title, description, search, and New Map action.
Opening a card enters one full map workspace with only the map name centered in
the canvas toolbar; map selection and returning to the overview stay in the
left navigator. Each overview card has one bottom-right menu button for
Properties and Delete instead of exposing destructive icon actions on the
card. Every saved map also
appears as a depth-one child beneath the expandable Network Maps row in the IT
Ops navigator; selecting a child opens that map directly, while selecting the
parent opens the card list. A map child row's native context menu contains
Duplicate, Delete, then a separated final Properties item. Duplicate opens a
prefilled Properties dialog and creates a complete copy of the stored map;
Properties edits the map name, description, and optional Site tag. It uses
`@xyflow/react` with controlled `nodes`/`edges` via `useMemo`,
position-and-dimension-only `onNodesChange` filtering, `deleteKeyCode={null}`,
`proOptions={{ hideAttribution: true }}`. Because a Network Link is
undirected while xyflow edges are directed, every node renders one loose-mode
handle on each side (`left`/`right`/`top`/`bottom`), usable as either endpoint,
and the edge picks its
`sourceHandle`/`targetHandle` per render from the two node centres. The
custom edge renderer draws an orthogonal route as either every parallel strand
or one thickness-scaled bundle while keeping handle/anchor state out of the
stored graph. Its opaque, bordered readout is rendered above the route and
lists each strand speed in separate mode or speed-group counts in bundle mode.
Every route carries a reduced-motion-aware animated trace, colored from its
operator-authored healthy, degraded, or down status.
The editor is keyed by map id so switching maps remounts rather than carrying
unsaved edits across.

A map uses one canvas interaction mode: Network Nodes and Notes can always be
selected, moved, resized, linked, duplicated, deleted, or opened in Properties.
Changes save automatically after the interaction settles. The icon-only pen
action only opens or closes the right-side object browser; it does not change
canvas behavior. It is the only action in the active map's top-right toolbar;
map deletion remains in the navigator and overview-card menus. The object
browser owns placement and Import Hosts, while closing it gives the canvas the
full workspace width. With the object browser closed, a subtle pointer-
transparent summary floats at the canvas's top left with the current Network
Node, Network Link, and effective entry-point counts; opening the browser hides
that summary. The What-If entry action is temporarily not exposed while that
workflow is redesigned; the pure analysis code and graph model remain available
for that later work.

Network Nodes use a compact, left-anchored card: a small icon tile, thin
internal padding, and the remaining width reserved for the label and caption.
Nodes with deep links show a subtle chain glyph and blue count at the right.
Activating it opens a `DialogPortal` mini popup; choosing a row opens its
Connection in Workspace or navigates the IT Ops drill-down to its Site, Server
Room, or Rack Device. A Rack Device target opens its Rack and Properties.
When a Network Node has notes, a wide card uses the right side for the note;
narrow cards put an ellipsized note preview along the bottom. New and imported
nodes start at the compact default size, while every saved node keeps its own
persisted dimensions.

Object-browser cards use the same configure-then-place interaction
as Server Room editing: click a card, complete its Properties dialog, then
move the cursor-tracked ghost and click the canvas to place it. The configured
draft does not enter the graph until that placement click; right-click or
Escape cancels it. Ghost tracking and the primary placement action run from
the map canvas's capture-phase pointer events so React Flow child layers cannot
swallow either interaction. A Network Node or Note native right-click menu
contains Lock/Unlock, Duplicate, Delete, then a separated final Properties item.
A locked object cannot move, resize, or be deleted until unlocked. Ctrl-click,
Command-click, and Shift-click toggle objects in a multi-selection; its
right-click menu contains only Lock/Unlock and Delete, with Delete disabled
while any selected object is locked. Duplicate opens the
same prefilled Properties dialog and arms the resulting copy for placement.
The Network Node kind chosen in the object browser stays fixed while adding or
duplicating a node, so those Properties dialogs do not repeat the Type field;
editing an existing device node still permits changing among device Types,
while a Geomap remains a Geomap. Right-clicking empty
canvas opens a native menu with Add Node, which opens the object browser, and
Properties, which edits the current Network Map.
The object browser remains the object picker at all times; it never becomes a
property inspector or map summary. Single-clicking an existing Network
Node or Note selects it and exposes its drag-resize handles. The element
updates continuously while a handle is dragged; double-clicking opens its
Properties dialog. Clicking a Network Link opens that link's
Properties dialog. Edits are applied to the in-memory graph only when that
dialog's Save action is confirmed. Moving a Network Node keeps its existing
animated Links visible and attached throughout the drag without remeasuring
unrelated node handles, then recalculates the shortest handle sides when the
drag ends.
Network Node Properties puts the device artwork and palette-backed icon
background choices in one compact identity header. Network Maps use a separate
soft hardware palette rather than the shared IT Ops content accents and include
a custom-color picker. Black skeuomorphic hardware shells always render on a
lightened tile. Small status choices use
icon-backed radio cards; the 27-item node-kind list remains a select when
editing an existing device node. Generic Properties additionally provides a
visual picker for all 26 built-in icon artworks without changing the node kind.
Node Properties shows only the Deep Link count. Activating it opens a compact
collection editor that owns the ordered list, focused add-destination dialog,
removal actions, and one direct Open action per available destination. Geomap
Properties is purpose-built instead:
it includes the artwork tint, uncapped pixel width and height fields, and a
draggable world-map preview with scroll/slider zoom from 100% through 10,000%,
omitting the device label, Type, status, interfaces, and note. The selected
crop and size are visible in the placement ghost and saved Geomap. The canvas
Geomap renders only the cropped artwork and has neither resize nor Network Link
handles. Each device node
persists its individual width/height and an ordered interface inventory. Node
Properties shows only the interface count; activating it opens a compact,
independently scrolling collection editor. An interface has a stable id, name,
and optional documented IP address, and is added or edited in a focused nested
dialog inside that collection editor instead of expanding the parent Properties
dialog.
A Network Link's small medium, status, and strand-display choices also use
icon-backed radio cards. The base Properties sheet shows only the physical-link
count; activating it opens a compact, independently scrolling member grid, so
large bundles do not make the base dialog taller. The user's canvas connection
gesture always creates one physical member. Every new member automatically
creates a uniquely named interface on both endpoint nodes and binds their stable
ids, while the grid edits those interface names and the member speed. Legacy
node address lists and link-wide endpoint address bindings are migrated into
interfaces and the first strand when maps are read.
Resizable Network Map Notes store Markdown source in their existing text field
and a palette-backed background. Their Properties dialog provides a compact
formatting toolbar plus a sanitized live preview; the canvas renders the same
sanitized Markdown with heading, emphasis, list, quote, link, and code styling.
Notes use a neutral hairline border. Geomaps, Notes, links, and regular Network
Nodes use explicit ascending React Flow z-orders, and selected-node elevation is
disabled for the canvas. A Geomap therefore remains the bottom-most node even
while selected; Notes remain below every link and regular Network Node. Notes
never enter the reachability graph.

### IT Ops destination-page UI contract

This section is normative for future IT Ops frontend work. It applies to
Hosts, Run History, Task Library, IPAM, Network Maps, and any
later non-spatial destination opened from the IT Ops navigator. Do not give a new destination an
independent page shell or visual language.

#### Required page anatomy

1. The navigator's detail host uses `it-destination-page`; the destination root
   uses `it-destination-surface`. The root owns the shared `var(--pad)` inset.
   Do not add a second page-level inset inside an individual destination.
2. The first element is `it-destination-page-head`. It contains one compact
   title and, when useful, one single-line description on the left. Page-level
   metadata and actions stay on the right.
3. Use at most one emphasized page-level primary action. Put it at the far
   right and keep its placement stable across empty and populated states. A
   read-only destination such as Run History may omit it; do not invent an
   action merely to fill the space.
4. An optional compact toolbar follows the header divider. Use it for filters,
   selection controls, search, counts, and secondary actions. It must not
   become a second competing page header.
5. The content begins on the same left edge as the header and toolbar. Lists use
   one bordered container with themed surface rows and hairline separators.
   Avoid unrelated floating cards, per-row shadows, and different corner radii
   for each destination.

#### Master-detail and specialized content

- Task Library may keep its master-detail body, but the split view is one
  bordered content region below the shared page header. Its create action stays
  in the page header; do not restore a separate mini-header in the list pane.
- Run reports and live-run progress may use status-specific summaries inside
  the shared frame. Navigating from history list to report detail must not move
  or restyle the destination header.
- Site View, Server Room View, and Rack View are spatial drill-down canvases,
  not destination pages. They keep their centered view controls and icon-only
  Edit/Export toolbar described below.

#### Empty and setup states

- Keep the page header and its action positions unchanged when data is empty.
  Do not replace the entire destination with a one-off landing page.
- Every destination and topology setup state renders through
  `ItOpsEmptyHint`. It is one short neutral centered sentence, without a glyph,
  secondary heading, promotional card, or large primary button.
- When a meaningful setup action exists, keep it as an inline accent-colored
  phrase inside the sentence. The action looks and behaves
  like the Workspace empty-state links: transparent background, compact hover
  treatment, visible focus ring, and no surrounding promotional card.
- A missing Site collection uses `itops.sites.emptyHint`; an empty Site uses
  `itops.sites.emptyServerRoomsHint`; an empty Server Room uses
  `itops.racks.emptyServerRoomHint`; an empty Rack uses
  `itops.racks.emptyRackHint`; Hosts uses `itops.hosts.empty`; and Run History uses
  `itops.batchRuns.historyEmptyHint`. Keep actionable phrases inside their full
  translated sentences with `Trans` component markers. Do not concatenate text
  fragments or replace a hint with a lone button.

#### Implementation and review gates

- Reuse the existing `it-destination-*`, `it-task-library-*`, list-row, and
  `it-empty-hint` rules in `src/modules/itops/itops.css`. Extend these
  shared rules when the whole family needs to change; do not add page-specific
  copies with slightly different spacing or colors.
- Read colors, borders, hover states, radii, and typography from app tokens.
  IT Ops hardware artwork may use its documented physical-equipment palette,
  but destination chrome must not hard-code colors.
- Build forms from the shared `src/app/ui/dialog` primitives. A normal `Sheet`
  provides their design tokens automatically; any IT Ops canvas, inspector, or
  custom editor that renders those primitives outside `Sheet` must mark its
  nearest surface root with `kk-surface`. Never duplicate their field CSS or
  accept browser-native square input/select fallbacks.
- Route all text through `itops.*` i18n keys and follow the localization backlog
  workflow. Inline action markers such as `<addRack>` and `<editMode>` are part
  of the translation contract.
- Update this section when intentionally changing the shared pattern. Add or
  adjust a focused frontend regression test so Task Library and every Site
  destination cannot silently drift back into separate page shells.
- Review the four destinations together at the same window size in Default and
  Dark before handing off an IT Ops UI change. Also check the affected topology
  empty state when changing Rack or Server Room flows.

Site View is now overview-only and has no segmented content switcher. Hosts
and Run History each own a separate Site-scoped page selected from
the navigator. The Hosts page owns Host selection and the manual **Run Task**
action; its launcher accepts a reusable Task from the global Task Library or an
ad-hoc Script Batch Task and fixes the target scope to the selected Host ids. A Host is
runnable when it has a bound SSH Connection; target resolution uses the first
bound SSH Connection for each selected Host and deduplicates Connections.

Run History is read-only navigation over the selected Site's live run and
completed reports. It has no independent start or rerun action; “Batch Run” is
the execution concept, not the name of a page or durable container. The
drill-down views own an icon-only Edit / Export toolbar: edit mode gates free
placement, Rack Device drag/drop, empty-slot add affordances, and destructive
controls; normal mode remains an inspect/open surface. Site and Server Room
exports save a graphical PDF report with topology summaries, scaled rack elevations,
Front and Rear Rack Device faceplates, paginated inventory data including mounting side, and platform-rendered Unicode
text for localized names and labels. Rack View also saves an
Excel-readable inventory table.
An empty Server Room uses explanatory guidance with an inline New Rack action.
An empty Rack uses an inline Edit mode action that reveals the Rack Device
picker.
In the Server Room floor-plan and 2.5D object picker, Rack and fixture placement
uses two clicks: the first locks the floor position, moving the pointer selects
one of four facings with a high-contrast arrow on that side, and the second
commits both position and facing. The arrow follows the 2.5D view angle and
turns red when the selected facing cannot fit. A successfully placed Wall
remains armed for continuous placement. A Wall reserves its entire logical grid cell even
though its construction is drawn as a thin segment: Rack and object placement
or dragging cannot enter that cell, and a Wall cannot replace any occupant.
The floor plan pans only when its current zoom or room bounds overflow the pane,
so it cannot be dragged away to expose background gaps. The 2.5D view keeps
scrollable camera margin around its projected room. In either spatial view,
drag blank floor with the left mouse button, drag with the middle button, or
focus the room and use the arrow keys to pan. The target button below the zoom
levels, or a middle-button click without dragging, resets the camera to center.
When a side panel changes the available room width, the camera preserves the
operator's pan relative to that center while the fitted scene is recomputed, so
Racks do not drift outside the 2.5D clip box.
While the 2.5D room is hovered or focused, entering Up, Up, Down, Down, Left,
Right, Left, Right, B, A within three seconds triggers the decorative Server
Room blackout: a lightning strike cuts the room lights, rack-top and floor 乖乖
packages remain visibly green, and the rack lights recover in shuffled order.
The effect clears itself after about eleven seconds, changes no durable or live
operational state, ignores editable controls, and removes rapid flashing and
flicker when the operating system requests reduced motion.
The room background remains editable from empty elevation and 2.5D space. In
Floor Plan and 2.5D modes keep their spatial canvases edge-to-edge without the
generic wallpaper content inset. In Floor Plan mode, the opaque blueprint grid
means the saved room background is visible only behind the shared toolbar.
The Rack hover detail card shared by both spatial views mounts outside their
clipping canvases and flips or clamps within the visible room at every edge.
The Rack configuration dialog exposes
`itops.racks.sequenceAction`, which inserts `%02d`; a matching Rack name opts
into continuous placement with the next number after the highest matching name
in that Server Room while preserving the configured Rack settings. Right-click,
Escape, selecting another app control, leaving edit mode, switching layouts, or
navigating away cancels either continuous tool and deletes only an unplaced
pending Rack.
In the floor plan and 2.5D layouts, Shift-clicking an existing Rack or room
object arms a temporary deep-copy draft instead. The cursor ghost preserves
the source facing and configuration. One click on a blank floor cell commits
the copy at that cell; cancellation creates nothing. Rack copies receive the
next available `#N` name and clone their Rack Devices in the same atomic write
as the new grid placement and facing.
Site, Server Room, and Rack tree rows share one native context-menu contract:
Properties is always the final item, separated from the commands above it.
Delete sits above Properties and routes to the shared danger `ConfirmSheet`;
the seeded Default Site shows Delete disabled. A Server Room also places
`itops.racks.addRackAction` above Delete and opens the New Rack dialog already
scoped to that Server Room. Server Room and Rack rows also expose
`itops.actions.duplicate`: it opens the existing Properties dialog with the
next available `#N` suffix beginning at `#2` and the source properties
prefilled. Save performs the deep copy; Cancel creates nothing. A Rack copy
includes its cabinet properties, background, and Rack Devices but starts
without overlapping floor-plan or 2.5D coordinates. A Server Room copy
includes its finish, icon, background, room objects, Racks, Rack Devices, and
internal spatial layout.
When the virtual Server Rooms row is selected, an `itops.racks.sortAction`
icon button appears immediately left of the tree-wide collapse/expand controls.
Its `itops.racks.sortAscending` and `itops.racks.sortDescending` native menu
items naturally order only that Site's Server Room rows; the per-Site direction
is a persisted tree-view preference and does not reorder the Site View canvas.
Selecting an individual Server Room shows the same toolbar icon and naturally
orders only that room's Rack children; its direction persists per Server Room
and does not rearrange Rack placement in any spatial view. The virtual row's
native context menu exposes
`itops.racks.addServerRoomAction`, which opens the New Server Room dialog for
that Site, followed by an `itops.racks.sortAction` submenu with the same two
ordering choices. An individual Server Room's native menu likewise adds that
submenu after `itops.racks.addRackAction` and before Delete/Properties.
The live
Batch Run view renders a per-host grid
with status chips and **live streamed output** (each host auto-reveals its
output as it arrives over the `itops://run` `HostOutput` frames; the SSH
transport streams incrementally via `run_remote_command_capture_streaming`).
A finished run's per-host output is persisted in the report, so the recent-runs
list opens a read-only **Run Report viewer** (`RunReportView`) that replays the
per-host output later.

All user-visible strings use a new `itops` i18n namespace following the
i18n rules in `AGENTS.md`. New dialogs/sheets follow
`docs/DESIGN_LANGUAGE.md` and the dialog primitives in `src/app/ui/dialog`.

## AI Assistant integration

IT Ops commands are registered as approval-gated assistant tools, the
same model Dashboard uses. The shared `itops_*` execution surface covers the
Module's backend operations end to end: Site/Server Room/Rack/Rack Device
lifecycle, ordering and duplication, spatial Rack placement/facing and Room
Objects, presentation backgrounds/icons, SNMP refresh, Host inventory
(create/update/delete/import/scan), the global Task Library
(list/get/create/update/remove, with built-ins read-only), and Batch Runs
(start/cancel/run-history/report). A successful mutating tool emits an
`itops-changed` backend event that reloads the IT Ops store so the change
appears without restart. The Rack Device placement schema includes
`mountFace` (`front` or `rear`, default `front`) plus `kuaiguai`; assistant
requests for the back, backside, or rear explicitly map to `mountFace: "rear"`
instead of the Rack's unrelated floor-plan facing. The schema documents the
rack-top virtual position (`startU = rack.heightU + 1`) plus expiry/style
metadata, so assistant and built-in MCP calls preserve the same placement
invariant as the UI.

Assistant-authored Batch Tasks (Task definitions and ad-hoc run scripts) may never introduce sudo steps or
secret-vault references — those are configured only in the Task Library
editor, and a full-value Task update may only resend the sudo steps the
stored Task already carries. Run-history reads return compact per-host outcome
rows; `itops_get_run_report` attaches per-host output tail-capped by
`maxOutputChars`.

The page-context projection includes the current navigator selection
(Site, destination, drill-down), Site names/ids/counts, the Task Library
count, recent run counts, IPAM and Network
Map counts once those pages have been opened, and the registered tutorial
targets — never full run output, streamed host buffers, secrets, or
credential references. The `tutorial_highlight`
tool's navigation payload accepts `itopsSiteId` and `itopsDestination`
(`site | serverRooms | hosts | runHistory | taskLibrary |
ipam | networkMaps`)
so the assistant can open a specific Site destination before
highlighting; destination pages carry static targets
(`itops.hostsPanel`, `itops.taskLibrary`, …, see
`src/app/tutorialNavigationModel.ts`) and rows carry entity-scoped
targets (`itops.site:<id>`, `itops.host:<id>`, `itops.task:<id>`,
`itops.run:<id>`). Mutating actions (starting a Batch Run) go through the existing approval flow; the
assistant cannot run a site task silently. Over the built-in MCP bridge
the same tools are published under `kkterm.itops.*`, with
task-authoring and run-starting tools in
`dangerous` sub-namespaces (see `docs/MCP.md`).

VLAN and IPAM operations use the same shared assistant/MCP path as the rest of
IT Ops. The assistant can read the complete derived IPAM snapshot and VLAN
list; create, update, and remove VLANs, Prefixes, and Address Records; suggest
documented-free addresses; atomically import a create-only structured batch;
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

-- A Network Map. graph_json holds the whole document (nodes, links,
-- reachability roots); the canvas is
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
and pure What-If reachability in `src/modules/itops/reachability.ts`. No
assistant or MCP tools yet, and **no dependency on live device state** — the
SNMP scaffolding stays future preparation, and the What-If "down" set comes
only from operator toggles.

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

Two deliberate non-goals in this phase. **Reachability stays VLAN-blind**:
per-VLAN What-If ("this trunk drops, VLAN 30 is severed but VLAN 10 survives")
is the obvious follow-up and genuinely useful, but it multiplies the analysis
surface — `effectiveRoots`, `findWeakPoints`, and `findStrandedNodes` all
become per-VLAN — and `reachability.ts` states plainly that the switched-off
set is the analysis's only input. **Nothing auto-parses "VLAN 30" out of
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

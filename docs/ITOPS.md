# IT Ops Module Architecture

The IT Ops Module is a built-in Activity Rail destination for site
operations: running the same task across many hosts at once and watching
signals to react automatically. It absorbs and evolves the in-memory
Watchdog into durable, saveable Automations.

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
  to execute but never owns targets; a Site, Host selection, or Automation
  supplies targets when the Task launches.
- **Batch Runs** — fan-out task execution across a Site with
  per-host live output and a consolidated, saved run report.
- **Automations** — durable trigger → condition → action rules (the
  evolved Watchdog), including the live run loop and Status Bar surface.
- The Tauri commands the AI Assistant uses to draft and manage Sites and
  Automations.
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

Batch Runs and Automations are the same primitive seen from two
directions. A Batch Run is a task executed **now** against a Site.
An Automation is a saved rule that may **run a Batch Run later** when a
trigger fires. They share the host-targeting model (Sites), the
fan-out executor, the transport adapters, and the run-history store.
Keeping them in one Module lets an Automation's `runBatch` action reuse
the exact executor a manual run uses.

The UI makes the shared primitive explicit: **Task + targets → Batch Run**,
while **trigger + Task + targets → Automation**. Tasks are global to IT Ops so
the same definition can run against several Sites without duplication.

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
launch time; an Automation references the Task and target Site separately.
Deleting or editing a Task never rewrites completed Run History, whose report
keeps a redacted task-summary snapshot. The Task Library editor supports both
script Tasks and reusable Playbooks. Playbooks use the same ordered node-canvas
language as Automations, but remain a linear chain rather than a free-form DAG.
_Avoid_: Site task, saved Batch Run, Automation workflow

**Batch Run** — one execution of a Batch Task against a resolved Host
Site. Live run state (per-host status, streamed stdout/stderr, exit
codes, cancellation) is **in-memory**; on completion a consolidated
report is written to `itops_run_history`. Concurrency is bounded
(mirroring the Connection Batch Importer's network-scan fan-out in
`src-tauri/src/import.rs`); a single slow or black-holed host must not
stall the others or the UI thread.

**Automation** — a durable rule stored in `itops_automations`: one
**trigger**, an optional **condition**, and an ordered list of
**actions**. It is the durable generalization of today's
`WatchdogConfig`. Definitions persist and **re-arm on app launch**;
their live poll/run state stays in-memory in the Automation runtime.

**Trigger** — generalizes `WatchdogTarget`. Existing samplers
(performance counter, ping, TCP reachability, SSH output silence) carry
over unchanged; new samplers add scheduled probe (cron), output regex
match, SFTP path change, inbound webhook, and a structured/unstructured
datasource poller (HTTP-JSON, command output, log file).

**Condition** — the existing `PredicateOp` set
(`gt/lt/gte/lte/eq/ne/contains/silenceFor`), evaluated by the unchanged
pure `evaluate_predicate`. Optional: a trigger like cron or webhook may
fire unconditionally.

**Action** — generalizes `WatchdogAction` into a finite typed catalog
executed in order when the rule fires:

| Action | Effect |
| --- | --- |
| `notify` | Status Bar / toast / sound, the current `Notify` behavior |
| `popup` | App-owned desktop popup dialog |
| `email` | SMTP send (credentials from keychain) |
| `webhook` | Outbound HTTP request to a declared origin |
| `runBatch` | Start a Batch Run on a named Site + Task |
| `aiIntervene` | The existing approval-gated AI sub-turn |

The catalog is closed and typed on purpose: it is the "light n8n" payoff
without becoming an open agent. Actions do not pass arbitrary data
between each other (no DAG); each reads the trigger snapshot.

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
- `itops_automations` — id, name, enabled flag, trigger config, optional
  condition, ordered actions, poll/stop/suppression settings (the durable
  superset of `WatchdogConfig`), plus an optional Site binding (`site_id`,
  a soft reference like `itops_run_history`'s) that scopes the rule to one
  Site's Automations page.
- `itops_run_history` — id, source (manual run or automation id), task
  summary, started/finished, per-host outcome summary, consolidated
  report blob. Local-first; no telemetry.
- `itops_tasks` — global reusable Task definitions: id, name, description,
  ordered position, and typed `BatchTask` JSON. No target or live state.

Durable definitions only. **Live state never persists**: in-flight Batch
Run progress, Automation poll ticks, tick ring buffers, and runtime state
machines stay in memory in the runtime layer, consistent with the
High-Risk Invariant against putting Session/runtime state in durable
models. On launch, the Automation runtime hydrates enabled rows from
`itops_automations` and arms them; disabled rows are loaded but not
polled.

Secrets (SMTP password, webhook bearer token, WinRM/PsExec credentials)
live in the OS keychain under existing secret-owner ids; SQLite stores
only non-secret metadata and credential references. IT Ops state is
included in the selective export/import shape (ADR-0010) as non-secret
metadata.

## Runtime

The existing Watchdog runtime (`src-tauri/src/watchdog/registry.rs`) is
the Automation runtime, extended rather than rewritten:

- The per-rule `tokio::time::interval` task, `CancellationToken`,
  sustained-window tracking, stop-condition arbitration, and single
  `watchdog://event` channel are preserved.
- `evaluate_predicate` and the predicate/state enums are reused as-is.
- The trigger sampler dispatcher (a free function today) gains the new
  trigger kinds; the action executor gains the new action kinds. Both
  extension points already exist for exactly this.
- A startup hook reads `itops_automations` and creates one runtime entry
  per enabled rule.

The Batch Run executor is a sibling worker pool: resolve the Site,
open one transport task per host under a concurrency cap, stream progress
events on a channel, and assemble the report. SSH reuses the existing
transport; WinRM and PsExec are new transport adapters behind a common
`exec(host, task) -> stream` shape.

All exec, WinRM/SMTP/webhook I/O, and probes run through
`spawn_blocking`/worker tasks and report by event — never blocking the
UI/native thread (`docs/ARCHITECTURE.md` command-runtime boundaries).

## Frontend

`src/modules/itops/` owns the Module shell. The visible shell uses one
resizable/collapsible operational navigator. Only the active Site needs to be
expanded. Each Site exposes predefined virtual destinations — **Server Rooms**,
**Hosts**, **Automations**, and **Run History** — while its topology continues
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
catalog keys so Run History and Automation references survive catalog upgrades.
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

Hosts, Automations, Run History, and the global Task Library share one
destination-page frame: the same content inset, compact title/description
header, right-aligned primary actions, divider, and bordered-row rhythm. The
Task Library keeps its spreadsheet-style Task table inside that frame rather
than owning a separate full-height chrome layout. Each row shows Task kind, Applicable OS,
execution count, failed-host count, and a link to the most recent Site Run
History containing that Task. Statistics use the Task's stable id; ad-hoc,
Automation, and older unattributed history rows are never guessed by label.

### IT Ops destination-page UI contract

This section is normative for future IT Ops frontend work. It applies to
Hosts, Automations, Run History, Task Library, and any later non-spatial
destination opened from the IT Ops navigator. Do not give a new destination an
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
- Automation's node editor is a full-canvas workflow entered from the
  destination. Its specialized canvas does not license a different layout for
  the Automations list page.
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
  `itops.racks.emptyRackHint`; Hosts uses `itops.hosts.empty`; Automations uses
  `itops.automations.emptyHint`; and Run History uses
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
- Route all text through `itops.*` i18n keys and follow the localization backlog
  workflow. Inline action markers such as `<addRack>` and `<editMode>` are part
  of the translation contract.
- Update this section when intentionally changing the shared pattern. Add or
  adjust a focused frontend regression test so Task Library and every Site
  destination cannot silently drift back into separate page shells.
- Review the four destinations together at the same window size in Default and
  Dark before handing off an IT Ops UI change. Also check the affected topology
  empty state when changing Rack or Server Room flows.

Site View is now overview-only and has no segmented content switcher. Hosts,
Automations, and Run History each own a separate Site-scoped page selected from
the navigator. The Hosts page owns Host selection and the manual **Run Task**
action; its launcher accepts a reusable Task from the global Task Library or an
ad-hoc Script Batch Task and fixes the target scope to the selected Host ids. A Host is
runnable when it has a bound SSH Connection; target resolution uses the first
bound SSH Connection for each selected Host and deduplicates Connections.

Run History is read-only navigation over the selected Site's live run and
completed reports. It has no independent start or rerun action; “Batch Run” is
the execution concept, not the name of a page or durable container. Automations are
filtered to rules bound to the selected Site by their durable `site_id` (set in
the node editor's header Site select and defaulted from the destination that
opened it; legacy rows without a binding fall back to inference — a runBatch
action targeting the Site, or a host-addressed trigger watching one of its
resolved member hosts). The
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

Automations are created and edited in an n8n-style **node editor**
(`AutomationEditor.tsx`, built on `@xyflow/react`): the closed
trigger → condition → action[] pipeline is drawn as draggable nodes wired
left-to-right, with a side panel that edits the selected node. It stays a
fixed pipeline, not a free-form DAG (see "Action" above) — the canvas is a
visualization, not a new execution model. A **Test** button calls
`itops_test_automation` to sample the trigger once and report whether the
condition would fire, then renders a dry-run preview of the actions (no email,
webhook, or Batch Run is actually sent). The Status Bar indicator continues to
surface running Automations app-wide via the existing `WatchdogStatusBar`.

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
(list/get/create/update/remove, with built-ins read-only), durable
Automations (list/create/update/set-enabled/remove plus a one-shot
`itops_test_automation` dry run), and Batch Runs
(start/cancel/run-history/report). A successful mutating tool emits an
`itops-changed` backend event that reloads the IT Ops store so the change
appears without restart. The Rack Device placement schema includes
`mountFace` (`front` or `rear`, default `front`) plus `kuaiguai`; assistant
requests for the back, backside, or rear explicitly map to `mountFace: "rear"`
instead of the Rack's unrelated floor-plan facing. The schema documents the
rack-top virtual position (`startU = rack.heightU + 1`) plus expiry/style
metadata, so assistant and built-in MCP calls preserve the same placement
invariant as the UI.

Assistant-authored Batch Tasks (Task definitions, Automation `runBatch`
payloads, ad-hoc run scripts) may never introduce sudo steps or
secret-vault references — those are configured only in the Task Library
editor, and a full-value Task update may only resend the sudo steps the
stored Task already carries. An assistant-created Automation's watchdog
`config.action` must stay `notify`; the ordered IT Ops actions list
carries the real work. Run-history reads return compact per-host outcome
rows; `itops_get_run_report` attaches per-host output tail-capped by
`maxOutputChars`.

The page-context projection includes the current navigator selection
(Site, destination, drill-down), Site names/ids/counts, Automation
names/states, the Task Library count, recent run counts, and the
registered tutorial targets — never full run output, streamed host
buffers, secrets, or credential references. The `tutorial_highlight`
tool's navigation payload accepts `itopsSiteId` and `itopsDestination`
(`site | serverRooms | hosts | automations | runHistory | taskLibrary`)
so the assistant can open a specific Site destination before
highlighting; destination pages carry static targets
(`itops.hostsPanel`, `itops.automationsNew`, `itops.taskLibrary`, …, see
`src/app/tutorialNavigationModel.ts`) and rows carry entity-scoped
targets (`itops.site:<id>`, `itops.host:<id>`, `itops.automation:<id>`,
`itops.task:<id>`, `itops.run:<id>`). Mutating actions (starting a Batch
Run, enabling an Automation) go through the existing approval flow; the
assistant cannot run a site task silently. Over the built-in MCP bridge
the same tools are published under `kkterm.itops.*`, with
task-authoring, automation-mutating, and run-starting tools in
`dangerous` sub-namespaces (see `docs/MCP.md`).

## Migration from Watchdog

The Watchdog is not deleted — it is the seed of the Automation runtime.
Migration steps, at a design level:

1. Add the three SQLite tables and the schema version bump.
2. Add a durable `Automation` definition that is a superset of
   `WatchdogConfig`; load enabled rows at startup into the existing
   registry.
3. Extend the trigger dispatcher and action executor with the new kinds.
4. Build the Site resolver and the Batch Run executor (SSH first;
   WinRM and PsExec adapters next).
5. Add the `src/modules/itops/` Module shell and `itops` namespace;
   re-home the existing `WatchdogDetail`/`WatchdogStatusBar` views under
   the Automations runtime while keeping the Status Bar indicator.

`CONTEXT.md`'s Watchdog entry is updated to note Automations are now
durable IT Ops rules while live run state remains in-memory.

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

-- A durable trigger -> condition -> actions rule (the evolved Watchdog).
CREATE TABLE IF NOT EXISTS itops_automations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    sort_order    INTEGER NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1,
    -- Tagged-enum JSON. Superset of WatchdogTarget (see Rust types below).
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
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One completed Batch Run (manual or fired by an automation). Append-only.
CREATE TABLE IF NOT EXISTS itops_run_history (
    id             TEXT PRIMARY KEY,
    -- 'manual' or 'automation:<automation_id>'.
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
```

`itops_run_history` uses a **soft** `host_group_id` (no `REFERENCES`) so
deleting a Host Group does not erase its run history; the Dashboard tables
use hard `ON DELETE CASCADE` where cascade is desired, and this is the
deliberate opposite choice for an audit log.

### Rust types (`src-tauri/src/itops/types.rs`)

The durable `Automation` is a superset of `WatchdogConfig`. The existing
`PerformanceMetric`, `PredicateOp`, `WatchdogStop`, and the runtime state
machine are reused unchanged; only the target/action enums grow.

```rust
/// Durable rule. Mirrors WatchdogConfig + persistence/identity fields.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub trigger: AutomationTrigger,
    #[serde(default)]
    pub condition: Option<PredicateOp>, // reused from watchdog::types
    pub actions: Vec<AutomationAction>,
    pub runtime: AutomationRuntime,     // poll_ms, stop, sustained_for_ms, suppression_ms
}

/// Superset of WatchdogTarget. Existing variants carry over verbatim.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AutomationTrigger {
    // --- carried over from WatchdogTarget ---
    PerformanceCounter { metric: PerformanceMetric },
    SshSessionOutputSilence { session_id: String },
    Ping { host: String, #[serde(default)] port: Option<u16> },
    TcpReachable { host: String, port: u16 },
    // --- new in IT Ops ---
    /// Fires on a cron schedule; pairs with no condition or a probe condition.
    Schedule { cron: String },
    /// Regex match against streamed session/SSH output.
    OutputMatch { session_id: String, pattern: String },
    /// SFTP path mtime/size change under an SSH Connection.
    SftpChange { connection_id: String, remote_path: String },
    /// Inbound webhook hit (local listener path token); value = parsed body.
    WebhookIn { token: String },
    /// Polls a structured/unstructured datasource; value = extracted field.
    Datasource(DatasourceProbe),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DatasourceProbe {
    HttpJson { url: String, json_pointer: String }, // RFC 6901 pointer into the body
    CommandOutput { connection_id: String, command: String },
    LogFile { path: String },
}

/// Superset of WatchdogAction. `Notify` and `AiIntervene` are verbatim.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AutomationAction {
    Notify { level: NotifyLevel },        // inApp | toast | sound
    Popup { title: String, body: String },
    Email { to: String, subject: String, body: String }, // SMTP creds via keychain
    Webhook { url: String, method: String, body: Option<String> },
    RunBatch { host_group_id: String, task: BatchTask },
    AiIntervene {                          // unchanged from watchdog::types
        goal: String,
        allowed_tools: Vec<String>,
        max_interventions: u32,
        suppression_ms: u64,
    },
}

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

Reuse the existing keychain owner model (`src-tauri/src/secrets.rs`). The
`SecretKind::EmailSmtpPassword` variant **already exists** — Email actions
reuse it. Two additions are needed:

- a `WebhookToken` secret kind for outbound webhook auth, and
- a `WinrmPassword` (and later `WinrmKerberos`) secret kind for the WinRM
  transport.

Owner ids follow the established pattern, e.g.
`itops-automation-secret:<automation_id>:<actionIndex>` for an action's
secret and `itops-host-group-secret:<group_id>:winrm` for a Host Group's
WinRM credential. SQLite stores only non-secret references.

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

**Phase 3 — Automations: persist + re-arm the Watchdog.** Schema add
`itops_automations`; the durable `Automation` superset type; a startup
hook that hydrates enabled rows into the existing `WatchdogRegistry`;
extend `watchdog/commands.rs` (or new `itops/automation_commands.rs`) with
create/update/enable/disable/delete; re-home `WatchdogDetail` /
`WatchdogStatusBar` under the Automations tab while keeping the Status Bar
indicator. Existing trigger/action kinds only — pure migration of
behavior onto durable storage.

**Phase 4 — Action catalog.** Add `Popup`, `Email` (reusing
`EmailSmtpPassword`), `Webhook` (new `WebhookToken` secret), and
`RunBatch` (calls the Phase 2 runner) to the action executor. Each action
is independently testable against the pure rule evaluator.

**Phase 5 — New triggers.** Add `Schedule` (cron), `OutputMatch`,
`SftpChange`, `WebhookIn`, and `Datasource` samplers to the trigger
dispatcher. These are additive to the existing sampler free function.

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

Phases 0–3 are the minimum that delivers durable monitoring + SSH batch.
Phases 4–8 are independent and can be reordered by demand.

## Planned / Deferred Enhancements

The plumbing above is complete (Sites, SSH Batch Runs, durable
Automations + action catalog, playbooks, AI integration), but from an
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

3. **Durable Automation event log.** Automation fires are transient today
   (`itops://automation` emits a one-shot notice/popup, then it's gone). Batch
   Runs get durable `itops_run_history`; Automations get nothing. Add a durable
   automation-event log (what fired, when, trigger snapshot, which actions ran,
   outcome) with an acknowledge state, so "did it fire overnight?" is
   answerable. Live runtime state still stays in-memory; only the fire record
   is durable.

4. **Scheduled inventory with trend.** The `Schedule` (cron) trigger only
   drives fire-and-forget actions. Add a pattern that runs a query on a
   schedule, stores each snapshot, and shows what changed since the last run —
   reusing the run-history store plus the diff from (1). This is where ongoing
   (vs. one-shot) value comes from, and feeds a future site-health overview.

## Target `CONTEXT.md` Vocabulary (lands with Phase 3)

These entries are **not** yet true of the shipping code — Watchdogs are
in-memory-only today — so `CONTEXT.md` must not adopt them until the
Phase 3 persistence work lands. They are captured here as the drafted
target wording. The modeling principle is KKTerm's existing durable-vs-live
split: **Automation is to Watchdog as Connection is to Session** — the
Automation is the durable definition, the Watchdog is the live runtime
that executes it.

When Phase 3 lands, replace the current **Watchdog** entry in `CONTEXT.md`
with the following two entries and add the three new IT Ops terms:

> **Automation**:
> A durable IT Ops rule stored in SQLite (`itops_automations`): one
> trigger, an optional condition predicate, and an ordered list of typed
> actions (notify, popup, email, webhook, run a Batch Run, or AI
> intervention). Automations persist across app restart and re-arm on
> launch. An Automation is the durable definition; the live **Watchdog**
> runtime is what executes it, the same way a **Connection** is durable
> and a **Session** is its live runtime. Created and managed in the **IT
> Ops Module**. See `docs/ITOPS.md` and `src-tauri/src/itops/`.
> _Avoid_: watchdog (for the durable rule), workflow, job, saved alert
>
> **Watchdog**:
> The live runtime that executes an armed **Automation** (or an ad-hoc
> live monitor): it samples a target (performance counter, SSH Session
> output silence, ping, TCP reachability, schedule, output match, SFTP
> change, inbound webhook, or datasource probe) against a predicate and,
> on trigger, runs the Automation's actions. The running Watchdog state —
> ticks, trigger log, state machine, suppression window — is **in-memory
> only and does not persist across app restart**; its durable definition
> lives in the **Automation**. Surfaced through the **Watchdog Status Bar**
> indicator and a detail panel, not as a Connection or Session. See
> `src-tauri/src/watchdog/` and `src/watchdog/`.
> _Avoid_: monitor profile, durable watcher (the Automation is the durable part)
>
> **IT Ops Module**:
> A built-in Activity Rail Module for site operations: **Sites**,
> **Batch Runs**, and **Automations**. Its current primary UI is the Site
> topology surface. Lives with Dashboard and Install Helper above Settings.
> Not a Connection, Session, or Dashboard widget. See `docs/ITOPS.md` and
> `docs/ADR/0011-it-ops-module.md`.
> _Avoid_: operations center, site manager, orchestrator
>
> **Site**:
> A durable, named selection of existing Connections (plus an optional
> dynamic filter by type/folder) used as the site target for Batch Runs
> and Automation `runBatch` actions. Stored in `itops_sites`; it
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

# KKTerm Context

KKTerm is a local-first desktop administration workspace for terminal, SSH, SFTP, and approval-based command assistance workflows. This context captures the product language used to keep storage, runtime session handling, and UI workspace concepts distinct.

## Language

**i18n / Localization**:
KKTerm supports 14 UI languages through i18next. The English locale (`src/i18n/locales/en.json`) is the source-of-truth key structure. All user-visible strings must be routed through `t()` or `useTranslation()`; bare English text in JSX is a bug.

**Locale**:
A language-region bundle stored as a JSON file under `src/i18n/locales/`. English is bundled with the app; 13 additional locales load on demand via dynamic `import()`. The active locale is persisted in `localStorage` (`kkterm.language`) and survives app restarts.

**Translation key**:
A dot-notation path into the locale JSON (e.g. `settings.general.language`, `ai.waitingPhrases`). Keys are organized by namespace matching the frontend source layout. New UI strings require a new key in all 14 locale files.

**Namespace**:
A top-level section of the locale JSON mapping to a feature area in the frontend source: `app`, `dashboard`, `appLauncher`, `installer`, `itops`, `screenshots`, `settings`, `connections`, `terminal`, `sftp`, `webview`, `remoteDesktop`, `git`, `compare`, `ai`, `watchdog`, `workspace`, `common`, `languages`, `manual`. The `screenshots` namespace owns the Screenshots Module, capture-delivery status, and tray capture labels; per-Pane capture actions and AI capture strings remain under `workspace` (plus per-surface target labels in `sftp` and `webview`). The `compare` namespace owns the File Compare overlay (the right-click "Select Left File for Compare" / "Compare to" workflow shared by the File Explorer and SFTP/FTP browser). The namespaces are not 1:1 with rail Modules (some Modules use several namespaces; some namespaces cover sub-features inside a single Module). Keep new keys in the namespace closest to the owning component.


**Connection**:
A durable openable resource stored in SQLite. The supported kinds are local terminal, SSH terminal, Telnet terminal, Serial terminal, URL (an embedded http(s) WebView2 target), RDP, VNC, FTP/FTPS, File Explorer (a local filesystem browser, kind `localFiles`), and Document (a single-file universal viewer/light editor, kind `fileView`). SFTP is opened from an SSH Connection and is not stored as a standalone Connection. Every Connection belongs to exactly one **Workspace**.
_Avoid_: Profile, saved session, host entry

**File Explorer Connection**:
A Connection of kind `localFiles`. It browses the local filesystem (no remote host or network Session) by reusing the SFTP file-browser shell as a single-pane local browser driven by local filesystem commands. It stores an optional starting directory and does not surface remote-connection status or transfer activity.
_Avoid_: SFTP, FTP, local SFTP, remote browser

**Document Connection**:
A Connection of kind `fileView`. It opens a single local file in a universal viewer / light editor (no remote host or network Session). The target file path is stored in the Connection's `local_startup_directory` slot (reused as the file path, not a directory). A viewer registry routes the file to a mode — text/code (CodeMirror), Markdown, table (CSV/TSV), JSON, image, dedicated Log mode (level coloring, filter, ANSI, follow/tail), or a Hex fallback — detected by extension plus a backend magic-byte/text probe, and the user can switch modes from the viewer toolbar. Some modes render through an external dependency installed on demand via the Install Helper rather than bundled (PDF via the `poppler` recipe); the viewer shows an install gate when the dependency is missing. The text/code mode is a light editor with an atomic safe-save (`write_file_view`: temp-file + rename with an mtime conflict guard); editing is limited to whole, cleanly-decoded UTF-8 text, so truncated or non-UTF-8 loads stay read-only. It reuses no SFTP/browser session state.
_Avoid_: File Explorer, editor tab, document session

**Workspace**:
A named, isolated container of Connections, surfaced as a switcher in the Activity Rail. The first Workspace ("Default") is seeded on first run and is permanent (non-deletable, non-movable); additional Workspaces are created through the New Workspace wizard (name, icon, and optional copy-import of Connections from other Workspaces). Switching the active Workspace re-scopes the Connection Tree and the rail's connected/pinned list only; open Sessions/Tabs, the Dashboard Module, the Install Helper Module, and Settings remain global. The Workspace Module and Workspace Canvas render the *active* Workspace.
_Avoid_: Space, vault, environment, project, tab

SSH Connections may persist non-secret tmux launch preferences, including whether KKTerm should start terminal Panes inside named tmux sessions. The remote tmux process itself remains live Session/runtime state and is not the durable Connection.

Local PowerShell Connections may persist a non-secret **psmux** launch preference (`usePsmuxSessions`, default off). psmux is the native Windows tmux clone; it is the local-shell counterpart to SSH tmux, offered only for PowerShell / PowerShell 7 shells and giving the Pane the same session-list toolbar and name pool. The flag is local-only and mutually exclusive with SSH tmux by Connection type; the live psmux process is runtime state, not the durable Connection.

**URL Connection**:
A Connection of kind `url`. It stores an http(s) URL, an optional `dataPartition` label, and a proxy routing choice. Proxy routing has three durable states: inherit the global app proxy (Settings → Proxy), force a direct connection, or use a Connection-specific HTTP CONNECT/SOCKS5 endpoint. The address bar accepts hosts without a scheme; the backend assumes `https://` when no scheme is present. The embedded browser runs in a stable, owned, borderless overlay `WebviewWindow` positioned over the Pane instead of Tauri's `unstable` child-webview API. The `dataPartition` field is persisted but currently a no-op until embedded browser isolation is revisited.
_Avoid_: Web tab, browser bookmark, URL profile

**RDP/VNC Connection**:
A Connection of kind `rdp` or `vnc`. It stores host, optional port, and non-secret account metadata in SQLite; passwords stay in the OS keychain. RDP Connections start Windows-native remote desktop Sessions through the Microsoft RDP ActiveX control in `mstscax.dll`. VNC Connections start RFB/VNC Sessions through the Rust `vnc-rs` client and render the remote framebuffer in the workspace canvas.
_Avoid_: Remote desktop session, screen profile, saved desktop

**Saved Credential**:
A durable, reusable login bundle: a user-editable label plus a username and a password. Non-secret metadata (label and username) lives in SQLite (`connection_password_credentials`); the password bytes live only in the configured secret store under the credential id. Saved Credentials are protocol- and host-neutral: the same username/password bundle may be linked to SSH, Telnet, RDP, VNC, and FTP Connections, while each Connection retains its own host and protocol settings. Linking copies a non-empty Saved Credential username to the Connection; editing that username updates linked Connections. Many Connections may share the same Saved Credential, and updating its password once applies to every linked Connection on next open. Saved Credentials are created and managed in Settings → Credentials (rename, password update, usage list, link/unlink, merge) and in the Connection dialog, which makes an explicit choice between "Use a saved credential" and entering a new password. A legacy per-Connection password — a secret stored under the Connection's own id with no credential metadata — remains valid and can be converted into a Saved Credential from Settings → Credentials.
_Avoid_: Identity, profile, account, keychain entry

**Quick Connect**:
A fast path to start a Session that persists a saved Connection. Quick Connect reuses an identical existing SSH Connection (matched by host/user/port) or creates one, then opens it — so every Quick Connect target becomes a durable Connection. The sole non-persisted case is an elevated admin shell launched while KKTerm itself is not elevated: that opens an external UAC process with no in-app Session.
_Avoid_: Temporary profile, ad hoc host, one-off session

**Quick Command**:
A reusable terminal command shortcut the user can send to the focused terminal Pane from the **Quick Command Bar**. Quick Commands are per-Connection workspace UI shortcuts; they do not create Connections and do not own Session lifecycle.
_Avoid_: Connection command, Session command, profile command

**Quick Command Bundle**:
A durable, app-global named list of Quick Commands that any Connection can select from its Quick Command Bar. Bundles are shared, not copied: editing one changes it for every Connection that selected it. A Connection either uses one bundle or keeps its own unbundled Quick Commands, and that choice is remembered per Connection. Bundles and per-Connection selections are durable frontend state (SQLite-backed, mirrored to the local cache); deleting a Connection drops only its selection. Managed in Settings → Terminal and from the Quick Command Bar's bundle picker.
_Avoid_: Command group, command profile, command set (as a Connection field), package

**Quick Command Bar**:
The optional bottom bar in a terminal Tab that displays the active Connection's Quick Commands — the selected Quick Command Bundle's commands when the Connection uses one, otherwise the Connection's own list. The Quick Command Bar is off by default, can be toggled from the terminal Pane toolbar, and remembers visibility per Connection. Its leading bundle chip switches the Connection's Quick Command Bundle.
_Avoid_: Command bar, shortcut bar, Session command bar

**Session**:
A live runtime instance for a process, SSH channel, file-browser, webview, or remote-desktop state.
_Avoid_: Connection, profile, tab

**Tab**:
A frontend workspace container that presents one session or a set of related panes.
_Avoid_: Session, connection, backend tab

**Child Connection Tab**:
A saved frontend Tab instance shown as an italic child row under its parent terminal-type Connection in the Connection Tree when Workspace Settings enables the hidden top Tab Strip mode. A Child Connection Tab may remember a display name, icon/background, tmux session id, and last terminal directory so it can be reopened lazily after app launch. It is not the durable backend Connection itself and it is not a live Session until the user opens it.
_Avoid_: child connection, saved session, sub-connection, backend tab

**Dashboard Module**:
A built-in Activity Rail Module that provides a dynamic widget playground. Users select from built-in widgets (App Launcher, Connection, Notes, AI Coding Usage, PC Info, Network Tools, Generators, and Converters) or AI Created Widgets. The built-in AI Assistant and coding agents create new widgets through atomic Tauri commands; users customize each widget's visual preset, accent, icon, and title and arrange them on a 12-column drag-and-drop grid. See `docs/DASHBOARD.md` for the durable architecture.
_Avoid_: landing page, overview

**Install Helper Module**:
A built-in Activity Rail Module that manages a curated catalog of Windows developer tools (e.g. nvm, Node, uv, Python, VS Code, Docker, WSL, n8n, Claude Code CLI, Codex CLI, Cursor Agent CLI, Antigravity CLI, OpenCode CLI, Notepad++, NSSM, OpenClaw, Hermes agent, Hermes Desktop, Draw.IO, Krita, Inkscape). For each catalog entry the Module detects local install state, fetches the latest available version, presents a per-tool install panel with tool-specific options, and supports check-for-update and apply-update actions. Lives above Settings on the Activity Rail. Not a Connection, not a Session, not a Dashboard Widget.
_Avoid_: AI Installer, App Installer, package manager, store

**Custom Module**:
An optional top-level Activity Rail Module contributed by a user-installed
static `.kkmod` package. Its HTML/CSS/JavaScript/WASM assets load locally in an
isolated native WebView through an app-owned protocol, with no Node.js runtime
or HTTP server. Settings → Custom Modules owns install review, trust, license,
permission, enable/disable, rollback, and uninstall. Every enabled, rail-visible
package contribution appears in the Activity Rail. A Custom
Module is not a built-in Module, Connection, Session, Tab, or Dashboard Widget.
_Avoid_: plugin, website Connection, bundled app, Dashboard widget

**Dashboard View**:
A durable SQLite-backed tab in the Dashboard Module, stored in `dashboard_views`. Each View carries its own ordered set of Widget Instances and a `grid_density` (`compact` / `default` / `roomy`). The first View is named "Default" and is seeded on first run with one App Launcher Widget Instance. Views are not Sessions and not Connections.
_Avoid_: dashboard page, tab, board

**Dashboard Widget Instance**:
A placed widget on a Dashboard View, stored in `dashboard_widget_instances`. Carries a `kind` (`builtIn` / `script`), a `source_id` resolving to a built-in registry entry or a Dashboard AI Created Widget, presentation fields (`preset`, `accent_name`, `icon_name`, `custom_title`), and layout coordinates (`grid_x`, `grid_y`, `grid_w`, `grid_h`). Multiple Instances of the same source may coexist with different presets, accents, and sizes.
_Avoid_: widget, tile, card

**Dashboard AI Created Widget**:
An AI Created Widget definition stored in `dashboard_custom_widgets`. AI Created Widgets are script-only: JavaScript hosted inside an isolated `iframe srcdoc` with declared `network` and `pollSeconds` permissions. Authoring is AI-only in v1; users customize and remove AI Created Widgets but do not create them through the UI.
_Avoid_: plugin, extension, custom tile

**Widget Preset**:
One of three visual chrome styles applied per Widget Instance: `panel`, `ambient`, `hero`. Presets are CSS wrappers that read the Instance's `--w-accent` / `--w-accent-soft` variables; presets do not encode their own palette. Ambient hides the title bar by default.
_Avoid_: theme, style, layout

**Widget Archetype**:
An AI-facing scaffold family selected before creating a Dashboard AI Created Widget. It guides chrome, layout, state handling, lifecycle, library choice, and first-pass grid size, but is not persisted as durable Dashboard data. Current archetypes are **Data Monitor**, **Metric/Chart**, **Utility Instrument**, **Desktop Object**, **Canvas Toy/Game**, and last-resort **General Workbench**.
_Avoid_: widget type, widget kind, preset

**Widget Kind**:
One of `builtIn`, `script`. Determines the body rendering path: `builtIn` resolves to a TypeScript component in `src/modules/dashboard/widgets/`; `script` mounts a JavaScript body inside an isolated `iframe srcdoc` host.
_Avoid_: widget type, widget variant

**App Launcher Widget**:
A Dashboard widget where users add local desktop apps, shortcuts, scripts, or files for quick launch. The widget presents each launcher entry as an icon with text; add/edit/remove actions, launch mode choices, and other entry management controls belong in an app-owned right-click context menu instead of the default widget surface.
_Avoid_: dock, taskbar

**Pane**:
A subdivision of a tab that presents one terminal surface or workspace view.
_Avoid_: Session, split

A Pane's **kind** (terminal, sftp, ftp, localFiles, webview, remoteDesktop) is what decides the surface it renders, and it is distinct from the durable Connection's **type**. The two are not interchangeable: an **SFTP browser Pane is not an SSH terminal**, yet it intentionally carries an ssh-typed Connection because SFTP is launched from an SSH Connection (and an sftp-protocol FTP Connection is normalized to an ssh shape for the same browser code path). Because one ssh-typed Connection can back either an SSH terminal Pane or an SFTP browser Pane, any code that recreates a Pane — especially restoring a saved or docked layout — must use the stored Pane kind, never re-derive the surface from the Connection's type, or an SFTP Pane will reopen as an SSH terminal. See the SFTP vs SSH invariant in `docs/ARCHITECTURE.md`.

Terminal Panes for tmux-enabled SSH Connections may carry a generated friendly tmux session id, such as `kkterm-cockpit001`, used to resume that Pane's remote tmux session when the Pane is recreated. Current Pane tmux ids use the `kkterm-<sci-fi-name><number>` shape and are remembered in frontend workspace storage. That id belongs to the frontend workspace/Pane layer, not the backend Connection model.

**Watchdog**:
An ad-hoc live check that samples a target (performance counter, SSH Session output silence, ping, or TCP reachability) against a predicate. Its ticks, trigger log, state machine, and suppression window are **in-memory only and do not persist across app restart**. Surfaced through the **Watchdog Status Bar** indicator and a detail dialog, not as a Connection, Session, or durable IT Ops definition. See `src-tauri/src/watchdog/` and `src/watchdog/`.
_Avoid_: monitor profile, durable watcher, automation rule

**Screenshots Module**:
A built-in Activity Rail Module that captures screenshots into a user-configurable library folder and presents thumbnail or details views. Capture modes are interactive region, window, and full screen (all monitors); they are reachable from the single-row Module header toolbar, the tray icon menu, configurable global hotkeys, and the per-Pane Workspace screenshot menu. Module-header, tray, hotkey, and Pane captures share the persisted Settings → Screenshots delivery behavior: save to the library folder, copy to the clipboard, or both, with optional editor opening for saved captures. Module-header and global-hotkey captures use the selected Instant, 3, 5, 15, 30, or 60 second delay; tray and Pane captures stay immediate. Captures save as PNG by default (JPEG optional) on Windows, macOS, and Linux. xcap supplies the shared desktop/window image path; macOS uses its native interactive selector and Linux prefers the desktop screenshot portal, with installed desktop selectors as fallbacks for region capture. The library supports persisted sort/group controls, multi-selection, non-destructive batch resize/conversion, delete, and a unified Fit/zoom viewer/editor for cropping, freehand pencil strokes, arrows, rectangles, ellipses, formatted text, and mosaic regions. Unsaved editor layers persist as non-destructive drafts beside the library, carry a Draft badge, and reopen without modifying the original image until Save flattens them. Single items also support copy to clipboard, open in the default app, reveal in folder, and rename. Folder, format, and hotkeys live in Settings → Screenshots; tray capture commands display their current enabled hotkeys. Pane actions that attach a screenshot to the AI Assistant remain transient and do not enter the library.
_Avoid_: screenshot gallery page, capture tool, snipping module

**IT Ops Module**:
A built-in Activity Rail Module for site operations: **Sites**, **Hosts**, global reusable **Tasks**, **Batch Runs**, **VLANs**, **IPAM**, and **Network Maps**. Its operational navigator exposes Site-owned Server Rooms, Hosts, and Run History as separate destinations, plus a global **Batch Tasks** section for the Task Library and a global **Networking** section for IPAM and Network Maps; VLAN records are managed inside IPAM. Topology drills through Site View, Server Room View, and Rack View. The Site destination is its overview-only Site View and has no Hosts or Batch Runs segmented control. Lives with Dashboard and Install Helper above Settings. Not a Connection, Session, or Dashboard widget. Legacy rows in `itops_automations` are obsolete, disabled, and retained only for backup or selective IT Ops export recovery; no UI, runtime, command, AI tool, or MCP tool can execute them. See `docs/ITOPS.md` and `docs/ADR/0011-it-ops-module.md`.
_Avoid_: operations center, site manager, orchestrator

**Task**:
A durable, reusable IT Ops definition of what to execute: a script or interactive Playbook stored in `itops_tasks`. Tasks are global to the IT Ops Module and own no Site, Host selection, Session, plaintext credential, or live run state. Applicable OS is multi-select Task metadata (`Any OS`, Linux, macOS, Windows, Cisco IOS, Cisco NX-OS, FortiOS, Juniper Junos, or Arista EOS); it documents compatibility and supports Task Library filtering but does not infer or enforce a Host operating system. App-owned built-in Tasks carry a stable catalog key, are refreshed on startup, and are read-only; duplicating one creates an ordinary customizable Task. A Playbook sudo node may persist an opaque reference to a value in the configured secret vault; the Task JSON never contains that value. A Playbook AI node passes the preceding node's output to the currently configured AI Assistant and accepts only a closed `continue` / `success` / `fail` routing decision; it cannot call tools or generate executable actions. A Site/Host selection supplies targets when launched. A Task is not a saved Batch Run.
_Avoid_: Site task, saved run, workflow

**Task Library**:
The global IT Ops collection of reusable Tasks, including the app-owned diagnostic catalog. It appears once in the operational navigator as a sibling of Sites, never once beneath every Site. Opening a user Task shows and manages its definition; built-in Tasks are duplicated before customization. Manual execution starts from selected Hosts, where the launcher offers Tasks from this library. The Task Library is a view/collection, not a durable entity, target container, or run launcher.
_Avoid_: Site Tasks, scripts folder, workflow library, job catalog

**VLAN**:
A durable 802.1Q VLAN record stored in `itops_vlans`, global to the IT Ops Module and managed as a record type inside IPAM. It carries a `vid` (1–4094, unique across the install), a name, a description, an optional soft Site tag that only labels it, and an accent index into the app's IT accent list (an index, never a stored hex colour). A VLAN is a durable record rather than a drawing detail: VLAN 30 drawn on two **Network Maps** is the same VLAN, not a coincidence of spelling. An **IP Prefix** may reference one, and a **Network Link** documents its native and tagged VLANs. Deleting a VLAN clears the IP Prefix reference and deletes nothing else; Network Link references remain in their map and resolve as unknown. KKTerm never reads a VLAN off a switch.
_Avoid_: subnet, broadcast domain (as the stored entity), IP Prefix, network segment

**IPAM**:
The global IT Ops address-plan destination in the navigator's Networking section. It manages **VLANs** and **IP Prefixes** in one typed record grid, with **IP Address Records** nested under Prefixes. It never scans automatically, and an explicit bounded discovery scan stays transient until the operator imports selected results. It does not lease or reserve anything on the network. Prefix nesting, depth, and utilization are recomputed from containment on every read and are never stored, so adding a wider prefix silently re-parents the blocks it now contains. IPAM is a view over three durable tables, not a durable entity itself.
_Avoid_: subnet manager, DHCP, address scanner, DDI

**IP Prefix**:
A durable IPv4 CIDR block stored in `itops_ip_prefixes`, with a role, a status (`container`, `active`, `reserved`, or `deprecated`), an optional free-text VRF label, an optional Site tag, an optional soft **VLAN** reference, and a description. Host bits are cleared on save, so the stored value is always the network address. It is global to the IT Ops Module; the Site tag labels it and never scopes its visibility. The VLAN reference documents "VLAN 30 is 10.20.30.0/24" — a prefix *references* a VLAN, it never *is* one.
_Avoid_: subnet record, network object, VLAN

**IP Address Record**:
A durable single documented IPv4 address stored in `itops_ip_address_records`, with an optional hostname, broad device type, free-text device model, status, VRF, description, and soft references to the Host, Connection, or Rack Device it was imported from. An explicit IPAM scan can suggest the hostname from reverse DNS or SNMP and can conservatively infer device identity from SNMP system metadata and distinctive open ports; the operator chooses whether to import those suggestions. It belongs to an **IP Prefix** by containment and matching VRF, not by a stored parent id. It is documentation, not a lease, reservation, or live binding — deleting it changes nothing on the network.
_Avoid_: IP entry, lease, reservation, host record (that is **Host**)

**Network Map**:
A durable, hand-drawn logical link diagram stored in `itops_network_maps`, global like the Task Library with an optional Site tag that only labels it. One map is one canvas of **Network Nodes** and **Network Links**, persisted whole as a graph document. It is deliberately **not** the physical Site → Server Room → Rack drill-down that **topology** names in KKTerm, and it carries no live device state: KKTerm never discovers, polls, or refreshes a map.
_Avoid_: topology, topology map, network topology, discovery map, live map

**Network Node**:
One resizable shape on a **Network Map**: a label, one of the designer's generic, routing, security, traffic-management, compute/storage, cloud/WAN, wireless, or endpoint kinds, a rectangular, circular, diamond, triangular, or hexagonal silhouette, a canvas position and size, a selectable icon background, optional free-text IP addresses and note, a documented operational/warning status, and optional **Deep Links** to other app elements. Its addresses are captions and link-binding choices, not references into **IPAM**. Status is operator-authored documentation, never live monitoring data. A Network Node is not a **Host**, a **Rack Device**, or a **Connection**, though a map can be seeded from a Site's Hosts.
_Avoid_: device, host (on a map), rack item

**Deep Link**:
An in-app navigation relationship from one KKTerm app element to another KKTerm app element. Both the source and destination belong to the app; activating the Deep Link navigates to or opens the destination without implying a physical network path, data relationship, or live Session. A Network Node may Deep Link to a Connection, Site, Server Room, or Rack Device. A Deep Link is not a web URL, an external URI or operating-system app link, a **Network Link**, or a Connection/Rack binding.
_Avoid_: web link, URL, Network Link, binding, external app link

**Network Link**:
One undirected edge between two **Network Nodes**, with an optional binding from each endpoint to one of that node's documented IP addresses, an optional name/label for the whole link (a circuit id or an uplink name — not a port and not a VLAN, both of which are structured), a kind (ethernet, fiber, WAN, or wireless), a documented operational/warning/down status, an ordered list of **Network Link Strands**, and its VLAN membership. Undirected is deliberate: a link documents a relationship between its endpoints, not a traffic direction or verified connection. Its status is operator-authored documentation.
_Avoid_: connection (that is the durable Connection model), edge, cable, circuit

**Network Map Note**:
A resizable text annotation with an operator-selected background color on a **Network Map**. It always renders behind every **Network Node** and **Network Link** and has no node, link, status, or verification semantics.
_Avoid_: node, device, status notice

**Network Link Strand**:
One of the parallel physical links a drawn **Network Link** stands for: a free-text port name and a free-text speed. Port names and speeds belong to the strand rather than the link because a 2×10G LAG lands on a different port at each end of each member. A link always has at least one strand; the canvas draws up to four, and the `×N` edge label carries the true count beyond that.
_Avoid_: link (the drawn edge is the Network Link), cable, member port (as the stored entity), LAG

**VLAN membership**:
A **Network Link**'s documented native (untagged) VLAN and its tagged (802.1Q) VLANs, held as soft references to durable **VLAN** records. A non-empty tagged set makes the link a trunk. Membership belongs to links only: **Network Nodes** carry no VLAN field, a VLAN is never a node kind on the canvas, and VLAN membership is never mapped onto the parallel strands — a 2×10G LAG carrying six VLANs is two strands, not six.
_Avoid_: VLAN (that is the durable record), trunk (as the stored entity), port mode

**Sites**:
The IT Ops collection of Site records in the operational navigator. Expanding a Site exposes predefined virtual destinations for Server Rooms, Hosts, and Run History; those rows are navigation state, not stored folders. A Site row selects a **Site**. The plural term names the collection, not a durable data type.
_Avoid_: fleets, host groups tab, inventory browser

**Site**:
A durable, named selection of existing Connections (plus an optional dynamic filter by type/folder) used as a target when launching a Task or starting an ad-hoc Batch Run. Stored in `itops_sites`; it references Connection ids and owns no Session and no secret. It is not a Connection type. A Site may own Hosts and a topology of Server Rooms, Racks, and Rack Devices, but it does not own global Tasks.
_Avoid_: fleet, host group, inventory, host list, connection group (as a Connection type)

**Default Site**:
The undeletable fallback Site (stored id `default-fleet`, a legacy literal kept across the
Fleet→Site rename) that exists when IT Ops has no other Site rows. It is a safe top-level parent for Server Rooms, Racks, and Rack Devices, not a Connection or Session.

**Site View**:
The overview-only topology page opened by selecting a Site or its Server Rooms destination. It shows that Site's Server Rooms as cards and is the entry point into Server Room View and Rack View. Hosts and Run History have their own pages and never appear as Site View segments. It is not the same thing as the plural **Sites** collection or the whole Site-owned navigation group.
_Avoid_: dashboard, host group details, Site tab

**Server Room**:
A durable, Site-owned topology entity stored in `itops_server_rooms`. The topology path is **Site → Server Room → Rack**: a Server Room may remain empty, while every new Rack must belong to a Server Room in the same Site. It owns no Connections or Sessions and may gain additional relationships later.
_Avoid_: region, datacenter, site object, zone

**Server Room View**:
The drill-down view for one Server Room. Its elevation layout can flip each Rack between Front and Rear mounting faces, individually or all at once; the spatial layouts include a top-down 2D floor plan and a 2.5D room whose cabinet skins place devices on their physical front or rear faces. Layout state persists where documented in `docs/ITOPS.md`.
_Avoid_: area view, datacenter map

**Rack**:
A durable fixed-height cabinet, usually 42U and 1000 mm deep, that belongs to one Site and one Server Room. Stored in `itops_site_racks`; it holds Rack Devices at U positions and carries physical depth plus an optional cabinet shell finish.
_Avoid_: shelf, cabinet group, host group

**Rack View**:
The single-Rack drill-down stage. It shows Front and Rear elevations side by side when both mounting faces contain Rack Devices (and always while editing), and can show per-device callouts when one face is shown. It is a topology view, not a live Session surface.
_Avoid_: terminal rack, device session view

**Rack Device**:
One visual device occupying a contiguous U span on the Front or Rear mounting face of a Rack. U-space collision is independent per mounting face, while a rack-top item is shared by the cabinet. A Rack Device may be Connection-backed (opens the referenced Connection's Session on click) or passive (switch, PDU, patch panel, or another visual/inventory item). Stored in `itops_site_rack_items`; older code and schema names may still say `RackItem`.
_Avoid_: slot, node, host card

**Rack Device Type**:
The device kind used to render behavior and faceplate visuals, such as server, storage, switch, router, firewall, PDU, UPS, KVM, patch panel, equipment, or general. Type is presentation/inventory metadata, not a Connection type. Connections are associated separately through Rack Device bindings.
_Avoid_: connection type, transport, session kind

**Rack Device Properties**:
Non-secret presentation metadata for a Rack Device: label, Front/Rear mounting side, U position, height, status, accent, icon, notes, shell/faceplate fields, kind-specific values such as ports, disks, battery, load, or a Server's rack/tower form factor and front-panel style, and optional Connection bindings. Tower is a half-width faceplate presentation and does not change vertical U occupancy. Server front-panel style selects scalable artwork only. These properties do not store live Session state or credentials. The editor groups them into type, appearance, and metadata columns; bindings use a separate dialog.
_Avoid_: secrets, runtime status, connection settings

**Host**:
A durable IT Ops inventory entry for one device or guest in a Site, addressed by hostname and stored in `itops_hosts`. The device itself can be a Host, and a Host may carry **child Hosts** — its VMs or containers — via a soft self reference (`parent_host_id`). A Host may bind multiple **Connections** at once (ordered soft references), e.g. an SSH terminal plus an HTTPS URL Connection to its management interface, and stores the last **connectivity scan** snapshot (SSH / WinRM / HTTPS reachability probes) as data, never live Session state and never a secret. Hosts import from a pasted hostname list in the Site's Hosts destination and can be linked to a **Rack Device** (`metadata.hostId`) so the Rack View callout lists the Host and its child Hosts. The Hosts page is also the manual execution surface: select runnable Hosts and launch a reusable Task or ad-hoc Batch Task against exactly that selection. A Host is not a Connection, not a Session, and not the `host` address field of a Connection.
_Avoid_: server entry (as a durable term), connection host field, node, agent

**Batch Task**:
The typed execution payload consumed by the Batch Run executor: either a script body or an interactive Playbook. A durable Task stores one Batch Task, while the Batch Run launcher may also construct one ad hoc. Use **Task** for the reusable user-facing definition and **Batch Task** only for this executor/data-model payload.
_Avoid_: durable Task (when referring only to the payload), job definition

**Script**:
The one-shot Batch Task kind: a free-form command body executed once per resolved Host. A script may be saved inside a reusable Task or entered ad hoc in the Batch Run launcher. Capitalize **Task** when referring to the durable wrapper; a script by itself is only execution content.
_Avoid_: shell Task, job, Playbook

**Batch Run**:
One execution of a reusable Task or ad-hoc Batch Task across resolved targets, fanned out with bounded concurrency over a per-host transport (SSH, WinRM, or PsExec). Live per-host progress streams as it happens; on completion a consolidated report — including each Host's captured output — is written to Run History. A Batch Run is runtime execution, not a durable definition or navigator container.
_Avoid_: broadcast, job, deployment

**Run History**:
The Site-owned navigation destination that lists the active Batch Run and completed run records scoped to that Site. Completed rows come from `itops_run_history`; live progress remains in memory. New manual runs start from selected Hosts, not from Run History. Run History is an audit collection, not a Task library, launch surface, or queue.
_Avoid_: Batch Runs tab, jobs, task history

**Run Report**:
The read-only view of one completed Batch Run. It presents the persisted consolidated result and capped per-Host output snapshot. A Run Report survives later Task edits or deletion.
_Avoid_: Task, live run, Session log

**Playbook**:
A Batch Task kind that may be stored inside a reusable Task: a user-authored, ordered sequence of interactive steps run over a single PTY shell per Host. Each step **sends** a command or input and optionally **waits for** a literal output substring before the next step runs; a step that times out stops the Playbook on that Host while other Hosts continue. Distinct from a one-shot script because steps can answer prompts (`[sudo] password:`, `Continue? [Y/n]`) and build on earlier shell state. See `docs/ITOPS.md` and `src-tauri/src/ssh.rs` (`run_playbook_capture_streaming`).
_Avoid_: workflow, recipe (an Install Helper term), curated update sequence

## UI Layout

**Activity Rail (Left Rail)**:
The vertical icon bar on the far left of the app. Its top section is the **Workspace switcher** — the Default Workspace, any additional Workspaces, and a `+` button that opens the New Workspace wizard; selecting a Workspace activates it and navigates to the Workspace Module. Below that it shows the other top-level built-in Modules (Dashboard, IT Ops, Install Helper, Screenshots, and the Windows-only System Cleaner), enabled Custom Module contributions, connected Connection shortcuts when enabled, and Settings at the bottom. Icons use app-owned delayed hover labels via `RailTooltip`, not native `title` tooltips. App Launcher is intentionally not a Module; it lives inside Dashboard as a widget.
_Avoid_: sidebar, left sidebar, nav bar

**Connection Tree (Connections Panel)**:
The left-side tree view of saved Connections, folders, subfolders, and optional Child Connection Tabs. Visible inside the Workspace Module. Supports search, filtering, drag/drop ordering, rename, delete, duplicate, Quick Connect, and open-Session status badges. Collapsed/expanded state is persisted.
_Avoid_: connection sidebar, host list

**AI Assistant Panel**:
The right-side resizable panel for AI chat interactions. Collapsed/expanded state is workspace-wide.
_Avoid_: AI sidebar, chat panel

**Assistant Memory**:
Short durable notes the AI Assistant saves about the user's environment, stored in the SQLite `assistant_memories` table and scoped to `global` or a specific `connection:<id>`. The global notes plus the active Connection's notes are recalled into the assistant's context at the start of each turn. Plain operator facts only — never secrets, which remain in the OS keychain. Distinct from chat history (the saved transcript of a conversation) and from RAM/working-set "memory" reported in the Status Bar.
_Avoid_: RAM, chat history, context window

**Dashboard Widget Playground**:
The content area of the Dashboard Module. Hosts dynamic, user-selectable widgets and reports, including the App Launcher Widget. The AI Assistant can create new widgets on request.
_Avoid_: landing page, overview

**Default Launch State**:
The fallback view shown when no Sessions are open, displaying recent Connections and a brief workspace overview. Not a Module; it is reached by closing all Tabs inside the Workspace Module.
_Avoid_: dashboard page, home screen

**Workspace Canvas**:
The central content area for the active Module. Each Module (Workspace, Dashboard) owns its own content layout within this area. For the Workspace Module, this includes the Tab Strip, active Tab content (terminals, URL launch placeholders, RDP/VNC surfaces, SFTP/FTP browsers), and optional pane splits.
_Avoid_: main area, content area

**Tab Strip**:
The horizontal row of workspace tabs above the Canvas. Each Tab represents a workspace container presenting a Session or set of related Panes.
_Avoid_: tab bar, tab row

**Pane**:
A subdivision within a Tab that presents one terminal surface or view. Pane toolbars carry terminal/connection controls.

**Status Bar**:
The bottom workspace bar showing left-aligned host usage metrics and the universal popup surface for every transient information, success, warning, and error notification. Transient outcomes are published through `showStatusBarNotice`; determinate work uses `showStatusBarProgress`. Its right side carries app-wide status indicators: the **Watchdog Status Bar** indicator, an AI Assistant working indicator, a managed X server setting indicator, and the Don't Sleep (coffee) indicator.
_Avoid_: footer bar, bottom bar

**Settings Sidebar**:
The left-side navigation within the Settings page, routing between General, AI, Connections, Terminal, and other settings sections.
_Avoid_: settings nav, settings menu

## Relationships

- A **Connection** may start zero or more **Sessions** over time.
- An SSH **Connection** may start terminal **Sessions** and related SFTP browser **Sessions**.
- A **URL Connection** starts a URL **Session** that owns a stable overlay WebView2 window positioned over the active Pane.
- An **RDP Connection** starts a Windows-native remote-desktop **Session** hosted as a native child control over its **Tab**.
- A **VNC Connection** starts a Rust-managed remote framebuffer **Session** rendered into its **Tab**.
- A **Quick Connect** persists a **Connection** (reusing an identical existing SSH Connection when present) and starts a **Session** on it; the only non-persisted case is the external elevated admin shell launched when KKTerm is not elevated.
- A **Quick Command** writes input from the **Quick Command Bar** to a terminal **Pane** in an existing **Session**.
- A **Quick Command Bundle** owns an ordered list of **Quick Commands**; many **Connections** may select the same bundle, and editing it changes every one of them.
- A **Session** may be presented by one **Tab**.
- A terminal **Tab** may contain one or more **Panes**.
- A **Child Connection Tab** is a named, saved frontend Tab instance under a parent **Connection**; opening it creates or activates the corresponding **Tab** and then the live **Session**.
- A **Child Connection Tab** may remember a tmux session id or last terminal directory, but those values remain workspace presentation/reopen hints rather than durable backend **Connection** fields.
- A tmux-enabled SSH terminal **Pane** may start or attach to a named remote tmux session. If `tmux` is unavailable on the remote host, the Pane falls back to the normal remote shell.
- A psmux-enabled local PowerShell **Pane** may start or attach to a named local psmux session via the same toolbar session list. If `psmux` is not installed, the Pane falls back to the normal PowerShell shell.
- A **Tab** is UI state only and is not the durable backend model.
- Switching the active **Tab** does not end, disconnect, or recreate its **Session**.
- A native SSH **Session** must not use an app-side idle timeout. Quiet, unfocused SSH Sessions are expected to remain connected unless the remote server, network, or an explicit user close ends them.
- A tmux-enabled native SSH **Session** may silently attempt a small bounded reattach to the same Pane tmux id if the SSH channel unexpectedly closes.
- A **Session** is intentionally ended only by an explicit close action on the presenting **Tab** or by the remote/process ending itself.
- An **IP Address Record** belongs to an **IP Prefix** by containment and matching VRF; neither stores a parent id, and both survive the other's deletion.
- A **Network Map** owns its **Network Nodes** and **Network Links**; deleting the map deletes the drawing and nothing else.
- A **Network Node** may be seeded from a **Host**, but it does not become one, reference one durably, or reflect its state.
- An **IP Prefix** may reference one **VLAN**, and a **Network Link** may reference one native **VLAN** plus any number of tagged ones. All are soft references: deleting the **VLAN** clears them and leaves both the addressing and the drawing intact.

## Example Dialogue

> **Dev:** "When the user opens the Bastion East **Connection**, should we mutate that row to mark it active?"
> **Domain expert:** "No — opening the **Connection** creates a **Session**. The **Connection** stays durable resource data; live state belongs to the **Session** and its **Tab**."

## Flagged Ambiguities

- "Profile" and "saved connection" were both used for durable openable resources. Resolved: use **Connection** as the canonical term.
- "Session" was previously easy to confuse with a saved connection or visible tab. Resolved: a **Session** is live runtime state, while a **Tab** is only the frontend container.
- "Child connection" can sound like a nested durable Connection. Resolved: use **Child Connection Tab** for the saved child row that reopens a Tab under a parent Connection.
- "Topology" was at risk of naming two different things once logical network diagrams arrived. Resolved: **topology** stays the physical Site → Server Room → Rack drill-down; the logical diagram is a **Network Map** made of **Network Nodes** and **Network Links**, and must never be called a topology map.
- "Workspace" was previously an implicit singleton — the term named both the rail Module and the single Connection Tree. Resolved: **Workspace** is now an instanceable container of Connections; the seeded **Default Workspace** is permanent. The Workspace Module / Workspace Canvas keep their names and render the active Workspace. **Tab** remains the frontend container for a Session, distinct from the capital-W Workspace instance.

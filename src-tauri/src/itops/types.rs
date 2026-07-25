// IT Ops durable types (docs/ITOPS.md). Phase 1 covers Sites, Phase 2 the
// Batch Run report shapes, and Phase 3 the durable Automation.

use std::collections::HashMap;

use serde::{Deserialize, Deserializer, Serialize};

use crate::dashboard_storage::DashboardBackground;
use crate::watchdog::types::WatchdogConfig;

/// A durable Automation (docs/ITOPS.md Phase 3+): the persistent definition of a
/// Watchdog plus an ordered IT Ops action list. The live Watchdog runtime is the
/// sampler/trigger engine (its `config`); when it fires, the IT Ops action
/// executor runs `actions` in order (Phase 4). `enabled` rows re-arm on launch.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub enabled: bool,
    /// Trigger/condition/poll/stop — the live Watchdog config. Its own
    /// `action` stays `Notify` for IT Ops Automations; the real work is the
    /// `actions` list below.
    pub config: WatchdogConfig,
    /// Ordered IT Ops actions run on each trigger fire by the action executor.
    #[serde(default)]
    pub actions: Vec<AutomationAction>,
    /// Optional durable Site binding (soft reference): which Site's
    /// Automations segment lists this rule. `None` = unbound (legacy rows).
    #[serde(default)]
    pub site_id: Option<String>,
}

/// How a `Notify` action surfaces.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotifyLevel {
    #[default]
    InApp,
    Toast,
    Sound,
}

/// The Phase 4 action catalog — a closed, typed set executed in order when an
/// Automation's trigger fires. Actions do not pass data between each other; each
/// reads the trigger snapshot. (AI intervention remains a Watchdog-native action
/// on `config`, not part of this list.)
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AutomationAction {
    Notify {
        #[serde(default)]
        level: NotifyLevel,
    },
    Popup {
        title: String,
        body: String,
    },
    Email {
        to: Vec<String>,
        subject: String,
        body: String,
    },
    Webhook {
        url: String,
        #[serde(default = "default_webhook_method")]
        method: String,
        #[serde(default)]
        body: Option<String>,
    },
    RunBatch {
        // `hostGroupId` alias keeps Automation actions persisted before the
        // Site rename (docs/SITE.md Phase A) deserializable from actions_json.
        #[serde(alias = "hostGroupId")]
        site_id: String,
        task: BatchTask,
    },
}

fn default_webhook_method() -> String {
    "POST".to_string()
}

/// How a Batch Run reaches one host. Stored per Site as the default;
/// `Auto` means "derive from the Connection at run time" (resolved in Phase 2+).
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    Ssh,
    Winrm,
    Psexec,
    #[default]
    Auto,
}

impl Transport {
    pub fn as_db_str(self) -> &'static str {
        match self {
            Transport::Ssh => "ssh",
            Transport::Winrm => "winrm",
            Transport::Psexec => "psexec",
            Transport::Auto => "auto",
        }
    }

    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "ssh" => Some(Transport::Ssh),
            "winrm" => Some(Transport::Winrm),
            "psexec" => Some(Transport::Psexec),
            "auto" => Some(Transport::Auto),
            _ => None,
        }
    }
}

/// Optional dynamic membership filter resolved at run time: a Site picks up
/// later-added Connections that match these criteria. An empty filter is treated
/// as "no filter" and stored as NULL.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SiteFilter {
    /// Connection `connection_type` values to include (e.g. `["ssh"]`).
    #[serde(default)]
    pub types: Vec<String>,
    /// Restrict to Connections directly in this folder.
    #[serde(default)]
    pub folder_id: Option<String>,
}

impl SiteFilter {
    pub fn is_empty(&self) -> bool {
        self.types.is_empty() && self.folder_id.is_none()
    }
}

/// Icon + background colour for a server room, stored on the owning Site.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomIcon {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_background_color: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerRoom {
    pub id: String,
    pub site_id: String,
    pub name: String,
    pub floor_color: String,
    pub sort_order: i64,
}

/// A durable, named selection of existing Connections used as a site target.
/// References Connection ids; owns no Session and no secret.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub member_ids: Vec<String>,
    #[serde(default)]
    pub filter: Option<SiteFilter>,
    pub transport: Transport,
    /// Custom background for the Site (server-room cards) view; reuses the
    /// Dashboard background machinery. None = theme default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<DashboardBackground>,
    /// Per-server-room backgrounds, keyed by the room's string tag. Rooms are
    /// not entities, so their backgrounds live as a map on the owning Site.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub room_backgrounds: HashMap<String, DashboardBackground>,
    /// Custom icon (data URL or lucide/material ref), foreground colour, and background colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_background_color: Option<String>,
    /// Per-server-room icons, keyed by the room's string tag.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub room_icons: HashMap<String, RoomIcon>,
}

/// A Rack in a Site's virtual datacenter (docs/SITE.md): a fixed-height cabinet
/// grouped by `server_room`, holding Rack Devices at U positions. `items` is
/// hydrated on read (storage joins the items in U order). The topology is
/// Site → Server Room → Rack; older region/datacenter/area fields are retired.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rack {
    pub id: String,
    pub site_id: String,
    pub name: String,
    #[serde(default)]
    pub server_room: String,
    /// Optional group tag within the server room (blank = "Ungrouped").
    #[serde(default)]
    pub rack_group: String,
    /// Cabinet shell colour: "black" (default) | "white" | "grey".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    /// Custom background for this rack's single-rack stage view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<DashboardBackground>,
    pub height_u: u32,
    /// Physical cabinet depth in millimetres.
    pub depth_mm: u32,
    /// Optional power capacity of the rack's feed/PDUs, in watts. None = unset
    /// (the power heatmap shows the rack as "no capacity").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power_capacity_w: Option<u32>,
    /// Durable Server Room View placements. `floor_*` is the top-down floor
    /// plan's free position in px; `grid_*` is the 2.5D view's floor grid cell.
    /// None = automatic layout.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub floor_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub floor_y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid_x: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid_y: Option<i64>,
    /// Durable quarter-turn facing on the room floor grid (0..=3, 0 = front
    /// toward +y). None = unset (frontend falls back to its legacy local
    /// store, then the default facing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facing: Option<i64>,
    pub sort_order: i64,
    #[serde(default)]
    pub items: Vec<RackItem>,
}

/// One rack's new placement, sent by the Server Room View when cabinets are
/// rearranged. `kind` (a command argument) selects floor vs. grid columns.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RackPlacementEntry {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

/// One rack's new facing, sent when a cabinet is rotated on the room floor.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RackFacingEntry {
    pub id: String,
    /// Quarter turns, 0..=3.
    pub facing: i64,
}

/// A non-rack Server Room fixture on the room floor grid (docs/SITE.md Room
/// Object): camera, CRAC unit, fire extinguisher, UPS, sensor,
/// smoke detector, crash cart, or 乖乖. `z` is the bottom of the object in
/// rack units above the floor so occupants can stack in one cell.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoomObject {
    pub id: String,
    pub kind: String,
    pub x: i64,
    pub y: i64,
    pub z: i64,
    /// Quarter turns, 0..=3.
    pub rot: i64,
    /// Cell quadrant a quarter-block fixture sits in, clockwise 0=NW..=3=SW.
    /// None on rows saved before the column existed (frontend defaults to NW).
    #[serde(default)]
    pub corner: Option<i64>,
}

/// What a Host is: the device itself, or a guest carried by a parent Host.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HostKind {
    #[default]
    Physical,
    Vm,
    Container,
    Other,
}

impl HostKind {
    pub fn as_db_str(self) -> &'static str {
        match self {
            HostKind::Physical => "physical",
            HostKind::Vm => "vm",
            HostKind::Container => "container",
            HostKind::Other => "other",
        }
    }

    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "physical" => Some(HostKind::Physical),
            "vm" => Some(HostKind::Vm),
            "container" => Some(HostKind::Container),
            "other" => Some(HostKind::Other),
            _ => None,
        }
    }
}

/// The last connectivity-scan snapshot for a Host: which remote-orchestration
/// endpoints answered a TCP probe. A stored result (like the SNMP hint), not
/// live Session state; `None` on the Host means it was never scanned.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostScan {
    /// SSH (port 22) answered.
    #[serde(default)]
    pub ssh: bool,
    /// WinRM (port 5985/5986) answered.
    #[serde(default)]
    pub winrm: bool,
    /// HTTPS (port 443) answered — a management-interface hint.
    #[serde(default)]
    pub https: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scanned_at: Option<String>,
}

/// A durable IT Ops Host (docs/ITOPS.md Hosts): one device or guest in a Site's
/// inventory, addressed by hostname. `parent_host_id` is a soft self reference —
/// a VM/container Host points at the device Host that carries it. A Host may
/// bind several Connections at once (`connection_ids`, ordered soft refs), e.g.
/// an SSH terminal plus an HTTPS management URL. Owns no Session and no secret.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SiteHost {
    pub id: String,
    pub site_id: String,
    #[serde(default)]
    pub parent_host_id: Option<String>,
    pub hostname: String,
    /// Optional display name; blank = show the hostname.
    #[serde(default)]
    pub label: String,
    pub kind: HostKind,
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub scan: Option<HostScan>,
    #[serde(default)]
    pub notes: String,
    pub sort_order: i64,
}

/// Live Host connectivity-scan progress streamed on the `itops://host-scan`
/// channel. Each finished probe re-sends the updated Host so the panel's chips
/// update as results land.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HostScanEvent {
    Host { site_id: String, host: SiteHost },
    Finished { site_id: String },
}

/// What a Rack Device represents. `Connection` items are openable (carry a
/// `connection_id`); the rest are passive inventory/visual devices.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RackItemKind {
    Connection,
    Switch,
    Pdu,
    PatchPanel,
    // Legacy persisted kinds: no longer offered by Rack Device pickers.
    Blank,
    Label,
    Server,
    Storage,
    Router,
    Firewall,
    Ups,
    Kvm,
    GenericDevice,
    Kuaiguai,
}

impl RackItemKind {
    pub fn as_db_str(self) -> &'static str {
        match self {
            RackItemKind::Connection => "connection",
            RackItemKind::Switch => "switch",
            RackItemKind::Pdu => "pdu",
            RackItemKind::PatchPanel => "patchPanel",
            RackItemKind::Blank => "blank",
            RackItemKind::Label => "label",
            RackItemKind::Server => "server",
            RackItemKind::Storage => "storage",
            RackItemKind::Router => "router",
            RackItemKind::Firewall => "firewall",
            RackItemKind::Ups => "ups",
            RackItemKind::Kvm => "kvm",
            RackItemKind::GenericDevice => "genericDevice",
            RackItemKind::Kuaiguai => "kuaiguai",
        }
    }

    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "connection" => Some(RackItemKind::Connection),
            "switch" => Some(RackItemKind::Switch),
            "pdu" => Some(RackItemKind::Pdu),
            "patchPanel" => Some(RackItemKind::PatchPanel),
            "blank" => Some(RackItemKind::Blank),
            "label" => Some(RackItemKind::Label),
            "server" => Some(RackItemKind::Server),
            "storage" => Some(RackItemKind::Storage),
            "router" => Some(RackItemKind::Router),
            "firewall" => Some(RackItemKind::Firewall),
            "ups" => Some(RackItemKind::Ups),
            "kvm" => Some(RackItemKind::Kvm),
            "genericDevice" | "equipment" | "general" => Some(RackItemKind::GenericDevice),
            "kuaiguai" => Some(RackItemKind::Kuaiguai),
            _ => None,
        }
    }
}

/// Which cabinet face a Rack Device is mounted on. This is structural
/// placement data, separate from a Rack's quarter-turn floor facing.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RackMountFace {
    #[default]
    Front,
    Rear,
}

impl RackMountFace {
    pub fn as_db_str(self) -> &'static str {
        match self {
            RackMountFace::Front => "front",
            RackMountFace::Rear => "rear",
        }
    }

    pub fn from_db_str(value: &str) -> Self {
        match value {
            "rear" => RackMountFace::Rear,
            _ => RackMountFace::Front,
        }
    }
}

#[cfg(test)]
mod rack_item_kind_tests {
    use super::RackItemKind;

    #[test]
    fn legacy_generic_device_kinds_migrate_to_the_merged_kind() {
        for legacy in ["equipment", "general"] {
            assert_eq!(
                RackItemKind::from_db_str(legacy),
                Some(RackItemKind::GenericDevice)
            );
        }
        assert_eq!(RackItemKind::GenericDevice.as_db_str(), "genericDevice");
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RackNetworkPort {
    pub name: String,
    pub speed: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RackSnmpHint {
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub community_secret_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_refreshed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum NetworkPortCompat {
    Typed(RackNetworkPort),
    Legacy(String),
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SnmpCompat {
    Typed(RackSnmpHint),
    Legacy(String),
}

fn deserialize_network_ports<'de, D>(
    deserializer: D,
) -> Result<Option<Vec<RackNetworkPort>>, D::Error>
where
    D: Deserializer<'de>,
{
    let values = Option::<Vec<NetworkPortCompat>>::deserialize(deserializer)?;
    Ok(values.map(|entries| {
        entries
            .into_iter()
            .enumerate()
            .filter_map(|(index, entry)| match entry {
                NetworkPortCompat::Typed(mut port) => {
                    port.name = port.name.trim().to_string();
                    (!port.name.is_empty()).then_some(port)
                }
                NetworkPortCompat::Legacy(value) => {
                    let mut parts = value.splitn(2, ':');
                    let name = parts
                        .next()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToString::to_string)
                        .unwrap_or_else(|| (index + 1).to_string());
                    let speed = parts
                        .next()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("custom")
                        .to_ascii_lowercase();
                    Some(RackNetworkPort {
                        name,
                        speed,
                        state: None,
                        oid: None,
                        note: None,
                    })
                }
            })
            .collect()
    }))
}

fn deserialize_snmp<'de, D>(deserializer: D) -> Result<Option<RackSnmpHint>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<SnmpCompat>::deserialize(deserializer)?;
    Ok(value.and_then(|entry| match entry {
        SnmpCompat::Typed(mut snmp) => {
            snmp.target = snmp.target.trim().to_string();
            (!snmp.target.is_empty()).then_some(snmp)
        }
        SnmpCompat::Legacy(raw) => {
            let raw = raw.trim();
            if raw.is_empty() {
                return None;
            }
            let target_and_oid = raw.split('@').nth(1).unwrap_or(raw);
            let mut parts = target_and_oid.splitn(2, ':');
            let target = parts.next().unwrap_or("").trim().to_string();
            (!target.is_empty()).then(|| RackSnmpHint {
                target,
                oid: parts
                    .next()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string),
                community_secret_ref: None,
                last_refreshed_at: None,
                last_error: None,
            })
        }
    }))
}

/// Presentation-only metadata for a Rack Device. No secrets ever land here.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RackItemMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Presentation status driving the device faceplate LEDs and dimming
    /// ("online" | "warning" | "offline"). Stored, not live-polled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Faceplate spec counts: visible ports (switch/router/patch panel) and
    /// drive bays (server/storage); battery and load are 0–100 percentages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ports: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disks: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub battery: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load: Option<u32>,
    /// Nameplate/typical power draw in watts; summed per rack for the Server
    /// Room power heatmap. 0 is normalized to None.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power_w: Option<u32>,
    /// Device shell colour: "black" (default) | "white" | "grey".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expiry: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub yaw: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_ids: Option<Vec<String>>,
    /// Soft reference to an `itops_hosts` row: the Host this device *is*. The
    /// Rack View callout lists the Host and its child Hosts (VMs/containers).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_network_ports",
        skip_serializing_if = "Option::is_none"
    )]
    pub network_ports: Option<Vec<RackNetworkPort>>,
    #[serde(
        default,
        deserialize_with = "deserialize_snmp",
        skip_serializing_if = "Option::is_none"
    )]
    pub snmp: Option<RackSnmpHint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kuaiguai_size: Option<String>,
    /// Standing package ("full", 4U) or package laid face-up ("laidDown", 1U).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kuaiguai_style: Option<String>,
    /// Optional Server Room rack-top corner (clockwise 0=NW..3=SW).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rack_top_corner: Option<u8>,
    /// Optional Server Room rack-top facing (0=+y, 1=-x, 2=-y, 3=+x).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rack_top_facing: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    /// Server chassis presentation ("rack" | "tower").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form_factor: Option<String>,
    /// Fractional faceplate width ("half" | "quarter"); None = full rack width.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width_fraction: Option<String>,
    /// Horizontal slot for a fractional-width device, 0-based from the left in
    /// units of its own width (half: 0–1, quarter: 0–3). None = leftmost.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<u32>,
    /// Server front-panel artwork ("default" | "style1" | "style2").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_panel_style: Option<String>,
}

/// One device occupying a contiguous `start_u..start_u + height_u` span in a
/// Rack. `connection_id` is a soft reference to `connections.id` (None = passive).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RackItem {
    pub id: String,
    pub rack_id: String,
    #[serde(default)]
    pub connection_id: Option<String>,
    pub kind: RackItemKind,
    #[serde(default)]
    pub label: String,
    pub start_u: u32,
    pub height_u: u32,
    #[serde(default)]
    pub mount_face: RackMountFace,
    #[serde(default)]
    pub metadata: RackItemMetadata,
}

/// Optional narrowing of a Batch Run to part of a Site's rack topology
/// (docs/SITE.md Phase D). When set, only the placed Connection items in the
/// matching racks are targeted. All provided (non-empty) fields must match.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunScope {
    #[serde(default)]
    pub rack_id: Option<String>,
    #[serde(default)]
    pub server_room: Option<String>,
    /// Site Host ids selected on the Hosts page. Each Host resolves through
    /// its first bound SSH Connection; Hosts without one are not runnable.
    #[serde(default)]
    pub host_ids: Vec<String>,
}

impl RunScope {
    pub fn is_empty(&self) -> bool {
        self.rack_id.as_deref().unwrap_or("").is_empty()
            && self.server_room.as_deref().unwrap_or("").is_empty()
            && self.host_ids.is_empty()
    }
}

/// One concrete site target produced by resolving a Site at run time.
/// Lightweight and secret-free — the seam the Phase 2 Batch Run executor builds
/// on. Passwords/keys are never carried here; they stay in the keychain.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedHost {
    pub connection_id: String,
    pub name: String,
    pub host: String,
    pub username: String,
    pub port: Option<i64>,
    pub connection_type: String,
    pub transport: Transport,
}

/// One ordered Playbook node. Command nodes type `send` into the host's PTY and
/// may wait for `expect`; sudo nodes acquire cached elevation from a vault
/// reference; AI nodes evaluate the preceding node output through a closed
/// structured decision contract.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlaybookStep {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub kind: PlaybookStepKind,
    /// Short label shown in the run report (e.g. "update apt cache").
    pub name: String,
    /// Text sent to the interactive shell — a command, or an answer to a prompt
    /// (e.g. `y`, a path). A carriage return is appended by the runner.
    pub send: String,
    /// Literal substring to wait for in the output before the step is done.
    /// `None` (or empty) sends `send` and immediately advances.
    #[serde(default)]
    pub expect: Option<String>,
    /// Per-step wait budget for `expect`. Falls back to the run default when unset.
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    /// Reference to the configured secret store. Never contains plaintext.
    #[serde(default)]
    pub secret_owner_id: Option<String>,
    /// Instruction for an AI node. Its input is the preceding node's output.
    #[serde(default)]
    pub ai_instruction: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybookStepKind {
    #[default]
    Command,
    Sudo,
    Ai,
}

/// What a Batch Run executes on each targeted host (docs/ITOPS.md).
/// - `Script` runs one free-form command on a fresh exec channel.
/// - `Playbook` runs an ordered, interactive expect-style step sequence over a
///   single PTY shell so a step can answer a prompt the previous step raised.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BatchTask {
    Script {
        body: String,
        #[serde(default)]
        shell: Option<String>,
    },
    Playbook {
        name: String,
        steps: Vec<PlaybookStep>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskOperatingSystem {
    Any,
    Linux,
    Macos,
    Windows,
    CiscoIos,
    CiscoNxos,
    FortiOs,
    Junos,
    AristaEos,
}

fn default_task_operating_systems() -> Vec<TaskOperatingSystem> {
    vec![TaskOperatingSystem::Any]
}

/// A reusable, global IT Ops task definition. Targets are deliberately absent:
/// a Site, Host selection, or Automation supplies them when the Task launches.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItopsTask {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub sort_order: i64,
    #[serde(default = "default_task_operating_systems")]
    pub applicable_os: Vec<TaskOperatingSystem>,
    #[serde(default)]
    pub built_in_key: Option<String>,
    pub task: BatchTask,
}

impl BatchTask {
    pub fn secret_owner_ids(&self) -> Vec<String> {
        match self {
            Self::Playbook { steps, .. } => steps
                .iter()
                .filter_map(|step| step.secret_owner_id.clone())
                .collect(),
            Self::Script { .. } => Vec::new(),
        }
    }

    /// A redacted, one-line label for the run-history audit log — never the full
    /// script body, which may embed secrets.
    pub fn summary(&self) -> String {
        match self {
            BatchTask::Script { body, .. } => {
                let first = body
                    .lines()
                    .map(str::trim)
                    .find(|line| !line.is_empty())
                    .unwrap_or("");
                let mut label = first.chars().take(80).collect::<String>();
                if first.chars().count() > 80 {
                    label.push('…');
                }
                if label.is_empty() {
                    "script".to_string()
                } else {
                    label
                }
            }
            // Playbooks carry a user-supplied name; the audit log shows it verbatim
            // (never the step bodies, which may embed secrets), falling back to a
            // neutral label when blank.
            BatchTask::Playbook { name, .. } => {
                let trimmed = name.trim();
                if trimmed.is_empty() {
                    "playbook".to_string()
                } else {
                    let mut label = trimmed.chars().take(80).collect::<String>();
                    if trimmed.chars().count() > 80 {
                        label.push('…');
                    }
                    label
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playbook_summary_uses_name_or_falls_back() {
        let named = BatchTask::Playbook {
            name: "  Restart web tier  ".to_string(),
            steps: vec![],
        };
        assert_eq!(named.summary(), "Restart web tier");

        let blank = BatchTask::Playbook {
            name: "   ".to_string(),
            steps: vec![],
        };
        assert_eq!(blank.summary(), "playbook");
    }

    #[test]
    fn playbook_step_defaults_old_rows_to_command_and_keeps_only_secret_reference() {
        let old: PlaybookStep = serde_json::from_value(serde_json::json!({
            "name": "uptime",
            "send": "uptime",
            "expect": null,
            "timeoutSeconds": 10
        }))
        .unwrap();
        assert_eq!(old.kind, PlaybookStepKind::Command);
        assert_eq!(old.secret_owner_id, None);

        let task = BatchTask::Playbook {
            name: "restart".to_string(),
            steps: vec![PlaybookStep {
                id: Some("step-1".to_string()),
                kind: PlaybookStepKind::Sudo,
                name: "Acquire sudo".to_string(),
                send: String::new(),
                expect: Some("KKTerm sudo password: ".to_string()),
                timeout_seconds: Some(30),
                secret_owner_id: Some("itops-sudo-1".to_string()),
                ai_instruction: None,
            }],
        };
        assert_eq!(task.secret_owner_ids(), vec!["itops-sudo-1"]);
        let json = serde_json::to_string(&task).unwrap();
        assert!(json.contains("itops-sudo-1"));
        assert!(!json.contains("password-value"));

        let ai: PlaybookStep = serde_json::from_value(serde_json::json!({
            "id": "step-ai",
            "kind": "ai",
            "name": "Evaluate health",
            "send": "",
            "aiInstruction": "Succeed only when the service is active"
        }))
        .unwrap();
        assert_eq!(ai.kind, PlaybookStepKind::Ai);
        assert_eq!(
            ai.ai_instruction.as_deref(),
            Some("Succeed only when the service is active")
        );
    }
}

/// The outcome of running a Batch Task on one host. `ok` means the transport
/// reached the host and the command exited 0.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecOutcome {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub output: String,
    /// Set when the transport itself failed (connect/auth/timeout).
    pub error: Option<String>,
}

/// One host's row in the consolidated, persisted run report.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostReport {
    pub connection_id: String,
    pub name: String,
    pub host: String,
    pub transport: Transport,
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub bytes_out: u64,
    pub duration_ms: u64,
    /// Full combined stdout/stderr for this host, so a saved Run Report can be
    /// reopened with output later. Capped (see `runner::cap_output`). Defaults to
    /// empty when deserializing older history rows written before output was
    /// persisted.
    #[serde(default)]
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The consolidated report blob stored in `itops_run_history.report_json`.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunReport {
    pub ok: usize,
    pub failed: usize,
    pub total: usize,
    pub hosts: Vec<HostReport>,
}

/// A persisted run-history entry (one finished Batch Run).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunHistoryEntry {
    pub id: String,
    pub source: String,
    pub site_id: Option<String>,
    pub task_id: Option<String>,
    pub task_summary: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub report: RunReport,
}

/// A host as announced in the run's `Started` event (before execution).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventHost {
    pub connection_id: String,
    pub name: String,
    pub host: String,
    pub transport: Transport,
}

/// Live Batch Run progress streamed to the frontend on the `itops://run`
/// channel. In-memory only; the durable record is the `RunReport`.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunEvent {
    Started {
        run_id: String,
        site_id: Option<String>,
        task_summary: String,
        hosts: Vec<RunEventHost>,
    },
    HostStarted {
        run_id: String,
        connection_id: String,
    },
    /// An incremental stdout/stderr frame for a still-running host, streamed as
    /// it arrives. The frontend appends `chunk` to the host's live output; the
    /// authoritative full output still arrives in `HostFinished`.
    HostOutput {
        run_id: String,
        connection_id: String,
        chunk: String,
    },
    HostFinished {
        run_id: String,
        connection_id: String,
        ok: bool,
        exit_code: Option<i32>,
        output: String,
        duration_ms: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Finished {
        run_id: String,
        report: RunReport,
    },
    Canceled {
        run_id: String,
    },
}

// ── IPAM (docs/ITOPS.md IP Address Management) ────────────────────────────────
// Two durable tables, one derived view. A Prefix stores only what the user
// typed; hierarchy, utilization, and address counts are recomputed on every
// read from `ipv4` so a prefix can never disagree with the records inside it.

/// Lifecycle of a Prefix. `Container` prefixes are aggregates whose utilization
/// comes from the child prefixes carved out of them; the rest are leaves whose
/// utilization comes from the IP Address Records inside them.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PrefixStatus {
    Container,
    #[default]
    Active,
    Reserved,
    Deprecated,
}

/// Lifecycle of a single assigned address.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AddressStatus {
    #[default]
    Active,
    Reserved,
    Deprecated,
}

/// A durable IPv4 prefix. `cidr` is stored canonicalized (host bits cleared).
/// `vrf` is a free-text routing-table label so overlapping RFC 1918 space in
/// different VRFs stays distinct; the empty string is the default table.
/// `site_id` is a soft reference (no FK): deleting a Site leaves the prefix as
/// unscoped global space rather than erasing addressing records.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpPrefix {
    pub id: String,
    pub cidr: String,
    #[serde(default)]
    pub vrf: String,
    /// Free-text purpose label ("Management", "DMZ", …).
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub status: PrefixStatus,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub site_id: Option<String>,
}

/// One assigned address inside a Prefix. The optional ids are soft references
/// to a Site, Site Host, Connection, and Rack Device. A live Host binding
/// implies its owning Site; otherwise a snapshot inherits the Site of the
/// most-specific containing Prefix when `site_id` is not set directly.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpAddressRecord {
    pub id: String,
    pub address: String,
    #[serde(default)]
    pub vrf: String,
    #[serde(default)]
    pub status: AddressStatus,
    #[serde(default)]
    pub dns_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub site_id: Option<String>,
    /// True only in snapshot responses when `site_id` was inherited from a
    /// containing Prefix rather than stored directly on this address.
    #[serde(default)]
    pub site_inherited: bool,
    #[serde(default)]
    pub host_id: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub rack_item_id: Option<String>,
}

/// A Prefix plus everything derived from the rest of the table. Never stored:
/// recomputed on each list so hierarchy and utilization cannot drift.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpamPrefixNode {
    #[serde(flatten)]
    pub prefix: IpPrefix,
    /// Innermost enclosing prefix in the same VRF, or `None` at the top level.
    pub parent_id: Option<String>,
    pub depth: u32,
    pub network: String,
    pub broadcast: String,
    pub first_usable: String,
    pub last_usable: String,
    /// Assignable addresses (network/broadcast excluded except on /31 and /32).
    pub usable: u64,
    /// Addresses accounted for: covered child-prefix space on a Container,
    /// assigned Address Records otherwise.
    pub used: u64,
    /// `used / usable` clamped to 0..=1, or 0 when the denominator is 0.
    pub utilization: f64,
    pub child_count: u32,
    pub address_count: u32,
}

/// One read of the whole IPAM destination.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpamSnapshot {
    pub prefixes: Vec<IpamPrefixNode>,
    pub addresses: Vec<IpAddressRecord>,
}

// ── Network Map (docs/ITOPS.md Network Map) ───────────────────────────────────
// The logical link diagram, distinct from the physical Site → Server Room →
// Rack topology. One row per map holds the whole graph as JSON, following the
// Room Objects / Automation `actions_json` precedent: the canvas always saves
// as a whole document, so per-node CRUD would only add round trips.

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NetworkNodeKind {
    Router,
    #[default]
    Switch,
    Firewall,
    Server,
    LoadBalancer,
    Cloud,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NetworkLinkKind {
    #[default]
    Ethernet,
    Fiber,
    Wan,
    Wireless,
}

/// One device on a Network Map. `address` optionally ties the node to an IPAM
/// record; the three id fields are soft references like an Address Record's.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkNode {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub kind: NetworkNodeKind,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// Optional management address, matched against IPAM Address Records.
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub host_id: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub rack_item_id: Option<String>,
    #[serde(default)]
    pub note: String,
}

/// An undirected link between two Network Nodes. `from`/`to` are node ids.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkLink {
    pub id: String,
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub kind: NetworkLinkKind,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkGraph {
    #[serde(default)]
    pub nodes: Vec<NetworkNode>,
    #[serde(default)]
    pub links: Vec<NetworkLink>,
    /// Node ids treated as the network's entry points for reachability. Empty
    /// means "use the first node"; the What-If analysis walks outward from here.
    #[serde(default)]
    pub roots: Vec<String>,
}

/// A durable Network Map. `site_id` is an optional soft reference; `None` means
/// the map spans Sites, which is the common case for WAN diagrams.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkMap {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub site_id: Option<String>,
    pub sort_order: i64,
    #[serde(default)]
    pub graph: NetworkGraph,
}

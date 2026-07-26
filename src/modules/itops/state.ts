// IT Ops Module frontend store. Phase 1 owns durable Sites: a thin cache
// over the itops_* Tauri commands so the rail badge, the Sites tab, and
// any dialog share one source of truth and update live after a mutation without
// a full reload. Live Batch Run / Automation state arrives in later phases.

import { create } from "zustand";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import type {
  AddressStatus,
  Automation,
  AutomationAction,
  AutomationTestResult,
  BatchTask,
  IpamSnapshot,
  IpamDeviceType,
  ItopsTask,
  Vlan,
  NetworkGraph,
  NetworkMap,
  PrefixStatus,
  TaskOperatingSystem,
  HostImportResult,
  HostKind,
  HostScanEvent,
  Site,
  SiteFilter,
  SiteHost,
  ItopsTransport,
  Rack,
  RackMountFace,
  ServerRoom,
  RackItemKind,
  RackItemMetadata,
  ResolvedHost,
  RoomIconEntry,
  RunEvent,
  RunHistoryEntry,
  RunScope,
} from "../../types";
import type { DashboardBackground } from "../dashboard/types";
import type { WatchdogConfig } from "../../watchdog/types";
import { sanitizeRoomObjects, type RoomObject } from "./roomObjects";

/** Every place the IT Ops navigator can land. The last three are global Library
 * destinations that stand outside any one Site. */
export type ItOpsDestination =
  | "site"
  | "serverRooms"
  | "hosts"
  | "automations"
  | "runHistory"
  | "taskLibrary"
  | "vlans"
  | "ipam"
  | "networkMaps";

/** A navigator selection requested from outside the Module: which Site to
 * select and which of its destinations (or a global Library page) to open. */
export interface ItOpsNavigationRequest {
  siteId?: string;
  destination?: ItOpsDestination;
}

/** Where the IT Ops navigator currently is. Mirrored by the Sites tab so the
 * assistant page context can describe the user's position; never persisted. */
export interface ItOpsNavigationSnapshot {
  siteId: string | null;
  destination: ItOpsDestination;
  serverRoom: string | null;
  rackId: string | null;
}

export interface SiteInput {
  name: string;
  memberIds: string[];
  filter: SiteFilter | null;
  transport: ItopsTransport;
  iconColor?: string | null;
  iconDataUrl?: string | null;
  iconBackgroundColor?: string | null;
}

export interface RackInput {
  name: string;
  serverRoom: string;
  rackGroup: string;
  shell?: string | null;
  heightU: number;
  depthMm: number;
  powerCapacityW?: number | null;
}

/** Which Server Room View layout a placement update targets. */
export type RackPlacementKind = "floor" | "grid";

export interface RackPlacementUpdate {
  id: string;
  x: number;
  y: number;
}

export interface RackFacingUpdate {
  id: string;
  /** Quarter turns, 0-3. */
  facing: number;
}

export interface RackClonePlacement {
  gridX: number;
  gridY: number;
  /** Quarter turns, 0-3. */
  facing: number;
}

export interface PlaceItemInput {
  rackId: string;
  connectionId: string | null;
  kind: RackItemKind;
  label: string;
  startU: number;
  heightU: number;
  mountFace: RackMountFace;
  metadata?: RackItemMetadata;
}

export interface UpdateItemInput {
  id: string;
  kind: RackItemKind;
  connectionId: string | null;
  label: string;
  metadata?: RackItemMetadata;
  mountFace?: RackMountFace;
  /** Properties editor only: validate and persist a resize in the same write. */
  startU?: number;
  heightU?: number;
}

export interface HostInput {
  hostname: string;
  label: string;
  kind: HostKind;
  parentHostId: string | null;
  notes: string;
}

/** What the Prefix dialog collects; the backend canonicalizes the CIDR. */
export interface PrefixInput {
  cidr: string;
  vrf: string;
  role: string;
  status: PrefixStatus;
  description: string;
  siteId: string | null;
  vlanId: string | null;
}

export interface VlanInput {
  vid: number;
  name: string;
  description: string;
  siteId: string | null;
  accent: number;
}

export interface AddressInput {
  address: string;
  vrf: string;
  status: AddressStatus;
  dnsName: string;
  deviceType: IpamDeviceType | null;
  deviceModel: string;
  description: string;
  siteId: string | null;
  hostId: string | null;
  connectionId: string | null;
  rackItemId: string | null;
}

const EMPTY_IPAM: IpamSnapshot = { prefixes: [], addresses: [] };

/** VLANs list by 802.1Q id, matching the order the backend returns them in, so
 * a locally-patched list never reorders under the user after a save. */
function sortVlans(vlans: Vlan[]): Vlan[] {
  return [...vlans].sort((a, b) => a.vid - b.vid);
}

// The command args are the input fields verbatim; naming them once keeps the
// create and update calls from drifting apart as fields are added.
function prefixArgs(input: PrefixInput) {
  return {
    cidr: input.cidr,
    vrf: input.vrf,
    role: input.role,
    status: input.status,
    description: input.description,
    siteId: input.siteId,
    vlanId: input.vlanId,
  };
}

function addressArgs(input: AddressInput) {
  return {
    address: input.address,
    vrf: input.vrf,
    status: input.status,
    dnsName: input.dnsName,
    deviceType: input.deviceType,
    deviceModel: input.deviceModel,
    description: input.description,
    siteId: input.siteId,
    hostId: input.hostId,
    connectionId: input.connectionId,
    rackItemId: input.rackItemId,
  };
}

export type LiveRunHostStatus = "pending" | "running" | "ok" | "failed";

export interface LiveRunHost {
  connectionId: string;
  name: string;
  host: string;
  transport: ItopsTransport;
  status: LiveRunHostStatus;
  exitCode?: number | null;
  output?: string;
  durationMs?: number;
  error?: string | null;
}

export interface LiveRun {
  runId: string;
  siteId?: string | null;
  taskSummary: string;
  hosts: LiveRunHost[];
  state: "running" | "done" | "canceled";
}

const MAX_LIVE_OUTPUT = 256 * 1024;

function appendLiveOutput(current: string, chunk: string): string {
  if (current.length >= MAX_LIVE_OUTPUT) return current;
  return (current + chunk).slice(0, MAX_LIVE_OUTPUT);
}

// Fold a streamed `itops://run` event into the live run snapshot. Events for a
// stale run id are ignored so a new run cleanly supersedes the previous one.
function reduceRun(run: LiveRun | null, event: RunEvent): LiveRun | null {
  switch (event.kind) {
    case "started":
      return {
        runId: event.runId,
        siteId: event.siteId,
        taskSummary: event.taskSummary,
        hosts: event.hosts.map((host) => ({ ...host, status: "pending" as const })),
        state: "running",
      };
    case "hostStarted":
      if (!run || run.runId !== event.runId) return run;
      return {
        ...run,
        hosts: run.hosts.map((host) =>
          host.connectionId === event.connectionId
            ? { ...host, status: "running", output: "" }
            : host,
        ),
      };
    case "hostOutput":
      if (!run || run.runId !== event.runId) return run;
      return {
        ...run,
        hosts: run.hosts.map((host) =>
          host.connectionId === event.connectionId
            ? { ...host, output: appendLiveOutput(host.output ?? "", event.chunk) }
            : host,
        ),
      };
    case "hostFinished":
      if (!run || run.runId !== event.runId) return run;
      return {
        ...run,
        hosts: run.hosts.map((host) =>
          host.connectionId === event.connectionId
            ? {
                ...host,
                status: event.ok ? "ok" : "failed",
                exitCode: event.exitCode,
                // The final event carries the authoritative full output, but on a
                // timeout/transport error it is empty — keep what already streamed
                // so a host that printed output before timing out doesn't blank.
                output: event.output
                  ? appendLiveOutput("", event.output)
                  : host.output,
                durationMs: event.durationMs,
                error: event.error,
              }
            : host,
        ),
      };
    case "finished": {
      if (!run || run.runId !== event.runId) return run;
      // Reconcile every host from the authoritative final report. Per-host
      // `hostFinished` events can be dropped or arrive out of order relative to
      // `started` (they originate on different threads), which would otherwise
      // leave a host stuck at "pending"/"running" and the tally reading 0. The
      // report is the same blob persisted to run history, so folding it in makes
      // the live view match what a relaunch would show.
      const byId = new Map(event.report.hosts.map((host) => [host.connectionId, host]));
      return {
        ...run,
        state: "done",
        hosts: run.hosts.map((host) => {
          const report = byId.get(host.connectionId);
          if (!report) return host;
          return {
            ...host,
            status: report.ok ? "ok" : "failed",
            exitCode: report.exitCode,
            output: report.output ? appendLiveOutput("", report.output) : host.output,
            durationMs: report.durationMs,
            error: report.error,
          };
        }),
      };
    }
    case "canceled":
      if (!run || run.runId !== event.runId) return run;
      return { ...run, state: "canceled" };
    default:
      return run;
  }
}

interface ItOpsState {
  sites: Site[];
  loaded: boolean;
  loading: boolean;
  /** Bumped when the module header's "New Site" button is pressed so the
   *  Sites tab (which owns the dialog + selection) opens the create flow. */
  newGroupRequest: number;
  requestNewSite: () => void;
  /** Pending navigator selection requested from outside the Module (the AI
   *  assistant's tutorial_highlight navigation). The Sites tab consumes and
   *  clears it once mounted, so a request made before the Module is open
   *  still applies. */
  pendingNavigation: ItOpsNavigationRequest | null;
  requestNavigation: (request: ItOpsNavigationRequest) => void;
  clearNavigation: () => void;
  /** The navigator's current position (see ItOpsNavigationSnapshot). */
  navigationSnapshot: ItOpsNavigationSnapshot | null;
  setNavigationSnapshot: (snapshot: ItOpsNavigationSnapshot) => void;
  loadSites: () => Promise<void>;
  createSite: (input: SiteInput) => Promise<Site>;
  updateSite: (id: string, input: SiteInput) => Promise<Site>;
  removeSite: (id: string) => Promise<void>;
  resolveSite: (id: string) => Promise<ResolvedHost[]>;

  // ── Site topology / Rack View (docs/SITE.md Phase C) ──
  /** Racks per Site id, hydrated with their items. Loaded on demand. */
  racksBySite: Record<string, Rack[]>;
  serverRoomsBySite: Record<string, ServerRoom[]>;
  loadServerRooms: (siteId: string) => Promise<void>;
  createServerRoom: (siteId: string, name: string, floorColor: string) => Promise<ServerRoom>;
  updateServerRoom: (
    siteId: string,
    id: string,
    name: string,
    floorColor: string,
  ) => Promise<ServerRoom>;
  deleteServerRoom: (siteId: string, id: string) => Promise<void>;
  duplicateServerRoom: (
    siteId: string,
    id: string,
    name: string,
    floorColor: string,
  ) => Promise<ServerRoom>;
  loadRacks: (siteId: string) => Promise<void>;
  createRack: (siteId: string, input: RackInput) => Promise<Rack>;
  updateRack: (siteId: string, id: string, input: RackInput) => Promise<void>;
  deleteRack: (siteId: string, id: string) => Promise<void>;
  duplicateRack: (
    siteId: string,
    id: string,
    input: RackInput,
    placement?: RackClonePlacement,
  ) => Promise<Rack>;
  /** Persist Server Room View placements durably; updates the cache in place. */
  setRackPlacements: (
    siteId: string,
    kind: RackPlacementKind,
    entries: RackPlacementUpdate[],
  ) => Promise<void>;
  /** Persist quarter-turn rack facings durably; updates the cache in place. */
  setRackFacings: (siteId: string, entries: RackFacingUpdate[]) => Promise<void>;
  /** One Server Room's durable Room Objects (empty outside the Tauri runtime). */
  loadRoomObjects: (siteId: string, serverRoom: string) => Promise<RoomObject[]>;
  /** Replace one Server Room's durable Room Objects. */
  saveRoomObjects: (siteId: string, serverRoom: string, objects: RoomObject[]) => Promise<void>;
  setSiteBackground: (siteId: string, background: DashboardBackground | null) => Promise<void>;
  setServerRoomBackground: (
    siteId: string,
    serverRoom: string,
    background: DashboardBackground | null,
  ) => Promise<void>;
  setRoomIcon: (
    siteId: string,
    serverRoom: string,
    icon: RoomIconEntry | null,
  ) => Promise<void>;
  setRackBackground: (
    siteId: string,
    rackId: string,
    background: DashboardBackground | null,
  ) => Promise<void>;
  placeRackItem: (siteId: string, input: PlaceItemInput) => Promise<void>;
  updateRackItem: (siteId: string, input: UpdateItemInput) => Promise<void>;
  moveRackItem: (
    siteId: string,
    input: {
      id: string;
      rackId: string;
      startU: number;
      heightU: number;
      slot?: number;
      mountFace?: RackMountFace;
    },
  ) => Promise<void>;
  removeRackItem: (siteId: string, id: string) => Promise<void>;
  refreshRackItemSnmp: (siteId: string, id: string) => Promise<void>;

  // ── Hosts (docs/ITOPS.md Hosts) ──
  /** Host inventory per Site id, flat rows in stored order. Loaded on demand. */
  hostsBySite: Record<string, SiteHost[]>;
  /** Host ids with a connectivity scan in flight (drives the "scanning" chip). */
  scanningHostIds: Record<string, true>;
  loadHosts: (siteId: string) => Promise<void>;
  createHost: (siteId: string, input: HostInput) => Promise<SiteHost>;
  updateHost: (
    siteId: string,
    id: string,
    input: HostInput & { connectionIds: string[] },
  ) => Promise<SiteHost>;
  deleteHost: (siteId: string, id: string) => Promise<void>;
  /** Import a parsed hostname list, then start a connectivity scan over the
   *  created rows. Returns the import outcome (created + skipped counts). */
  importHosts: (siteId: string, hostnames: string[]) => Promise<HostImportResult>;
  /** Scan the given Hosts (all of the Site's Hosts when empty) for SSH/WinRM/
   *  HTTPS endpoints. Per-host results stream in via applyHostScanEvent. */
  scanHosts: (siteId: string, hostIds: string[]) => Promise<void>;
  /** Fold one streamed `itops://host-scan` event into the Host cache. */
  applyHostScanEvent: (event: HostScanEvent) => void;
  // ── Batch Runs (Phase 2) ──
  activeRun: LiveRun | null;
  runHistory: RunHistoryEntry[];
  historyLoaded: boolean;
  /** Bumped to open the Batch Run launcher; pendingRunGroupId preselects a group. */
  newRunRequest: number;
  pendingRunGroupId: string | null;
  /** Optional Rack / Server Room scope carried into the launcher for a scoped run. */
  pendingRunScope: RunScope | null;
  pendingRunTask: BatchTask | null;
  requestNewBatchRun: (siteId?: string, scope?: RunScope, task?: BatchTask) => void;
  applyRunEvent: (event: RunEvent) => void;
  startBatchRun: (siteId: string, task: BatchTask, scope?: RunScope | null, taskId?: string | null) => Promise<string>;
  cancelRun: (runId: string) => Promise<void>;
  loadRunHistory: () => Promise<void>;

  // ── Global Task Library ──
  tasks: ItopsTask[];
  tasksLoaded: boolean;
  loadTasks: () => Promise<void>;
  createTask: (name: string, description: string, applicableOs: TaskOperatingSystem[], task: BatchTask) => Promise<ItopsTask>;
  updateTask: (id: string, name: string, description: string, applicableOs: TaskOperatingSystem[], task: BatchTask) => Promise<ItopsTask>;
  removeTask: (id: string) => Promise<void>;

  // ── Global VLANs ──
  // Durable global records, a sibling of IPAM in the Library section. VLANs are
  // referenced by IP Prefixes and Network Links, so every surface reads this
  // one list rather than each keeping its own copy.
  vlans: Vlan[];
  vlansLoaded: boolean;
  loadVlans: () => Promise<void>;
  createVlan: (input: VlanInput) => Promise<Vlan>;
  updateVlan: (id: string, input: VlanInput) => Promise<Vlan>;
  removeVlan: (id: string) => Promise<void>;

  // ── Global IPAM ──
  // One snapshot holds both tables. Every mutation reloads it rather than
  // patching in place: hierarchy and utilization are derived server-side, so a
  // local splice would leave the parent's numbers stale.
  ipam: IpamSnapshot;
  ipamLoaded: boolean;
  loadIpam: () => Promise<void>;
  createPrefix: (input: PrefixInput) => Promise<void>;
  updatePrefix: (id: string, input: PrefixInput) => Promise<void>;
  removePrefix: (id: string) => Promise<void>;
  createAddress: (input: AddressInput) => Promise<void>;
  updateAddress: (id: string, input: AddressInput) => Promise<void>;
  removeAddress: (id: string) => Promise<void>;
  suggestFreeAddresses: (cidr: string, vrf: string, limit?: number) => Promise<string[]>;

  // ── Global Network Maps ──
  networkMaps: NetworkMap[];
  networkMapsLoaded: boolean;
  loadNetworkMaps: () => Promise<void>;
  createNetworkMap: (
    name: string,
    description: string,
    siteId: string | null,
    graph?: NetworkGraph,
  ) => Promise<NetworkMap>;
  saveNetworkMap: (
    id: string,
    name: string,
    description: string,
    siteId: string | null,
    graph: NetworkGraph,
  ) => Promise<NetworkMap>;
  removeNetworkMap: (id: string) => Promise<void>;

  // ── Automations (Phase 3) ──
  automations: Automation[];
  automationsLoaded: boolean;
  newAutomationRequest: number;
  requestNewAutomation: () => void;
  loadAutomations: () => Promise<void>;
  createAutomation: (
    name: string,
    config: WatchdogConfig,
    actions: AutomationAction[],
    enabled: boolean,
    siteId: string | null,
  ) => Promise<Automation>;
  updateAutomation: (
    id: string,
    name: string,
    config: WatchdogConfig,
    actions: AutomationAction[],
    siteId: string | null,
  ) => Promise<Automation>;
  setAutomationEnabled: (id: string, enabled: boolean) => Promise<void>;
  removeAutomation: (id: string) => Promise<void>;
  testAutomation: (config: WatchdogConfig) => Promise<AutomationTestResult>;
}

export const useItOpsStore = create<ItOpsState>((set, get) => ({
  sites: [],
  loaded: false,
  loading: false,
  newGroupRequest: 0,

  requestNewSite() {
    set({ newGroupRequest: get().newGroupRequest + 1 });
  },

  pendingNavigation: null,
  requestNavigation(request) {
    set({ pendingNavigation: request });
  },
  clearNavigation() {
    set({ pendingNavigation: null });
  },

  navigationSnapshot: null,
  setNavigationSnapshot(snapshot) {
    set({ navigationSnapshot: snapshot });
  },

  async loadSites() {
    if (!isTauriRuntime()) {
      set({ loaded: true });
      return;
    }
    set({ loading: true });
    try {
      const sites = await invokeCommand("itops_list_sites");
      set({ sites, loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  async createSite(input) {
    const created = await invokeCommand("itops_create_site", {
      name: input.name,
      memberIds: input.memberIds,
      filter: input.filter,
      transport: input.transport,
      iconColor: input.iconColor ?? null,
      iconDataUrl: input.iconDataUrl ?? null,
      iconBackgroundColor: input.iconBackgroundColor ?? null,
    });
    set({ sites: [...get().sites, created] });
    return created;
  },

  async updateSite(id, input) {
    const updated = await invokeCommand("itops_update_site", {
      id,
      name: input.name,
      memberIds: input.memberIds,
      filter: input.filter,
      transport: input.transport,
      iconColor: input.iconColor ?? null,
      iconDataUrl: input.iconDataUrl ?? null,
      iconBackgroundColor: input.iconBackgroundColor ?? null,
    });
    set({
      sites: get().sites.map((group) => (group.id === id ? updated : group)),
    });
    return updated;
  },

  async removeSite(id) {
    await invokeCommand("itops_remove_site", { id });
    set({ sites: get().sites.filter((group) => group.id !== id) });
  },

  async resolveSite(id) {
    if (!isTauriRuntime()) {
      return [];
    }
    return invokeCommand("itops_resolve_site", { id });
  },

  // ── Site topology / Rack View ──
  racksBySite: {},
  serverRoomsBySite: {},

  async loadServerRooms(siteId) {
    if (!isTauriRuntime()) {
      set({ serverRoomsBySite: { ...get().serverRoomsBySite, [siteId]: [] } });
      return;
    }
    const rooms = await invokeCommand("itops_list_server_rooms", { siteId });
    set({ serverRoomsBySite: { ...get().serverRoomsBySite, [siteId]: rooms } });
  },

  async createServerRoom(siteId, name, floorColor) {
    const created = await invokeCommand("itops_create_server_room", { siteId, name, floorColor });
    await get().loadServerRooms(siteId);
    return created;
  },

  async updateServerRoom(siteId, id, name, floorColor) {
    const updated = await invokeCommand("itops_update_server_room", { id, name, floorColor });
    await Promise.all([get().loadServerRooms(siteId), get().loadRacks(siteId)]);
    return updated;
  },

  async deleteServerRoom(siteId, id) {
    await invokeCommand("itops_delete_server_room", { id });
    await get().loadServerRooms(siteId);
  },

  async duplicateServerRoom(siteId, id, name, floorColor) {
    const duplicated = await invokeCommand("itops_duplicate_server_room", {
      id,
      name,
      floorColor,
    });
    await Promise.all([get().loadSites(), get().loadServerRooms(siteId), get().loadRacks(siteId)]);
    return duplicated;
  },

  async loadRacks(siteId) {
    if (!isTauriRuntime()) {
      set({ racksBySite: { ...get().racksBySite, [siteId]: [] } });
      return;
    }
    const racks = await invokeCommand("itops_list_racks", { siteId });
    set({ racksBySite: { ...get().racksBySite, [siteId]: racks } });
  },

  async createRack(siteId, input) {
    const created = await invokeCommand("itops_create_rack", { siteId, ...input });
    await get().loadRacks(siteId);
    return created;
  },

  async updateRack(siteId, id, input) {
    await invokeCommand("itops_update_rack", { id, ...input });
    await get().loadRacks(siteId);
  },

  async deleteRack(siteId, id) {
    await invokeCommand("itops_delete_rack", { id });
    await get().loadRacks(siteId);
  },

  async duplicateRack(siteId, id, input, placement) {
    const duplicated = await invokeCommand("itops_duplicate_rack", {
      id,
      ...input,
      ...placement,
    });
    await get().loadRacks(siteId);
    return duplicated;
  },

  async setRackPlacements(siteId, kind, entries) {
    if (entries.length === 0) return;
    if (isTauriRuntime()) {
      await invokeCommand("itops_set_rack_placements", { kind, entries });
    }
    // Patch the cached racks in place instead of reloading: placement saves
    // fire right after a drag and a full reload would restart the elevations'
    // entry animations mid-interaction.
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const racks = get().racksBySite[siteId];
    if (!racks) return;
    set({
      racksBySite: {
        ...get().racksBySite,
        [siteId]: racks.map((rack) => {
          const entry = byId.get(rack.id);
          if (!entry) return rack;
          return kind === "floor"
            ? { ...rack, floorX: entry.x, floorY: entry.y }
            : { ...rack, gridX: Math.round(entry.x), gridY: Math.round(entry.y) };
        }),
      },
    });
  },

  async setRackFacings(siteId, entries) {
    if (entries.length === 0) return;
    if (isTauriRuntime()) {
      await invokeCommand("itops_set_rack_facings", { entries });
    }
    // Patch the cached racks in place like setRackPlacements: a facing save
    // fires right after a rotate click and a reload would restart animations.
    const byId = new Map(entries.map((entry) => [entry.id, entry.facing]));
    const racks = get().racksBySite[siteId];
    if (!racks) return;
    set({
      racksBySite: {
        ...get().racksBySite,
        [siteId]: racks.map((rack) => {
          const facing = byId.get(rack.id);
          return facing == null ? rack : { ...rack, facing };
        }),
      },
    });
  },

  async loadRoomObjects(siteId, serverRoom) {
    if (!isTauriRuntime()) return [];
    const objects = await invokeCommand("itops_list_room_objects", { siteId, serverRoom });
    return sanitizeRoomObjects(objects);
  },

  async saveRoomObjects(siteId, serverRoom, objects) {
    if (!isTauriRuntime()) return;
    await invokeCommand("itops_set_room_objects", { siteId, serverRoom, objects });
  },

  async placeRackItem(siteId, input) {
    await invokeCommand("itops_place_rack_item", input);
    await get().loadRacks(siteId);
  },

  async updateRackItem(siteId, input) {
    await invokeCommand("itops_update_rack_item", input);
    await get().loadRacks(siteId);
  },

  async moveRackItem(siteId, input) {
    await invokeCommand("itops_move_rack_item", input);
    await get().loadRacks(siteId);
  },

  async removeRackItem(siteId, id) {
    await invokeCommand("itops_remove_rack_item", { id });
    await get().loadRacks(siteId);
  },

  async refreshRackItemSnmp(siteId, id) {
    await invokeCommand("itops_refresh_rack_item_snmp", { id });
    await get().loadRacks(siteId);
  },

  // ── Hosts ──
  hostsBySite: {},
  scanningHostIds: {},
  async loadHosts(siteId) {
    if (!isTauriRuntime()) {
      set({ hostsBySite: { ...get().hostsBySite, [siteId]: [] } });
      return;
    }
    const hosts = await invokeCommand("itops_list_hosts", { siteId });
    set({ hostsBySite: { ...get().hostsBySite, [siteId]: hosts } });
  },

  async createHost(siteId, input) {
    const created = await invokeCommand("itops_create_host", { siteId, ...input });
    await get().loadHosts(siteId);
    return created;
  },

  async updateHost(siteId, id, input) {
    const updated = await invokeCommand("itops_update_host", { id, ...input });
    await get().loadHosts(siteId);
    return updated;
  },

  async deleteHost(siteId, id) {
    await invokeCommand("itops_delete_host", { id });
    await get().loadHosts(siteId);
  },

  async importHosts(siteId, hostnames) {
    const result = await invokeCommand("itops_import_hosts", { siteId, hostnames });
    await get().loadHosts(siteId);
    if (result.hosts.length > 0) {
      void get().scanHosts(siteId, result.hosts.map((host) => host.id));
    }
    return result;
  },

  async scanHosts(siteId, hostIds) {
    if (!isTauriRuntime()) return;
    const targets =
      hostIds.length > 0
        ? hostIds
        : (get().hostsBySite[siteId] ?? []).map((host) => host.id);
    const scanning = { ...get().scanningHostIds };
    for (const id of targets) scanning[id] = true;
    set({ scanningHostIds: scanning });
    try {
      const hosts = await invokeCommand("itops_scan_hosts", { siteId, hostIds });
      set({ hostsBySite: { ...get().hostsBySite, [siteId]: hosts } });
    } finally {
      const cleared = { ...get().scanningHostIds };
      for (const id of targets) delete cleared[id];
      set({ scanningHostIds: cleared });
    }
  },

  applyHostScanEvent(event) {
    if (event.kind !== "host") return;
    const hosts = get().hostsBySite[event.siteId];
    if (!hosts) return;
    const scanning = { ...get().scanningHostIds };
    delete scanning[event.host.id];
    set({
      hostsBySite: {
        ...get().hostsBySite,
        [event.siteId]: hosts.map((host) => (host.id === event.host.id ? event.host : host)),
      },
      scanningHostIds: scanning,
    });
  },

  async setSiteBackground(siteId, background) {
    const updated = await invokeCommand("itops_set_site_background", { siteId, background });
    set({ sites: get().sites.map((site) => (site.id === siteId ? updated : site)) });
  },

  async setServerRoomBackground(siteId, serverRoom, background) {
    const updated = await invokeCommand("itops_set_server_room_background", {
      siteId,
      serverRoom,
      background,
    });
    set({ sites: get().sites.map((site) => (site.id === siteId ? updated : site)) });
  },

  async setRoomIcon(siteId, serverRoom, icon) {
    const updated = await invokeCommand("itops_set_room_icon", {
      siteId,
      serverRoom,
      icon,
    });
    set({ sites: get().sites.map((site) => (site.id === siteId ? updated : site)) });
  },

  async setRackBackground(siteId, rackId, background) {
    await invokeCommand("itops_set_rack_background", { id: rackId, background });
    await get().loadRacks(siteId);
  },

  // ── Batch Runs ──
  activeRun: null,
  runHistory: [],
  historyLoaded: false,
  newRunRequest: 0,
  pendingRunGroupId: null,
  pendingRunScope: null,
  pendingRunTask: null,

  requestNewBatchRun(siteId, scope, task) {
    set({
      newRunRequest: get().newRunRequest + 1,
      pendingRunGroupId: siteId ?? null,
      pendingRunScope: scope ?? null,
      pendingRunTask: task ?? null,
    });
  },

  applyRunEvent(event) {
    set({ activeRun: reduceRun(get().activeRun, event) });
    if (event.kind === "finished" || event.kind === "canceled") {
      void get().loadRunHistory();
    }
  },

  async startBatchRun(siteId, task, scope, taskId) {
    // The Started event populates activeRun; clear any prior run first so the
    // grid does not briefly show stale hosts.
    set({ activeRun: null });
    return invokeCommand("itops_start_batch_run", { siteId, task, scope: scope ?? null, taskId: taskId ?? null });
  },

  async cancelRun(runId) {
    if (!isTauriRuntime()) {
      return;
    }
    await invokeCommand("itops_cancel_batch_run", { runId });
  },

  async loadRunHistory() {
    if (!isTauriRuntime()) {
      set({ historyLoaded: true });
      return;
    }
    const runHistory = await invokeCommand("itops_list_run_history", { limit: 500 });
    set({ runHistory, historyLoaded: true });
  },

  // ── Global Task Library ──
  tasks: [],
  tasksLoaded: false,

  async loadTasks() {
    if (!isTauriRuntime()) {
      set({ tasksLoaded: true });
      return;
    }
    const tasks = await invokeCommand("itops_list_tasks");
    set({ tasks, tasksLoaded: true });
  },

  async createTask(name, description, applicableOs, task) {
    const created = await invokeCommand("itops_create_task", { name, description, applicableOs, task });
    set({ tasks: [...get().tasks, created] });
    return created;
  },

  async updateTask(id, name, description, applicableOs, task) {
    const updated = await invokeCommand("itops_update_task", { id, name, description, applicableOs, task });
    set({ tasks: get().tasks.map((entry) => (entry.id === id ? updated : entry)) });
    return updated;
  },

  async removeTask(id) {
    await invokeCommand("itops_remove_task", { id });
    set({ tasks: get().tasks.filter((entry) => entry.id !== id) });
  },

  // ── Global VLANs ──
  vlans: [],
  vlansLoaded: false,

  async loadVlans() {
    if (!isTauriRuntime()) {
      set({ vlansLoaded: true });
      return;
    }
    const vlans = await invokeCommand("itops_list_vlans");
    set({ vlans, vlansLoaded: true });
  },

  async createVlan(input) {
    const created = await invokeCommand("itops_create_vlan", input);
    set({ vlans: sortVlans([...get().vlans, created]) });
    return created;
  },

  async updateVlan(id, input) {
    const saved = await invokeCommand("itops_update_vlan", { id, ...input });
    set({
      vlans: sortVlans(get().vlans.map((entry) => (entry.id === id ? saved : entry))),
    });
    return saved;
  },

  async removeVlan(id) {
    await invokeCommand("itops_remove_vlan", { id });
    set({
      vlans: get().vlans.filter((entry) => entry.id !== id),
      // The backend clears these references in the same transaction. Mirror
      // that result locally instead of issuing a second request that could fail
      // after the deletion already succeeded.
      ipam: {
        ...get().ipam,
        prefixes: get().ipam.prefixes.map((entry) =>
          entry.vlanId === id ? { ...entry, vlanId: null } : entry,
        ),
      },
    });
  },

  // ── Global IPAM ──
  ipam: EMPTY_IPAM,
  ipamLoaded: false,

  async loadIpam() {
    if (!isTauriRuntime()) {
      set({ ipamLoaded: true });
      return;
    }
    const ipam = await invokeCommand("itops_ipam_snapshot");
    set({ ipam, ipamLoaded: true });
  },

  async createPrefix(input) {
    await invokeCommand("itops_create_ip_prefix", prefixArgs(input));
    await get().loadIpam();
  },

  async updatePrefix(id, input) {
    await invokeCommand("itops_update_ip_prefix", { id, ...prefixArgs(input) });
    await get().loadIpam();
  },

  async removePrefix(id) {
    await invokeCommand("itops_remove_ip_prefix", { id });
    await get().loadIpam();
  },

  async createAddress(input) {
    await invokeCommand("itops_create_ip_address", addressArgs(input));
    await get().loadIpam();
  },

  async updateAddress(id, input) {
    await invokeCommand("itops_update_ip_address", { id, ...addressArgs(input) });
    await get().loadIpam();
  },

  async removeAddress(id) {
    await invokeCommand("itops_remove_ip_address", { id });
    await get().loadIpam();
  },

  async suggestFreeAddresses(cidr, vrf, limit) {
    if (!isTauriRuntime()) return [];
    return await invokeCommand("itops_suggest_free_addresses", { cidr, vrf, limit });
  },

  // ── Global Network Maps ──
  networkMaps: [],
  networkMapsLoaded: false,

  async loadNetworkMaps() {
    if (!isTauriRuntime()) {
      set({ networkMapsLoaded: true });
      return;
    }
    const networkMaps = await invokeCommand("itops_list_network_maps");
    set({ networkMaps, networkMapsLoaded: true });
  },

  async createNetworkMap(name, description, siteId, graph) {
    const created = await invokeCommand("itops_create_network_map", {
      name,
      description,
      siteId,
      graph: graph ?? null,
    });
    set({ networkMaps: [...get().networkMaps, created] });
    return created;
  },

  async saveNetworkMap(id, name, description, siteId, graph) {
    const saved = await invokeCommand("itops_update_network_map", {
      id,
      name,
      description,
      siteId,
      graph,
    });
    set({ networkMaps: get().networkMaps.map((entry) => (entry.id === id ? saved : entry)) });
    return saved;
  },

  async removeNetworkMap(id) {
    await invokeCommand("itops_remove_network_map", { id });
    set({ networkMaps: get().networkMaps.filter((entry) => entry.id !== id) });
  },

  // ── Automations ──
  automations: [],
  automationsLoaded: false,
  newAutomationRequest: 0,

  requestNewAutomation() {
    set({ newAutomationRequest: get().newAutomationRequest + 1 });
  },

  async loadAutomations() {
    if (!isTauriRuntime()) {
      set({ automationsLoaded: true });
      return;
    }
    const automations = await invokeCommand("itops_list_automations");
    set({ automations, automationsLoaded: true });
  },

  async createAutomation(name, config, actions, enabled, siteId) {
    const created = await invokeCommand("itops_create_automation", {
      name,
      config,
      actions,
      enabled,
      siteId,
    });
    set({ automations: [...get().automations, created] });
    return created;
  },

  async updateAutomation(id, name, config, actions, siteId) {
    const updated = await invokeCommand("itops_update_automation", {
      id,
      name,
      config,
      actions,
      siteId,
    });
    set({
      automations: get().automations.map((automation) =>
        automation.id === id ? updated : automation,
      ),
    });
    return updated;
  },

  async setAutomationEnabled(id, enabled) {
    const updated = await invokeCommand("itops_set_automation_enabled", { id, enabled });
    set({
      automations: get().automations.map((automation) =>
        automation.id === id ? updated : automation,
      ),
    });
  },

  async removeAutomation(id) {
    await invokeCommand("itops_remove_automation", { id });
    set({ automations: get().automations.filter((automation) => automation.id !== id) });
  },

  async testAutomation(config) {
    return invokeCommand("itops_test_automation", { config });
  },
}));

// Sites tab — durable site target groups (docs/ITOPS.md Phase 1). The left
// panel is a Connection-tree-style navigator over the rack topology
// (Site → Server Room → Rack); the right panel drills down that hierarchy,
// ending at a single animated rack elevation. Member lists come from the
// run-time resolver (itops_resolve_site) so dynamic-filter groups show the
// Connections they currently match.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import { ArrowUpDown, Maximize2, Minimize2 } from "../../lib/reicon";
import { ConfirmSheet } from "../../app/ui/dialog";
import { showNativeContextMenu, type NativeContextMenuItem } from "../../lib/nativeContextMenu";
import { nativeMenuIcons } from "../../lib/nativeMenuIcons";
import { useWorkspaceStore } from "../../store";
import type {
  Site,
  Rack,
  RackItem,
  RackItemKind,
  RackMountFace,
  ResolvedHost,
  ServerRoom,
  NetworkMap,
  NetworkNodeDeepLink,
} from "../../types";
import { ConnectionIcon } from "../workspace/connections/ConnectionIcon";
import { ItIcon, IT_ACCENTS, type ItIconName } from "./icons";
import { SiteDialog } from "./SiteDialog";
import { BatchRunsTab } from "./BatchRunsTab";
import { HostsPanel } from "./HostsPanel";
import { IpamPanel } from "./IpamPanel";
import {
  NetworkMapDesigner,
  NetworkMapPropertiesDialog,
} from "./NetworkMapDesigner";
import { TaskLibrary } from "./TaskLibrary";
import { RackElevation } from "./RackElevation";
import { RackDialog } from "./RackDialog";
import {
  nextRackSequenceName,
  type RackPlacementSequence,
} from "./rackSequence";
import { nextTopologyDuplicateName } from "./topologyDuplicate";
import { ServerRoomDialog } from "./ServerRoomDialog";
import { RackItemDialog, RACK_ITEM_KINDS, type RackItemDraft } from "./RackItemDialog";
import { RackDevice } from "./RackDevice";
import { RackItemBindingsDialog } from "./RackItemBindingsDialog";
import { RackItemConnectPopover, type ConnectPopoverAnchor } from "./RackItemConnectPopover";
import { useItOpsStore, type ItOpsDestination, type RackPlacementKind } from "./state";
import {
  EMPTY_DRILL,
  groupRackTopology,
  groupRacksForElevation,
  nodeId,
  topologyGroupKey,
  type DrillPath,
  type ServerRoomGroup,
} from "./rackTopology";
import { resolveIsoLayout, sanitizeFacing, type Corner, type Facing } from "./roomIsoLayout";
import { ItOpsBackground } from "./ItOpsBackground";
import { ItOpsEmptyHint } from "./ItOpsEmptyHint";
import { RackStage } from "./RackStage";
import { ServerRoomFloorPlan } from "./ServerRoomFloorPlan";
import { ServerRoomIsoView } from "./ServerRoomIsoView";
import { RoomObjectPicker, type RoomTool } from "./roomViewParts";
import {
  collectBoundConnectionIds,
  rackItemKindSupportsFractionalWidth,
  rackItemSlotCount,
} from "./rackInventory";
import {
  firstAvailableRackUnit,
  isRackTopItem,
  KUAIGUAI_TOP_CLEARANCE_U,
} from "./rackPlacement";
import type { DashboardBackground } from "../dashboard/types";
import { SharedBackgroundPopover } from "../dashboard/edit/SharedBackgroundPopover";
import { loadBackgroundImage } from "../dashboard/state/persistence";
import {
  SITE_TREE_COLLAPSED_WIDTH,
  SITE_TREE_MAX_WIDTH,
  SITE_TREE_MIN_WIDTH,
  loadCollapsedNodeIds,
  loadFreePlacement,
  loadRackFacing,
  loadRackTreeSort,
  loadRoomObjects,
  loadRoomViewMode,
  loadServerRoomTreeSort,
  loadSiteTreeWidth,
  saveFreePlacement,
  saveCollapsedNodeIds,
  saveRackTreeSort,
  saveRoomViewMode,
  saveServerRoomTreeSort,
  saveSiteTreeWidth,
  sanitizeIsoFloor,
  sortServerRoomTopology,
  sortRackTopology,
  type FreePlacementMap,
  type RackFacingMap,
  type RoomViewMode,
  type ServerRoomSortDirection,
} from "./siteTreeState";
import { rackTopSupport, settleRoomObjects, type RoomObject } from "./roomObjects";
import {
  createItOpsPdfBytes,
  excelFilename,
  pdfFilename,
  rackExcelBytes,
  rackPdfDocument,
  roomIsoLayoutScope,
  saveExportBytes,
  serverRoomPdfDocument,
  siteLayoutScope,
  sitePdfDocument,
  type ItOpsExportFormat,
  type ItOpsExportLabels,
} from "./itopsExport";

const TILE_COLORS = [
  IT_ACCENTS.green,
  IT_ACCENTS.indigo,
  IT_ACCENTS.blue,
  IT_ACCENTS.teal,
  IT_ACCENTS.orange,
  IT_ACCENTS.purple,
];

function rackTreeSortKey(siteId: string, room: ServerRoomGroup): string {
  return room.room?.id ?? `${siteId}:${topologyGroupKey(room.key)}`;
}

type ItOpsCustomIcon = {
  iconColor?: string | null;
  iconDataUrl?: string | null;
  iconBackgroundColor?: string | null;
};

type PendingDelete =
  | { kind: "site"; site: Site }
  | { kind: "serverRoom"; siteId: string; room: ServerRoom; racks: Rack[] }
  | { kind: "rack"; siteId: string; rack: Rack }
  | { kind: "item"; siteId: string; rack: Rack; item: RackItem }
  | { kind: "networkMap"; map: NetworkMap };

type RoomCloneDraft =
  | { kind: "rack"; rack: Rack; name: string; facing: Facing }
  | { kind: "object"; object: RoomObject };

const FREE_CARD_WIDTH = 240;
const FREE_CARD_HEIGHT = 74;
const RACK_SEQUENCE_PENDING_ID = "__rack-sequence-pending__";
const DEFAULT_SITE_ID = "default-fleet";

type SiteDestination = "site" | "serverRooms" | "hosts" | "runHistory";

/** Which top-level surface the detail pane shows: one Site's drill-down, or a
 * global destination that stands outside the Site tree entirely. */
type RootSurface = "site" | "tasks" | "ipam" | "networkMaps";

/** Global surfaces mapped to the navigation destination they report and the
 * tree node id they highlight. Keyed so adding a page touches one place. */
const LIBRARY_SURFACES = {
  tasks: { destination: "taskLibrary", nodeId: "itops:tasks" },
  ipam: { destination: "ipam", nodeId: "itops:ipam" },
  networkMaps: { destination: "networkMaps", nodeId: "itops:networkMaps" },
} as const satisfies Record<
  Exclude<RootSurface, "site">,
  { destination: ItOpsDestination; nodeId: string }
>;

// A stable per-group tile colour (Sites don't store one); hashing the id
// keeps a group's colour steady across reloads without a durable field.
function groupColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return TILE_COLORS[hash % TILE_COLORS.length];
}

function groupIcon(group: Site): ItIconName {
  return group.filter ? "filter" : "site";
}

function iconForegroundForBackground(color?: string | null) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
    return "var(--surface)";
  }
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.72 ? "var(--text)" : "var(--surface)";
}

export function SitesTab({
  active,
  renderSidebarHeader,
  treeCollapsed,
  onShowWorkspace,
}: {
  active: boolean;
  renderSidebarHeader?: (props: { actions?: ReactNode; collapsed: boolean }) => ReactNode;
  treeCollapsed: boolean;
  /** Navigate the app shell to the Workspace Module (connect popover jumps). */
  onShowWorkspace: () => void;
}) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const sites = useItOpsStore((state) => state.sites);
  const loaded = useItOpsStore((state) => state.loaded);
  const resolveSite = useItOpsStore((state) => state.resolveSite);
  const newGroupRequest = useItOpsStore((state) => state.newGroupRequest);
  const racksBySite = useItOpsStore((state) => state.racksBySite);
  const loadRacks = useItOpsStore((state) => state.loadRacks);
  const serverRoomsBySite = useItOpsStore((state) => state.serverRoomsBySite);
  const loadServerRooms = useItOpsStore((state) => state.loadServerRooms);
  const removeSite = useItOpsStore((state) => state.removeSite);
  const deleteServerRoom = useItOpsStore((state) => state.deleteServerRoom);
  const taskCount = useItOpsStore((state) => state.tasks.length);
  const ipamItemCount = useItOpsStore(
    (state) => state.vlans.length + state.ipam.prefixes.length + state.ipam.addresses.length,
  );
  const networkMaps = useItOpsStore((state) => state.networkMaps);
  const networkMapsLoaded = useItOpsStore((state) => state.networkMapsLoaded);
  const loadNetworkMaps = useItOpsStore((state) => state.loadNetworkMaps);
  const removeNetworkMap = useItOpsStore((state) => state.removeNetworkMap);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillPath>(EMPTY_DRILL);
  const [selectedDestination, setSelectedDestination] = useState<SiteDestination>("site");
  const [rootSurface, setRootSurface] = useState<RootSurface>("site");
  const [selectedNetworkMapId, setSelectedNetworkMapId] = useState("");
  const [networkMapDialog, setNetworkMapDialog] = useState<{
    map: NetworkMap | null;
    duplicateOf?: NetworkMap;
    duplicateName?: string;
  } | null>(null);
  const [members, setMembers] = useState<ResolvedHost[]>([]);
  const [dialog, setDialog] = useState<{ group: Site | null } | null>(null);
  const [rackDialog, setRackDialog] = useState<{
    siteId: string;
    rack: Rack | null;
    duplicateOf?: Rack;
    duplicateName?: string;
    defaultServerRoom?: string;
    /** Picker placement flow: consume the saved rack instead of drilling in. */
    onSaved?: (saved: Rack, sequence: RackPlacementSequence | null) => void;
  } | null>(null);
  const [serverRoomDialog, setServerRoomDialog] = useState<{
    siteId: string;
    room: ServerRoom | null;
    duplicateOf?: ServerRoom;
    duplicateName?: string;
  } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [itemDialog, setItemDialog] = useState<{
    rack: Rack;
    item: RackItem | null;
    kind?: RackItemKind;
    defaultMountFace?: RackMountFace;
    /** Picker placement flow: arm the configured draft instead of placing. */
    onConfigured?: (draft: RackItemDraft) => void;
  } | null>(null);
  const [bindingsDialog, setBindingsDialog] = useState<RackItem | null>(null);
  const [connectPopover, setConnectPopover] = useState<{
    item: RackItem;
    anchor: ConnectPopoverAnchor;
  } | null>(null);
  const moveRackItem = useItOpsStore((state) => state.moveRackItem);
  const placeRackItem = useItOpsStore((state) => state.placeRackItem);
  const deleteRack = useItOpsStore((state) => state.deleteRack);
  const removeRackItem = useItOpsStore((state) => state.removeRackItem);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  // ── Tree navigator state (search, resizable width, collapsed nodes) ──
  const [query, setQuery] = useState("");
  const [treeWidth, setTreeWidth] = useState(loadSiteTreeWidth);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsedNodeIds);
  const [serverRoomSort, setServerRoomSort] = useState(loadServerRoomTreeSort);
  const [rackSort, setRackSort] = useState(loadRackTreeSort);
  const resizing = useRef(false);
  const treeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => saveCollapsedNodeIds(collapsed), [collapsed]);
  useEffect(() => saveServerRoomTreeSort(serverRoomSort), [serverRoomSort]);
  useEffect(() => saveRackTreeSort(rackSort), [rackSort]);
  useEffect(() => {
    if (!networkMapsLoaded) {
      void loadNetworkMaps().catch(() => undefined);
    }
  }, [loadNetworkMaps, networkMapsLoaded]);
  useEffect(() => {
    if (
      networkMapsLoaded &&
      selectedNetworkMapId &&
      !networkMaps.some((map) => map.id === selectedNetworkMapId)
    ) {
      setSelectedNetworkMapId("");
    }
  }, [networkMaps, networkMapsLoaded, selectedNetworkMapId]);

  const isExpanded = useCallback((id: string) => !collapsed.has(id), [collapsed]);
  const toggleNode = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const expandAllNodes = useCallback(() => setCollapsed(new Set()), []);
  const collapseAllNodes = useCallback(() => {
    setCollapsed(() => {
      const next = new Set<string>();
      for (const site of sites) {
        const siteId = nodeId.site(site.id);
        const siteRacks = racksBySite[site.id] ?? [];
        const siteTopo = groupRackTopology(siteRacks, serverRoomsBySite[site.id] ?? []);
        // Every Site has the virtual Server Rooms / Hosts / Automations /
        // Run History children, even when its topology is empty.
        next.add(siteId);
        next.add(`${siteId}:rooms`);
        for (const room of siteTopo) {
          next.add(nodeId.serverRoom(site.id, room.key));
        }
      }
      if (networkMaps.length > 0) {
        next.add(LIBRARY_SURFACES.networkMaps.nodeId);
      }
      return next;
    });
  }, [networkMaps.length, racksBySite, serverRoomsBySite, sites]);

  // Drag the splitter to resize the tree. During the drag we set the width
  // directly on the DOM element so the cursor stays in sync with the bar —
  // calling setTreeWidth on every pointermove triggers a full tree re-render
  // which causes the 1–2 second lag. React state (and persistence) sync on
  // pointer up.
  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (treeCollapsed) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const treeElement = treeRef.current;
    if (!treeElement) return;
    const el: HTMLDivElement = treeElement;

    handle.setPointerCapture(pointerId);
    resizing.current = true;
    el.classList.add("is-resizing");
    document.body.style.cursor = "col-resize";

    const startX = event.clientX;
    const startWidth = treeWidth;
    let lastWidth = startWidth;
    let animationFrame: number | null = null;
    let pendingClientX: number | null = null;

    function flushPendingMove() {
      animationFrame = null;
      if (pendingClientX === null) return;
      lastWidth = Math.min(
        SITE_TREE_MAX_WIDTH,
        Math.max(SITE_TREE_MIN_WIDTH, startWidth + pendingClientX - startX),
      );
      pendingClientX = null;
      el.style.width = `${lastWidth}px`;
      el.style.flex = `0 0 ${lastWidth}px`;
    }

    function onMove(moveEvent: PointerEvent) {
      if (!resizing.current || moveEvent.pointerId !== pointerId) return;
      pendingClientX = moveEvent.clientX;
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(flushPendingMove);
      }
    }

    function finish() {
      if (!resizing.current) return;
      resizing.current = false;
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      flushPendingMove();
      el.classList.remove("is-resizing");
      document.body.style.cursor = "";
      setTreeWidth(lastWidth);
      saveSiteTreeWidth(lastWidth);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", finish);
      handle.removeEventListener("lostpointercapture", onPointerEnd);
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
    }

    function onPointerEnd(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId === pointerId) finish();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("blur", finish);
    handle.addEventListener("lostpointercapture", onPointerEnd);
  }, [treeCollapsed, treeWidth]);

  const activeGroup = useMemo(
    () => sites.find((group) => group.id === activeId) ?? sites[0] ?? null,
    [sites, activeId],
  );

  // Open the create dialog when the module header's primary button signals.
  const seenNewGroupRequest = useRef(newGroupRequest);
  useEffect(() => {
    if (newGroupRequest !== seenNewGroupRequest.current) {
      seenNewGroupRequest.current = newGroupRequest;
      setDialog({ group: null });
    }
  }, [newGroupRequest]);

  // Keep a valid selection as the list loads or its active group is removed.
  useEffect(() => {
    if (sites.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!sites.some((group) => group.id === activeId)) {
      setActiveId(sites[0].id);
    }
  }, [sites, activeId]);

  // Apply a navigator selection requested from outside the Module (the AI
  // assistant's tutorial navigation). Waits for the Site list so an explicit
  // siteId can be validated; falls back to the active/first Site.
  const pendingNavigation = useItOpsStore((state) => state.pendingNavigation);
  useEffect(() => {
    if (!pendingNavigation || !loaded) {
      return;
    }
    useItOpsStore.getState().clearNavigation();
    // Global destinations stand outside the Site tree, so they resolve without
    // one. Matching them here also narrows the rest to a Site destination.
    const destination = pendingNavigation.destination ?? "site";
    if (destination === "taskLibrary") {
      setRootSurface("tasks");
      return;
    }
    if (destination === "vlans" || destination === "ipam") {
      setRootSurface("ipam");
      return;
    }
    if (destination === "networkMaps") {
      setRootSurface("networkMaps");
      setSelectedNetworkMapId("");
      return;
    }
    const requestedSiteId = pendingNavigation.siteId;
    const siteId =
      (requestedSiteId && sites.some((site) => site.id === requestedSiteId)
        ? requestedSiteId
        : null) ??
      (activeId && sites.some((site) => site.id === activeId) ? activeId : null) ??
      sites[0]?.id ??
      null;
    if (!siteId) {
      return;
    }
    selectSiteDestination(siteId, destination);
  }, [pendingNavigation, loaded, sites, activeId]);

  // Mirror the navigator's position into the store so the assistant page
  // context can describe where the user is (never persisted).
  useEffect(() => {
    useItOpsStore.getState().setNavigationSnapshot({
      siteId: activeId,
      destination:
        rootSurface === "site" ? selectedDestination : LIBRARY_SURFACES[rootSurface].destination,
      serverRoom: drill.serverRoom,
      rackId: drill.rackId,
    });
  }, [activeId, selectedDestination, rootSurface, drill]);

  // Resolve the active group's members whenever the group (or its definition)
  // changes. The group object identity changes after an edit, re-running this.
  useEffect(() => {
    let disposed = false;
    if (!activeGroup) {
      setMembers([]);
      return;
    }
    void resolveSite(activeGroup.id)
      .then((resolved) => {
        if (!disposed) setMembers(resolved);
      })
      .catch(() => {
        if (!disposed) setMembers([]);
      });
    return () => {
      disposed = true;
    };
  }, [activeGroup, resolveSite]);

  // Load every Site's durable topology before deciding whether its tree row
  // has children. Gating the request on expansion creates a deadlock for a
  // restored collapsed row: unloaded data means no caret, so it cannot expand.
  useEffect(() => {
    for (const site of sites) {
      if (!racksBySite[site.id]) void loadRacks(site.id);
      if (!serverRoomsBySite[site.id]) void loadServerRooms(site.id);
    }
  }, [sites, racksBySite, serverRoomsBySite, loadRacks, loadServerRooms]);

  const racks = useMemo(
    () => (activeGroup ? (racksBySite[activeGroup.id] ?? []) : []),
    [activeGroup, racksBySite],
  );
  const serverRooms = useMemo(
    () => (activeGroup ? (serverRoomsBySite[activeGroup.id] ?? []) : []),
    [activeGroup…18907 tokens truncated… { ...roomClone.rack, name: roomClone.name }
                      : null
                  }
                  cloneRackFacing={roomClone?.kind === "rack" ? roomClone.facing : 0}
                  cloneObject={roomClone?.kind === "object" ? roomClone.object : null}
                  onRackPlaced={completeRackPlacement}
                  onObjectPlaced={() => {
                    if (roomTool !== "wall") setRoomTool(null);
                  }}
                  onCloneRack={armRoomRackClone}
                  onCloneObject={armRoomObjectClone}
                  onCloneRackPlaced={placeRoomRackClone}
                  onCloneObjectPlaced={placeRoomObjectClone}
                  placement={isoPlacements}
                  onPlacementChange={saveIsoPlacements}
                  facing={roomFacing}
                  onFacingChange={editMode ? saveRoomFacingState : undefined}
                  objects={roomObjects}
                  onObjectsChange={editMode ? saveRoomObjectsState : undefined}
                  onPlaceKuaiguai={editMode ? placeKuaiguaiOnRack : undefined}
                  onDeleteRack={editMode ? onDeleteRack : undefined}
                  onSelectRack={(rackId) => setDrill({ serverRoom: serverRoom.key, rackId })}
                  onAddRack={editMode ? () => onAddRack(serverRoom.key) : undefined}
                  onObjectBlocked={notifyObjectBlocked}
                  onOpenBackground={() => setBackgroundOpen(true)}
                  onCancelPlacement={cancelRoomPlacement}
                />
              ) : (
                <ServerRoomFloorPlan
                  racks={serverRoom.racks}
                  editMode={editMode}
                  tool={roomTool}
                  placeRackId={placeRackId}
                  cloneRack={
                    roomClone?.kind === "rack"
                      ? { ...roomClone.rack, name: roomClone.name }
                      : null
                  }
                  cloneRackFacing={roomClone?.kind === "rack" ? roomClone.facing : 0}
                  cloneObject={roomClone?.kind === "object" ? roomClone.object : null}
                  onRackPlaced={completeRackPlacement}
                  onObjectPlaced={() => {
                    if (roomTool !== "wall") setRoomTool(null);
                  }}
                  onCloneRack={armRoomRackClone}
                  onCloneObject={armRoomObjectClone}
                  onCloneRackPlaced={placeRoomRackClone}
                  onCloneObjectPlaced={placeRoomObjectClone}
                  placement={isoPlacements}
                  onPlacementChange={saveIsoPlacements}
                  facing={roomFacing}
                  onFacingChange={editMode ? saveRoomFacingState : undefined}
                  objects={roomObjects}
                  onObjectsChange={editMode ? saveRoomObjectsState : undefined}
                  onPlaceKuaiguai={editMode ? placeKuaiguaiOnRack : undefined}
                  onDeleteRack={editMode ? onDeleteRack : undefined}
                  onSelectRack={(rackId) => setDrill({ serverRoom: serverRoom.key, rackId })}
                  onObjectBlocked={notifyObjectBlocked}
                  onCancelPlacement={cancelRoomPlacement}
                />
              )}
              {editMode ? (
                <RoomObjectPicker
                  tool={roomTool}
                  onToolChange={(tool) => {
                    if (placeRackId != null || roomClone != null) cancelRoomPlacement();
                    setRoomTool(tool);
                  }}
                  rackArmed={placeRackId != null || roomClone?.kind === "rack"}
                  onPickRack={() => {
                    setRoomTool(null);
                    if (placeRackId != null || roomClone != null) {
                      cancelRoomPlacement();
                      return;
                    }
                    onAddRackForPlacement(serverRoom.key, (saved, sequence) => {
                      rackSequenceRef.current = sequence;
                      placeRackIdRef.current = saved.id;
                      setPlaceRackId(saved.id);
                    });
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="rk-room-layout">
              <div
                className="rk-elevations"
                ref={roomElevationsRef}
              >
                {elevationRackGroups.map((g) => (
                  <div className="rk-group" key={g.key}>
                    {elevationRackGroups.length > 1 || g.key ? (
                      <div className="rk-group-h">{g.key || ungrouped}</div>
                    ) : null}
                    <div className="rk-row">{g.racks.map((r) => elevation(r))}</div>
                  </div>
                ))}
              </div>
              {editMode ? (
                <RackObjectPicker
                  racks={serverRoom.racks}
                  armedKind={placeDevice?.kind ?? null}
                  onPickDevice={(kind) => {
                    // Clicking the armed card again disarms; any card re-opens
                    // the configure dialog and re-arms with the new draft.
                    if (placeDevice?.kind === kind) {
                      setPlaceDevice(null);
                      return;
                    }
                    if (roomPickerRack) {
                      onConfigureDevice(
                        roomPickerRack,
                        kind,
                        elevationFaceFor(roomPickerRack.id),
                        setPlaceDevice,
                      );
                    }
                  }}
                />
              ) : null}
            </div>
          )
        ) : topology.length === 0 && !editMode ? (
          <ItOpsEmptyHint>
            <Trans
              i18nKey="itops.sites.emptyServerRoomsHint"
              components={{
                addServerRoom: <button type="button" onClick={onAddServerRoom} />,
              }}
            />
          </ItOpsEmptyHint>
        ) : (
          <div className="it-site-layout">
            <SiteRoomCards
              rooms={topology}
              roomIcons={roomIcons}
              unassigned={unassigned}
              editMode={editMode}
              placement={sitePlacements}
              onPlacementChange={saveSitePlacements}
              onDeleteRoom={onDeleteServerRoom}
              onSelectRoom={(room) => setDrill({ serverRoom: room.key, rackId: null })}
              onOpenBackground={() => setBackgroundOpen(true)}
            />
            {editMode ? <SiteObjectPicker onPickServerRoom={onAddServerRoom} /> : null}
          </div>
        )}
      </ItOpsBackground>
      {backgroundOpen &&
      ((serverRoom && (roomView === "elevation" || roomView === "iso")) ||
        (!serverRoom && !rack)) ? (
        <SharedBackgroundPopover
          className="itops-bg-popover"
          background={viewBackground ?? null}
          titleKey="itops.racks.changeBackground"
          defaultHintKey="itops.racks.backgroundDefaultHint"
          onBackgroundChange={saveDrillViewBackground}
          onLoadBackgroundImage={(file) => {
            void loadBackgroundImage(file);
          }}
          onClose={() => setBackgroundOpen(false)}
        />
      ) : null}
    </div>
  );
}

// Fold the racks' durable placement columns into a FreePlacementMap.
function durablePlacement(racks: Rack[] | undefined, kind: RackPlacementKind): FreePlacementMap {
  const map: FreePlacementMap = {};
  for (const rack of racks ?? []) {
    const x = kind === "floor" ? rack.floorX : rack.gridX;
    const y = kind === "floor" ? rack.floorY : rack.gridY;
    if (x != null && y != null) {
      map[rack.id] = { x, y };
    }
  }
  return map;
}

function defaultFreePlacement(index: number, width: number, height: number) {
  const cols = 3;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: 14 + col * (width + 14), y: 14 + row * (height + 14) };
}

function freeSurfaceHeight(count: number, width: number, height: number) {
  if (count <= 0) return height + 28;
  return defaultFreePlacement(count - 1, width, height).y + height + 16;
}

function sameRoomObjects(a: RoomObject[], b: RoomObject[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((object, index) => {
    const other = b[index];
    return (
      object.id === other.id &&
      object.kind === other.kind &&
      object.x === other.x &&
      object.y === other.y &&
      object.z === other.z &&
      object.rot === other.rot &&
      object.corner === other.corner
    );
  });
}

function useFreeDrag(
  placement: FreePlacementMap,
  onPlacementChange: (next: FreePlacementMap) => void,
) {
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  function startDrag(
    event: ReactPointerEvent<HTMLElement>,
    id: string,
    fallback: { x: number; y: number },
  ) {
    const target = event.target as HTMLElement;
    if (target.closest(".it-free-delete")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = placement[id] ?? fallback;
    dragRef.current = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false,
    };
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      drag.moved = true;
    }
    const x = Math.max(4, Math.round(drag.originX + dx));
    const y = Math.max(4, Math.round(drag.originY + dy));
    onPlacementChange({ ...placement, [drag.id]: { x, y } });
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  return { startDrag, moveDrag, endDrag };
}

function SiteObjectPicker({ onPickServerRoom }: { onPickServerRoom: () => void }) {
  const { t } = useTranslation();
  const label = t("itops.racks.serverRoomLabel");

  return (
    <div className="rm-picker" role="group" aria-label={t("itops.floorPlan.pickerTitle")}>
      <div className="rm-picker-h">{t("itops.floorPlan.pickerTitle")}</div>
      <div className="rm-picker-grid">
        <button
          type="button"
          className="rm-picker-card"
          title={label}
          onClick={onPickServerRoom}
        >
          <span className="rm-picker-thumb">
            <ItIcon name="room" size={30} sw={1.3} />
          </span>
          <span className="rm-picker-name">{label}</span>
        </button>
      </div>
    </div>
  );
}

/** While a Rack Device placement is armed over the Server Room elevation
 *  rows, resolve which cabinet is nearest the pointer. Every armed
 *  <RackElevation> listens document-wide, so the room arms only this one —
 *  adjacent cabinets sit flush, and a click between two would otherwise place
 *  the device into both. Escape / right-click disarm here too, covering the
 *  moment before the first pointer move has picked a target cabinet. */
function useNearestPlacementRack(
  active: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  onCancel: () => void,
): string | null {
  const [rackId, setRackId] = useState<string | null>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (!active) {
      setRackId(null);
      return;
    }
    const track = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      let bestId: string | null = null;
      let bestDistance = Infinity;
      for (const node of container.querySelectorAll<HTMLElement>(".rk[data-rack-id]")) {
        const rect = node.getBoundingClientRect();
        const dx = Math.max(rect.left - event.clientX, event.clientX - rect.right, 0);
        const dy = Math.max(rect.top - event.clientY, event.clientY - rect.bottom, 0);
        const distance = Math.hypot(dx, dy);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestId = node.dataset.rackId ?? null;
        }
      }
      setRackId(bestId);
    };
    const cancelFromContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      cancelRef.current();
    };
    const cancelFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelRef.current();
    };
    document.addEventListener("pointermove", track, true);
    document.addEventListener("contextmenu", cancelFromContextMenu, true);
    document.addEventListener("keydown", cancelFromKeyboard, true);
    return () => {
      document.removeEventListener("pointermove", track, true);
      document.removeEventListener("contextmenu", cancelFromContextMenu, true);
      document.removeEventListener("keydown", cancelFromKeyboard, true);
    };
  }, [active, containerRef]);
  return rackId;
}

function RackObjectPicker({
  racks,
  armedKind,
  onPickDevice,
}: {
  /** Rack View passes its single Rack; the Server Room elevation layout passes
   *  the whole room, and a card stays enabled while any cabinet has space. */
  racks: Rack[];
  /** The configured draft's kind while a placement click is armed. */
  armedKind: RackItemKind | null;
  onPickDevice: (kind: RackItemKind) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const hasFullWidthUnit = racks.some(
    (rack) =>
      firstAvailableRackUnit(rack, 4, "front") != null ||
      firstAvailableRackUnit(rack, 4, "rear") != null,
  );
  const hasFractionalUnit = racks.some(
    (rack) =>
      firstAvailableRackUnit(rack, 1, "front") != null ||
      firstAvailableRackUnit(rack, 1, "rear") != null,
  );
  const rackTopAvailable = racks.some(
    (rack) => !rack.items.some((item) => isRackTopItem(item, rack.heightU)),
  );
  const kinds = RACK_ITEM_KINDS.filter(
    (kind) => !q || t(`itops.racks.kind.${kind}`).toLowerCase().includes(q),
  );

  return (
    <div
      className="rm-picker rm-picker-devices"
      role="group"
      aria-label={t("itops.floorPlan.pickerTitle")}
    >
      <div className="rm-picker-h">{t("itops.floorPlan.pickerTitle")}</div>
      <div className="rm-picker-search">
        <ItIcon name="search" size={13} />
        <input
          type="text"
          value={query}
          placeholder={t("itops.floorPlan.pickerSearchPlaceholder")}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {query ? (
          <button type="button" className="rm-picker-search-x" onClick={() => setQuery("")}>
            <ItIcon name="xmark" size={12} />
          </button>
        ) : null}
      </div>
      <div className="rm-picker-grid">
        {kinds.map((kind) => {
          const label = t(`itops.racks.kind.${kind}`);
          const available =
            (rackItemKindSupportsFractionalWidth(kind) ? hasFractionalUnit : hasFullWidthUnit) ||
            (kind === "kuaiguai" && rackTopAvailable);
          return (
            <button
              key={kind}
              type="button"
              className="rm-picker-card"
              title={label}
              aria-label={label}
              data-active={armedKind === kind || undefined}
              disabled={!available}
              onClick={() => available && onPickDevice(kind)}
            >
              <span className="rm-picker-thumb device">
                <RackDevice
                  kind={kind}
                  label={label}
                  status="online"
                  heightU={kind === "kuaiguai" ? 4 : 1}
                  shell="black"
                  seed={`picker-${kind}`}
                  compact
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Site View is a free-form Server Room placement surface in both modes. Edit
// mode reveals the dot grid and adds drag/delete controls; right-clicking empty
// surface offers the Site background change.
function SiteRoomCards({
  rooms,
  roomIcons,
  unassigned,
  editMode,
  placement,
  onPlacementChange,
  onDeleteRoom,
  onSelectRoom,
  onOpenBackground,
}: {
  rooms: ReturnType<typeof groupRackTopology>;
  roomIcons?: Record<string, ItOpsCustomIcon>;
  unassigned: string;
  editMode: boolean;
  placement: FreePlacementMap;
  onPlacementChange: (next: FreePlacementMap) => void;
  onDeleteRoom: (serverRoom: string, racks: Rack[]) => void;
  onSelectRoom: (room: ReturnType<typeof groupRackTopology>[number]) => void;
  onOpenBackground?: () => void;
}) {
  const { t } = useTranslation();
  const drag = useFreeDrag(placement, onPlacementChange);

  async function handleSurfaceContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!onOpenBackground) return;
    const target = event.target as HTMLElement;
    if (target.closest(".it-free-card")) return;
    event.preventDefault();
    await showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("itops.racks.changeBackground"),
          action: onOpenBackground,
        },
      ],
      { x: event.clientX, y: event.clientY },
    );
  }

  return (
    <div
      className={`it-free-surface site${editMode ? " editing" : ""}`}
      style={{ minHeight: freeSurfaceHeight(rooms.length, FREE_CARD_WIDTH, FREE_CARD_HEIGHT) }}
      onContextMenu={onOpenBackground ? handleSurfaceContextMenu : undefined}
    >
      {rooms.map((room, index) => {
        const id = topologyGroupKey(room.key);
        const fallback = defaultFreePlacement(index, FREE_CARD_WIDTH, FREE_CARD_HEIGHT);
        const point = placement[id] ?? fallback;
        return (
          <div
            key={id}
            className={`it-free-card${editMode ? " editing" : ""}`}
            style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
            onPointerDown={editMode ? (event) => drag.startDrag(event, id, fallback) : undefined}
            onPointerMove={editMode ? drag.moveDrag : undefined}
            onPointerUp={editMode ? drag.endDrag : undefined}
            onPointerCancel={editMode ? drag.endDrag : undefined}
          >
            <DrillCard
              icon="room"
              customIcon={roomIcons?.[room.key]}
              title={room.key || unassigned}
              meta={t("itops.racks.rackCount", { count: room.racks.length })}
              onClick={() => onSelectRoom(room)}
            />
            {editMode ? (
              <button
                type="button"
                className="it-free-delete"
                title={t("itops.racks.deleteServerRoomTitle")}
                aria-label={t("itops.racks.deleteServerRoomTitle")}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteRoom(room.key, room.racks);
                }}
              >
                <ItIcon name="xmark" size={11} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function DrillCard({
  icon,
  customIcon,
  title,
  meta,
  onClick,
}: {
  icon: ItIconName;
  customIcon?: ItOpsCustomIcon;
  title: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="ft-card" onClick={onClick}>
      <span className="ft-card-ic">
        <ItOpsIcon icon={icon} customIcon={customIcon} size={20} />
      </span>
      <span className="ft-card-txt">
        <span className="ft-card-title">{title}</span>
        <span className="ft-card-meta">{meta}</span>
      </span>
      <ItIcon name="chevR" size={14} />
    </button>
  );
}

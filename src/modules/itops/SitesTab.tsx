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
} from "../../types";
import { ConnectionIcon } from "../workspace/connections/ConnectionIcon";
import { ItIcon, IT_ACCENTS, type ItIconName } from "./icons";
import { SiteDialog } from "./SiteDialog";
import { BatchRunsTab } from "./BatchRunsTab";
import { AutomationsTab } from "./AutomationsTab";
import { HostsPanel } from "./HostsPanel";
import { TaskLibrary } from "./TaskLibrary";
import { RackElevation } from "./RackElevation";
import { RackDialog } from "./RackDialog";
import {
  nextRackSequenceName,
  type RackPlacementSequence,
} from "./rackSequence";
import { ServerRoomDialog } from "./ServerRoomDialog";
import { RackItemDialog, RACK_ITEM_KINDS, type RackItemDraft } from "./RackItemDialog";
import { RackDevice } from "./RackDevice";
import { RackItemBindingsDialog } from "./RackItemBindingsDialog";
import { RackItemConnectPopover, type ConnectPopoverAnchor } from "./RackItemConnectPopover";
import { useItOpsStore, type RackPlacementKind } from "./state";
import {
  EMPTY_DRILL,
  groupRackTopology,
  groupRacksByGroup,
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
  | { kind: "item"; siteId: string; rack: Rack; item: RackItem };

const FREE_CARD_WIDTH = 240;
const FREE_CARD_HEIGHT = 74;
const RACK_SEQUENCE_PENDING_ID = "__rack-sequence-pending__";
const DEFAULT_SITE_ID = "default-fleet";

type SiteDestination = "site" | "serverRooms" | "hosts" | "runHistory" | "automations";

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
  renderSidebarHeader,
  treeCollapsed,
  onShowWorkspace,
}: {
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

  const [activeId, setActiveId] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillPath>(EMPTY_DRILL);
  const [selectedDestination, setSelectedDestination] = useState<SiteDestination>("site");
  const [rootSurface, setRootSurface] = useState<"site" | "tasks">("site");
  const [members, setMembers] = useState<ResolvedHost[]>([]);
  const [dialog, setDialog] = useState<{ group: Site | null } | null>(null);
  const [rackDialog, setRackDialog] = useState<{
    siteId: string;
    rack: Rack | null;
    defaultServerRoom?: string;
    /** Picker placement flow: consume the saved rack instead of drilling in. */
    onSaved?: (saved: Rack, sequence: RackPlacementSequence | null) => void;
  } | null>(null);
  const [serverRoomDialog, setServerRoomDialog] = useState<{
    siteId: string;
    room: ServerRoom | null;
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
      return next;
    });
  }, [racksBySite, serverRoomsBySite, sites]);

  // Drag the splitter to resize the tree. During the drag we set the width
  // directly on the DOM element so the cursor stays in sync with the bar —
  // calling setTreeWidth on every pointermove triggers a full tree re-render
  // which causes the 1–2 second lag. React state (and persistence) sync on
  // pointer up.
  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (treeCollapsed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.current = true;
    document.body.style.cursor = "col-resize";

    const startX = event.clientX;
    const startWidth = treeWidth;
    const el = treeRef.current;
    let lastWidth = startWidth;

    function onMove(event: PointerEvent) {
      if (!resizing.current || !el) return;
      lastWidth = Math.min(
        SITE_TREE_MAX_WIDTH,
        Math.max(SITE_TREE_MIN_WIDTH, startWidth + event.clientX - startX),
      );
      el.style.width = `${lastWidth}px`;
      el.style.flex = `0 0 ${lastWidth}px`;
    }

    function onUp() {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      setTreeWidth(lastWidth);
      saveSiteTreeWidth(lastWidth);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
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
    if (pendingNavigation.destination === "taskLibrary") {
      setRootSurface("tasks");
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
    selectSiteDestination(siteId, pendingNavigation.destination ?? "site");
  }, [pendingNavigation, loaded, sites, activeId]);

  // Mirror the navigator's position into the store so the assistant page
  // context can describe where the user is (never persisted).
  useEffect(() => {
    useItOpsStore.getState().setNavigationSnapshot({
      siteId: activeId,
      destination: rootSurface === "tasks" ? "taskLibrary" : selectedDestination,
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
    [activeGroup, serverRoomsBySite],
  );
  const topology = useMemo(() => groupRackTopology(racks, serverRooms), [racks, serverRooms]);
  const topologyLoaded = activeGroup
    ? racksBySite[activeGroup.id] !== undefined && serverRoomsBySite[activeGroup.id] !== undefined
    : false;
  const selectedSiteIdForDialog = activeGroup?.id ?? sites[0]?.id ?? "";
  const selectedServerRoomForDialog =
    drill.serverRoom ?? (drill.rackId ? racks.find((rack) => rack.id === drill.rackId)?.serverRoom : undefined);

  // A placed Connection whose id no longer resolves to a Site member (deleted
  // or moved out) is a "ghost" — shown dimmed, not openable, editable/removable.
  const memberIds = useMemo(() => new Set(members.map((m) => m.connectionId)), [members]);
  function isGhostItem(item: RackItem): boolean {
    return item.kind === "connection" && !!item.connectionId && !memberIds.has(item.connectionId);
  }

  // Resolve a placed Connection's host so its faceplate can show the address.
  const hostById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) map.set(member.connectionId, member.host);
    return map;
  }, [members]);
  function hostForItem(item: RackItem): string | null {
    return item.connectionId ? (hostById.get(item.connectionId) ?? null) : null;
  }

  // Select a node: focus its Site, switch to the Rack view, and set the drill.
  function selectNode(siteId: string, next: DrillPath) {
    setRootSurface("site");
    setActiveId(siteId);
    setSelectedDestination("serverRooms");
    setDrill(next);
  }

  function selectSiteDestination(siteId: string, destination: SiteDestination) {
    setRootSurface("site");
    setActiveId(siteId);
    setDrill(EMPTY_DRILL);
    setSelectedDestination(destination);
  }

  function showTopologyMenu(
    event: ReactMouseEvent<HTMLElement>,
    {
      onProperties,
      onDelete,
      deleteDisabled = false,
      addAction,
      sortItems,
    }: {
      onProperties: () => void;
      onDelete: () => void;
      deleteDisabled?: boolean;
      addAction?: { label: string; action: () => void };
      sortItems?: NativeContextMenuItem[];
    },
  ) {
    event.preventDefault();
    event.stopPropagation();
    const items: NativeContextMenuItem[] = [];
    if (addAction) {
      items.push({
        kind: "item",
        label: addAction.label,
        iconSvg: nativeMenuIcons.plus,
        action: addAction.action,
      });
    }
    if (sortItems) {
      if (items.length > 0) items.push({ kind: "separator" });
      items.push({
        kind: "submenu",
        label: t("itops.racks.sortAction"),
        items: sortItems,
      });
      items.push({ kind: "separator" });
    }
    items.push(
      {
        kind: "item",
        label: t("itops.actions.delete"),
        iconSvg: nativeMenuIcons.trash,
        disabled: deleteDisabled,
        action: onDelete,
      },
      { kind: "separator" },
      {
        kind: "item",
        label: t("common.properties"),
        iconSvg: nativeMenuIcons.pencil,
        action: onProperties,
      },
    );
    void showNativeContextMenu(items, { x: event.clientX, y: event.clientY });
  }

  function showAddServerRoomMenu(event: ReactMouseEvent<HTMLElement>, siteId: string) {
    event.preventDefault();
    event.stopPropagation();
    void showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("itops.racks.addServerRoomAction"),
          iconSvg: nativeMenuIcons.plus,
          action: () => setServerRoomDialog({ siteId, room: null }),
        },
        { kind: "separator" },
        {
          kind: "submenu",
          label: t("itops.racks.sortAction"),
          items: serverRoomSortMenuItems(siteId),
        },
      ],
      { x: event.clientX, y: event.clientY },
    );
  }

  function setServerRoomSortDirection(siteId: string, direction: ServerRoomSortDirection) {
    setServerRoomSort((current) => ({ ...current, [siteId]: direction }));
  }

  function topologySortMenuItems(
    setDirection: (direction: ServerRoomSortDirection) => void,
  ): NativeContextMenuItem[] {
    return [
      {
        kind: "item",
        label: t("itops.racks.sortAscending"),
        iconSvg: nativeMenuIcons.arrowUp,
        action: () => setDirection("asc"),
      },
      {
        kind: "item",
        label: t("itops.racks.sortDescending"),
        iconSvg: nativeMenuIcons.arrowDown,
        action: () => setDirection("desc"),
      },
    ];
  }

  function serverRoomSortMenuItems(siteId: string): NativeContextMenuItem[] {
    return topologySortMenuItems((direction) => setServerRoomSortDirection(siteId, direction));
  }

  function rackSortMenuItems(roomKey: string): NativeContextMenuItem[] {
    return topologySortMenuItems((direction) =>
      setRackSort((current) => ({ ...current, [roomKey]: direction })),
    );
  }

  function showTreeSortMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    items: NativeContextMenuItem[],
  ) {
    const bounds = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu(items, {
      x: bounds.left,
      y: bounds.bottom,
    });
  }

  // Armed picker placement: the configured Rack Device lands on the clicked U
  // (and, for a fractional-width device, the clicked horizontal slot).
  async function placeConfiguredDevice(
    rack: Rack,
    draft: RackItemDraft,
    startU: number,
    slot?: number,
  ) {
    if (!activeGroup) return;
    try {
      await placeRackItem(activeGroup.id, {
        rackId: rack.id,
        connectionId: draft.connectionId,
        kind: draft.kind,
        label: draft.label,
        startU,
        heightU: draft.heightU,
        mountFace: draft.mountFace,
        metadata:
          draft.metadata.widthFraction && slot != null
            ? { ...draft.metadata, slot }
            : draft.metadata,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    }
  }

  async function moveItem(
    itemId: string,
    targetRackId: string,
    startU: number,
    xFraction?: number,
    mountFace?: RackMountFace,
  ) {
    if (!activeGroup) return;
    const item = racks.flatMap((rack) => rack.items).find((entry) => entry.id === itemId);
    if (!item) return;
    // A fractional-width device also lands on the horizontal slot under the
    // drop point; full-width devices ignore it.
    const slots = rackItemSlotCount(item.metadata?.widthFraction);
    const slot =
      slots > 1 && xFraction != null
        ? Math.min(slots - 1, Math.floor(Math.max(0, xFraction) * slots))
        : null;
    if (
      item.rackId === targetRackId &&
      item.startU === startU &&
      (mountFace == null || mountFace === (item.mountFace ?? "front")) &&
      (slot == null || slot === (item.metadata?.slot ?? 0))
    ) {
      return;
    }
    try {
      await moveRackItem(activeGroup.id, {
        id: itemId,
        rackId: targetRackId,
        startU,
        heightU: item.heightU,
        ...(mountFace != null ? { mountFace } : {}),
        ...(slot != null ? { slot } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    }
  }

  // Click on a bound device: anchor the connect popover to its faceplate.
  function openRackItem(item: RackItem, anchorEl: HTMLElement) {
    if (collectBoundConnectionIds(item).length === 0) return;
    const rect = anchorEl.getBoundingClientRect();
    setConnectPopover({
      item,
      anchor: {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      },
    });
  }

  async function confirmDelete() {
    const pending = pendingDelete;
    if (!pending) return;
    setPendingDelete(null);
    try {
      if (pending.kind === "site") {
        await removeSite(pending.site.id);
        setActiveId(null);
        setDrill(EMPTY_DRILL);
        setSelectedDestination("site");
        setRootSurface("site");
        return;
      }
      if (pending.kind === "serverRoom") {
        for (const rack of pending.racks) {
          await deleteRack(pending.siteId, rack.id);
        }
        await deleteServerRoom(pending.siteId, pending.room.id);
        setDrill(EMPTY_DRILL);
        return;
      }
      if (pending.kind === "rack") {
        await deleteRack(pending.siteId, pending.rack.id);
        setDrill({ serverRoom: pending.rack.serverRoom, rackId: null });
        return;
      }
      await removeRackItem(pending.siteId, pending.item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    }
  }

  if (loaded && sites.length === 0) {
    return (
      <>
        <ItOpsEmptyHint>
          <Trans
            i18nKey="itops.sites.emptyHint"
            components={{
              newSite: <button type="button" onClick={() => setDialog({ group: null })} />,
            }}
          />
        </ItOpsEmptyHint>
        {dialog ? (
          <SiteDialog
            group={dialog.group}
            onClose={() => setDialog(null)}
            onSaved={(saved) => setActiveId(saved.id)}
          />
        ) : null}
      </>
    );
  }

  // The deepest selected node id, for tree-row highlighting.
  const selectedId = rootSurface === "tasks"
    ? "itops:tasks"
    : !activeGroup
    ? ""
    : drill.rackId
      ? nodeId.rack(drill.rackId)
      : drill.serverRoom != null
        ? nodeId.serverRoom(activeGroup.id, drill.serverRoom)
        : nodeId.site(activeGroup.id);

  // ── Per-view background derivation ──
  const drillRack = drill.rackId != null ? racks.find((r) => r.id === drill.rackId) : undefined;

  const viewBackground = drillRack
    ? drillRack.background
    : drill.serverRoom != null
      ? activeGroup?.roomBackgrounds?.[drill.serverRoom]
      : activeGroup?.background;

  const q = query.trim().toLowerCase();
  const matchQ = (s: string) => !q || (s || t("itops.racks.unassigned")).toLowerCase().includes(q);
  const effectiveTreeWidth = treeCollapsed ? SITE_TREE_COLLAPSED_WIDTH : treeWidth;
  const hasExpandableTreeNodes = sites.length > 0;
  const selectedServerRoomsSiteId =
    rootSurface === "site" && selectedDestination === "serverRooms" && drill.serverRoom == null
      ? activeGroup?.id ?? null
      : null;
  const selectedServerRoomGroup = drill.serverRoom == null
    ? null
    : topology.find(
        (room) => topologyGroupKey(room.key) === topologyGroupKey(drill.serverRoom),
      ) ?? null;
  const selectedRackSortKey =
    rootSurface === "site" &&
    selectedDestination === "serverRooms" &&
    drill.rackId == null &&
    activeGroup &&
    selectedServerRoomGroup
      ? rackTreeSortKey(activeGroup.id, selectedServerRoomGroup)
      : null;
  const addTopologyMenu = !treeCollapsed ? (
    <div className="ft-add-wrap">
      <button
        type="button"
        className="icon-button"
        title={t("itops.racks.addNode")}
        aria-label={t("itops.racks.addNode")}
        aria-haspopup="menu"
        aria-expanded={addMenuOpen}
        onClick={() => setAddMenuOpen((open) => !open)}
      >
        <ItIcon name="plus" size={14} />
      </button>
      {addMenuOpen ? (
        <>
          <div className="ft-add-backdrop" onClick={() => setAddMenuOpen(false)} />
          <div className="ft-add-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAddMenuOpen(false);
                setDialog({ group: null });
              }}
            >
              <ItIcon name="site" size={14} />
              {t("itops.racks.addSite")}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!activeGroup}
              onClick={() => {
                setAddMenuOpen(false);
                setServerRoomDialog({ siteId: selectedSiteIdForDialog, room: null });
              }}
            >
              <ItIcon name="room" size={14} />
              {t("itops.racks.addServerRoom")}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!activeGroup}
              onClick={() => {
                setAddMenuOpen(false);
                setRackDialog({
                  siteId: selectedSiteIdForDialog,
                  rack: null,
                  defaultServerRoom: selectedServerRoomForDialog,
                });
              }}
            >
              <ItIcon name="rack" size={14} />
              {t("itops.racks.addRack")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  ) : null;

  return (
    <div className={`hg ft${treeCollapsed ? " ft-collapsed" : ""}`}>
      {/* ── Tree navigator ── */}
      <div
        ref={treeRef}
        className="ft-tree"
        data-tutorial-id="itops.sitesTree"
        style={{ width: effectiveTreeWidth, flex: `0 0 ${effectiveTreeWidth}px` }}
      >
        {renderSidebarHeader?.({ actions: addTopologyMenu, collapsed: treeCollapsed })}
        {!treeCollapsed ? (
          <>
            <div className="ft-head">
              <span className="ft-head-title">{t("itops.sites.heading")}</span>
              {hasExpandableTreeNodes ? (
                <div className="ft-tree-controls" aria-label={t("itops.sites.heading")}>
                  {selectedServerRoomsSiteId || selectedRackSortKey ? (
                    <button
                      aria-label={t("itops.racks.sortAction")}
                      aria-haspopup="menu"
                      className="it-icon-btn sm ft-tree-control"
                      onClick={(event) =>
                        showTreeSortMenu(
                          event,
                          selectedServerRoomsSiteId
                            ? serverRoomSortMenuItems(selectedServerRoomsSiteId)
                            : selectedRackSortKey
                              ? rackSortMenuItems(selectedRackSortKey)
                              : [],
                        )
                      }
                      title={t("itops.racks.sortAction")}
                      type="button"
                    >
                      <ArrowUpDown size={13} />
                    </button>
                  ) : null}
                  <button
                    aria-label={t("connections.collapseAll")}
                    className="it-icon-btn sm ft-tree-control"
                    onClick={collapseAllNodes}
                    title={t("connections.collapseAll")}
                    type="button"
                  >
                    <Minimize2 size={13} />
                  </button>
                  <button
                    aria-label={t("connections.expandAll")}
                    className="it-icon-btn sm ft-tree-control"
                    onClick={expandAllNodes}
                    title={t("connections.expandAll")}
                    type="button"
                  >
                    <Maximize2 size={13} />
                  </button>
                </div>
              ) : null}
            </div>
            <div className="ft-search">
              <ItIcon name="search" size={13} />
              <input
                type="text"
                value={query}
                placeholder={t("itops.racks.treeSearchPlaceholder")}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              {query ? (
                <button type="button" className="ft-search-x" onClick={() => setQuery("")}>
                  <ItIcon name="xmark" size={12} />
                </button>
              ) : null}
            </div>
            <div className="ft-tree-body">
              {sites.map((site) => {
                const fId = nodeId.site(site.id);
                const siteRacks = racksBySite[site.id] ?? [];
                const siteTopo = sortServerRoomTopology(
                  groupRackTopology(siteRacks, serverRoomsBySite[site.id] ?? []),
                  serverRoomSort[site.id],
                );
                const open = isExpanded(fId);
                return (
                  <div key={site.id}>
                    <TreeRow
                      depth={0}
                      icon={groupIcon(site)}
                      customIcon={site}
                      label={site.name}
                      tint={groupColor(site.id)}
                      tutorialId={`itops.site:${site.id}`}
                      hasChildren
                      open={open}
                      selected={activeId === site.id && selectedDestination === "site" && drill.serverRoom == null && rootSurface === "site"}
                      onToggle={() => toggleNode(fId)}
                      onSelect={() => {
                        selectSiteDestination(site.id, "site");
                      }}
                      onContextMenu={(event) =>
                        showTopologyMenu(event, {
                          onProperties: () => setDialog({ group: site }),
                          onDelete: () => setPendingDelete({ kind: "site", site }),
                          deleteDisabled: site.id === DEFAULT_SITE_ID,
                        })
                      }
                    />
                    {open ? (
                      <>
                        <TreeRow
                          depth={1}
                          icon="room"
                          label={t("itops.navigation.serverRooms")}
                          count={siteTopo.length}
                          hasChildren={siteTopo.length > 0}
                          open={isExpanded(`${fId}:rooms`)}
                          selected={activeId === site.id && selectedDestination === "serverRooms" && drill.serverRoom == null && rootSurface === "site"}
                          onToggle={() => toggleNode(`${fId}:rooms`)}
                          onSelect={() => selectSiteDestination(site.id, "serverRooms")}
                          onContextMenu={(event) => showAddServerRoomMenu(event, site.id)}
                        />
                        {isExpanded(`${fId}:rooms`) ? siteTopo
                          .filter((room) => matchQ(room.key))
                          .map((room) => {
                            const mId = nodeId.serverRoom(site.id, room.key);
                            const mOpen = isExpanded(mId);
                            const roomRackSortKey = rackTreeSortKey(site.id, room);
                            const sortedRoomRacks = sortRackTopology(
                              room.racks,
                              rackSort[roomRackSortKey],
                            );
                            return (
                              <div key={mId}>
                                <TreeRow
                                  depth={2}
                                  icon="room"
                                  customIcon={site.roomIcons?.[room.key]}
                                  label={room.key || t("itops.racks.unassigned")}
                                  count={room.racks.length}
                                  hasChildren={room.racks.length > 0}
                                  open={mOpen}
                                  selected={selectedId === mId}
                                  onToggle={() => toggleNode(mId)}
                                  onSelect={() =>
                                    selectNode(site.id, { serverRoom: room.key, rackId: null })
                                  }
                                  onContextMenu={
                                    room.room
                                      ? (event) =>
                                          showTopologyMenu(event, {
                                            addAction: {
                                              label: t("itops.racks.addRackAction"),
                                              action: () =>
                                                setRackDialog({
                                                  siteId: site.id,
                                                  rack: null,
                                                  defaultServerRoom: room.key,
                                                }),
                                            },
                                            sortItems: rackSortMenuItems(roomRackSortKey),
                                            onProperties: () =>
                                              setServerRoomDialog({ siteId: site.id, room: room.room! }),
                                            onDelete: () =>
                                              setPendingDelete({
                                                kind: "serverRoom",
                                                siteId: site.id,
                                                room: room.room!,
                                                racks: room.racks,
                                              }),
                                          })
                                      : undefined
                                  }
                                />
                                {mOpen
                                  ? sortedRoomRacks.map((rack) => (
                                      <TreeRow
                                        key={rack.id}
                                        depth={3}
                                        icon="rack"
                                        label={rack.name}
                                        hasChildren={false}
                                        open={false}
                                        selected={selectedId === nodeId.rack(rack.id)}
                                        onSelect={() =>
                                          selectNode(site.id, {
                                            serverRoom: room.key,
                                            rackId: rack.id,
                                          })
                                        }
                                        onContextMenu={(event) =>
                                          showTopologyMenu(event, {
                                            onProperties: () =>
                                              setRackDialog({ siteId: site.id, rack }),
                                            onDelete: () =>
                                              setPendingDelete({ kind: "rack", siteId: site.id, rack }),
                                          })
                                        }
                                      />
                                    ))
                                  : null}
                              </div>
                            );
                          }) : null}
                        <TreeRow depth={1} icon="server" label={t("itops.tabs.hosts")} hasChildren={false} open={false} selected={activeId === site.id && selectedDestination === "hosts" && rootSurface === "site"} onSelect={() => selectSiteDestination(site.id, "hosts")} />
                        <TreeRow depth={1} icon="auto" label={t("itops.tabs.autos")} hasChildren={false} open={false} selected={activeId === site.id && selectedDestination === "automations" && rootSurface === "site"} onSelect={() => selectSiteDestination(site.id, "automations")} />
                        <TreeRow depth={1} icon="history" label={t("itops.navigation.runHistory")} hasChildren={false} open={false} selected={activeId === site.id && selectedDestination === "runHistory" && rootSurface === "site"} onSelect={() => selectSiteDestination(site.id, "runHistory")} />
                      </>
                    ) : null}
                  </div>
                );
              })}
              <div className="ft-tree-library-label">{t("itops.navigation.library")}</div>
              <TreeRow depth={0} icon="code" label={t("itops.tasks.heading")} count={taskCount} hasChildren={false} open={false} selected={rootSurface === "tasks"} onSelect={() => setRootSurface("tasks")} />
            </div>
          </>
        ) : null}
        <div
          className="ft-resize"
          onPointerDown={handleResizeStart}
        />
      </div>

      {/* ── Detail ── */}
      {rootSurface === "tasks" ? (
        <div className="hg-detail it-destination-page">
        <TaskLibrary onOpenRunHistory={(siteId) => selectSiteDestination(siteId, "runHistory")} />
        </div>
      ) : activeGroup && selectedDestination === "hosts" ? (
        <div className="hg-detail it-destination-page">
          <HostsPanel siteId={activeGroup.id} />
        </div>
      ) : activeGroup && selectedDestination === "automations" ? (
        <div className="hg-detail it-destination-page">
          <AutomationsTab siteId={activeGroup.id} siteHosts={members.map((member) => member.host)} />
        </div>
      ) : activeGroup && selectedDestination === "runHistory" ? (
        <div className="hg-detail it-destination-page">
          <BatchRunsTab siteId={activeGroup.id} />
        </div>
      ) : activeGroup ? (
        <div className="hg-detail" data-tutorial-id="itops.siteView">
          <RackDrill
            topology={topology}
            topologyLoaded={topologyLoaded}
            racks={racks}
            site={activeGroup}
            drill={drill}
            setDrill={setDrill}
            viewBackground={viewBackground}
            roomIcons={activeGroup.roomIcons}
            hostForItem={hostForItem}
            isGhostItem={isGhostItem}
            onConfigureDevice={(rack, kind, defaultMountFace, arm) =>
              setItemDialog({
                rack,
                item: null,
                kind,
                defaultMountFace,
                onConfigured: arm,
              })
            }
            onPlaceDevice={(rack, draft, startU, slot) =>
              void placeConfiguredDevice(rack, draft, startU, slot)
            }
            onOpenItem={openRackItem}
            onEditItem={(rack, item) => setItemDialog({ rack, item })}
            onBindItem={setBindingsDialog}
            onMoveItem={(itemId, targetRackId, startU, xFraction, mountFace) =>
              void moveItem(itemId, targetRackId, startU, xFraction, mountFace)
            }
            onAddRack={(serverRoom) => {
              setRackDialog({
                siteId: activeGroup.id,
                rack: null,
                defaultServerRoom: serverRoom,
              });
            }}
            onAddServerRoom={() => {
              setServerRoomDialog({ siteId: activeGroup.id, room: null });
            }}
            onAddRackForPlacement={(serverRoom, onSaved) => {
              setRackDialog({
                siteId: activeGroup.id,
                rack: null,
                defaultServerRoom: serverRoom,
                onSaved,
              });
            }}
            onDeleteServerRoom={(serverRoom, roomRacks) => {
              const room = serverRooms.find((entry) => topologyGroupKey(entry.name) === topologyGroupKey(serverRoom));
              if (room) setPendingDelete({ kind: "serverRoom", siteId: activeGroup.id, room, racks: roomRacks });
            }}
            onDeleteRack={(rack) =>
              setPendingDelete({ kind: "rack", siteId: activeGroup.id, rack })
            }
            onDeleteItem={(rack, item) =>
              setPendingDelete({ kind: "item", siteId: activeGroup.id, rack, item })
            }
          />
        </div>
      ) : null}

      {dialog ? (
        <SiteDialog
          group={dialog.group}
          onClose={() => setDialog(null)}
          onSaved={(saved) => setActiveId(saved.id)}
        />
      ) : null}
      {rackDialog && activeGroup ? (
        <RackDialog
          defaultSiteId={rackDialog.siteId}
          sites={sites}
          serverRoomsBySite={serverRoomsBySite}
          rack={rackDialog.rack}
          defaultServerRoom={rackDialog.defaultServerRoom}
          placementMode={!!rackDialog.onSaved}
          onClose={() => setRackDialog(null)}
          onSaved={(saved, sequence) => {
            // Picker placement flow: stay in the room view and arm the new
            // rack for its placement click instead of drilling into it.
            if (rackDialog.onSaved) {
              rackDialog.onSaved(saved, sequence);
              return;
            }
            setActiveId(saved.siteId);
            setDrill({ serverRoom: saved.serverRoom, rackId: saved.id });
          }}
        />
      ) : null}
      {serverRoomDialog ? (
        <ServerRoomDialog
          sites={sites}
          defaultSiteId={serverRoomDialog.siteId}
          room={serverRoomDialog.room}
          onClose={() => setServerRoomDialog(null)}
          onSaved={(saved) => {
            setActiveId(saved.siteId);
            setDrill({ serverRoom: saved.name, rackId: null });
          }}
        />
      ) : null}
      {itemDialog && activeGroup ? (
        <RackItemDialog
          siteId={activeGroup.id}
          rack={itemDialog.rack}
          item={itemDialog.item}
          defaultKind={itemDialog.kind}
          defaultMountFace={itemDialog.defaultMountFace}
          members={members}
          onClose={() => setItemDialog(null)}
          onConfigured={itemDialog.onConfigured}
        />
      ) : null}
      {bindingsDialog && activeGroup ? (
        <RackItemBindingsDialog siteId={activeGroup.id} item={bindingsDialog} onClose={() => setBindingsDialog(null)} />
      ) : null}
      {connectPopover ? (
        <RackItemConnectPopover
          item={connectPopover.item}
          anchor={connectPopover.anchor}
          onClose={() => setConnectPopover(null)}
          onShowWorkspace={onShowWorkspace}
        />
      ) : null}
      {pendingDelete ? (
        <ConfirmSheet
          tone="danger"
          title={
            pendingDelete.kind === "site"
              ? t("itops.sites.deleteTitle")
              : pendingDelete.kind === "serverRoom"
              ? t("itops.racks.deleteServerRoomTitle")
              : pendingDelete.kind === "rack"
                ? t("itops.racks.deleteTitle")
                : t("itops.racks.deleteItemTitle")
          }
          message={
            pendingDelete.kind === "site"
              ? t("itops.sites.deleteBody", { name: pendingDelete.site.name })
              : pendingDelete.kind === "serverRoom"
              ? t("itops.racks.deleteServerRoomBody", {
                  name: pendingDelete.room.name,
                  count: pendingDelete.racks.length,
                })
              : pendingDelete.kind === "rack"
                ? t("itops.racks.deleteBody", { name: pendingDelete.rack.name })
                : t("itops.racks.deleteItemBody", {
                    name: pendingDelete.item.label || t(`itops.racks.kind.${pendingDelete.item.kind}`),
                  })
          }
          confirmLabel={t("itops.actions.delete")}
          confirmIcon="trash"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}

function ItOpsIcon({
  icon,
  customIcon,
  size,
}: {
  icon: ItIconName;
  customIcon?: ItOpsCustomIcon;
  size: number;
}) {
  if (customIcon?.iconDataUrl) {
    return (
      <ConnectionIcon
        iconBackgroundColor={customIcon.iconBackgroundColor}
        iconColor={customIcon.iconColor}
        iconDataUrl={customIcon.iconDataUrl}
        size={size}
        type="localFiles"
      />
    );
  }
  if (customIcon?.iconBackgroundColor) {
    return (
      <span
        className="ft-custom-icon"
        style={{
          background: customIcon.iconBackgroundColor,
          color: iconForegroundForBackground(customIcon.iconBackgroundColor),
        }}
      >
        {customIcon.iconColor ? (
          <span style={{ color: customIcon.iconColor }}>
            <ItIcon name={icon} size={size} sw={1.6} />
          </span>
        ) : (
          <ItIcon name={icon} size={size} sw={1.6} />
        )}
      </span>
    );
  }
  if (customIcon?.iconColor) {
    return (
      <span style={{ color: customIcon.iconColor }}>
        <ItIcon name={icon} size={size} sw={1.6} />
      </span>
    );
  }
  return <ItIcon name={icon} size={size} sw={1.6} />;
}

// ── Tree row ──────────────────────────────────────────────────────────────
function TreeRow({
  depth,
  icon,
  customIcon,
  label,
  count,
  tint,
  hasChildren,
  open,
  selected,
  onToggle,
  onSelect,
  onContextMenu,
  tutorialId,
}: {
  depth: number;
  icon: ItIconName;
  customIcon?: ItOpsCustomIcon;
  label: string;
  count?: number;
  tint?: string;
  hasChildren: boolean;
  open: boolean;
  selected: boolean;
  onToggle?: () => void;
  onSelect: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** Entity-scoped tutorial anchor (e.g. `itops.site:<id>`). */
  tutorialId?: string;
}) {
  return (
    <div
      className={`ft-row${selected ? " sel" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      data-tutorial-id={tutorialId}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className={`ft-caret${hasChildren ? "" : " empty"}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggle?.();
        }}
        tabIndex={hasChildren ? 0 : -1}
        aria-hidden={!hasChildren}
      >
        {hasChildren ? <ItIcon name={open ? "chevD" : "chevR"} size={11} /> : null}
      </button>
      <span className="ft-ic" style={tint ? { color: tint } : undefined}>
        <ItOpsIcon icon={icon} customIcon={customIcon} size={14} />
      </span>
      <span className="ft-label">{label}</span>
      {count != null ? <span className="ft-count">{count}</span> : null}
    </div>
  );
}

// ── Rack drill body ───────────────────────────────────────────────────────
function RackDrill({
  topology,
  topologyLoaded,
  racks,
  site,
  drill,
  setDrill,
  viewBackground,
  roomIcons,
  hostForItem,
  isGhostItem,
  onConfigureDevice,
  onPlaceDevice,
  onOpenItem,
  onEditItem,
  onBindItem,
  onMoveItem,
  onAddServerRoom,
  onAddRack,
  onAddRackForPlacement,
  onDeleteServerRoom,
  onDeleteRack,
  onDeleteItem,
}: {
  topology: ReturnType<typeof groupRackTopology>;
  topologyLoaded: boolean;
  racks: Rack[];
  site: Site;
  drill: DrillPath;
  setDrill: (next: DrillPath) => void;
  viewBackground: DashboardBackground | null | undefined;
  roomIcons?: Record<string, ItOpsCustomIcon>;
  hostForItem: (item: RackItem) => string | null;
  isGhostItem: (item: RackItem) => boolean;
  /** Picker flow: open the device dialog in configure mode; `arm` receives the
   *  configured draft so the drill can start the cursor-tracked placement. */
  onConfigureDevice: (
    rack: Rack,
    kind: RackItemKind,
    defaultMountFace: RackMountFace,
    arm: (draft: RackItemDraft) => void,
  ) => void;
  /** Armed placement click landed on `startU` (and, for a fractional-width
   *  device, the horizontal `slot`): place the configured device. */
  onPlaceDevice: (rack: Rack, draft: RackItemDraft, startU: number, slot?: number) => void;
  onOpenItem: (item: RackItem, anchor: HTMLElement) => void;
  onEditItem: (rack: Rack, item: RackItem) => void;
  onBindItem: (item: RackItem) => void;
  onMoveItem: (
    itemId: string,
    targetRackId: string,
    startU: number,
    xFraction?: number,
    mountFace?: RackMountFace,
  ) => void;
  onAddServerRoom: () => void;
  onAddRack: (serverRoom: string) => void;
  /** Picker flow: open the New Rack dialog, hand the saved rack back for a
   *  placement click instead of drilling into it. */
  onAddRackForPlacement: (
    serverRoom: string,
    onSaved: (saved: Rack, sequence: RackPlacementSequence | null) => void,
  ) => void;
  onDeleteServerRoom: (serverRoom: string, racks: Rack[]) => void;
  onDeleteRack: (rack: Rack) => void;
  onDeleteItem: (rack: Rack, item: RackItem) => void;
}) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const unassigned = t("itops.racks.unassigned");
  const ungrouped = t("itops.racks.ungrouped");
  const [editMode, setEditMode] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const setServerRoomBackground = useItOpsStore((state) => state.setServerRoomBackground);
  const setSiteBackground = useItOpsStore((state) => state.setSiteBackground);
  const createRackForSequence = useItOpsStore((state) => state.createRack);
  const discardRack = useItOpsStore((state) => state.deleteRack);

  // Server Room View layout: rack elevations (default), the blueprint floor
  // plan, or the 2.5D room. Persists app-wide.
  const [roomView, setRoomView] = useState<RoomViewMode>(loadRoomViewMode);
  useEffect(() => saveRoomViewMode(roomView), [roomView]);
  const [elevationFaces, setElevationFaces] = useState<Record<string, RackMountFace>>({});
  useEffect(() => setElevationFaces({}), [site.id, drill.serverRoom]);
  const elevationFaceFor = useCallback(
    (rackId: string): RackMountFace => elevationFaces[rackId] ?? "front",
    [elevationFaces],
  );

  // Host inventory for Rack View callouts.
  const siteHosts = useItOpsStore((state) => state.hostsBySite[site.id]);
  const loadHosts = useItOpsStore((state) => state.loadHosts);
  useEffect(() => {
    void loadHosts(site.id).catch(() => undefined);
  }, [site.id, loadHosts]);

  // Picker column state shared by the two spatial layouts: the armed room
  // object kind, and a just-created rack awaiting its placement click.
  const [roomTool, setRoomTool] = useState<RoomTool>(null);
  const [placeRackId, setPlaceRackId] = useState<string | null>(null);
  const placeRackIdRef = useRef(placeRackId);
  placeRackIdRef.current = placeRackId;
  const rackSequenceRef = useRef<RackPlacementSequence | null>(null);
  const discardPendingRackRef = useRef<(rackId: string) => void>(() => undefined);
  discardPendingRackRef.current = (rackId) => {
    void discardRack(site.id, rackId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    });
  };

  function cancelRoomPlacement() {
    const pendingRackId = placeRackIdRef.current;
    placeRackIdRef.current = null;
    rackSequenceRef.current = null;
    setRoomTool(null);
    setPlaceRackId(null);
    if (pendingRackId && pendingRackId !== RACK_SEQUENCE_PENDING_ID) {
      discardPendingRackRef.current(pendingRackId);
    }
  }

  function completeRackPlacement() {
    const sequence = rackSequenceRef.current;
    if (!sequence) {
      placeRackIdRef.current = null;
      setPlaceRackId(null);
      return;
    }
    // Keep the placement tool cancellable while the next durable Rack is
    // created, without allowing another click to move the Rack just placed.
    placeRackIdRef.current = RACK_SEQUENCE_PENDING_ID;
    setPlaceRackId(RACK_SEQUENCE_PENDING_ID);

    const nextName = nextRackSequenceName(
      sequence.template,
      racks
        .filter((entry) => entry.serverRoom === sequence.input.serverRoom)
        .map((entry) => entry.name),
    );
    void createRackForSequence(site.id, { ...sequence.input, name: nextName })
      .then((created) => {
        if (rackSequenceRef.current !== sequence) {
          return discardPendingRackRef.current(created.id);
        }
        placeRackIdRef.current = created.id;
        setPlaceRackId(created.id);
      })
      .catch((error: unknown) => {
        rackSequenceRef.current = null;
        placeRackIdRef.current = null;
        setPlaceRackId(null);
        const message = error instanceof Error ? error.message : String(error);
        showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      });
  }
  // Rack View and Server Room elevation picker: a configured Rack Device
  // awaiting its placement click.
  const [placeDevice, setPlaceDevice] = useState<RackItemDraft | null>(null);

  const serverRoom =
    drill.serverRoom != null
      ? topology.find((s) => topologyGroupKey(s.key) === topologyGroupKey(drill.serverRoom))
      : undefined;
  const rack = drill.rackId != null ? racks.find((r) => r.id === drill.rackId) : undefined;
  const viewKey = rack
    ? `rack:${rack.id}`
    : serverRoom
      ? `room:${site.id}:${topologyGroupKey(serverRoom.key)}`
      : `site:${site.id}`;
  useEffect(() => {
    setEditMode(false);
    setExportMenuOpen(false);
    setBackgroundOpen(false);
  }, [viewKey]);
  useEffect(() => {
    const pendingRackId = placeRackIdRef.current;
    placeRackIdRef.current = null;
    rackSequenceRef.current = null;
    setRoomTool(null);
    setPlaceRackId(null);
    setPlaceDevice(null);
    if (pendingRackId && pendingRackId !== RACK_SEQUENCE_PENDING_ID) {
      discardPendingRackRef.current(pendingRackId);
    }
  }, [viewKey, editMode, roomView]);

  // Server Room elevation placement: every cabinet listens document-wide while
  // armed, so only the cabinet nearest the pointer carries the armed spec —
  // otherwise a click landing between two adjacent cabinets would place the
  // device into both. The room's tallest cabinet bounds the configure dialog.
  const roomElevationsRef = useRef<HTMLDivElement | null>(null);
  const roomPlaceRackId = useNearestPlacementRack(
    editMode && roomView === "elevation" && serverRoom != null && rack == null && placeDevice != null,
    roomElevationsRef,
    () => setPlaceDevice(null),
  );
  const roomPickerRack = (serverRoom?.racks ?? []).reduce<Rack | null>(
    (tallest, entry) => (tallest == null || entry.heightU > tallest.heightU ? entry : tallest),
    null,
  );

  const sitePlacementScope = siteLayoutScope(site.id);
  const [sitePlacements, setSitePlacements] = useState<FreePlacementMap>(() =>
    loadFreePlacement(sitePlacementScope),
  );
  useEffect(() => {
    setSitePlacements(loadFreePlacement(sitePlacementScope));
  }, [sitePlacementScope]);

  // Rack placements are durable rack fields (SQLite grid_x/grid_y); edits write
  // only there. The legacy per-scope blob (pre-durable-column layouts) is read
  // once and merged underneath so old saves still resolve, but is never written
  // again. Merge order: legacy < durable columns < this session's live edits.
  // The floor plan and the 2.5D view share this one grid-cell placement, so
  // arranging the room in either view rearranges both.
  const roomRacks = serverRoom?.racks;
  const isoPlacementScope = serverRoom ? roomIsoLayoutScope(site.id, serverRoom.key) : "";
  const legacyIsoPlacements = useMemo(
    () => (isoPlacementScope ? loadFreePlacement(isoPlacementScope) : {}),
    [isoPlacementScope],
  );
  const [isoEdits, setIsoEdits] = useState<FreePlacementMap>({});
  useEffect(() => setIsoEdits({}), [isoPlacementScope]);
  const isoPlacements = useMemo(
    () => ({
      ...legacyIsoPlacements,
      ...durablePlacement(roomRacks, "grid"),
      ...isoEdits,
    }),
    [legacyIsoPlacements, roomRacks, isoEdits],
  );

  // Per-room rack facing, shared by the floor plan and the 2.5D view. Facing
  // is a durable rack field (SQLite); the legacy per-scope blob is read once and
  // merged underneath but never written again. Merge order: legacy < durable <
  // this session's edits (the same merge as placements).
  const legacyFacing = useMemo(
    () => (isoPlacementScope ? loadRackFacing(isoPlacementScope) : {}),
    [isoPlacementScope],
  );
  const [facingEdits, setFacingEdits] = useState<RackFacingMap>({});
  useEffect(() => setFacingEdits({}), [isoPlacementScope]);
  const roomFacing = useMemo(() => {
    const durable: RackFacingMap = {};
    for (const entry of roomRacks ?? []) {
      if (entry.facing != null) durable[entry.id] = sanitizeFacing(entry.facing);
    }
    return { ...legacyFacing, ...durable, ...facingEdits };
  }, [legacyFacing, roomRacks, facingEdits]);

  const setRackFacings = useItOpsStore((state) => state.setRackFacings);
  const loadDurableRoomObjects = useItOpsStore((state) => state.loadRoomObjects);
  const saveDurableRoomObjects = useItOpsStore((state) => state.saveRoomObjects);

  function saveRoomFacingState(next: RackFacingMap) {
    setFacingEdits(next);
    const entries = Object.entries(next)
      .filter(([id]) => rackIds.has(id))
      .map(([id, facing]) => ({ id, facing }));
    setRackFacings(site.id, entries).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    });
  }

  // Non-rack room objects: durable per room (itops_room_objects). The legacy
  // per-scope blob is read once as a starting point but never written again.
  const [roomObjects, setRoomObjects] = useState<RoomObject[]>([]);
  const roomObjectsSaveTimer = useRef<number | undefined>(undefined);
  const roomName = serverRoom ? serverRoom.key : null;
  useEffect(() => {
    let cancelled = false;
    setRoomObjects(isoPlacementScope ? loadRoomObjects(isoPlacementScope) : []);
    if (roomName == null) return;
    loadDurableRoomObjects(site.id, roomName)
      .then((durable) => {
        if (!cancelled && durable.length > 0) setRoomObjects(durable);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [isoPlacementScope, roomName, site.id, loadDurableRoomObjects, showStatusBarNotice, t]);

  const saveRoomObjectsState = useCallback((next: RoomObject[]) => {
    setRoomObjects(next);
    if (roomName == null) return;
    if (roomObjectsSaveTimer.current != null) {
      window.clearTimeout(roomObjectsSaveTimer.current);
    }
    // Debounced like placement saves: dragging an object streams positions.
    roomObjectsSaveTimer.current = window.setTimeout(() => {
      roomObjectsSaveTimer.current = undefined;
      saveDurableRoomObjects(site.id, roomName, next).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      });
    }, 500);
  }, [roomName, saveDurableRoomObjects, showStatusBarNotice, site.id, t]);

  // A 乖乖 pack resting on a cabinet top lives as the rack's single rack-top
  // Rack Device — the same object the Rack View shows center top — never as a
  // room object. Both room views hand rack-top drops here; the settle effect
  // below migrates packs from older saves the same way.
  const placeRackItemAction = useItOpsStore((state) => state.placeRackItem);
  const kuaiguaiPlacingRef = useRef<Set<string>>(new Set());
  const placeKuaiguaiOnRack = useCallback(
    (target: Rack, corner?: Corner, facing?: Facing): boolean => {
      if (
        kuaiguaiPlacingRef.current.has(target.id) ||
        target.items.some((item) => isRackTopItem(item, target.heightU))
      ) {
        return false;
      }
      kuaiguaiPlacingRef.current.add(target.id);
      placeRackItemAction(site.id, {
        rackId: target.id,
        connectionId: null,
        kind: "kuaiguai",
        label: "",
        mountFace: "front",
        startU: target.heightU + 1,
        heightU: KUAIGUAI_TOP_CLEARANCE_U,
        metadata: {
          kuaiguaiSize: "large",
          kuaiguaiStyle: "full",
          rackTopCorner: corner,
          rackTopFacing: facing,
        },
      })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
        })
        .finally(() => kuaiguaiPlacingRef.current.delete(target.id));
      return true;
    },
    [placeRackItemAction, showStatusBarNotice, site.id, t],
  );

  useEffect(() => {
    if (!isoPlacementScope || roomRacks == null || roomObjects.length === 0) return;
    // Settle against the same resolved cells the room views draw (stored
    // placements plus derived defaults), not the raw stored map — otherwise
    // auto-placed racks are invisible to gravity and their rack-top objects
    // would be yanked to the floor.
    const rackCells = resolveIsoLayout(
      roomRacks,
      isoPlacements,
      roomObjects.filter((object) => object.kind === "wall"),
    ).cells;
    const settled = settleRoomObjects(roomObjects, roomRacks, rackCells, roomFacing);
    // Rack-top 乖乖 packs from older saves become rack items; a pack whose
    // cabinet top is already taken merges away instead of double-stacking.
    const kept = settled.filter((object) => {
      if (object.kind !== "kuaikuai") return true;
      const support = rackTopSupport(
        { x: object.x, y: object.y },
        object.kind,
        object.rot,
        object.corner,
        object.z,
        roomRacks,
        rackCells,
        roomFacing,
      );
      if (!support) return true;
      placeKuaiguaiOnRack(support, object.corner);
      return false;
    });
    if (kept.length !== settled.length || !sameRoomObjects(roomObjects, settled)) {
      saveRoomObjectsState(kept);
    }
  }, [isoPlacementScope, roomObjects, roomRacks, isoPlacements, roomFacing, placeKuaiguaiOnRack, saveRoomObjectsState]);

  function notifyObjectBlocked() {
    showStatusBarNotice(t("itops.floorPlan.objectNoSpace"), { tone: "warning" });
  }

  // The background popover serves the Server Room elevation/2.5D views and
  // Site View; each persists to its own durable scope.
  async function saveDrillViewBackground(background: DashboardBackground | null) {
    try {
      if (serverRoom) {
        await setServerRoomBackground(site.id, serverRoom.key, background);
      } else {
        await setSiteBackground(site.id, background);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    }
  }

  async function handleElevationContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    // An armed placement owns right-click as Cancel. Let its document-level
    // handler consume the event instead of opening the background picker.
    if (placeDevice) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-rack-id], .rm-picker")) return;
    event.preventDefault();
    await showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("itops.racks.changeBackground"),
          action: () => setBackgroundOpen(true),
        },
      ],
      { x: event.clientX, y: event.clientY },
    );
  }

  // Snap every Server Room card back onto the default Site View grid.
  function autoOrganizeSiteRooms() {
    const next: FreePlacementMap = {};
    topology.forEach((room, index) => {
      next[topologyGroupKey(room.key)] = defaultFreePlacement(
        index,
        FREE_CARD_WIDTH,
        FREE_CARD_HEIGHT,
      );
    });
    saveSitePlacements(next);
  }

  // Persist placements durably, debounced: the floor plan streams a position
  // per pointermove, and even the iso view's one-per-drop saves batch cleanly.
  const setRackPlacements = useItOpsStore((state) => state.setRackPlacements);
  const durableSaveTimers = useRef<Partial<Record<RackPlacementKind, number>>>({});
  const rackIds = useMemo(() => new Set(racks.map((entry) => entry.id)), [racks]);
  function scheduleDurableSave(kind: RackPlacementKind, map: FreePlacementMap) {
    const pending = durableSaveTimers.current[kind];
    if (pending != null) window.clearTimeout(pending);
    durableSaveTimers.current[kind] = window.setTimeout(() => {
      durableSaveTimers.current[kind] = undefined;
      const entries = Object.entries(map)
        .filter(([id]) => rackIds.has(id))
        .map(([id, point]) => ({ id, x: point.x, y: point.y }));
      setRackPlacements(site.id, kind, entries).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      });
    }, 500);
  }

  function elevation(r: Rack) {
    const face = elevationFaceFor(r.id);
    return (
      <RackElevation
        key={r.id}
        rack={r}
        face={face}
        onToggleFace={() =>
          setElevationFaces((current) => ({
            ...current,
            [r.id]: face === "front" ? "rear" : "front",
          }))
        }
        hostFor={hostForItem}
        reserveTopU={KUAIGUAI_TOP_CLEARANCE_U}
        editMode={editMode}
        placeSpec={roomPlaceRackId === r.id ? placeDevice : null}
        onPlaceAt={(startU, slot) => {
          if (!placeDevice) return;
          onPlaceDevice(r, placeDevice, startU, slot);
          setPlaceDevice(null);
        }}
        onCancelPlacement={() => setPlaceDevice(null)}
        onOpenItem={onOpenItem}
        onEditItem={(item) => onEditItem(r, item)}
        onBindItem={onBindItem}
        onMoveItem={editMode ? onMoveItem : undefined}
        onDeleteRack={editMode ? onDeleteRack : undefined}
        onDeleteItem={editMode ? (item) => onDeleteItem(r, item) : undefined}
        isGhost={isGhostItem}
      />
    );
  }

  const roomElevationFaces = serverRoom?.racks.map((entry) => elevationFaceFor(entry.id)) ?? [];
  const globalElevationFace: RackMountFace | null =
    roomElevationFaces.length > 0 && roomElevationFaces.every((value) => value === "front")
      ? "front"
      : roomElevationFaces.length > 0 && roomElevationFaces.every((value) => value === "rear")
        ? "rear"
        : null;

  function setAllElevationFaces(face: RackMountFace) {
    if (!serverRoom) return;
    setElevationFaces(
      Object.fromEntries(serverRoom.racks.map((entry) => [entry.id, face])) as Record<
        string,
        RackMountFace
      >,
    );
  }

  function kindLabel(kind: RackItem["kind"]) {
    return t(`itops.racks.kind.${kind}`);
  }

  function exportLabels(): ItOpsExportLabels {
    return {
      devices: t("itops.export.devices"),
      noRacks: t("itops.export.noRacks"),
      noDevices: t("itops.export.noDevices"),
      inventory: t("itops.export.inventory"),
      rack: t("itops.export.rack"),
      group: t("itops.racks.groupLabel"),
      ungrouped: t("itops.racks.ungrouped"),
      startU: t("itops.racks.startULabel"),
      heightU: t("itops.racks.heightLabel"),
      mountingSide: t("itops.racks.mountingSideLabel"),
      type: t("itops.racks.kindLabel"),
      label: t("itops.racks.labelLabel"),
      status: t("itops.racks.statusLabel"),
      connection: t("itops.racks.connectionLabel"),
      specs: t("itops.export.specs"),
      tags: t("itops.racks.tagsLabel"),
      deviceCount: (count) => t("itops.racks.deviceCount", { count }),
      faceLabel: (face) => t(`itops.racks.face.${face}`),
      statusLabel: (status) => t(`itops.racks.status.${status}`, { defaultValue: status }),
    };
  }

  async function handleExport(format: ItOpsExportFormat) {
    setExportMenuOpen(false);
    try {
      const labels = exportLabels();
      let name = site.name;
      if (format === "excel" && rack) {
        const roomName = rack.serverRoom;
        name = `${site.name}-${rack.name}`;
        const path = await saveExportBytes(
          excelFilename(name),
          rackExcelBytes({ site, rack, roomName, unassignedLabel: unassigned, labels, kindLabel }),
          [{ name: t("itops.export.excelFilter"), extensions: ["xls"] }],
          "application/vnd.ms-excel",
        );
        if (path) {
          showStatusBarNotice(t("itops.export.complete", { name: path }), { tone: "success" });
        }
        return;
      }

      const doc = rack
        ? rackPdfDocument({
            site,
            rack,
            roomName: rack.serverRoom,
            unassignedLabel: unassigned,
            labels,
            kindLabel,
          })
        : serverRoom
          ? serverRoomPdfDocument({
              site,
              roomName: serverRoom.key,
              racks: serverRoom.racks,
              unassignedLabel: unassigned,
              labels,
              kindLabel,
            })
          : sitePdfDocument({ site, racks, unassignedLabel: unassigned, labels, kindLabel });
      name = doc.title;
      const path = await saveExportBytes(
        pdfFilename(name),
        createItOpsPdfBytes(doc),
        [{ name: t("itops.export.pdfFilter"), extensions: ["pdf"] }],
        "application/pdf",
      );
      if (path) {
        showStatusBarNotice(t("itops.export.complete", { name: path }), { tone: "success" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
    }
  }

  function saveSitePlacements(next: FreePlacementMap) {
    setSitePlacements(next);
    saveFreePlacement(sitePlacementScope, next);
  }

  function saveIsoPlacements(next: FreePlacementMap) {
    setIsoEdits(next);
    scheduleDurableSave("grid", next);
  }

  return (
    <div className="ft-drill">
      <ItOpsBackground background={viewBackground} className="ft-drill-bg">
        <div className="it-drill-toolbar">
          <div className="it-drill-spacer" />
          {serverRoom && !rack ? (
            <div className="it-room-view-controls">
              <div
                className="rm-segmented"
                role="group"
                aria-label={t("itops.floorPlan.viewLabel")}
              >
                <button
                  type="button"
                  data-active={roomView === "elevation"}
                  onClick={() => setRoomView("elevation")}
                >
                  <ItIcon name="rows" size={13} />
                  {t("itops.floorPlan.viewElevation")}
                </button>
                <button
                  type="button"
                  data-active={roomView === "floor"}
                  onClick={() => setRoomView("floor")}
                >
                  <ItIcon name="grid" size={13} />
                  {t("itops.floorPlan.viewFloor")}
                </button>
                <button
                  type="button"
                  data-active={roomView === "iso"}
                  onClick={() => setRoomView("iso")}
                >
                  <ItIcon name="cube" size={13} />
                  {t("itops.floorPlan.view25d")}
                </button>
              </div>
            </div>
          ) : null}
          {rack ? (
            <div className="it-rack-toolbar-meta">
              <strong>{rack.name}</strong>
              <span>
                {t("itops.racks.unitCount", { count: rack.heightU })}
                {` · ${rack.depthMm} mm`}
                {rack.items.length > 0
                  ? ` · ${t("itops.racks.deviceCount", { count: rack.items.length })}`
                  : ""}
              </span>
            </div>
          ) : null}
          <div className="it-drill-actions" aria-label={t("itops.actions.viewActions")}>
            {!rack && !serverRoom && topology.length > 0 ? (
              <button
                type="button"
                className="it-drill-action"
                title={t("itops.sites.autoOrganize")}
                aria-label={t("itops.sites.autoOrganize")}
                onClick={autoOrganizeSiteRooms}
              >
                <ItIcon name="grid" size={15} />
              </button>
            ) : null}
            {serverRoom && !rack && roomView === "elevation" ? (
              <button
                type="button"
                className="it-drill-action rack-flip-all-action"
                title={t("itops.racks.allRackFacesLabel")}
                aria-label={t("itops.racks.allRackFacesLabel")}
                data-face={globalElevationFace ?? "mixed"}
                onClick={() =>
                  setAllElevationFaces(globalElevationFace === "front" ? "rear" : "front")
                }
              >
                <ItIcon name="rerun" size={15} />
              </button>
            ) : null}
            <button
              type="button"
              className={`it-drill-action${editMode ? " active" : ""}`}
              title={editMode ? t("itops.actions.editDone") : t("itops.actions.edit")}
              aria-label={editMode ? t("itops.actions.editDone") : t("itops.actions.edit")}
              aria-pressed={editMode}
              onClick={() => setEditMode((value) => !value)}
            >
              <ItIcon name={editMode ? "check" : "edit"} size={15} />
            </button>
            <div className="it-drill-export">
              <button
                  type="button"
                  className="it-drill-action"
                  title={t("itops.actions.export")}
                  aria-label={t("itops.actions.export")}
                  aria-haspopup="menu"
                  aria-expanded={exportMenuOpen}
                  onClick={() => setExportMenuOpen((open) => !open)}
                >
                  <ItIcon name="share" size={15} />
              </button>
              {exportMenuOpen ? (
                  <>
                    <div className="it-drill-menu-backdrop" onClick={() => setExportMenuOpen(false)} />
                    <div className="it-drill-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => void handleExport("pdf")}>
                        <ItIcon name="book" size={14} />
                        {t("itops.export.pdf")}
                      </button>
                      {rack ? (
                        <button type="button" role="menuitem" onClick={() => void handleExport("excel")}>
                          <ItIcon name="table" size={14} />
                          {t("itops.export.excel")}
                        </button>
                      ) : null}
                    </div>
                  </>
              ) : null}
            </div>
          </div>
        </div>
        {!topologyLoaded ? null : rack ? (
          <div className="it-rack-layout">
            <RackStage
              rack={rack}
              hosts={siteHosts}
              hostFor={hostForItem}
              isGhost={isGhostItem}
              editMode={editMode}
              onOpenItem={onOpenItem}
              onEditItem={(item) => onEditItem(rack, item)}
              onBindItem={onBindItem}
              onMoveItem={editMode ? onMoveItem : undefined}
              onDeleteItem={editMode ? (item) => onDeleteItem(rack, item) : undefined}
              placeSpec={editMode ? placeDevice : null}
              onPlaceAt={(startU, slot) => {
                if (!placeDevice) return;
                onPlaceDevice(rack, placeDevice, startU, slot);
                setPlaceDevice(null);
              }}
              onCancelPlacement={() => setPlaceDevice(null)}
            />
            {rack.items.length === 0 && !editMode ? (
              <ItOpsEmptyHint>
                <Trans
                  i18nKey="itops.racks.emptyRackHint"
                  components={{
                    editMode: (
                      <button type="button" onClick={() => setEditMode(true)} />
                    ),
                  }}
                />
              </ItOpsEmptyHint>
            ) : null}
            {editMode ? (
              <RackObjectPicker
                racks={[rack]}
                armedKind={placeDevice?.kind ?? null}
                onPickDevice={(kind) => {
                  // Clicking the armed card again disarms; any card re-opens
                  // the configure dialog and re-arms with the new draft.
                  if (placeDevice?.kind === kind) {
                    setPlaceDevice(null);
                    return;
                  }
                  onConfigureDevice(rack, kind, "front", setPlaceDevice);
                }}
              />
            ) : null}
          </div>
        ) : serverRoom ? (
          serverRoom.racks.length === 0 ? (
            <ItOpsEmptyHint>
              <Trans
                i18nKey="itops.racks.emptyServerRoomHint"
                components={{
                  addRack: (
                    <button type="button" onClick={() => onAddRack(serverRoom.key)} />
                  ),
                }}
              />
            </ItOpsEmptyHint>
          ) : roomView === "iso" || roomView === "floor" ? (
            <div className="rm-spatial">
              {roomView === "iso" ? (
                <ServerRoomIsoView
                  racks={serverRoom.racks}
                  editMode={editMode}
                  floorColor={sanitizeIsoFloor(serverRoom.room?.floorColor)}
                  tool={roomTool}
                  placeRackId={placeRackId}
                  onRackPlaced={completeRackPlacement}
                  onObjectPlaced={() => {
                    if (roomTool !== "wall") setRoomTool(null);
                  }}
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
                  onRackPlaced={completeRackPlacement}
                  onObjectPlaced={() => {
                    if (roomTool !== "wall") setRoomTool(null);
                  }}
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
                    if (placeRackId != null) cancelRoomPlacement();
                    setRoomTool(tool);
                  }}
                  rackArmed={placeRackId != null}
                  onPickRack={() => {
                    setRoomTool(null);
                    if (placeRackId != null) {
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
            <div
              className="rk-room-layout"
              onContextMenu={handleElevationContextMenu}
            >
              <div
                className="rk-elevations"
                ref={roomElevationsRef}
              >
                {groupRacksByGroup(serverRoom.racks).map((g) => (
                  <div className="rk-group" key={g.key}>
                    {groupRacksByGroup(serverRoom.racks).length > 1 || g.key ? (
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

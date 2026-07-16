// Persistence for the Sites tree navigator (docs/SITE.md Rack View): the panel
// width and the set of collapsed node ids, mirrored on localStorage like the
// Connection tree's `connectionSidebarState`. Node ids are stable path strings
// ("site:<id>", "region:<id>/<region>", …) so collapse survives reloads.

import { sanitizeRoomObjects, type RoomObject } from "./roomObjects";
import { sanitizeFacing, type Facing, type IsoViewAngle } from "./roomIsoLayout";
import { readDurableUiState, writeDurableUiState } from "../../lib/durableUiState";

const WIDTH_KEY = "kkterm.itopsSiteTreeWidth";
const PANEL_COLLAPSED_KEY = "kkterm.itopsSiteTreePanelCollapsed";
const COLLAPSED_KEY = "kkterm.itopsSiteTreeCollapsed";
const SERVER_ROOM_SORT_KEY = "kkterm.itopsServerRoomTreeSort";
const RACK_SORT_KEY = "kkterm.itopsRackTreeSort";
const ROOM_VIEW_KEY = "kkterm.itopsRoomViewMode";
const FREE_LAYOUT_KEY = "kkterm.itopsFreePlacement";
const RACK_FACING_KEY = "kkterm.itopsRackFacing";
const ROOM_OBJECTS_KEY = "kkterm.itopsRoomObjects";
const ISO_ANGLE_KEY = "kkterm.itopsIsoViewAngle";
const ROOM_ZOOM_KEY = "kkterm.itopsRoomZoom";

export const SITE_TREE_MIN_WIDTH = 200;
export const SITE_TREE_MAX_WIDTH = 460;
export const SITE_TREE_DEFAULT_WIDTH = 268;
export const SITE_TREE_COLLAPSED_WIDTH = 0;

export function loadSiteTreeWidth(): number {
  if (typeof localStorage === "undefined") return SITE_TREE_DEFAULT_WIDTH;
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return SITE_TREE_DEFAULT_WIDTH;
  return Math.min(SITE_TREE_MAX_WIDTH, Math.max(SITE_TREE_MIN_WIDTH, raw));
}

export function saveSiteTreeWidth(width: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
}

export function loadSiteTreeCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(PANEL_COLLAPSED_KEY) === "true";
}

export function saveSiteTreeCollapsed(collapsed: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? "true" : "false");
}

export function loadCollapsedNodeIds(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(
      Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function saveCollapsedNodeIds(ids: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
}

export type ServerRoomSortDirection = "asc" | "desc";

export type ServerRoomSortMap = Record<string, ServerRoomSortDirection>;

export function loadServerRoomTreeSort(): ServerRoomSortMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const stored = JSON.parse(localStorage.getItem(SERVER_ROOM_SORT_KEY) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const sort: ServerRoomSortMap = {};
    for (const [siteId, direction] of Object.entries(stored)) {
      if (direction === "asc" || direction === "desc") sort[siteId] = direction;
    }
    return sort;
  } catch {
    return {};
  }
}

export function saveServerRoomTreeSort(sort: ServerRoomSortMap): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SERVER_ROOM_SORT_KEY, JSON.stringify(sort));
}

export function sortServerRoomTopology<T extends { key: string }>(
  rooms: T[],
  direction?: ServerRoomSortDirection,
): T[] {
  if (!direction) return rooms;
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rooms].sort(
    (left, right) => multiplier * left.key.localeCompare(right.key, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export type RackSortMap = Record<string, ServerRoomSortDirection>;

export function loadRackTreeSort(): RackSortMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const stored = JSON.parse(localStorage.getItem(RACK_SORT_KEY) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const sort: RackSortMap = {};
    for (const [roomId, direction] of Object.entries(stored)) {
      if (direction === "asc" || direction === "desc") sort[roomId] = direction;
    }
    return sort;
  } catch {
    return {};
  }
}

export function saveRackTreeSort(sort: RackSortMap): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(RACK_SORT_KEY, JSON.stringify(sort));
}

export function sortRackTopology<T extends { name: string }>(
  racks: T[],
  direction?: ServerRoomSortDirection,
): T[] {
  if (!direction) return racks;
  const multiplier = direction === "asc" ? 1 : -1;
  return [...racks].sort(
    (left, right) => multiplier * left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

// Server Room View layout: rack elevations (default), the top-down floor
// plan, or the 2.5D axonometric room.
export type RoomViewMode = "elevation" | "floor" | "iso";

export function loadRoomViewMode(): RoomViewMode {
  if (typeof localStorage === "undefined") return "elevation";
  const raw = localStorage.getItem(ROOM_VIEW_KEY);
  return raw === "floor" || raw === "iso" ? raw : "elevation";
}

export function saveRoomViewMode(mode: RoomViewMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ROOM_VIEW_KEY, mode);
}

export interface FreePlacement {
  x: number;
  y: number;
}

export type FreePlacementMap = Record<string, FreePlacement>;

// Free placement is durable frontend state: the Site View server-room card
// positions are stored here (no typed column exists for them) and mirrored to
// SQLite. Legacy per-room rack placements saved here before the durable
// rack columns (grid_x/grid_y) existed are still read for a one-time merge in
// SitesTab, but Server Room View rack drags now write only the typed columns.
function readFreePlacementStore(): Record<string, FreePlacementMap> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(readDurableUiState(FREE_LAYOUT_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const store: Record<string, FreePlacementMap> = {};
    for (const [scope, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entries: FreePlacementMap = {};
      for (const [id, point] of Object.entries(value)) {
        if (!point || typeof point !== "object" || Array.isArray(point)) continue;
        const x = Number((point as FreePlacement).x);
        const y = Number((point as FreePlacement).y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          entries[id] = { x, y };
        }
      }
      store[scope] = entries;
    }
    return store;
  } catch {
    return {};
  }
}

export function loadFreePlacement(scope: string): FreePlacementMap {
  return readFreePlacementStore()[scope] ?? {};
}

export function saveFreePlacement(scope: string, placement: FreePlacementMap): void {
  if (typeof localStorage === "undefined") return;
  const store = readFreePlacementStore();
  store[scope] = placement;
  writeDurableUiState(FREE_LAYOUT_KEY, JSON.stringify(store));
}

// ── Rack facing (per-room quarter-turn orientation of each rack) ──

export type RackFacingMap = Record<string, Facing>;

// Read-only legacy accessor for the per-scope rack-facing and room-object
// blobs. Both are now durable rack fields / rows (SQLite); these blobs are read
// once and merged underneath the typed values in SitesTab but never written.
function readScopedStore(key: string): Record<string, unknown> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(readDurableUiState(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function loadRackFacing(scope: string): RackFacingMap {
  const raw = readScopedStore(RACK_FACING_KEY)[scope];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const map: RackFacingMap = {};
  for (const [id, value] of Object.entries(raw)) {
    map[id] = sanitizeFacing(value);
  }
  return map;
}

// ── Room objects (per-room non-rack fixtures, see roomObjects.ts) ──

export function loadRoomObjects(scope: string): RoomObject[] {
  return sanitizeRoomObjects(readScopedStore(ROOM_OBJECTS_KEY)[scope]);
}

// ── 2.5D fixed view angle (app-wide, like the room view mode) ──

export function loadIsoViewAngle(): IsoViewAngle {
  if (typeof localStorage === "undefined") return 0;
  const raw = Number(localStorage.getItem(ISO_ANGLE_KEY));
  return raw === 1 || raw === 2 || raw === 3 ? raw : 0;
}

export function saveIsoViewAngle(angle: IsoViewAngle): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ISO_ANGLE_KEY, String(angle));
}

// ── 2.5D floor colour ──

/** Solid floor finishes for the 2.5D room; "default" follows the app theme,
 *  the rest are fixed material palettes defined in itops.css. */
export const ISO_FLOOR_COLORS = ["default", "concrete", "graphite", "green", "blue"] as const;

export type IsoFloorColor = (typeof ISO_FLOOR_COLORS)[number];

export function sanitizeIsoFloor(value: unknown): IsoFloorColor {
  return (ISO_FLOOR_COLORS as readonly unknown[]).includes(value)
    ? (value as IsoFloorColor)
    : "default";
}

// ── Room view zoom (app-wide like the view mode, one level per spatial view) ──

export const ROOM_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type RoomZoomView = "floor" | "iso";

export function sanitizeRoomZoom(value: unknown): number {
  const zoom = Number(value);
  return (ROOM_ZOOM_LEVELS as readonly number[]).includes(zoom) ? zoom : 1;
}

/** The next zoom level in `dir`, clamped to the ends of ROOM_ZOOM_LEVELS. */
export function stepRoomZoom(zoom: number, dir: 1 | -1): number {
  const index = (ROOM_ZOOM_LEVELS as readonly number[]).indexOf(sanitizeRoomZoom(zoom));
  return ROOM_ZOOM_LEVELS[Math.min(ROOM_ZOOM_LEVELS.length - 1, Math.max(0, index + dir))];
}

export function loadRoomZoom(view: RoomZoomView): number {
  if (typeof localStorage === "undefined") return 1;
  return sanitizeRoomZoom(localStorage.getItem(`${ROOM_ZOOM_KEY}.${view}`));
}

export function saveRoomZoom(view: RoomZoomView, zoom: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`${ROOM_ZOOM_KEY}.${view}`, String(zoom));
}

// Rack topology grouping for the Sites tree + drill-down (docs/SITE.md Rack
// View). Folds a Site's flat rack list into the hierarchy
// Site → Server Room → Rack, preserving stored order. A blank server room
// collapses under an "Unassigned" bucket (empty key, ""). Node ids are stable
// strings so the tree's collapse state and the drill path survive reloads and
// identify a node unambiguously.

import type { Rack, ServerRoom } from "../../types";

export function topologyGroupKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase();
}

export interface ServerRoomGroup {
  /** Stored value ("" = Unassigned). */
  key: string;
  /** First-class Server Room properties when this is not a legacy rack-only group. */
  room?: ServerRoom;
  racks: Rack[];
}

export function groupRackTopology(racks: Rack[], durableRooms: ServerRoom[] = []): ServerRoomGroup[] {
  const rooms: ServerRoomGroup[] = durableRooms.map((room) => ({ key: room.name, room, racks: [] }));
  for (const rack of racks) {
    const roomKey = rack.serverRoom ?? "";
    const comparableKey = topologyGroupKey(roomKey);
    let room = rooms.find((entry) => topologyGroupKey(entry.key) === comparableKey);
    if (!room) {
      room = { key: roomKey, racks: [] };
      rooms.push(room);
    }
    room.racks.push(rack);
  }
  return rooms;
}

export interface RackGroup {
  /** Stored value ("" = Ungrouped). */
  key: string;
  racks: Rack[];
}

/** Sub-group a server room's racks by their `rackGroup` tag, preserving order. */
export function groupRacksByGroup(racks: Rack[]): RackGroup[] {
  const groups: RackGroup[] = [];
  for (const rack of racks) {
    const key = rack.rackGroup ?? "";
    const comparableKey = topologyGroupKey(key);
    let group = groups.find((entry) => topologyGroupKey(entry.key) === comparableKey);
    if (!group) {
      group = { key, racks: [] };
      groups.push(group);
    }
    group.racks.push(rack);
  }
  return groups;
}

// A drill path into one Site's topology: a server room and, at the leaf, a
// single rack.
export interface DrillPath {
  serverRoom: string | null;
  rackId: string | null;
}

export const EMPTY_DRILL: DrillPath = {
  serverRoom: null,
  rackId: null,
};

// Stable node ids for tree collapse + selection.
export const nodeId = {
  site: (siteId: string) => `site:${siteId}`,
  serverRoom: (siteId: string, room: string) => `room:${siteId}/${room}`,
  rack: (rackId: string) => `rack:${rackId}`,
};

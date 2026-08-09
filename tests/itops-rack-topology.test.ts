import assert from "node:assert/strict";
import test from "node:test";
import type { Rack, ServerRoom } from "../src/types";
import {
  groupRackTopology,
  groupRacksByGroup,
  groupRacksForElevation,
} from "../src/modules/itops/rackTopology";

function rack(id: string, serverRoom: string, rackGroup: string): Rack {
  return {
    id,
    siteId: "site-1",
    name: id,
    serverRoom,
    rackGroup,
    shell: null,
    background: null,
    heightU: 42,
    depthMm: 1000,
    sortOrder: 0,
    items: [],
  };
}

test("IT Ops rack topology groups server rooms and rack groups case-insensitively", () => {
  const racks = [
    rack("rack-1", "NETWORK-A", "Core"),
    rack("rack-2", "network-a", "core"),
    rack("rack-3", "Network-B", "Edge"),
  ];

  const rooms = groupRackTopology(racks);
  assert.equal(rooms.length, 2);
  assert.equal(rooms[0].key, "NETWORK-A");
  assert.deepEqual(
    rooms[0].racks.map((entry) => entry.id),
    ["rack-1", "rack-2"],
  );

  const groups = groupRacksByGroup(rooms[0].racks);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "Core");
  assert.deepEqual(
    groups[0].racks.map((entry) => entry.id),
    ["rack-1", "rack-2"],
  );
});

test("IT Ops topology keeps durable Server Rooms visible when they have no Racks", () => {
  const rooms: ServerRoom[] = [
    { id: "room-a", siteId: "site-1", name: "Room A", sortOrder: 0 },
    { id: "room-b", siteId: "site-1", name: "Room B", sortOrder: 1 },
  ];

  const topology = groupRackTopology([rack("rack-1", "Room A", "")], rooms);

  assert.deepEqual(topology.map((room) => room.key), ["Room A", "Room B"]);
  assert.equal(topology[1].racks.length, 0);
});

test("Server Room elevation naturally orders Rack groups and names without mutating storage order", () => {
  const racks = [
    rack("C2", "Room A", "C"),
    rack("C3", "Room A", "C"),
    rack("C8", "Room A", "C"),
    rack("C1", "Room A", "c"),
    rack("A10", "Room A", "A"),
    rack("A2", "Room A", "A"),
    rack("ungrouped", "Room A", ""),
    rack("B1", "Room A", "B"),
  ];
  racks.forEach((entry, sortOrder) => {
    entry.sortOrder = sortOrder;
  });

  const groups = groupRacksForElevation(racks);

  assert.deepEqual(groups.map((group) => group.key), ["A", "B", "C", ""]);
  assert.deepEqual(
    groups.map((group) => group.racks.map((entry) => entry.name)),
    [["A2", "A10"], ["B1"], ["C1", "C2", "C3", "C8"], ["ungrouped"]],
  );
  assert.deepEqual(racks.map((entry) => entry.name), ["C2", "C3", "C8", "C1", "A10", "A2", "ungrouped", "B1"]);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  sortRackTopology,
  sortServerRoomTopology,
} from "../src/modules/itops/siteTreeState";

test("Server Room tree sorting is natural, reversible, and does not mutate topology", () => {
  const rooms = [
    { key: "Room 10", racks: ["rack-10"] },
    { key: "Alpha", racks: ["rack-a"] },
    { key: "Room 2", racks: ["rack-2"] },
  ];

  const ascending = sortServerRoomTopology(rooms, "asc");
  const descending = sortServerRoomTopology(rooms, "desc");

  assert.deepEqual(ascending.map((room) => room.key), ["Alpha", "Room 2", "Room 10"]);
  assert.deepEqual(descending.map((room) => room.key), ["Room 10", "Room 2", "Alpha"]);
  assert.deepEqual(rooms.map((room) => room.key), ["Room 10", "Alpha", "Room 2"]);
  assert.equal(ascending[1].racks, rooms[2].racks);
});

test("Rack tree sorting is natural, reversible, and does not mutate a Server Room", () => {
  const racks = [
    { id: "rack-10", name: "Rack 10" },
    { id: "rack-a", name: "Alpha" },
    { id: "rack-2", name: "Rack 2" },
  ];

  assert.deepEqual(
    sortRackTopology(racks, "asc").map((rack) => rack.name),
    ["Alpha", "Rack 2", "Rack 10"],
  );
  assert.deepEqual(
    sortRackTopology(racks, "desc").map((rack) => rack.name),
    ["Rack 10", "Rack 2", "Alpha"],
  );
  assert.deepEqual(racks.map((rack) => rack.name), ["Rack 10", "Alpha", "Rack 2"]);
});

test("Server Rooms tree exposes the selected-row toolbar and native sort submenu", async () => {
  const [sitesTab, treeState] = await Promise.all([
    readFile("src/modules/itops/SitesTab.tsx", "utf8"),
    readFile("src/modules/itops/siteTreeState.ts", "utf8"),
  ]);

  assert.match(
    sitesTab,
    /selectedServerRoomsSiteId \|\| selectedRackSortKey \? \([\s\S]*?itops\.racks\.sortAction[\s\S]*?<ArrowUpDown[\s\S]*?connections\.collapseAll/,
  );
  assert.match(
    sitesTab,
    /kind: "submenu",\s*label: t\("itops\.racks\.sortAction"\),\s*iconSvg: nativeMenuIcons\.chevronsUpDown,\s*items: serverRoomSortMenuItems\(siteId\)/,
  );
  assert.match(sitesTab, /itops\.racks\.sortAscending[\s\S]*?nativeMenuIcons\.arrowUp/);
  assert.match(sitesTab, /itops\.racks\.sortDescending[\s\S]*?nativeMenuIcons\.arrowDown/);
  assert.match(
    sitesTab,
    /sortServerRoomTopology\([\s\S]*?serverRoomSort\[site\.id\]/,
  );
  assert.match(treeState, /kkterm\.itopsServerRoomTreeSort/);
});

test("selected Server Room instances expose persisted Rack sorting in toolbar and context menu", async () => {
  const [sitesTab, treeState] = await Promise.all([
    readFile("src/modules/itops/SitesTab.tsx", "utf8"),
    readFile("src/modules/itops/siteTreeState.ts", "utf8"),
  ]);

  assert.match(sitesTab, /selectedServerRoomsSiteId \|\| selectedRackSortKey/);
  assert.match(sitesTab, /rackSortMenuItems\(selectedRackSortKey\)/);
  assert.match(sitesTab, /sortItems: rackSortMenuItems\(roomRackSortKey\)/);
  assert.match(
    sitesTab,
    /sortRackTopology\(\s*room\.racks,\s*rackSort\[roomRackSortKey\]/,
  );
  assert.match(sitesTab, /sortedRoomRacks\.map\(\(rack\)/);
  assert.match(treeState, /kkterm\.itopsRackTreeSort/);
  assert.match(treeState, /export function loadRackTreeSort/);
  assert.match(treeState, /export function saveRackTreeSort/);
});

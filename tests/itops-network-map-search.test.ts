import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkMap } from "../src/types";
import { matchesNetworkMapSearch } from "../src/modules/itops/networkMapSearch";

const map: NetworkMap = {
  id: "map-1",
  name: "Taipei Core",
  description: "Primary office network",
  siteId: "site-1",
  sortOrder: 0,
  graph: {
    roots: ["node-1"],
    nodes: [
      {
        id: "node-1",
        label: "Edge firewall",
        kind: "firewall",
        x: 10,
        y: 20,
        width: 190,
        height: 80,
        shape: "diamond",
        iconAccent: 2,
        interfaces: [
          { id: "if-wan", name: "TenGigabitEthernet1/1", address: "10.20.0.1" },
          { id: "if-v6", name: "TenGigabitEthernet1/2", address: "2001:db8::1" },
        ],
        status: "warning",
        hostId: "host-1",
        connectionId: "connection-1",
        rackItemId: "rack-item-1",
        deepLinks: [],
        note: "Replace after maintenance",
      },
    ],
    links: [
      {
        id: "link-1",
        from: "node-1",
        to: "node-2",
        label: "WAN uplink",
        kind: "fiber",
        strands: [
          {
            id: "strand-1",
            name: "",
            fromInterfaceId: "if-wan",
            toInterfaceId: "if-edge-wan",
            speed: "10 Gbps",
          },
          {
            id: "strand-2",
            name: "",
            fromInterfaceId: "if-v6",
            toInterfaceId: "if-edge-v6",
            speed: "10 Gbps",
          },
        ],
        nativeVlanId: "vlan-20",
        taggedVlanIds: ["vlan-30"],
        status: "up",
      },
    ],
    notes: [
      {
        id: "note-1",
        text: "Maintenance boundary",
        x: 0,
        y: 0,
        width: 240,
        height: 130,
        backgroundAccent: 1,
      },
    ],
  },
};

test("Network Map search covers map, node, and link metadata", () => {
  assert.equal(matchesNetworkMapSearch(map, "Taipei office"), true);
  assert.equal(matchesNetworkMapSearch(map, "edge 10.20.0.1 maintenance"), true);
  assert.equal(matchesNetworkMapSearch(map, "WAN fiber TenGigabitEthernet1/2 10 Gbps"), true);
  assert.equal(matchesNetworkMapSearch(map, "vlan-20 vlan-30"), true);
  assert.equal(matchesNetworkMapSearch(map, "rack-item-1"), true);
  assert.equal(matchesNetworkMapSearch(map, "2001:db8::1 maintenance boundary"), true);
  assert.equal(matchesNetworkMapSearch(map, "diamond"), true);
  assert.equal(matchesNetworkMapSearch(map, "Singapore"), false);
});

test("Network Map search includes translated display metadata", () => {
  assert.equal(
    matchesNetworkMapSearch(map, "degraded all sites", ["Degraded / warning", "All Sites"]),
    true,
  );
});

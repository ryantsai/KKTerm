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
        address: "10.20.0.1",
        status: "warning",
        hostId: "host-1",
        connectionId: "connection-1",
        rackItemId: "rack-item-1",
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
          { id: "strand-1", name: "TenGigabitEthernet1/1", speed: "10 Gbps" },
          { id: "strand-2", name: "TenGigabitEthernet1/2", speed: "10 Gbps" },
        ],
        nativeVlanId: "vlan-20",
        taggedVlanIds: ["vlan-30"],
        status: "up",
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
  assert.equal(matchesNetworkMapSearch(map, "Singapore"), false);
});

test("Network Map search includes translated display metadata", () => {
  assert.equal(
    matchesNetworkMapSearch(map, "degraded all sites", ["Degraded / warning", "All Sites"]),
    true,
  );
});

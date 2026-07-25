import assert from "node:assert/strict";
import test from "node:test";
import type { Connection, IpAddressRecord, IpamPrefixNode, SiteHost } from "../src/types";
import {
  addressesInPrefix,
  collectClaimCandidates,
  filterPrefixTree,
  parseIpv4,
  previewCidr,
  utilizationTone,
} from "../src/modules/itops/ipamModel";

test("parseIpv4 accepts dotted quads and rejects everything else", () => {
  assert.equal(parseIpv4("0.0.0.0"), 0);
  assert.equal(parseIpv4("255.255.255.255"), 4294967295);
  assert.equal(parseIpv4(" 10.0.0.1 "), 167772161);
  for (const bad of ["10.0.0", "10.0.0.256", "10.0.0.1.2", "1e2.0.0.1", "", "ten.0.0.1"]) {
    assert.equal(parseIpv4(bad), null, `expected ${bad} to be rejected`);
  }
});

test("previewCidr clears host bits, matching what the backend will store", () => {
  const preview = previewCidr("10.1.2.3/24");
  assert.equal(preview?.cidr, "10.1.2.0/24");
  assert.equal(preview?.network, "10.1.2.0");
  assert.equal(preview?.broadcast, "10.1.2.255");
  assert.equal(preview?.firstUsable, "10.1.2.1");
  assert.equal(preview?.lastUsable, "10.1.2.254");
  assert.equal(preview?.usable, 254);
});

test("previewCidr keeps every address on RFC 3021 point-to-point prefixes", () => {
  const p31 = previewCidr("192.0.2.4/31");
  assert.equal(p31?.usable, 2);
  assert.equal(p31?.firstUsable, "192.0.2.4");
  assert.equal(p31?.lastUsable, "192.0.2.5");

  const p32 = previewCidr("192.0.2.9/32");
  assert.equal(p32?.usable, 1);
  assert.equal(p32?.firstUsable, "192.0.2.9");
});

test("previewCidr handles /0 without the 32-bit shift wrapping", () => {
  const preview = previewCidr("10.0.0.1/0");
  assert.equal(preview?.cidr, "0.0.0.0/0");
  assert.equal(preview?.broadcast, "255.255.255.255");
  assert.equal(preview?.usable, 4294967294);
});

test("previewCidr rejects malformed input rather than guessing", () => {
  for (const bad of ["10.0.0.0", "10.0.0.0/", "10.0.0.0/33", "10.0.0.0/8/8", "/24", "10.0.0.0/x"]) {
    assert.equal(previewCidr(bad), null, `expected ${bad} to be rejected`);
  }
});

test("utilizationTone bands an empty, busy and full prefix apart", () => {
  assert.equal(utilizationTone(0), "free");
  assert.equal(utilizationTone(0.5), "low");
  assert.equal(utilizationTone(0.8), "high");
  assert.equal(utilizationTone(1), "full");
});

function connection(id: string, name: string, host: string): Connection {
  return { id, name, host, user: "", type: "ssh", status: "disconnected" } as Connection;
}

function host(id: string, hostname: string, label = ""): SiteHost {
  return {
    id,
    siteId: "site-1",
    hostname,
    label,
    kind: "physical",
    connectionIds: [],
    notes: "",
    sortOrder: 0,
  };
}

function record(address: string): IpAddressRecord {
  return { id: `rec-${address}`, address, vrf: "", status: "active", dnsName: "", description: "" };
}

test("claim candidates come from literal IPs only, deduplicated and sorted", () => {
  const candidates = collectClaimCandidates(
    [
      connection("c1", "Edge switch", "10.0.0.9"),
      connection("c2", "By name", "switch.example.com"),
      connection("c3", "Duplicate", "10.0.0.9"),
    ],
    [host("h1", "10.0.0.10", "  Core  "), host("h2", "10.0.0.2"), host("h3", "not-an-ip")],
    [record("10.0.0.2"), { ...record("10.0.0.9"), vrf: "corp" }],
    );

  // 10.0.0.2 is already documented in the default VRF. The corp-VRF copy of
  // 10.0.0.9 does not hide the default-VRF candidate.
  assert.deepEqual(
    candidates.map((entry) => [entry.address, entry.label, entry.origin]),
    [
      ["10.0.0.9", "Edge switch", "connection"],
      ["10.0.0.10", "Core", "host"],
    ],
  );
});

function prefix(id: string, cidr: string, parentId: string | null, role = ""): IpamPrefixNode {
  return {
    id,
    cidr,
    vrf: "",
    role,
    status: "active",
    description: "",
    parentId,
    depth: parentId ? 1 : 0,
    network: cidr.split("/")[0]!,
    broadcast: "",
    firstUsable: "",
    lastUsable: "",
    usable: 0,
    used: 0,
    utilization: 0,
    childCount: 0,
    addressCount: 0,
  };
}

test("filtering a prefix tree keeps the ancestors of each hit", () => {
  const tree = [
    prefix("p1", "10.0.0.0/8", null),
    prefix("p2", "10.1.0.0/16", "p1"),
    prefix("p3", "10.1.1.0/24", "p2", "Management"),
    prefix("p4", "192.168.0.0/16", null),
  ];
  assert.deepEqual(
    filterPrefixTree(tree, "management").map((entry) => entry.id),
    ["p1", "p2", "p3"],
  );
  // An empty query is not a filter.
  assert.equal(filterPrefixTree(tree, "  ").length, 4);
});

test("addresses are matched to a prefix by containment and VRF, in numeric order", () => {
  const target = prefix("p1", "10.1.1.0/24", null);
  const addresses: IpAddressRecord[] = [
    record("10.1.1.20"),
    record("10.1.1.3"),
    record("10.1.2.5"),
    { ...record("10.1.1.7"), vrf: "corp" },
  ];
  assert.deepEqual(
    addressesInPrefix(addresses, target).map((entry) => entry.address),
    // String order would put .20 before .3, and the corp-VRF row is a different
    // routing table that happens to overlap.
    ["10.1.1.3", "10.1.1.20"],
  );
});

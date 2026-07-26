import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkGraph, NetworkLink, NetworkNode } from "../src/types";
import {
  analyzeWhatIf,
  effectiveRoots,
  findStrandedNodes,
  findWeakPoints,
} from "../src/modules/itops/reachability";

function node(id: string): NetworkNode {
  return {
    id,
    label: id,
    kind: "switch",
    x: 0,
    y: 0,
    width: 190,
    height: 80,
    interfaces: [],
    status: "up",
    note: "",
  };
}

function link(id: string, from: string, to: string): NetworkLink {
  return {
    id,
    from,
    to,
    label: "",
    kind: "ethernet",
    strands: [{ id: `${id}-strand`, name: "", speed: "" }],
    taggedVlanIds: [],
    status: "up",
  };
}

// core ── dist ── access, with an isolated-by-design spare hanging off core.
function chain(): NetworkGraph {
  return {
    nodes: ["core", "dist", "access", "spare"].map(node),
    links: [link("l1", "core", "dist"), link("l2", "dist", "access"), link("l3", "core", "spare")],
    roots: ["core"],
    notes: [],
  };
}

test("an all-up map reports everything reachable", () => {
  const result = analyzeWhatIf(chain(), { nodes: [], links: [] });
  assert.deepEqual(result.roots, ["core"]);
  assert.equal(result.reachable.size, 4);
  assert.deepEqual(result.isolated, []);
  assert.deepEqual(result.severedLinks, []);
});

test("downing a mid-chain node isolates everything behind it", () => {
  const result = analyzeWhatIf(chain(), { nodes: ["dist"], links: [] });
  assert.deepEqual(result.isolated, ["access"]);
  // The failed node is reported as down, not as collateral isolation.
  assert.deepEqual(result.down, ["dist"]);
  // Both links touching the failed node are gone.
  assert.deepEqual(result.severedLinks, ["l1", "l2"]);
});

test("cutting a link isolates without downing a device", () => {
  const result = analyzeWhatIf(chain(), { nodes: [], links: ["l1"] });
  assert.deepEqual(result.isolated, ["dist", "access"]);
  assert.deepEqual(result.down, []);
  assert.deepEqual(result.downLinks, ["l1"]);
});

test("links severed by a down node are not reported as separately cut", () => {
  const result = analyzeWhatIf(chain(), { nodes: ["dist"], links: [] });
  assert.deepEqual(result.downLinks, []);
  assert.deepEqual(result.severedLinks, ["l1", "l2"]);
});

test("a redundant ring survives any single loss", () => {
  const graph: NetworkGraph = {
    nodes: ["a", "b", "c", "d"].map(node),
    links: [
      link("ab", "a", "b"),
      link("bc", "b", "c"),
      link("cd", "c", "d"),
      link("da", "d", "a"),
    ],
    roots: ["a"],
    notes: [],
  };
  assert.deepEqual(analyzeWhatIf(graph, { nodes: ["b"], links: [] }).isolated, []);
  assert.deepEqual(analyzeWhatIf(graph, { nodes: [], links: ["ab"] }).isolated, []);
  // Only the root itself matters in a ring: losing it strands the other three.
  assert.deepEqual(findWeakPoints(graph), [{ kind: "node", id: "a", isolates: 3 }]);
});

test("weak points rank the worst single failure first", () => {
  const points = findWeakPoints(chain());
  assert.deepEqual(points, [
    // Losing core takes dist, access and spare with it.
    { kind: "node", id: "core", isolates: 3 },
    { kind: "link", id: "l1", isolates: 2 },
    { kind: "node", id: "dist", isolates: 1 },
    { kind: "link", id: "l2", isolates: 1 },
    { kind: "link", id: "l3", isolates: 1 },
  ]);
});

test("downing every root strands the whole map", () => {
  const result = analyzeWhatIf(chain(), { nodes: ["core"], links: [] });
  assert.equal(result.reachable.size, 0);
  assert.deepEqual(result.isolated, ["dist", "access", "spare"]);
});

test("an unset root list falls back to the first node", () => {
  const graph = { ...chain(), roots: [] };
  assert.deepEqual(effectiveRoots(graph), ["core"]);
  // A root id left behind by a deleted node falls back the same way.
  assert.deepEqual(effectiveRoots({ ...chain(), roots: ["ghost"] }), ["core"]);
  assert.deepEqual(effectiveRoots({ nodes: [], links: [], notes: [], roots: [] }), []);
});

test("self-links and dangling endpoints never make a node look connected", () => {
  const graph: NetworkGraph = {
    nodes: ["a", "b"].map(node),
    links: [link("loop", "b", "b"), link("ghost", "a", "missing")],
    roots: ["a"],
    notes: [],
  };
  assert.deepEqual(analyzeWhatIf(graph, { nodes: [], links: [] }).isolated, ["b"]);
  assert.deepEqual(
    findStrandedNodes(graph).map((entry) => entry.id),
    ["a", "b"],
  );
});

test("weak points do not count nodes that were already unreachable", () => {
  const graph: NetworkGraph = {
    nodes: ["core", "edge", "island"].map(node),
    links: [link("uplink", "core", "edge")],
    roots: ["core"],
    notes: [],
  };
  assert.deepEqual(findWeakPoints(graph), [
    { kind: "node", id: "core", isolates: 1 },
    { kind: "link", id: "uplink", isolates: 1 },
  ]);
});

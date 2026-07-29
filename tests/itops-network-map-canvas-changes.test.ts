import assert from "node:assert/strict";
import test from "node:test";
import type { NodeChange } from "@xyflow/react";

import {
  applyNetworkMapCanvasNodeChanges,
  NETWORK_NODE_MAX_HEIGHT,
  NETWORK_NODE_MAX_WIDTH,
  NETWORK_NODE_MIN_HEIGHT,
  NETWORK_NODE_MIN_WIDTH,
  parseNetworkMapDimensionDraft,
} from "../src/modules/itops/networkMapCanvasChanges.ts";
import type { NetworkGraph } from "../src/types.ts";

function graphFixture(): NetworkGraph {
  return {
    nodes: [
      {
        id: "node-a",
        label: "A",
        kind: "router",
        x: 10,
        y: 20,
        width: 156,
        height: 52,
        interfaces: [],
        status: "up",
        note: "",
      },
    ],
    notes: [
      {
        id: "note-a",
        text: "Note",
        x: 30,
        y: 40,
        width: 240,
        height: 130,
        backgroundAccent: 0,
      },
    ],
    links: [],
    roots: [],
  };
}

test("passive React Flow measurements do not rewrite the controlled graph", () => {
  const graph = graphFixture();
  const result = applyNetworkMapCanvasNodeChanges(graph, [
    {
      id: "node-a",
      type: "dimensions",
      dimensions: { width: 223, height: 53 },
    },
  ] satisfies NodeChange[]);

  assert.equal(result, graph);
  assert.equal(result.nodes[0].width, 156);
  assert.equal(result.nodes[0].height, 52);
});

test("active resize changes update dimensions immediately and preserve safe bounds", () => {
  const graph = graphFixture();
  const during = applyNetworkMapCanvasNodeChanges(graph, [
    {
      id: "node-a",
      type: "dimensions",
      resizing: true,
      setAttributes: true,
      dimensions: { width: 190.4, height: 77.6 },
    },
  ] satisfies NodeChange[]);

  assert.equal(during.nodes[0].width, 190);
  assert.equal(during.nodes[0].height, 78);

  const bounded = applyNetworkMapCanvasNodeChanges(during, [
    {
      id: "node-a",
      type: "dimensions",
      resizing: false,
      dimensions: { width: -100, height: -24 },
    },
  ] satisfies NodeChange[]);

  assert.equal(bounded.nodes[0].width, NETWORK_NODE_MIN_WIDTH);
  assert.equal(bounded.nodes[0].height, NETWORK_NODE_MIN_HEIGHT);

  const capped = applyNetworkMapCanvasNodeChanges(during, [
    {
      id: "node-a",
      type: "dimensions",
      resizing: false,
      dimensions: { width: 2400, height: 1300 },
    },
  ] satisfies NodeChange[]);

  assert.equal(capped.nodes[0].width, NETWORK_NODE_MAX_WIDTH);
  assert.equal(capped.nodes[0].height, NETWORK_NODE_MAX_HEIGHT);
});

test("geomap resize has no upper size cap", () => {
  const graph = graphFixture();
  graph.nodes[0] = {
    ...graph.nodes[0],
    kind: "geomap",
    width: 320,
    height: 190,
  };

  const resized = applyNetworkMapCanvasNodeChanges(graph, [
    {
      id: "node-a",
      type: "dimensions",
      resizing: true,
      setAttributes: true,
      dimensions: { width: 2400.4, height: 1300.6 },
    },
  ] satisfies NodeChange[]);

  assert.equal(resized.nodes[0].width, 2400);
  assert.equal(resized.nodes[0].height, 1301);
});

test("geomap size fields preserve partial drafts and commit complete values", () => {
  assert.equal(parseNetworkMapDimensionDraft("8", NETWORK_NODE_MIN_WIDTH), null);
  assert.equal(parseNetworkMapDimensionDraft("80", NETWORK_NODE_MIN_WIDTH), null);
  assert.equal(parseNetworkMapDimensionDraft("800", NETWORK_NODE_MIN_WIDTH), 800);
  assert.equal(parseNetworkMapDimensionDraft("8000", NETWORK_NODE_MIN_WIDTH), 8000);
  assert.equal(parseNetworkMapDimensionDraft("", NETWORK_NODE_MIN_WIDTH), null);
});

test("drag positions update without rewriting unchanged entities", () => {
  const graph = graphFixture();
  const moved = applyNetworkMapCanvasNodeChanges(graph, [
    {
      id: "node-a",
      type: "position",
      position: { x: 44.4, y: 55.6 },
      dragging: true,
    },
  ] satisfies NodeChange[]);

  assert.notEqual(moved, graph);
  assert.equal(moved.nodes[0].x, 44);
  assert.equal(moved.nodes[0].y, 56);
  assert.equal(moved.notes, graph.notes);
});

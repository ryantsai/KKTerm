import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@xyflow/react";

import { reconcileNetworkMapFlowNodes } from "../src/modules/itops/networkMapFlowNodes.ts";

type TestData = Record<string, unknown>;

function flowNode(id: string, x: number, label: string): Node<TestData> {
  return {
    id,
    type: "networkNode",
    position: { x, y: 20 },
    width: 156,
    height: 52,
    data: { label },
  };
}

test("drag reconciliation preserves untouched React Flow node identities", () => {
  const previous = [
    flowNode("moving", 10, "Moving"),
    flowNode("untouched", 200, "Untouched"),
  ];
  const next = [
    flowNode("moving", 40, "Moving"),
    flowNode("untouched", 200, "Untouched"),
  ];

  const reconciled = reconcileNetworkMapFlowNodes(previous, next);

  assert.equal(reconciled[0], next[0]);
  assert.equal(reconciled[1], previous[1]);
});

test("reconciliation does not reuse a node whose rendered data changed", () => {
  const previous = [flowNode("node-a", 10, "Before")];
  const next = [flowNode("node-a", 10, "After")];

  const reconciled = reconcileNetworkMapFlowNodes(previous, next);

  assert.equal(reconciled[0], next[0]);
});

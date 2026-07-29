import assert from "node:assert/strict";
import test from "node:test";

import {
  selectionForNetworkMapContextMenu,
  toggleNetworkMapCanvasSelection,
  type NetworkMapCanvasSelectionItem,
} from "../src/modules/itops/networkMapSelection.ts";

const node: NetworkMapCanvasSelectionItem = { kind: "node", id: "node-a" };
const note: NetworkMapCanvasSelectionItem = { kind: "note", id: "note-a" };

test("plain click replaces selection while modifier click toggles members", () => {
  assert.deepEqual(toggleNetworkMapCanvasSelection([note], node, false), [node]);
  assert.deepEqual(toggleNetworkMapCanvasSelection([node], note, true), [node, note]);
  assert.deepEqual(toggleNetworkMapCanvasSelection([node, note], node, true), [note]);
});

test("right-click preserves a multi-selection only for one of its members", () => {
  const selected = [node, note];
  assert.deepEqual(selectionForNetworkMapContextMenu(selected, note), selected);
  assert.deepEqual(
    selectionForNetworkMapContextMenu(selected, { kind: "node", id: "node-b" }),
    [{ kind: "node", id: "node-b" }],
  );
});

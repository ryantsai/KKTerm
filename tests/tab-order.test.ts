import assert from "node:assert/strict";
import test from "node:test";
import { reorderWorkspaceTabs } from "../src/modules/workspace/tabOrder";
import type { WorkspaceTab } from "../src/types";

function tab(id: string, workspaceId?: string): WorkspaceTab {
  return {
    id,
    workspaceId,
    title: id,
    subtitle: "",
    kind: "terminal",
    panes: [],
  };
}

test("dragging a Tab right places it at the drop target's position", () => {
  assert.deepEqual(
    reorderWorkspaceTabs([tab("a"), tab("b"), tab("c")], "a", "c").map((t) => t.id),
    ["b", "c", "a"],
  );
});

test("dragging a Tab left places it at the drop target's position", () => {
  assert.deepEqual(
    reorderWorkspaceTabs([tab("a"), tab("b"), tab("c")], "c", "a").map((t) => t.id),
    ["c", "a", "b"],
  );
});

test("dragging onto an adjacent Tab swaps the pair", () => {
  assert.deepEqual(
    reorderWorkspaceTabs([tab("a"), tab("b")], "a", "b").map((t) => t.id),
    ["b", "a"],
  );
  assert.deepEqual(
    reorderWorkspaceTabs([tab("a"), tab("b")], "b", "a").map((t) => t.id),
    ["b", "a"],
  );
});

test("dropping a Tab on itself or unknown ids is a no-op", () => {
  const original = [tab("a"), tab("b")];
  assert.equal(reorderWorkspaceTabs(original, "a", "a"), original);
  assert.equal(reorderWorkspaceTabs(original, "missing", "a"), original);
  assert.equal(reorderWorkspaceTabs(original, "a", "missing"), original);
});

test("Tabs cannot be dragged across Workspaces", () => {
  const original = [tab("a", "w1"), tab("b", "w2")];
  assert.equal(reorderWorkspaceTabs(original, "b", "a"), original);
});

test("reordering keeps other Workspaces' Tabs in their relative order", () => {
  const tabs = [tab("a", "w1"), tab("x", "w2"), tab("b", "w1"), tab("y", "w2")];
  const reordered = reorderWorkspaceTabs(tabs, "b", "a");
  assert.deepEqual(
    reordered.map((t) => `${t.workspaceId}:${t.id}`),
    ["w1:b", "w1:a", "w2:x", "w2:y"],
  );
});

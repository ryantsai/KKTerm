import assert from "node:assert/strict";
import test from "node:test";
import { terminalAttentionTargets, useTerminalAttentionStore } from "../src/modules/workspace/terminalAttentionState";
import type { WorkspaceTab } from "../src/types";

test("focused bells are ignored; background bells deduplicate without dropping other Sessions", () => {
  useTerminalAttentionStore.setState({ pending: {} });
  const { ring, clear } = useTerminalAttentionStore.getState();
  ring("a", "session-a", true);
  assert.deepEqual(useTerminalAttentionStore.getState().pending, {});
  ring("a", "session-a", false);
  const first = useTerminalAttentionStore.getState().pending;
  ring("a", "session-a", false);
  assert.equal(useTerminalAttentionStore.getState().pending, first);
  ring("b", "session-b", false);
  clear("a");
  assert.deepEqual(useTerminalAttentionStore.getState().pending, { b: "session-b" });
  ring("a", "session-a", false);
  assert.deepEqual(Object.keys(useTerminalAttentionStore.getState().pending), ["b", "a"]);
});

test("old Session teardown cannot clear a replacement Session's bell", () => {
  useTerminalAttentionStore.setState({ pending: {} });
  const { ring, clear } = useTerminalAttentionStore.getState();
  ring("a", "old", false);
  ring("a", "new", false);
  clear("a", "old");
  assert.deepEqual(useTerminalAttentionStore.getState().pending, { a: "new" });
  clear("a", "new");
  assert.deepEqual(useTerminalAttentionStore.getState().pending, {});
});

test("attention follows a moved Pane across Tabs and Workspaces and excludes closed or nonterminal Panes", () => {
  const makeTab = (id: string, workspaceId: string, paneId: string): WorkspaceTab => ({
    id, workspaceId, title: id, subtitle: "", kind: "terminal",
    panes: [{ id: paneId, title: paneId, cwd: "", buffer: "" }],
  });
  const pending = { a: "session-a", b: "session-b", closed: "ended" };
  const tabs = [makeTab("one", "work", "a"), makeTab("two", "personal", "b")];
  assert.deepEqual(terminalAttentionTargets(tabs, pending).map(({ tab, pane }) => [tab.id, pane.id]),
    [["one", "a"], ["two", "b"]]);
  const moved = makeTab("three", "another", "a");
  assert.equal(terminalAttentionTargets([moved], pending)[0].tab.workspaceId, "another");
  assert.deepEqual(terminalAttentionTargets([], pending), []);
  const documentTab = { ...moved, panes: [{ id: "a", kind: "fileViewer" }] } as WorkspaceTab;
  assert.deepEqual(terminalAttentionTargets([documentTab], pending), []);
});

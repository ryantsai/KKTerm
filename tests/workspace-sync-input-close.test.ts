import assert from "node:assert/strict";
import test from "node:test";
import { useWorkspaceStore } from "../src/store";
import {
  preserveTerminalPaneRuntime,
  shouldPreservePaneRuntimeOnUnmount,
  takePreservedTerminalPaneRuntime,
} from "../src/modules/workspace/paneRegistry";
import type { WorkspacePane, WorkspaceTab } from "../src/types";

const terminalPane = (id: string, childConnectionId?: string): WorkspacePane => ({
  id,
  childConnectionId,
  title: id,
  cwd: "",
  buffer: "",
});

const terminalTab = (
  id: string,
  panes: WorkspacePane[],
  options: Partial<WorkspaceTab> = {},
): WorkspaceTab => ({
  id,
  title: id,
  subtitle: "",
  kind: "terminal",
  panes,
  focusedPaneId: panes[0]?.id,
  ...options,
});

test("closing any terminal Pane turns off synchronized input", () => {
  const store = useWorkspaceStore;

  store.setState({
    tabs: [terminalTab("tab-pane", [terminalPane("pane-a"), terminalPane("pane-b")])],
    activeTabId: "tab-pane",
    syncInputEnabled: true,
  });
  store.getState().closePane("tab-pane", "pane-a");
  assert.equal(store.getState().syncInputEnabled, false);

  store.setState({
    tabs: [terminalTab("tab-close", [terminalPane("pane-close")])],
    activeTabId: "tab-close",
    syncInputEnabled: true,
  });
  store.getState().closeTab("tab-close");
  assert.equal(store.getState().syncInputEnabled, false);

  store.setState({
    tabs: [
      terminalTab("tab-child", [terminalPane("pane-child", "child-1")], {
        childConnectionId: "child-1",
      }),
    ],
    activeTabId: "tab-child",
    syncInputEnabled: true,
  });
  store.getState().closeChildConnection("child-1");
  assert.equal(store.getState().syncInputEnabled, false);

  store.setState({
    tabs: [
      terminalTab("tab-workspace", [terminalPane("pane-workspace")], {
        workspaceId: "workspace-1",
      }),
    ],
    activeTabId: "tab-workspace",
    activeWorkspaceId: "workspace-1",
    syncInputEnabled: true,
  });
  store.getState().closeWorkspaceTabs("workspace-1");
  assert.equal(store.getState().syncInputEnabled, false);

  store.setState({
    tabs: [terminalTab("tab-all", [terminalPane("pane-all")])],
    activeTabId: "tab-all",
    syncInputEnabled: true,
  });
  store.getState().closeAllTabs();
  assert.equal(store.getState().syncInputEnabled, false);
});

test("closing a non-terminal Pane leaves synchronized input enabled", () => {
  const nonTerminalTab: WorkspaceTab = {
    id: "tab-files",
    title: "Files",
    subtitle: "",
    kind: "localFiles",
    panes: [
      {
        kind: "localFiles",
        id: "pane-files",
        title: "Files",
        connection: { id: "files", type: "localFiles", name: "Files" },
      },
    ],
  };
  useWorkspaceStore.setState({
    tabs: [nonTerminalTab],
    activeTabId: nonTerminalTab.id,
    syncInputEnabled: true,
  });

  useWorkspaceStore.getState().closeTab(nonTerminalTab.id);

  assert.equal(useWorkspaceStore.getState().syncInputEnabled, true);
  useWorkspaceStore.setState({ tabs: [], activeTabId: "", syncInputEnabled: false });
});

test("closing the second-last Child Connection preserves the remaining terminal Session through Strict Mode", async () => {
  const store = useWorkspaceStore;
  const remainingPane = terminalPane("pane-child-2", "child-2");
  store.setState({
    tabs: [
      terminalTab(
        "tab-child-layout",
        [terminalPane("pane-child-1", "child-1"), remainingPane],
        {
          childConnectionGroupParentId: "connection-1",
          focusedPaneId: "pane-child-1",
          layout: {
            type: "split",
            orientation: "horizontal",
            sizes: [0.5, 0.5],
            children: [
              { type: "leaf", paneId: "pane-child-1" },
              { type: "leaf", paneId: "pane-child-2" },
            ],
          },
        },
      ),
    ],
    activeTabId: "tab-child-layout",
    syncInputEnabled: false,
  });

  store.getState().closeChildConnection("child-1");

  const tab = store.getState().tabs[0];
  assert.deepEqual(tab?.panes.map((pane) => pane.id), ["pane-child-2"]);
  assert.equal(tab?.panes[0], remainingPane, "the surviving Pane must keep its identity");
  const runtime = {
    bufferText: "existing terminal buffer",
    sessionId: "existing-session",
    sessionStarted: true,
  };
  assert.equal(shouldPreservePaneRuntimeOnUnmount(remainingPane.id), true);
  preserveTerminalPaneRuntime(remainingPane.id, runtime);

  assert.deepEqual(
    takePreservedTerminalPaneRuntime(remainingPane.id),
    runtime,
    "the reparented Pane's first mount must take the existing Session",
  );
  assert.equal(
    shouldPreservePaneRuntimeOnUnmount(remainingPane.id),
    true,
    "Strict Mode's probe cleanup must preserve the Session for the second setup",
  );
  preserveTerminalPaneRuntime(remainingPane.id, runtime);
  assert.deepEqual(
    takePreservedTerminalPaneRuntime(remainingPane.id),
    runtime,
    "Strict Mode's second setup must reuse the same Session",
  );

  await Promise.resolve();
  assert.equal(
    shouldPreservePaneRuntimeOnUnmount(remainingPane.id),
    false,
    "the Strict Mode handoff permit must expire before a later real close",
  );
  store.setState({ tabs: [], activeTabId: "", syncInputEnabled: false });
});

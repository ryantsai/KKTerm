import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "../src/store";
import { shouldPreservePaneRuntimeOnUnmount } from "../src/modules/workspace/paneRegistry";
import type {
  Connection,
  LayoutNode,
  WorkspaceChildConnection,
  WorkspaceTab,
} from "../src/types";

const parentConnection: Connection = {
  id: "parent-ssh",
  name: "Parent SSH",
  host: "example.com",
  user: "operator",
  type: "ssh",
  status: "idle",
};

const children: WorkspaceChildConnection[] = Array.from(
  { length: 4 },
  (_, index) => ({
    id: `child-${index + 1}`,
    parentConnectionId: parentConnection.id,
    workspaceId: DEFAULT_WORKSPACE_ID,
    name: `Child ${index + 1}`,
    cwd: "~",
    tmuxSessionId: `tmux-${index + 1}`,
  }),
);

const additionalChild: WorkspaceChildConnection = {
  id: "child-5",
  parentConnectionId: parentConnection.id,
  workspaceId: DEFAULT_WORKSPACE_ID,
  name: "Child 5",
  cwd: "~",
  tmuxSessionId: "tmux-5",
};

function panePath(layout: LayoutNode | undefined, paneId: string): string | undefined {
  if (!layout) {
    return undefined;
  }
  if (layout.type === "leaf") {
    return layout.paneId === paneId ? "leaf" : undefined;
  }
  for (let index = 0; index < layout.children.length; index += 1) {
    const childPath = panePath(layout.children[index], paneId);
    if (childPath) {
      return `${layout.orientation}:${index}/${childPath}`;
    }
  }
  return undefined;
}

function parentGroupTab(): WorkspaceTab {
  const tabs = useWorkspaceStore.getState().tabs;
  assert.equal(tabs.length, 1, "all live children must share one canonical parent Tab");
  const tab = tabs[0];
  assert.equal(tab.childConnectionGroupParentId, parentConnection.id);
  return tab;
}

test("Child Connection activation and parent panorama keep one stable live owner", () => {
  const initialGeneralSettings = useWorkspaceStore.getState().generalSettings;
  useWorkspaceStore.setState({
    tabs: [],
    activeTabId: "",
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    activeSessionCounts: {},
    generalSettings: {
      ...initialGeneralSettings,
      hideTopTabButtons: true,
    },
  });

  let groupTabId = "";
  let firstPaneId = "";
  let firstPanePath = "";

  for (const [index, child] of children.entries()) {
    useWorkspaceStore.getState().openChildConnection(parentConnection, child);
    const tab = parentGroupTab();
    const pane = tab.panes.find((entry) => entry.childConnectionId === child.id);
    assert.ok(pane, `opening ${child.id} must add it to the parent group`);
    assert.equal(tab.maximizedPaneId, pane.id, "the selected child should be the full-size Pane");

    if (index === 0) {
      groupTabId = tab.id;
      firstPaneId = pane.id;
      firstPanePath = panePath(tab.layout, pane.id) ?? "";
      assert.ok(firstPanePath, "the first child must have a stable layout path");
    } else {
      assert.equal(tab.id, groupTabId, "opening another child must reuse the parent group Tab");
      assert.equal(
        panePath(tab.layout, firstPaneId),
        firstPanePath,
        "adding children must not reparent an existing live Pane",
      );
    }
    assert.equal(
      shouldPreservePaneRuntimeOnUnmount(firstPaneId),
      false,
      "canonical group updates must not require a runtime transfer",
    );
  }

  const paneIdsBeforePanorama = parentGroupTab().panes.map((pane) => pane.id);
  useWorkspaceStore.getState().openChildConnectionLayout(parentConnection, children);
  const panoramaTab = parentGroupTab();

  assert.equal(panoramaTab.id, groupTabId);
  assert.deepEqual(panoramaTab.panes.map((pane) => pane.id), paneIdsBeforePanorama);
  assert.equal(panoramaTab.maximizedPaneId, undefined, "the parent should reveal the panorama");
  assert.equal(
    panePath(panoramaTab.layout, firstPaneId),
    firstPanePath,
    "switching from a child to its parent panorama must not reparent live Panes",
  );
  for (const paneId of paneIdsBeforePanorama) {
    assert.equal(
      shouldPreservePaneRuntimeOnUnmount(paneId),
      false,
      "parent panorama activation must not unmount or transfer live terminal runtimes",
    );
  }

  for (const child of children) {
    const childPane = parentGroupTab().panes.find(
      (pane) => pane.childConnectionId === child.id,
    );
    assert.ok(childPane);
    useWorkspaceStore.getState().maximizeChildConnectionPane(groupTabId, childPane.id);
    assert.equal(parentGroupTab().maximizedPaneId, childPane.id);

    useWorkspaceStore.getState().openChildConnectionLayout(parentConnection, children);
    const nextPanorama = parentGroupTab();
    assert.equal(nextPanorama.id, groupTabId);
    assert.deepEqual(nextPanorama.panes.map((pane) => pane.id), paneIdsBeforePanorama);
    assert.equal(nextPanorama.maximizedPaneId, undefined);
    assert.equal(panePath(nextPanorama.layout, firstPaneId), firstPanePath);
  }

  for (const child of children.slice(1).reverse()) {
    useWorkspaceStore.getState().closeChildConnection(child.id);
    const remainingTab = parentGroupTab();
    assert.equal(remainingTab.id, groupTabId);
    assert.equal(panePath(remainingTab.layout, firstPaneId), firstPanePath);
    assert.equal(
      shouldPreservePaneRuntimeOnUnmount(firstPaneId),
      false,
      "closing siblings must keep the surviving renderer mounted",
    );
  }
  assert.deepEqual(
    parentGroupTab().panes.map((pane) => pane.childConnectionId),
    [children[0].id],
  );

  useWorkspaceStore.getState().closeChildConnection(children[0].id);
  assert.equal(useWorkspaceStore.getState().tabs.length, 0);
  assert.equal(
    shouldPreservePaneRuntimeOnUnmount(firstPaneId),
    false,
    "closing the final child must perform a real Session teardown",
  );

  useWorkspaceStore.getState().openChildConnectionLayout(parentConnection, children);
  const initialPanorama = parentGroupTab();
  const initialPanePaths = new Map(
    initialPanorama.panes.map((pane) => [
      pane.id,
      panePath(initialPanorama.layout, pane.id),
    ]),
  );

  useWorkspaceStore.getState().openChildConnection(parentConnection, additionalChild);
  const expandedPanorama = parentGroupTab();
  assert.equal(
    expandedPanorama.id,
    initialPanorama.id,
    "adding to an initially balanced panorama must keep its Tab owner",
  );
  for (const [paneId, path] of initialPanePaths) {
    assert.equal(
      panePath(expandedPanorama.layout, paneId),
      path,
      "adding to an initially balanced panorama must not reparent mounted Panes",
    );
    assert.equal(shouldPreservePaneRuntimeOnUnmount(paneId), false);
  }

  useWorkspaceStore.setState({
    tabs: [],
    activeTabId: "",
    activeSessionCounts: {},
    generalSettings: initialGeneralSettings,
  });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import { defaultRdpSettings } from "../src/app-defaults";
import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "../src/store";
import { serializeLayout } from "../src/modules/workspace/layout";
import type { Connection, RemoteDesktopPane } from "../src/types";

const connection: Connection = {
  id: "startup-rdp",
  name: "Remote desktop",
  host: "example.test",
  user: "operator",
  type: "rdp",
  status: "idle",
};

beforeEach(() => {
  useWorkspaceStore.setState({
    tabs: [],
    activeTabId: "",
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    activeSessionCounts: {},
    rdpSettings: { ...defaultRdpSettings },
  });
});

function pane(): RemoteDesktopPane {
  const state = useWorkspaceStore.getState();
  const tab = state.tabs.find((entry) => entry.id === state.activeTabId)!;
  const result = tab.panes.find((entry) => entry.id === tab.focusedPaneId)!;
  assert.equal(result.kind, "remoteDesktop");
  return result as RemoteDesktopPane;
}

function enableDefault() {
  useWorkspaceStore.getState().setRdpSettings({ ...defaultRdpSettings, openInFullscreen: true });
}

test("startup full screen is off for existing settings and ordinary opens", () => {
  assert.equal(defaultRdpSettings.openInFullscreen, false);
  useWorkspaceStore.getState().openConnection(connection);
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(pane().id), false);
});

test("the global default follows the whole RDP inheritance group", () => {
  enableDefault();
  useWorkspaceStore.getState().openConnection({
    ...connection,
    rdpOptions: { inheritDefaults: true, openInFullscreen: false },
  });
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(pane().id), true);
});

test("a customized Connection can opt in or opt out without a three-way setting", () => {
  useWorkspaceStore.getState().openConnection({
    ...connection,
    rdpOptions: { inheritDefaults: false, openInFullscreen: true },
  });
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(pane().id), true);
  enableDefault();
  useWorkspaceStore.getState().openConnectionInNewTab({
    ...connection,
    rdpOptions: { inheritDefaults: false, openInFullscreen: false },
  });
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(pane().id), false);
});

test("legacy customized Connections stay off even when the global default is on", () => {
  enableDefault();
  useWorkspaceStore.getState().openConnection({
    ...connection,
    rdpOptions: { inheritDefaults: false },
  });
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(pane().id), false);
});

test("a ready session consumes its launch intent exactly once and reactivation does not re-arm", () => {
  enableDefault();
  useWorkspaceStore.getState().openConnection(connection);
  const first = pane();
  const tab = useWorkspaceStore.getState().tabs[0];
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(first.id), true);
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(first.id), false);
  useWorkspaceStore.getState().openConnection(connection);
  useWorkspaceStore.getState().activateTab(tab.id);
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(first.id), false);
  assert.equal(useWorkspaceStore.getState().tabs.length, 1);
  assert.equal(useWorkspaceStore.getState().tabs[0].layout, tab.layout);
  assert.equal(useWorkspaceStore.getState().tabs[0].focusedPaneId, first.id);
});

test("saving global and Connection preferences does not arm an existing session", () => {
  useWorkspaceStore.getState().openConnection(connection);
  const first = pane();
  enableDefault();
  useWorkspaceStore.getState().refreshOpenConnectionMetadata({
    ...connection,
    rdpOptions: { inheritDefaults: false, openInFullscreen: true },
  });
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(first.id), false);
  useWorkspaceStore.getState().openConnectionInNewTab(connection);
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(pane().id), true);
});

test("launch intent is a snapshot, not a reactive preference", () => {
  enableDefault();
  useWorkspaceStore.getState().openConnection(connection);
  const first = pane();
  useWorkspaceStore.getState().setRdpSettings({ ...defaultRdpSettings, openInFullscreen: false });
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(first.id), true);
});

test("a background session consumes without entering and cannot enter on later activation", () => {
  enableDefault();
  useWorkspaceStore.getState().openConnection(connection);
  const first = pane();
  const firstTabId = useWorkspaceStore.getState().activeTabId;
  useWorkspaceStore.getState().openConnection({ ...connection, id: "other-rdp" });
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(first.id), false);
  useWorkspaceStore.getState().activateTab(firstTabId);
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(first.id), false);
});

test("leaving and returning before the lazy surface mounts still cancels startup", () => {
  enableDefault();
  useWorkspaceStore.getState().openConnection(connection);
  const first = pane();
  const firstTabId = useWorkspaceStore.getState().activeTabId;
  useWorkspaceStore.getState().openConnection({ ...connection, id: "other-rdp" });
  useWorkspaceStore.getState().activateTab(firstTabId);
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(first.id), false);
});

test("an unfocused Pane or a different Workspace cannot enter full screen", () => {
  enableDefault();
  useWorkspaceStore.getState().openConnection(connection);
  const first = pane();
  useWorkspaceStore.setState({ activeWorkspaceId: "other-workspace" });
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(first.id), false);
  useWorkspaceStore.setState({ activeWorkspaceId: DEFAULT_WORKSPACE_ID });
  useWorkspaceStore.getState().openConnectionInNewTab(connection);
  const next = pane();
  useWorkspaceStore.setState((state) => ({
    tabs: state.tabs.map((tab) => ({ ...tab, focusedPaneId: "other-pane" })),
  }));
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(next.id), false);
});

test("batch opens, panorama/restored layout data and VNC never acquire startup intent", () => {
  enableDefault();
  useWorkspaceStore.getState().openConnection(connection, { allowRdpStartupFullscreen: false });
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(pane().id), false);
  useWorkspaceStore.getState().openConnectionsInPanorama([
    { ...connection, id: "panorama-a" },
    { ...connection, id: "panorama-b" },
  ]);
  const panorama = useWorkspaceStore.getState().tabs.at(-1)!;
  for (const entry of panorama.panes) {
    assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(entry.id), false);
  }
  useWorkspaceStore.getState().openConnectionInNewTab(connection);
  const tab = useWorkspaceStore.getState().tabs.at(-1)!;
  assert.equal(pane().rdpStartupFullscreen, true);
  assert.equal(JSON.stringify(serializeLayout(tab.layout!, tab.panes)).includes("rdpStartupFullscreen"), false);
  useWorkspaceStore.getState().openConnection({ ...connection, id: "vnc", type: "vnc" });
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(pane().id), false);
});

test("closing and explicitly opening again creates a fresh single-use intent", () => {
  enableDefault();
  useWorkspaceStore.getState().openConnection(connection);
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(pane().id), true);
  useWorkspaceStore.getState().closeTab(useWorkspaceStore.getState().activeTabId);
  useWorkspaceStore.getState().openConnection(connection);
  assert.equal(useWorkspaceStore.getState().consumeRdpStartupFullscreen(pane().id), true);
});

test("platform readiness hooks reuse the existing full-screen entry and cancel on reconnect", async () => {
  const source = await readFile(new URL(
    "../src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx", import.meta.url,
  ), "utf8");
  assert.match(source, /const handleRdpCanvasConnected[\s\S]*?markRdpConnectionStarted\(\);\s*tryOpenRdpStartupFullscreen\(sessionId\);/);
  assert.match(source, /invokeCommand\("set_rdp_visibility"[\s\S]*?\.then\(\(\) => \{[\s\S]*?if \(visible\) \{[\s\S]*?tryOpenRdpStartupFullscreen\(sessionId\);/);
  assert.match(source, /const handleReconnect = async \(\) => \{\s*useWorkspaceStore.getState\(\).consumeRdpStartupFullscreen\(tab.id\);/);
  assert.match(source, /const openFullscreen = \(\) => \{[\s\S]*?consumeRdpStartupFullscreen\(tab.id\);/);
  assert.match(source, /rdpConnectedRef.current = result.connectionState === RDP_CONNECTED_STATE/);
  assert.match(source, /canStartRdp && \(!rdpConnectedRef.current \|\| !rdpVisibleRef.current\)/);
  assert.match(source, /invokeCommand\("get_rdp_session_status"[\s\S]*?if \(status.connected\) \{\s*tryOpenRdpStartupFullscreen/);
  assert.match(source, /const tryOpenRdpStartupFullscreen[\s\S]*?documentHasRdpBlockingOverlay[\s\S]*?openFullscreenRef.current\(\);/);
});

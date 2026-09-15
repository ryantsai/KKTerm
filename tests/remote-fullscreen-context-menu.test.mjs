import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findRemoteDesktopSurface,
  isRemoteFullscreenSurfaceReady,
  registerRemoteFullscreenSurface,
} from "../src/modules/workspace/connections/remote-desktop/remoteFullscreenRequest.ts";

function remoteTab(id, connectionId, type = "vnc") {
  const connection = { id: connectionId, type };
  return {
    id,
    title: id,
    subtitle: "",
    kind: "remoteDesktop",
    panes: [{ id, kind: "remoteDesktop", title: id, connection }],
    connection,
  };
}

test("remote full-screen menu targeting prefers the right-clicked Tab", () => {
  const tabs = [remoteTab("tab-a", "connection-1"), remoteTab("tab-b", "connection-1")];
  assert.deepEqual(findRemoteDesktopSurface(tabs, "connection-1", "tab-b"), {
    paneId: "tab-b",
    surfaceId: "tab-b",
    tabId: "tab-b",
  });
});

test("remote full-screen menu targeting selects the focused remote Pane", () => {
  const connection = { id: "connection-1", type: "rdp" };
  const tabs = [
    {
      id: "panorama",
      title: "panorama",
      subtitle: "",
      kind: "terminal",
      focusedPaneId: "remote-pane",
      panes: [
        { id: "terminal-pane", kind: "terminal", title: "shell", connection: { id: "shell", type: "ssh" } },
        { id: "remote-pane", kind: "remoteDesktop", title: "rdp", connection },
      ],
    },
  ];

  assert.deepEqual(findRemoteDesktopSurface(tabs, "connection-1"), {
    paneId: "remote-pane",
    surfaceId: "remote-pane",
    tabId: "panorama",
  });
});

test("remote full-screen menu readiness follows the exact live surface", () => {
  let ready = false;
  const unregister = registerRemoteFullscreenSurface("surface-a", () => ready);
  assert.equal(isRemoteFullscreenSurfaceReady("surface-a"), false);
  ready = true;
  assert.equal(isRemoteFullscreenSurfaceReady("surface-a"), true);
  assert.equal(isRemoteFullscreenSurfaceReady("surface-b"), false);
  unregister();
  assert.equal(isRemoteFullscreenSurfaceReady("surface-a"), false);
});

test("Activity Rail, Connection Tree, and Tab menus route to live remote full screen", async () => {
  const [rail, sidebar, tabs, workspace] = await Promise.all([
    readFile(new URL("../src/app/ActivityRail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/workspace/connections/connectionTabContextMenu.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/workspace/WorkspaceCanvas.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(rail, /label: t\("workspace\.newTab"\)[\s\S]*label: t\("remoteDesktop\.fullscreen\.enter"\)/);
  assert.match(sidebar, /label: t\("workspace\.newTab"\)[\s\S]*label: t\("remoteDesktop\.fullscreen\.enter"\)/);
  assert.match(sidebar, /action: \(\) => handleTreeMenuOpenFullscreen\(menu\)/);
  assert.match(tabs, /tabId: string/);
  assert.match(workspace, /tabId: tab\.id/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("folder bulk-open reuses Connections that are already open in a Tab or Pane", async () => {
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    sidebarSource,
    /function findOpenTabForConnection\(connectionId: string\)[\s\S]*?tab\.connection\?\.id === connectionId[\s\S]*?pane\.connection\?\.id === connectionId/,
    "bulk-open should recognize both Tab-owned and Pane-owned live Connections",
  );
  assert.match(
    sidebarSource,
    /openConnectionPanorama\(folderConnections, menu\.folder\.name\)[\s\S]*?function openConnectionPanorama\(connections: Connection\[\], title: string\)[\s\S]*?unopenedPanoramaConnections\([\s\S]*?findOpenTabForConnection\(connectionId\)[\s\S]*?openResolvedConnectionPanorama\(connectionIds, title\)[\s\S]*?openConnectionsInPanorama\(unopenedConnections/,
    "Panorama bulk-open should only create Panes for Connections that are not already open",
  );
  assert.match(
    sidebarSource,
    /const existingTab = findOpenTabForConnection\(connection\.id\);[\s\S]*?activateTab\(existingTab\.id\)[\s\S]*?openConnection\(connection, \{ allowRdpStartupFullscreen: false \}\)/,
    "separate-Tab bulk-open should activate an existing Session instead of reconnecting",
  );
});

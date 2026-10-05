import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("forced startup display settling still resizes the remote desktop in native fullscreen", async () => {
  const source = await readFile(new URL("../src-tauri/src/rdp.rs", import.meta.url), "utf8");
  const updateBounds = source.slice(source.indexOf("pub fn update_bounds("), source.indexOf("pub fn set_visibility("));
  const fullscreenBranch = updateBounds.match(/if native_fullscreen \{([\s\S]*?)return Ok\(\(\)\);/)?.[1];
  assert.ok(fullscreenBranch);
  assert.match(fullscreenBranch, /if request\.force/);
  assert.match(fullscreenBranch, /fullscreen_monitor_geometry\(session\)/);
  assert.match(fullscreenBranch, /fullscreen_display_settings\(session, &monitor_rect, monitor_scale\)/);
  assert.match(fullscreenBranch, /sync_remote_desktop_size\(session, display_settings, true\)/);
  assert.doesNotMatch(fullscreenBranch, /show_and_resize_rdp|stage_rdp|SetWindowPos/,
    "settling must preserve the fullscreen host and pending windowed restore geometry");
});

test("RDP dynamic display sync does not fall back to ActiveX Reconnect", async () => {
  const rdpSource = await readFile(new URL("../src-tauri/src/rdp.rs", import.meta.url), "utf8");
  const resizeFunction = rdpSource.match(
    /fn resize_remote_desktop\([\s\S]*?\n    fn show_rdp\(/,
  )?.[0];

  assert.ok(resizeFunction, "resize_remote_desktop function should exist");
  assert.match(
    resizeFunction,
    /UpdateSessionDisplaySettings/,
    "dynamic display sync should use UpdateSessionDisplaySettings",
  );
  assert.doesNotMatch(
    resizeFunction,
    /"Reconnect"/,
    "dynamic display sync must retry UpdateSessionDisplaySettings instead of reconnecting the ActiveX session",
  );
});

test("remote desktop runtime session ids stay within backend limits", async () => {
  const remoteDesktopSource = await readFile(
    new URL("../src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(remoteDesktopSource, /function createRemoteDesktopSessionId/);
  assert.match(remoteDesktopSource, /createRemoteDesktopSessionId\("rdp"\)/);
  assert.match(remoteDesktopSource, /createRemoteDesktopSessionId\("vnc"\)/);
  assert.doesNotMatch(
    remoteDesktopSource,
    /`(?:rdp|vnc)-\$\{tab\.id\}/,
    "backend session ids should not include variable-length tab ids",
  );
});

test("RDP display resize debug events include connection state", async () => {
  const rdpSource = await readFile(new URL("../src-tauri/src/rdp.rs", import.meta.url), "utf8");
  const syncFunction = rdpSource.match(
    /fn sync_remote_desktop_size\([\s\S]*?\n    #\[allow\(clippy::too_many_arguments\)\]/,
  )?.[0];

  assert.ok(syncFunction, "sync_remote_desktop_size function should exist");
  for (const eventName of [
    "display.resize.skipped",
    "display.resize.error",
    "display.resize.recovered",
    "display.resize.ok",
  ]) {
    const eventIndex = syncFunction.indexOf(`"${eventName}"`);
    assert.notEqual(eventIndex, -1, `${eventName} should be logged`);
    const eventBlock = syncFunction.slice(eventIndex, syncFunction.indexOf("}),", eventIndex));
    assert.match(eventBlock, /"connectionState": connection_state/);
    assert.match(eventBlock, /"connectionStateLabel": rdp_connection_state_label\(connection_state\)/);
  }
});

test("RDP sizing emits correlated frontend and native geometry to the UI debug log", async () => {
  const rdpSource = await readFile(new URL("../src-tauri/src/rdp.rs", import.meta.url), "utf8");
  const remoteDesktopSource = await readFile(
    new URL("../src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(remoteDesktopSource, /logUiDebug\("rdp\.geometry\.frontend"/);
  assert.match(remoteDesktopSource, /devicePixelRatio/);
  assert.match(remoteDesktopSource, /getBoundingClientRect/);
  assert.match(rdpSource, /ui_debug\(\s*"rdp\.geometry\.native"/);
  assert.match(rdpSource, /GetWindowRect/);
  assert.match(rdpSource, /GetClientRect/);
  assert.match(rdpSource, /actualObjectWindow/);
});

test("embedded RDP bounds shrink and clip to the owning Panorama pane", async () => {
  const remoteDesktopSource = await readFile(
    new URL("../src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const terminalCss = await readFile(
    new URL("../src/modules/workspace/connections/terminal/terminal.css", import.meta.url),
    "utf8",
  );

  assert.match(terminalCss, /\.embedded-workspace-pane\s*>\s*\.remote-desktop-shell\s*\{[^}]*min-width:\s*0;/s);
  assert.match(remoteDesktopSource, /closest\("\.embedded-workspace-pane"\)/);
  assert.match(remoteDesktopSource, /Math\.min\(rect\.right, clipRect\.right\)/);
  assert.match(remoteDesktopSource, /Math\.max\(rect\.left, clipRect\.left\)/);
});

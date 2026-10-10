import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RDP disconnects never close a Tab, except the connection bar close button from full screen", async () => {
  const remoteDesktopSource = await readFile(
    new URL("../src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const rdpSource = await readFile(new URL("../src-tauri/src/rdp.rs", import.meta.url), "utf8");

  const pollStart = remoteDesktopSource.indexOf("if (!startupFullscreenRequested || !isTauriRuntime())");
  const pollEnd = remoteDesktopSource.indexOf("}, [canStartRdp, useRdpCanvas, startupFullscreenRequested, tab.id]);");
  assert.ok(pollStart >= 0 && pollEnd > pollStart, "startup poll must be present");
  const startupPoll = remoteDesktopSource.slice(pollStart, pollEnd);
  assert.match(startupPoll, /get_rdp_session_status/);
  assert.equal(
    remoteDesktopSource.match(/get_rdp_session_status/g)?.length,
    1,
    "only the one-shot fullscreen startup intent may poll RDP status",
  );
  assert.match(startupPoll, /if \(status.connected\) \{\s*tryOpenRdpStartupFullscreen/);
  assert.doesNotMatch(startupPoll, /closeTab|close_rdp_session|markConnectionSessionEnded/);
  assert.match(startupPoll, /window.clearInterval\(timer\)/);
  assert.doesNotMatch(
    remoteDesktopSource,
    /rdp-session-event|RdpSessionEvent|closeRdpTabAfterRemoteDisconnect/,
    "RDP workspace should not listen for the removed backend event",
  );
  assert.doesNotMatch(
    rdpSource,
    /rdp-session-event|RdpSessionEvent/,
    "RDP backend should not emit the removed frontend disconnect event",
  );
  // The removed flow closed the Tab on every OnDisconnected. The only close path
  // now is the one below, so a remote logoff, a server drop or a network error
  // keeps the disconnected Pane (with Reconnect) exactly as before.
  const disconnectArm = rdpSource.slice(
    rdpSource.indexOf("DISPID_DISCONNECTED => {"),
    rdpSource.indexOf("DISPID_REQUEST_GO_FULLSCREEN => {", rdpSource.indexOf("DISPID_DISCONNECTED => {")),
  );
  assert.match(disconnectArm, /let was_fullscreen = session\.fullscreen_restore\.is_some\(\);/);
  assert.match(disconnectArm, /restore_disconnected_fullscreen_host\(session\)/);
  assert.match(
    disconnectArm,
    /if was_fullscreen && session\.events\.local_disconnect\.load\(Ordering::Acquire\) \{\s*request_close_after_fullscreen_disconnect\(app, &session\.session_id\);/,
    "closing must require both full screen and a local (connection bar) disconnect",
  );
  assert.equal(rdpSource.match(/\.emit\(/g)?.length, 1, "the close request must have exactly one emit site");
  assert.equal(rdpSource.match(/request_close_after_fullscreen_disconnect\(/g)?.length, 2, "one definition, one caller");
  assert.match(rdpSource, /RDP_DISCONNECT_REASON_LOCAL: i32 = 1;/);
  assert.match(
    rdpSource,
    /self\.events\.local_disconnect\.store\(\s*reason == Some\(RDP_DISCONNECT_REASON_LOCAL\),/,
    "the flag must be derived from the OnDisconnected reason, not set unconditionally",
  );
  assert.match(rdpSource, /RDP_FULLSCREEN_CLOSED_EVENT: &str = "rdp-fullscreen-closed"/);

  // Frontend: one listener, scoped to its own Session, that only invokes the host's callback.
  const listenerStart = remoteDesktopSource.indexOf("listen<{ sessionId: string }>(RDP_FULLSCREEN_CLOSED_EVENT");
  assert.ok(listenerStart >= 0, "full-screen close listener must be present");
  const listener = remoteDesktopSource.slice(listenerStart, remoteDesktopSource.indexOf("}, [canStartRdp]);", listenerStart));
  assert.match(listener, /event\.payload\.sessionId === sessionIdRef\.current/);
  assert.match(listener, /fullscreenCloseRef\.current\?\.\(\)/);
  assert.doesNotMatch(listener, /closeTab|closePane|close_rdp_session|markConnectionSessionEnded/);
  assert.equal(remoteDesktopSource.match(/RDP_FULLSCREEN_CLOSED_EVENT/g)?.length, 2, "constant plus its one listener");

  // Hosts. A connection opened from the Connection Tree is an embedded Pane in a terminal Tab, so
  // that host must always supply the callback. `canClosePane` only decides whether the Pane draws
  // a close button (false for a single-Pane Tab); gating the callback on it left such Tabs open.
  const terminalSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const embeddedRdp = terminalSource.slice(
    terminalSource.indexOf("<RemoteDesktopWorkspace"),
    terminalSource.indexOf("/>", terminalSource.indexOf("<RemoteDesktopWorkspace")),
  );
  assert.match(embeddedRdp, /onFullscreenClose=\{\(\) => closePane\(tabId, pane\.id\)\}/);
  assert.doesNotMatch(embeddedRdp, /canClosePane/);
  const canvasSource = await readFile(new URL("../src/modules/workspace/WorkspaceCanvas.tsx", import.meta.url), "utf8");
  assert.match(canvasSource, /onFullscreenClose=\{\(\) => closeTab\(tab\.id\)\}/);
  const widgetSource = await readFile(
    new URL("../src/modules/dashboard/widgets/builtin/connections/ConnectionWidget.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(widgetSource, /onFullscreenClose/, "a Dashboard widget has no Tab to close");
  assert.match(rdpSource, /DISPID_REQUEST_GO_FULLSCREEN:\s*i32\s*=\s*8/);
  assert.match(rdpSource, /DISPID_REQUEST_LEAVE_FULLSCREEN:\s*i32\s*=\s*9/);
});

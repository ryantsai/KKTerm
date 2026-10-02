import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RDP disconnect handling does not restore the removed Tab auto-close flow", async () => {
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
  assert.match(
    rdpSource,
    /DISPID_DISCONNECTED\s*=>\s*restore_disconnected_fullscreen_host\(session\)/,
    "ActiveX OnDisconnected should remain scoped to restoring the fullscreen host",
  );
  assert.match(rdpSource, /DISPID_REQUEST_GO_FULLSCREEN:\s*i32\s*=\s*8/);
  assert.match(rdpSource, /DISPID_REQUEST_LEAVE_FULLSCREEN:\s*i32\s*=\s*9/);
});

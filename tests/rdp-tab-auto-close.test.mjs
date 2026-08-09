import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RDP disconnect handling does not restore the removed Tab auto-close flow", async () => {
  const remoteDesktopSource = await readFile(
    new URL("../src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const rdpSource = await readFile(new URL("../src-tauri/src/rdp.rs", import.meta.url), "utf8");

  assert.doesNotMatch(
    remoteDesktopSource,
    /get_rdp_session_status/,
    "RDP disconnect detection should not poll session status",
  );
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RDP ActiveX events do not restore the removed disconnect auto-close flow", async () => {
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
    /DISPID_DISCONNECTED|rdp-session-event|RdpSessionEvent/,
    "RDP backend should not subscribe to or emit ActiveX disconnect events",
  );
  assert.match(rdpSource, /DISPID_REQUEST_GO_FULLSCREEN:\s*i32\s*=\s*8/);
  assert.match(rdpSource, /DISPID_REQUEST_LEAVE_FULLSCREEN:\s*i32\s*=\s*9/);
});

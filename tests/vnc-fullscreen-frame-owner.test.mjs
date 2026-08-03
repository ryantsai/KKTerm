import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("detached VNC full screen exclusively owns the acknowledged frame stream", async () => {
  const [fullscreen, workspace, surface] = await Promise.all([
    read("src/modules/workspace/connections/remote-desktop/RemoteFullscreenApp.tsx"),
    read("src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx"),
    read("src/modules/workspace/connections/remote-desktop/vncSurface.ts"),
  ]);

  assert.match(surface, /VNC_FULLSCREEN_SURFACE_EVENT/);
  assert.match(fullscreen, /announce\(true\)/);
  assert.match(fullscreen, /announce\(false\)/);
  assert.match(workspace, /vncFullscreenAttachedRef\.current = event\.payload\.active/);
  assert.match(workspace, /if \(vncFullscreenAttachedRef\.current\) return;/);
  assert.match(workspace, /!event\.payload\.active[\s\S]*refresh_vnc_session/);
});

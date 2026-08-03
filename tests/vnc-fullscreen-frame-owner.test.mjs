import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("detached VNC full screen exclusively owns the acknowledged frame stream", async () => {
  const [fullscreen, workspace, surface, css] = await Promise.all([
    read("src/modules/workspace/connections/remote-desktop/RemoteFullscreenApp.tsx"),
    read("src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx"),
    read("src/modules/workspace/connections/remote-desktop/vncSurface.ts"),
    read("src/modules/workspace/connections/remote-desktop/remote-desktop.css"),
  ]);

  assert.match(surface, /VNC_FULLSCREEN_SURFACE_EVENT/);
  assert.match(surface, /resizeVncCanvas\(canvas, event\.width, event\.height\)[\s\S]*canvas\.getContext/);
  assert.match(surface, /payload\.kind === "resolution"[\s\S]{0,220}setHasDisplay\(false\)/);
  assert.match(surface, /return operations\.length > 0/);
  assert.match(workspace, /event\.kind === "resolution"[\s\S]{0,220}setVncHasDisplay\(false\)/);
  assert.match(fullscreen, /announce\(true\)/);
  assert.match(fullscreen, /announce\(false\)/);
  assert.match(workspace, /vncFullscreenAttachedRef\.current = event\.payload\.active/);
  assert.match(workspace, /if \(vncFullscreenAttachedRef\.current\) return;/);
  assert.match(workspace, /!event\.payload\.active[\s\S]*refresh_vnc_session/);
  assert.match(fullscreen, /allowUpscale:\s*false/);
  assert.match(fullscreen, /remote-fullscreen-root[^>]*onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(css, /\.remote-fullscreen-canvas\s*\{[^}]*width:\s*auto/s);
  assert.match(css, /\.remote-fullscreen-canvas\s*\{[^}]*max-width:\s*100%/s);
  assert.match(css, /\.remote-fullscreen-canvas\s*\{[^}]*max-height:\s*100%/s);
});

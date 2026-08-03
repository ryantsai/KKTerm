import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [stage, elevation, device, css] = await Promise.all([
  readFile(new URL("../src/modules/itops/RackStage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/modules/itops/RackElevation.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/modules/itops/RackDevice.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/modules/itops/itops.css", import.meta.url), "utf8"),
]);

test("single-rack inventory details stay in their device balloons", () => {
  assert.doesNotMatch(stage, /selectRandomRackCallouts|rack-random-callouts/);
  assert.match(stage, /collectBoundConnectionIds\(b\.item\)/);
  assert.match(stage, /itops\.racks\.boundConnectionCount/);
  assert.match(css, /\.rk-balloon-box\s*\{[^}]*max-width:\s*280px/s);
  assert.match(css, /\.rk-balloon-leader\s*\{[^}]*flex:\s*0 0 20px/s);
  assert.doesNotMatch(css, /\.rk-balloon-box\s*\{[^}]*width:\s*min\(/s);
  assert.match(css, /\.rk-balloon-notes\s*\{[^}]*-webkit-line-clamp:\s*2/s);
});

test("multi-rack elevation preserves visible animation while skipping off-screen work", () => {
  assert.match(device, /export const RackDevice = memo\(function RackDevice/);
  assert.match(css, /\.rk-row > \.rk\s*\{[^}]*content-visibility:\s*auto/s);
  assert.doesNotMatch(css, /\.rk-elevations \.rkd[^}]*animation:\s*none !important/s);
  assert.match(elevation, /contentvisibilityautostatechange/);
  assert.match(css, /data-content-skipped="true"[^}]*animation-play-state:\s*paused/s);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dynamicBackgroundSource = await readFile(
  new URL("../src/modules/dashboard/registry/dynamicBackgrounds.tsx", import.meta.url),
  "utf8",
);
const fujiBackgroundSource = await readFile(
  new URL("../src/modules/dashboard/registry/fujiBackground.tsx", import.meta.url),
  "utf8",
);
const extraDynamicBackgroundSource = await readFile(
  new URL("../src/modules/dashboard/registry/extraDynamicBackgrounds.tsx", import.meta.url),
  "utf8",
);
const abstractDynamicBackgroundSource = await readFile(
  new URL("../src/modules/dashboard/registry/abstractDynamicBackgrounds.tsx", import.meta.url),
  "utf8",
);
const canvasHelperSource = await readFile(
  new URL("../src/modules/dashboard/registry/dynamicBackgroundCanvas.ts", import.meta.url),
  "utf8",
);
const mistySeaBackgroundSource = await readFile(
  new URL("../src/modules/dashboard/registry/mistySeaBackground.tsx", import.meta.url),
  "utf8",
);

test("canvas dynamic backgrounds cap their Retina backing scale at 1.5", () => {
  assert.match(canvasHelperSource, /MAX_DYNAMIC_BACKGROUND_DPR = 1\.5/);
  assert.match(dynamicBackgroundSource, /dynamicBackgroundDevicePixelRatio\(window\.devicePixelRatio\)/);
  assert.match(fujiBackgroundSource, /dynamicBackgroundDevicePixelRatio\(window\.devicePixelRatio\)/);
  assert.match(extraDynamicBackgroundSource, /dynamicBackgroundDevicePixelRatio\(window\.devicePixelRatio\)/);
  assert.match(abstractDynamicBackgroundSource, /dynamicBackgroundDevicePixelRatio\(window\.devicePixelRatio\)/);
  assert.match(mistySeaBackgroundSource, /dynamicBackgroundDevicePixelRatio\(window\.devicePixelRatio\)/);
  assert.doesNotMatch(dynamicBackgroundSource, /const dpr = Math\.max\(1, window\.devicePixelRatio \|\| 1\)/);
  assert.doesNotMatch(fujiBackgroundSource, /const dpr = Math\.max\(1, window\.devicePixelRatio \|\| 1\)/);
  assert.doesNotMatch(extraDynamicBackgroundSource, /const dpr = Math\.max\(1, window\.devicePixelRatio \|\| 1\)/);
  assert.doesNotMatch(abstractDynamicBackgroundSource, /const dpr = Math\.max\(1, window\.devicePixelRatio \|\| 1\)/);
  assert.doesNotMatch(mistySeaBackgroundSource, /const dpr = Math\.max\(1, window\.devicePixelRatio \|\| 1\)/);
});

test("rainy window caches stationary droplets and reuses mist sprites", () => {
  assert.match(dynamicBackgroundSource, /stationaryDrops\?: HTMLCanvasElement/);
  assert.match(dynamicBackgroundSource, /mistGlowSprite\?: HTMLCanvasElement/);
  assert.match(dynamicBackgroundSource, /mistHighlightSprite\?: HTMLCanvasElement/);
  assert.match(dynamicBackgroundSource, /ctx\.drawImage\(state\.stationaryDrops/);

  const perFrameRainyWindow = dynamicBackgroundSource.slice(
    dynamicBackgroundSource.indexOf("ctx.fillStyle = \"#0a1320\""),
    dynamicBackgroundSource.indexOf("const ref = useCanvasAnim(draw);", dynamicBackgroundSource.indexOf("function RainyWindowBg")),
  );
  assert.doesNotMatch(perFrameRainyWindow, /createRadialGradient/);
  assert.doesNotMatch(perFrameRainyWindow, /for \(const stud of state\.studs\)/);
});

test("dynamic canvas timing remains native requestAnimationFrame", () => {
  assert.match(dynamicBackgroundSource, /raf = activeRef\.current \? requestAnimationFrame\(frame\) : 0/);
  assert.match(extraDynamicBackgroundSource, /raf = activeRef\.current \? requestAnimationFrame\(frame\) : 0/);
  assert.match(abstractDynamicBackgroundSource, /raf = activeRef\.current \? requestAnimationFrame\(frame\) : 0/);
  assert.doesNotMatch(dynamicBackgroundSource, /setTimeout\(frame|FRAME_INTERVAL|targetFps/i);
  assert.doesNotMatch(extraDynamicBackgroundSource, /setTimeout\(frame|FRAME_INTERVAL|targetFps/i);
  assert.doesNotMatch(abstractDynamicBackgroundSource, /setTimeout\(frame|FRAME_INTERVAL|targetFps/i);
  assert.match(mistySeaBackgroundSource, /requestAnimationFrame\(render\)/);
  assert.doesNotMatch(mistySeaBackgroundSource, /setTimeout\(render|setInterval|FRAME_INTERVAL|targetFps/i);
});

test("Misty Sea releases WebGL resources and survives context loss", () => {
  assert.match(mistySeaBackgroundSource, /webglcontextlost/);
  assert.match(mistySeaBackgroundSource, /webglcontextrestored/);
  assert.match(mistySeaBackgroundSource, /WEBGL_lose_context/);
  assert.match(mistySeaBackgroundSource, /gl\.deleteBuffer\(positionBuffer\)/);
  assert.match(mistySeaBackgroundSource, /gl\.deleteProgram\(program\)/);
});

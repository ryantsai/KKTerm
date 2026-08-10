import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WATERS_CAMERA_SWEEP_SECONDS,
  WATERS_CAMERA_YAW_RADIANS,
  WATERS_OCEAN_HALF_EXTENT,
  WATERS_SUN_DIRECTION,
  WATERS_WAVE_COUNT,
  watersCameraHeight,
  watersCameraYaw,
  watersOceanGridCoordinate,
} from "../src/modules/dashboard/registry/watersBackground";

const implementationSource = await readFile(
  new URL("../src/modules/dashboard/registry/watersBackground.tsx", import.meta.url),
  "utf8",
);
const registrySource = await readFile(
  new URL("../src/modules/dashboard/registry/dynamicBackgrounds.tsx", import.meta.url),
  "utf8",
);
const previewSource = await readFile(
  new URL("../src/modules/dashboard/registry/dynamicBackgroundPreviewArt.tsx", import.meta.url),
  "utf8",
);
const validationSource = await readFile(
  new URL("../src-tauri/src/dashboard_validation.rs", import.meta.url),
  "utf8",
);
const englishLocaleSource = await readFile(
  new URL("../src/i18n/locales/en.json", import.meta.url),
  "utf8",
);
const manualSource = await readFile(
  new URL("../docs/manual/10-dashboard.md", import.meta.url),
  "utf8",
);
const readmeSource = await readFile(new URL("../README.md", import.meta.url), "utf8");

const otherWebglBackgroundSources = await Promise.all(
  [
    "mistySeaBackground.tsx",
    "componentry/animated-gradient.tsx",
    "componentry/closing-plasma.tsx",
    "componentry/dither-prism-hero.tsx",
    "componentry/hero-geometric.tsx",
    "componentry/liquid-chrome.tsx",
    "componentry/prism-gradient.tsx",
    "componentry/silk-aurora.tsx",
    "componentry/webgl-liquid.tsx",
  ].map(async (file) => ({
    file,
    source: await readFile(
      new URL(`../src/modules/dashboard/registry/${file}`, import.meta.url),
      "utf8",
    ),
  })),
);

test("waters camera sweep loops without a seam", () => {
  assert.equal(watersCameraYaw(0), 0);
  assert.ok(Math.abs(watersCameraYaw(WATERS_CAMERA_SWEEP_SECONDS)) < 1e-9);
  assert.ok(
    Math.abs(watersCameraYaw(WATERS_CAMERA_SWEEP_SECONDS / 4) - WATERS_CAMERA_YAW_RADIANS) < 1e-9,
  );
  for (const seconds of [0, 7.5, 61, 240]) {
    assert.ok(Math.abs(watersCameraYaw(seconds)) <= WATERS_CAMERA_YAW_RADIANS + 1e-9);
    const height = watersCameraHeight(seconds);
    assert.ok(height > 10 && height < 13, `camera should stay above the crests: ${height}`);
  }
});

test("waters keeps a lit sun above the horizon", () => {
  const [x, y, z] = WATERS_SUN_DIRECTION;
  assert.ok(y > 0, "the sun must sit above the horizon for glints and foam shading");
  assert.ok(Math.hypot(x, y, z) > 0.5, "the sun direction must be non-degenerate");
});

test("waters concentrates ocean geometry near the camera without moving its edge", () => {
  assert.equal(watersOceanGridCoordinate(0), 0);
  assert.equal(watersOceanGridCoordinate(WATERS_OCEAN_HALF_EXTENT), WATERS_OCEAN_HALF_EXTENT);
  assert.equal(watersOceanGridCoordinate(-WATERS_OCEAN_HALF_EXTENT), -WATERS_OCEAN_HALF_EXTENT);
  assert.ok(
    watersOceanGridCoordinate(WATERS_OCEAN_HALF_EXTENT / 2) < WATERS_OCEAN_HALF_EXTENT / 2,
    "interior vertices should move toward the camera to prevent visible near-field facets",
  );
});

test("other WebGL dynamic backgrounds do not displace a tessellated surface", () => {
  for (const { file, source } of otherWebglBackgroundSources) {
    assert.doesNotMatch(source, /new THREE\.PlaneGeometry\([^)]*,[^)]*,[^)]*,/s, file);
    assert.doesNotMatch(source, /sampleOcean|Gerstner|WaveSample/, file);
  }
});

test("waters renders a Gerstner spectrum with the shared atmosphere", () => {
  assert.ok(WATERS_WAVE_COUNT >= 8, "the spectrum needs enough waves to avoid visible tiling");
  assert.match(implementationSource, /WaveSample sampleOcean\(vec2 pos\)/);
  assert.match(implementationSource, /sqrt\(9\.81 \* w\) \* WAVE_SPEED/);
  assert.match(implementationSource, /o\.fold = jxx \* jzz - jxz \* jxz;/);
  assert.match(implementationSource, /vec3 atmosphere\(vec3 dir\)/);
  assert.match(implementationSource, /exp\(-\(ABSORB \/ CLARITY\) \* thickness\)/);
  assert.match(implementationSource, /dynamicBackgroundDevicePixelRatio\(window\.devicePixelRatio\)/);
  assert.match(implementationSource, /watersOceanGridCoordinate\(oceanPositions\.getX\(index\)\)/);
  assert.doesNotMatch(implementationSource, /const dpr = Math\.max\(1, window\.devicePixelRatio \|\| 1\)/);
});

test("waters releases its WebGL scene when the background stops", () => {
  assert.match(implementationSource, /useDashboardAnimationActive\(\)/);
  assert.match(implementationSource, /renderer\?\.dispose\(\)/);
  assert.match(implementationSource, /raf = activeRef\.current \? requestAnimationFrame\(render\) : 0/);
  assert.match(implementationSource, /canvas\.addEventListener\("webglcontextlost", handleContextLost\)/);
});

test("waters is registered everywhere a dynamic background must appear", () => {
  assert.match(implementationSource, /export function WatersBg\(/);
  assert.match(registrySource, /waters: WatersBg/);
  assert.match(
    registrySource,
    /\{ id: "waters", labelKey: "dashboard\.dynamicBackgrounds\.waters", mood: "calm" \}/,
  );
  assert.match(previewSource, /BUILDERS\.waters = \(id\) =>/);
  assert.match(validationSource, /"waters"/);
  assert.match(englishLocaleSource, /"waters": "Waters"/);
  assert.match(manualSource, /`waters`/);
  assert.match(readmeSource, /`waters`/);
});

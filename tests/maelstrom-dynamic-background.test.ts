import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAELSTROM_CASCADE_COUNT,
  MAELSTROM_FFT_RESOLUTION,
  MAELSTROM_LENGTH_SCALES,
} from "../src/modules/dashboard/registry/maelstromBackground";

const implementationSource = await readFile(new URL("../src/modules/dashboard/registry/maelstromBackground.tsx", import.meta.url), "utf8");
const paramsSource = await readFile(new URL("../src/modules/dashboard/registry/poseidon/params.js", import.meta.url), "utf8");
const oceanSource = await readFile(new URL("../src/modules/dashboard/registry/poseidon/Ocean.js", import.meta.url), "utf8");
const surfaceSource = await readFile(new URL("../src/modules/dashboard/registry/poseidon/oceanSurfaceMaterial.js", import.meta.url), "utf8");
const registrySource = await readFile(new URL("../src/modules/dashboard/registry/dynamicBackgrounds.tsx", import.meta.url), "utf8");
const previewSource = await readFile(new URL("../src/modules/dashboard/registry/dynamicBackgroundPreviewArt.tsx", import.meta.url), "utf8");
const validationSource = await readFile(new URL("../src-tauri/src/dashboard_validation.rs", import.meta.url), "utf8");
const zhTwLocaleSource = await readFile(new URL("../src/i18n/locales/zh-TW.json", import.meta.url), "utf8");

test("maelstrom uses Poseidon's full FFT ocean and attached parameters", () => {
  assert.equal(MAELSTROM_FFT_RESOLUTION, 256);
  assert.equal(MAELSTROM_CASCADE_COUNT, 3);
  assert.deepEqual(MAELSTROM_LENGTH_SCALES, [250, 17, 5]);
  assert.match(implementationSource, /new WebGPURenderer\(\{ antialias: true/);
  assert.match(implementationSource, /new PlaneGeometry\(400, 400, 900, 900\)/);
  assert.match(implementationSource, /camera\.position\.set\(0, 16, 68\)/);
  assert.match(paramsSource, /windSpeed: 16\.0/);
  assert.match(paramsSource, /windDirection: 45/);
  assert.match(paramsSource, /lambda: 1\.3/);
  assert.match(paramsSource, /foamThreshold: 0\.4/);
  assert.match(paramsSource, /foamScale: 2\.5/);
  assert.match(paramsSource, /foamDecay: 0\.4/);
  assert.match(paramsSource, /skyHorizon: 0x9fb8cc/);
  assert.match(paramsSource, /skyZenith: 0x2a5b9c/);
  assert.match(oceanSource, /this\.renderer\.compute\(this\.timeDepGroup\)/);
  assert.match(surfaceSource, /accumulated-Jacobian/);
});

test("maelstrom is registered, previewed, validated, and named for Taiwan", () => {
  assert.match(registrySource, /maelstrom: MaelstromBg/);
  assert.match(registrySource, /id: "maelstrom"[^\n]+mood: "erratic"/);
  assert.match(previewSource, /BUILDERS\.maelstrom = \(id\) =>/);
  assert.match(validationSource, /"maelstrom"/);
  assert.match(zhTwLocaleSource, /"maelstrom": "波濤洶湧"/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAELSTROM_CAMERA_SWEEP_SECONDS,
  MAELSTROM_WAVE_COUNT,
  maelstromCameraYaw,
} from "../src/modules/dashboard/registry/maelstromBackground";

const implementationSource = await readFile(new URL("../src/modules/dashboard/registry/maelstromBackground.tsx", import.meta.url), "utf8");
const registrySource = await readFile(new URL("../src/modules/dashboard/registry/dynamicBackgrounds.tsx", import.meta.url), "utf8");
const previewSource = await readFile(new URL("../src/modules/dashboard/registry/dynamicBackgroundPreviewArt.tsx", import.meta.url), "utf8");
const validationSource = await readFile(new URL("../src-tauri/src/dashboard_validation.rs", import.meta.url), "utf8");
const zhTwLocaleSource = await readFile(new URL("../src/i18n/locales/zh-TW.json", import.meta.url), "utf8");

test("maelstrom camera sweep loops and stays restrained", () => {
  assert.equal(maelstromCameraYaw(0), 0);
  assert.ok(Math.abs(maelstromCameraYaw(MAELSTROM_CAMERA_SWEEP_SECONDS)) < 1e-9);
  assert.ok(Math.abs(maelstromCameraYaw(MAELSTROM_CAMERA_SWEEP_SECONDS / 4) - 0.12) < 1e-9);
});

test("maelstrom preserves Poseidon's storm-ocean ingredients", () => {
  assert.ok(MAELSTROM_WAVE_COUNT >= 20);
  assert.match(implementationSource, /github\.com\/owenyuwono\/poseidon/);
  assert.match(implementationSource, /sqrt\(9\.81 \* frequency\)/);
  assert.match(implementationSource, /float steepness/);
  assert.match(implementationSource, /vFoam/);
  assert.match(implementationSource, /vec3 skyColor/);
  assert.match(implementationSource, /dynamicBackgroundDevicePixelRatio\(window\.devicePixelRatio\)/);
});

test("maelstrom is registered, previewed, validated, and named for Taiwan", () => {
  assert.match(registrySource, /maelstrom: MaelstromBg/);
  assert.match(registrySource, /id: "maelstrom"[^\n]+mood: "erratic"/);
  assert.match(previewSource, /BUILDERS\.maelstrom = \(id\) =>/);
  assert.match(validationSource, /"maelstrom"/);
  assert.match(zhTwLocaleSource, /"maelstrom": "波濤洶湧"/);
});

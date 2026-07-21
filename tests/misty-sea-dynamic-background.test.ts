import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mistySeaPaletteAtHour } from "../src/modules/dashboard/registry/mistySeaBackground";

const implementationSource = await readFile(
  new URL("../src/modules/dashboard/registry/mistySeaBackground.tsx", import.meta.url),
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

test("Misty Sea palette follows local time and wraps across midnight", () => {
  const midday = mistySeaPaletteAtHour(12);
  const midnight = mistySeaPaletteAtHour(0);
  assert.ok(midday.daylight > midnight.daylight);
  assert.deepEqual(mistySeaPaletteAtHour(-1), mistySeaPaletteAtHour(23));
  assert.deepEqual(mistySeaPaletteAtHour(25), mistySeaPaletteAtHour(1));

  for (const palette of [midday, midnight, mistySeaPaletteAtHour(18)]) {
    for (const color of [palette.sky, palette.horizon, palette.water, palette.cloud, palette.sun]) {
      for (const channel of color) {
        assert.ok(channel >= 0 && channel <= 1, `palette channel should be normalized: ${channel}`);
      }
    }
  }
});

test("Misty Sea is available throughout the shared background pipeline", () => {
  assert.match(implementationSource, /export function MistySeaBg\(/);
  assert.match(implementationSource, /getContext\("webgl"/);
  assert.match(implementationSource, /applyFallbackBackground/);
  assert.match(registrySource, /mistySea: MistySeaBg/);
  assert.match(
    registrySource,
    /\{ id: "mistySea", labelKey: "dashboard\.dynamicBackgrounds\.mistySea", mood: "calm" \}/,
  );
  assert.match(previewSource, /BUILDERS\.mistySea = \(id\) =>/);
  assert.match(validationSource, /"mistySea"/);
  assert.match(englishLocaleSource, /"mistySea": "Misty Sea"/);
  assert.match(manualSource, /`mistySea`/);
  assert.match(readmeSource, /`mistySea`/);
});

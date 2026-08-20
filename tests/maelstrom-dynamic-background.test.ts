import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAELSTROM_CASCADE_COUNT,
  MAELSTROM_FFT_RESOLUTION,
  MAELSTROM_LENGTH_SCALES,
  POSEIDON_OCEAN_SCENES,
} from "../src/modules/dashboard/registry/maelstromBackground";

const implementationSource = await readFile(
  new URL("../src/modules/dashboard/registry/maelstromBackground.tsx", import.meta.url),
  "utf8",
);
const paramsSource = await readFile(
  new URL("../src/modules/dashboard/registry/poseidon/params.js", import.meta.url),
  "utf8",
);
const oceanSource = await readFile(
  new URL("../src/modules/dashboard/registry/poseidon/Ocean.js", import.meta.url),
  "utf8",
);
const surfaceSource = await readFile(
  new URL("../src/modules/dashboard/registry/poseidon/oceanSurfaceMaterial.js", import.meta.url),
  "utf8",
);
const skySource = await readFile(
  new URL("../src/modules/dashboard/registry/poseidon/sky.js", import.meta.url),
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
const zhTwLocaleSource = await readFile(new URL("../src/i18n/locales/zh-TW.json", import.meta.url), "utf8");
const goldenSky = await readFile(new URL("../public/sky/sky_131_2k.png", import.meta.url));
const middaySky = await readFile(new URL("../public/sky/sky_midday_2k.png", import.meta.url));

const newSceneIds = [
  "sunGlitter",
  "whitecaps",
  "subsurfaceScatter",
  "waveField",
  "openOceanBlue",
  "tropicalGreen",
] as const;

test("maelstrom uses Poseidon v0.0.2's full FFT ocean", () => {
  assert.equal(MAELSTROM_FFT_RESOLUTION, 256);
  assert.equal(MAELSTROM_CASCADE_COUNT, 3);
  assert.deepEqual(MAELSTROM_LENGTH_SCALES, [1024, 144, 24]);
  assert.match(implementationSource, /NeutralToneMapping/);
  assert.match(implementationSource, /createRadialGrid\(\{ rings: 620, sectors: 1280/);
  assert.match(implementationSource, /createAerialPerspective/);
  assert.match(paramsSource, /windSpeed: 10\.5/);
  assert.match(paramsSource, /lambda: 2\.2/);
  assert.match(paramsSource, /chopLean: 0\.62/);
  assert.match(paramsSource, /foamThreshold: 0\.32/);
  assert.match(paramsSource, /foamDecay: 3\.9/);
  assert.match(oceanSource, /this\.renderer\.compute\(this\.timeDepGroup\)/);
  assert.match(surfaceSource, /exact unpolarised Fresnel/i);
  assert.ok(goldenSky.length > 100_000);
  assert.ok(middaySky.length > 100_000);
});

test("Poseidon README scenes use their v0.0.2 camera, sky, and palette variants", () => {
  assert.deepEqual(POSEIDON_OCEAN_SCENES.sunGlitter.camera.position, [0, 6, 0]);
  assert.equal(POSEIDON_OCEAN_SCENES.sunGlitter.camera.fov, 60);
  assert.equal(POSEIDON_OCEAN_SCENES.sunGlitter.camera.sunChase, true);
  assert.equal(POSEIDON_OCEAN_SCENES.sunGlitter.sky, "golden");
  assert.equal(POSEIDON_OCEAN_SCENES.whitecaps.sky, "golden");
  assert.deepEqual(POSEIDON_OCEAN_SCENES.whitecaps.camera.position, [0, 16, 68]);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.whitecaps.camera.target, [0, 2, -20]);
  assert.equal(POSEIDON_OCEAN_SCENES.whitecaps.camera.fov, 55);
  assert.equal(POSEIDON_OCEAN_SCENES.whitecaps.palette, 1);
  assert.equal(POSEIDON_OCEAN_SCENES.subsurfaceScatter.sky, "golden");
  assert.equal(POSEIDON_OCEAN_SCENES.subsurfaceScatter.palette, 0);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.subsurfaceScatter.camera.position, [-30, 1.4, 20]);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.subsurfaceScatter.camera.target, [10, 6, -25]);
  assert.equal(POSEIDON_OCEAN_SCENES.subsurfaceScatter.camera.fov, 70);
  assert.equal(POSEIDON_OCEAN_SCENES.waveField.sky, "midday");
  assert.equal(POSEIDON_OCEAN_SCENES.waveField.palette, 1);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.waveField.camera.position, [0, 90, 180]);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.waveField.camera.target, [0, 0, -60]);
  assert.equal(POSEIDON_OCEAN_SCENES.waveField.camera.fov, 55);
  assert.equal(POSEIDON_OCEAN_SCENES.openOceanBlue.sky, "midday");
  assert.equal(POSEIDON_OCEAN_SCENES.openOceanBlue.palette, 1);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.openOceanBlue.camera.position, [0, 9, 40]);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.openOceanBlue.camera.target, [0, 0.5, -90]);
  assert.equal(POSEIDON_OCEAN_SCENES.openOceanBlue.camera.fov, 62);
  assert.equal(POSEIDON_OCEAN_SCENES.tropicalGreen.sky, "midday");
  assert.equal(POSEIDON_OCEAN_SCENES.tropicalGreen.palette, 0);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.tropicalGreen.camera.position, [0, 9, 40]);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.tropicalGreen.camera.target, [0, 0.5, -90]);
  assert.equal(POSEIDON_OCEAN_SCENES.tropicalGreen.camera.fov, 62);
  assert.match(skySource, /texture\(u\.skyTexture/);
  assert.doesNotMatch(skySource, /let skyTex = null/);
});

test("all Poseidon scenes are registered, previewed, validated, and localized for Taiwan", () => {
  assert.match(registrySource, /maelstrom: MaelstromBg/);
  assert.match(previewSource, /BUILDERS\.maelstrom = \(id\) =>/);
  assert.match(validationSource, /"maelstrom"/);
  assert.match(zhTwLocaleSource, /"maelstrom": "波濤洶湧"/);

  for (const id of newSceneIds) {
    assert.match(registrySource, new RegExp(`${id}: [A-Z][A-Za-z]+Bg`));
    assert.match(registrySource, new RegExp(`id: "${id}"`));
    assert.match(previewSource, new RegExp(`BUILDERS\\.${id} = \\(id\\) =>`));
    assert.match(validationSource, new RegExp(`"${id}"`));
    assert.match(zhTwLocaleSource, new RegExp(`"${id}":`));
  }
});

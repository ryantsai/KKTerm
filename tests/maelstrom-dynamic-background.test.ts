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
const nextImplementationSource = await readFile(
  new URL("../src/modules/dashboard/registry/maelstromNextBackground.tsx", import.meta.url),
  "utf8",
);
const maelstromParamsSource = await readFile(
  new URL("../src/modules/dashboard/registry/poseidon/maelstrom-v0147/params.js", import.meta.url),
  "utf8",
);
const maelstromSkySource = await readFile(
  new URL("../src/modules/dashboard/registry/poseidon/maelstrom-v0147/sky.js", import.meta.url),
  "utf8",
);
const maelstromSurfaceSource = await readFile(
  new URL(
    "../src/modules/dashboard/registry/poseidon/maelstrom-v0147/oceanSurfaceMaterial.js",
    import.meta.url,
  ),
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
  "waveField",
  "openOceanBlue",
  "tropicalGreen",
] as const;

test("Poseidon ocean backgrounds use its full FFT ocean", () => {
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

test("Maelstrom uses the next v0.1.147 Poseidon WebGPU scene", () => {
  assert.equal(MAELSTROM_FFT_RESOLUTION, 256);
  assert.equal(MAELSTROM_CASCADE_COUNT, 3);
  assert.deepEqual(MAELSTROM_LENGTH_SCALES, [250, 17, 5]);
  assert.match(nextImplementationSource, /poseidon\/maelstrom-v0147/);
  assert.match(nextImplementationSource, /new WebGPURenderer/);
  assert.match(nextImplementationSource, /camera\.position\.set\(0, 16, 68\)/);
  assert.match(nextImplementationSource, /camera\.lookAt\(0, 0, -20\)/);
  assert.match(nextImplementationSource, /new PlaneGeometry\(400, 400, 900, 900\)/);
  assert.match(maelstromParamsSource, /lengthScales: \[250, 17, 5\]/);
  assert.match(maelstromParamsSource, /windSpeed: 16\.0/);
  assert.match(maelstromParamsSource, /scatter: 0x2e8f8f/);
  assert.match(maelstromSkySource, /const grad = mix\(u\.horizon, u\.zenith/);
  assert.match(maelstromSurfaceSource, /const body = mix\(shading\.deepColor, shading\.scatterColor/);
  assert.doesNotMatch(nextImplementationSource, /WebGLRenderer/);
  assert.doesNotMatch(nextImplementationSource, /createRadialGrid/);
});

test("Poseidon showcase scenes stay above the waterline", () => {
  assert.deepEqual(POSEIDON_OCEAN_SCENES.sunGlitter.camera.position, [0, 16, 0]);
  assert.equal(POSEIDON_OCEAN_SCENES.sunGlitter.camera.fov, 60);
  assert.equal(POSEIDON_OCEAN_SCENES.sunGlitter.camera.sunChase, true);
  assert.equal(POSEIDON_OCEAN_SCENES.sunGlitter.sky, "golden");
  assert.equal(POSEIDON_OCEAN_SCENES.whitecaps.sky, "golden");
  assert.deepEqual(POSEIDON_OCEAN_SCENES.whitecaps.camera.position, [0, 16, 68]);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.whitecaps.camera.target, [0, 2, -20]);
  assert.equal(POSEIDON_OCEAN_SCENES.whitecaps.camera.fov, 55);
  assert.equal(POSEIDON_OCEAN_SCENES.whitecaps.palette, 1);
  assert.equal(POSEIDON_OCEAN_SCENES.waveField.sky, "midday");
  assert.equal(POSEIDON_OCEAN_SCENES.waveField.palette, 1);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.waveField.camera.position, [0, 90, 180]);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.waveField.camera.target, [0, 0, -60]);
  assert.equal(POSEIDON_OCEAN_SCENES.waveField.camera.fov, 55);
  assert.equal(POSEIDON_OCEAN_SCENES.openOceanBlue.sky, "midday");
  assert.equal(POSEIDON_OCEAN_SCENES.openOceanBlue.palette, 1);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.openOceanBlue.camera.position, [0, 16, 40]);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.openOceanBlue.camera.target, [0, 0.5, -90]);
  assert.equal(POSEIDON_OCEAN_SCENES.openOceanBlue.camera.fov, 62);
  assert.equal(POSEIDON_OCEAN_SCENES.tropicalGreen.sky, "midday");
  assert.equal(POSEIDON_OCEAN_SCENES.tropicalGreen.palette, 0);
  assert.deepEqual(POSEIDON_OCEAN_SCENES.tropicalGreen.camera.position, [0, 16, 40]);
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
  assert.doesNotMatch(registrySource, /subsurfaceScatter/);
  assert.doesNotMatch(previewSource, /subsurfaceScatter/);
  assert.doesNotMatch(validationSource, /subsurfaceScatter/);
  assert.doesNotMatch(zhTwLocaleSource, /subsurfaceScatter/);

  for (const id of newSceneIds) {
    assert.match(registrySource, new RegExp(`${id}: [A-Z][A-Za-z]+Bg`));
    assert.match(registrySource, new RegExp(`id: "${id}"`));
    assert.match(previewSource, new RegExp(`BUILDERS\\.${id} = \\(id\\) =>`));
    assert.match(validationSource, new RegExp(`"${id}"`));
    assert.match(zhTwLocaleSource, new RegExp(`"${id}":`));
  }
});

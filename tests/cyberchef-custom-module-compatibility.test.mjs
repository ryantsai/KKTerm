import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moduleRoot = new URL("../custom-modules/cyberchef/", import.meta.url);

test("CyberChef declares only the local capabilities used by its KKTerm adapter", async () => {
  const manifest = JSON.parse(await readFile(new URL("kkterm-extension.json", moduleRoot), "utf8"));

  assert.equal(manifest.apiVersion, 2);
  assert.deepEqual(manifest.permissions, {
    browserStorage: true,
    openExternal: true,
    clipboard: true,
    hostUi: true,
    files: {
      open: true,
      save: true,
      extensions: [],
    },
  });
  assert.equal(manifest.permissions.networkFetch, undefined);
  assert.equal(manifest.modules[0].routing, "static");
});

test("CyberChef adaptation remains offline and compatible with the KKMod CSP", async () => {
  const [adapter, adaptation, dependencyAdaptation, finalizer] = await Promise.all([
    readFile(new URL("src/kkterm-v2-adapter.mjs", moduleRoot), "utf8"),
    readFile(new URL("scripts/apply-adaptation.mjs", moduleRoot), "utf8"),
    readFile(new URL("scripts/apply-dependency-adaptation.mjs", moduleRoot), "utf8"),
    readFile(new URL("scripts/finalize-dist.mjs", moduleRoot), "utf8"),
  ]);

  assert.match(adapter, /window\.KKTerm/);
  assert.match(adapter, /apiVersion !== 2/);
  assert.match(adapter, /await host\(\)\.ready\(\)/);
  assert.match(adapter, /contextChanged/);
  assert.match(adapter, /ui\.notice/);

  assert.match(adaptation, /HTTP request/);
  assert.match(adaptation, /DNS over HTTPS/);
  assert.match(adaptation, /Show on map/);
  assert.match(adaptation, /kktermDisabledOperationTests/);
  assert.match(adaptation, /ShowOnMap/);
  assert.match(adaptation, /worker-loader!/);
  assert.match(adaptation, /workerBlobURL: false/);
  assert.match(adaptation, /theme control is removed from the KKTerm build/);
  assert.match(adaptation, /256 \* 1024 \* 1024/);
  assert.match(adaptation, /dompurify = "3\.4\.14"/);
  assert.match(adaptation, /jimp = "1\.6\.1"/);
  assert.match(adaptation, /Could not find MIME for Buffer/);

  assert.match(dependencyAdaptation, /return new Worker\(workerPath\)/);
  assert.match(dependencyAdaptation, /Dynamic code execution is disabled/);
  assert.match(dependencyAdaptation, /jq\.asm\.bundle\.min\.js/);
  assert.match(dependencyAdaptation, /tesseract-core\.wasm\.js/);

  assert.match(finalizer, /executable inline script survived/);
  assert.match(finalizer, /browser-native alert\/confirm\/prompt survived/);
  assert.match(finalizer, /eval call survived/);
  assert.match(finalizer, /blob-backed Worker construction survived/);
  assert.match(finalizer, /disabled network operation survived/);
  assert.match(finalizer, /removed theme control still has an event listener/);
});

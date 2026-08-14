import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BentoPDF delegates local exports and its one online TSA to KKTerm API v2", async () => {
  const [manifestSource, adapter, adaptation] = await Promise.all([
    readFile(new URL("../custom-modules/bentopdf/kkterm-extension.json", import.meta.url), "utf8"),
    readFile(new URL("../custom-modules/bentopdf/src/kkterm-v2-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../custom-modules/bentopdf/scripts/apply-adaptation.mjs", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const extensions = new Set(manifest.permissions.files.extensions);

  for (const extension of [
    "cbr", "cer", "der", "eml", "jp2", "jpx", "jxr", "msg", "odg", "oxps",
    "pam", "pbm", "pgm", "pnm", "ppm", "vsdx", "zip",
  ]) {
    assert.ok(extensions.has(extension), `BentoPDF must declare .${extension}`);
  }
  assert.deepEqual(manifest.permissions.networkFetch, {
    origins: ["https://freetsa.org"],
    methods: ["POST"],
    allowPrivateNetwork: false,
    maxResponseBytes: 1048576,
  });

  assert.match(adapter, /https:\/\/freetsa\.org\/tsr/);
  assert.match(adapter, /host\.network\.fetch/);
  assert.match(adapter, /bodyBase64/);
  assert.match(adapter, /new Response/);
  assert.match(adaptation, /TIMESTAMP_TSA_PRESETS/);
  assert.match(adaptation, /FreeTSA/);
  assert.match(adaptation, /VITE_TESSERACT_WORKER_URL/);
  assert.match(adaptation, /\/dist\/kkmod-runtime\/ocr\/worker\.min\.js/);
  assert.match(adaptation, /VITE_TESSERACT_AVAILABLE_LANGUAGES/);
  assert.match(adaptation, /eng/);
  assert.match(adaptation, /VITE_OCR_FONT_BASE_URL/);
});

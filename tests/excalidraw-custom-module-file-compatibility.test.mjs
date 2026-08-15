import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../custom-modules/excalidraw/kkterm-extension.json", import.meta.url);
const appUrl = new URL("../custom-modules/excalidraw/src/main.tsx", import.meta.url);
const catalogUrl = new URL("../custom-modules/catalog.v2.json", import.meta.url);

test("Excalidraw declares every browser import and export extension", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const files = manifest.permissions.files;

  assert.equal(files.open, true);
  assert.equal(files.save, true);
  assert.deepEqual(new Set(files.extensions), new Set([
    "excalidraw",
    "excalidrawlib",
    "json",
    "png",
    "svg",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "ico",
    "avif",
    "jfif",
  ]));

  const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
  const catalogEntry = catalog.modules.find((entry) => entry.id === manifest.id);
  assert.equal(catalogEntry.version, manifest.version);
  assert.deepEqual(catalogEntry.permissions.files, files);
});

test("Excalidraw does not expose remote embeds that API v2 cannot render", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /renderEmbeddable=\{\(\) => null\}/);
  assert.match(app, /validateEmbeddable=\{false\}/);
});

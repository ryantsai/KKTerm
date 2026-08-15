import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const moduleRoot = new URL("../custom-modules/squoosh/", import.meta.url);
const distRoot = new URL("../custom-modules/squoosh/dist/", import.meta.url);

async function walkFiles(dir, relative = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(new URL(`${entry.name}/`, dir), childRelative)));
    } else {
      files.push(childRelative);
    }
  }
  return files;
}

test("Squoosh packaged assets resolve from the kkmodule origin", async () => {
  const files = await walkFiles(distRoot);
  const references = [];
  for (const file of files) {
    if (!/\.(?:js|html)$/.test(file)) continue;
    const text = await readFile(new URL(file, distRoot), "utf8");
    for (const match of text.matchAll(/\/dist\/c\/([A-Za-z0-9_.-]+)/g)) {
      references.push({ source: file, target: `c/${match[1]}` });
    }
    for (const match of text.matchAll(/"\.\/c\/([A-Za-z0-9_.-]+)"/g)) {
      references.push({ source: file, target: `c/${match[1]}` });
    }
  }
  assert.ok(references.length > 0, "packaged assets should reference codec/worker files");
  for (const { source, target } of references) {
    assert.ok(
      files.includes(target),
      `${source} references ${target}, which is missing from the Squoosh package`,
    );
  }
});

test("Squoosh bootstrap keeps location.origin concatenations root-absolute", async () => {
  const files = (await readdir(distRoot)).filter((file) => /^inline-.*\.js$/.test(file));
  assert.ok(files.length > 0, "externalised inline scripts should exist");
  for (const file of files) {
    const text = await readFile(new URL(file, distRoot), "utf8");
    assert.match(
      text,
      /nextDefineUri\s*=\s*location\.origin\s*\+\s*"\/dist\/c\//,
      `${file} must append a root-absolute path to location.origin; origin has no trailing slash, so "./dist/..." would corrupt the module host`,
    );
  }
});

test("Squoosh dist never emits dot-relative ./dist/ or origin + \"./\" references", async () => {
  const files = await walkFiles(distRoot);
  const assetRefCheck = /["'`]\.\/dist\//;
  const originConcatCheck = /location\.origin\s*\+\s*["'`]\s*\.\//;
  for (const file of files) {
    if (!/\.(?:js|html)$/.test(file)) continue;
    const text = await readFile(new URL(file, distRoot), "utf8");
    assert.doesNotMatch(
      text,
      assetRefCheck,
      `${file} uses a document-relative ./dist/ reference, which doubles the dist segment`,
    );
    assert.doesNotMatch(
      text,
      originConcatCheck,
      `${file} concatenates location.origin with a dot-relative path, which corrupts the module origin host`,
    );
  }
});

test("Squoosh build script guards the URL rewrites it applies", async () => {
  const build = await readFile(new URL("scripts/build-dist.mjs", moduleRoot), "utf8");

  assert.match(
    build,
    /replaceAll\([^\n]*(?<![\w./-])\/c\//,
    "the JS rewrite must skip dot-relative ./c/ references",
  );
  assert.match(
    build,
    /location\.origin\s*\+\s*"\.\/c\//,
    "the HTML rewrite must recover location.origin concatenations to root-absolute form",
  );
  assert.match(
    build,
    /document-relative \.\/dist\/ reference survived/,
    "the build must fail when a document-relative ./dist/ reference survives",
  );
  assert.match(
    build,
    /malformed location\.origin \+ "\.\/" concatenation survived/,
    "the build must fail when a malformed origin concatenation survives",
  );
});

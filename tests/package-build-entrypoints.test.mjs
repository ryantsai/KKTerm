import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const appPackageScripts = [
  "package:installer",
  "package:installer:arm64",
  "package:portable",
  "package:portable:arm64",
  "package:msix",
  "package:msix:arm64",
  "package:macos",
  "package:macos:app-store",
  "package:linux",
];

test("app artifact package commands install npm dependencies before building", () => {
  for (const name of appPackageScripts) {
    assert.match(
      packageJson.scripts[name],
      /^npm install && /,
      `${name} should install dependencies before starting its platform build`,
    );
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(
  new URL("../src/modules/itops/itops.css", import.meta.url),
  "utf8",
);

test("Network Map overview expands progressively to at most four columns", () => {
  assert.match(
    css,
    /@container network-map-page \(min-width: 660px\)[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /@container network-map-page \(min-width: 970px\)[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /@container network-map-page \(min-width: 1280px\)[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/,
  );
  assert.doesNotMatch(css, /\.nm-gallery[\s\S]*?repeat\([5-9],/);
});

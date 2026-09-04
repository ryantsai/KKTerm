import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import chroma from "chroma-js";

const styles = await readFile(new URL("../src/styles/colorSchemes.css", import.meta.url), "utf8");
const tokens = (body) => Object.fromEntries(
  [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
);
const defaults = tokens(styles.match(/:root\s*\{([^}]+)\}/s)[1]);
const dark = { ...defaults, ...tokens(styles.match(/\[data-color-scheme="dark"\]\s*\{([^}]+)\}/s)[1]) };

for (const [name, palette] of [["Default", defaults], ["Dark", dark]]) {
  const color = (token) => palette[token].replace(/var\((--[\w-]+)\)/g, (_, key) => color(key));
  test(`${name} labels, links, and selected Settings navigation meet normal-text contrast`, () => {
    for (const surface of ["--app-bg", "--chrome", "--chrome-strong", "--surface", "--surface-muted"]) {
      for (const foreground of ["--text-muted", "--text-faint", "--accent-text"]) {
        const ratio = chroma.contrast(color(foreground), color(surface));
        assert.ok(ratio >= 4.5, `${name} ${foreground} on ${surface}: ${ratio.toFixed(2)}:1`);
      }
      assert.ok(chroma.contrast(color("--focus"), color(surface)) >= 3, `${name} focus on ${surface}`);
    }
    assert.ok(chroma.contrast("white", color("--sel")) >= 4.5, `${name} selected navigation`);
  });
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeHtmlReferences,
  normalizeRootHtmlReferences,
} from "../custom-modules/bentopdf/scripts/html-paths.mjs";

test("BentoPDF root pages keep packaged asset references inside dist", async () => {
  const toolPage = [
    '<link rel="stylesheet" href="../../assets/style.css">',
    '<script src="../../assets/merge-pdf.js"></script>',
    '<script src="/assets/main.js"></script>',
    '<link rel="icon" href="/images/favicon.svg">',
    '<a href="../../index.html">Home</a>',
    '<a href="https://github.com/alam00000/bentopdf">GitHub</a>',
  ].join("\n");

  assert.equal(
    normalizeRootHtmlReferences(toolPage),
    [
      '<link rel="stylesheet" href="./assets/style.css">',
      '<script src="./assets/merge-pdf.js"></script>',
      '<script src="./assets/main.js"></script>',
      '<link rel="icon" href="./images/favicon.svg">',
      '<a href="./index.html">Home</a>',
      '<a href="https://github.com/alam00000/bentopdf">GitHub</a>',
    ].join("\n"),
  );
});

test("BentoPDF localized pages resolve flattened assets from their packaged depth", () => {
  assert.equal(
    normalizeHtmlReferences(
      '<link rel="stylesheet" href="../../assets/style.css"><a href="/ar/index.html">Home</a>',
      "../",
    ),
    '<link rel="stylesheet" href="../assets/style.css"><a href="../ar/index.html">Home</a>',
  );
});

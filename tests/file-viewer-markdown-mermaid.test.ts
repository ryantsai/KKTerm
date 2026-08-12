import assert from "node:assert/strict";
import test from "node:test";
import { isStandaloneMermaidDocument } from "../src/modules/workspace/connections/file-viewer/markdownMermaid.ts";

test("recognizes standalone Mermaid documents", () => {
  assert.equal(isStandaloneMermaidDocument("graph LR\nA --> B"), true);
  assert.equal(isStandaloneMermaidDocument("flowchart TD\nA --> B"), true);
  assert.equal(isStandaloneMermaidDocument("sequenceDiagram\nAlice->>Bob: Hello"), true);
});

test("recognizes standalone Mermaid documents after directives and frontmatter", () => {
  assert.equal(
    isStandaloneMermaidDocument("%%{init: { 'theme': 'dark' }}%%\ngraph LR\nA --> B"),
    true,
  );
  assert.equal(
    isStandaloneMermaidDocument("---\ntitle: Example\n---\ngraph LR\nA --> B"),
    true,
  );
});

test("does not treat ordinary or fenced Markdown as a standalone diagram", () => {
  assert.equal(isStandaloneMermaidDocument("# Graph LR\n\nA regular document."), false);
  assert.equal(isStandaloneMermaidDocument("```mermaid\ngraph LR\nA --> B\n```"), false);
  assert.equal(isStandaloneMermaidDocument("This paragraph mentions graph LR."), false);
});

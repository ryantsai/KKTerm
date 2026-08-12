import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/modules/workspace/connections/file-viewer/viewers/MarkdownViewer.tsx", import.meta.url),
  "utf8",
);

test("Markdown viewer lazily renders Mermaid fences in strict mode", () => {
  assert.match(source, /import\("mermaid"\)/);
  assert.match(source, /securityLevel: "strict"/);
  assert.match(source, /pre > code\.language-mermaid/);
  assert.match(source, /isStandaloneMermaidDocument\(text\)/);
  assert.match(source, /catch \{\s*\/\/ Keep the original fenced source visible/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL(
    "../src/modules/workspace/connections/file-viewer/viewers/TextCodeViewer.tsx",
    import.meta.url,
  ),
  "utf8",
);
const workspace = await readFile(
  new URL(
    "../src/modules/workspace/connections/file-viewer/FileViewerWorkspace.tsx",
    import.meta.url,
  ),
  "utf8",
);
const manual = await readFile(
  new URL("../docs/manual/03-connections.md", import.meta.url),
  "utf8",
);

test("Document text toolbar keeps new/open hidden and wires compact editor actions", () => {
  assert.doesNotMatch(source, /FilePlus|FolderOpen/);
  assert.match(source, /runCommand\(undo\)/);
  assert.match(source, /runCommand\(redo\)/);
  assert.match(source, /writeToClipboard/);
  assert.match(source, /readFromClipboard/);
  assert.match(source, /lineNumbersCompartment/);
  assert.match(source, /highlightWhitespace/);
  assert.match(source, /runCommand\(indentMore\)/);
  assert.match(source, /runCommand\(indentLess\)/);
  assert.match(source, /onCompare/);
  assert.match(workspace, /openCompareView/);
});

test("search icon exclusively controls the custom search and replace strip", () => {
  assert.match(source, /const \[searchOpen, setSearchOpen\] = useState\(false\)/);
  assert.match(source, /subbar=\{\s*searchOpen \?/);
  assert.match(source, /new SearchQuery/);
  assert.match(source, /runCommand\(replaceNext\)/);
  assert.match(source, /runCommand\(replaceAll\)/);
  assert.match(source, /caseSensitive/);
  assert.match(source, /wholeWord/);
  assert.match(source, /regexp/);
});

test("manual describes compact controls, conditional search, and paged large-file mode", () => {
  assert.match(manual, /New File and Open File are intentionally absent/);
  assert.match(manual, /only action that reveals the search\/replace strip/);
  assert.match(manual, /sparse line checkpoints/);
  assert.match(manual, /bounded 12-page cache/);
});

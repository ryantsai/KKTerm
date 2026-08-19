import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Connection Notes disable browser spellcheck and the WebView2 context menu", () => {
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  const codeBlock = read("src/modules/notes/NoteCodeBlockView.tsx");

  assert.match(editor, /spellcheck:\s*"false"/);
  assert.match(codeBlock, /<NodeViewContent<"code">[\s\S]*spellCheck=\{false\}/);

  const handler = editor.match(
    /function handleNoteLinkContextMenu\([\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(handler, "Notes must keep a single editor context-menu handler");
  const preventDefaultIndex = handler.indexOf("event.preventDefault()");
  const anchorLookupIndex = handler.indexOf("const anchor = linkAnchorFromEvent(event)");
  assert.ok(preventDefaultIndex >= 0, "Notes must suppress the native WebView2 menu");
  assert.ok(
    preventDefaultIndex < anchorLookupIndex,
    "the native menu must be suppressed for ordinary note content too",
  );
  assert.match(editor, /showNativeContextMenu\(items/);
});

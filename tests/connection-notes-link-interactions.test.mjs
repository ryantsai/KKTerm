import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Connection Note web links are visible and offer external-open paths", () => {
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  const popover = read("src/modules/notes/NoteLinkPopover.tsx");
  const css = read("src/modules/notes/notes.css");
  const manual = read("docs/manual/21-connection-notes.md");

  assert.match(editor, /openExternalUrl/);
  assert.ok(editor.includes("const candidate = /^https?:\\/\\//i.test(trimmed) ? trimmed : `https://${trimmed}`;"));
  assert.match(editor, /event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/);
  assert.match(editor, /showNativeContextMenu\(items/);
  assert.match(editor, /webview\.openExternally/);
  assert.match(popover, /className="note-link-popover kk-surface"/);
  assert.match(popover, /<Actions/);
  assert.match(popover, /<Field className="note-link-popover-field"/);
  assert.match(css, /\.note-editor-surface a\s*\{/);
  assert.match(css, /text-decoration:\s*none/);
  assert.match(css, /color:\s*var\(--notice-info\)/);
  assert.match(css, /\.note-link-popover-actions\s*\{[\s\S]*gap:\s*9px/);
  assert.match(css, /\.note-editor-sheet \.kk-dlg-head\s*\{[\s\S]*padding:\s*12px 22px 0/);
  assert.match(manual, /Ctrl-clicking \(Cmd-clicking on macOS\) or Shift-clicking/);
  assert.match(manual, /Right-clicking a link opens a native menu/);
});

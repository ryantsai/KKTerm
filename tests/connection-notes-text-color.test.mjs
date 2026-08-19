import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Connection Notes preserve and expose text color formatting", () => {
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  const toolbar = read("src/modules/notes/NoteToolbar.tsx");
  const html = read("src/modules/notes/noteHtml.ts");
  const picker = read("src/app/ui/ColorPalettePicker.tsx");
  const css = read("src/modules/notes/notes.css");
  const locale = read("src/i18n/locales/en.json");
  const manual = read("docs/manual/21-connection-notes.md");

  assert.match(editor, /import \{ Color, TextStyle \} from "@tiptap\/extension-text-style"/);
  assert.match(editor, /TextStyle,[\s\S]*Color,/);
  assert.match(toolbar, /ColorPalettePicker/);
  assert.match(toolbar, /notes\.toolbar\.textColor/);
  assert.match(toolbar, /\.setColor\(color\)/);
  assert.match(toolbar, /\.unsetColor\(\)/);
  assert.match(css, /\.note-tool-color \.color-palette-swatch\s*\{[\s\S]*width:\s*14px;[\s\S]*height:\s*14px/);
  assert.match(picker, /disabled\?: boolean/);
  assert.match(html, /NOTE_TEXT_COLOR_PATTERN/);
  assert.match(html, /isSafeNoteTextColor/);
  assert.match(locale, /"textColor": "Text color"/);
  assert.match(manual, /notes\.toolbar\.textColor/);
});

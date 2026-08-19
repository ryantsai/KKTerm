import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Connection Notes mask selected text and reveal it only for the open editor", () => {
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  const mask = read("src/modules/notes/noteMask.ts");
  const toolbar = read("src/modules/notes/NoteToolbar.tsx");
  const html = read("src/modules/notes/noteHtml.ts");
  const css = read("src/modules/notes/notes.css");
  const locale = read("src/i18n/locales/en.json");
  const manual = read("docs/manual/21-connection-notes.md");

  assert.match(editor, /NoteMask/);
  assert.match(editor, /revealedNoteMaskIdsRef/);
  assert.match(editor, /editor\.on\("transaction", syncNoteMasks\)/);
  assert.match(editor, /element\.animate\(/);
  assert.match(editor, /notes\.notice\.selectTextForMask/);
  assert.match(toolbar, /EyeOff/);
  assert.match(toolbar, /notes\.toolbar\.maskText/);
  assert.match(mask, /NOTE_MASK_ATTRIBUTE/);
  assert.match(mask, /NOTE_MASK_ID_ATTRIBUTE/);
  assert.match(mask, /name: "noteMask"/);
  assert.match(html, /NOTE_MASK_REVEALED_ATTRIBUTE/);
  assert.match(html, /NOTE_MASK_ID_ATTRIBUTE/);
  assert.match(css, /note-mask-speckles/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(locale, /"maskText": "Mask selected text"/);
  assert.match(locale, /"reveal": "Reveal masked text"/);
  assert.match(manual, /It is not encryption/);
  assert.match(manual, /remainder of that open window session/);
});

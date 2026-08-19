import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Connection Notes toolbar commands have matching editor extensions and rendering", () => {
  const toolbar = read("src/modules/notes/NoteToolbar.tsx");
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  const css = read("src/modules/notes/notes.css");
  const markdown = read("src/modules/notes/noteMarkdown.ts");
  const locale = read("src/i18n/locales/en.json");

  for (const command of [
    "toggleHeading",
    "toggleBold",
    "toggleItalic",
    "toggleUnderline",
    "toggleStrike",
    "toggleHighlight",
    "toggleCode",
    "toggleBulletList",
    "toggleOrderedList",
    "toggleTaskList",
    "toggleBlockquote",
    "toggleCodeBlock",
    "setHorizontalRule",
    "insertTable",
  ]) {
    assert.match(toolbar, new RegExp(`\\.${command}\\(`), `${command} must be wired`);
  }

  // Task lists are not part of StarterKit; both node extensions are required
  // for toggleTaskList() to exist and for its checkbox items to render.
  assert.match(editor, /TaskItem/);
  assert.match(editor, /TaskList/);
  assert.match(editor, /notes\.task\.checkboxLabel/);
  assert.match(css, /data-type="taskList"/);
  assert.match(css, /data-type="taskItem"/);
  assert.match(css, /list-style-type: disc/);
  assert.match(css, /list-style-type: decimal/);
  assert.match(markdown, /data-type.*taskItem/);
  assert.match(locale, /"checkboxLabel": "Task item checkbox"/);
});

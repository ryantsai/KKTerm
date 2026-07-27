import { readFileSync } from "node:fs";

const notesSource = readFileSync("src/modules/dashboard/widgets/builtin/notes/NotesWidget.tsx", "utf8");
const dashboardCss = readFileSync("src/modules/dashboard/dashboard.css", "utf8");
const customizeSource = readFileSync("src/modules/dashboard/edit/CustomizePopover.tsx", "utf8");
const catalogSource = readFileSync("src/modules/dashboard/edit/CatalogOverlay.tsx", "utf8");

for (const key of ["markdownEnabled", "foldCorner"]) {
  if (!notesSource.includes(key)) {
    throw new Error(`Notes widget settings should include ${key}.`);
  }
}

for (const corner of ["topRight", "topLeft", "bottomRight", "bottomLeft"]) {
  if (!notesSource.includes(`"${corner}"`)) {
    throw new Error(`Notes widget should support ${corner} folded-corner placement.`);
  }
}

if (!notesSource.includes("DOMPurify.sanitize") || !notesSource.includes("marked.parse")) {
  throw new Error("Notes markdown preview should render sanitized marked output.");
}

if (!notesSource.includes("markdownEnabled: true")) {
  throw new Error("Notes markdown rendering should default on.");
}

if (!notesSource.includes("contentEditable") || !notesSource.includes("TurndownService")) {
  throw new Error("Notes markdown mode should use a WYSIWYG editor that serializes edits back to Markdown.");
}

for (const command of ["formatBlock", "bold", "italic", "insertUnorderedList", "insertOrderedList"]) {
  if (!notesSource.includes(`"${command}"`)) {
    throw new Error(`Notes WYSIWYG toolbar should expose the ${command} formatting command.`);
  }
}

if (!notesSource.includes("dw-notes-format-toolbar") || !notesSource.includes("captureMarkdownSelection")) {
  throw new Error("Notes WYSIWYG formatting should preserve the active editor selection.");
}

if (!notesSource.includes("wrapper.replaceWith(list)")) {
  throw new Error("Notes WYSIWYG lists should not remain nested inside heading or paragraph wrappers.");
}

if (
  !dashboardCss.includes(".dw-notes-markdown ul {") ||
  !dashboardCss.includes("list-style-type: disc;") ||
  !dashboardCss.includes(".dw-notes-markdown ol {") ||
  !dashboardCss.includes("list-style-type: decimal;")
) {
  throw new Error("Notes WYSIWYG lists should restore visible markers after the global list-style reset.");
}

if (!dashboardCss.includes(".dw-notes-markdown h1,") || !dashboardCss.includes("font-weight: 700;")) {
  throw new Error("Notes WYSIWYG headings should have a visibly distinct heading weight.");
}

if (notesSource.includes("isEditingMarkdown") || notesSource.includes("<textarea") && !notesSource.includes("settings.markdownEnabled ?")) {
  throw new Error("Notes markdown mode should not switch back to a raw-source textarea for editing.");
}

if (!notesSource.includes("showNativeContextMenu") || !notesSource.includes('label: t("common.copy")')) {
  throw new Error("Notes selected text should expose a native Copy context-menu item.");
}

if (!customizeSource.includes("dashboard.notesMarkdownEnabled")) {
  throw new Error("Notes widget options should expose a markdown toggle.");
}

if (!customizeSource.includes("dashboard.notesFoldCorner")) {
  throw new Error("Notes widget options should expose folded-corner placement.");
}

if (!catalogSource.includes("randomNotesSettings()")) {
  throw new Error("New Notes widget instances should receive randomized note settings on creation.");
}

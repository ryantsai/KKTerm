import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const settingsSource = await readFile(
  new URL("../src/modules/workspace/connections/file-viewer/fileViewerTextSettings.ts", import.meta.url),
  "utf8",
);
const workspaceSource = await readFile(
  new URL("../src/modules/workspace/connections/file-viewer/FileViewerWorkspace.tsx", import.meta.url),
  "utf8",
);
const textViewerSource = await readFile(
  new URL("../src/modules/workspace/connections/file-viewer/viewers/TextCodeViewer.tsx", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../src/modules/workspace/connections/file-viewer/file-viewer.css", import.meta.url),
  "utf8",
);
const manual = await readFile(new URL("../docs/manual/03-connections.md", import.meta.url), "utf8");

test("Document text soft wrap defaults on and persists per Connection for the session", () => {
  assert.match(settingsSource, /export const DEFAULT_SOFT_WRAP = true;/);
  assert.match(settingsSource, /window\.sessionStorage\.getItem\(`\$\{SOFT_WRAP_SESSION_PREFIX\}\$\{connectionId\}`\)/);
  assert.match(settingsSource, /window\.sessionStorage\.setItem\(`\$\{SOFT_WRAP_SESSION_PREFIX\}\$\{connectionId\}`, String\(softWrap\)\)/);
  assert.doesNotMatch(settingsSource, /localStorage\.setItem\(`\$\{SOFT_WRAP_SESSION_PREFIX\}/);
});

test("Document text viewer receives and updates the soft-wrap pressed state", () => {
  assert.match(workspaceSource, /const \[softWrap, setSoftWrap\] = useState\(\(\) => loadDocumentSoftWrap\(connectionId\)\)/);
  assert.match(workspaceSource, /softWrap=\{softWrap\}/);
  assert.match(workspaceSource, /persistDocumentSoftWrap\(connectionId, next\)/);
  assert.match(textViewerSource, /const \[wrap, setWrap\] = useState\(softWrap\)/);
  assert.match(textViewerSource, /wrap \? EditorView\.lineWrapping : \[\]/);
});

test("Document toolbar keeps the action cluster stable with long file names", () => {
  assert.match(css, /\.fv-toolbar\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(css, /\.fv-file\s*\{[\s\S]*?flex:\s*1 1 180px;[\s\S]*?max-width:\s*340px;/);
  assert.match(css, /\.fv-tb-spacer\s*\{[\s\S]*?flex:\s*999 1 16px;[\s\S]*?min-width:\s*0;/);
  assert.match(css, /\.fv-tb-center\s*\{[\s\S]*?flex:\s*0 1 auto;[\s\S]*?overflow-x:\s*auto;/);
});

test("manual documents Document soft-wrap default and session scope", () => {
  assert.match(manual, /workspace\.fileViewer\.softWrap/);
  assert.match(manual, /Soft wrap defaults on/);
  assert.match(manual, /sessionStorage/);
});

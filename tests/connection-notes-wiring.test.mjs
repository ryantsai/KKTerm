import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every Connection pane toolbar can open a note", () => {
  // A note must be reachable from every Connection kind, not just terminals.
  const surfaces = [
    "src/modules/workspace/connections/terminal/TerminalWorkspace.tsx",
    "src/modules/workspace/connections/sftp/SftpWorkspace.tsx",
    "src/modules/workspace/connections/webview/WebViewWorkspace.tsx",
    "src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx",
  ];

  for (const surface of surfaces) {
    const source = read(surface);
    assert.match(source, /<NoteToolbarButton/, `${surface} should render the note control`);
    assert.match(
      source,
      /state\.openNoteEditor/,
      `${surface} should open the note editor through the workspace store`,
    );
  }
});

test("note content is sanitized on both the load and save paths", () => {
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  // Notes accept pasted web content, so nothing reaches the editor or the
  // database without passing through the sanitizer.
  assert.match(editor, /sanitizeNoteHtml\(note\.contentHtml\)/);
  assert.match(editor, /sanitizeNoteHtml\(dehydrateNoteAssets\(editor\.getHTML\(\)\)\)/);

  const html = read("src/modules/notes/noteHtml.ts");
  assert.match(html, /FORBID_TAGS:\s*\["script"/);
  assert.match(html, /ALLOW_DATA_ATTR:\s*false/);
});

test("saved note HTML never carries image bytes", () => {
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  // Images live in `note_assets`; the persisted body keeps only the asset id,
  // so the note row stays small and diffable.
  assert.match(editor, /dehydrateNoteAssets\(editor\.getHTML\(\)\)/);
  assert.match(editor, /pruneNoteAssets\(connectionId, collectNoteAssetIds\(html\)\)/);

  const html = read("src/modules/notes/noteHtml.ts");
  assert.match(html, /export function dehydrateNoteAssets/);
  assert.match(html, /image\.removeAttribute\("src"\)/);
  assert.match(html, /id\.startsWith\(`\$\{connectionId\}\/`\)/);
});

test("unsaved image assets neither bind a note nor survive discard", () => {
  const backend = read("src-tauri/src/storage/notes.rs");
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  assert.doesNotMatch(
    backend,
    /INSERT INTO connection_notes[\s\S]*ON CONFLICT\(connection_id\) DO NOTHING/,
    "uploading an image must not create the note row before Save",
  );
  assert.match(editor, /originalAssetIdsRef/);
  assert.match(editor, /Promise\.allSettled\(\[\.\.\.pendingImageUploadsRef\.current\]\)/);
  assert.match(editor, /pruneNoteAssets\(connectionId, originalAssetIdsRef\.current\)/);
});

test("pasted note HTML cannot retain remote images or arbitrary inline CSS", () => {
  const html = read("src/modules/notes/noteHtml.ts");
  assert.match(html, /NOTE_ASSET_ID_PATTERN/);
  assert.match(html, /image\.remove\(\)/);
  assert.match(html, /element\.removeAttribute\("style"\)/);
});

test("note sanitization preserves valid Deep Link targets for editor reload", () => {
  const html = read("src/modules/notes/noteHtml.ts");
  // DOMPurify classifies the colon in KKTerm's serialized target as a URI-like
  // value. The narrowly scoped hook is what keeps a valid chip from flattening
  // to its label when a saved note is opened again.
  assert.match(html, /isValidNoteDeepLinkTarget/);
  assert.match(html, /addHook\("uponSanitizeAttribute"/);
  assert.match(html, /data\.forceKeepAttr = true/);
  assert.match(html, /removeHook\("uponSanitizeAttribute"/);
});

test("note binding indicators refresh with durable Connection changes", () => {
  const app = read("src/App.tsx");
  assert.match(app, /addEventListener\("kkterm:connection-tree-invalidated", refresh\)/);
  assert.match(app, /removeEventListener\("kkterm:connection-tree-invalidated", refresh\)/);
});

test("deleting a Connection removes its note and images explicitly", () => {
  // `connection_notes.connection_id` is a soft reference, because the legacy
  // v20/v25 `connections` rebuilds rewrite dependent FK clauses to the scratch
  // table name. The explicit delete is what keeps notes from being orphaned.
  const schema = read("src-tauri/src/storage.rs");
  assert.doesNotMatch(
    schema,
    /CREATE TABLE IF NOT EXISTS connection_notes \(\n\s*connection_id TEXT PRIMARY KEY REFERENCES connections/,
    "connection_notes must not carry a foreign key into connections",
  );

  const connections = read("src-tauri/src/storage/connections.rs");
  assert.match(
    connections,
    /DELETE FROM connection_notes WHERE connection_id = \?1/,
    "delete_connection must remove the Connection's note",
  );
  assert.match(
    connections,
    /remove_note_images_for\(&connection_id\)/,
    "delete_connection must remove the Connection's note images",
  );
});

test("note images live on the filesystem and ride the settings backup", () => {
  const notes = read("src-tauri/src/storage/notes.rs");
  // Images are files, not BLOBs, so the database stays small and the bytes are
  // covered by the same backup/export path as Assistant chats.
  assert.match(notes, /NOTE_IMAGES_DIR: &str = "note-images"/);
  assert.match(notes, /fn write_file_atomically/);

  const schema = read("src-tauri/src/storage.rs");
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS note_assets/);
  assert.match(
    schema,
    /add_directory_to_settings_zip\(\s*&mut zip,\s*&self\.note_images_dir\(\),/,
    "the settings backup must include the note image directory",
  );
  assert.match(
    schema,
    /validated_note_image_import_path/,
    "imports must validate note image paths before extracting them",
  );
});

test("note commands are granted to the main window permission set", () => {
  // A missing grant compiles fine and fails silently at Tauri's IPC ACL.
  const permissions = read("src-tauri/permissions/main.toml");
  for (const command of [
    "get_connection_note",
    "list_connection_note_ids",
    "save_connection_note",
    "delete_connection_note",
    "put_note_asset",
    "get_note_asset",
    "prune_note_assets",
  ]) {
    assert.match(permissions, new RegExp(`"${command}"`), `${command} needs an ACL grant`);
  }
});

test("Markdown export writes the same body shape the database stores", () => {
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  // Export must not be a second, looser serialization path: it reuses the save
  // path's sanitize + dehydrate pair, so an exported file can no more carry
  // image bytes or unsanitized pasted markup than a saved note can.
  assert.match(
    editor,
    /noteHtmlToMarkdown\(sanitizeNoteHtml\(dehydrateNoteAssets\(editor\.getHTML\(\)\)\)\)/,
  );

  const markdown = read("src/modules/notes/noteMarkdown.ts");
  assert.match(markdown, /NOTE_IMAGE_DIRECTORY = "note-images"/);

  const toolbar = read("src/modules/notes/NoteToolbar.tsx");
  assert.match(toolbar, /notes\.toolbar\.exportMarkdown/);
});

test("the @ trigger and the toolbar picker share one Deep Link source", () => {
  // Two surfaces offering different targets would be a silent inconsistency,
  // so both must read the same choice list and the same ranking.
  const picker = read("src/modules/notes/NoteDeepLinkPicker.tsx");
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  for (const [name, source] of [["picker", picker], ["editor", editor]]) {
    assert.match(
      source,
      /from "\.\/noteDeepLinkChoices"/,
      `${name} should read Deep Link targets from the shared source`,
    );
  }
  assert.match(picker, /filterNoteDeepLinkChoices/);
  assert.match(editor, /filter: filterNoteDeepLinkChoices/);
});

test("the @ trigger uses the maintained suggestion plugin for IME safety", () => {
  const suggestion = read("src/modules/notes/noteDeepLinkSuggestion.ts");
  // A hand-rolled `@` watcher mis-fires during CJK composition, which matters
  // for the locales KKTerm ships.
  assert.match(suggestion, /from "@tiptap\/suggestion"/);
  assert.match(suggestion, /char: "@"/);

  // The menu must not portal itself out of the editor Sheet: it relies on
  // `.kk-dlg-backdrop` already being registered for native-surface suppression.
  const menu = read("src/modules/notes/NoteDeepLinkMenu.tsx");
  assert.doesNotMatch(menu, /createPortal|DialogPortal/);
});

test("Deep Link navigation uses a target-specific close confirmation", () => {
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");

  // A dirty Deep Link closes the editor after confirmation, so the prompt must
  // describe the close/open transition instead of falsely asserting that the
  // note currently has unsaved changes.
  assert.match(editor, /data-note-label/);
  assert.match(editor, /editor\.commands\.setContent\("", \{ emitUpdate: false \}\)/);
  assert.match(editor, /editor\.commands\.setContent\(html, \{ emitUpdate: false \}\)/);
  assert.match(editor, /pendingDeepLinkRef\.current = \{ link, label: targetLabel \}/);
  assert.match(editor, /notes\.confirmDeepLink\.title/);
  assert.match(editor, /notes\.confirmDeepLink\.message/);
  assert.match(editor, /notes\.confirmDeepLink\.confirm/);
  assert.match(editor, /notes\.confirmDiscard\.title/);
});

test("web links use an in-editor add and edit surface", () => {
  const editor = read("src/modules/notes/NoteEditorSheet.tsx");
  const popover = read("src/modules/notes/NoteLinkPopover.tsx");
  const css = read("src/modules/notes/notes.css");

  // A selected label must open a form for its URL, while an existing link must
  // be editable by clicking or right-clicking it instead of silently doing
  // nothing or invoking a browser prompt.
  assert.match(editor, /NoteLinkPopover/);
  assert.match(editor, /handleNoteLinkClick/);
  assert.match(editor, /handleNoteLinkContextMenu/);
  assert.match(editor, /insertContentAt/);
  assert.match(editor, /setTextSelection/);
  assert.doesNotMatch(editor, /window\.prompt/);
  assert.match(popover, /data-note-link-popover/);
  assert.match(popover, /notes\.linkPopover\.textLabel/);
  assert.match(popover, /notes\.linkPopover\.urlLabel/);
  assert.match(css, /\.note-editor-eyebrow\s*\{[\s\S]*display:\s*inline-flex/);
});

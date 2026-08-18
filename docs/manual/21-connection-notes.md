# 21 — Connection Notes

## AI grep hints

- Keys: `notes.*` (full namespace), `notes.deepLink.menuLabel`, `notes.deepLink.triggerHint`, `notes.toolbarButton.open`, `notes.toolbarButton.create`, `notes.toolbar.label`, `notes.toolbar.insertImage`, `notes.toolbar.insertLink`, `notes.toolbar.insertDeepLink`, `notes.toolbar.search`, `notes.search.placeholder`, `notes.search.replace`, `notes.search.replaceAll`, `notes.editor.title`, `notes.editor.delete`, `notes.editor.resizeDialog`, `notes.deepLink.title`, `notes.deepLink.searchPlaceholder`, `notes.confirmDelete.title`, `notes.confirmDiscard.title`, `notes.notice.saved`, `notes.notice.deleted`, `notes.notice.deepLinkUnavailable`, `dashboard.notesAddTableRow`, `dashboard.notesDeleteTableRow`, `dashboard.notesAddTableColumn`, `dashboard.notesDeleteTableColumn`, `dashboard.notesDeleteTable`
- Files: `src/modules/notes/` (editor, toolbar, search, Deep Link picker, asset handling), `src-tauri/src/storage/notes.rs` (backend), entry points in `src/modules/workspace/connections/terminal/TerminalWorkspace.tsx`, `src/modules/workspace/connections/sftp/SftpWorkspace.tsx`, `src/modules/workspace/connections/webview/WebViewWorkspace.tsx`, and `src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx`
- Topics: per-Connection notes, rich text, WYSIWYG, HTML notes, note images, note search, find and replace in a note, Deep Links from a note, @ mention trigger, note deletion
- Synonyms: "sticky note on a connection", "server notes", "document a host", "remember the restart command", "where is the VM directory", "annotate a connection", "at mention", "link to another connection from a note"
- Tutorial targets: `notes.openNote`

## What a Connection Note is

A **Connection Note** is one rich-text note bound to a single **Connection**. It is the place to record the operational detail that does not belong in the Connection's settings — where a virtual machine's directory lives, which command restarts a service, which colleague owns the box.

Each Connection has at most one note. Notes are stored in SQLite alongside the rest of the non-secret durable data, so they are covered by the normal backup and export flows described in [17-data-backup-secrets.md](17-data-backup-secrets.md).

> Notes are not a secret store. Passwords belong in a **Saved Credential** (see [15-settings.md](15-settings.md) → Credentials), which keeps the secret in the OS keychain. Anything typed into a note is stored as ordinary text in the database.

A Connection Note is distinct from the **Notes** Dashboard widget, which is a free-floating sticky note on a Dashboard View and is not bound to any Connection. See [10-dashboard.md](10-dashboard.md).

## Opening a note

Every Connection Pane toolbar carries the note control (`notes.openNote`):

- **Terminal Panes** — local, SSH, Telnet, and Serial, in the Pane action row, directly left of the AI Assistant control.
- **SFTP / FTP browser** — in the toolbar's right-hand group.
- **URL Connections** — in the toolbar's action group, directly left of the AI Assistant control.
- **RDP and VNC Connections** — in the Pane action row, directly left of the AI Assistant control.

The control shows one of two states, so a documented Connection is recognizable without opening anything:

- `notes.toolbarButton.create` — this Connection has no note yet.
- `notes.toolbarButton.open` — this Connection already owns a note, and the control's glyph tints amber, like a Post-it — no background badge.

The editor window itself is resizable: drag its bottom-right corner (`notes.editor.resizeDialog`; Arrow keys with the handle focused also work) to change its size. The dragged size is remembered in `localStorage` and reused the next time any note is opened.

## Creating, saving, and deleting

The lifecycle is deliberately explicit: **saving is what binds a note to its Connection.**

1. Open the control on a Connection with no note. The editor opens on a blank note.
2. Type. Nothing is written yet — closing now leaves the Connection noteless.
3. Press `common.save`. The note is created and bound; the toolbar control switches to its bound state and a `notes.notice.saved` confirmation appears in the Status Bar.
4. Re-opening the control on a bound Connection loads the saved note for viewing and editing.
5. `notes.editor.delete` (shown only once a note exists) unbinds and deletes the note after a `notes.confirmDelete.title` confirmation. The note and its embedded images are removed permanently.

Closing the editor with unsaved edits raises `notes.confirmDiscard.title` rather than discarding silently. Discarding also removes images added during that editing pass while preserving the images referenced by the last saved version.

Deleting a Connection deletes its note and images with it.

## Formatting

The toolbar (`notes.toolbar.label`) covers:

- **History** — `notes.toolbar.undo`, `notes.toolbar.redo`.
- **Blocks** — `notes.toolbar.heading1` … `notes.toolbar.heading3`, `notes.toolbar.blockquote`, `notes.toolbar.codeBlock`, `notes.toolbar.horizontalRule`.
- **Inline styles** — `notes.toolbar.bold`, `notes.toolbar.italic`, `notes.toolbar.underline`, `notes.toolbar.strikethrough`, `notes.toolbar.highlight`, `notes.toolbar.inlineCode`.
- **Lists** — `notes.toolbar.bulletList`, `notes.toolbar.orderedList`, `notes.toolbar.taskList` (checkable items).
- **Tables** — `notes.toolbar.insertTable` inserts a 3×3 table with a header row; columns are resizable. Right-clicking inside a cell opens a menu (the same row/column vocabulary as the Dashboard Notes widget: `dashboard.notesAddTableRow`, `dashboard.notesDeleteTableRow`, `dashboard.notesAddTableColumn`, `dashboard.notesDeleteTableColumn`, `dashboard.notesDeleteTable`) to add or delete rows and columns, or remove the whole table.

## Images

`notes.toolbar.insertImage` opens a file picker for PNG, JPEG, GIF, or WebP. Images can also be **pasted** or **dragged** straight onto the note.

Images are stored as **files on disk**, under a `note-images/` directory beside the KKTerm database, not inlined into the note text and not inside the database. Identical images added twice are stored once. Images wider or taller than 1600 px are downscaled on the way in; animated GIFs are stored unchanged so they keep their frames. An image added and then removed before saving is discarded when the note is saved.

Hovering an image reveals a drag handle at its bottom-right corner; dragging it resizes the image inline. The chosen width is stored on the image itself and is preserved on save/reload.

Because they are ordinary files in the app data directory, note images are included in the settings export (`.kkbackup`) and in the startup backup ZIP snapshots, and they are restored with them — see [17-data-backup-secrets.md](17-data-backup-secrets.md). Deleting a note or its Connection deletes that Connection's image directory.

> Selective export bundles carry the note **text** with the Connection, but not its images: the selective bundle format is a database extract and does not include app-data files. Use the full settings export to move notes with their images.

## Links

Two different link controls exist, and they do different things:

- `notes.toolbar.insertLink` — an ordinary **web link**. Select text that is an `http://` or `https://` address and press the control. With a link already selected, the control removes it. Selecting non-URL text produces the `notes.notice.selectUrlForLink` hint.
- `notes.toolbar.insertDeepLink` — a **Deep Link** to another element inside KKTerm.

### Deep Links

A Deep Link turns a note into a hub. There are two ways to insert one, and both offer exactly the same targets:

- **Type `@` in the note.** A suggestion menu (`notes.deepLink.menuLabel`) opens at the caret and narrows as you keep typing. `ArrowUp` / `ArrowDown` move the highlight, `Enter` or `Tab` inserts the highlighted target, and `Escape` dismisses the menu. Clicking an entry inserts it too. The inserted chip is followed by a space so you can keep typing. `@` only triggers at the start of a word, so an email address typed into a note stays plain text.
- **Use the toolbar.** `notes.toolbar.insertDeepLink` opens the `notes.deepLink.title` picker (`notes.deepLink.searchPlaceholder`), which also names the `@` shortcut (`notes.deepLink.triggerHint`).

Both list three kinds of target:

| Target | Effect when clicked |
|--------|---------------------|
| `notes.deepLink.kind.connection` | Opens that Connection's Session and shows the Workspace. If a Tab for it is already open, that Tab is activated instead. |
| `notes.deepLink.kind.workspace` | Switches the active Workspace and shows the Workspace Module. |
| `notes.deepLink.kind.rackItem` | Opens the IT Ops Module at the owning Site and rack, with that rack device's dialog open. See [12-it-ops.md](12-it-ops.md). |

Connections from **every** Workspace are listed, not just the active one, so a note can point anywhere in the app.

Clicking a Deep Link chip inside a note follows it and closes the note editor. If the note has unsaved changes, `notes.confirmDiscard.title` asks before closing. A chip keeps the label captured when it was inserted, so a note still reads sensibly after the target is renamed; following a chip whose target has since been deleted reports `notes.notice.deepLinkUnavailable`, leaves the note open, and flattens that one chip into plain text (its captured label) in place, since a permanently dead-looking colored chip is worse than the plain text it displays. This edit is unsaved like any other — `notes.confirmDiscard.title` still guards closing without saving.

## Searching inside a note

`notes.toolbar.search` opens the find/replace bar:

- Type in `notes.search.placeholder` to highlight every match; the active match is highlighted more strongly.
- `notes.search.matchCount` shows the position and total. `Enter` steps forward, `Shift+Enter` steps back, and the arrow controls do the same.
- `notes.search.caseSensitive` toggles case matching.
- `notes.search.replace` replaces the active match; `notes.search.replaceAll` replaces every match in one undoable step.
- `Escape` or the close control dismisses the bar and clears the highlight.

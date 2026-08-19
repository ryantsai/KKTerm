# 21 — Connection Notes

## AI grep hints

- Keys: `notes.*` (full namespace), `notes.deepLink.menuLabel`, `notes.deepLink.triggerHint`, `notes.toolbarButton.open`, `notes.toolbarButton.create`, `notes.toolbar.label`, `notes.toolbar.highlight`, `notes.toolbar.textColor`, `notes.toolbar.maskText`, `notes.mask.reveal`, `notes.task.checkboxLabel`, `notes.toolbar.insertImage`, `notes.toolbar.insertLink`, `notes.toolbar.insertDeepLink`, `notes.toolbar.exportMarkdown`, `notes.toolbar.search`, `notes.search.placeholder`, `notes.search.replace`, `notes.search.replaceAll`, `notes.editor.title`, `notes.editor.eyebrow`, `notes.editor.delete`, `notes.editor.resizeDialog`, `notes.editor.sendCodeToTerminal`, `notes.deepLink.title`, `notes.deepLink.searchPlaceholder`, `notes.confirmDelete.title`, `notes.confirmDiscard.title`, `notes.export.dialogTitle`, `notes.export.filterName`, `notes.notice.saved`, `notes.notice.deleted`, `notes.notice.exported`, `notes.notice.deepLinkUnavailable`, `notes.notice.selectTextForMask`, `notes.notice.sendToTerminalUnavailable`, `webview.openExternally`, `dashboard.notesAddTableRow`, `dashboard.notesDeleteTableRow`, `dashboard.notesAddTableColumn`, `dashboard.notesDeleteTableColumn`, `dashboard.notesDeleteTable`
- Files: `src/modules/notes/` (editor, toolbar, search, Deep Link picker, asset handling), `src-tauri/src/storage/notes.rs` (backend), entry points in `src/modules/workspace/connections/terminal/TerminalWorkspace.tsx`, `src/modules/workspace/connections/sftp/SftpWorkspace.tsx`, `src/modules/workspace/connections/webview/WebViewWorkspace.tsx`, and `src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx`
- Topics: per-Connection notes, rich text, WYSIWYG, HTML notes, text color, masked text, session-only reveal, note images, note search, find and replace in a note, web links, external browser, Deep Links from a note, @ mention trigger, note deletion, exporting a note to Markdown
- Synonyms: "sticky note on a connection", "server notes", "document a host", "remember the restart command", "where is the VM directory", "annotate a connection", "at mention", "link to another connection from a note", "save a note as a .md file", "share a note with someone outside KKTerm"
- Tutorial targets: `notes.openNote`

## What a Connection Note is

A **Connection Note** is one rich-text note bound to a single **Connection**. It is the place to record the operational detail that does not belong in the Connection's settings — where a virtual machine's directory lives, which command restarts a service, which colleague owns the box.

Each Connection has at most one note. Notes are stored in SQLite alongside the rest of the non-secret durable data, so they are covered by the normal backup and export flows described in [17-data-backup-secrets.md](17-data-backup-secrets.md).

> Notes are not a secret store. Passwords belong in a **Saved Credential** (see [15-settings.md](15-settings.md) → Credentials), which keeps the secret in the OS keychain. Anything typed into a note is stored as ordinary text in the database.

The mask control changes only how selected text is painted on screen. It is not encryption, does not move the text into the credential store, and does not prevent the underlying text from being saved or exported. A masked range starts hidden each time the note window opens; clicking it once reveals it for the remainder of that open window session.

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

The editor window's header carries a small `notes.editor.eyebrow` icon+label in the top-left corner, identifying the dialog as a note. The centered title is the Connection's own icon (its Connection Tree glyph) followed by the Connection's name, not a generic "Note" caption.

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
- **Inline styles** — `notes.toolbar.bold`, `notes.toolbar.italic`, `notes.toolbar.underline`, `notes.toolbar.strikethrough`, `notes.toolbar.highlight`, `notes.toolbar.textColor`, `notes.toolbar.maskText`, `notes.toolbar.inlineCode`. The text-color picker applies a custom color to the selection; `common.clear` restores the default text color. The mask control hides selected text behind animated speckles; clicking a masked range reveals it for the remainder of the current note-window session, while selecting it and pressing the control again removes the mask. `notes.notice.selectTextForMask` appears if there is no selection.
- **Lists** — `notes.toolbar.bulletList`, `notes.toolbar.orderedList`, `notes.toolbar.taskList` (checkable items). Checklist boxes can be toggled directly in the editor and their checked state is saved and exported.
- **Tables** — `notes.toolbar.insertTable` inserts a 3×3 table with a header row; columns are resizable. Right-clicking inside a cell opens a menu (the same row/column vocabulary as the Dashboard Notes widget: `dashboard.notesAddTableRow`, `dashboard.notesDeleteTableRow`, `dashboard.notesAddTableColumn`, `dashboard.notesDeleteTableColumn`, `dashboard.notesDeleteTable`) to add or delete rows and columns, or remove the whole table.

### Sending a code block to the terminal

When the note's own Connection is a terminal type (local, SSH, Telnet, or Serial), hovering a `notes.toolbar.codeBlock` reveals a `notes.editor.sendCodeToTerminal` button in its top-right corner. Clicking it types the block's text into that Connection's open terminal Pane — one line at a time, each followed by Enter, the same payload shape Quick Commands use. The button does not appear for notes bound to non-terminal Connections (RDP, VNC, SFTP/FTP, URL). If the Connection has no open terminal Pane, `notes.notice.sendToTerminalUnavailable` reports it in the Status Bar instead of sending anything.

## Images

`notes.toolbar.insertImage` opens a file picker for PNG, JPEG, GIF, or WebP. Images can also be **pasted** or **dragged** straight onto the note.

Images are stored as **files on disk**, under a `note-images/` directory beside the KKTerm database, not inlined into the note text and not inside the database. Identical images added twice are stored once. Images wider or taller than 1600 px are downscaled on the way in; animated GIFs are stored unchanged so they keep their frames. An image added and then removed before saving is discarded when the note is saved.

Hovering an image reveals a drag handle at its bottom-right corner; dragging it resizes the image inline. The chosen width is stored on the image itself and is preserved on save/reload.

Because they are ordinary files in the app data directory, note images are included in the settings export (`.kkbackup`) and in the startup backup ZIP snapshots, and they are restored with them — see [17-data-backup-secrets.md](17-data-backup-secrets.md). Deleting a note or its Connection deletes that Connection's image directory.

> Selective export bundles carry the note **text** with the Connection, but not its images: the selective bundle format is a database extract and does not include app-data files. Use the full settings export to move notes with their images.

## Exporting a note to Markdown

`notes.toolbar.exportMarkdown`, at the right end of the toolbar next to the search control, writes the note to a `.md` file of your choosing (`notes.export.dialogTitle`, `notes.export.filterName`). It exports **what is currently in the editor**, saved or not, so a note you are still drafting can be handed off; the export changes nothing about the note itself and never binds an unsaved note to its Connection. The default file name is the Connection's name. On success `notes.notice.exported` reports the path in the Status Bar; a failed write reports `notes.notice.exportFailed`. The control is unavailable while the note is loading and on an empty note.

Headings, bold/italic, inline code, code blocks, quotes, dividers, bulleted and numbered lists, checklists (as `- [x]` / `- [ ]`), strikethrough, web links, and tables (as GitHub-flavored Markdown tables) all carry over. Underline, text color, `notes.toolbar.maskText`, and `notes.toolbar.highlight` have no Markdown equivalent and export as their underlying plain text. A Deep Link chip exports as the label it displays, because the link only resolves inside KKTerm.

**Images are not exported.** They stay where they live — files under `note-images/` in the app data directory — and the Markdown keeps a reference to each one in that directory instead, in the form `![alt](note-images/<connection id>/<file>.png)`. The exported file therefore records which image was where without copying the bytes; to move notes together with their images, use the full settings export described in [17-data-backup-secrets.md](17-data-backup-secrets.md).

## Links

Two different link controls exist, and they do different things:

- `notes.toolbar.insertLink` — an ordinary **web link**. Select any text and press the control to open the in-editor link form (`notes.linkPopover.textLabel` and `notes.linkPopover.urlLabel`), then enter a web address. If the address does not start with `http://` or `https://`, KKTerm assumes `https://` when saving it. Links are shown in a clear blue without an underline. Clicking an existing web link opens the same form so both the visible text and destination can be edited. Ctrl-clicking (Cmd-clicking on macOS) or Shift-clicking a link opens it in the OS default browser through `webview.openExternally`. Right-clicking a link opens a native menu with the same external-open action and an edit action. `common.remove` removes an existing link without removing its text. An unsupported destination reports `notes.notice.invalidLinkUrl` in the Status Bar.
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

Clicking a Deep Link chip inside a note follows it and closes the note editor. If the note has unsaved changes, the target-specific confirmation `notes.confirmDeepLink.title` / `notes.confirmDeepLink.message` names the destination and explains that any unsaved changes will be lost; `notes.confirmDeepLink.confirm` continues to the target. Cancel keeps the note open. Closing the editor by another path still uses `notes.confirmDiscard.title`. A chip keeps the label captured when it was inserted, so a note still reads sensibly after the target is renamed; following a chip whose target has since been deleted reports `notes.notice.deepLinkUnavailable`, leaves the note open, and flattens that one chip into plain text (its captured label) in place, since a permanently dead-looking colored chip is worse than the plain text it displays. This edit is unsaved like any other — `notes.confirmDiscard.title` still guards closing without saving.

## Searching inside a note

`notes.toolbar.search` opens the find/replace bar:

- Type in `notes.search.placeholder` to highlight every match; the active match is highlighted more strongly.
- `notes.search.matchCount` shows the position and total. `Enter` steps forward, `Shift+Enter` steps back, and the arrow controls do the same.
- `notes.search.caseSensitive` toggles case matching.
- `notes.search.replace` replaces the active match; `notes.search.replaceAll` replaces every match in one undoable step.
- `Escape` or the close control dismisses the bar and clears the highlight.

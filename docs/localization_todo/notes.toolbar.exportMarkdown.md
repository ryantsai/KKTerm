# notes.toolbar.exportMarkdown

- **English value**: `Export to Markdown`
- **Namespace**: `notes`
- **File/component**: `src/modules/notes/NoteToolbar.tsx`
- **UI role**: `tooltip`
- **User flow**: The tooltip and accessible label of the download control at the right end of the Connection Note editor's formatting toolbar, next to find/replace. Pressing it opens a native save dialog and writes the note to a .md file.
- **Tone**: concise/neutral, matching the sibling toolbar control labels such as `notes.toolbar.insertImage` and `notes.toolbar.search`.
- **Placeholders**: none
- **Context/meaning**: "Export" here means writing the note out to a file on disk that the user chooses — not copying to the clipboard, not sharing, and not the settings backup/export flow. "Markdown" is the file format and stays English in every locale.
- **Domain notes**: A Connection Note is one rich-text note bound to a Connection; use the locale's existing word for a note (the same one used in `notes.editor.delete`). Markdown stays English. Match the locale's established word for export, e.g. the one used in `dashboard.exportWidget` / `itops.actions.export`; zh-TW must use 匯出, never 导出/導出.

<!--
Filename: notes.toolbar.exportMarkdown.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

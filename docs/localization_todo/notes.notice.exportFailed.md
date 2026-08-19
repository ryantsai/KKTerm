# notes.notice.exportFailed

- **English value**: `The note could not be exported. {{error}}`
- **Namespace**: `notes`
- **File/component**: `src/modules/notes/NoteEditorSheet.tsx`
- **UI role**: `error`
- **User flow**: An error notice in the bottom Status Bar popup when writing the exported Markdown file fails, for example on a read-only destination. `{{error}}` carries the underlying message.
- **Tone**: factual failure report, matching `notes.notice.saveFailed` and `notes.notice.deleteFailed` in the same locale.
- **Placeholders**: `{{error}}` — the raw underlying error text, appended after the sentence. Exactly one occurrence; it must survive verbatim.
- **Context/meaning**: Failure of the file-export action, not of saving the note into the database (`notes.notice.saveFailed`). The two must read differently.
- **Domain notes**: "Note" is the Connection Note. Reuse the locale's phrasing pattern from `notes.notice.saveFailed` so the two errors stay consistent. zh-TW must use 匯出 and 筆記.

<!--
Filename: notes.notice.exportFailed.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

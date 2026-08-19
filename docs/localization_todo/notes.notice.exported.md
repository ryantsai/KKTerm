# notes.notice.exported

- **English value**: `Note exported to {{path}}.`
- **Namespace**: `notes`
- **File/component**: `src/modules/notes/NoteEditorSheet.tsx`
- **UI role**: `status`
- **User flow**: A success notice in the bottom Status Bar popup right after the user picks a destination and the note is written to disk. `{{path}}` is the full file path the user chose.
- **Tone**: short confirmation, matching the sibling `notes.notice.saved` and `notes.notice.deleted`.
- **Placeholders**: `{{path}}` — the absolute file path the note was written to. Exactly one occurrence; it must survive verbatim.
- **Context/meaning**: Reports a completed write to a file the user chose. Not the settings backup/export, and not an in-app save (that is `notes.notice.saved`).
- **Domain notes**: "Note" is the Connection Note. Keep one full sentence around the placeholder rather than concatenating fragments. zh-TW must use 匯出 and 筆記.

<!--
Filename: notes.notice.exported.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

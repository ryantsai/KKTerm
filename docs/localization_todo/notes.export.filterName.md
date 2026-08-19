# notes.export.filterName

- **English value**: `Markdown file`
- **Namespace**: `notes`
- **File/component**: `src/modules/notes/NoteEditorSheet.tsx`
- **UI role**: `label`
- **User flow**: The file-type filter label shown in the operating system's save dialog when exporting a Connection Note, alongside the `.md` extension.
- **Tone**: short noun phrase, matching how the locale names other file-type filters (see `terminal.logFiles`, `terminal.textFiles`).
- **Placeholders**: none
- **Context/meaning**: Names a file type in a file picker filter, not an action. Singular "file" is intentional; follow the locale convention for filter labels even if that is plural.
- **Domain notes**: Markdown stays English as a format name. zh-TW must use 檔案 for "file", never 文件.

<!--
Filename: notes.export.filterName.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

# notes.confirmDeepLink.message

- **English value**: `Closing this note will open “{{target}}”. Any unsaved changes will be lost. Do you want to continue?`
- **Namespace**: `notes`
- **File/component**: `src/modules/notes/NoteEditorSheet.tsx`
- **UI role**: `warning`
- **User flow**: Body copy for the Deep Link confirmation sheet. It names the captured target label and explains that closing the note is part of navigation.
- **Tone**: direct, easy-to-understand caution
- **Placeholders**: `{{target}}` — the human-readable label captured by the Deep Link chip. Exactly one occurrence; it must survive verbatim.
- **Context/meaning**: Conditional-loss warning for moving from the Connection Note editor to another KKTerm destination. It must not claim that unsaved changes definitely exist; it warns that any such changes would be lost.
- **Domain notes**: “This note” means the Connection Note editor window. Targets may be Connections, Workspaces, or IT Ops rack devices. Preserve the placeholder as a named token so locales can place the target naturally.

<!--
Filename: notes.confirmDeepLink.message.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

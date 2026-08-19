# notes.confirmDeepLink.confirm

- **English value**: `Open`
- **Namespace**: `notes`
- **File/component**: `src/modules/notes/NoteEditorSheet.tsx`
- **UI role**: `button`
- **User flow**: Primary action on the Deep Link confirmation sheet. It closes the note editor and opens the selected target.
- **Tone**: concise/action-oriented
- **Placeholders**: none
- **Context/meaning**: Open the selected in-app Deep Link target, not open a file or launch an external web URL.
- **Domain notes**: The target may be a Connection, Workspace, or IT Ops rack device. Keep the action distinct from the ordinary `notes.confirmDiscard.confirm` action, which discards note edits.

<!--
Filename: notes.confirmDeepLink.confirm.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

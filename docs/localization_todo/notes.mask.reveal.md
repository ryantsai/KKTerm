# notes.mask.reveal

- **English value**: `Reveal masked text`
- **Namespace**: `notes`
- **File/component**: `src/modules/notes/NoteEditorSheet.tsx`
- **UI role**: `tooltip`
- **User flow**: The label is exposed as the accessible name and tooltip for a masked text range. Activating that range reveals its text for the rest of the open note-window session.
- **Tone**: concise/neutral
- **Placeholders**: none
- **Context/meaning**: Reveal text hidden by the Connection Notes visual mask, not decrypt a secret or open a separate credential.
- **Domain notes**: The reveal is session-local; closing and reopening the note masks the range again.

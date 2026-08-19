# notes.notice.invalidLinkUrl

- **English value**: `Enter a valid web address, such as example.com.`
- **Namespace**: `notes`
- **File/component**: `src/modules/notes/NoteEditorSheet.tsx`
- **UI role**: `status`
- **User flow**: The Status Bar reports this message when the user saves a Notes web link that cannot be parsed as an HTTP or HTTPS address. Bare host names are accepted and saved with an `https://` prefix.
- **Tone**: direct setup guidance
- **Placeholders**: none
- **Context/meaning**: A web address for an external link, such as example.com; this message is not asking for a full URL scheme.
- **Domain notes**: HTTP and HTTPS are the only supported external link protocols in Connection Notes.

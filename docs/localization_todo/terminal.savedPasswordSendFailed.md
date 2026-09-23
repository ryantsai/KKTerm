# terminal.savedPasswordSendFailed

- **English value**: `Could not send saved password: {{message}}`
- **Namespace**: `terminal`
- **File/component**: `src/modules/workspace/connections/terminal/TerminalWorkspace.tsx`
- **UI role**: `error`
- **User flow**: Status Bar error if the stored password could not be sent to the active Session.
- **Tone**: concise and neutral
- **Placeholders**: {{message}}
- **Context/meaning**: The message is an error detail and must not include the password.
- **Domain notes**: Saved Credentials store terminal Connection passwords in the configured secret backend; SSH, Telnet, sudo, and su stay as technical terms.

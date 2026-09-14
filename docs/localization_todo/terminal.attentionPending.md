# terminal.attentionPending

- **English value**: `Terminal rang`
- **Namespace**: `terminal`
- **File/component**: `src/modules/workspace/TerminalAttention.tsx`
- **UI role**: `status`
- **User flow**: A background terminal emits BEL; its badge persists until the terminal receives focus.
- **Tone**: concise/neutral
- **Placeholders**: none
- **Context/meaning**: A persistent bell badge indicates that a live terminal rang while unfocused. It does not imply disconnection or confirm that a program needs input.
- **Domain notes**: Connection is durable; Session is live; Pane identifies the precise terminal. Use Taiwan terminology 終端機 in zh-TW. Best-effort translations require review.

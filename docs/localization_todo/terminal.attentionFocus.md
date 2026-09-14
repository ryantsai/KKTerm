# terminal.attentionFocus

- **English value**: `Focus {{name}} in {{tab}} ({{workspace}})`
- **Namespace**: `terminal`
- **File/component**: `src/modules/workspace/TerminalAttention.tsx`
- **UI role**: `tooltip`
- **User flow**: A background terminal emits BEL; its badge persists until the terminal receives focus.
- **Tone**: concise/neutral
- **Placeholders**: {{name}} = Pane name, {{tab}} = Tab name, {{workspace}} = Workspace name; preserve each exactly
- **Context/meaning**: Accessible name and hover tooltip for a monochrome Status Bar bell. Activating it navigates to the exact live terminal Pane and clears its attention.
- **Domain notes**: Connection is durable; Session is live; Pane identifies the precise terminal. Use Taiwan terminology 終端機 in zh-TW. Best-effort translations require review.

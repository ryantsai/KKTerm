# connections.reconnect

- **English value**: `Reconnect`
- **Namespace**: `connections`
- **File/component**: `src/modules/workspace/connections/ConnectionSidebar.tsx`, `src/modules/workspace/connections/terminal/TerminalWorkspace.tsx`
- **UI role**: `label`
- **User flow**: An open SSH or Telnet Pane shows this action in the Connection Tree right-click menu and the Pane hamburger menu after its live Session disconnects or fails to start.
- **Tone**: `concise/neutral`
- **Placeholders**: `none`
- **Context/meaning**: Re-establish the live network Session for the already-open Connection Pane. This is not refresh/reload of static data.
- **Domain notes**: Connection is the durable SSH/Telnet resource; Session is the live runtime connection being restarted. SSH and Telnet stay English.

<!--
Filename: connections.reconnect.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

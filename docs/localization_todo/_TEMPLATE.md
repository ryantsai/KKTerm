# <namespace>.<keyPath>

- **English value**: `<exact string as it appears in src/i18n/locales/en.json>`
- **Namespace**: `<one of: app, settings, connections, terminal, sftp, webview, remoteDesktop, ai, workspace, common, dashboard, languages>`
- **File/component**: `<src/path/to/Component.tsx>`
- **UI role**: `<label | button | status | tooltip | error | placeholder | heading | fragment>`
- **User flow**: `<one or two sentences describing when the user sees this string>`
- **Tone**: `<e.g. concise/neutral, direct setup guidance, short progress phrase>`
- **Placeholders**: `<list named i18next placeholders like {{count}}, {{host}}, or "none". Use named placeholders so translators can reorder them; keep one full sentence per key; note that each {{…}} token must survive unchanged in every locale>`
- **Context/meaning**: `<the specific sense of this string in this place — e.g. "Play" = start a media preview, not run/execute or a theatrical play. Flag if the same English word is used elsewhere with a different meaning so it does NOT share this key>`
- **Domain notes**: `<any KKTerm domain meanings translators must preserve — e.g. "Dashboard" is the widget Module, not the default launch state; technical terms like SSH/SFTP/RDP/VNC/tmux/ProxyJump/PowerShell/WSL/API/URL typically stay English>`

<!--
Filename: <namespace>.<keyPath>.md (e.g. ai.dashboardToolsDisabledTitle.md)
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

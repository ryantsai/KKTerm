# terminal.quickCommandsBundleSubtitle

- **English value**: `Editing bundle "{{name}}". Changes apply to every connection using it. Drag to reorder.`
- **Namespace**: `terminal`
- **File/component**: `src/modules/workspace/connections/terminal/QuickCommandBar.tsx`
- **UI role**: `label`
- **User flow**: `Replaces the usual Quick Command manager subtitle when the edited list is a shared bundle rather than the Connection own list.`
- **Tone**: `concise/neutral`
- **Placeholders**: `{{name}} - the user-authored bundle name.`
- **Context/meaning**: `Warns that the edit is shared. Drag to reorder refers to dragging rows by their grip handle.`
- **Domain notes**: `Quick Command = a reusable terminal command shortcut on the Quick Command Bar. A Quick Command Bundle is an app-global named list of Quick Commands that any Connection can select; editing a bundle changes it for every Connection using it. Connection is the durable saved resource, never profile or session.`

<!--
Filename: terminal.quickCommandsBundleSubtitle.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

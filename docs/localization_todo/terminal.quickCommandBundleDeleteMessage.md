# terminal.quickCommandBundleDeleteMessage

- **English value**: `Delete "{{name}}" and its commands? Connections using it fall back to their own quick commands.`
- **Namespace**: `terminal`
- **File/component**: `src/modules/workspace/connections/terminal/QuickCommandBundles.tsx`
- **UI role**: `status`
- **User flow**: `Body of the delete-bundle confirmation, warning that Connections using the bundle fall back to their own Quick Commands.`
- **Tone**: `concise/neutral`
- **Placeholders**: `{{name}} - the user-authored bundle name.`
- **Context/meaning**: `Fall back means those Connections show their own unbundled Quick Commands again; nothing else is deleted.`
- **Domain notes**: `Quick Command = a reusable terminal command shortcut on the Quick Command Bar. A Quick Command Bundle is an app-global named list of Quick Commands that any Connection can select; editing a bundle changes it for every Connection using it. Connection is the durable saved resource, never profile or session.`

<!--
Filename: terminal.quickCommandBundleDeleteMessage.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

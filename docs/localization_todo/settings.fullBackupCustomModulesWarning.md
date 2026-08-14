# settings.fullBackupCustomModulesWarning

- **English value**: `Custom Modules are not included in database backups. Importing this backup will not restore or change installed Custom Modules, including their metadata and data.`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/SelectiveImportDialog.tsx`
- **UI role**: `warning`
- **User flow**: Shown before confirming import of a full database-backup ZIP, including legacy ZIPs that may physically contain ignored Custom Module entries.
- **Tone**: direct safety guidance
- **Placeholders**: none
- **Context/meaning**: Warns that backup restore applies only to non-Custom-Module database state and leaves the machine’s current Custom Modules untouched.
- **Domain notes**: Capital-M “Custom Module” is an optional Activity Rail Module, not a plugin, Connection, Session, Tab, or Dashboard Widget. Metadata includes installation state, versions, grants, and storage records; data includes packages, documents, blobs, browser profiles, and package-owned encrypted secrets.

<!--
Filename: settings.fullBackupCustomModulesWarning.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

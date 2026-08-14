# settings.autoBackupHint

- **English value**: `Runs in the background at most once every 24 hours; backups older than 1 week are removed.`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/GeneralSettings.tsx`
- **UI role**: `hint`
- **User flow**: Shown beside the automatic database-backup toggle in General Settings.
- **Tone**: concise/neutral
- **Placeholders**: none
- **Context/meaning**: Automatic backup work is delayed off the launch-critical path and runs no more than once per rolling 24-hour interval.
- **Domain notes**: A database backup excludes all Custom Module metadata and data. “Background” means a worker after launch, not app-window close.

<!--
Filename: settings.autoBackupHint.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

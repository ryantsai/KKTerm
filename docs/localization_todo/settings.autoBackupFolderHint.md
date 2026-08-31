# settings.autoBackupFolderHint

- **English value**: `Automatic backups and pre-import safety backups are saved here. Leave blank to use KKTerm's default backups folder.`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/GeneralSettings.tsx`
- **UI role**: `fragment`
- **User flow**: Explains which backups use the selected destination and how to restore the app-owned default folder.
- **Tone**: `direct setup guidance`
- **Placeholders**: `none`
- **Context/meaning**: A pre-import safety backup is the database snapshot KKTerm creates before applying an import; blank means no override, not that backups are disabled.
- **Domain notes**: KKTerm is a product name. Backup refers to database-backup ZIP snapshots, not selective `.kkbackup` exports.

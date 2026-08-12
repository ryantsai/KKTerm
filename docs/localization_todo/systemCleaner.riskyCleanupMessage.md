# systemCleaner.riskyCleanupMessage

- **English value**: `{{categories}} can remove files that exist nowhere else, including work you have not committed or backed up. Deletion is permanent and does not use the Recycle Bin. Review the preview above before continuing.`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx`
- **UI role**: `status`
- **User flow**: Body of the second confirmation sheet, naming the Risky categories in the current selection and stating what removing them costs.
- **Tone**: `plain and serious; states consequence and points back to the preview`
- **Placeholders**: ``{{categories}}` = comma-separated translated category names, already joined by the app. Keep the token verbatim and let it start the sentence or move it as the locale requires.`
- **Context/meaning**: "Committed" is the Git sense (recorded in a commit), not a general promise. "Preview" refers to the exact cleanup preview list shown on the Cleanup panel above the confirmation.
- **Domain notes**: Recycle Bin is the Windows shell feature name; use the locale's official Windows term. Category names arrive pre-translated inside the placeholder.

<!--
Filename: systemCleaner.riskyCleanupMessage.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

# systemCleaner.deleteReviewMessage

- **English value**: `Permanently delete {{count}} selected files ({{size}})? Only files unchanged since the scan will be removed. This cannot be undone.`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx`
- **UI role**: confirmation message
- **User flow**: Explains scan-bound validation immediately before deletion.
- **Tone**: explicit warning
- **Placeholders**: `{{count}}`, `{{size}}`
- **Context/meaning**: Permanent deletion is blocked if a selected file changed after scanning.
- **Domain notes**: Keep the irreversibility warning.

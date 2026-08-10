# systemCleaner.storageTotals

- **English value**: `{{size}} size · {{allocated}} allocated`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx`
- **UI role**: `storage browser summary`
- **User flow**: Summarizes logical and allocated totals for the currently browsed folder.
- **Tone**: `compact factual summary`
- **Placeholders**: `{{size}}`, `{{allocated}}`
- **Context/meaning**: Size is logical file content; allocated is physical NTFS disk consumption.
- **Domain notes**: `Keep the two measurements distinct and preserve both placeholders.`

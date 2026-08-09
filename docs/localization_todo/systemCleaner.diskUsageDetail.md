# systemCleaner.diskUsageDetail

- **English value**: `Windows reports {{used}} used. The scan found {{scanned}} in readable logical file sizes; the remaining {{unaccounted}} includes protected data, filesystem metadata, reserved storage, and allocation overhead.`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx`
- **UI role**: `explanation`
- **User flow**: Explains the Storage toolbar's Windows-used-space metric when its value differs from scanned file totals.
- **Tone**: concise/technical
- **Placeholders**: `{{used}}`, `{{scanned}}`, `{{unaccounted}}`
- **Context/meaning**: Windows volume allocation is broader than the readable logical file lengths enumerated by the scanner.
- **Domain notes**: Preserve all byte-value placeholders verbatim. Do not imply that reparse points should be followed.

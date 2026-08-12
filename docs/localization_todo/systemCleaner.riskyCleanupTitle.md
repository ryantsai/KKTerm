# systemCleaner.riskyCleanupTitle

- **English value**: `Confirm risky categories`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx`
- **UI role**: `heading`
- **User flow**: Title of the second confirmation sheet, shown only when the approved cleanup selection contains at least one Risky category. It appears after the normal cleanup confirmation is accepted.
- **Tone**: `direct, cautionary without alarm`
- **Placeholders**: `none`
- **Context/meaning**: "Confirm" is the user's act of approving a second time, not a status. "Risky" matches the Risky safety badge shown on those category rows and must use the same word as `systemCleaner.safety.risky` in this locale.
- **Domain notes**: This is the extra gate in front of destructive categories; keep it clearly stronger in tone than `systemCleaner.cleanTitle`.

<!--
Filename: systemCleaner.riskyCleanupTitle.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

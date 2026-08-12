# systemCleaner.freeOfTotal

- **English value**: `{{free}} free of {{total}}`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx`
- **UI role**: `status`
- **User flow**: Supporting line under the Space used metric on the System Cleaner Overview summary card, after a drive is selected.
- **Tone**: `concise/neutral, dashboard label`
- **Placeholders**: ``{{free}}` = formatted free bytes, `{{total}}` = formatted drive capacity. Both are pre-formatted size strings such as "353.1 GB"; keep both tokens and let the locale reorder them.`
- **Context/meaning**: "free" means unused disk space remaining, not "free of charge" and not "available to download".
- **Domain notes**: Sizes are formatted by the app before interpolation, so the translation must not add its own unit.

<!--
Filename: systemCleaner.freeOfTotal.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

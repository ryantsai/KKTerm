# systemCleaner.allocationDetail

- **English value**: `Windows reports {{used}} used. The scan attributed {{allocated}} of allocated data and {{logical}} of logical file size; {{unaccounted}} remains reserved or unattributed.`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx`
- **UI role**: `storage allocation explanation`
- **User flow**: Explains the relationship between Windows used space and the scan's allocated and logical totals.
- **Tone**: `precise neutral explanation`
- **Placeholders**: `{{used}}`, `{{allocated}}`, `{{logical}}`, `{{unaccounted}}`
- **Context/meaning**: Separates physical allocation from logical file length and identifies the residual Windows allocation.
- **Domain notes**: `Allocated means physical filesystem allocation; logical means file length before allocation-unit overhead.`

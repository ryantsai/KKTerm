# systemCleaner.uninstallSelectionMessage

- **English value**: `Windows will ask for UAC approval for each of the {{count}} selected applications. Each uninstall runs in a separate elevated helper and is recorded in the local operations log.`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx`
- **UI role**: `status`
- **User flow**: The user sees this in the redesigned System Cleaner control panel.
- **Tone**: concise and neutral
- **Placeholders**: {{count}}
- **Context/meaning**: Confirmation body for sequential elevated application removal.
- **Domain notes**: System Cleaner is the Windows-only Module; UAC and Windows Package Manager keep their technical meanings.


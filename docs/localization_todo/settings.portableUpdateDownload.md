# settings.portableUpdateDownload

- **English value**: `Download, Update, and Restart`
- **Namespace**: `settings`
- **File/component**: `src/app/AppUpdatePrompt.tsx`
- **UI role**: `button`
- **User flow**: Portable Windows users activate this action to download, verify, apply, and relaunch into an app update.
- **Tone**: concise/direct action
- **Placeholders**: none
- **Context/meaning**: “Update” means replace the portable program payload after the current process exits; it does not run an installer.
- **Domain notes**: The action preserves the portable `data/` directory and never launches NSIS.

<!--
Filename: settings.portableUpdateDownload.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

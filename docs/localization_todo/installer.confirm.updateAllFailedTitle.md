# installer.confirm.updateAllFailedTitle

- **English value**: `Continue with the remaining updates?`
- **Namespace**: `installer`
- **File/component**: `src/modules/installer/InstallerPage.tsx`
- **UI role**: `heading`
- **User flow**: Shown as the dialog title when a tool fails or is error-cancelled mid "Update all" run with more updates queued; the user decides whether to continue the remaining queue or abort it.
- **Tone**: `direct confirmation question, concise`
- **Placeholders**: `none`
- **Context/meaning**: "updates" here means the remaining queue of the Install Helper Update-all batch (the same batch named by `installer.confirm.updateAllTitle` / `updateAllBody`), not OS updates or app-store updates. This is a question title matching the house style of the other `installer.confirm.*Title` question keys.
- **Domain notes**: "Update all" / Install Helper is the installer Module batch operation; the queue is sequential per the order of `installer.confirm.updateAllTitle`'s list. Keep the question phrasing; do not reuse a generic "Retry?" string.

<!--
Filename: installer.confirm.updateAllFailedTitle.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

# installer.confirm.updateAllAbort

- **English value**: `Abort`
- **Namespace**: `installer`
- **File/component**: `src/modules/installer/InstallerPage.tsx`
- **UI role**: `button (dismiss / stop action)`
- **User flow**: Dismiss button of the Continue/Abort prompt shown when a tool fails during the "Update all" run; picking it stops the queue so no further updates are attempted.
- **Tone**: `direct imperative, concise`
- **Placeholders**: `none`
- **Context/meaning**: "Abort" means stop the whole remaining Update-all queue (the failed tool already finished its attempt), not cancel a running process — nothing is in flight when this button is visible.
- **Domain notes**: "Update all" / Install Helper is the installer Module batch operation. A verb meaning "stop/abandon the batch" is right; avoid a phrase that reads as "retry later".

<!--
Filename: installer.confirm.updateAllAbort.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

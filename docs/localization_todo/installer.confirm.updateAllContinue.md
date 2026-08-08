# installer.confirm.updateAllContinue

- **English value**: `Continue`
- **Namespace**: `installer`
- **File/component**: `src/modules/installer/InstallerPage.tsx`
- **UI role**: `button (primary action)`
- **User flow**: Primary button of the Continue/Abort prompt shown when a tool fails during the "Update all" run; picking it resumes the queue with the remaining updates.
- **Tone**: `direct imperative, concise`
- **Placeholders**: `none`
- **Context/meaning**: "Continue" means proceed with the remaining Update-all queue, not "retry" the failed tool — the failed tool is NOT retried. Translators must not render it as a retry phrase.
- **Domain notes**: "Update all" / Install Helper is the installer Module batch operation. Keep it distinct from `common.cancel` and from any retry wording.

<!--
Filename: installer.confirm.updateAllContinue.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

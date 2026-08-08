# installer.confirm.updateAllFailedBody

- **English value**: `{{name}} could not be updated. {{count}} update(s) remain.`
- **Namespace**: `installer`
- **File/component**: `src/modules/installer/InstallerPage.tsx`
- **UI role**: `dialog body text`
- **User flow**: Shown in the Continue/Abort prompt after a tool fails during the "Update all" run: names the failed tool and reports how many queued updates are still pending.
- **Tone**: `neutral factual statement of failure, concise`
- **Placeholders**: `{{name}}` (the failed tool's display name), `{{count}}` (number of remaining queued updates)
- **Context/meaning**: "could not be updated" refers to the just-failed install operation of one tool in the Install Helper Update-all queue; "update(s) remain" counts the still-pending queue entries, not uninstalls or installs. The `{{count}}` pattern mirrors `installer.confirm.updateAllBody` ("{{count}} update(s) will be installed.") so translators should reuse the same plural strategy.
- **Domain notes**: "Update all" / Install Helper is the installer Module batch operation. `{{name}}` and `{{count}}` must survive verbatim in every locale.

<!--
Filename: installer.confirm.updateAllFailedBody.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

# settings.rdpRedirectPrintersHint

- **English value**: `Expose local printers to the remote desktop session. The remote server needs Remote Desktop Easy Print or a matching printer driver.`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/RdpSettings.tsx`
- **UI role**: `tooltip`
- **User flow**: The supporting `<small>` line under the `settings.rdpRedirectPrinters` toggle in Settings → RDP (Windows only). It explains what the toggle does and why redirected printers may still not appear in the Session.
- **Tone**: concise/neutral explanatory hint, matching `settings.rdpRedirectDrivesHint`.
- **Placeholders**: `none`
- **Context/meaning**: "Expose … to the session" means make the local printers visible/usable inside the remote desktop Session — the same construction already used in `settings.rdpRedirectDrivesHint`, so keep both consistent. The second sentence is a server-side prerequisite, not an error message.
- **Domain notes**: "Remote Desktop Easy Print" is a Microsoft feature name — keep the product name recognizable, following whatever form the locale's Windows terminology uses; do not invent a translation that no longer matches the Windows UI. RDP stays English. "Session" is the KKTerm live-runtime Session term. zh-TW must use 遠端桌面, 工作階段, 伺服器, 驅動程式, never the Mainland equivalents.

<!--
Filename: settings.rdpRedirectPrintersHint.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

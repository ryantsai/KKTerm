# settings.rdpRedirectPrinters

- **English value**: `Printer redirection`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/RdpSettings.tsx`, `src/modules/workspace/connections/connection-dialog/RdpConnectionFields.tsx`
- **UI role**: `label`
- **User flow**: Shown on Windows only, as a toggle in Settings → RDP under the network/performance group, and as a per-Connection override in the RDP Connection dialog. Turning it on maps the local printers into the remote desktop Session.
- **Tone**: concise/neutral, matching the sibling `settings.rdpRedirectClipboard` and `settings.rdpRedirectDrives` labels.
- **Placeholders**: `none`
- **Context/meaning**: "Redirection" here is RDP device redirection — making a local device available inside the remote Session. It is the same sense as the neighbouring clipboard and drive redirection labels, so locales should keep those three consistent with each other. Not "redirect" in the sense of forwarding a network request or an HTTP redirect.
- **Domain notes**: RDP stays English. "Printer" means a physical/local print device, not a print job or print queue. Keep the same word the locale already uses in `settings.rdpRedirectDrives` for "redirection". zh-TW must use 印表機 and 重新導向, never 打印机 / 重定向.

<!--
Filename: settings.rdpRedirectPrinters.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

# settings.rdpRedirectPorts

- **English value**: `Port`
- **Namespace**: `settings`
- **File/component**: `src/modules/workspace/connections/connection-dialog/RdpConnectionFields.tsx`, `src/modules/settings/RdpSettings.tsx`
- **UI role**: `label`
- **User flow**: Toggle label (with icon) for redirecting local serial/COM ports into an RDP session, shown both in the per-Connection "Advanced" disclosure and in the global RDP defaults page in Settings. Sits alongside sibling toggles "Clipboard", "Drive", "Printer" in a 2-column grid — keep this as a single short noun to match that style, not a full phrase.
- **Tone**: concise/neutral, single word/short noun like its siblings.
- **Placeholders**: none
- **Context/meaning**: "Port" meaning a local serial/COM port (RS-232 style hardware port), not a network port number and not a USB port. This maps to the RDP ActiveX `RedirectPorts` property, the same feature Microsoft's own Remote Desktop Connection client exposes as "Ports" under Local Resources → More.
- **Domain notes**: RDP stays in English per the domain-term list. This is a new, Windows-only capability — the toggle is hidden entirely on macOS/Linux builds, so no platform-name translation is needed. Best-effort translations were added to all locales, generally following the same "drop the redirection/forwarding qualifier" pattern applied to `rdpRedirectClipboard`/`rdpRedirectDrives`/`rdpRedirectPrinters` in the same change — still needs a verified review pass.

<!--
Filename: settings.rdpRedirectPorts.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated and verified.
-->

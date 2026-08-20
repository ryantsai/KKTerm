# settings.rdpRedirectPrinters

- **English value**: `Printer`
- **Namespace**: `settings`
- **File/component**: `src/modules/workspace/connections/connection-dialog/RdpConnectionFields.tsx`, `src/modules/settings/RdpSettings.tsx`
- **UI role**: `label`
- **User flow**: Toggle label for local printer redirection into an RDP session (Windows only). Previously read "Printer redirection"; shortened to a single noun to fit a new 2-column grid of device-mapping toggles ("Clipboard", "Drive", "Printer", "Port") without wrapping.
- **Tone**: concise/neutral, single short noun.
- **Placeholders**: none
- **Context/meaning**: Same feature as before — only the English wording was shortened by dropping the redundant "redirection" qualifier. The underlying meaning is unchanged.
- **Domain notes**: Existing non-English translations were shortened to match in the same change (dropping each locale's own "redirection/forwarding" qualifier word) — still needs a verified review pass to confirm the shortened forms read naturally in each locale's 2-column layout.

<!--
Filename: settings.rdpRedirectPrinters.md
Delete this file once every non-English locale under src/i18n/locales/ has the key re-verified.
-->

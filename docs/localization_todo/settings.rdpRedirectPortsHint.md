# settings.rdpRedirectPortsHint

- **English value**: `Expose local serial (COM) ports to the remote desktop session.`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/RdpSettings.tsx`
- **UI role**: `fragment`
- **User flow**: Small helper text under the "Port" toggle's label in the global RDP defaults page in Settings, explaining what the toggle does. Mirrors the sibling hints for `rdpRedirectDrivesHint`/`rdpRedirectPrintersHint`.
- **Tone**: short, direct setup guidance — one plain sentence, same register as the sibling hints.
- **Placeholders**: none
- **Context/meaning**: "serial (COM) ports" refers to local hardware serial ports (e.g. `COM3`), not network ports and not USB. This describes the RDP ActiveX `RedirectPorts` property.
- **Domain notes**: "RDP", "COM" stay in English/as the standard abbreviation per the domain-term list. Best-effort translations were added to all locales alongside `settings.rdpRedirectPorts` in the same change — still needs a verified review pass.

<!--
Filename: settings.rdpRedirectPortsHint.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated and verified.
-->

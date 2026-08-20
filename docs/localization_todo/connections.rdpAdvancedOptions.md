# connections.rdpAdvancedOptions

- **English value**: `Advanced`
- **Namespace**: `connections`
- **File/component**: `src/modules/workspace/connections/connection-dialog/RdpConnectionFields.tsx`
- **UI role**: `label`
- **User flow**: Summary label for a collapsed `<details>` disclosure in the RDP Connection dialog's options panel, grouping the less-common device-mapping toggles (administrative session, clipboard, printer, port, bitmap cache, drive mapping) so they don't all show at once.
- **Tone**: concise/neutral, matches other short section-header labels in the dialog (e.g. "RDP options").
- **Placeholders**: none
- **Context/meaning**: "Advanced" as in an options-disclosure heading (same sense as the "Advanced" tab in Microsoft's own Remote Desktop Connection client / mstsc.exe — translators should match that existing OS-level term for this locale if one exists, since users will recognize it).
- **Domain notes**: Sits directly next to the existing "RDP options" legend (`connections.rdpOptions`) in the same fieldset — this is a nested sub-heading, not a top-level dialog title. Best-effort translations were added to all locales using each locale's Microsoft RDP client "Advanced" tab wording where known; still needs a verified review pass.

<!--
Filename: connections.rdpAdvancedOptions.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated and verified.
-->

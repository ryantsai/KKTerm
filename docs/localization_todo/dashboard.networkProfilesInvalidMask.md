# dashboard.networkProfilesInvalidMask

- **English value**: `Enter a valid IPv4 subnet mask (for example 255.255.255.0 or 24).`
- **Namespace**: `dashboard`
- **File/component**: `src/modules/dashboard/widgets/builtin/network-profiles/NetworkProfilesWidget.tsx`
- **UI role**: error
- **User flow**: Validation error when the IPv4 subnet mask field is not a contiguous dotted mask or a prefix length.
- **Tone**: direct validation message
- **Placeholders**: none
- **Context/meaning**: The two accepted forms are a dotted mask and a bare prefix such as 24.
- **Domain notes**: “Profile” means a saved IPv4/IPv6 network configuration, not a KKTerm Connection. Preserve IPv4, IPv6, DNS, and UAC as technical terms.

<!--
Filename: dashboard.networkProfilesInvalidMask.md (e.g. ai.dashboardToolsDisabledTitle.md)
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

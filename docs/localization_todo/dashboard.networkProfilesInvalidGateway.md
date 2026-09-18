# dashboard.networkProfilesInvalidGateway

- **English value**: `Enter a valid {{family}} gateway or leave it empty.`
- **Namespace**: `dashboard`
- **File/component**: `src/modules/dashboard/widgets/builtin/network-profiles/NetworkProfilesWidget.tsx`
- **UI role**: error
- **User flow**: Validation error when a filled gateway does not match the address family of its section.
- **Tone**: direct validation message
- **Placeholders**: {{family}} receives the literal tokens IPv4 or IPv6 and must survive unchanged.
- **Context/meaning**: The gateway is optional, but when set it must match the family and be a valid address.
- **Domain notes**: “Profile” means a saved IPv4/IPv6 network configuration, not a KKTerm Connection. Preserve IPv4, IPv6, DNS, and UAC as technical terms.

<!--
Filename: dashboard.networkProfilesInvalidGateway.md (e.g. ai.dashboardToolsDisabledTitle.md)
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

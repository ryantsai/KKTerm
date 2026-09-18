# dashboard.networkProfilesInvalidAddress

- **English value**: `Enter a valid {{family}} address.`
- **Namespace**: `dashboard`
- **File/component**: `src/modules/dashboard/widgets/builtin/network-profiles/NetworkProfilesWidget.tsx`
- **UI role**: error
- **User flow**: Validation error in the profile dialog when the manual address is empty or not a valid address of the selected family.
- **Tone**: direct validation message
- **Placeholders**: {{family}} receives the literal tokens IPv4 or IPv6 and must survive unchanged.
- **Context/meaning**: The address must parse as an IPv4 or IPv6 address matching its section.
- **Domain notes**: “Profile” means a saved IPv4/IPv6 network configuration, not a KKTerm Connection. Preserve IPv4, IPv6, DNS, and UAC as technical terms.

<!--
Filename: dashboard.networkProfilesInvalidAddress.md (e.g. ai.dashboardToolsDisabledTitle.md)
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

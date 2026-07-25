# itops.ipam.claimPrefixCoverageInvalid

- **English value**: `Every selected address must be covered by a valid suggested CIDR.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `error`
- **User flow**: Shown inline before import when an edited CIDR is invalid or no longer contains every selected uncovered address.
- **Tone**: `concise/direct`
- **Placeholders**: `none`
- **Context/meaning**: `covered` is numeric CIDR containment, not network reachability or scan evidence.
- **Domain notes**: `CIDR` is editable network-and-mask notation and should remain technical terminology.

<!--
Filename: itops.ipam.claimPrefixCoverageInvalid.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

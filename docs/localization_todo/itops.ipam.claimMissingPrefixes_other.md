# itops.ipam.claimMissingPrefixes_other

- **English value**: `{{count}} selected addresses are not covered by an IP Prefix. Review the suggested CIDRs before importing.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `setup guidance`
- **User flow**: Shown in the known-address import dialog when multiple selected addresses are outside every existing IP Prefix.
- **Tone**: `direct setup guidance`
- **Placeholders**: `{{count}}`
- **Context/meaning**: `covered` means each address falls inside a numeric CIDR range; the CIDRs are suggestions because addresses alone do not reveal their subnet masks.
- **Domain notes**: An IP Prefix is a durable IPAM block. `CIDR` is the editable network-and-mask notation and should remain technical terminology.

<!--
Filename: itops.ipam.claimMissingPrefixes_other.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

# itops.ipam.claimMissingPrefixes_one

- **English value**: `{{count}} selected address is not covered by an IP Prefix. Review the suggested CIDR before importing.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `setup guidance`
- **User flow**: Shown in the known-address import dialog when exactly one selected address is outside every existing IP Prefix.
- **Tone**: `direct setup guidance`
- **Placeholders**: `{{count}}`
- **Context/meaning**: `covered` means the address falls inside the numeric CIDR range; the CIDR is a suggestion because an address alone does not reveal its subnet mask.
- **Domain notes**: An IP Prefix is a durable IPAM block. `CIDR` is the editable network-and-mask notation and should remain technical terminology.

<!--
Filename: itops.ipam.claimMissingPrefixes_one.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

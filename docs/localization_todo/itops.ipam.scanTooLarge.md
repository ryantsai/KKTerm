# itops.ipam.scanTooLarge
- **English value**: `Select IP Prefixes totaling no more than 4,096 usable addresses.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: error
- **User flow**: Explains why Scan is disabled for an oversized selection.
- **Tone**: direct guidance
- **Placeholders**: none
- **Context/meaning**: Reduce the selected IP Prefixes to the request limit.
- **Domain notes**: IP Prefix is the durable CIDR block; 4,096 is the backend limit.

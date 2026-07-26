# itops.ipam.deviceTypeLabel

- **English value**: `Device type`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `label`
- **User flow**: The user sees this label when creating or editing an individual IP Address Record.
- **Tone**: concise/neutral
- **Placeholders**: none
- **Context/meaning**: Broad hardware or endpoint class such as router, switch, printer, or desktop; it is not a Connection kind or a Host virtualization kind.
- **Domain notes**: Scans may infer this value conservatively from SNMP identity and distinctive service ports. Existing `itops.networkMap.nodeKind.*` values supply the localized option labels.

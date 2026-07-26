# itops.ipam.fileImportIssue.unknownVlan
- **English value**: `VLAN {{vid}} does not exist in KKTerm or this file.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamImportDialog.tsx`
- **UI role**: error
- **User flow**: Marks a Prefix row whose VLAN reference cannot be resolved.
- **Tone**: direct/neutral
- **Placeholders**: `{{vid}}`
- **Context/meaning**: The 802.1Q id is neither already stored nor declared in the import.
- **Domain notes**: Preserve VLAN and KKTerm.

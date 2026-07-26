# itops.ipam.fileImportIssue.duplicateFile
- **English value**: `This {{type}} is duplicated in the file.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamImportDialog.tsx`
- **UI role**: status
- **User flow**: Marks a repeated identity after its first row.
- **Tone**: concise/warning
- **Placeholders**: `{{type}}`
- **Context/meaning**: This later row will be skipped rather than overwrite the first.
- **Domain notes**: Type names refer to VLAN, IP Prefix, or Address.

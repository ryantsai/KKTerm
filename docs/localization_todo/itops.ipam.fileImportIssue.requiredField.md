# itops.ipam.fileImportIssue.requiredField
- **English value**: `“{{field}}” is required for {{type}} rows.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamImportDialog.tsx`
- **UI role**: error
- **User flow**: Marks a row missing its type-specific identity field.
- **Tone**: direct/neutral
- **Placeholders**: `{{field}}`, `{{type}}`
- **Context/meaning**: A canonical import column is blank.
- **Domain notes**: Interpolated values are machine-readable tokens.

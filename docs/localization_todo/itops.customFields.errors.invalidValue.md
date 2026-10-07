# itops.customFields.errors.invalidValue

- **English value**: `Enter a valid value for “{{name}}”. For choice fields, keep any choices that are already in use.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/state.ts`, `src/modules/itops/customFieldModel.ts`
- **UI role**: `error message`
- **User flow**: Save custom field definitions in Settings or custom values in an IPAM record editor.
- **Tone**: Concise and instructive.
- **Placeholders**: `{{name}}` is the operator-defined field name and must survive unchanged.
- **Context/meaning**: Validation failed for operator-defined metadata. Explain how to correct it; existing values remain intact.
- **Domain notes**: Field record type means IP Prefix, IP Address Record, or VLAN, not a Connection protocol. Use Taiwan terminology for zh-TW, including 自訂欄位、資料、儲存、記錄.

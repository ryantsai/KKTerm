# itops.ipam.fileImportResolveHostnamesHint

- **English value**: `Best effort: fill blank hostnames from PTR reverse DNS. Hostnames already in the file are kept.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamImportDialog.tsx`
- **UI role**: `hint`
- **User flow**: This explains the optional hostname-resolution toggle during IPAM file import.
- **Tone**: `concise/technical guidance`
- **Placeholders**: `none`
- **Context/meaning**: Reverse DNS is attempted only for empty hostname fields; lookup failure is harmless and imported file values have priority.
- **Domain notes**: Keep PTR and DNS as technical terms. “Best effort” means bounded, non-blocking enrichment rather than guaranteed resolution.

# itops.ipam.scanAddressBudget
- **English value**: `{{count}} of 4,096 addresses selected.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: hint
- **User flow**: Shows selected scan size below the Prefix list.
- **Tone**: concise/neutral
- **Placeholders**: `{{count}}`
- **Context/meaning**: Current unique usable-address count against the hard cap.
- **Domain notes**: Preserve `{{count}}`; 4,096 is the backend limit.

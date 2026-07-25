# itops.ipam.addressSiteHint

- **English value**: `Optional. Without a direct Site or Host, the address inherits its segment's Site.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `field hint`
- **User flow**: `IP Address Record editor, below the optional Site selector.`
- **Tone**: `concise/neutral`
- **Placeholders**: `none`
- **Context/meaning**: `A durable address-level Site binding is valid on its own. When neither a direct Site nor a Host is selected, the address derives its effective Site from the most-specific containing IP Prefix (segment).`
- **Domain notes**: `Site, Host, IPAM, IP Address Record, IP Prefix, and segment are KKTerm domain terms.`

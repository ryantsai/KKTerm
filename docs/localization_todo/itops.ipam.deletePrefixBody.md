# itops.ipam.deletePrefixBody

- **English value**: `“{{cidr}}” will be removed. Addresses inside it are kept.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `fragment`
- **User flow**: `Body of the confirm dialog for deleting an IP Prefix.`
- **Tone**: `plain, calm prose`
- **Placeholders**: `{{cidr}} — each token must survive verbatim in every locale.`
- **Context/meaning**: `The second sentence is the reassurance that matters: child addresses survive the delete. Curly quotes wrap the CIDR.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

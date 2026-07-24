# itops.networkMap.linkBetween

- **English value**: `{{from}} ↔ {{to}}`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/NetworkMapDesigner.tsx`
- **UI role**: `fragment`
- **User flow**: `Sub-heading in the link inspector naming the two ends.`
- **Tone**: `plain, calm prose`
- **Placeholders**: `{{from}}, {{to}} — each token must survive verbatim in every locale.`
- **Context/meaning**: `Links are undirected — the arrows character is a double-headed arrow, not a flow direction. Keep the ↔ character.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

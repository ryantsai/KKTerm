# itops.networkMap.deleteBody

- **English value**: `“{{name}}” and everything drawn on it will be removed.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/NetworkMapDesigner.tsx`
- **UI role**: `fragment`
- **User flow**: `Body of the confirm dialog for deleting a Network Map.`
- **Tone**: `plain, calm prose`
- **Placeholders**: `{{name}} — each token must survive verbatim in every locale.`
- **Context/meaning**: `Warns that the nodes and links drawn on the map go with it. Curly quotes wrap the name.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

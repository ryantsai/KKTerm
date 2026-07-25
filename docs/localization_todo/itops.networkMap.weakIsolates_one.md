# itops.networkMap.weakIsolates_one

- **English value**: `isolates {{count}} node`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/NetworkMapDesigner.tsx`
- **UI role**: `fragment`
- **User flow**: `Suffix on each single-point-of-failure row, after the node or link name.`
- **Tone**: `plain, calm prose`
- **Placeholders**: `{{count}} — each token must survive verbatim in every locale. This key is one half of an i18next plural pair; locales without plural forms still carry both `_one` and `_other` with the same value.`
- **Context/meaning**: `Sentence fragment continuing from a name, e.g. "Core switch — isolates 4 nodes". Must stay lower-case and verb-initial.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

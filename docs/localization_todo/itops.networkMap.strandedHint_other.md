# itops.networkMap.strandedHint_other

- **English value**: `{{count}} nodes have no link yet: {{names}}.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/NetworkMapDesigner.tsx`
- **UI role**: `status`
- **User flow**: `Advisory shown when nodes are on the canvas with no link attached.`
- **Tone**: `short factual phrase`
- **Placeholders**: `{{count}}, {{names}} — each token must survive verbatim in every locale. This key is one half of an i18next plural pair; locales without plural forms still carry both `_one` and `_other` with the same value.`
- **Context/meaning**: `"Stranded" = drawn but never connected, so reachability cannot say anything about it. {{names}} is a pre-joined, comma-separated list.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

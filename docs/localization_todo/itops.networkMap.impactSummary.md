# itops.networkMap.impactSummary

- **English value**: `of {{total}} nodes cut off`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/NetworkMapDesigner.tsx`
- **UI role**: `status`
- **User flow**: `Suffix of the headline figure in the What-If panel; a large isolated-node count is rendered immediately before it.`
- **Tone**: `short factual phrase`
- **Placeholders**: `{{total}} — each token must survive verbatim in every locale.`
- **Context/meaning**: `Reads as "7 of 20 nodes cut off" — the leading number is a separate element, so this string must start mid-sentence.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

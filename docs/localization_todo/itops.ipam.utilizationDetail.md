# itops.ipam.utilizationDetail

- **English value**: `{{used}} of {{usable}} usable addresses documented`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `tooltip`
- **User flow**: `Tooltip and screen-reader text on the utilization meter of a prefix row.`
- **Tone**: `plain, one-sentence guidance`
- **Placeholders**: `{{used}}, {{usable}} — each token must survive verbatim in every locale.`
- **Context/meaning**: `"Documented" not "allocated": IPAM counts what the operator wrote down, not what is live on the wire.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

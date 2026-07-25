# itops.ipam.cidrHint

- **English value**: `Host bits are cleared when the prefix is saved.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `tooltip`
- **User flow**: `Hint under the CIDR field in the IP Prefix dialog.`
- **Tone**: `plain, one-sentence guidance`
- **Placeholders**: `none`
- **Context/meaning**: `Warns that 10.20.3.7/16 is stored as 10.20.0.0/16 — the host portion is zeroed on save.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

# itops.ipam.deleteAddressBody

- **English value**: `“{{address}}” will be removed from IPAM.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `fragment`
- **User flow**: `Body of the confirm dialog for deleting an IP Address Record.`
- **Tone**: `plain, calm prose`
- **Placeholders**: `{{address}} — each token must survive verbatim in every locale.`
- **Context/meaning**: `"From IPAM" makes clear only the record goes, nothing on the network changes. Curly quotes wrap the address.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

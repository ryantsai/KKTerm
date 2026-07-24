# itops.ipam.cidrInvalid

- **English value**: `Enter an IPv4 prefix in CIDR form, such as 10.20.0.0/16.`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `error`
- **User flow**: `Inline validation error under the CIDR field when the typed value is not a valid IPv4 prefix.`
- **Tone**: `direct, actionable`
- **Placeholders**: `none`
- **Context/meaning**: `CIDR is the slash-notation form; only IPv4 is supported in this release.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

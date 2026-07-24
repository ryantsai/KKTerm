# itops.networkMap.importAction_other

- **English value**: `Import {{count}} Hosts`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/NetworkMapDesigner.tsx`
- **UI role**: `button`
- **User flow**: `Confirm button in the Host import dialog.`
- **Tone**: `short imperative`
- **Placeholders**: `{{count}} — each token must survive verbatim in every locale. This key is one half of an i18next plural pair; locales without plural forms still carry both `_one` and `_other` with the same value.`
- **Context/meaning**: `Import here means add nodes to the drawing.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

# itops.ipam.claimAction_other

- **English value**: `Import {{count}} addresses`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `button`
- **User flow**: `Confirm button in the import dialog; the count follows the checkbox selection.`
- **Tone**: `short imperative`
- **Placeholders**: `{{count}} — each token must survive verbatim in every locale. This key is one half of an i18next plural pair; locales without plural forms still carry both `_one` and `_other` with the same value.`
- **Context/meaning**: `Import here means write into IPAM, not read a file from disk.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

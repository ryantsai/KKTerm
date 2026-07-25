# itops.ipam.claimPrompt_one

- **English value**: `{{count}} address to import`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/IpamPanel.tsx`
- **UI role**: `status`
- **User flow**: `Counter above the candidate list in the import dialog.`
- **Tone**: `short factual phrase`
- **Placeholders**: `{{count}} — each token must survive verbatim in every locale. This key is one half of an i18next plural pair; locales without plural forms still carry both `_one` and `_other` with the same value.`
- **Context/meaning**: `How many candidates are currently ticked.`
- **Domain notes**: `IPAM, Network Map, Network Node, Network Link, IP Prefix, IP Address Record, Site, Host, and Connection are KKTerm domain terms — reuse the wording the locale already uses for them. IPAM, VRF, CIDR, DNS, WAN, and VLAN stay in English. Network Map is not the Site → Server Room → Rack topology drill-down and must not reuse that translation.`

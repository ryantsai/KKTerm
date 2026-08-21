# itops.racks.elevationRowGroup

- **English value**: `Row {{index}} · {{group}}`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/SitesTab.tsx`
- **UI role**: `heading`
- **User flow**: The same Server Room View elevation band header as `itops.racks.elevationRow`, used when every Rack in that floor row shares one `itops.racks.groupLabel` tag, so the row number and the group name appear together.
- **Tone**: concise/neutral, short label
- **Placeholders**: `{{index}} — the 1-based position of this row among the room's occupied floor rows. {{group}} — the user-authored rack group name, shown verbatim and never translated. Both must survive verbatim in every locale; the "·" separator may be adapted to local typographic convention.`
- **Context/meaning**: `"Row" = a physical row of rack cabinets on the server-room floor, not a table row and not a rack unit (U). "Group" here is the Rack's free-text group tag (itops.racks.groupLabel), not a Site, Server Room, or host group.`
- **Domain notes**: `Server Room, Rack, and elevation are KKTerm domain terms (see CONTEXT.md). The group value is user data — translate the surrounding label only.`

<!--
Filename: itops.racks.elevationRowGroup.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

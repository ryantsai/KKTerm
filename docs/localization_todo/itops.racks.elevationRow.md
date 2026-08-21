# itops.racks.elevationRow

- **English value**: `Row {{index}}`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/SitesTab.tsx`
- **UI role**: `heading`
- **User flow**: Header above one band of rack cabinets in Server Room View's elevation layout. Each band is one occupied row of the shared server-room floor grid, numbered from the top of the room; the header appears when the room has more than one occupied row.
- **Tone**: concise/neutral, short label
- **Placeholders**: `{{index}} — the 1-based position of this row among the room's occupied floor rows. Must survive verbatim in every locale.`
- **Context/meaning**: `"Row" = a physical row of rack cabinets standing on the server-room floor, the way a data centre is laid out in rows separated by aisles. It is NOT a table row, a list row, or a rack unit (U). Do not share this key with any table/grid row string.`
- **Domain notes**: `Server Room, Rack, and elevation are KKTerm domain terms (see CONTEXT.md). The elevation layout projects the same floor grid the floor plan and 2.5D view draw, so this row number refers to a position in the physical room.`

<!--
Filename: itops.racks.elevationRow.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

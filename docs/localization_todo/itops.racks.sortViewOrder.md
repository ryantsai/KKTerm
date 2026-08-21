# itops.racks.sortViewOrder

- **English value**: `View order`
- **Namespace**: `itops`
- **File/component**: `src/modules/itops/SitesTab.tsx`
- **UI role**: `button`
- **User flow**: Third choice in the Sites tree `itops.racks.sortAction` submenu for a Server Room, beside `itops.racks.sortAscending` and `itops.racks.sortDescending`. Choosing it lists that Server Room's Racks in the navigator in the order Server Room View shows them — floor row by floor row, left to right — instead of by Rack name. The choice persists per Server Room.
- **Tone**: concise/neutral, short menu command
- **Placeholders**: `none`
- **Context/meaning**: `"View" = the Server Room View drill-down surface (the elevation / floor plan / 2.5D layouts), so this reads as "the order the room view shows them in". It is NOT "view" as in look at something, and NOT a database view. The sibling options are sort directions, so this must read as a third ordering choice rather than an action that opens or displays anything.`
- **Domain notes**: `Server Room View and Rack are KKTerm domain terms (see CONTEXT.md). Keep it parallel in length and register with itops.racks.sortAscending / itops.racks.sortDescending, which sit directly above it in the same submenu.`

<!--
Filename: itops.racks.sortViewOrder.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->

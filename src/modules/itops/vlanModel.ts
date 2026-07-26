// Shared VLAN presentation helpers (docs/ITOPS.md VLAN). The VLANs page, the
// IPAM prefix rows, and the Network Map overlay all render the same records, so
// the accent lookup and the label format live in one place.

import type { Vlan } from "../../types";
import { IT_ACCENTS } from "./icons";

/** The accent palette a VLAN's stored index selects from. Storing the index
 * rather than a hex keeps `docs/DESIGN_LANGUAGE.md`'s "never hard-code hex"
 * rule true for durable data, and resolving it modulo the length means no
 * stored value can ever be invalid. */
export const VLAN_ACCENTS: readonly string[] = Object.values(IT_ACCENTS);

export function vlanAccent(vlan: Pick<Vlan, "accent">): string {
  const index = Number.isFinite(vlan.accent) ? Math.trunc(vlan.accent) : 0;
  return VLAN_ACCENTS[((index % VLAN_ACCENTS.length) + VLAN_ACCENTS.length) % VLAN_ACCENTS.length];
}

/** "30" or "30 Voice" — the id first, because that is what an operator reads
 * off a switch port. Callers supply the localized "VLAN" prefix themselves. */
export function vlanLabel(vlan: Vlan): string {
  const name = vlan.name.trim();
  return name ? `${vlan.vid} ${name}` : String(vlan.vid);
}

/** Index by id so a Network Link's soft references resolve in one pass. A link
 * may reference a VLAN that has since been deleted; callers treat a miss as
 * "unknown VLAN" rather than dropping the reference. */
export function vlansById(vlans: readonly Vlan[]): Map<string, Vlan> {
  return new Map(vlans.map((vlan) => [vlan.id, vlan]));
}

// Server Room elevation layout model (docs/ITOPS.md Server Room View). The
// elevation view is a projection of the same floor grid the floor plan and the
// 2.5D view draw: each occupied grid row becomes one band of cabinets ordered
// left to right by grid column, so a Rack moved in any spatial view moves in
// the elevation too. Aisle rows hold no cabinets and are skipped, so band
// numbers count occupied rows rather than raw grid coordinates. Pure and
// testable: no DOM, no i18n — the band label strings live in the component.

import type { Rack } from "../../types";
import { topologyGroupKey } from "./rackTopology";
import { resolveIsoLayout } from "./roomIsoLayout";
import type { FreePlacementMap } from "./siteTreeState";

export interface RackElevationRow {
  /** 1-based position among the room's occupied grid rows. */
  index: number;
  /** The `rackGroup` every Rack in this band shares, or null when mixed/untagged. */
  groupKey: string | null;
  /** Cabinets in this band, ordered by grid column. */
  racks: Rack[];
}

// A band shows its group name only when the whole row belongs to one named
// group. That is the common case — unplaced cabinets default to one grid row
// per rack group — so grouping stays visible without competing with position.
function sharedGroupKey(racks: Rack[]): string | null {
  const first = racks[0]?.rackGroup ?? "";
  if (!first.trim()) return null;
  const comparable = topologyGroupKey(first);
  return racks.every((rack) => topologyGroupKey(rack.rackGroup ?? "") === comparable)
    ? first
    : null;
}

/** Project the shared floor grid into elevation bands, top row first. */
export function resolveElevationRows(
  racks: Rack[],
  placement: FreePlacementMap,
): RackElevationRow[] {
  const { cells } = resolveIsoLayout(racks, placement);
  const byRow = new Map<number, Rack[]>();
  for (const rack of racks) {
    const cell = cells[rack.id];
    if (!cell) continue;
    const band = byRow.get(cell.y);
    if (band) band.push(rack);
    else byRow.set(cell.y, [rack]);
  }
  return [...byRow.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, band], index) => {
      // Sort the copies this function built, never the caller's array: the
      // elevation order is derived at render time and must not reorder storage.
      band.sort((left, right) => cells[left.id].x - cells[right.id].x);
      return { index: index + 1, groupKey: sharedGroupKey(band), racks: band };
    });
}

/** Presentation order for the Server Room PDF export: the elevation bands
 *  flattened top row first, left to right, so the report reads like the view. */
export function sortRacksForElevation(
  racks: Rack[],
  placement: FreePlacementMap,
): Rack[] {
  return resolveElevationRows(racks, placement).flatMap((row) => row.racks);
}

import assert from "node:assert/strict";
import test from "node:test";
import type { Rack } from "../src/types";
import {
  resolveElevationRows,
  sortRacksForElevation,
} from "../src/modules/itops/roomElevationLayout";
import { resolveIsoLayout } from "../src/modules/itops/roomIsoLayout";
import type { FreePlacementMap } from "../src/modules/itops/siteTreeState";

function rack(name: string, rackGroup = ""): Rack {
  return {
    id: `rack-${name}`,
    siteId: "site-1",
    name,
    serverRoom: "Room A",
    rackGroup,
    shell: null,
    background: null,
    heightU: 42,
    depthMm: 1000,
    sortOrder: 0,
    items: [],
  };
}

function names(racks: Rack[]): string[] {
  return racks.map((entry) => entry.name);
}

test("Server Room elevation bands follow the shared floor grid, not the Rack name order", () => {
  const racks = [rack("A1"), rack("A2"), rack("B1"), rack("B2")];
  // Deliberately the reverse of the natural name order in both axes.
  const placement: FreePlacementMap = {
    "rack-A1": { x: 3, y: 2 },
    "rack-A2": { x: 1, y: 2 },
    "rack-B1": { x: 4, y: 0 },
    "rack-B2": { x: 0, y: 0 },
  };

  const rows = resolveElevationRows(racks, placement);

  assert.deepEqual(rows.map((row) => row.index), [1, 2]);
  assert.deepEqual(rows.map((row) => names(row.racks)), [["B2", "B1"], ["A2", "A1"]]);
  assert.deepEqual(names(sortRacksForElevation(racks, placement)), ["B2", "B1", "A2", "A1"]);
});

test("Server Room elevation numbers occupied rows and skips aisle rows", () => {
  const racks = [rack("A1"), rack("B1"), rack("C1")];
  const placement: FreePlacementMap = {
    "rack-A1": { x: 0, y: 0 },
    "rack-B1": { x: 0, y: 4 },
    "rack-C1": { x: 0, y: 9 },
  };

  const rows = resolveElevationRows(racks, placement);

  assert.deepEqual(rows.map((row) => row.index), [1, 2, 3]);
  assert.deepEqual(rows.map((row) => names(row.racks)), [["A1"], ["B1"], ["C1"]]);
});

test("Server Room elevation bands name a rack group only when the whole row shares one", () => {
  const racks = [rack("A1", "Core"), rack("A2", "core"), rack("B1", "Core"), rack("B2", "Edge")];
  const placement: FreePlacementMap = {
    "rack-A1": { x: 0, y: 0 },
    "rack-A2": { x: 1, y: 0 },
    "rack-B1": { x: 0, y: 2 },
    "rack-B2": { x: 1, y: 2 },
  };

  const rows = resolveElevationRows(racks, placement);

  assert.equal(rows[0].groupKey, "Core");
  assert.equal(rows[1].groupKey, null);
});

test("Server Room elevation leaves untagged rows without a group name", () => {
  const rows = resolveElevationRows([rack("A1"), rack("A2")], {
    "rack-A1": { x: 0, y: 0 },
    "rack-A2": { x: 1, y: 0 },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].groupKey, null);
});

test("Server Room elevation places unplaced Racks on the same derived cells as the spatial views", () => {
  const racks = [rack("C1", "C"), rack("A1", "A"), rack("A2", "A")];

  const rows = resolveElevationRows(racks, {});
  const { cells } = resolveIsoLayout(racks, {});

  // The default layout gives each rack group its own floor row, so the
  // elevation must show the same two bands the floor plan and 2.5D view draw.
  assert.deepEqual(rows.map((row) => names(row.racks)), [["C1"], ["A1", "A2"]]);
  for (const row of rows) {
    for (const entry of row.racks) {
      assert.ok(cells[entry.id], `${entry.name} should resolve to a floor cell`);
    }
  }
  assert.deepEqual(
    rows.map((row) => row.racks.map((entry) => cells[entry.id].y)),
    [[0], [2, 2]],
  );
});

test("Server Room elevation ordering never reorders the caller's Rack array", () => {
  const racks = [rack("A1"), rack("A2"), rack("A3")];
  const placement: FreePlacementMap = {
    "rack-A1": { x: 2, y: 0 },
    "rack-A2": { x: 0, y: 0 },
    "rack-A3": { x: 1, y: 0 },
  };

  const rows = resolveElevationRows(racks, placement);

  assert.deepEqual(names(rows[0].racks), ["A2", "A3", "A1"]);
  assert.deepEqual(names(racks), ["A1", "A2", "A3"]);
});

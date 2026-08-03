import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Rack View placement follows the clicked face and callouts stay within its grid", async () => {
  const [stage, sites] = await Promise.all([
    read("src/modules/itops/RackStage.tsx"),
    read("src/modules/itops/SitesTab.tsx"),
  ]);

  assert.match(stage, /\{ \.\.\.placeSpec, mountFace: face \}/);
  assert.match(stage, /onPlaceAt\(startU, slot, face\)/);
  assert.match(sites, /mountFace: face \?\? placeDevice\.mountFace/);
  assert.match(stage, /geom\.top \+ geom\.height - 22/);
  assert.doesNotMatch(stage, /geom\.stageHeight - 22/);
});

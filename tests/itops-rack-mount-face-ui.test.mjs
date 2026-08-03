import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("rack elevations reveal one reachable cabinet flip on hover and keep the toolbar flip", async () => {
  const [elevation, sites, css, bag] = await Promise.all([
    read("src/modules/itops/RackElevation.tsx"),
    read("src/modules/itops/SitesTab.tsx"),
    read("src/modules/itops/itops.css"),
    read("src/modules/itops/KuaiKuaiBag.tsx"),
  ]);

  assert.match(elevation, /className="rk-cabinet-flip"/);
  assert.match(elevation, /const allCabinetItems = rack\.items\.filter/);
  assert.match(elevation, /for \(const item of allCabinetItems\)/);
  assert.match(elevation, /allCabinetItems\.length > 0/);
  assert.match(elevation, /data-face=\{displayFace\}/);
  assert.match(elevation, /face-turning/);
  assert.match(sites, /allRackFacesLabel/);
  assert.match(sites, /className="it-drill-action rack-flip-all-action"/);
  assert.match(
    sites,
    /setAllElevationFaces\(globalElevationFace === "front" \? "rear" : "front"\)/,
  );
  assert.doesNotMatch(sites, /rack-face-global-control/);
  assert.match(sites, /setAllElevationFaces/);
  assert.match(css, /@keyframes rkFaceTurn/);
  assert.match(css, /\.rk-cabinet-flip \{[\s\S]*bottom: calc\(100% \+ 5px\)/);
  assert.match(css, /\.rk-cabinet-flip \{[\s\S]*opacity: 0;[\s\S]*pointer-events: none;/);
  assert.match(css, /\.rk:hover \.rk-cabinet-flip,[\s\S]*\.rk:focus-within \.rk-cabinet-flip \{[\s\S]*opacity: 1;[\s\S]*pointer-events: auto;/);
  assert.match(css, /\.rk\.has-face-toggle \.rk-cabinet \{[\s\S]*margin-top: max/);
  assert.match(css, /\.rk\.has-face-toggle \.rk-cabinet::before \{[\s\S]*bottom: 100%;[\s\S]*height: 34px;/);
  assert.match(css, /\.rk\[data-face="rear"\]/);
  assert.match(bag, /data-face=\{face\}/);
  assert.match(bag, /face === "rear"/);
  for (const rearArtworkPart of [
    "kk-rear-mini-pack",
    "kk-rear-hand",
    "kk-rear-kk-mark",
    "kk-rear-song",
    "kk-rear-nutrition",
    "kk-rear-barcode",
  ]) {
    assert.match(bag, new RegExp(rearArtworkPart));
  }
  assert.doesNotMatch(bag, /kk-rear-mascot/);
});

test("room elevation placement follows an individually flipped Rack face", async () => {
  const sites = await read("src/modules/itops/SitesTab.tsx");

  assert.match(
    sites,
    /const roomPlacementDraft = [\s\S]*?mountFace: face/,
  );
  assert.match(sites, /placeSpec=\{roomPlacementDraft\}/);
  assert.match(sites, /onPlaceDevice\(r, roomPlacementDraft, startU, slot\)/);
});

test("Rack View and 2.5D render independent front and rear faces", async () => {
  const [stage, iso] = await Promise.all([
    read("src/modules/itops/RackStage.tsx"),
    read("src/modules/itops/ServerRoomIsoView.tsx"),
  ]);

  assert.match(stage, /frontItems\.length > 0 && rearItems\.length > 0/);
  assert.match(stage, /dualFace/);
  assert.match(stage, /faces\.map/);
  assert.match(stage, /face === "front"\s*\?\s*"left"\s*:\s*"right"/);
  assert.match(stage, /spreadBalloonLane/);
  assert.match(stage, /showRackTop\s+reserveTopU/);
  assert.match(stage, /item\.kind === "kuaiguai"[\s\S]*faces\.length === 1 \|\| face === "front"/);
  assert.match(
    stage,
    /const frontItems = rack\.items\.filter\([\s\S]*?item\.kind !== "kuaiguai" && \(item\.mountFace \?\? "front"\) === "front"/,
  );
  assert.match(
    stage,
    /const rearItems = rack\.items\.filter\([\s\S]*?item\.kind !== "kuaiguai" && item\.mountFace === "rear"/,
  );
  assert.match(stage, /metadata\?\.vendor\?\.trim\(\)/);
  assert.match(stage, /metadata\?\.notes\?\.trim\(\)/);
  assert.match(stage, /className="rk-balloon-notes"/);
  assert.match(iso, /<IsoRackSkin rack=\{rack\} axis="[xy]" face="front"/);
  assert.match(iso, /<IsoRackSkin rack=\{rack\} axis="[xy]" face="rear"/);
  assert.doesNotMatch(iso, /rm-iso-front-marker/);
});

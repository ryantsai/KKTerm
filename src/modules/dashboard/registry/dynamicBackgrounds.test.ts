import {
  DYNAMIC_BACKGROUNDS,
  type DynamicBackgroundId,
  getDashboardDynamicBackgroundHostClassName,
  isDynamicBackgroundId,
} from "./dynamicBackgrounds";

const expectedIds = [
  "fuji",
  "aurora",
  "halftone",
  "clouds",
  "ocean",
  "mistySea",
  "maelstrom",
  "sunGlitter",
  "whitecaps",
  "waveField",
  "openOceanBlue",
  "tropicalGreen",
  "waters",
  "raindrops",
  "rainywindow",
  "frostedWindow",
  "snow",
  "sakura",
  "fireflies",
  "bubbles",
  "aquarium",
  "jellyfish",
  "lighthouse",
  "balloons",
  "ricefield",
  "lanterns",
  "starfield",
  "nebula",
  "orbitals",
  "embers",
  "lava",
  "ink",
  "dunes",
  "savanna",
  "matrix",
  "topo",
  "synthwave",
  "circuit",
  "crystals",
  "cyberpunk",
  "taipei101",
  "thunderstorm",
  "confetti",
  "particleCursor",
  "heroGeometric",
  "webglLiquid",
  "silkAurora",
  "animatedGradient",
  "ditherPrismHero",
  "closingPlasma",
  "prismGradient",
  "liquidChrome",
  "windowRain",
  "submergedSnellOcean",
  "spectralCascadeOcean",
  "blackHole",
  "predictiveArc",
  "liquidForm",
  "energyOrb",
  "noiseFlow",
  "streamConvergence",
  "bellField",
  "flowField",
  "condensation",
  "generativeTree",
  "ribbonField",
  "particleOrb",
  "cloudField",
  "voidField",
  "recursiveErosion",
  "quanteraTradingBackground",
  "halftoneFlow",
  "constellationField",
  "particleDrift",
  "particleNetwork",
  "amberHalftone",
  "matrixField",
  "gatewayFlow",
  "connectivityGraph",
  "interfaceLines",
  "defenseLines",
  "topoField",
  "sylvaLivingWorld",
  "templeNight",
] as const satisfies readonly DynamicBackgroundId[];

if (DYNAMIC_BACKGROUNDS.length !== expectedIds.length) {
  throw new Error("Dynamic Dashboard background registry count should match the expected id list.");
}

for (const id of expectedIds) {
  if (!isDynamicBackgroundId(id)) {
    throw new Error(`Dynamic Dashboard background id should be accepted: ${id}`);
  }
}

for (const id of ["crt", "sparkBadge", "hypnoticLoops", "elements", "portalField"]) {
  if (isDynamicBackgroundId(id)) {
    throw new Error(`Excluded ThreeUI background id should not be accepted: ${id}`);
  }
}

if (isDynamicBackgroundId("none")) {
  throw new Error("Theme default should not be stored as a dynamic Dashboard background.");
}

if (getDashboardDynamicBackgroundHostClassName() !== "dw-canvas-bg dw-dynamic-bg-layer") {
  throw new Error("Dynamic Dashboard backgrounds should use the stable scroll-level background placement class.");
}

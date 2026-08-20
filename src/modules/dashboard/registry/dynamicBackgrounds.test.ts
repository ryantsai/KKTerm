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
  "subsurfaceScatter",
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
] as const satisfies readonly DynamicBackgroundId[];

if (DYNAMIC_BACKGROUNDS.length !== expectedIds.length) {
  throw new Error("Dynamic Dashboard background registry count should match the expected id list.");
}

for (const id of expectedIds) {
  if (!isDynamicBackgroundId(id)) {
    throw new Error(`Dynamic Dashboard background id should be accepted: ${id}`);
  }
}

if (isDynamicBackgroundId("none")) {
  throw new Error("Theme default should not be stored as a dynamic Dashboard background.");
}

if (getDashboardDynamicBackgroundHostClassName() !== "dw-canvas-bg dw-dynamic-bg-layer") {
  throw new Error("Dynamic Dashboard backgrounds should use the stable scroll-level background placement class.");
}

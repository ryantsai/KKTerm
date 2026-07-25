import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const backgrounds = [
  { id: "heroGeometric", component: "HeroGeometricBg", file: "hero-geometric.tsx" },
  { id: "ditherPrismHero", component: "DitherPrismHeroBg", file: "dither-prism-hero.tsx" },
  { id: "webglLiquid", component: "WebGLLiquidBg", file: "webgl-liquid.tsx" },
  { id: "silkAurora", component: "SilkAuroraBg", file: "silk-aurora.tsx" },
  { id: "closingPlasma", component: "ClosingPlasmaBg", file: "closing-plasma.tsx" },
  { id: "animatedGradient", component: "AnimatedGradientBg", file: "animated-gradient.tsx" },
  { id: "prismGradient", component: "PrismGradientBg", file: "prism-gradient.tsx" },
  { id: "liquidChrome", component: "LiquidChromeBg", file: "liquid-chrome.tsx" },
];

const registrySource = await readFile(
  new URL("../src/modules/dashboard/registry/dynamicBackgrounds.tsx", import.meta.url),
  "utf8",
);
const adapterSource = await readFile(
  new URL("../src/modules/dashboard/registry/componentryBackgrounds.tsx", import.meta.url),
  "utf8",
);
const previewSource = await readFile(
  new URL("../src/modules/dashboard/registry/dynamicBackgroundPreviewArt.tsx", import.meta.url),
  "utf8",
);
const validationSource = await readFile(
  new URL("../src-tauri/src/dashboard_validation.rs", import.meta.url),
  "utf8",
);
const dashboardManual = await readFile(
  new URL("../docs/manual/10-dashboard.md", import.meta.url),
  "utf8",
);
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const tauriConfig = await readFile(
  new URL("../src-tauri/tauri.conf.json", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("all Componentry hero backgrounds use the shared KKTerm background path", async () => {
  for (const background of backgrounds) {
    assert.match(
      adapterSource,
      new RegExp(`export function ${background.component}\\(`),
    );
    assert.match(
      registrySource,
      new RegExp(`${background.id}: ${background.component}`),
    );
    assert.match(
      registrySource,
      new RegExp(`\\{ id: "${background.id}", labelKey: "dashboard\\.dynamicBackgrounds\\.${background.id}"`),
    );
    assert.match(previewSource, new RegExp(`BUILDERS\\.${background.id} = \\(id\\) =>`));
    assert.match(validationSource, new RegExp(`"${background.id}"`));
    assert.match(dashboardManual, new RegExp(`\\\`${background.id}\\\``));
    assert.match(readme, new RegExp(`\\\`${background.id}\\\``));

    const implementation = await readFile(
      new URL(`../src/modules/dashboard/registry/componentry/${background.file}`, import.meta.url),
      "utf8",
    );
    assert.match(implementation, /Adapted from Componentry/);
    assert.doesNotMatch(implementation, /@workspace\/ui|next-themes|framer-motion/);
    assert.doesNotMatch(implementation, /Math\.min\(window\.devicePixelRatio \|\| 1, (?:1\.[6-9]|[2-9])/);
    assert.doesNotMatch(implementation, /const (?:dpr|pixelRatio) = window\.devicePixelRatio \|\| 1/);
  }

  assert.match(packageJson.dependencies["@react-three/fiber"], /^\^9\./);
  assert.match(adapterSource, /useDashboardAnimationActive/);
  assert.match(adapterSource, /active \? children : null/);
  assert.match(tauriConfig, /componentry-mit\.txt/);
});

test("Componentry background names exist in every locale", async () => {
  const localeDirectory = new URL("../src/i18n/locales/", import.meta.url);
  const localeFiles = (await readdir(localeDirectory)).filter((file) => file.endsWith(".json"));
  for (const localeFile of localeFiles) {
    const locale = JSON.parse(await readFile(new URL(localeFile, localeDirectory), "utf8"));
    for (const background of backgrounds) {
      assert.equal(typeof locale.dashboard.dynamicBackgrounds[background.id], "string");
      assert.notEqual(locale.dashboard.dynamicBackgrounds[background.id].trim(), "");
    }
  }
});

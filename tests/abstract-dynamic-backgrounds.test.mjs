import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backgrounds = [
  { id: "circuit", component: "CircuitBg", label: "Circuit", mood: "geeky" },
  { id: "halftone", component: "HalftoneBg", label: "Halftone", mood: "calm" },
  { id: "orbitals", component: "OrbitalsBg", label: "Orbitals", mood: "spacey" },
  { id: "ink", component: "InkBg", label: "Ink", mood: "warm" },
  { id: "crystals", component: "CrystalsBg", label: "Crystals", mood: "geeky" },
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const abstractBackgroundsSource = await readFile(
  new URL("../src/modules/dashboard/registry/abstractDynamicBackgrounds.tsx", import.meta.url),
  "utf8",
);
const registrySource = await readFile(
  new URL("../src/modules/dashboard/registry/dynamicBackgrounds.tsx", import.meta.url),
  "utf8",
);
const dashboardValidationSource = await readFile(
  new URL("../src-tauri/src/dashboard_validation.rs", import.meta.url),
  "utf8",
);
const englishLocaleSource = await readFile(
  new URL("../src/i18n/locales/en.json", import.meta.url),
  "utf8",
);
const dashboardManualSource = await readFile(
  new URL("../docs/manual/10-dashboard.md", import.meta.url),
  "utf8",
);
const readmeSource = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("abstract dynamic backgrounds are available everywhere the picker needs them", () => {
  for (const background of backgrounds) {
    assert.match(
      abstractBackgroundsSource,
      new RegExp(`export function ${background.component}\\(`),
      `${background.id} should have a Dashboard canvas implementation`,
    );
    assert.match(
      registrySource,
      new RegExp(`${background.id}: ${background.component}`),
      `${background.id} should be registered with its React component`,
    );
    assert.match(
      registrySource,
      new RegExp(
        `\\{ id: "${background.id}", labelKey: "dashboard\\.dynamicBackgrounds\\.${background.id}", mood: "${background.mood}" \\}`,
      ),
      `${background.id} should be exposed in the shared background datasource`,
    );
    assert.ok(
      existsSync(new URL(`../public/dynamic-bg-thumbs/${background.id}.webp`, import.meta.url)),
      `${background.id} should have a captured static thumbnail`,
    );
    assert.match(
      dashboardValidationSource,
      new RegExp(`"${background.id}"`),
      `${background.id} should be allowed by dashboard JSON validation`,
    );
    assert.match(
      englishLocaleSource,
      new RegExp(`"${background.id}": "${escapeRegExp(background.label)}"`),
      `${background.id} should have an English i18n label`,
    );
    assert.match(dashboardManualSource, new RegExp(`\`${background.id}\``));
    assert.match(readmeSource, new RegExp(`\`${background.id}\``));
  }
});

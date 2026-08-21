import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backgrounds = [
  { id: "jellyfish", component: "JellyfishBg", label: "Jellyfish", mood: "calm" },
  { id: "lighthouse", component: "LighthouseBg", label: "Lighthouse", mood: "calm" },
  { id: "balloons", component: "BalloonsBg", label: "Balloons", mood: "calm" },
  { id: "dunes", component: "DunesBg", label: "Desert Dunes", mood: "warm" },
  { id: "savanna", component: "SavannaBg", label: "Savanna", mood: "warm" },
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const registrySource = await readFile(
  new URL("../src/modules/dashboard/registry/dynamicBackgrounds.tsx", import.meta.url),
  "utf8",
);
const extraBackgroundsSource = await readFile(
  new URL("../src/modules/dashboard/registry/extraDynamicBackgrounds.tsx", import.meta.url),
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

test("Dashboard HTML dynamic backgrounds are available everywhere the picker needs them", () => {
  for (const background of backgrounds) {
    assert.match(
      extraBackgroundsSource,
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

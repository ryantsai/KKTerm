import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const localeDir = new URL("../src/i18n/locales/", import.meta.url);
const localizedDynamicBackgroundKeys = [
  "jellyfish",
  "lighthouse",
  "balloons",
  "dunes",
  "savanna",
  "sunGlitter",
  "whitecaps",
  "waveField",
  "openOceanBlue",
  "tropicalGreen",
];

async function readLocale(fileName) {
  return JSON.parse(await readFile(new URL(fileName, localeDir), "utf8"));
}

test("new dynamic background names are localized in every non-English locale", async () => {
  const english = await readLocale("en.json");
  const localeFiles = (await readdir(localeDir))
    .filter((fileName) => fileName.endsWith(".json") && fileName !== "en.json")
    .sort();

  for (const localeFile of localeFiles) {
    const locale = await readLocale(localeFile);
    for (const key of localizedDynamicBackgroundKeys) {
      assert.notEqual(
        locale.dashboard.dynamicBackgrounds[key],
        english.dashboard.dynamicBackgrounds[key],
        `${localeFile} should translate dashboard.dynamicBackgrounds.${key}`,
      );
    }
  }
});

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const localeDirectory = new URL("../src/i18n/locales/", import.meta.url);

test("the extra-header editor uses header-specific translation keys", async () => {
  const source = await readFile(
    new URL("../src/modules/settings/AiSettings.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /t\("settings\.extraHeaderName"\)/);
  assert.match(source, /t\("settings\.extraHeaderValue"\)/);
  assert.doesNotMatch(source, /t\("settings\.environmentVariable(?:Name|Value)"\)/);
});

test("every locale translates the extra-header column labels", async () => {
  const localeFiles = (await readdir(localeDirectory)).filter((name) => name.endsWith(".json"));

  for (const localeFile of localeFiles) {
    const locale = JSON.parse(await readFile(new URL(localeFile, localeDirectory), "utf8"));
    assert.equal(typeof locale.settings.extraHeaderName, "string", `${localeFile} header name`);
    assert.equal(typeof locale.settings.extraHeaderValue, "string", `${localeFile} header value`);
  }
});

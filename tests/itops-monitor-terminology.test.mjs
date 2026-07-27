import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("English IT Ops copy calls durable rules Monitors", async () => {
  const locale = JSON.parse(await readFile("src/i18n/locales/en.json", "utf8"));

  assert.equal(locale.itops.tabs.autos, "Monitors");
  assert.equal(locale.itops.actions.newAutomation, "New Monitor");
  assert.equal(locale.itops.editor.title, "Edit Monitor");

  const userFacingValues = [];
  const collectStrings = (value) => {
    if (typeof value === "string") {
      userFacingValues.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collectStrings);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(collectStrings);
    }
  };
  collectStrings(locale);

  assert.equal(
    userFacingValues.filter((value) => /\bAutomations?\b/.test(value)).length,
    0,
    "internal automation identifiers must not leak into English UI copy",
  );
});

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("IT Ops no longer exposes or runs the removed Monitor feature", async () => {
  const [sites, state, moduleShell, appSetup, commands, tutorial] = await Promise.all([
    read("src/modules/itops/SitesTab.tsx"),
    read("src/modules/itops/state.ts"),
    read("src/modules/itops/ItOpsModule.tsx"),
    read("src-tauri/src/lib.rs"),
    read("src/lib/tauri.ts"),
    read("src/app/tutorialNavigationModel.ts"),
  ]);

  for (const source of [sites, state, moduleShell, commands, tutorial]) {
    assert.doesNotMatch(source, /"automations"/);
  }
  assert.doesNotMatch(appSetup, /automation_commands|hydrate_automations|ItopsAutomationRuntime/);

  await assert.rejects(access("src/modules/itops/AutomationEditor.tsx"));
  await assert.rejects(access("src/modules/itops/AutomationsTab.tsx"));
});

test("legacy Monitor data is retained but permanently marked obsolete", async () => {
  const [schema, selectiveExport] = await Promise.all([
    read("src-tauri/src/storage.rs"),
    read("src-tauri/src/selective_export.rs"),
  ]);

  assert.match(schema, /CREATE TABLE IF NOT EXISTS itops_automations[\s\S]*?obsolete_at\s+TEXT/);
  assert.match(
    schema,
    /UPDATE itops_automations[\s\S]*?enabled = 0[\s\S]*?obsolete_at = COALESCE/,
  );
  assert.match(
    selectiveExport,
    /storage::mark_legacy_monitors_obsolete\(&tx\)/,
  );
});

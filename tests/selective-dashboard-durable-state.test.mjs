import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [exportDialog, importDialog] = await Promise.all([
  readFile(new URL("../src/modules/settings/SelectiveExportDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/modules/settings/SelectiveImportDialog.tsx", import.meta.url), "utf8"),
]);

test("selective Dashboard export flushes durable widget data before snapshotting SQLite", () => {
  const flushIndex = exportDialog.indexOf("await flushDurableUiState()");
  const exportIndex = exportDialog.indexOf('invokeCommand("export_selective_database"');
  assert.ok(flushIndex >= 0, "export must flush queued durable UI-state writes");
  assert.ok(exportIndex > flushIndex, "the flush must finish before backend export starts");
});

test("selective Dashboard import refreshes Notes cache before mounting imported instances", () => {
  const refreshIndex = importDialog.indexOf(
    'await reloadDurableUiStatePrefix("kkterm.dashboard.notes.")',
  );
  const loadIndex = importDialog.indexOf("await loadDashboard()", refreshIndex);
  assert.ok(refreshIndex >= 0, "import must refresh the durable Notes namespace");
  assert.ok(loadIndex > refreshIndex, "the imported Notes cache must exist before Dashboard reload");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Settings Import routes selective backups and full settings ZIP backups", async () => {
  const dialog = await readFile(new URL("../src/modules/settings/SelectiveImportDialog.tsx", import.meta.url), "utf8");
  const general = await readFile(new URL("../src/modules/settings/GeneralSettings.tsx", import.meta.url), "utf8");
  const tauri = await readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");

  assert.match(tauri, /selectSettingsBackupImportFile/);
  assert.match(tauri, /extensions:\s*\["kkbackup",\s*"zip"\]/);
  assert.match(dialog, /selectSettingsBackupImportFile/);
  assert.match(dialog, /inspect_selective_database/);
  assert.match(dialog, /setImportKind\("full"\)/);
  assert.match(dialog, /settings\.fullBackupCustomModulesWarning/);
  assert.match(dialog, /onFullImport/);
  assert.match(general, /handleImportFullSettings/);
  assert.match(general, /import_settings_database/);
  assert.match(general, /onFullImport=\{handleImportFullSettings\}/);
});

test("Selective replace import closes live workspace tabs before replacing workspace data", async () => {
  const dialog = await readFile(new URL("../src/modules/settings/SelectiveImportDialog.tsx", import.meta.url), "utf8");

  assert.match(
    dialog,
    /manifest\.segments\.includes\(segment\) && actions\[segment\] === "replace"/,
  );
  assert.match(
    dialog,
    /replacesPresentSegment\("workspaces"\) \|\| replacesPresentSegment\("connections"\)/,
  );
  assert.match(
    dialog,
    /if \(replacesWorkspaceData \|\| replacesPresentSegment\("settings"\)\) \{\s*closeAllTabs\(\);\s*\}/s,
  );
  assert.match(dialog, /importedConnections \|\| result\.applied\.includes\("workspaces"\)/);
});

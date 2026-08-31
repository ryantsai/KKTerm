import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Settings data actions expose only selective Import and Export buttons", async () => {
  const source = await readFile(new URL("../src/modules/settings/GeneralSettings.tsx", import.meta.url), "utf8");
  const actionsStart = source.indexOf('className="settings-data-actions settings-merged-block"');
  const actionsEnd = source.indexOf("</div>", actionsStart);
  const actionsBlock = source.slice(actionsStart, actionsEnd);

  assert.match(actionsBlock, /setSelectiveExportOpen\(true\)/);
  assert.match(actionsBlock, /setSelectiveImportOpen\(true\)/);
  assert.doesNotMatch(actionsBlock, /handleExportSettings/);
  assert.doesNotMatch(actionsBlock, /setImportDialogOpen\(true\)/);
  assert.doesNotMatch(actionsBlock, /settings\.selectiveExport/);
  assert.doesNotMatch(actionsBlock, /settings\.selectiveImport/);
});

test("Settings backup-folder Browse matches the Settings data action height", async () => {
  const css = await readFile(
    new URL("../src/modules/settings/settings.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /\.input-with-button \.toolbar-button,\s*\.input-with-button \.secondary-button,[\s\S]*?height:\s*36px;/,
  );
});

test("Selective data dialogs preserve backend segments behind five UI groups", async () => {
  const exportDialog = await readFile(
    new URL("../src/modules/settings/SelectiveExportDialog.tsx", import.meta.url),
    "utf8",
  );
  const importDialog = await readFile(
    new URL("../src/modules/settings/SelectiveImportDialog.tsx", import.meta.url),
    "utf8",
  );
  const portableDialog = await readFile(
    new URL("../src/modules/settings/PortableCreatorDialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    exportDialog,
    /id: "workspacesConnections"[^\n]+segments: \["workspaces", "connections"\]/,
  );
  assert.match(exportDialog, /id: "dashboards"[^\n]+segments: \["dashboards"\]/);
  assert.match(exportDialog, /id: "itops"[^\n]+segments: \["itops"\]/);
  assert.match(exportDialog, /id: "assistant"[^\n]+segments: \["assistant"\]/);
  assert.match(exportDialog, /id: "settings"[^\n]+segments: \["settings", "mcpServers"\]/);
  assert.match(exportDialog, /\.flatMap\(\(group\) => group\.segments\)/);
  assert.match(importDialog, /EXPORT_GROUPS\.filter/);
  assert.match(importDialog, /group\.segments\.some/);
  assert.match(importDialog, /updateGroupAction\(group\.segments/);
  assert.match(portableDialog, /\.flatMap\(\(group\) => group\.segments\)/);
});

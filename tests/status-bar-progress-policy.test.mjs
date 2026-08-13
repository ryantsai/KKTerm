import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = await Promise.all(
  [
    "../src/store.ts",
    "../src/modules/workspace/StatusBar.tsx",
    "../src/app/AppUpdatePrompt.tsx",
    "../src/modules/workspace/connections/file-viewer/FileViewerWorkspace.tsx",
    "../src/modules/itops/IpamPanel.tsx",
    "../src/modules/custom-modules/useCustomModules.ts",
    "../docs/DESIGN_LANGUAGE.md",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);

const [store, statusBar, appUpdate, fileViewer, ipam, customModules, designLanguage] = files;

test("Status Bar exposes a separate inline progress surface", () => {
  assert.match(store, /showStatusBarInlineProgress:/);
  assert.match(store, /updateStatusBarInlineProgress:/);
  assert.match(store, /clearStatusBarInlineProgress:/);
  assert.match(statusBar, /function StatusBarInlineProgress/);
  assert.match(statusBar, /<Progress[\s\S]*value=\{progress\.progress\}/);
});

test("routine work uses inline progress while update downloads stay prominent", () => {
  for (const source of [fileViewer, ipam]) {
    assert.match(source, /showStatusBarInlineProgress/);
    assert.doesNotMatch(source, /showStatusBarProgress/);
  }
  assert.match(appUpdate, /showStatusBarProgress/);
  assert.doesNotMatch(appUpdate, /showStatusBarInlineProgress/);
  assert.match(customModules, /showStatusBarProgress/);
  assert.match(customModules, /cancel_custom_module_download/);
});

test("design guidance makes inline progress the default", () => {
  assert.match(designLanguage, /showStatusBarInlineProgress/);
  assert.match(designLanguage, /high-salience or cancelable/);
});

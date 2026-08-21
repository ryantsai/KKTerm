import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Dashboard empty-canvas context menu exposes add-widget and edit-mode shortcuts", async () => {
  const page = await readFile(new URL("../src/modules/dashboard/DashboardPage.tsx", import.meta.url), "utf8");
  const canvas = await readFile(new URL("../src/modules/dashboard/view/DashboardCanvas.tsx", import.meta.url), "utf8");

  assert.match(canvas, /onOpenCatalog: \(\) => void;/);
  assert.match(canvas, /onToggleEditMode: \(\) => void;/);
  assert.match(canvas, /label: t\("dashboard\.addWidgetLabel"\), iconSvg: nativeMenuIcons\.plus, action: onOpenCatalog/);
  assert.match(canvas, /label: editMode \? t\("dashboard\.editDone"\) : t\("dashboard\.editLayout"\), iconSvg: nativeMenuIcons\.pencil, action: onToggleEditMode/);
  assert.match(canvas, /label: t\("dashboard\.changeBackground"\), iconSvg: nativeMenuIcons\.image, action: onOpenBackground/);
  assert.match(page, /onOpenCatalog=\{\(\) => setCatalogOpen\(true\)\}/);
  assert.match(page, /onToggleEditMode=\{toggleEditMode\}/);
});

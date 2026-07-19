import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("top-level Modules use the shared compact header template", async () => {
  const paths = [
    "src/modules/workspace/connections/ConnectionSidebar.tsx",
    "src/modules/dashboard/DashboardPage.tsx",
    "src/modules/installer/InstallerPage.tsx",
    "src/modules/itops/ItOpsModule.tsx",
    "src/modules/screenshots/ScreenshotsPage.tsx",
  ];

  for (const path of paths) {
    const source = await read(path);
    assert.match(source, /from ["'][^"']*app\/ModuleHeader["']/);
    assert.match(source, /<ModuleHeader\b/);
    assert.match(source, /<ModuleIconTile\b/);
  }
});

test("Install Helper pane header uses the Activity Rail module icon", async () => {
  const [activityRail, installerPage] = await Promise.all([
    read("src/app/ActivityRail.tsx"),
    read("src/modules/installer/InstallerPage.tsx"),
  ]);

  assert.match(
    activityRail,
    /import \{ InstallHelperModuleIcon, ScreenshotsModuleIcon \} from "\.\/moduleIdentityIcons"/,
  );
  assert.match(activityRail, /<InstallHelperModuleIcon size=\{18\} \/>/);
  assert.match(installerPage, /import \{ InstallHelperModuleIcon \} from "\.\.\/\.\.\/app\/moduleIdentityIcons"/);
  assert.match(installerPage, /<InstallHelperModuleIcon size=\{16\} aria-hidden="true" \/>/);
  assert.doesNotMatch(installerPage, /<Box size=\{16\}/);
});

test("Screenshots pane header uses the Activity Rail module icon", async () => {
  const [activityRail, screenshotsPage] = await Promise.all([
    read("src/app/ActivityRail.tsx"),
    read("src/modules/screenshots/ScreenshotsPage.tsx"),
  ]);

  assert.match(activityRail, /<ScreenshotsModuleIcon size=\{18\} \/>/);
  assert.match(
    screenshotsPage,
    /import \{ ScreenshotsModuleIcon \} from "\.\.\/\.\.\/app\/moduleIdentityIcons"/,
  );
  assert.match(screenshotsPage, /<ScreenshotsModuleIcon size=\{16\} aria-hidden="true" \/>/);
});

test("Settings reuses Module identity tiles", async () => {
  const [general, page] = await Promise.all([
    read("src/modules/settings/GeneralSettings.tsx"),
    read("src/modules/settings/SettingsPage.tsx"),
  ]);

  assert.match(general, /<ActivityRailModuleIcon id=\{id\}/);
  assert.match(general, /<ModuleIconTile compact module=\{module\}/);
  assert.match(page, /module: "workspace"/);
  assert.match(page, /module: "dashboard"/);
  assert.match(page, /module: "installer"/);
  assert.match(page, /<ModuleIconTile compact module=\{module\}/);
});

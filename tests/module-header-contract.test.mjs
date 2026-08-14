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

test("Activity Rail and shared Module identity text cannot be selected", async () => {
  const [appStyles, headerStyles] = await Promise.all([
    read("src/app/app.css"),
    read("src/app/moduleHeader.css"),
  ]);

  assert.match(
    appStyles,
    /\.activity-rail\s*\{[^}]*user-select:\s*none;[^}]*-webkit-user-select:\s*none;/s,
  );
  assert.match(appStyles, /\.activity-rail img\s*\{[^}]*-webkit-user-drag:\s*none;/s);
  assert.match(
    headerStyles,
    /\.module-header__lead,[\s\S]*\.module-header__title,[\s\S]*\.module-header__meta,[\s\S]*user-select:\s*none;[\s\S]*-webkit-user-select:\s*none;/,
  );
  assert.doesNotMatch(headerStyles, /\.module-header\s*\{[^}]*user-select:\s*none/s);
});

test("Install Helper pane header uses the Activity Rail module icon", async () => {
  const [activityRail, installerPage] = await Promise.all([
    read("src/app/ActivityRail.tsx"),
    read("src/modules/installer/InstallerPage.tsx"),
  ]);

  assert.match(
    activityRail,
    /import \{ InstallHelperModuleIcon, ScreenshotsModuleIcon, SystemCleanerModuleIcon \} from "\.\/moduleIdentityIcons"/,
  );
  assert.match(activityRail, /<InstallHelperModuleIcon size=\{18\} \/>/);
  assert.match(activityRail, /<SystemCleanerModuleIcon size=\{18\} \/>/);
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

test("System Cleaner uses the Broom3 Module identity icon", async () => {
  const identityIcons = await read("src/app/moduleIdentityIcons.tsx");

  assert.match(identityIcons, /import \{ Broom3, Camera, Package \} from "\.\.\/lib\/reicon"/);
  assert.match(identityIcons, /SystemCleanerModuleIcon = Broom3/);
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

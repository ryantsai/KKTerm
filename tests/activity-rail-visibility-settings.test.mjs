import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const [
  defaults,
  activityRail,
  generalSettings,
  workspaceSettings,
  installerSettings,
  settingsPage,
  activityRailCss,
] = await Promise.all([
  source("../src/app-defaults.ts"),
  source("../src/app/ActivityRail.tsx"),
  source("../src/modules/settings/GeneralSettings.tsx"),
  source("../src/modules/settings/WorkspaceSettings.tsx"),
  source("../src/modules/settings/InstallerSettings.tsx"),
  source("../src/modules/settings/SettingsPage.tsx"),
  source("../src/app/app.css"),
]);

test("General settings owns all built-in Activity Rail visibility controls", () => {
  assert.match(generalSettings, /visibleActivityRailModuleOrder\.map/);
  assert.match(generalSettings, /reorderActivityRailItems/);
  assert.match(generalSettings, /activity-rail-order-main/);
  for (const icon of ["LayoutDashboard", "Gauge", "InstallHelperModuleIcon", "ItIcon", "BedSingle"]) {
    assert.match(generalSettings, new RegExp(`\\b${icon}\\b`));
  }
  assert.match(generalSettings, /<ModuleIconTile compact module=\{module\}>\{icon\}<\/ModuleIconTile>/);
  assert.match(generalSettings, /id === "installer"[\s\S]*<InstallHelperModuleIcon aria-hidden="true" \/>/);
  assert.match(generalSettings, /<ItIcon name="ops" size=\{17\} sw=\{1\.7\} \/>/);
  for (const setting of [
    "showWorkspaceOnRail",
    "showDashboardOnRail",
    "showInstallerOnRail",
    "showScreenshotsOnRail",
    "showItOps",
    "showDontSleepOnRail",
  ]) {
    assert.match(generalSettings, new RegExp(`"${setting}"`));
  }

  assert.doesNotMatch(workspaceSettings, /draft\.showWorkspaceOnRail/);
  assert.doesNotMatch(installerSettings, /draft\.showInstallerOnRail/);
  assert.doesNotMatch(settingsPage, /ItOpsSettings/);
});

test("General settings hides unsupported Install Helper Activity Rail control", () => {
  assert.match(generalSettings, /supportsInstallerHelper/);
  assert.match(generalSettings, /activityRailModuleOrder\(\s*draft\.activityRailOrder,\s*\)\.filter\([\s\S]*id !== "installer" \|\| installerSupported/);
});

test("Activity Rail visibility defaults and rendering match the unified controls", () => {
  assert.match(defaults, /showWorkspaceOnRail:\s*true/);
  assert.match(defaults, /showDashboardOnRail:\s*true/);
  assert.match(defaults, /showInstallerOnRail:\s*true/);
  assert.match(defaults, /showScreenshotsOnRail:\s*true/);
  assert.match(defaults, /showItOps:\s*true/);
  assert.match(defaults, /showDontSleepOnRail:\s*true/);
  assert.match(defaults, /activityRailOrder:\s*\[\.\.\.DEFAULT_ACTIVITY_RAIL_ORDER\]/);

  assert.match(activityRail, /generalSettings\.showWorkspaceOnRail\s*\?/);
  assert.match(activityRail, /generalSettings\.showDashboardOnRail\s*\?/);
  assert.match(activityRail, /generalSettings\.showInstallerOnRail/);
  assert.match(activityRail, /generalSettings\.showScreenshotsOnRail\s*\?/);
  assert.match(activityRail, /generalSettings\.showItOps/);
  assert.match(activityRail, /generalSettings\.showDontSleepOnRail\s*\?/);
  assert.match(activityRail, /activityRailModuleOrder/);
  assert.match(activityRail, /activityRailItemStyle/);
  assert.match(activityRail, /activityRailModuleOrder/);
  assert.match(activityRail, /className="rail-connected-connections-spacer"/);
  assert.match(activityRailCss, /\.rail-connected-connections-spacer\s*\{[^}]*order:\s*-1/s);
  assert.match(activityRailCss, /\.rail-button-settings\s*\{[^}]*margin-top:\s*auto/s);
  assert.match(activityRailCss, /\.rail-button-dont-sleep\s*~\s*\.rail-button-settings\s*\{[^}]*margin-top:\s*0/s);
});

test("General settings prevents hiding the final enabled Module", () => {
  assert.match(generalSettings, /canHideActivityRailModule/);
  assert.match(generalSettings, /disabled=\{isLastVisibleModule\}/);
});

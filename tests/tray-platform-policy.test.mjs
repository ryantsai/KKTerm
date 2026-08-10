import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("minimize-to-tray setting is Windows-only in Settings", async () => {
  const generalSettings = await readFile(
    new URL("../src/modules/settings/GeneralSettings.tsx", import.meta.url),
    "utf8",
  );

  assert.match(generalSettings, /supportsMinimizeToTray/);
  assert.match(
    generalSettings,
    /const\s+minimizeToTraySupported\s*=\s*supportsMinimizeToTray\(\)/,
  );
  assert.match(
    generalSettings,
    /const\s+showWindowSettings\s*=\s*windowsPlatform\s*\|\|\s*minimizeToTraySupported/,
  );
  assert.match(
    generalSettings,
    /showWindowSettings\s*\?\s*\([\s\S]*?<legend>\{t\("settings\.workspaceAccess"\)\}<\/legend>[\s\S]*?\)\s*:\s*null/,
  );
  assert.match(
    generalSettings,
    /minimizeToTraySupported\s*\?\s*\([\s\S]*?draft\.minimizeToTray[\s\S]*?\)\s*:\s*null/,
  );
});

test("macOS tray icon uses a template image", async () => {
  const appTray = await readFile(
    new URL("../src-tauri/src/app_tray.rs", import.meta.url),
    "utf8",
  );

  assert.match(appTray, /#\[cfg\(target_os = "macos"\)\]/);
  assert.match(appTray, /tray_template_icon/);
  assert.match(appTray, /\.icon_as_template\(true\)/);
  assert.match(appTray, /tray_icon\(app\)/);
  assert.match(appTray, /const SIZE: usize = 18/);
  assert.match(appTray, /"011001111000000110"/);
});

test("tray screenshot commands display their current enabled shortcuts", async () => {
  const appTray = await readFile(
    new URL("../src-tauri/src/app_tray.rs", import.meta.url),
    "utf8",
  );
  const commands = await readFile(
    new URL("../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );

  assert.match(appTray, /capture_shortcuts/);
  assert.match(appTray, /region_shortcut_enabled/);
  assert.match(appTray, /window_shortcut_enabled/);
  assert.match(appTray, /fullscreen_shortcut_enabled/);
  assert.match(appTray, /capture_items\.into_iter\(\)\.zip\(capture_shortcuts\)/);
  assert.match(commands, /app_tray::rebuild_menu\(&app, &tray_state\)/);
});

test("tray screenshot group has a localized heading and follows rail visibility", async () => {
  const appTray = await readFile(
    new URL("../src-tauri/src/app_tray.rs", import.meta.url),
    "utf8",
  );
  const sidebar = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );

  assert.match(appTray, /capture_section_label/);
  assert.match(appTray, /"kkterm-tray-capture-heading"/);
  assert.match(appTray, /&snapshot\.capture_section_label,\s*false,/);
  assert.match(sidebar, /captureSection: generalSettings\.showScreenshotsOnRail/);
  assert.match(sidebar, /captureRegion: generalSettings\.showScreenshotsOnRail/);
});

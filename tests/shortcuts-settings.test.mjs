import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPageSource = await readFile(
  new URL("../src/modules/settings/SettingsPage.tsx", import.meta.url),
  "utf8",
);
const localeEn = JSON.parse(
  await readFile(new URL("../src/i18n/locales/en.json", import.meta.url), "utf8"),
);
const keymapSource = await readFile(
  new URL("../src/modules/workspace/keymap.ts", import.meta.url),
  "utf8",
);
const shortcutsSettingsSource = await readFile(
  new URL("../src/modules/settings/ShortcutsSettings.tsx", import.meta.url),
  "utf8",
);
const workspaceCanvasSource = await readFile(
  new URL("../src/modules/workspace/WorkspaceCanvas.tsx", import.meta.url),
  "utf8",
);

test("Shortcuts settings section is wired and listed above Proxy", () => {
  assert.equal(localeEn.settings.sectionShortcuts, "Shortcuts");
  assert.match(settingsPageSource, /"shortcuts-settings"/);
  assert.match(settingsPageSource, /<ShortcutsSettings \/>/);
  // Nav order: Shortcuts sits above Proxy in the sidebar.
  assert.match(
    settingsPageSource,
    /id: "shortcuts-settings"[\s\S]*id: "proxy-settings"/,
  );
  // Section id order list keeps the same relative placement.
  assert.match(
    settingsPageSource,
    /"shortcuts-settings",\s*"proxy-settings"/,
  );
});

test("keymap ships predefined defaults for common actions and leaves splits unbound", () => {
  // Tab management and core terminal actions ship with defaults.
  for (const bound of [
    /id: "newTab"[\s\S]*?defaultBinding: "Ctrl\+Shift\+T"/,
    /id: "closeTab"[\s\S]*?defaultBinding: "Ctrl\+Shift\+W"/,
    /id: "copy"[\s\S]*?defaultBinding: "Ctrl\+Shift\+C"/,
  ]) {
    assert.match(keymapSource, bound);
  }
  // Split-pane actions ship unbound for user customization.
  for (const unbound of [
    "reconnectActiveSession",
    "splitRight",
    "splitLeft",
    "splitDown",
    "splitUp",
  ]) {
    assert.match(
      keymapSource,
      new RegExp(`id: "${unbound}"[\\s\\S]*?defaultBinding: null`),
    );
  }
});

test("Shortcuts settings can reset every override to the catalog defaults", () => {
  assert.equal(localeEn.settings.shortcutResetAll, "Reset all to defaults");
  assert.match(shortcutsSettingsSource, /actions=\{/);
  assert.match(shortcutsSettingsSource, /disabled=\{Object\.keys\(draft\)\.length === 0\}/);
  assert.match(shortcutsSettingsSource, /setDraft\(\{\}\)/);
});

test("Shortcuts settings renders the shared screenshot shortcut rows", () => {
  assert.match(shortcutsSettingsSource, /<ScreenshotShortcutRows \/>/);
  assert.match(shortcutsSettingsSource, /settings\.sectionScreenshots/);
  assert.match(shortcutsSettingsSource, /saveScreenshotSettings/);
});

test("workspace shortcuts stay inactive behind both legacy and shared dialogs", () => {
  assert.match(
    workspaceCanvasSource,
    /document\.querySelector\("\.settings-backdrop, \.dialog-backdrop, \.kk-dlg-backdrop"\)/,
  );
});

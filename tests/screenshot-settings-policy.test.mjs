import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("screenshot settings share shortcut rows and clear bindings without toggles", async () => {
  const [screenshots, shortcuts, rows] = await Promise.all([
    read("src/modules/settings/ScreenshotsSettings.tsx"),
    read("src/modules/settings/ShortcutsSettings.tsx"),
    read("src/modules/settings/ScreenshotShortcutRows.tsx"),
  ]);

  assert.match(screenshots, /<ScreenshotShortcutRows \/>/);
  assert.match(shortcuts, /<ScreenshotShortcutRows \/>/);
  assert.match(rows, /settings\.shortcutClear/);
  assert.match(rows, /<X size=\{13\} \/>/);
  assert.doesNotMatch(rows, /ToggleSwitch/);
  assert.doesNotMatch(rows, /<input/);
  assert.match(rows, /shortcut-binding-button/);
  assert.match(rows, /bindingFromKeyboardEvent/);
  assert.match(rows, /displayShortcutBinding\(value\)/);
  assert.match(shortcuts, /displayShortcutBinding\(binding\)/);
  assert.match(rows, /settings\.shortcutPressKeys/);
  assert.match(rows, /\[enabledKey\]: value\.trim\(\)\.length > 0/);
});

test("screenshot settings expose capture delivery and universal quality", async () => {
  const [settings, draft, backend] = await Promise.all([
    read("src/modules/settings/ScreenshotsSettings.tsx"),
    read("src/modules/settings/screenshotSettingsDraft.ts"),
    read("src-tauri/src/storage.rs"),
  ]);

  assert.match(settings, /settings\.screenshotsCaptureMode/);
  assert.match(settings, /value=\"folder\"/);
  assert.match(settings, /value=\"clipboard\"/);
  assert.match(settings, /value=\"both\"/);
  assert.match(settings, /type=\"range\"[\s\S]*draft\?\.quality/);
  assert.match(draft, /captureMode: "both"/);
  assert.match(backend, /fn default_screenshot_capture_mode\(\)[\s\S]*"both"\.to_string\(\)/);
});

test("screenshot border and cursor options are wired from settings to capture", async () => {
  const [settings, draft, backend, capture] = await Promise.all([
    read("src/modules/settings/ScreenshotsSettings.tsx"),
    read("src/modules/settings/screenshotSettingsDraft.ts"),
    read("src-tauri/src/storage.rs"),
    read("src-tauri/src/screenshot.rs"),
  ]);

  assert.match(settings, /settings\.screenshotsBorderEnabled/);
  assert.match(settings, /settings\.screenshotsBorderWidth/);
  assert.match(settings, /settings\.screenshotsBorderStyle/);
  assert.match(settings, /type=\"color\"/);
  assert.match(settings, /settings\.screenshotsIncludeCursor/);
  assert.match(settings, /isWindowsPlatform\(\) \? \(\s*<div className=\"settings-toggle-list\">/);
  assert.match(draft, /borderEnabled: true/);
  assert.match(draft, /borderWidth: 1/);
  assert.match(draft, /borderStyle: "solid"/);
  assert.match(draft, /borderColor: "#000000"/);
  assert.match(draft, /includeCursor: false/);
  assert.match(backend, /fn default_screenshot_border_enabled\(\)[\s\S]*?true/);
  assert.match(backend, /border style must be solid, dashed, or dotted/);
  assert.match(backend, /border color must be a #RRGGBB hex color/);
  assert.match(capture, /if options\.border_enabled/);
  assert.match(capture, /if options\.include_cursor/);
  assert.match(capture, /fn draw_cursor_on_dib/);
});

test("capture delivery returns optional library data and clipboard state", async () => {
  const [backend, bridge] = await Promise.all([
    read("src-tauri/src/screenshot.rs"),
    read("src/modules/screenshots/captureBridge.ts"),
  ]);

  assert.match(backend, /pub struct ScreenshotCaptureResult/);
  assert.match(backend, /let copy_to_clipboard = options\.capture_mode != "folder"/);
  assert.match(backend, /let save_to_folder = options\.capture_mode != "clipboard"/);
  assert.match(backend, /dib_to_png_bytes_with_quality/);
  assert.match(bridge, /result\.storedScreenshot/);
  assert.match(bridge, /screenshots\.captureSavedAndCopied/);
  assert.match(bridge, /screenshots\.captureCopied/);
});

test("saved captures can request the built-in editor", async () => {
  const [settings, draft, backend, capture, bridge, page, app] = await Promise.all([
    read("src/modules/settings/ScreenshotsSettings.tsx"),
    read("src/modules/settings/screenshotSettingsDraft.ts"),
    read("src-tauri/src/storage.rs"),
    read("src-tauri/src/screenshot.rs"),
    read("src/modules/screenshots/captureBridge.ts"),
    read("src/modules/screenshots/ScreenshotsPage.tsx"),
    read("src/App.tsx"),
  ]);

  assert.match(settings, /settings\.screenshotsOpenInEditorAfterCapture/);
  assert.match(settings, /disabled=\{draft\?\.captureMode === "clipboard"\}/);
  assert.match(draft, /openInEditorAfterCapture: false/);
  assert.match(backend, /open_in_editor_after_capture: bool/);
  assert.match(capture, /stored_screenshot\.is_some\(\) && options\.open_in_editor_after_capture/);
  assert.match(bridge, /requestEditor\(result\.storedScreenshot\.id\)/);
  assert.match(page, /setViewerId\(editorRequestId\)/);
  assert.match(app, /navigateToPage\("screenshots"\)/);
  assert.match(app, /mainWindow\.show\(\)/);
});

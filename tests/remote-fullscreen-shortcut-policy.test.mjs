import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [workspace, fullscreenApp, shortcutBackend, screenshotShortcuts, settings, lib] =
  await Promise.all([
    read("src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx"),
    read("src/modules/workspace/connections/remote-desktop/RemoteFullscreenApp.tsx"),
    read("src-tauri/src/remote_fullscreen_shortcut.rs"),
    read("src-tauri/src/screenshot_shortcuts.rs"),
    read("src/modules/settings/ShortcutsSettings.tsx"),
    read("src-tauri/src/lib.rs"),
  ]);

test("RDP and VNC expose full screen from the native hamburger menu", () => {
  assert.match(workspace, /<Menu size=\{13\} \/>/);
  assert.match(workspace, /remoteDesktop\.fullscreen\.enter/);
  assert.match(workspace, /showNativeContextMenu/);
  assert.doesNotMatch(workspace, /<Maximize2 size=\{13\} \/>/);
});

test("the configurable native shortcut enters and exits detached full screen", () => {
  assert.match(shortcutBackend, /DEFAULT_BINDING: &str = "Ctrl\+Alt\+Pause"/);
  assert.match(shortcutBackend, /DEFAULT_BINDING: &str = "Ctrl\+Cmd\+F"/);
  assert.match(shortcutBackend, /DEFAULT_BINDING: &str = "F11"/);
  assert.match(shortcutBackend, /remote_fullscreen::emit_toggle_shortcut/);
  assert.match(shortcutBackend, /pub\(crate\) fn sync_focus/);
  assert.match(shortcutBackend, /window\.is_focused/);
  assert.match(workspace, /REMOTE_FULLSCREEN_SHORTCUT_EVENT/);
  assert.match(fullscreenApp, /REMOTE_FULLSCREEN_SHORTCUT_EVENT/);
  assert.match(fullscreenApp, /closeCurrentWindow/);
  assert.match(settings, /renderRows\("remoteDesktop"\)/);
  assert.doesNotMatch(fullscreenApp, /keyboardGrab/);
});

test("screenshot re-registration preserves other global shortcuts", () => {
  assert.doesNotMatch(screenshotShortcuts, /unregister_all/);
  assert.match(screenshotShortcuts, /unregister_multiple/);
});

test("destroying the detached window always releases Windows RDP full screen", () => {
  assert.match(lib, /WindowEvent::Destroyed/);
  assert.match(lib, /session_id_from_label/);
  assert.match(lib, /rdp_sessions\.exit_fullscreen/);
});

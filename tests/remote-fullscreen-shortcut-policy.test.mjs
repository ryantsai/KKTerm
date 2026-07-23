import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [workspace, fullscreenApp, fullscreenCss, fullscreenBackend, shortcutBackend, screenshotShortcuts, settings, lib] =
  await Promise.all([
    read("src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx"),
    read("src/modules/workspace/connections/remote-desktop/RemoteFullscreenApp.tsx"),
    read("src/modules/workspace/connections/remote-desktop/remote-desktop.css"),
    read("src-tauri/src/rdp.rs"),
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
  assert.ok(
    workspace.lastIndexOf("<Bot size={13} />") <
      workspace.lastIndexOf("<Menu size={13} />"),
    "the hamburger should be the rightmost toolbar action beside the Pane close button",
  );
});

test("Windows RDP uses the ActiveX control's own full-screen host", () => {
  assert.match(workspace, /if \(canStartRdp\)/);
  assert.match(workspace, /invokeCommand\("enter_rdp_fullscreen"/);
  assert.match(
    fullscreenBackend,
    /set_property_bool\(&session\.dispatch, "FullScreen", true\)/,
  );
  assert.match(
    fullscreenBackend,
    /set_property_bool\(&advanced, "DisplayConnectionBar", true\)/,
  );
  assert.match(
    fullscreenBackend,
    /set_property_bool\(&advanced, "PinConnectionBar", false\)/,
  );
  assert.match(
    fullscreenBackend,
    /set_connection_bar_text\(dispatch, "KKTerm"\)/,
  );
  assert.doesNotMatch(fullscreenBackend, /position_rdp_over_fullscreen/);
  assert.doesNotMatch(fullscreenBackend, /HWND_TOP/);
});

test("detached full screen remains a WebView path only for VNC and canvas RDP", () => {
  assert.match(workspace, /void openRemoteFullscreen/);
  assert.doesNotMatch(fullscreenApp, /WindowsRdpFullscreenHost/);
  assert.doesNotMatch(fullscreenApp, /WindowsRdpNativeFullscreenMenu/);
  assert.doesNotMatch(fullscreenApp, /setAsWindowMenu/);
});

test("the revealed full-screen toolbar keeps its natural control height", () => {
  const zoneRule = fullscreenCss.slice(
    fullscreenCss.indexOf(".remote-fullscreen-bar-zone {"),
    fullscreenCss.indexOf(".remote-fullscreen-bar {"),
  );
  assert.match(zoneRule, /height:\s*12px/);
  assert.match(zoneRule, /align-items:\s*flex-start/);
});

test("the configurable native shortcut exits ActiveX full screen before WebView routing", () => {
  assert.match(shortcutBackend, /DEFAULT_BINDING: &str = "Ctrl\+Alt\+Pause"/);
  assert.match(shortcutBackend, /DEFAULT_BINDING: &str = "Ctrl\+Cmd\+F"/);
  assert.match(shortcutBackend, /DEFAULT_BINDING: &str = "F11"/);
  assert.match(shortcutBackend, /exit_active_fullscreen/);
  assert.match(shortcutBackend, /has_active_fullscreen/);
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

test("closing detached VNC or canvas windows does not call the Windows RDP manager", () => {
  assert.doesNotMatch(lib, /session_id_from_label\(window\.label\(\)\)/);
});

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
  const preConnectConfig = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn configure_rdp_control"),
    fullscreenBackend.indexOf("fn default_remote_resolution"),
  );
  const fullscreenConfig = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn configure_native_fullscreen"),
    fullscreenBackend.indexOf("fn get_advanced_settings"),
  );
  assert.match(workspace, /if \(canStartRdp\)/);
  assert.match(workspace, /invokeCommand\("enter_rdp_fullscreen"/);
  assert.match(
    fullscreenBackend,
    /set_property_bool\(&session\.dispatch, "FullScreen", true\)/,
  );
  assert.match(
    preConnectConfig,
    /set_property_bool\(&advanced, "DisplayConnectionBar", true\)/,
  );
  assert.match(
    preConnectConfig,
    /set_property_bool\(&advanced, "PinConnectionBar", false\)/,
  );
  assert.doesNotMatch(fullscreenConfig, /DisplayConnectionBar|PinConnectionBar/);
  assert.match(
    fullscreenBackend,
    /set_connection_bar_text\(dispatch, connection_name\)/,
  );
  assert.doesNotMatch(fullscreenBackend, /position_rdp_over_fullscreen/);
  assert.doesNotMatch(fullscreenBackend, /HWND_TOP/);
});

test("Windows RDP resizes the live remote display for full screen and restores it on exit", () => {
  const enterFullscreen = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn enter_native_fullscreen"),
    fullscreenBackend.indexOf("fn handle_rdp_fullscreen_request"),
  );
  assert.match(fullscreenBackend, /fullscreen_restore_display: Option<RdpDisplaySettings>/);
  assert.match(enterFullscreen, /current_monitor\(\)/);
  assert.match(enterFullscreen, /fullscreen_display_settings/);
  assert.match(enterFullscreen, /sync_remote_desktop_size\(session, display_settings, true\)/);
  assert.match(enterFullscreen, /apply_smart_sizing\(&session\.dispatch, true\)/);
  assert.ok(
    enterFullscreen.indexOf("sync_remote_desktop_size") <
      enterFullscreen.indexOf('"FullScreen", true'),
    "the remote desktop should resize before ActiveX opens its full-screen host",
  );
  assert.match(fullscreenBackend, /fn leave_native_fullscreen/);
  assert.match(fullscreenBackend, /fullscreen_restore_display\.take\(\)/);
  assert.doesNotMatch(enterFullscreen, /sync_rdp_display_size|stage_rdp/);
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

test("the native shortcut exits ActiveX full screen before WebView routing", () => {
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

test("Windows registers the Ctrl+Alt+Break virtual key for focused WebView sessions", () => {
  assert.match(shortcutBackend, /RegisterHotKey/);
  assert.match(shortcutBackend, /VK_CANCEL/);
  assert.match(shortcutBackend, /MOD_CONTROL\s*\|\s*MOD_ALT/);
  assert.match(shortcutBackend, /WM_HOTKEY/);
  assert.match(shortcutBackend, /windows_shortcut_proc[\s\S]*handle_shortcut/);
});

test("ActiveX delegates Ctrl+Alt+Break to KKTerm's prepared full-screen path", () => {
  const preConnectConfig = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn configure_rdp_control"),
    fullscreenBackend.indexOf("fn default_remote_resolution"),
  );
  const eventHandler = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn handle_rdp_fullscreen_request"),
    fullscreenBackend.indexOf("fn subscribe_rdp_events"),
  );
  assert.match(
    preConnectConfig,
    /set_property_bool\(&advanced, "ContainerHandledFullScreen", true\)/,
  );
  assert.match(fullscreenBackend, /IConnectionPointContainer/);
  assert.match(fullscreenBackend, /FindConnectionPoint/);
  assert.match(fullscreenBackend, /\.Advise\(/);
  assert.match(fullscreenBackend, /rdp_event_sink_query_interface[\s\S]*IMSTSCAX_EVENTS_IID/);
  assert.match(fullscreenBackend, /\.Unadvise\(/);
  assert.match(fullscreenBackend, /const DISPID_REQUEST_GO_FULLSCREEN:\s*i32\s*=\s*8/);
  assert.match(fullscreenBackend, /const DISPID_REQUEST_LEAVE_FULLSCREEN:\s*i32\s*=\s*9/);
  assert.match(eventHandler, /enter_native_fullscreen/);
  assert.match(eventHandler, /leave_native_fullscreen/);
});

test("Windows exposes the ActiveX full-screen shortcut as fixed Ctrl+Alt+Break", () => {
  assert.match(shortcutBackend, /cfg\(target_os = "windows"\)[\s\S]*fn binding\(settings: &GeneralSettings\)/);
  assert.match(shortcutBackend, /Some\(DEFAULT_BINDING\.to_string\(\)\)/);
  assert.match(settings, /workspaceShortcutIsFixed\(action\)/);
  assert.match(settings, /disabled=\{fixed\}/);
  assert.match(settings, /!\s*fixed && binding/);
});

test("Windows ActiveX connection bar uses the durable Connection name", () => {
  assert.match(workspace, /request:\s*\{\s*sessionId,\s*connectionName:\s*connection\.name\s*\}/);
  assert.match(fullscreenBackend, /struct EnterRdpFullscreenRequest[\s\S]*connection_name:\s*String/);
  assert.match(
    fullscreenBackend,
    /configure_native_fullscreen\(&session\.dispatch,\s*&session\.connection_name\)/,
  );
  assert.doesNotMatch(fullscreenBackend, /set_connection_bar_text\(dispatch,\s*"KKTerm"\)/);
});

test("screenshot re-registration preserves other global shortcuts", () => {
  assert.doesNotMatch(screenshotShortcuts, /unregister_all/);
  assert.match(screenshotShortcuts, /unregister_multiple/);
});

test("closing detached VNC or canvas windows does not call the Windows RDP manager", () => {
  assert.doesNotMatch(lib, /session_id_from_label\(window\.label\(\)\)/);
});

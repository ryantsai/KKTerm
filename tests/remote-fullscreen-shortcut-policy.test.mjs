import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [workspace, fullscreenApp, fullscreenCss, fullscreenBackend, remoteFullscreenBackend, shortcutBackend, screenshotShortcuts, settings, lib] =
  await Promise.all([
    read("src/modules/workspace/connections/remote-desktop/RemoteDesktopWorkspace.tsx"),
    read("src/modules/workspace/connections/remote-desktop/RemoteFullscreenApp.tsx"),
    read("src/modules/workspace/connections/remote-desktop/remote-desktop.css"),
    read("src-tauri/src/rdp.rs"),
    read("src-tauri/src/remote_fullscreen.rs"),
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

test("Windows RDP keeps fullscreen inside KKTerm's retained ActiveX host", () => {
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
  assert.match(preConnectConfig, /set_property_i32\(&advanced, "ContainerHandledFullScreen", 1\)/);
  assert.match(fullscreenBackend, /DISPID_REQUEST_GO_FULLSCREEN:\s*i32\s*=\s*8/);
  assert.match(fullscreenBackend, /DISPID_REQUEST_LEAVE_FULLSCREEN:\s*i32\s*=\s*9/);
});

test("Windows RDP expands and restores the retained host and remote display", () => {
  const enterFullscreen = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn enter_native_fullscreen"),
    fullscreenBackend.indexOf("fn handle_rdp_fullscreen_request"),
  );
  const enterTransition = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn enter_native_fullscreen"),
    fullscreenBackend.indexOf("fn rollback_failed_fullscreen_entry"),
  );
  const rollbackEntry = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn rollback_failed_fullscreen_entry"),
    fullscreenBackend.indexOf("fn handle_rdp_fullscreen_request"),
  );
  const leaveFullscreen = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn restore_windowed_host"),
    fullscreenBackend.indexOf("fn get_advanced_settings"),
  );
  assert.match(enterFullscreen, /set_property_bool\(&session\.dispatch, "FullScreen", true\)/);
  assert.match(enterFullscreen, /fullscreen_monitor_geometry/);
  assert.match(enterFullscreen, /fullscreen_restore/);
  assert.match(enterFullscreen, /sync_remote_desktop_size/);
  assert.match(enterFullscreen, /apply_smart_sizing\(&session\.dispatch, true\)/);
  assert.match(enterTransition, /visible: true/);
  assert.match(enterFullscreen, /Some\(insert_after\)/);
  assert.match(enterFullscreen, /monitor_rect\.left/);
  assert.match(enterFullscreen, /monitor_rect\.top/);
  assert.ok(
    enterFullscreen.indexOf("sync_remote_desktop_size") <
      enterFullscreen.indexOf('set_property_bool(&session.dispatch, "FullScreen", true)'),
    "the remote desktop must be resized before ActiveX enters full screen",
  );
  assert.match(leaveFullscreen, /Some\(HWND_NOTOPMOST\)/);
  assert.match(leaveFullscreen, /restore\.host_rect\.left/);
  assert.match(leaveFullscreen, /sync_remote_desktop_size\(session, restore\.display, true\)/);
  assert.match(leaveFullscreen, /session\.resolution_mode\.smart_sizing\(\)/);
  assert.match(
    leaveFullscreen,
    /restore_windowed_host\(session, restore\)\?;[\s\S]*session\.fullscreen_restore = None/,
  );
  assert.doesNotMatch(enterFullscreen, /sync_rdp_display_size|stage_rdp|update_rdp_bounds/);
  const transitionPositionIndex = enterTransition.indexOf("SetWindowPos(");
  const transitionCommitIndex = enterTransition.indexOf(
    "session.fullscreen_restore = Some(restore)",
  );
  assert.ok(
    transitionPositionIndex >= 0 &&
      transitionCommitIndex >= 0 &&
      transitionPositionIndex < transitionCommitIndex,
    "the recovery marker must be committed only after the native transition succeeds",
  );
  assert.match(enterFullscreen, /fn rollback_failed_fullscreen_entry/);
  assert.match(
    enterFullscreen,
    /rollback_failed_fullscreen_entry\([\s\S]{0,100}session,[\s\S]{0,100}restore,[\s\S]{0,100}error,[\s\S]{0,100}dispatch_is_current/,
  );
  assert.match(
    enterFullscreen,
    /let had_restore = session\.fullscreen_restore\.is_some\(\)[\s\S]*if had_restore[\s\S]*rollback_failed_fullscreen_entry/,
  );
  assert.match(
    rollbackEntry,
    /display_restore_completed = matches!\(restore_result\.as_ref\(\), Ok\(true\)\)/,
  );
  assert.match(
    rollbackEntry,
    /if fullscreen_result\.is_ok\(\) && display_restore_completed \{[\s\S]*session\.fullscreen_restore = None/,
  );
  const rollbackMarkerIndex = rollbackEntry.indexOf(
    "session.fullscreen_restore = Some(restore)",
  );
  const rollbackForegroundGuardIndex = rollbackEntry.indexOf(
    "if dispatch_is_current() && kkterm_process_owns_foreground()",
  );
  const rollbackSetterIndex = rollbackEntry.indexOf(
    'set_property_bool(&session.dispatch, "FullScreen", false)',
  );
  const rollbackBackgroundBranchIndex = rollbackEntry.indexOf(
    "} else {",
    rollbackForegroundGuardIndex,
  );
  const rollbackHostRestoreIndex = rollbackEntry.indexOf("restore_windowed_host");
  assert.ok(
    rollbackMarkerIndex >= 0 &&
      rollbackMarkerIndex < rollbackForegroundGuardIndex &&
      rollbackForegroundGuardIndex < rollbackSetterIndex &&
      rollbackSetterIndex < rollbackBackgroundBranchIndex &&
      rollbackBackgroundBranchIndex < rollbackHostRestoreIndex,
    "rollback must retain its recovery marker and guard FullScreen=false on dispatch and foreground ownership",
  );
  const foregroundRollback = rollbackEntry.slice(
    rollbackForegroundGuardIndex,
    rollbackBackgroundBranchIndex,
  );
  assert.match(foregroundRollback, /RdpFullscreenEventSuppression::new/);
  assert.match(
    foregroundRollback,
    /set_property_bool\(&session\.dispatch, "FullScreen", false\)/,
  );
  const backgroundRollback = rollbackEntry.slice(
    rollbackBackgroundBranchIndex,
    rollbackHostRestoreIndex,
  );
  assert.match(backgroundRollback, /"fullscreen\.rollback\.property\.skipped"/);
  assert.match(
    backgroundRollback,
    /"reason": if dispatch_is_current\(\) \{[\s\S]*"kktermNotForeground"/,
  );
  assert.match(backgroundRollback, /"shortcutDispatchInvalidated"/);
  assert.match(
    backgroundRollback,
    /"FullScreen rollback was deferred because its shortcut dispatch is no longer current or KKTerm is not foreground"/,
  );
  assert.doesNotMatch(backgroundRollback, /set_property_bool[^;]*"FullScreen"/);
  assert.match(
    enterFullscreen,
    /let app_is_active = kkterm_process_owns_foreground\(\)[\s\S]*let insert_after = if app_is_active[\s\S]*SetWindowPos\([\s\S]*Some\(insert_after\)/,
  );
  assert.match(
    enterFullscreen,
    /let insert_after = if app_is_active \{\s*HWND_TOPMOST\s*\} else \{\s*HWND_NOTOPMOST/,
  );
  assert.match(
    enterFullscreen,
    /if let Err\(error\) = fullscreen_result[\s\S]*rollback_failed_fullscreen_entry/,
  );
  assert.match(
    enterFullscreen,
    /if let Err\(error\) = position_result[\s\S]*rollback_failed_fullscreen_entry/,
  );
  assert.match(
    fullscreenBackend,
    /fn kkterm_process_owns_foreground[\s\S]*GetWindowThreadProcessId\(foreground[\s\S]*std::process::id\(\)/,
  );
  const entryGuard = "if !dispatch_is_current() || !kkterm_process_owns_foreground()";
  const inactiveGuardIndex = enterTransition.indexOf(entryGuard);
  const stateReadIndex = enterTransition.indexOf(
    "let already_fullscreen = native_fullscreen_applied(session)",
  );
  const postStateGuardIndex = enterTransition.indexOf(
    entryGuard,
    inactiveGuardIndex + 1,
  );
  const alreadyAppliedIndex = enterTransition.indexOf("if already_fullscreen");
  const configureIndex = enterTransition.indexOf("configure_native_fullscreen");
  const postConfigureGuardIndex = enterTransition.indexOf(
    entryGuard,
    postStateGuardIndex + 1,
  );
  const displayResizeIndex = enterTransition.indexOf("sync_remote_desktop_size");
  const fullScreenPropertyIndex = enterTransition.indexOf(
    'set_property_bool(&session.dispatch, "FullScreen", true)',
  );
  assert.ok(
    inactiveGuardIndex >= 0 &&
      stateReadIndex >= 0 &&
      postStateGuardIndex >= 0 &&
      alreadyAppliedIndex >= 0 &&
      configureIndex >= 0 &&
      postConfigureGuardIndex >= 0 &&
      displayResizeIndex >= 0 &&
      fullScreenPropertyIndex >= 0 &&
      inactiveGuardIndex < stateReadIndex &&
      stateReadIndex < postStateGuardIndex &&
      postStateGuardIndex < alreadyAppliedIndex &&
      alreadyAppliedIndex < configureIndex &&
      configureIndex < postConfigureGuardIndex &&
      postConfigureGuardIndex < displayResizeIndex &&
      displayResizeIndex < fullScreenPropertyIndex,
    "background entry must return before display or ActiveX full-screen mutation",
  );
  const inactiveGuard = enterTransition.slice(inactiveGuardIndex, stateReadIndex);
  assert.match(inactiveGuard, /"kktermNotForeground"/);
  assert.match(inactiveGuard, /"shortcutDispatchInvalidated"/);
  assert.match(inactiveGuard, /return Ok\(\(\)\)/);
  const lostForegroundDuringStateCheck = enterTransition.slice(
    postStateGuardIndex,
    alreadyAppliedIndex,
  );
  assert.match(
    lostForegroundDuringStateCheck,
    /"kktermLostForegroundDuringStateCheck"/,
  );
  assert.match(lostForegroundDuringStateCheck, /"shortcutInvalidatedDuringStateCheck"/);
  assert.match(lostForegroundDuringStateCheck, /return Ok\(\(\)\)/);
  assert.doesNotMatch(
    lostForegroundDuringStateCheck,
    /configure_native_fullscreen|sync_remote_desktop_size|set_property_bool[^;]*"FullScreen"/,
  );
  const lostForegroundDuringConfiguration = enterTransition.slice(
    postConfigureGuardIndex,
    displayResizeIndex,
  );
  assert.match(
    lostForegroundDuringConfiguration,
    /"kktermLostForegroundDuringConfiguration"/,
  );
  assert.match(
    lostForegroundDuringConfiguration,
    /"shortcutInvalidatedDuringConfiguration"/,
  );
  assert.match(lostForegroundDuringConfiguration, /return Ok\(\(\)\)/);
  const prePropertyGuardIndex = enterTransition.indexOf(
    entryGuard,
    postConfigureGuardIndex + 1,
  );
  assert.ok(
    prePropertyGuardIndex > displayResizeIndex &&
      prePropertyGuardIndex < fullScreenPropertyIndex,
    "foreground must be rechecked immediately before the ActiveX FullScreen setter",
  );
  const lostForegroundGuard = enterTransition.slice(
    prePropertyGuardIndex,
    fullScreenPropertyIndex,
  );
  assert.match(
    lostForegroundGuard,
    /sync_remote_desktop_size\(session, restore\.display, true\)/,
  );
  assert.match(
    lostForegroundGuard,
    /!display_restore_completed \|\| session\.resolution_mode\.smart_sizing\(\)/,
  );
  assert.match(lostForegroundGuard, /"kktermLostForeground"/);
  assert.match(lostForegroundGuard, /"shortcutInvalidatedBeforePropertyPut"/);
  assert.match(lostForegroundGuard, /return Ok\(\(\)\)/);
  assert.doesNotMatch(lostForegroundGuard, /set_property_bool[^;]*"FullScreen"/);
  assert.match(
    enterTransition,
    /fn enter_native_fullscreen\([\s\S]*enter_native_fullscreen_if\(session, &\|\| true\)/,
  );
  assert.match(
    enterTransition,
    /fn enter_native_fullscreen_if\([\s\S]*dispatch_is_current: &impl Fn\(\) -> bool/,
  );
  const leaveTransitionStart = fullscreenBackend.indexOf("fn leave_native_fullscreen_if");
  const leaveTransition = fullscreenBackend.slice(
    leaveTransitionStart,
    fullscreenBackend.indexOf("fn get_advanced_settings", leaveTransitionStart),
  );
  assert.match(
    leaveFullscreen,
    /fn leave_native_fullscreen\([\s\S]*leave_native_fullscreen_if\(session, &\|\| true\)/,
  );
  assert.match(
    leaveTransition,
    /dispatch_is_current: &impl Fn\(\) -> bool/,
  );
  const leaveInitialGuardIndex = leaveTransition.indexOf("if !dispatch_is_current()");
  const leaveStateReadIndex = leaveTransition.indexOf(
    'get_property_i32(&session.dispatch, "FullScreen")',
  );
  const leavePostReadGuardIndex = leaveTransition.indexOf(
    "if !dispatch_is_current() || !kkterm_process_owns_foreground()",
    leaveStateReadIndex,
  );
  const leaveSuppressionIndex = leaveTransition.indexOf(
    "RdpFullscreenEventSuppression::new",
  );
  const leavePrePutGuardIndex = leaveTransition.indexOf(
    "if !dispatch_is_current() || !kkterm_process_owns_foreground()",
    leaveSuppressionIndex,
  );
  const leavePropertyIndex = leaveTransition.indexOf(
    'set_property_bool(&session.dispatch, "FullScreen", false)',
  );
  assert.ok(
    leaveInitialGuardIndex >= 0 &&
      leaveInitialGuardIndex < leaveStateReadIndex &&
      leaveStateReadIndex < leavePostReadGuardIndex &&
      leavePostReadGuardIndex < leaveSuppressionIndex &&
      leaveSuppressionIndex < leavePrePutGuardIndex &&
      leavePrePutGuardIndex < leavePropertyIndex,
    "leave must revalidate the dispatch after its getter and immediately before FullScreen=false",
  );
  assert.match(leaveTransition, /"shortcutDispatchInvalidated"/);
  assert.match(leaveTransition, /"shortcutInvalidatedDuringStateCheck"/);
  assert.match(leaveTransition, /"shortcutInvalidatedBeforePropertyPut"/);
});

test("Windows RDP retains the latest Pane bounds and visibility during full screen", () => {
  const updateBounds = fullscreenBackend.slice(
    fullscreenBackend.indexOf("pub fn update_bounds"),
    fullscreenBackend.indexOf("pub fn set_visibility"),
  );
  const setVisibility = fullscreenBackend.slice(
    fullscreenBackend.indexOf("pub fn set_visibility"),
    fullscreenBackend.indexOf("pub fn enter_fullscreen"),
  );
  const restoreWindowed = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn restore_windowed_host"),
    fullscreenBackend.indexOf("fn leave_native_fullscreen"),
  );
  assert.match(fullscreenBackend, /struct RdpFullscreenRestore[\s\S]*visible: bool/);
  assert.match(updateBounds, /is_native_fullscreen[\s\S]*update_fullscreen_restore_bounds/);
  assert.match(setVisibility, /is_native_fullscreen[\s\S]*update_fullscreen_restore_bounds/);
  assert.match(setVisibility, /restore\.visible = request\.visible/);
  assert.match(
    updateBounds,
    /restore_windowed_host\(session, restore\)\?[\s\S]*session\.fullscreen_restore = None[\s\S]*return Ok\(\(\)\)/,
  );
  assert.match(
    setVisibility,
    /session\.fullscreen_restore\.is_some\(\)[\s\S]*restore\.visible = request\.visible[\s\S]*restore_windowed_host\(session, restore\)\?[\s\S]*session\.fullscreen_restore = None/,
  );
  assert.match(restoreWindowed, /if restore\.visible/);
  assert.match(restoreWindowed, /staged_rect\(width, height\)/);
  assert.match(restoreWindowed, /clear_rdp_overlay_focus_target/);
  assert.match(
    restoreWindowed,
    /!display_sync_completed \|\| session\.resolution_mode\.smart_sizing\(\)/,
  );
  assert.match(
    fullscreenBackend,
    /fn update_fullscreen_restore_bounds[\s\S]*restore\.host_rect = RECT[\s\S]*restore\.display = display/,
  );
  const leaveFullscreen = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn leave_native_fullscreen"),
    fullscreenBackend.indexOf("fn get_advanced_settings"),
  );
  assert.match(leaveFullscreen, /set_property_bool\(&session\.dispatch, "FullScreen", false\)/);
  const updatePendingIndex = updateBounds.indexOf("if session.fullscreen_restore.is_some()");
  const updatePendingReturnIndex = updateBounds.indexOf("return Ok(())", updatePendingIndex);
  const updateNormalShowIndex = updateBounds.indexOf("show_and_resize_rdp");
  assert.ok(
    updatePendingIndex >= 0 &&
      updatePendingReturnIndex >= 0 &&
      updateNormalShowIndex >= 0 &&
      updatePendingReturnIndex < updateNormalShowIndex,
    "pending fullscreen bounds must return before normal Pane show/resize",
  );
  const visibilityPendingIndex = setVisibility.indexOf("if session.fullscreen_restore.is_some()");
  const visibilityPendingReturnIndex = setVisibility.indexOf(
    "return Ok(())",
    visibilityPendingIndex,
  );
  const visibilityNormalIndex = setVisibility.indexOf("if request.visible");
  assert.ok(
    visibilityPendingIndex >= 0 &&
      visibilityPendingReturnIndex >= 0 &&
      visibilityNormalIndex >= 0 &&
      visibilityPendingReturnIndex < visibilityNormalIndex,
    "a live fullscreen visibility request must return before normal show/stage",
  );
});

test("Windows refreshes shortcut focus only after an RDP visibility update releases Session state", () => {
  const setVisibility = fullscreenBackend.slice(
    fullscreenBackend.indexOf("pub fn set_visibility"),
    fullscreenBackend.indexOf("pub fn enter_fullscreen"),
  );
  const scheduleFocusSync = shortcutBackend.slice(
    shortcutBackend.indexOf("pub(crate) fn schedule_focus_sync"),
    shortcutBackend.indexOf("fn try_handle_shortcut"),
  );
  const visibilityResultIndex = setVisibility.indexOf(
    'let result = run_on_main_thread("set_rdp_visibility"',
  );
  const focusRefreshIndex = setVisibility.indexOf(
    "schedule_focus_sync(&focus_app)",
  );
  const resultReturnIndex = setVisibility.lastIndexOf("result");
  assert.ok(
    visibilityResultIndex >= 0 &&
      visibilityResultIndex < focusRefreshIndex &&
      focusRefreshIndex < resultReturnIndex,
    "the visibility callback must finish and release its Session guard before focus refresh is queued",
  );
  assert.match(
    setVisibility,
    /let focus_app = app\.clone\(\);[\s\S]*let result = run_on_main_thread\("set_rdp_visibility", app, move \|app\| \{[\s\S]*\}\);[\s\S]*if result\.is_ok\(\) \{[\s\S]*schedule_focus_sync\(&focus_app\);[\s\S]*\}[\s\S]*result/,
  );
  assert.match(
    shortcutBackend,
    /#\[cfg\(target_os = "windows"\)\]\s*pub\(crate\) fn schedule_focus_sync/,
  );
  assert.match(scheduleFocusSync, /run_on_main_thread\(move \|\|/);
  assert.match(scheduleFocusSync, /sync_focus\(&main_thread_app\)/);
  assert.doesNotMatch(scheduleFocusSync, /sleep|STARTUP_FOCUS_RECHECK_DELAY/);
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
  assert.match(shortcutBackend, /try_toggle_foreground_fullscreen/);
  assert.match(shortcutBackend, /has_active_fullscreen/);
  assert.match(shortcutBackend, /try_shortcut_focus_state/);
  assert.match(shortcutBackend, /remote_fullscreen::emit_toggle_shortcut/);
  assert.match(
    fullscreenBackend,
    /fn try_toggle_foreground_fullscreen[\s\S]*GetFocus\(\)[\s\S]*IsChild\(session\.hwnd, focused\)/,
  );
  const rdpShortcutToggle = fullscreenBackend.slice(
    fullscreenBackend.indexOf("pub fn try_toggle_foreground_fullscreen"),
    fullscreenBackend.indexOf("pub fn try_shortcut_focus_state"),
  );
  assert.match(
    rdpShortcutToggle,
    /dispatch_is_current: impl Fn\(\) -> bool/,
  );
  assert.match(
    rdpShortcutToggle,
    /self\.sessions\.try_lock\(\)[\s\S]*TryLockError::WouldBlock[\s\S]*RdpFullscreenShortcutDispatch::Busy/,
  );
  assert.match(
    rdpShortcutToggle,
    /rdp_host_accepts_shortcut_input\(session\)[\s\S]*IsChild\(session\.hwnd, focused\)/,
  );
  assert.match(
    fullscreenBackend,
    /fn rdp_host_rect_is_staged[\s\S]*rect\.left == HIDDEN_RDP_POSITION && rect\.top == HIDDEN_RDP_POSITION[\s\S]*fn rdp_host_accepts_shortcut_input[\s\S]*GetWindowRect\(session\.hwnd, &mut rect\)[\s\S]*!rdp_host_rect_is_staged\(&rect\)/,
  );
  const nativeStateReadIndex = rdpShortcutToggle.indexOf(
    "let native_fullscreen = is_native_fullscreen(session)",
  );
  const postReadGuardIndex = rdpShortcutToggle.indexOf(
    "if !dispatch_is_current() || !kkterm_process_owns_foreground()",
    nativeStateReadIndex,
  );
  const guardedLeaveIndex = rdpShortcutToggle.indexOf(
    "leave_native_fullscreen_if(session, &dispatch_is_current)",
  );
  const guardedEnterIndex = rdpShortcutToggle.indexOf(
    "enter_native_fullscreen_if(session, &dispatch_is_current)",
  );
  assert.ok(
    nativeStateReadIndex >= 0 &&
      nativeStateReadIndex < postReadGuardIndex &&
      postReadGuardIndex < guardedLeaveIndex &&
      guardedLeaveIndex < guardedEnterIndex,
    "RDP shortcut dispatch must revalidate after its COM getter and carry the guard into enter/leave",
  );
  assert.doesNotMatch(
    rdpShortcutToggle,
    /(?:enter|leave)_native_fullscreen\(session\)/,
  );
  assert.match(shortcutBackend, /pub\(crate\) fn sync_focus/);
  assert.match(shortcutBackend, /window\.is_focused/);
  assert.match(workspace, /REMOTE_FULLSCREEN_SHORTCUT_EVENT/);
  assert.match(fullscreenApp, /REMOTE_FULLSCREEN_SHORTCUT_EVENT/);
  assert.match(fullscreenApp, /closeCurrentWindow/);
  assert.match(settings, /renderRows\("remoteDesktop"\)/);
  assert.doesNotMatch(fullscreenApp, /keyboardGrab/);
});

test("Windows captures physical Ctrl+Alt+Break on a dedicated hook thread", () => {
  const hookBackend = shortcutBackend.slice(
    shortcutBackend.indexOf("mod windows_break_hook"),
    shortcutBackend.indexOf("const ACTION_ID"),
  );
  assert.match(hookBackend, /WH_KEYBOARD_LL/);
  assert.match(hookBackend, /kkterm-remote-fullscreen-hook/);
  assert.match(hookBackend, /mpsc::sync_channel/);
  assert.match(hookBackend, /GetMessageW/);
  assert.match(hookBackend, /result > 0/);
  assert.match(hookBackend, /PostMessageW/);
  assert.match(
    hookBackend,
    /VK_CANCEL_CODE \|\| keyboard\.vk_code == VK_PAUSE_CODE[\s\S]*post_diagnostic\(HookDiagnostic/,
  );
  assert.match(
    hookBackend,
    /enum HookPostOutcome \{[\s\S]*NotAttempted,[\s\S]*Posted,[\s\S]*PostFailed,[\s\S]*StaleActivation/,
  );
  assert.match(
    hookBackend,
    /struct HookDiagnostic \{[\s\S]*post_outcome: u8,[\s\S]*captured_generation: u32,[\s\S]*token: usize/,
  );
  assert.match(
    hookBackend,
    /fn pack_diagnostic\(diagnostic: HookDiagnostic\) -> usize[\s\S]*diagnostic\.captured_generation/,
  );
  assert.match(
    hookBackend,
    /fn unpack_diagnostic\(token: usize, packed: usize\) -> HookDiagnostic[\s\S]*captured_generation:[\s\S]*token/,
  );
  assert.match(
    hookBackend,
    /fn hook_diagnostic_pack_round_trips_dispatch_evidence\(\)[\s\S]*unpack_diagnostic\(diagnostic\.token, pack_diagnostic\(diagnostic\)\)/,
  );
  assert.match(hookBackend, /VK_CANCEL_CODE:\s*u32\s*=\s*0x03/);
  assert.match(hookBackend, /VK_PAUSE_CODE:\s*u32\s*=\s*0x13/);
  assert.match(hookBackend, /MODE_DISABLED/);
  assert.match(hookBackend, /MODE_WEBVIEW_CONSUME/);
  assert.match(hookBackend, /MODE_ACTIVEX_PASSTHROUGH/);
  const hookProcStart = hookBackend.indexOf('unsafe extern "system" fn hook_proc');
  const hookProcEnd = hookBackend.indexOf("#[cfg(test)]", hookProcStart);
  assert.ok(
    hookProcStart >= 0 && hookProcStart < hookProcEnd,
    "the hook policy must be scoped to the low-level callback",
  );
  const hookProc = hookBackend.slice(hookProcStart, hookProcEnd);
  assert.doesNotMatch(hookProc, /rdp_debug|std::fs|File::|OpenOptions/);
  const generationCaptureIndex = hookProc.indexOf(
    "let generation = super::WINDOWS_SHORTCUT_GENERATION.load(Ordering::Acquire)",
  );
  const firstActiveReadIndex = hookProc.indexOf("if !APP_ACTIVE.load(Ordering::Acquire)");
  const postToggleIndex = hookProc.indexOf("HookAction::PostToggle => {");
  assert.ok(
    generationCaptureIndex >= 0 &&
      generationCaptureIndex < firstActiveReadIndex &&
      firstActiveReadIndex < postToggleIndex,
    "the hook must capture the activation epoch before its first active-state read",
  );
  const passThroughIndex = hookProc.indexOf(
    "HookAction::PassThrough => {",
    postToggleIndex,
  );
  assert.ok(
    postToggleIndex >= 0 && postToggleIndex < passThroughIndex,
    "the low-level hook must isolate its posted-toggle path",
  );
  const postToggleBranch = hookProc.slice(postToggleIndex, passThroughIndex);
  const activeRecheckIndex = postToggleBranch.indexOf(
    "if !APP_ACTIVE.load(Ordering::Acquire)",
  );
  const unchangedEpochIndex = postToggleBranch.indexOf(
    "WINDOWS_SHORTCUT_GENERATION.load(Ordering::Acquire) != generation",
  );
  const tokenReadIndex = postToggleBranch.indexOf(
    "WINDOWS_SHORTCUT_SEQUENCE.fetch_add(1, Ordering::AcqRel)",
  );
  const postMessageIndex = postToggleBranch.indexOf("PostMessageW(");
  assert.ok(
    activeRecheckIndex >= 0 &&
      activeRecheckIndex < unchangedEpochIndex &&
      unchangedEpochIndex < tokenReadIndex &&
      tokenReadIndex < postMessageIndex,
    "the hook must recheck both active state and the captured epoch before posting",
  );
  assert.match(
    postToggleBranch,
    /if !APP_ACTIVE\.load\(Ordering::Acquire\)\s*\|\| super::WINDOWS_SHORTCUT_GENERATION\.load\(Ordering::Acquire\) != generation[\s\S]*return unsafe \{ CallNextHookEx[\s\S]*let token = super::WINDOWS_SHORTCUT_SEQUENCE\.fetch_add/,
  );
  assert.match(
    postToggleBranch,
    /PostMessageW\([\s\S]*WINDOWS_FULLSCREEN_HOOK_MESSAGE,\s*generation,\s*token as isize/,
  );
  const togglePostIndex = postToggleBranch.indexOf(
    "super::WINDOWS_FULLSCREEN_HOOK_MESSAGE",
  );
  const diagnosticPostIndex = postToggleBranch.indexOf(
    "post_diagnostic(HookDiagnostic",
    togglePostIndex,
  );
  assert.ok(
    togglePostIndex >= 0 && togglePostIndex < diagnosticPostIndex,
    "posted-toggle diagnostics must describe the outcome of the attempted dispatch post",
  );
  assert.match(
    postToggleBranch,
    /HookPostOutcome::StaleActivation[\s\S]*HookPostOutcome::Posted[\s\S]*HookPostOutcome::PostFailed/,
  );
  assert.match(hookBackend, /if posted \{[\s\S]*return 1/);
  assert.match(hookBackend, /BREAK_DOWN\.store\(false[\s\S]*CallNextHookEx/);
  assert.doesNotMatch(shortcutBackend, /RegisterHotKey|WM_HOTKEY|GetAsyncKeyState/);
  assert.match(shortcutBackend, /windows_shortcut_proc[\s\S]*handle_shortcut/);
  assert.match(
    shortcutBackend,
    /static WINDOWS_SHORTCUT_GENERATION: AtomicUsize = AtomicUsize::new\(1\)/,
  );
  assert.match(
    shortcutBackend,
    /static WINDOWS_SHORTCUT_SEQUENCE: AtomicUsize = AtomicUsize::new\(1\)/,
  );
  assert.match(
    shortcutBackend,
    /static WINDOWS_PENDING_SHORTCUT_GENERATION: AtomicUsize = AtomicUsize::new\(0\)/,
  );
  assert.match(
    shortcutBackend,
    /static WINDOWS_PENDING_SHORTCUT_TOKEN: AtomicUsize = AtomicUsize::new\(0\)/,
  );
  assert.match(
    shortcutBackend,
    /static WINDOWS_LATEST_SHORTCUT_TOKEN: AtomicUsize = AtomicUsize::new\(0\)/,
  );
  const setRetryTimer = shortcutBackend.slice(
    shortcutBackend.indexOf("fn set_retry_timer"),
    shortcutBackend.indexOf("fn clear_retry_timer"),
  );
  assert.match(setRetryTimer, /fn set_retry_timer\(hwnd: HWND, timer_id: usize\) -> bool/);
  assert.match(setRetryTimer, /installed != 0/);
  const currentDispatch = shortcutBackend.slice(
    shortcutBackend.indexOf("fn shortcut_dispatch_is_current"),
    shortcutBackend.indexOf("fn begin_shortcut_retry"),
  );
  const beginRetry = shortcutBackend.slice(
    shortcutBackend.indexOf("fn begin_shortcut_retry"),
    shortcutBackend.indexOf("fn finish_shortcut_retry"),
  );
  const finishRetry = shortcutBackend.slice(
    shortcutBackend.indexOf("fn finish_shortcut_retry"),
    shortcutBackend.indexOf("fn windows_shortcut_proc"),
  );
  assert.match(
    currentDispatch,
    /generation != 0[\s\S]*WINDOWS_APP_ACTIVE\.load\(Ordering::Acquire\)[\s\S]*WINDOWS_SHORTCUT_GENERATION\.load\(Ordering::Acquire\) == generation/,
  );
  assert.match(
    beginRetry,
    /WINDOWS_PENDING_SHORTCUT_GENERATION\.store\(generation, Ordering::Release\)[\s\S]*WINDOWS_PENDING_SHORTCUT_TOKEN\.store\(token, Ordering::Release\)/,
  );
  assert.match(
    finishRetry,
    /WINDOWS_PENDING_SHORTCUT_TOKEN[\s\S]*compare_exchange\(token, 0,[\s\S]*WINDOWS_PENDING_SHORTCUT_GENERATION\.store\(0, Ordering::Release\)[\s\S]*clear_retry_timer\(hwnd, WINDOWS_SHORTCUT_RETRY_TIMER_ID\)/,
  );
  const windowCallback = shortcutBackend.slice(
    shortcutBackend.indexOf("fn windows_shortcut_proc"),
    shortcutBackend.indexOf("fn main_window_hwnd"),
  );
  const hookMessageIndex = windowCallback.indexOf(
    "if msg == WINDOWS_FULLSCREEN_HOOK_MESSAGE",
  );
  const hookDiagnosticIndex = windowCallback.indexOf(
    "if msg == WINDOWS_FULLSCREEN_HOOK_DIAGNOSTIC_MESSAGE",
  );
  const shortcutTimerIndex = windowCallback.indexOf(
    "if msg == WM_TIMER && wparam.0 == WINDOWS_SHORTCUT_RETRY_TIMER_ID",
  );
  const activationTimerIndex = windowCallback.indexOf(
    "if msg == WM_TIMER && wparam.0 == WINDOWS_ACTIVATION_RETRY_TIMER_ID",
  );
  const focusTimerIndex = windowCallback.indexOf(
    "if msg == WM_TIMER && wparam.0 == WINDOWS_FOCUS_RETRY_TIMER_ID",
  );
  assert.ok(
    hookDiagnosticIndex >= 0 &&
      hookDiagnosticIndex < hookMessageIndex &&
      hookMessageIndex < shortcutTimerIndex &&
      shortcutTimerIndex < activationTimerIndex &&
      activationTimerIndex < focusTimerIndex,
    "the hook message and all three retry timers must have separate callback branches",
  );
  const hookMessageBranch = windowCallback.slice(
    hookMessageIndex,
    shortcutTimerIndex,
  );
  const hookDiagnosticBranch = windowCallback.slice(
    hookDiagnosticIndex,
    hookMessageIndex,
  );
  assert.match(hookDiagnosticBranch, /fullscreen\.shortcut\.hook_input/);
  assert.match(
    hookDiagnosticBranch,
    /"mode"[\s\S]*"action"[\s\S]*"modifierMask"[\s\S]*"postOutcome"[\s\S]*"capturedGeneration"[\s\S]*"dispatchSequence"/,
  );
  for (const outcome of [
    "notAttempted",
    "posted",
    "postFailed",
    "staleActivation",
  ]) {
    assert.match(hookDiagnosticBranch, new RegExp(`"${outcome}"`));
  }
  const shortcutTimerBranch = windowCallback.slice(
    shortcutTimerIndex,
    activationTimerIndex,
  );
  const staleMessageGuardIndex = hookMessageBranch.indexOf(
    "if token == 0 || !shortcut_dispatch_is_current(generation)",
  );
  const latestTokenStoreIndex = hookMessageBranch.indexOf(
    "WINDOWS_LATEST_SHORTCUT_TOKEN.store(token, Ordering::Release)",
  );
  const pendingTokenClearIndex = hookMessageBranch.indexOf(
    "WINDOWS_PENDING_SHORTCUT_TOKEN.store(0, Ordering::Release)",
  );
  const pendingGenerationClearIndex = hookMessageBranch.indexOf(
    "WINDOWS_PENDING_SHORTCUT_GENERATION.store(0, Ordering::Release)",
  );
  const oldRetryClearIndex = hookMessageBranch.indexOf(
    "clear_retry_timer(hwnd, WINDOWS_SHORTCUT_RETRY_TIMER_ID)",
  );
  const messageTryIndex = hookMessageBranch.indexOf(
    "match try_handle_shortcut(app, generation, token)",
  );
  assert.ok(
    staleMessageGuardIndex >= 0 &&
      staleMessageGuardIndex < latestTokenStoreIndex &&
      latestTokenStoreIndex < pendingTokenClearIndex &&
      pendingTokenClearIndex < pendingGenerationClearIndex &&
      pendingGenerationClearIndex < oldRetryClearIndex &&
      oldRetryClearIndex < messageTryIndex,
    "a valid new chord must supersede and clear any older retry before dispatch",
  );
  assert.match(
    hookMessageBranch.slice(staleMessageGuardIndex, latestTokenStoreIndex),
    /return LRESULT\(0\)/,
  );
  assert.doesNotMatch(
    hookMessageBranch.slice(0, hookMessageBranch.indexOf("Ok(false) => {")),
    /begin_shortcut_retry/,
  );
  assert.match(
    hookMessageBranch,
    /match try_handle_shortcut\(app, generation, token\)/,
  );
  assert.match(
    hookMessageBranch,
    /Ok\(true\) => finish_shortcut_retry\(hwnd, token\)/,
  );
  const busyMessageBranch = hookMessageBranch.slice(
    hookMessageBranch.indexOf("Ok(false) => {"),
    hookMessageBranch.indexOf("Err(error) =>"),
  );
  const busyCurrentIndex = busyMessageBranch.indexOf(
    "shortcut_dispatch_is_current(generation)",
  );
  const busyLatestTokenIndex = busyMessageBranch.indexOf(
    "WINDOWS_LATEST_SHORTCUT_TOKEN.load(Ordering::Acquire) == token",
  );
  const beginRetryIndex = busyMessageBranch.indexOf(
    "begin_shortcut_retry(generation, token)",
  );
  const setRetryIndex = busyMessageBranch.indexOf(
    "if !set_retry_timer(hwnd, WINDOWS_SHORTCUT_RETRY_TIMER_ID)",
  );
  const failedTimerCleanupIndex = busyMessageBranch.indexOf(
    "finish_shortcut_retry(hwnd, token)",
  );
  assert.ok(
    busyCurrentIndex >= 0 &&
      busyCurrentIndex < busyLatestTokenIndex &&
      busyLatestTokenIndex < beginRetryIndex &&
      beginRetryIndex < setRetryIndex &&
      setRetryIndex < failedTimerCleanupIndex,
    "Busy may publish retry state only for the current newest chord and must undo it if SetTimer fails",
  );
  assert.match(
    hookMessageBranch,
    /Err\(error\) => \{[\s\S]*finish_shortcut_retry\(hwnd, token\)[\s\S]*eprintln!\(/,
  );
  assert.match(
    hookMessageBranch,
    /else \{\s*finish_shortcut_retry\(hwnd, token\)/,
  );
  const staleTimerGuardIndex = shortcutTimerBranch.indexOf(
    "if token == 0",
  );
  const timerTryIndex = shortcutTimerBranch.indexOf(
    "match try_handle_shortcut(app, generation, token)",
  );
  assert.ok(
    staleTimerGuardIndex >= 0 && staleTimerGuardIndex < timerTryIndex,
    "a retry timer must reject missing or stale pending dispatch state before retrying",
  );
  const staleTimerGuard = shortcutTimerBranch.slice(staleTimerGuardIndex, timerTryIndex);
  assert.match(
    shortcutTimerBranch.slice(0, staleTimerGuardIndex),
    /WINDOWS_PENDING_SHORTCUT_GENERATION\.load\(Ordering::Acquire\)[\s\S]*WINDOWS_PENDING_SHORTCUT_TOKEN\.load\(Ordering::Acquire\)/,
  );
  assert.match(
    staleTimerGuard,
    /token == 0[\s\S]*WINDOWS_LATEST_SHORTCUT_TOKEN\.load\(Ordering::Acquire\) != token[\s\S]*!shortcut_dispatch_is_current\(generation\)[\s\S]*WINDOWS_PENDING_SHORTCUT_TOKEN\.store\(0, Ordering::Release\)[\s\S]*WINDOWS_PENDING_SHORTCUT_GENERATION\.store\(0, Ordering::Release\)[\s\S]*clear_retry_timer\(hwnd, WINDOWS_SHORTCUT_RETRY_TIMER_ID\)[\s\S]*return LRESULT\(0\)/,
  );
  assert.match(
    shortcutTimerBranch,
    /match try_handle_shortcut\(app, generation, token\)/,
  );
  assert.match(
    shortcutTimerBranch,
    /Ok\(true\) => finish_shortcut_retry\(hwnd, token\)/,
  );
  assert.match(shortcutTimerBranch, /Ok\(false\) => \{\}/);
  assert.match(
    shortcutTimerBranch,
    /Err\(error\) => \{[\s\S]*finish_shortcut_retry\(hwnd, token\)[\s\S]*eprintln!\(/,
  );
  assert.match(
    shortcutTimerBranch,
    /else \{\s*finish_shortcut_retry\(hwnd, token\)/,
  );
  assert.doesNotMatch(windowCallback, /\n\s*handle_shortcut\(app\)/);
  assert.match(
    fullscreenBackend,
    /fn try_toggle_foreground_fullscreen[\s\S]*try_lock\(\)[\s\S]*TryLockError::WouldBlock[\s\S]*RdpFullscreenShortcutDispatch::Busy/,
  );
  assert.match(fullscreenBackend, /fullscreen\.shortcut\.enter/);
});

test("Windows removes Tao's keyboard Raw Input registration so the low-level hook runs", () => {
  assert.match(
    lib,
    /#\[cfg\(target_os = "windows"\)\][\s\S]{0,500}device_event_filter\(tauri::DeviceEventFilter::Always\)/,
  );
  assert.match(lib, /suppresses this process's WH_KEYBOARD_LL callback/);
  assert.doesNotMatch(lib, /DeviceEventFilter::Unfocused/);
});

test("Windows never captures Ctrl+Alt+Break while another application is foreground", () => {
  const logFocusStateStart = shortcutBackend.indexOf("fn log_focus_state");
  const trySyncFocusStart = shortcutBackend.indexOf("fn try_sync_focus");
  const windowsSyncFocusStart = shortcutBackend.indexOf(
    "pub(crate) fn sync_focus",
    trySyncFocusStart,
  );
  const nonWindowsSyncFocusStart = shortcutBackend.indexOf(
    "pub(crate) fn sync_focus",
    windowsSyncFocusStart + 1,
  );
  const trySyncFocus = shortcutBackend.slice(trySyncFocusStart, windowsSyncFocusStart);
  const logFocusState = shortcutBackend.slice(logFocusStateStart, trySyncFocusStart);
  const syncFocus = shortcutBackend.slice(windowsSyncFocusStart, nonWindowsSyncFocusStart);
  const hookBackend = shortcutBackend.slice(
    shortcutBackend.indexOf("mod windows_break_hook"),
    shortcutBackend.indexOf("const ACTION_ID"),
  );
  const setAppActive = hookBackend.slice(
    hookBackend.indexOf("pub(super) fn set_app_active"),
    hookBackend.indexOf("fn modifier_bit"),
  );
  const tryHandleStart = shortcutBackend.indexOf("fn try_handle_shortcut");
  const tryHandleShortcut = shortcutBackend.slice(
    tryHandleStart,
    shortcutBackend.indexOf("fn handle_shortcut", tryHandleStart),
  );
  const activationCallback = shortcutBackend.slice(
    shortcutBackend.indexOf("fn windows_shortcut_proc"),
    shortcutBackend.indexOf("fn main_window_hwnd"),
  );
  const activationTimerIndex = activationCallback.indexOf(
    "if msg == WM_TIMER && wparam.0 == WINDOWS_ACTIVATION_RETRY_TIMER_ID",
  );
  const focusTimerIndex = activationCallback.indexOf(
    "if msg == WM_TIMER && wparam.0 == WINDOWS_FOCUS_RETRY_TIMER_ID",
  );
  const activationMessageIndex = activationCallback.indexOf("if msg == WM_ACTIVATEAPP");
  const callbackTailIndex = activationCallback.indexOf("unsafe { DefSubclassProc");
  assert.ok(
    activationTimerIndex >= 0 &&
      activationTimerIndex < focusTimerIndex &&
      focusTimerIndex < activationMessageIndex &&
      activationMessageIndex < callbackTailIndex,
    "activation, focus retry, and activation-change handling must remain separate callback branches",
  );
  const activationTimerBranch = activationCallback.slice(
    activationTimerIndex,
    focusTimerIndex,
  );
  const focusTimerBranch = activationCallback.slice(
    focusTimerIndex,
    activationMessageIndex,
  );
  const activationMessageBranch = activationCallback.slice(
    activationMessageIndex,
    callbackTailIndex,
  );
  const activeTransitionIndex = activationMessageBranch.indexOf("if app_is_active {");
  const inactiveTransitionIndex = activationMessageBranch.indexOf(
    "} else {",
    activeTransitionIndex,
  );
  const activationZOrderIndex = activationMessageBranch.indexOf(
    "// ActiveX can pump this message",
  );
  assert.ok(
    activeTransitionIndex >= 0 &&
      activeTransitionIndex < inactiveTransitionIndex &&
      inactiveTransitionIndex < activationZOrderIndex,
    "activation and deactivation must publish distinct shortcut-state transitions",
  );
  const activeTransition = activationMessageBranch.slice(
    activeTransitionIndex,
    inactiveTransitionIndex,
  );
  const inactiveTransition = activationMessageBranch.slice(
    inactiveTransitionIndex,
    activationZOrderIndex,
  );
  const activationWork = activationMessageBranch.slice(activationZOrderIndex);
  const activeWorkIndex = activationWork.indexOf("if app_is_active {");
  const inactiveWorkIndex = activationWork.indexOf("} else {", activeWorkIndex);
  const activeWork = activationWork.slice(activeWorkIndex, inactiveWorkIndex);
  const inactiveWork = activationWork.slice(inactiveWorkIndex);
  assert.match(
    syncFocus,
    /let completed = try_sync_focus\(app\)\?[\s\S]*if completed \{[\s\S]*clear_retry_timer\(hwnd, WINDOWS_FOCUS_RETRY_TIMER_ID\)[\s\S]*else \{[\s\S]*set_retry_timer\(hwnd, WINDOWS_FOCUS_RETRY_TIMER_ID\)/,
  );
  assert.match(shortcutBackend, /const WINDOWS_FOCUS_RETRY_TIMER_ID: usize/);
  assert.match(
    trySyncFocus,
    /try_shortcut_focus_state\(\)\?[\s\S]*Some\(state\) => state,[\s\S]*None => \{[\s\S]*Some\("rdpSessionBusy"\)[\s\S]*return Ok\(false\)/,
  );
  assert.match(
    trySyncFocus,
    /registration\(\)\.try_lock\(\)[\s\S]*TryLockError::WouldBlock\) => \{[\s\S]*Some\("registrationBusy"\)[\s\S]*return Ok\(false\)/,
  );
  assert.match(
    logFocusState,
    /"status": status,[\s\S]*"reason": reason,[\s\S]*"zOrderCompleted": z_order_completed/,
  );
  for (const reason of ["rdpSessionBusy", "registrationBusy", "zOrderBusy"]) {
    assert.match(trySyncFocus, new RegExp(`Some\\("${reason}"\\)`));
  }
  assert.match(
    trySyncFocus,
    /log_focus_state\(\s*"complete",\s*None,[\s\S]*Some\(true\),\s*\);[\s\S]*Ok\(true\)/,
  );
  const registrationDropIndex = trySyncFocus.indexOf("drop(state)");
  const zOrderTryIndex = trySyncFocus.indexOf(
    "try_sync_fullscreen_z_order(app_is_focused)",
  );
  assert.ok(
    registrationDropIndex >= 0 && registrationDropIndex < zOrderTryIndex,
    "focus sync must release registration state before the nonblocking RDP z-order attempt",
  );
  assert.match(
    trySyncFocus,
    /!rdp_sessions\.try_sync_fullscreen_z_order\(app_is_focused\)\?[\s\S]*Some\("zOrderBusy"\)[\s\S]*return Ok\(false\)/,
  );
  assert.doesNotMatch(
    trySyncFocus,
    /rdp_sessions\.(?:owns_foreground_window|owns_fullscreen_shortcut|sync_fullscreen_z_order)\(/,
  );
  assert.match(focusTimerBranch, /try_sync_focus\(app\)/);
  assert.match(focusTimerBranch, /Ok\(completed\) => completed/);
  assert.match(
    focusTimerBranch,
    /Err\(error\) => \{[\s\S]*eprintln!\([\s\S]*true/,
  );
  assert.match(
    focusTimerBranch,
    /if completed \{\s*clear_retry_timer\(hwnd, WINDOWS_FOCUS_RETRY_TIMER_ID\)/,
  );
  const rdpFocusState = fullscreenBackend.slice(
    fullscreenBackend.indexOf("pub fn try_shortcut_focus_state"),
    fullscreenBackend.indexOf("pub fn try_sync_fullscreen_z_order"),
  );
  assert.match(
    rdpFocusState,
    /GetForegroundWindow\(\)[\s\S]*GetFocus\(\)[\s\S]*self\.sessions\.try_lock\(\)/,
  );
  assert.match(
    rdpFocusState,
    /TryLockError::WouldBlock\) => return Ok\(None\)/,
  );
  assert.match(
    rdpFocusState,
    /rdp_host_accepts_shortcut_input\(session\)[\s\S]*IsChild\(session\.hwnd, focused\)[\s\S]*Ok\(Some\(\(owns_foreground, owns_shortcut\)\)\)/,
  );
  assert.doesNotMatch(
    fullscreenBackend,
    /pub fn (?:owns_foreground_window|owns_fullscreen_shortcut|sync_fullscreen_z_order)\(/,
  );
  assert.match(activationMessageBranch, /let app_is_active = wparam\.0 != 0/);
  const activeEpochIndex = activeTransition.indexOf(
    "WINDOWS_SHORTCUT_GENERATION.fetch_add(1, Ordering::AcqRel)",
  );
  const activePublishIndex = activeTransition.indexOf(
    "WINDOWS_APP_ACTIVE.store(true, Ordering::Release)",
  );
  const activeHookIndex = activeTransition.indexOf(
    "windows_break_hook::set_app_active(true)",
  );
  assert.ok(
    activeEpochIndex >= 0 &&
      activeEpochIndex < activePublishIndex &&
      activePublishIndex < activeHookIndex,
    "reactivation must advance the epoch before publishing active=true",
  );
  const inactivePublishIndex = inactiveTransition.indexOf(
    "WINDOWS_APP_ACTIVE.store(false, Ordering::Release)",
  );
  const inactiveHookIndex = inactiveTransition.indexOf(
    "windows_break_hook::set_app_active(false)",
  );
  const inactiveEpochIndex = inactiveTransition.indexOf(
    "WINDOWS_SHORTCUT_GENERATION.fetch_add(1, Ordering::AcqRel)",
  );
  const latestTokenClearIndex = inactiveTransition.indexOf(
    "WINDOWS_LATEST_SHORTCUT_TOKEN.store(0, Ordering::Release)",
  );
  const pendingTokenClearIndex = inactiveTransition.indexOf(
    "WINDOWS_PENDING_SHORTCUT_TOKEN.store(0, Ordering::Release)",
  );
  const pendingGenerationClearIndex = inactiveTransition.indexOf(
    "WINDOWS_PENDING_SHORTCUT_GENERATION.store(0, Ordering::Release)",
  );
  const retryTimerClearIndex = inactiveTransition.indexOf(
    "clear_retry_timer(hwnd, WINDOWS_SHORTCUT_RETRY_TIMER_ID)",
  );
  assert.ok(
    inactivePublishIndex >= 0 &&
      inactivePublishIndex < inactiveHookIndex &&
      inactiveHookIndex < inactiveEpochIndex &&
      inactiveEpochIndex < latestTokenClearIndex &&
      latestTokenClearIndex < pendingTokenClearIndex &&
      pendingTokenClearIndex < pendingGenerationClearIndex &&
      pendingGenerationClearIndex < retryTimerClearIndex,
    "deactivation must publish inactive, advance the epoch, and invalidate all chord state",
  );
  assert.ok(
    activeWorkIndex >= 0 && activeWorkIndex < inactiveWorkIndex,
    "activation work must keep separate active and inactive paths",
  );
  assert.match(activeWork, /match try_sync_focus\(app\)/);
  assert.match(
    activeWork,
    /clear_retry_timer\(hwnd, WINDOWS_ACTIVATION_RETRY_TIMER_ID\)/,
  );
  assert.doesNotMatch(activeWork, /try_sync_fullscreen_z_order/);
  assert.doesNotMatch(inactiveWork, /try_sync_focus/);
  assert.match(inactiveWork, /try_sync_fullscreen_z_order\(false\)/);
  assert.match(
    inactiveWork,
    /Ok\(true\) => clear_retry_timer\(hwnd, WINDOWS_ACTIVATION_RETRY_TIMER_ID\)/,
  );
  assert.match(
    inactiveWork,
    /Ok\(false\) => \{\s*let _ = set_retry_timer\(hwnd, WINDOWS_ACTIVATION_RETRY_TIMER_ID\)/,
  );
  assert.match(
    inactiveWork,
    /Err\(error\) => \{[\s\S]*clear_retry_timer\(hwnd, WINDOWS_ACTIVATION_RETRY_TIMER_ID\)[\s\S]*eprintln!\(/,
  );
  assert.match(
    activeWork,
    /if let Some\(app\) = WINDOWS_APP_HANDLE\.get\(\) \{[\s\S]*match try_sync_focus\(app\)[\s\S]*WINDOWS_FOCUS_RETRY_TIMER_ID/,
  );
  assert.match(
    activationTimerBranch,
    /try_sync_fullscreen_z_order\(WINDOWS_APP_ACTIVE\.load\(Ordering::Acquire\)\)/,
  );
  assert.match(activationTimerBranch, /Ok\(completed\) => completed/);
  assert.match(
    activationTimerBranch,
    /Err\(error\) => \{[\s\S]*eprintln!\([\s\S]*true/,
  );
  assert.match(
    activationTimerBranch,
    /if completed \{\s*clear_retry_timer\(hwnd, WINDOWS_ACTIVATION_RETRY_TIMER_ID\)/,
  );
  assert.doesNotMatch(activationMessageBranch, /\bsync_focus\(|lock_sessions|rdp_debug/);
  assert.match(
    setAppActive,
    /APP_ACTIVE\.store\(active, Ordering::Release\)/,
  );
  assert.match(
    setAppActive,
    /MODIFIER_STATE\.store\(0, Ordering::Release\)/,
  );
  assert.match(
    setAppActive,
    /BREAK_DOWN\.store\(false, Ordering::Release\)/,
  );
  assert.match(
    hookBackend,
    /if code == HC_ACTION_CODE && lparam != 0 \{[\s\S]*if !APP_ACTIVE\.load\(Ordering::Acquire\) \{[\s\S]*return unsafe \{ CallNextHookEx/,
  );
  assert.match(
    tryHandleShortcut,
    /fn try_handle_shortcut\(\s*app: &tauri::AppHandle,\s*generation: usize,\s*token: usize/,
  );
  const initialTokenGateIndex = tryHandleShortcut.indexOf(
    "if !shortcut_dispatch_token_is_current(generation, token)",
  );
  const rdpDispatchIndex = tryHandleShortcut.indexOf(
    "try_toggle_foreground_fullscreen(||",
  );
  const closureTokenCheckIndex = tryHandleShortcut.indexOf(
    "shortcut_dispatch_token_is_current(generation, token)",
    rdpDispatchIndex,
  );
  const dispatchMatchIndex = tryHandleShortcut.indexOf("match dispatch");
  const webviewTokenGateIndex = tryHandleShortcut.indexOf(
    "if !shortcut_dispatch_token_is_current(generation, token)",
    dispatchMatchIndex,
  );
  const webviewDispatchIndex = tryHandleShortcut.indexOf(
    "remote_fullscreen::emit_toggle_shortcut(app)",
  );
  assert.ok(
    initialTokenGateIndex >= 0 &&
      initialTokenGateIndex < rdpDispatchIndex &&
      rdpDispatchIndex < closureTokenCheckIndex &&
      closureTokenCheckIndex < dispatchMatchIndex &&
      dispatchMatchIndex < webviewTokenGateIndex &&
      webviewTokenGateIndex < webviewDispatchIndex,
    "generation and token validity must flow through native RDP and be rechecked before WebView emit",
  );
  assert.match(
    tryHandleShortcut.slice(initialTokenGateIndex, rdpDispatchIndex),
    /return Ok\(true\)/,
  );
  assert.match(
    tryHandleShortcut.slice(rdpDispatchIndex, dispatchMatchIndex),
    /try_toggle_foreground_fullscreen\(\|\| \{\s*shortcut_dispatch_token_is_current\(generation, token\)\s*\}\)\?/,
  );
  assert.match(
    tryHandleShortcut.slice(webviewTokenGateIndex, webviewDispatchIndex),
    /return Ok\(true\)/,
  );
  assert.match(
    fullscreenBackend,
    /pub fn try_sync_fullscreen_z_order[\s\S]*try_lock\(\)[\s\S]*TryLockError::WouldBlock[\s\S]*fullscreen_host_matches_monitor\(session\)/,
  );
});

test("the native shortcut rechecks focus after the startup WebView is ready", () => {
  const applyShortcut = shortcutBackend.slice(
    shortcutBackend.indexOf("pub(crate) fn apply"),
    shortcutBackend.indexOf("fn handle_shortcut"),
  );
  assert.match(applyShortcut, /STARTUP_FOCUS_RECHECK_DELAY/);
  assert.match(applyShortcut, /schedule_focus_recheck\(app\)/);
  assert.match(shortcutBackend, /tokio::time::sleep/);
  assert.match(shortcutBackend, /sync_focus\(&(?:main_thread_)?app\)/);
  assert.match(lib, /Focused\(false\)[\s\S]*schedule_focus_recheck/);
  assert.match(shortcutBackend, /GetForegroundWindow/);
  assert.match(remoteFullscreenBackend, /GetForegroundWindow/);
});

test("ActiveX delegates Ctrl+Alt+Break through container-handled request events", () => {
  const preConnectConfig = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn configure_rdp_control"),
    fullscreenBackend.indexOf("fn default_remote_resolution"),
  );
  assert.match(
    preConnectConfig,
    /set_property_i32\(&advanced, "ContainerHandledFullScreen", 1\)/,
  );
  assert.match(
    fullscreenBackend,
    /fullscreen_requests: mpsc::Sender<\(i32, usize\)>/,
  );
  const eventCallback = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn handle_event"),
    fullscreenBackend.indexOf("fn start_rdp_fullscreen_request_worker"),
  );
  const eventWorker = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn start_rdp_fullscreen_request_worker"),
    fullscreenBackend.indexOf("static RDP_EVENT_SINK_VTABLE"),
  );
  const leaveFullscreen = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn leave_native_fullscreen"),
    fullscreenBackend.indexOf("fn get_advanced_settings"),
  );
  const eventHandler = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn handle_rdp_fullscreen_request"),
    fullscreenBackend.indexOf("fn subscribe_rdp_events"),
  );
  assert.match(
    eventCallback,
    /let activation_generation =\s*crate::remote_fullscreen_shortcut::windows_activation_generation\(\)[\s\S]*fullscreen_requests[\s\S]*\.send\(\(dispidmember, activation_generation\)\)/,
  );
  assert.match(
    eventCallback,
    /suppressed_fullscreen_dispid\.load\(Ordering::Acquire\) == dispidmember as u32/,
  );
  assert.doesNotMatch(eventCallback, /run_on_main_thread|thread::spawn/);
  assert.match(eventWorker, /mpsc::channel\(\)/);
  assert.match(
    eventWorker,
    /'requests: while let Ok\(\(dispid, activation_generation\)\) = receiver\.recv\(\)[\s\S]*loop \{/,
  );
  assert.match(eventWorker, /run_on_main_thread/);
  assert.match(eventWorker, /completion_receiver\.recv_timeout\(RDP_MAIN_THREAD_TIMEOUT\)/);
  assert.match(
    eventWorker,
    /Err\(error\) => \{[\s\S]*completion_receiver\.recv\(\)[\s\S]*Err\(_\) => break 'requests/,
  );
  assert.match(eventWorker, /completion_sender\.send\(result\)/);
  assert.match(
    eventWorker,
    /Ok\(true\) => break,[\s\S]*Ok\(false\) => \{[\s\S]*"fullscreen\.request\.retry"[\s\S]*"reason": "sessionBusy"[\s\S]*thread::sleep\(RDP_FULLSCREEN_REQUEST_RETRY_INTERVAL\)/,
  );
  assert.match(
    fullscreenBackend,
    /RDP_FULLSCREEN_REQUEST_RETRY_INTERVAL: Duration = Duration::from_millis\(25\)/,
  );
  assert.equal(
    eventWorker.match(/\breceiver\.recv\(\)/g)?.length,
    1,
    "the FIFO worker must finish or retry the current request before receiving the next one",
  );
  for (const diagnostic of [
    "fullscreen.request.schedule_error",
    "fullscreen.request.completion_error",
    "fullscreen.request.retry",
    "fullscreen.request.error",
  ]) {
    const diagnosticIndex = eventWorker.indexOf(`"${diagnostic}"`);
    assert.ok(diagnosticIndex >= 0, `${diagnostic} must be logged`);
    assert.match(
      eventWorker.slice(diagnosticIndex, diagnosticIndex + 500),
      /"activationGeneration": activation_generation/,
    );
  }
  assert.match(
    eventHandler,
    /activation_generation: usize,[\s\S]*\) -> Result<bool, String>/,
  );
  const firstGenerationGuardIndex = eventHandler.indexOf("if !request_is_current()");
  const sessionTryLockIndex = eventHandler.indexOf("sessions.try_lock()");
  const secondGenerationGuardIndex = eventHandler.indexOf(
    "if !request_is_current()",
    firstGenerationGuardIndex + 1,
  );
  const eventSessionLookupIndex = eventHandler.indexOf(".get_mut(session_id)");
  assert.ok(
    firstGenerationGuardIndex >= 0 &&
      firstGenerationGuardIndex < sessionTryLockIndex &&
      sessionTryLockIndex < secondGenerationGuardIndex &&
      secondGenerationGuardIndex < eventSessionLookupIndex,
    "ActiveX requests must validate their activation generation around the nonblocking Session lock",
  );
  assert.match(
    eventHandler.slice(firstGenerationGuardIndex, sessionTryLockIndex),
    /return Ok\(true\)/,
  );
  assert.match(
    eventHandler.slice(secondGenerationGuardIndex, eventSessionLookupIndex),
    /return Ok\(true\)/,
  );
  assert.match(
    eventHandler,
    /windows_activation_generation_is_current\(\s*activation_generation[\s\S]*TryLockError::WouldBlock\) => return Ok\(false\)/,
  );
  assert.doesNotMatch(eventHandler, /lock_sessions\(/);
  assert.match(
    eventHandler,
    /DISPID_REQUEST_GO_FULLSCREEN => \{[\s\S]*enter_native_fullscreen_if\(session, &request_is_current\)/,
  );
  assert.match(
    eventHandler,
    /DISPID_REQUEST_LEAVE_FULLSCREEN => \{[\s\S]*leave_native_fullscreen_if\(session, &request_is_current\)/,
  );
  assert.match(
    fullscreenBackend,
    /RdpFullscreenEventSuppression::new\([\s\S]{0,180}DISPID_REQUEST_GO_FULLSCREEN/,
  );
  assert.match(
    leaveFullscreen,
    /RdpFullscreenEventSuppression::new\([\s\S]{0,180}DISPID_REQUEST_LEAVE_FULLSCREEN/,
  );
  assert.match(
    eventHandler,
    /session\.hwnd\.0 as isize != origin_hwnd[\s\S]*Arc::ptr_eq\(&session\.suppressed_fullscreen_dispid, origin_token\)/,
  );
  assert.match(fullscreenBackend, /FindConnectionPoint/);
  assert.match(fullscreenBackend, /connection_point\.Advise\(&sink\)/);
  assert.match(fullscreenBackend, /connection_point\.Unadvise\(self\.cookie\)/);
  const startSession = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn start_session_on_main_thread"),
    fullscreenBackend.indexOf("fn create_rdp_control"),
  );
  const subscribeIndex = startSession.indexOf("subscribe_rdp_events");
  const connectIndex = startSession.indexOf('invoke_method(&dispatch, "Connect")');
  assert.ok(
    subscribeIndex >= 0 && connectIndex >= 0 && subscribeIndex < connectIndex,
    "ActiveX request events must be subscribed before Connect",
  );
  assert.doesNotMatch(fullscreenBackend, /DEBUG-RFS|KKTERM_DEBUG_RDP_FULLSCREEN_MODE/);
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

test("disconnecting from the ActiveX full-screen connection bar restores the KKTerm Pane", () => {
  const eventCallback = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn handle_event"),
    fullscreenBackend.indexOf("fn start_rdp_fullscreen_request_worker"),
  );
  const eventHandler = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn handle_rdp_fullscreen_request"),
    fullscreenBackend.indexOf("fn subscribe_rdp_events"),
  );
  const disconnectRecovery = fullscreenBackend.slice(
    fullscreenBackend.indexOf("fn restore_disconnected_fullscreen_host"),
    fullscreenBackend.indexOf("fn restore_windowed_host"),
  );

  assert.match(fullscreenBackend, /DISPID_DISCONNECTED:\s*i32\s*=\s*4/);
  assert.match(eventCallback, /DISPID_DISCONNECTED/);
  assert.match(
    eventHandler,
    /DISPID_DISCONNECTED => restore_disconnected_fullscreen_host\(session\)/,
  );
  assert.match(
    disconnectRecovery,
    /restore_windowed_host\(session, restore\)[\s\S]*session\.fullscreen_restore = None/,
  );
  assert.doesNotMatch(disconnectRecovery, /kkterm_process_owns_foreground/);
});

test("screenshot re-registration preserves other global shortcuts", () => {
  assert.doesNotMatch(screenshotShortcuts, /unregister_all/);
  assert.match(screenshotShortcuts, /unregister_multiple/);
});

test("closing detached VNC or canvas windows does not call the Windows RDP manager", () => {
  assert.doesNotMatch(lib, /session_id_from_label\(window\.label\(\)\)/);
});

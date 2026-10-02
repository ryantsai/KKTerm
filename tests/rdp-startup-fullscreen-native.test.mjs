import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [rdp, lib, permissions, shortcut] = await Promise.all([
  read("src-tauri/src/rdp.rs"),
  read("src-tauri/src/lib.rs"),
  read("src-tauri/permissions/main.toml"),
  read("src-tauri/src/remote_fullscreen_shortcut.rs"),
]);

test("every native fullscreen safe refusal reports skipped instead of applied", () => {
  const entry = rdp.slice(
    rdp.indexOf("fn enter_native_fullscreen_if("),
    rdp.indexOf("fn rollback_failed_fullscreen_entry("),
  );
  assert.equal(entry.match(/fullscreen\.enter\.skipped/g)?.length, 4);
  assert.equal(entry.match(/return Ok\(RdpFullscreenEntryOutcome::Skipped\)/g)?.length, 4);
  assert.doesNotMatch(entry, /Ok\(\(\)\)/);
  assert.match(entry, /if already_fullscreen\s*\{\s*return Ok\(RdpFullscreenEntryOutcome::Applied\)/);
  assert.ok(entry.lastIndexOf("RdpFullscreenEntryOutcome::Applied") > entry.indexOf("session.fullscreen_restore = Some(restore)"));
});

test("startup token is checked inside the native entry while manual and ActiveX routes remain intact", () => {
  const entryCommand = rdp.slice(rdp.indexOf("pub fn enter_fullscreen("), rdp.indexOf("pub fn exit_fullscreen("));
  assert.match(entryCommand, /Some\(generation\) => enter_native_fullscreen_if/);
  assert.match(entryCommand, /windows_activation_generation_is_current\(\s*generation/);
  assert.match(entryCommand, /None => enter_native_fullscreen\(session\)/);
  assert.match(rdp, /enter_native_fullscreen_if\(session, &request_is_current\)\.map\(\|_\| \(\)\)/);
  assert.match(lib, /fn enter_rdp_fullscreen\([\s\S]*?Result<rdp::RdpFullscreenEntryOutcome, String>/);
});

test("startup focus snapshot accepts owned native windows and observes leave-and-return", () => {
  const snapshot = rdp.slice(rdp.indexOf("pub fn startup_fullscreen_state("), rdp.indexOf("fn fullscreen_display_settings("));
  const foreground = rdp.slice(rdp.indexOf("fn kkterm_process_owns_foreground("), rdp.indexOf("pub fn startup_fullscreen_state("));
  assert.match(foreground, /GetWindowThreadProcessId\(foreground, Some\(&mut process_id\)\)/);
  assert.match(foreground, /process_id == std::process::id\(\)/);
  assert.match(snapshot, /run_on_main_thread\("get_rdp_startup_fullscreen_state"/);
  assert.match(snapshot, /app_foreground: kkterm_process_owns_foreground\(\)/);
  assert.match(snapshot, /windows_activation_generation_is_current/);
  assert.doesNotMatch(snapshot, /is_focused\(|lock_sessions\(|get_property_/);
  const activation = shortcut.slice(shortcut.indexOf("if msg == WM_ACTIVATEAPP {"));
  assert.equal(activation.match(/WINDOWS_SHORTCUT_GENERATION\.fetch_add\(1, Ordering::AcqRel\)/g)?.length, 2);
});

test("startup focus snapshot has a registered main-window command permission", () => {
  assert.match(lib, /fn get_rdp_startup_fullscreen_state\(/);
  assert.match(lib, /set_rdp_visibility,\s*get_rdp_startup_fullscreen_state,\s*enter_rdp_fullscreen,/);
  assert.match(permissions, /"set_rdp_visibility",\s*"get_rdp_startup_fullscreen_state",/);
});

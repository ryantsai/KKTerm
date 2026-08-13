import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  source,
  dashboardCommandsSource,
  itOpsCommandsSource,
  selectiveExportSource,
  xServerSource,
  sftpWorkspaceSource,
  remoteFullscreenSource,
] = await Promise.all([
  readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/dashboard_commands.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/itops/commands.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/selective_export.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/x_server.rs", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../src/modules/workspace/connections/sftp/SftpWorkspace.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(new URL("../src-tauri/src/remote_fullscreen.rs", import.meta.url), "utf8"),
]);

function commandSource(name, nextName) {
  const start = source.indexOf(`async fn ${name}(`);
  const end = source.indexOf(`async fn ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} should remain an async Tauri command`);
  assert.notEqual(end, -1, `${nextName} should delimit ${name}`);
  return source.slice(start, end);
}

function asyncCommandSource(commandFile, name) {
  const start = commandFile.indexOf(`async fn ${name}(`);
  const nextCommand = commandFile.indexOf("\n#[tauri::command]", start + 1);
  const end = nextCommand === -1 ? commandFile.length : nextCommand;
  assert.notEqual(start, -1, `${name} should remain an async Tauri command`);
  return commandFile.slice(start, end);
}

test("host usage collection runs outside Tauri's native main thread", () => {
  const command = commandSource("get_host_usage_snapshot", "get_system_performance_counters");
  assert.match(command, /tauri::async_runtime::spawn_blocking/);
  assert.match(command, /host_usage_snapshot\(\)/);
});

test("system counter collection runs outside Tauri's native main thread", () => {
  const command = commandSource("get_system_performance_counters", "pc_info_get");
  assert.match(command, /tauri::async_runtime::spawn_blocking/);
  assert.match(command, /system_performance_counters_snapshot\(\)/);
});

test("unbounded SQLite UI reads run from async commands outside Tokio workers", () => {
  assert.match(asyncCommandSource(source, "list_connection_tree"), /run_blocking_db\(/);
  assert.match(
    asyncCommandSource(dashboardCommandsSource, "dashboard_load_state"),
    /run_blocking_db\(/,
  );
});

test("detached remote full-screen creation leaves the WebView2 IPC callback", () => {
  const command = asyncCommandSource(
    remoteFullscreenSource,
    "open_remote_fullscreen_window",
  );
  assert.match(command, /tauri::async_runtime::spawn_blocking/);
  assert.match(command, /open_remote_fullscreen_window_blocking/);
  assert.match(command, /WebviewWindowBuilder::new/);
});

test("IT Ops batch preparation runs outside Tauri's native main thread", () => {
  const batchStartCommand = itOpsCommandsSource.slice(
    itOpsCommandsSource.indexOf("pub async fn itops_start_batch_run"),
    itOpsCommandsSource.indexOf("pub fn start_run"),
  );
  assert.match(batchStartCommand, /tauri::async_runtime::spawn_blocking/);
  assert.match(batchStartCommand, /start_run\(&app, site_id, task, scope, task_id\)/);
});

test("known expensive filesystem, archive, image, and process commands use blocking workers", () => {
  const commands = [
    "import_settings_database",
    "export_settings_database",
    "launch_ssh_x_server",
    "generate_ssh_key_pair",
    "create_diagnostics_bundle",
    "capture_screenshot_to_clipboard",
    "deliver_screenshot_data_url",
    "capture_screenshot_for_assistant",
    "capture_fullscreen_screenshot_for_assistant",
    "capture_screenshot_to_library",
    "capture_fullscreen_screenshot_to_library",
    "capture_active_window_screenshot_to_library",
    "capture_interactive_region_screenshot_to_library",
    "list_screenshots",
    "delete_screenshot",
    "clear_screenshots",
    "list_terminal_recordings",
    "list_all_terminal_recordings",
    "search_terminal_recordings",
    "prepare_terminal_recording_summary",
    "save_terminal_recording_summary",
    "export_terminal_recordings",
    "list_local_directory",
  ];

  for (const name of commands) {
    assert.match(
      asyncCommandSource(source, name),
      /run_blocking_(?:screenshot_|database_)?command\(/,
      name,
    );
  }
});

test("screenshot commands stay serialized after moving to workers", () => {
  const helper = source.slice(
    source.indexOf("static SCREENSHOT_COMMAND_LOCK"),
    source.indexOf("async fn start_sftp_session"),
  );
  assert.match(helper, /std::sync::Mutex::new\(\(\)\)/);
  assert.match(helper, /SCREENSHOT_COMMAND_LOCK\s+\.lock\(\)/);
  assert.match(helper, /run_blocking_command\(label/);
});

test("selective database archive and cryptography commands use blocking workers", () => {
  for (const name of [
    "export_selective_database",
    "inspect_selective_database",
    "import_selective_database",
  ]) {
    assert.match(
      asyncCommandSource(selectiveExportSource, name),
      /run_blocking_(?:database_)?command\(/,
      name,
    );
  }
});

test("settings-database import and export stay serialized after moving to workers", () => {
  const helper = source.slice(
    source.indexOf("static SETTINGS_DATABASE_COMMAND_LOCK"),
    source.indexOf("async fn start_sftp_session"),
  );
  assert.match(helper, /std::sync::Mutex::new\(\(\)\)/);
  assert.match(helper, /SETTINGS_DATABASE_COMMAND_LOCK\s+\.lock\(\)/);
  assert.match(helper, /run_blocking_command\(label/);

  for (const [file, name] of [
    [source, "import_settings_database"],
    [source, "export_settings_database"],
    [selectiveExportSource, "export_selective_database"],
    [selectiveExportSource, "import_selective_database"],
  ]) {
    assert.match(asyncCommandSource(file, name), /run_blocking_database_command\(/, name);
  }
});

test("X server launch keeps its check-then-spawn sequence serialized", () => {
  assert.match(xServerSource, /static VCXSRV_CONTROL_LOCK: std::sync::Mutex<\(\)>/);
  for (const entryPoint of [
    "pub fn launch_vcxsrv_if_needed(",
    "pub fn restart_vcxsrv(",
    "pub fn stop_vcxsrv(",
  ]) {
    const start = xServerSource.indexOf(entryPoint);
    assert.notEqual(start, -1, entryPoint);
    const body = xServerSource.slice(start, xServerSource.indexOf("\npub fn ", start + 1));
    assert.match(body, /let _guard = control_lock\(\);/, entryPoint);
  }
});

test("local directory navigation ignores results from superseded requests", () => {
  assert.match(sftpWorkspaceSource, /const localDirectoryRequestRef = useRef\(0\)/);
  assert.match(sftpWorkspaceSource, /const requestId = \+\+localDirectoryRequestRef\.current/);
  assert.match(
    sftpWorkspaceSource,
    /if \(requestId !== localDirectoryRequestRef\.current\) \{\s+return true;\s+\}/,
  );
  assert.match(
    sftpWorkspaceSource,
    /if \(requestId === localDirectoryRequestRef\.current\) \{\s+setIsLocalLoading\(false\)/,
  );
});

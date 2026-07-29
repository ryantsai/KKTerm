import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rustSource = fs.readFileSync("src-tauri/src/launch_paths.rs", "utf8");
const libSource = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const bridgeSource = fs.readFileSync("src/app/launchPathBridge.ts", "utf8");
const screenshotsState = fs.readFileSync("src/modules/screenshots/state.ts", "utf8");
const screenshotsPage = fs.readFileSync(
  "src/modules/screenshots/ScreenshotsPage.tsx",
  "utf8",
);
const screenshotEditor = fs.readFileSync(
  "src/modules/screenshots/ScreenshotEditor.tsx",
  "utf8",
);
const storeSource = fs.readFileSync("src/store.ts", "utf8");
const canvasSource = fs.readFileSync("src/modules/workspace/WorkspaceCanvas.tsx", "utf8");
const sftpSource = fs.readFileSync(
  "src/modules/workspace/connections/sftp/SftpWorkspace.tsx",
  "utf8",
);
const tauriConfig = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const smokeInstaller = fs.readFileSync("scripts/smoke-installer.ps1", "utf8");

test("native launch paths are validated, queued, and forwarded by the single-instance callback", () => {
  assert.match(rustSource, /args\.iter\(\)\s*\.skip\(1\)/);
  assert.match(rustSource, /requested\.canonicalize\(\)\.ok\(\)\?/);
  assert.match(rustSource, /metadata\.is_file\(\)/);
  assert.match(rustSource, /metadata\.is_dir\(\)/);
  assert.match(rustSource, /pub fn take_launch_paths/);
  assert.match(
    libSource,
    /tauri_plugin_single_instance::init\(\|app, args, cwd\|[\s\S]*?enqueue_cli_invocation/,
  );
  assert.match(libSource, /launch_paths::take_launch_paths/);
});

test("frontend listens before draining and opens every launch path ephemerally", () => {
  const listenIndex = bridgeSource.indexOf('listen("kkterm://launch-paths-available"');
  const drainIndex = bridgeSource.indexOf("void drainLaunchPaths();", listenIndex);
  assert.ok(listenIndex >= 0);
  assert.ok(drainIndex > listenIndex);
  assert.match(bridgeSource, /invokeCommand\("take_launch_paths", undefined\)/);
  assert.match(bridgeSource, /store\.openEphemeralPath\(path\)/);
  assert.match(storeSource, /openFileViewerPath\(path, \{ ephemeral: true \}\)/);
  assert.match(storeSource, /id: `launch-folder-\$\{stableIdFromPath\(path\)\}`/);
  assert.match(storeSource, /ephemeral: true/);
});

test("image launch paths use an ephemeral screenshot editor source", () => {
  assert.match(bridgeSource, /isScreenshotEditorImagePath\(path\.path\)/);
  assert.match(bridgeSource, /invokeCommand\("read_ephemeral_screenshot"/);
  assert.match(bridgeSource, /requestEphemeralEditor\(screenshot\)/);
  assert.match(screenshotsState, /ephemeralEditorQueue: EphemeralScreenshot\[\]/);
  assert.match(screenshotsPage, /ephemeralSource=\{ephemeralViewer \?\? undefined\}/);
  assert.match(screenshotEditor, /if \(ephemeralSource\) \{\s*return Promise\.resolve\(\)/);
  assert.match(screenshotEditor, /invokeCommand\("save_ephemeral_screenshot"/);
  assert.match(libSource, /read_ephemeral_screenshot/);
  assert.match(libSource, /save_ephemeral_screenshot/);
});

test("ephemeral folder browsing cannot persist view options or Child Connection Tabs", () => {
  assert.match(canvasSource, /inline=\{tab\.ephemeral\}/);
  assert.match(
    sftpSource,
    /openFileViewerPath\(path, \{[\s\S]*?ephemeral: tab\.ephemeral/,
  );
  assert.match(
    storeSource,
    /sourceConnection\?\.type === "localFiles" &&\s*!options\?\.ephemeral/,
  );
  assert.match(
    sftpSource,
    /connectionId\.startsWith\("launch-folder-"\)/,
  );
});

test("installers do not register file or folder associations", () => {
  assert.doesNotMatch(
    JSON.stringify(tauriConfig.bundle),
    /fileAssociations|installerHooks/,
  );
  assert.equal(fs.existsSync("src-tauri/windows/nsis-hooks.nsh"), false);
  assert.doesNotMatch(
    smokeInstaller,
    /FileAssociationKey|FolderAssociationKey|Assert-ShellAssociation/,
  );
});

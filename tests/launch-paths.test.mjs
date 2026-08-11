import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rustSource = fs.readFileSync("src-tauri/src/launch_paths.rs", "utf8");
const libSource = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const appSource = fs.readFileSync("src/App.tsx", "utf8");
const bridgeSource = fs.readFileSync("src/app/launchPathBridge.ts", "utf8");
const systemMenuSource = fs.readFileSync("src-tauri/src/system_menu.rs", "utf8");
const systemMenuBridgeSource = fs.readFileSync("src/app/systemFileMenu.ts", "utf8");
const titleBarSource = fs.readFileSync("src/app/TitleBar.tsx", "utf8");
const fileViewerSource = fs.readFileSync(
  "src/modules/workspace/connections/file-viewer/fileViewerModel.ts",
  "utf8",
);
const nsisHooks = fs.readFileSync("src-tauri/windows/nsis-hooks.nsh", "utf8");
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
const macosTauriConfig = JSON.parse(
  fs.readFileSync("src-tauri/tauri.macos.conf.json", "utf8"),
);
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
  assert.match(
    libSource,
    /tauri::RunEvent::Opened \{ urls \}[\s\S]*?enqueue_opened_urls\(app, urls\)/,
  );
  assert.match(rustSource, /url\.scheme\(\) == "file"/);
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

test("macOS and Linux system File menus enqueue file selections through the ephemeral path flow", () => {
  assert.match(systemMenuSource, /target_os = "macos"[\s\S]*?target_os = "linux"/);
  assert.match(systemMenuSource, /OPEN_ITEM_ID => crate::launch_paths::open_file_picker\(app\)/);
  assert.doesNotMatch(systemMenuSource, /OPEN_FOLDER|pick_folder/);
  assert.match(rustSource, /pub fn open_file_picker[\s\S]*?picker\.pick_file/);
  assert.doesNotMatch(rustSource, /pick_folder/);
  assert.match(rustSource, /enqueue_selected_path\(&app_handle, path\)/);
  assert.match(libSource, /system_menu::install_handler\(app\)/);
  assert.match(libSource, /update_system_file_menu/);
  assert.match(systemMenuBridgeSource, /platform !== "macos" && platform !== "linux"/);
  assert.match(systemMenuBridgeSource, /invokeCommand\("update_system_file_menu"/);
  assert.match(appSource, /pushSystemFileMenu\(\{[\s\S]*?open: t\("app\.openFile"\)/);
});

test("Windows uses one subtle direct file-picker entry point for each tab-navigation mode", () => {
  assert.match(canvasSource, /isWindowsPlatform\(\)[\s\S]*?className="tab-open-path-button"/);
  assert.match(canvasSource, /invokeCommand\("open_launch_file_picker", undefined\)/);
  assert.match(canvasSource, /<Plus size=\{15\}/);
  assert.match(
    titleBarSource,
    /activePage === "workspace" && showWorkspaceOpenMenu && isWindowsPlatform\(\)/,
  );
  assert.match(titleBarSource, /className="app-titlebar-open-path-button"/);
  assert.match(titleBarSource, /invokeCommand\("open_launch_file_picker", undefined\)/);
  assert.doesNotMatch(titleBarSource, /showNativeContextMenu|openFolder/);
  assert.match(appSource, /showWorkspaceOpenMenu=\{hideTopTabButtons\}/);
  assert.match(appSource, /hideTopTabButtons \? null : <TabStrip \/>/);
  assert.match(libSource, /fn open_launch_file_picker[\s\S]*?launch_paths::open_file_picker/);
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

test("platform bundles add every recognized extension to Open With without claiming defaults", () => {
  const extractSet = (name) => {
    const match = fileViewerSource.match(
      new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`),
    );
    assert.ok(match, `${name} must remain discoverable by the installer coverage test`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  };
  const extensionlessNames = new Set(["gitignore", "dockerfile", "makefile"]);
  const expected = new Set([
    ...extractSet("IMAGE_EXTENSIONS"),
    ...extractSet("MARKDOWN_EXTENSIONS"),
    ...extractSet("CSV_EXTENSIONS"),
    ...extractSet("JSON_EXTENSIONS"),
    ...extractSet("LOG_EXTENSIONS"),
    ...extractSet("TEXT_EXTENSIONS").filter((ext) => !extensionlessNames.has(ext)),
    "pdf",
  ]);
  const registered = new Set(
    [...nsisHooks.matchAll(/!insertmacro \$\{ACTION\} "([^"]+)"/g)].map(
      (entry) => entry[1],
    ),
  );

  assert.deepEqual([...registered].sort(), [...expected].sort());
  const macosAssociations = macosTauriConfig.bundle.fileAssociations;
  const macosExtensions = new Set(
    macosAssociations.flatMap((association) => association.ext),
  );
  assert.deepEqual([...macosExtensions].sort(), [...expected].sort());
  assert.ok(
    macosAssociations.every(
      (association) => association.rank === "Alternate" && association.role === "Editor",
    ),
  );
  assert.equal(tauriConfig.bundle.fileAssociations, undefined);
  assert.equal(
    tauriConfig.bundle.windows.nsis.installerHooks,
    "windows/nsis-hooks.nsh",
  );
  assert.match(nsisHooks, /Software\\Classes\\\.\$\{EXT\}\\OpenWithProgids/);
  assert.match(nsisHooks, /AllowSilentDefaultTakeOver/);
  assert.doesNotMatch(
    nsisHooks,
    /WriteRegStr SHCTX "Software\\Classes\\\.\$\{EXT\}" ""/,
  );
  assert.match(smokeInstaller, /Assert-OpenWithRegistration/);
  assert.match(smokeInstaller, /Assert-DefaultAssociationUnchanged/);
});

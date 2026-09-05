import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("src/modules/screenshots/ScreenshotsPage.tsx", "utf8");
const editor = fs.readFileSync("src/modules/screenshots/VideoEditor.tsx", "utf8");
const screenshotStyles = fs.readFileSync("src/modules/screenshots/screenshots.css", "utf8");
const backend = fs.readFileSync("src-tauri/src/video_recording.rs", "utf8");
const screenshotBackend = fs.readFileSync("src-tauri/src/screenshot.rs", "utf8");
const controls = fs.readFileSync("src/modules/screenshots/VideoRecordingControlsWindow.tsx", "utf8");
const controlsStyles = fs.readFileSync("src/modules/screenshots/videoRecordingControls.css", "utf8");
const dock = fs.readFileSync("src/modules/screenshots/VideoRecordingDock.tsx", "utf8");
const dockStyles = fs.readFileSync("src/modules/screenshots/videoRecordingDock.css", "utf8");
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const tauriConf = fs.readFileSync("src-tauri/tauri.conf.json", "utf8");
const library = fs.readFileSync("src/modules/screenshots/LibraryView.tsx", "utf8");
const commandRegistry = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const storage = fs.readFileSync("src-tauri/src/storage.rs", "utf8");
const catalog = fs.readFileSync("installer/catalog.v1.json", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("the detached recording controller can query and control the recorder through its own ACL", () => {
  const label = backend.match(/const CONTROLS_WINDOW_LABEL: &str = "([^"]+)"/)?.[1];
  assert.ok(label);
  const capabilities = fs.readdirSync("src-tauri/capabilities")
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(fs.readFileSync(`src-tauri/capabilities/${file}`, "utf8")))
    .filter((capability) => capability.windows?.includes(label));
  assert.ok(capabilities.length, `${label} needs its own capability`);
  const grants = capabilities.flatMap((capability) => capability.permissions);
  assert.ok(grants.includes("core:window:allow-start-dragging"));
  assert.ok(!grants.includes("main-commands"), "the controller must not inherit all main-window commands");
  const permissions = fs.readdirSync("src-tauri/permissions")
    .filter((file) => file.endsWith(".toml"))
    .flatMap((file) => fs.readFileSync(`src-tauri/permissions/${file}`, "utf8").split("[[permission]]"));
  const allowed = permissions.filter((permission) =>
    grants.includes(permission.match(/identifier\s*=\s*"([^"]+)"/)?.[1]))
    .flatMap((permission) => [...(permission.match(/commands\.allow\s*=\s*\[([^\]]*)\]/s)?.[1] ?? "")
      .matchAll(/"([^"]+)"/g)].map((match) => match[1]));
  const commands = [...controls.matchAll(/"((?:video_recording_status|(?:pause|resume|stop)_video_recording))"/g)]
    .map((match) => match[1]);
  assert.equal(new Set(commands).size, 4);
  for (const command of commands) assert.ok(allowed.includes(command), `${label} cannot invoke ${command}`);
});

test("Screenshots places Image/Video immediately after capture delay", () => {
  const delay = page.indexOf('title={t("screenshots.delay.label")}');
  const media = page.indexOf('title={t("screenshots.mediaType")}');
  const windowButton = page.indexOf('data-tutorial-id="screenshots.captureWindow"');
  assert.ok(delay >= 0 && media > delay && windowButton > media);
});

test("video editor uses the requested timeline package and non-destructive export", () => {
  assert.equal(packageJson.dependencies["@xzdarcy/react-timeline-editor"], "^1.0.0");
  assert.match(page, /lazy\(\(\) => import\("\.\/VideoEditor"\)/);
  assert.match(editor, /import \{ Timeline, type TimelineState \} from "@xzdarcy\/react-timeline-editor"/);
  assert.match(editor, /trim_video_recording/);
  assert.match(backend, /-trimmed-\{\}/);
});

test("video editor exposes synchronized playback and a full-width fitted timeline", () => {
  assert.match(editor, /togglePlayback/);
  assert.match(editor, /timelineRef\.current\?\.setTime/);
  assert.match(editor, /videoTimelineLayout\(duration, timelineWidth\)/);
  assert.match(editor, /backFiveSeconds/);
  assert.match(editor, /forwardFiveSeconds/);
  assert.match(screenshotStyles, /\.video-editor__timeline \.timeline-editor \{[^}]*width: 100%/s);
});

test("video editor contains the complete recording frame without clipping", () => {
  assert.match(
    screenshotStyles,
    /\.video-editor__preview\s*\{[^}]*position:\s*relative;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/s,
  );
  assert.match(
    screenshotStyles,
    /\.video-editor__preview video,\s*\.video-editor__preview img\s*\{[^}]*position:\s*absolute;\s*\n\s*inset:\s*0;[^}]*\n\s*width:\s*100%;\s*\n\s*height:\s*100%;\s*\n\s*object-fit:\s*contain;/s,
  );
});

test("video editor disables text selection so trim drags stay interactive", () => {
  assert.match(screenshotStyles, /\.video-editor \{[^}]*user-select: none/s);
});

test("video capture remains an on-demand FFmpeg dependency", () => {
  assert.match(commandRegistry, /video_dependency_status/);
  assert.match(commandRegistry, /start_video_recording/);
  assert.match(commandRegistry, /stop_video_recording/);
  assert.match(storage, /fn default_video_format\(\).*?"mp4"/s);
  assert.match(catalog, /"assetPattern": "ffmpeg-\*-essentials_build\.zip"/);
  assert.doesNotMatch(JSON.stringify(packageJson.dependencies), /ffmpeg/i);
});

test("recording controls are a protected compact overlay anchored to the capture target", () => {
  assert.match(backend, /WebviewWindowBuilder::new/);
  assert.match(backend, /set_content_protected\(true\)/);
  assert.match(backend, /\.inner_size\(CONTROLS_WIDTH as f64, CONTROLS_HEIGHT as f64\)/);
  assert.match(backend, /\.transparent\(true\)/);
  assert.match(backend, /fn controls_position\([\s\S]*?target\.x \+ \(target\.width - CONTROLS_WIDTH\) \/ 2[\s\S]*?target\.y \+ CONTROLS_TARGET_INSET/);
  assert.match(commandRegistry, /pause_video_recording/);
  assert.match(commandRegistry, /resume_video_recording/);
  assert.match(controls, /video_recording_status/);
  assert.match(controls, /stop_video_recording/);
  assert.match(controls, /GripVertical/);
  assert.match(controls, /Pause/);
  assert.match(controlsStyles, /backdrop-filter:\s*blur\(16px\)/);
  assert.doesNotMatch(controls, /<img|previewDataUrl|video-recording-controls__target/);
  assert.doesNotMatch(backend, /preview_data_url/);
  assert.ok(
    backend.indexOf("drop(active);") < backend.indexOf("show_controls_window(app, target)"),
    "recording state must be unlocked before the controls WebView requests status",
  );
});

test("the detached recording controls window is excluded from macOS builds", () => {
  assert.match(backend, /#\[cfg\(not\(target_os = "macos"\)\)\]\s*const CONTROLS_WINDOW_LABEL/);
  assert.match(backend, /#\[cfg\(not\(target_os = "macos"\)\)\]\s*fn show_controls_window/);
  assert.match(backend, /#\[cfg\(not\(target_os = "macos"\)\)\]\s*fn close_controls_window/);
  assert.match(backend, /#\[cfg\(not\(target_os = "macos"\)\)\][\s\S]*?struct RecordingTarget/);
  assert.match(backend, /#\[cfg\(not\(target_os = "macos"\)\)\]\s*\#\[test\]/);
});

test("macOS recording controls live in the main window dock", () => {
  assert.match(dock, /isMacPlatform\(\)/);
  assert.match(dock, /VIDEO_RECORDING_STARTED_EVENT/);
  assert.match(dock, /VIDEO_RECORDING_COMPLETED_EVENT/);
  assert.match(dock, /video_recording_status/);
  assert.match(dock, /pause_video_recording/);
  assert.match(dock, /resume_video_recording/);
  assert.match(dock, /stop_video_recording/);
  assert.match(dock, /screenshots\.video\.pause|screenshots\.video\.resume|screenshots\.video\.stop/);
  assert.doesNotMatch(dock, /<img|video-recording-controls/);
  assert.match(dockStyles, /position:\s*fixed/);
  assert.match(dockStyles, /backdrop-filter:\s*blur\(16px\)/);
});

test("recording start broadcasts a started event for the dock", () => {
  assert.match(backend, /RECORDING_STARTED_EVENT/);
  const command = commandRegistry.match(
    /#\[tauri::command\]\s+async fn start_video_recording\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(command, "start_video_recording must be an async Tauri command");
  assert.match(command, /app\.emit\([\s\S]*?RECORDING_STARTED_EVENT/);
});

test("the macOS build does not use private APIs", () => {
  assert.doesNotMatch(cargoToml, /macos-private-api/);
  assert.doesNotMatch(tauriConf, /macOSPrivateApi/);
});

test("video recording starts outside the synchronous WebView IPC handler", () => {
  const command = commandRegistry.match(
    /#\[tauri::command\]\s+async fn start_video_recording\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(command, "start_video_recording must be an async Tauri command");
  assert.match(command, /run_blocking_command/);
  assert.match(command, /video_recording::start/);
});

test("recorded videos are discoverable library items with format badges", () => {
  assert.match(screenshotBackend, /"mp4" \| "webm"/);
  assert.match(screenshotBackend, /write_video_thumbnail/);
  assert.match(screenshotBackend, /media_type: media_type\.to_string\(\)/);
  assert.match(library, /screenshots-media-badge/);
  assert.match(page, /libraryViewer\?\.mediaType === "video"/);
});

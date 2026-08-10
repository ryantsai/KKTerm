import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("src/modules/screenshots/ScreenshotsPage.tsx", "utf8");
const editor = fs.readFileSync("src/modules/screenshots/VideoEditor.tsx", "utf8");
const screenshotStyles = fs.readFileSync("src/modules/screenshots/screenshots.css", "utf8");
const backend = fs.readFileSync("src-tauri/src/video_recording.rs", "utf8");
const screenshotBackend = fs.readFileSync("src-tauri/src/screenshot.rs", "utf8");
const controls = fs.readFileSync("src/modules/screenshots/VideoRecordingControlsWindow.tsx", "utf8");
const library = fs.readFileSync("src/modules/screenshots/LibraryView.tsx", "utf8");
const commandRegistry = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const storage = fs.readFileSync("src-tauri/src/storage.rs", "utf8");
const catalog = fs.readFileSync("installer/catalog.v1.json", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

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

test("recording controls reuse a protected Tauri window and expose pause and stop", () => {
  assert.match(backend, /WebviewWindowBuilder::new/);
  assert.match(backend, /set_content_protected\(true\)/);
  assert.match(commandRegistry, /pause_video_recording/);
  assert.match(commandRegistry, /resume_video_recording/);
  assert.match(controls, /video_recording_status/);
  assert.match(controls, /stop_video_recording/);
  assert.ok(
    backend.indexOf("drop(active);") < backend.indexOf("show_controls_window(app)"),
    "recording state must be unlocked before the controls WebView requests status",
  );
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Screenshots Module exposes only thumbnail and details views", async () => {
  const [page, library, styles] = await Promise.all([
    read("src/modules/screenshots/ScreenshotsPage.tsx"),
    read("src/modules/screenshots/LibraryView.tsx"),
    read("src/modules/screenshots/screenshots.css"),
  ]);

  assert.match(library, /ScreenshotsViewMode = "thumbnails" \| "details"/);
  assert.doesNotMatch(page, /changeViewMode\("list"\)/);
  assert.doesNotMatch(page, /screenshots\.clearAll/);
  assert.match(page, /screenshots\.sort\.label/);
  assert.match(page, /screenshots\.group\.label/);
  assert.match(page, /return \{ by: "date", direction: "desc" \}/);
  assert.match(page, /\? value\s*:\s*"date"/);
  assert.match(page, /persist\(SORT_STORAGE_KEY/);
  assert.match(page, /persist\(GROUP_STORAGE_KEY/);
  assert.doesNotMatch(styles, /screenshots-header-toolbar select:focus-visible[\s\S]*?var\(--accent\)/);
  assert.match(styles, /screenshots-toolbar-select option:checked/);
});

test("capture delay and selection-based batch actions stay connected", async () => {
  const [page, bridge, state, tauri] = await Promise.all([
    read("src/modules/screenshots/ScreenshotsPage.tsx"),
    read("src/modules/screenshots/captureBridge.ts"),
    read("src/modules/screenshots/state.ts"),
    read("src/lib/tauri.ts"),
  ]);

  assert.match(page, /CAPTURE_DELAYS = \[0, 3, 5, 15, 30, 60\]/);
  assert.match(page, /performScreenshotCapture\(mode, t, captureDelay, true\)/);
  assert.match(bridge, /minimizeWindow = false/);
  assert.match(bridge, /performScreenshotCapture\(event\.payload, tRef\.current\)/);
  assert.match(tauri, /minimizeWindow: boolean/);
  assert.match(bridge, /delaySeconds \* 1000/);
  assert.match(state, /refreshGeneration/);
  assert.match(state, /generation !== refreshGeneration/);
  assert.match(page, /delete_screenshots/);
  assert.match(page, /ResizeScreenshotsDialog/);
  assert.match(page, /ConvertScreenshotsDialog/);
  assert.match(tauri, /resize_screenshots:/);
  assert.match(tauri, /convert_screenshots:/);
  assert.match(tauri, /save_edited_screenshot:/);
});

test("unified screenshot dialog follows the Sheet contract and bounds image zoom", async () => {
  const [editor, page, styles, backend, bridge] = await Promise.all([
    read("src/modules/screenshots/ScreenshotEditor.tsx"),
    read("src/modules/screenshots/ScreenshotsPage.tsx"),
    read("src/modules/screenshots/screenshots.css"),
    read("src-tauri/src/screenshot.rs"),
    read("src/lib/tauri.ts"),
  ]);

  for (const tool of ["pan", "select", "pencil", "arrow", "rectangle", "ellipse", "text", "mosaic", "crop"]) {
    assert.match(editor, new RegExp(`id: "${tool}"`));
  }
  assert.match(editor, /id: "pan", icon: Hand[\s\S]*?id: "select", icon: MousePointer2[\s\S]*?id: "pencil", icon: Pencil[\s\S]*?id: "arrow"/);
  assert.match(editor, /id: "mosaic", icon: Grid2x2[\s\S]*?id: "crop", icon: Crop/);
  assert.match(editor, /type FreehandAnnotation = [\s\S]*?kind: "pencil"[\s\S]*?points: Point\[\]/);
  assert.match(editor, /type EditorSnapshot = \{ annotations: Annotation\[\]; cropRect: Rect \| null \}/);
  assert.match(editor, /function drawFreehand\(/);
  assert.match(editor, /tool === "pencil"[\s\S]*?freehandRef\.current/);
  assert.match(editor, /function applyCrop\(/);
  assert.match(editor, /cropRectRef\.current/);
  assert.match(editor, /tool === "crop" \? " is-crop"/);
  assert.match(editor, /onPointerDown=\{cropPointerDown\}/);
  assert.match(editor, /onPointerMove=\{cropPointerMove\}/);
  assert.match(editor, /cropImagePlacement\(source, base\.width, base\.height\)/);
  assert.match(editor, /stage\.scrollLeft = pan\.scrollLeft/);
  assert.match(editor, /stage\.scrollTop = pan\.scrollTop/);
  assert.match(editor, /<Sheet/);
  assert.match(editor, /<Actions/);
  assert.match(editor, /ZOOM_STEPS = \[25, 50, 75, 100, 125, 150, 200\]/);
  assert.match(editor, /setZoom\("fit"\)/);
  assert.match(editor, /screenshots-editor__canvas-wrap/);
  assert.match(editor, /hasPrevious/);
  assert.doesNotMatch(page, /ScreenshotViewer/);
  assert.doesNotMatch(page, /editorTarget/);
  assert.match(editor, /save_edited_screenshot/);
  assert.match(editor, /unique|toDataURL\("image\/png"\)/);
  assert.match(editor, /window\.innerWidth \* 0\.8/);
  assert.match(editor, /screenshots-editor__resizer/);
  assert.match(editor, /<ColorPalettePicker/);
  assert.doesNotMatch(editor, /className="screenshots-editor__optionsbar"/);
  assert.match(editor, /EDITOR_TOOLS\.map[\s\S]*?screenshots-editor__divider[\s\S]*?screenshots-editor__swatches/);
  assert.match(editor, /if \(tool === "text"\) \{\s*event\.preventDefault\(\);[\s\S]*?startTextDraft\(point\)/);
  assert.doesNotMatch(editor, /zoom === "fit" \? t\("workspace\.fileViewer\.fit"\)/);
  assert.match(editor, /screenshots\.editor\.unsavedTitle/);
  assert.match(editor, /zClassName="kk-qc-subdialog"/);
  assert.match(editor, /<DialogShell>/);
  assert.doesNotMatch(editor, /<DialogShell\s+onBackdrop=/);
  assert.match(editor, /workspaceRef\.current\?\.focus\(\)/);
  assert.match(editor, /ref=\{workspaceRef\}[\s\S]*?className="screenshots-editor__workspace"[\s\S]*?tabIndex=\{-1\}/);
  assert.match(editor, /onKeyDown=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*if \(event\.key === "Escape"\)/);
  assert.match(editor, /if \(event\.key === "Escape" && !saving\) \{\s*event\.preventDefault\(\);\s*requestClose\(\);/);
  assert.doesNotMatch(editor, /if \(selectedId !== null\) \{\s*setSelectedId\(null\);/);
  assert.match(editor, /onClose=\{requestClose\}/);
  assert.match(editor, /type PendingEditorAction = "close" \| -1 \| 1/);
  assert.match(editor, /function requestNavigation\(direction: -1 \| 1\)/);
  assert.doesNotMatch(editor, /disabled=\{!hasPrevious \|\| dirty \|\| saving\}/);
  assert.doesNotMatch(editor, /disabled=\{!hasNext \|\| dirty \|\| saving\}/);
  assert.match(editor, /onCancel=\{\(\) => setPendingAction\(null\)\}/);
  assert.match(page, /setViewerId\(navigationTarget\?\.id \?\? saved\.id\)/);
  assert.match(styles, /screenshots-editor__canvas-wrap \{[\s\S]*?box-sizing: border-box/);
  assert.match(styles, /screenshots-editor__footer-meta[\s\S]*left: 50%/);
  assert.match(styles, /screenshots-editor \.kk-dlg-title \{[\s\S]*?text-align: center/);
  assert.match(editor, /fitImageDimensions/);
  assert.match(editor, /screenshots-editor__stage\$\{zoom === "fit" \? " is-fit" : ""\}/);
  assert.match(styles, /screenshots-editor__stage\.is-fit \{[\s\S]*?overflow: hidden/);
  assert.match(editor, /<Floppy size=\{15\}/);
  assert.match(editor, /MultipleFloppy/);
  assert.match(page, /write_screenshot_data_url_to_clipboard/);
  assert.match(editor, /screenshots\.editor\.saveAs/);
  assert.match(editor, /void save\(\)/);
  assert.match(editor, /selectScreenshotSavePath/);
  assert.match(editor, /writeDataUrlFile/);
  assert.match(editor, /toDataURL\("image\/jpeg", 0\.9\)/);
  assert.match(editor, /void saveAs\(\)/);
  assert.match(editor, /saveAsCopy: false/);
  assert.match(bridge, /function selectScreenshotSavePath[\s\S]*extensions: \["png"\][\s\S]*extensions: \["jpg", "jpeg"\]/);
  assert.match(backend, /if request\.save_as_copy/);
});

test("macOS and Linux screenshot delivery use xcap-backed images and native image clipboard support", async () => {
  const [backend, cargo] = await Promise.all([
    read("src-tauri/src/screenshot.rs"),
    read("src-tauri/Cargo.toml"),
  ]);

  assert.doesNotMatch(backend, /screenshot capture is currently available on Windows/);
  assert.doesNotMatch(backend, /screenshot clipboard is currently available on Windows/);
  assert.match(backend, /capture_fullscreen_to_library[\s\S]*capture_engine::capture_virtual_screen/);
  assert.match(backend, /capture_focused_window_image/);
  assert.match(backend, /capture_macos_selection/);
  assert.match(backend, /capture_linux_region_selection/);
  assert.match(backend, /org\.freedesktop\.portal\.Screenshot/);
  assert.match(backend, /"interactive", Value::from\(true\)/);
  assert.match(backend, /arboard::ImageData/);
  assert.match(cargo, /arboard = \{ version = "3\.6\.1"/);
});

test("Windows native screenshot selection paints dimmed frames atomically", async () => {
  const backend = await read("src-tauri/src/screenshot.rs");

  assert.match(backend, /BeginBufferedPaint/);
  assert.match(backend, /EndBufferedPaint/);
  assert.match(backend, /AlphaBlend/);
  assert.match(backend, /SourceConstantAlpha: SCREENSHOT_DIM_ALPHA/);
  assert.match(backend, /if overlay\.hover != next_hover/);
});

test("screenshot batch actions use unified open, flexible resize, and four output formats", async () => {
  const page = await read("src/modules/screenshots/ScreenshotsPage.tsx");
  const dialogs = await read("src/modules/screenshots/ScreenshotBatchDialogs.tsx");
  const backend = await read("src-tauri/src/screenshot.rs");
  const cargo = await read("src-tauri/Cargo.toml");

  assert.doesNotMatch(page, /label: t\("common\.edit"\)/);
  assert.match(dialogs, /type ResizeMode = "exact" \| "percentage"/);
  assert.match(dialogs, /parseOptionalDimension/);
  assert.match(dialogs, /\{ value: "webp", label: "WebP" \}/);
  assert.match(dialogs, /\{ value: "gif", label: "GIF" \}/);
  assert.match(backend, /resolve_resize_dimensions/);
  assert.match(backend, /webp::Encoder::from_rgba/);
  assert.match(backend, /GifEncoder::new_with_speed/);
  assert.match(cargo, /webp = \{ version = "=0\.3\.1", default-features = false \}/);
});

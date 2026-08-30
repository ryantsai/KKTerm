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
  const [page, delay, bridge, state, tauri, shortcuts, tray] = await Promise.all([
    read("src/modules/screenshots/ScreenshotsPage.tsx"),
    read("src/modules/screenshots/captureDelay.ts"),
    read("src/modules/screenshots/captureBridge.ts"),
    read("src/modules/screenshots/state.ts"),
    read("src/lib/tauri.ts"),
    read("src-tauri/src/screenshot_shortcuts.rs"),
    read("src-tauri/src/app_tray.rs"),
  ]);

  assert.match(delay, /CAPTURE_DELAYS = \[0, 3, 5, 15, 30, 60\]/);
  assert.match(page, /performScreenshotCapture\(mode, t, captureDelay, true\)/);
  assert.match(bridge, /minimizeWindow = false/);
  assert.match(bridge, /listen<ScreenshotCaptureRequest>/);
  assert.match(bridge, /event\.payload\.source === "shortcut"/);
  assert.match(bridge, /readCaptureDelay\(\)/);
  assert.match(shortcuts, /emit_capture_request\(app, mode, "shortcut"\)/);
  assert.match(tray, /emit_tray_capture/);
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

test("screenshot library drags original files and uses compatible native image clipboards", async () => {
  const [page, library, drag, tauri, backend, cargo, capability, appBackend] = await Promise.all([
    read("src/modules/screenshots/ScreenshotsPage.tsx"),
    read("src/modules/screenshots/LibraryView.tsx"),
    read("src/modules/screenshots/nativeScreenshotDrag.ts"),
    read("src/lib/tauri.ts"),
    read("src-tauri/src/screenshot.rs"),
    read("src-tauri/Cargo.toml"),
    read("src-tauri/capabilities/default.json"),
    read("src-tauri/src/lib.rs"),
  ]);

  assert.match(library, /onItemDragStart/);
  assert.equal((library.match(/event\.preventDefault\(\);\s*onItemDragStart\(screenshot\)/g) ?? []).length, 2);
  assert.equal((library.match(/draggable=\{false\}/g) ?? []).length, 2);
  assert.match(page, /screenshotDragItems\(screenshots, screenshot, selectedIds\)/);
  assert.match(page, /startScreenshotDrag\(items, screenshot\)/);
  assert.match(drag, /selectedIds\.has\(lead\.id\)/);
  assert.match(drag, /screenshots\.filter\(\(screenshot\) => selectedIds\.has\(screenshot\.id\)\)/);
  assert.match(drag, /item: items\.map\(\(item\) => item\.path\)/);
  assert.match(drag, /mode: "copy"/);
  assert.match(drag, /lead\.thumbnailPath/);
  assert.match(tauri, /thumbnailPath: string \| null/);
  assert.match(backend, /thumbnail_path: Option<String>/);
  assert.match(backend, /arboard::ImageData/);
  assert.doesNotMatch(backend, /SetClipboardData\(CF_DIB/);
  assert.match(cargo, /arboard = \{ version = "3\.6\.1"/);
  assert.match(cargo, /tauri-plugin-drag = "2\.1\.1"/);
  assert.match(capability, /"drag:default"/);
  assert.match(appBackend, /plugin\(tauri_plugin_drag::init\(\)\)/);
});

test("unified screenshot dialog follows the Sheet contract and bounds image zoom", async () => {
  const [editor, page, styles, backend, bridge, saveAsIcon] = await Promise.all([
    read("src/modules/screenshots/ScreenshotEditor.tsx"),
    read("src/modules/screenshots/ScreenshotsPage.tsx"),
    read("src/modules/screenshots/screenshots.css"),
    read("src-tauri/src/screenshot.rs"),
    read("src/lib/tauri.ts"),
    read("src/app/ui/SaveAsIcon.tsx"),
  ]);

  for (const tool of ["pan", "select", "pencil", "arrow", "rectangle", "ellipse", "text", "mosaic", "crop"]) {
    assert.match(editor, new RegExp(`id: "${tool}"`));
  }
  assert.match(editor, /id: "pan", icon: Hand[\s\S]*?id: "select", icon: MousePointer2[\s\S]*?id: "pencil", icon: Pencil[\s\S]*?id: "arrow"/);
  assert.match(editor, /id: "mosaic", icon: Grid2x2[\s\S]*?id: "crop", icon: Crop/);
  assert.match(editor, /type FreehandAnnotation = [\s\S]*?kind: "pencil"[\s\S]*?points: Point\[\]/);
  assert.match(editor, /type EditorSnapshot = \{ annotations: Annotation\[\]; cropRect: Rect \| null \}/);
  assert.match(editor, /function drawFreehand\(/);
  assert.match(editor, /const COPY_OFFSET_CSS_PX = 12/);
  assert.match(editor, /function copyAnnotation\(annotation: Annotation, canvas: HTMLCanvasElement\)/);
  assert.match(editor, /translateAnnotation\(annotation, offset, offset\)/);
  assert.match(editor, /applyAnnotations\(\[\.\.\.before, copy\]\)/);
  assert.match(editor, /setSelectedId\(copy\.id\)/);
  assert.match(editor, /screenshots\.editor\.copyElement/);
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
  assert.match(editor, /<SaveAsIcon \/>/);
  assert.equal(saveAsIcon.match(/<Floppy/g)?.length, 2);
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

test("screenshot editor drafts persist layers and gate capture-driven switching", async () => {
  const [editor, page, library, state, backend, tauri] = await Promise.all([
    read("src/modules/screenshots/ScreenshotEditor.tsx"),
    read("src/modules/screenshots/ScreenshotsPage.tsx"),
    read("src/modules/screenshots/LibraryView.tsx"),
    read("src/modules/screenshots/state.ts"),
    read("src-tauri/src/screenshot.rs"),
    read("src/lib/tauri.ts"),
  ]);

  assert.match(editor, /type ScreenshotEditorDraft = \{[\s\S]*?annotations: Annotation\[\][\s\S]*?cropRect: Rect \| null/);
  assert.match(editor, /Promise\.all\(\[[\s\S]*?read_screenshot[\s\S]*?read_screenshot_draft/);
  assert.match(editor, /DRAFT_AUTOSAVE_DELAY_MS/);
  assert.match(editor, /save_screenshot_draft/);
  assert.match(editor, /delete_screenshot_draft/);
  assert.match(editor, /persistDraftNow\(\)[\s\S]*?onRequestedScreenshotReady/);
  assert.match(page, /pendingEditorRequestId/);
  assert.match(page, /viewerId && viewerId !== editorRequestId/);
  assert.match(
    page,
    /requestedScreenshotId=\{ephemeralViewer \? null : pendingEditorRequestId\}/,
  );
  assert.match(state, /setDraftState/);
  assert.match(library, /screenshot\.hasDraft[\s\S]*?screenshots\.draft/);
  assert.match(backend, /const DRAFTS_DIR_NAME: &str = "\.kkterm-drafts"/);
  assert.match(backend, /remove_draft_for\(&folder, &request\.id\)/);
  assert.match(tauri, /read_screenshot_draft:/);
  assert.match(tauri, /save_screenshot_draft:/);
  assert.match(tauri, /delete_screenshot_draft:/);
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

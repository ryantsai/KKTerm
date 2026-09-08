import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("routine PNG encoding does not run the optional optimizer", async () => {
  const source = await read("src-tauri/src/screenshot.rs");
  const encoder = source.slice(source.indexOf("fn encode_png("), source.indexOf("fn output_extension("));
  assert.match(encoder, /CompressionType::Fast, FilterType::Adaptive/);
  assert.doesNotMatch(encoder, /oxipng|CompressionType::Best/);
  assert.doesNotMatch(source, /encode_optimized_png/);
});

test("explicit PNG optimization is authorized and does not hold the capture lock", async () => {
  const [source, permissions, page, api] = await Promise.all([
    read("src-tauri/src/lib.rs"),
    read("src-tauri/permissions/main.toml"),
    read("src/modules/screenshots/ScreenshotsPage.tsx"),
    read("src/lib/tauri.ts"),
  ]);
  const start = source.indexOf("async fn optimize_screenshot_png(");
  assert.notEqual(start, -1);
  const command = source.slice(start, source.indexOf("\n#[tauri::command]", start));
  assert.match(command, /run_blocking_command\(/);
  assert.doesNotMatch(command, /run_blocking_screenshot_command/);
  assert.match(permissions, /"optimize_screenshot_png"/);
  assert.match(api, /optimize_screenshot_png:/);
  assert.match(page, /canOptimizePngs\(targets\)/);
  assert.match(page, /invokeCommand\("optimize_screenshot_png"/);
  assert.match(page, /optimizePngs\(targets, false\)/);
  assert.match(page, /optimizePngs\(targets, true\)/);
  assert.match(page, /replace\(target\.id, updated\)/);
  assert.match(page, /prepend\(updated\)/);
});

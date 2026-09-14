import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("macOS screenshot clipboard writes run on the AppKit main thread with a bounded wait", async () => {
  const [source, architecture] = await Promise.all([
    readFile(new URL("../src-tauri/src/screenshot.rs", import.meta.url), "utf8"),
    readFile(new URL("../docs/ARCHITECTURE.md", import.meta.url), "utf8"),
  ]);
  const helperStart = source.indexOf("fn write_rgba_to_clipboard(");
  const helperEnd = source.indexOf("fn save_rgba_to_library(", helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  assert.match(helper, /#\[cfg\(target_os = "macos"\)\][\s\S]*?app\.run_on_main_thread/);
  assert.match(helper, /recv_timeout\(std::time::Duration::from_secs\(10\)\)/);
  assert.match(helper, /#\[cfg\(not\(target_os = "macos"\)\)\][\s\S]*?write_rgba_to_clipboard_now/);
  assert.match(architecture, /image clipboard publication is dispatched to the AppKit main thread/);
});

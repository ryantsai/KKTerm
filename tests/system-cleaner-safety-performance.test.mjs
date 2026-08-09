import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backend = await readFile(new URL("../src-tauri/src/system_cleaner.rs", import.meta.url), "utf8");
const backendCommands = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const page = await readFile(new URL("../src/modules/system-cleaner/SystemCleanerPage.tsx", import.meta.url), "utf8");
const scanState = await readFile(new URL("../src/modules/system-cleaner/scanState.ts", import.meta.url), "utf8").catch(() => "");
const styles = await readFile(new URL("../src/modules/system-cleaner/systemCleaner.css", import.meta.url), "utf8");
const statusBar = await readFile(new URL("../src/modules/workspace/StatusBar.tsx", import.meta.url), "utf8");
const tauri = await readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");
const manual = await readFile(new URL("../docs/manual/20-system-cleaner.md", import.meta.url), "utf8");

test("System Cleaner sources do not contain unresolved merge conflicts", () => {
  for (const source of [page, styles, manual]) {
    assert.doesNotMatch(source, /^(?:<<<<<<<|=======|>>>>>>>)/m);
  }
});

test("System Cleaner scans the drive once off the UI thread and streams progress", () => {
  assert.match(backend, /spawn_blocking/);
  assert.match(backend, /rayon::join/);
  assert.match(backend, /fn scan_drive/);
  assert.match(backend, /system-cleaner:\/\/scan-progress/);
  assert.match(page, /listen<SystemCleanerScanProgress>/);
});

test("System Cleaner keeps scan paths from widening the page", () => {
  assert.match(page, /system-cleaner-scan-path/);
  assert.match(styles, /\.system-cleaner-scan-path\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
});

test("System Cleaner uses the Solving orb in the scan page and Status Bar", () => {
  assert.match(page, /<SystemCleanerScanOrb size=\{64\}/);
  assert.match(statusBar, /<SystemCleanerScanOrb size=\{20\}/);
  assert.match(statusBar, /useSystemCleanerScanStore/);
  assert.match(scanState, /active:\s*boolean/);
});

test("System Cleaner retains one-pass directory totals for browsable results", () => {
  assert.match(backend, /fn scan_tree/);
  assert.match(backend, /directory_bytes/);
  assert.match(backend, /system_cleaner_list_directory/);
  assert.match(backendCommands, /system_cleaner::system_cleaner_list_directory/);
  assert.match(tauri, /system_cleaner_list_directory/);
  assert.match(page, /openDirectory/);
  assert.match(page, /onDoubleClick/);
});

test("System Cleaner opens idle and scans only on explicit demand", () => {
  assert.match(page, /onClick=\{\(\) => void scan\(\)\}/);
  assert.match(page, /systemCleaner\.scanHint/);
});

test("System Cleaner walks directories iteratively without following reparse points", () => {
  assert.match(backend, /let mut pending = vec!\[path\.to_path_buf\(\)\]/);
  assert.match(backend, /while let Some\(directory\) = pending\.pop\(\)/);
  assert.match(backend, /FILE_ATTRIBUTE_REPARSE_POINT/);
  assert.doesNotMatch(backend, /directory_size\(&entry\.path\(\)\)/);
});

test("System Cleaner requires approval and isolates elevated work", () => {
  assert.match(page, /setConfirmCleanup\(true\)/);
  assert.match(page, /<ConfirmSheet tone="danger" title=\{t\("systemCleaner\.cleanTitle"\)\}/);
  assert.match(page, /systemCleaner\.uninstallTitle/);
  assert.match(backend, /Start-Process.*-Verb RunAs/);
  assert.match(backend, /system-cleaner\.operations\.log/);
});

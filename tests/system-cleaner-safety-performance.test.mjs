import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backend = await readFile(new URL("../src-tauri/src/system_cleaner.rs", import.meta.url), "utf8");
const recipes = await readFile(new URL("../src-tauri/src/system_cleaner_recipes.rs", import.meta.url), "utf8");
const storage = await readFile(new URL("../src-tauri/src/storage.rs", import.meta.url), "utf8");
const backendCommands = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const page = await readFile(new URL("../src/modules/system-cleaner/SystemCleanerPage.tsx", import.meta.url), "utf8");
const scanState = await readFile(new URL("../src/modules/system-cleaner/scanState.ts", import.meta.url), "utf8").catch(() => "");
const scanOrb = await readFile(new URL("../src/modules/system-cleaner/SystemCleanerScanOrb.tsx", import.meta.url), "utf8").catch(() => "");
const styles = await readFile(new URL("../src/modules/system-cleaner/systemCleaner.css", import.meta.url), "utf8");
const statusBar = await readFile(new URL("../src/modules/workspace/StatusBar.tsx", import.meta.url), "utf8");
const tauri = await readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");
const manual = await readFile(new URL("../docs/manual/20-system-cleaner.md", import.meta.url), "utf8");
const catalog = await readFile(new URL("../installer/catalog.v1.json", import.meta.url), "utf8");

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

test("System Cleaner automatically installs and imports the managed WinDirStat scanner", () => {
  assert.match(catalog, /"id": "windirstat"[\s\S]*?"repo": "windirstat\/windirstat"[\s\S]*?"assetPattern": "WinDirStat\.zip"/);
  assert.match(backend, /fn scan_with_windirstat/);
  assert.match(backend, /\/saveto/);
  assert.match(backend, /fn parse_windirstat_report/);
  assert.match(backend, /"Logical Size"/);
  assert.match(backend, /"Physical Size"/);
  assert.match(page, /system_cleaner_scanner_status/);
  assert.match(page, /installRecipeAndWait/);
  assert.doesNotMatch(page, /confirmNativeDialog|scannerInstallTitle|scannerInstallPrompt/);
  assert.match(page, /catch\s*\{[\s\S]*?iterative directory walker[\s\S]*?\}\s*finally\s*\{[\s\S]*?beginScan\(\)/);
  assert.match(backend, /ScanProgressPhase::Metadata/);
  assert.match(backend, /ScanProgressPhase::Files/);
});

test("System Cleaner keeps scan paths from widening the page", () => {
  assert.match(page, /system-cleaner-scan-path/);
  assert.match(styles, /\.system-cleaner-scan-path\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
});

test("System Cleaner uses the Searching orb in the scan page and Status Bar", () => {
  assert.match(page, /<SystemCleanerScanOrb size=\{64\}/);
  assert.match(statusBar, /<SystemCleanerScanOrb size=\{20\}/);
  assert.match(scanOrb, /state = "searching"/);
  assert.match(scanOrb, /state=\{state\}/);
  assert.match(statusBar, /useSystemCleanerScanStore/);
  assert.match(scanState, /active:\s*boolean/);
});

test("System Cleaner uses the Direction A control panel and compact cleanup and uninstall rows", () => {
  assert.match(page, /type Section = "overview" \| "storage" \| "cleanup" \| "recommendations" \| "apps" \| "management"/);
  assert.match(page, /system-cleaner-drive-card/);
  assert.match(page, /system-cleaner-metric-grid/);
  assert.match(page, /system-cleaner-cleanup-groups/);
  assert.match(page, /system-cleaner-app-table/);
  assert.match(page, /systemCleaner\.selectAllSafe/);
  assert.match(page, /systemCleaner\.resetDefaults/);
  assert.match(page, /state="working"/);
  assert.match(page, /submitAssistantContextSnippet/);
  assert.match(styles, /\.system-cleaner-shell\s*\{[^}]*grid-template-columns:\s*240px minmax\(0, 1fr\)/s);
});

test("System Cleaner keeps personal-file recommendations opt-in and scan-bound", () => {
  assert.match(backend, /LARGE_OLD_FILE_MIN_BYTES: u64 = 100 \* 1024 \* 1024/);
  assert.match(backend, /LARGE_OLD_FILE_AGE_DAYS: u64 = 180/);
  assert.match(backend, /OLD_DOWNLOAD_AGE_DAYS: u64 = 90/);
  assert.match(backend, /MAX_REVIEW_FILES_PER_CATEGORY: usize = 200/);
  assert.match(backend, /column\("Last Change"\)/);
  assert.match(backend, /review_files/);
  assert.match(backend, /changed after the scan/);
  assert.match(backendCommands, /system_cleaner::system_cleaner_delete_review_files/);
  assert.match(tauri, /system_cleaner_delete_review_files/);
  assert.match(page, /selectedReviewPaths/);
  assert.match(page, /deleteReviewTitle/);
  assert.match(page, /<ConfirmSheet tone="danger"/);
  assert.match(manual, /No recommendation is selected automatically/i);
  assert.match(manual, /does not use the Recycle Bin/i);
});

test("System Cleaner keeps drive selection in the Module header and disk metrics in the control panel", () => {
  assert.doesNotMatch(page, /system-cleaner-scanbar|system-cleaner-progress/);
  assert.match(backend, /system_cleaner_list_drives/);
  assert.match(backendCommands, /system_cleaner::system_cleaner_list_drives/);
  assert.match(tauri, /system_cleaner_list_drives/);
  assert.match(page, /system-cleaner-header-drive/);
  assert.match(page, /system-cleaner-drive-card/);
  assert.match(page, /system-cleaner-drive-meter/);
  assert.match(manual, /logical file\s+sizes/i);
});

test("System Cleaner multi-select uninstall preserves one elevated command per package", () => {
  assert.match(page, /for \(const app of apps\)/);
  assert.match(page, /system_cleaner_uninstall/);
  assert.match(page, /systemCleaner\.uninstallSelectionMessage/);
  assert.match(manual, /separate UAC approval and elevated helper for each package/i);
});

test("System Cleaner preserves WinDirStat logical and physical sizes", () => {
  assert.match(backend, /total_allocated_bytes/);
  assert.match(backend, /parse_u64_field\(&fields\[logical_column\]/);
  assert.match(backend, /parse_u64_field\(&fields\[physical_column\]/);
  assert.match(backend, /total\.1 = total\.1\.saturating_add\(physical\)/);
  assert.match(page, /totalAllocatedBytes/);
  assert.match(page, /systemCleaner\.allocated/);
  assert.match(page, /systemCleaner\.storageTotals/);
  assert.match(manual, /WinDirStat's exported \*\*Physical Size\*\*/i);
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

test("System Cleaner storage rows use the native File Browser context-menu path", () => {
  assert.match(page, /showNativeContextMenu/);
  assert.match(page, /set_local_file_clipboard/);
  assert.match(page, /sftp\.copyPath/);
  assert.match(page, /onContextMenu/);
});

test("System Cleaner opens idle and scans only on explicit demand", () => {
  assert.match(page, /onClick=\{\(\) => void scan\(\)\}/);
  assert.match(page, /systemCleaner\.scanHint/);
});

test("System Cleaner walks directories iteratively without following reparse points", () => {
  assert.match(backend, /let mut pending = vec!\[ScanWork::Enter/);
  assert.match(backend, /while let Some\(work\) = pending\.pop\(\)/);
  assert.match(backend, /FILE_ATTRIBUTE_REPARSE_POINT/);
  assert.doesNotMatch(backend, /directory_size\(&entry\.path\(\)\)/);
});

test("System Cleaner prefers elevated WinDirStat and falls back to directory enumeration", () => {
  assert.match(backend, /if let Ok\(scan\) = scan_with_windirstat\(root,/);
  assert.match(backend, /scan_tree\(root,/);
  assert.match(backend, /Start-Process.*-Verb RunAs/);
  assert.match(manual, /If WinDirStat installation fails[\s\S]*iterative directory walker instead of the legacy raw\s+MFT reader/i);
});

test("System Cleaner scan helpers do not open terminal windows", () => {
  assert.match(backend, /const CREATE_NO_WINDOW: u32 = 0x0800_0000/);
  assert.match(backend, /Command::new\("powershell\.exe"\)[\s\S]*?\.creation_flags\(CREATE_NO_WINDOW\)[\s\S]*?command\.status\(\)/);
  assert.match(backend, /fn installed_apps\(\)[\s\S]*?Command::new\("winget"\)[\s\S]*?command\.creation_flags\(CREATE_NO_WINDOW\)[\s\S]*?command\.output\(\)/);
});

test("System Cleaner requires approval and isolates elevated work", () => {
  assert.match(page, /setConfirmCleanup\(true\)/);
  assert.match(page, /<ConfirmSheet tone="danger" title=\{t\("systemCleaner\.cleanTitle"\)\}/);
  assert.match(page, /systemCleaner\.uninstallTitle/);
  assert.match(backend, /Start-Process.*-Verb RunAs/);
  assert.match(backend, /system-cleaner\.operations\.log/);
});

test("System Cleaner cleanup is preview-first, immutable, revalidated, cancellable, and retryable", () => {
  assert.match(page, /system_cleaner_build_cleanup_plan/);
  assert.match(page, /system_cleaner_execute_cleanup_plan/);
  assert.match(page, /system_cleaner_cancel_cleanup/);
  assert.match(page, /cleanupResult\?\.skipped\.map/);
  assert.match(page, /system-cleaner-plan-preview/);
  assert.match(recipes, /struct CleanupPlan/);
  assert.match(recipes, /file_id/);
  assert.match(recipes, /metadata_modified_ms/);
  assert.match(recipes, /path_within\(&canonical, &item\.target_root\)/);
  assert.match(recipes, /fs::remove_file/);
  assert.doesNotMatch(recipes, /remove_dir_all/);
});

test("System Cleaner recipes stay file-only and protect exclusions and sensitive paths", () => {
  assert.match(recipes, /CleanerTarget/);
  assert.match(recipes, /system_cleaner_keep_paths/);
  assert.match(recipes, /PROTECTED_COMPONENTS/);
  assert.match(recipes, /PROTECTED_FILES/);
  assert.match(recipes, /Imported recipes cannot be selected by default/);
  assert.match(recipes, /Registry keys, commands, and unsupported variables are ignored/);
  assert.doesNotMatch(recipes, /RegDeleteKey|RegDeleteValue|CleanupTarget::Registry/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS system_cleaner_keep_paths/);
});

test("System Cleaner offers broad built-in coverage plus constrained Winapp2 import", () => {
  const builtInIds = [...recipes.matchAll(/builtin\(\s*"([a-z0-9-]+)"/g)].map((match) => match[1]);
  assert.ok(new Set(builtInIds).size >= 30, `expected at least 30 built-in recipes, found ${new Set(builtInIds).size}`);
  for (const id of ["brave-cache", "teams-cache", "vscode-cache", "npm-cache", "nuget-cache", "pip-cache", "cargo-cache", "gradle-cache", "nvidia-cache", "steam-web-cache"]) {
    assert.ok(builtInIds.includes(id), `missing reviewed built-in ${id}`);
  }
  assert.match(recipes, /preview_winapp2/);
  assert.match(recipes, /skipped_registry_keys/);
  assert.match(recipes, /MAX_IMPORTED_RECIPES: usize = 8_000/);
});

test("System Cleaner bundles are versioned, signed, staged, and signer-pinned", () => {
  assert.match(recipes, /ed25519_dalek/);
  assert.match(recipes, /key\.verify/);
  assert.match(recipes, /payload\.version <= existing\.version/);
  assert.match(recipes, /signed by a different key/);
  assert.match(recipes, /preview\.added/);
  assert.match(recipes, /preview\.updated/);
  assert.match(recipes, /preview\.removed/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS system_cleaner_recipe_bundles/);
});

test("System Cleaner records structured history and separates Windows-owned maintenance and AppX removal", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS system_cleaner_history/);
  assert.match(page, /system_cleaner_history/);
  assert.match(backend, /SHQueryRecycleBinW/);
  assert.match(backend, /Delete-DeliveryOptimizationCache/);
  assert.match(backend, /StartComponentCleanup/);
  assert.match(backend, /Remove-AppxPackage -Package/);
  assert.match(page, /appxRemoveTitle/);
});

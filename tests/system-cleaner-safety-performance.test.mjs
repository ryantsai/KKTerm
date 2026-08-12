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

test("System Cleaner uses KKTerm's Rust scanners without a managed scanner dependency", () => {
  assert.doesNotMatch(catalog, /"id": "windirstat"/);
  assert.match(backend, /fn scan_tree/);
  assert.doesNotMatch(backend, /WinDirStat|scan_with_windirstat|system_cleaner_scanner_status|scan_raw_mft|elevated_mft_scan|--system-cleaner-mft-scan|ntfs_reader/);
  assert.doesNotMatch(page, /system_cleaner_scanner_status|installRecipeAndWait/);
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

test("System Cleaner keeps its core workflows on one three-column Overview surface", () => {
  assert.match(page, /system-cleaner-overview-page/);
  assert.match(page, /system-cleaner-metric-grid/);
  assert.match(page, /<StorageView/);
  assert.match(page, /<CleanupView/);
  assert.match(page, /<RecommendationsView/);
  assert.match(page, /<AppsView/);
  assert.match(page, /system-cleaner-cleanup-groups/);
  assert.match(page, /system-cleaner-app-table/);
  assert.match(page, /systemCleaner\.selectAllSafe/);
  assert.match(page, /systemCleaner\.resetDefaults/);
  assert.match(page, /state="working"/);
  assert.match(page, /submitAssistantContextSnippet/);
  assert.doesNotMatch(page, /CleanerSidebar|CleanerManagementView|systemCleaner\.management/);
  assert.doesNotMatch(page, /system-cleaner-drive-overview|system-cleaner-search|<SystemToolsView/);
  assert.doesNotMatch(page, /system_cleaner_(?:list|add|remove)_keep_path|system_cleaner_(?:preview|import).*bundle|system_cleaner_(?:preview|import)_winapp2/);
  assert.match(styles, /\.system-cleaner-content\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.system-cleaner-overview-page\s*\{[^}]*width:\s*100%[^}]*padding:\s*10px/s);
  assert.match(styles, /\.system-cleaner-overview-sections\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)[^}]*grid-template-areas:[^}]*"storage cleanup recommendations"[^}]*"apps apps apps"/s);
});

test("System Cleaner mounts scan-independent sections and keeps Scan only in the Module header", () => {
  assert.match(page, /system_cleaner_catalog/);
  assert.match(page, /system_cleaner_list_apps/);
  assert.match(backend, /pub async fn system_cleaner_list_apps/);
  assert.match(backendCommands, /system_cleaner::system_cleaner_list_apps/);
  assert.match(tauri, /system_cleaner_list_apps/);
  assert.doesNotMatch(page, /\{overview && directory \? <>/);
  assert.equal(page.match(/data-tutorial-id="systemCleaner\.scan"/g)?.length, 1);
  assert.doesNotMatch(page, /function DriveOverview|system-cleaner-drive-choice/);
});

test("System Cleaner defaults every size-bearing result list to descending size", () => {
  assert.match(backend, /right\s*\.size_bytes\s*\.cmp\(&left\.size_bytes\)/s);
  assert.match(page, /right\.bytes - left\.bytes \|\| recipeTitle/);
  assert.match(page, /right\.allocatedBytes - left\.allocatedBytes \|\| left\.name\.localeCompare/);
  assert.match(page, /right\.sizeBytes - left\.sizeBytes \|\| left\.name\.localeCompare/);
  assert.match(page, /key: "allocated", direction: "desc"/);
  assert.doesNotMatch(page, /folderOrder/);
});

test("System Cleaner preserves WinGet display names and enriches apps with Windows estimated sizes", () => {
  assert.match(backend, /fn parse_winget_apps/);
  assert.match(backend, /EstimatedSizeBytes/);
  assert.match(backend, /winget_column\(line, 0, Some\(id_start\)\)/);
  assert.doesNotMatch(backend, /split_whitespace\(\)[\s\S]*InstalledApp/);
  assert.match(page, /system-cleaner-app-size/);
  assert.match(page, /installedSize/);
  assert.match(page, /<Sparkles size=\{14\}/);
});

test("System Cleaner keeps personal-file recommendations opt-in and scan-bound", () => {
  assert.match(backend, /LARGE_OLD_FILE_MIN_BYTES: u64 = 100 \* 1024 \* 1024/);
  assert.match(backend, /LARGE_OLD_FILE_AGE_DAYS: u64 = 180/);
  assert.match(backend, /OLD_DOWNLOAD_AGE_DAYS: u64 = 90/);
  assert.match(backend, /MAX_REVIEW_FILES_PER_CATEGORY: usize = 200/);
  assert.match(backend, /modified_unix_ms/);
  assert.match(backend, /review_files/);
  assert.match(backend, /changed after the scan/);
  assert.match(backendCommands, /system_cleaner::system_cleaner_delete_review_files/);
  assert.match(tauri, /system_cleaner_delete_review_files/);
  assert.match(page, /selectedReviewPaths/);
  assert.match(page, /deleteReviewTitle/);
  assert.match(page, /<ConfirmSheet tone="danger"/);
  assert.match(manual, /never selected automatically/i);
  assert.match(manual, /does not use the Recycle Bin/i);
});

test("System Cleaner drive selection uses only the compact native header target", () => {
  assert.doesNotMatch(page, /system-cleaner-scanbar|system-cleaner-progress/);
  assert.match(backend, /system_cleaner_list_drives/);
  assert.match(backendCommands, /system_cleaner::system_cleaner_list_drives/);
  assert.match(tauri, /system_cleaner_list_drives/);
  assert.match(page, /system-cleaner-header-drive/);
  assert.match(page, /data-tutorial-id="systemCleaner\.drive"/);
  assert.doesNotMatch(page, /system-cleaner-drive-choice|system-cleaner-drive-overview/);
  assert.match(styles, /\.system-cleaner-header-drive select\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%/s);
  assert.match(manual, /logical file\s+sizes/i);
});

test("System Cleaner multi-select uninstall preserves one elevated command per package", () => {
  assert.match(page, /for \(const app of apps\)/);
  assert.match(page, /system_cleaner_uninstall/);
  assert.match(page, /systemCleaner\.uninstallSelectionMessage/);
  assert.match(manual, /one UAC approval and\s+helper per package/i);
});

test("System Cleaner preserves logical and estimated allocated sizes from its Rust walker", () => {
  assert.match(backend, /total_allocated_bytes/);
  assert.match(backend, /allocated_file_size/);
  assert.match(backend, /allocation_unit_size/);
  assert.match(page, /totalAllocatedBytes/);
  assert.match(page, /systemCleaner\.allocated/);
  assert.match(page, /systemCleaner\.storageTotals/);
  assert.match(manual, /Rust walker reads logical file lengths/i);
  assert.match(manual, /compressed-size reporting for compressed or sparse files/i);
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

test("System Cleaner uses only its iterative Rust directory walker", () => {
  assert.match(backend, /fn scan_drive[\s\S]*scan_tree\(root,/);
  assert.doesNotMatch(backend, /MFT|mft|ntfs_reader|run_mft_helper/);
  assert.match(manual, /uses its reparse-safe iterative\s+Rust directory walker directly/i);
  assert.match(manual, /does not launch an elevated helper or\s+read the NTFS master file table/i);
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

test("System Cleaner built-in cleanup stays file-only and protects sensitive paths", () => {
  assert.match(recipes, /CleanerTarget/);
  assert.match(recipes, /PROTECTED_COMPONENTS/);
  assert.match(recipes, /PROTECTED_FILES/);
  assert.match(recipes, /let recipes = built_in_recipes\(\)/);
  assert.match(recipes, /build_cached_plan\(&recipes, &selected, &\[\]\)/);
  assert.doesNotMatch(recipes, /RegDeleteKey|RegDeleteValue|CleanupTarget::Registry/);
  assert.doesNotMatch(backendCommands, /system_cleaner::system_cleaner_(?:list|add|remove)_keep_path/);
});

test("System Cleaner offers broad built-in coverage without recipe-import commands", () => {
  const builtInIds = [...recipes.matchAll(/builtin\(\s*"([a-z0-9-]+)"/g)].map((match) => match[1]);
  assert.ok(new Set(builtInIds).size >= 30, `expected at least 30 built-in recipes, found ${new Set(builtInIds).size}`);
  for (const id of ["brave-cache", "teams-cache", "vscode-cache", "npm-cache", "nuget-cache", "pip-cache", "cargo-cache", "gradle-cache", "nvidia-cache", "steam-web-cache"]) {
    assert.ok(builtInIds.includes(id), `missing reviewed built-in ${id}`);
  }
  assert.doesNotMatch(backendCommands, /system_cleaner::system_cleaner_(?:validate_recipe|preview_signed_bundle|import_signed_bundle|list_recipe_bundles|remove_recipe_bundle|preview_winapp2|import_winapp2)/);
  assert.match(manual, /User-authored rules, signed bundles, Winapp2 imports, and the\s+Keep List are not part of System Cleaner/i);
});

test("System Cleaner retains shared Windows maintenance commands without rendering their retired page section", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS system_cleaner_history/);
  assert.match(backend, /SHQueryRecycleBinW/);
  assert.match(backend, /Delete-DeliveryOptimizationCache/);
  assert.match(backend, /StartComponentCleanup/);
  assert.match(backend, /Remove-AppxPackage -Package/);
  assert.doesNotMatch(page, /system_cleaner_history|system_cleaner_list_appx_packages|system_cleaner_windows_maintenance_status|appxRemoveTitle|SystemToolsView/);
});

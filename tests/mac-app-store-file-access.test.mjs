import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("App Store packaging pairs sandbox file grants with an explicit build feature", async () => {
  const store = JSON.parse(await read("src-tauri/tauri.appstore.conf.json"));
  const standard = JSON.parse(await read("src-tauri/tauri.macos.conf.json"));
  const entitlements = await read(`src-tauri/${store.bundle.macOS.entitlements}`);
  assert.deepEqual(store.build.features, ["mac-app-store"]);
  assert.equal(store.bundle.createUpdaterArtifacts, false);
  assert.match(entitlements, /com\.apple\.security\.app-sandbox/);
  assert.match(entitlements, /com\.apple\.security\.files\.user-selected\.read-write/);
  assert.doesNotMatch(entitlements, /com\.apple\.security\.files\.downloads\./);
  assert.equal(standard.build.features, undefined);
  assert.equal(standard.bundle.macOS?.entitlements, undefined);
  assert.equal(standard.bundle.createUpdaterArtifacts, true);
});

test("native grants require the Store feature and survive outside exported settings", async () => {
  const source = await read("src-tauri/src/app_store_files.rs");
  assert.match(source, /cfg!\(all\(target_os = "macos", feature = "mac-app-store"\)\)/);
  assert.match(source, /join\("sandbox-bookmarks"\)/);
  assert.match(source, /readObjectsForClasses_options/);
  assert.doesNotMatch(source, /NSFilenamesPboardType[^\n]*\(/);
  assert.match(source, /WithSecurityScope/);
  assert.match(source, /WithoutUI/);
  assert.match(source, /stopAccessingSecurityScopedResource/);
  const model = await read("src-tauri/src/storage.rs");
  const entry = model.slice(model.indexOf("pub struct AppLauncherEntry {"), model.indexOf("pub struct AppearanceSettings"));
  assert.doesNotMatch(entry, /bookmark/i, "machine-local grants must not be exported with launcher entries");
});

test("Store folder drops stay scoped to the launcher and standard native drops stay unchanged", async () => {
  const widget = await read("src/modules/dashboard/widgets/builtin/app-launcher/AppLauncherWidget.tsx");
  assert.match(widget, /isTauriRuntime\(\) && !macAppStoreBuild/);
  assert.match(widget, /action: "drop"/);
  const main = await read("src-tauri/src/lib.rs");
  assert.match(main, /\.disable_drag_drop_handler\(\)/);
});

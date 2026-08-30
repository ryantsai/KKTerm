import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Microsoft Store builds check trial licenses once per launch off the UI thread", async () => {
  const [license, paths, cargo, lib, permissions] = await Promise.all([
    read("src-tauri/src/store_license.rs"),
    read("src-tauri/src/app_paths.rs"),
    read("src-tauri/Cargo.toml"),
    read("src-tauri/src/lib.rs"),
    read("src-tauri/permissions/main.toml"),
  ]);

  assert.match(paths, /PackageSignatureKind::Store/);
  assert.match(cargo, /"Services_Store"/);
  assert.match(license, /name\("kkterm-store-license"\.into\(\)\)/);
  assert.match(license, /StoreContext::GetDefault\(\)/);
  assert.match(license, /context\.cast::<IInitializeWithWindow>\(\)/);
  assert.match(license, /initialize_with_window\.Initialize\(HWND\(owner_hwnd as \*mut _\)\)/);
  assert.match(license, /GetAppLicenseAsync\(\)\?\.join\(\)\?/);
  assert.match(license, /let is_trial = license\.IsTrial\(\)\?/);
  assert.match(license, /if !is_trial \{[\s\S]*?return Ok\(false\);[\s\S]*?license\.IsActive\(\)\?/);
  assert.match(license, /!is_active \|\| now_ticks >= expiration_ticks/);
  assert.doesNotMatch(license, /OfflineLicensesChanged|recv_timeout|CHECK_INTERVAL/);
  assert.match(license, /publish_if_changed/);
  assert.match(lib, /store_license::start\(app\.handle\(\)\.clone\(\)\)/);
  assert.match(lib, /store_license::get_store_trial_expired/);
  assert.match(permissions, /"get_store_trial_expired"/);
});

test("expired Store trial politely invites support through the fixed Store listing", async () => {
  const [prompt, app, bridge, english] = await Promise.all([
    read("src/app/StoreLicensePrompt.tsx"),
    read("src/App.tsx"),
    read("src/lib/tauri.ts"),
    read("src/i18n/locales/en.json"),
  ]);

  assert.match(prompt, /https:\/\/apps\.microsoft\.com\/detail\/9nvqc5cnwwjk/);
  assert.match(prompt, /listen<boolean>\(STORE_TRIAL_STATUS_EVENT/);
  assert.match(prompt, /invokeCommand\("get_store_trial_expired"\)/);
  assert.match(prompt, /<ConfirmSheet/);
  assert.match(prompt, /tone="info"/);
  assert.match(prompt, /app\.storeTrialExpiredTitle/);
  assert.match(prompt, /app\.storePurchaseAction/);
  assert.match(prompt, /openExternalUrl\(MICROSOFT_STORE_URL\)/);
  assert.match(app, /<StoreLicensePrompt[\s\S]*?updatesManagedByPlatformStore/);
  assert.match(bridge, /get_store_trial_expired:[\s\S]*?result: boolean \| null/);
  const copy = JSON.parse(english).app;
  assert.equal(copy.storeTrialExpiredTitle, "Thank you for trying KKTerm");
  assert.equal(copy.storePurchaseAction, "Support KKTerm");
  assert.match(copy.storeTrialExpiredMessage, /support its continued development/);
  assert.doesNotMatch(copy.storeTrialExpiredMessage, /GitHub|free version|continue using it/);
});

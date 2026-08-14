import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Custom Module WebViews receive only the caller-bound bridge permission", async () => {
  const [capability, permission, backend, app] = await Promise.all([
    readFile(new URL("../src-tauri/capabilities/custom-modules.json", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/permissions/main.toml", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/custom_modules.rs", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
  ]);
  const parsed = JSON.parse(capability);
  assert.deepEqual(parsed.windows, ["custom-module-*"]);
  assert.deepEqual(parsed.permissions, ["allow-custom-module-bridge"]);
  assert.match(permission, /commands\.allow/);
  assert.match(permission, /"custom_module_bridge"/);
  assert.match(capability, /"http:\/\/kkmodule\.m-\*\/\*"/);
  assert.match(backend, /label\.starts_with\("custom-module-"\)/);
  assert.match(backend, /runtime\.session\(label\)/);
  assert.match(backend, /Permissions-Policy/);
  assert.match(backend, /worker-src 'self' blob:/);
  assert.match(backend, /package_origin_host/);
  assert.match(backend, /data_directory\(webview_data_root\(&paths\)\.join\(&installed\.manifest\.id\)\)/);
  assert.match(backend, /document\.addEventListener\('click'/);
  assert.match(backend, /navigator\.userActivation\?\.isActive/);
  assert.match(backend, /\.on_new_window\(\|_, _\| tauri::webview::NewWindowResponse::Deny\)/);
  assert.match(backend, /replace\(target, 'localStorage', ephemeralStorage\)/);
  assert.match(backend, /if \(!\{clipboard_allowed\}\) replace\(target, 'clipboard', unavailableClipboard\)/);
  assert.match(backend, /new DOMException\('Clipboard access is unavailable to Custom Modules\.', 'NotAllowedError'\)/);
  assert.match(backend, /effective_permissions\.clipboard/);
  assert.match(backend, /builder = builder\.enable_clipboard_access\(\)/);
  assert.match(
    backend,
    /pub async fn start_custom_module\(/,
    "Windows WebView creation must run from an async Tauri command to avoid WebView2 deadlock",
  );
  assert.match(backend, /clipboard-read=\(self\), clipboard-write=\(self\)/);
  assert.match(backend, /clipboard-read=\(\), clipboard-write=\(\)/);
  assert.match(backend, /MAX_BRIDGE_PAYLOAD_BYTES/);
  assert.match(backend, /"documentStorage"/);
  assert.match(backend, /documents: Object\.freeze/);
  assert.match(backend, /custom_module_documents/);
  assert.match(backend, /document_storage_root\(paths\)/);
  assert.match(backend, /MAX_DOCUMENT_BYTES/);
  assert.match(backend, /pub struct CustomModuleBridgeError/);
  assert.match(backend, /tauri::async_runtime::spawn_blocking/);
  const handler = app.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(handler, "main invoke handler must remain discoverable");
  const handlerCommands = handler
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .map((line) => line.match(/^(?:[A-Za-z0-9_]+::)*([A-Za-z0-9_]+),?$/)?.[1])
    .filter(Boolean);
  const allowedCommands = [...permission.matchAll(/^\s*"([A-Za-z0-9_]+)",?$/gm)]
    .map((match) => match[1]);
  assert.deepEqual(
    new Set(allowedCommands),
    new Set(handlerCommands),
    "the trusted main-window ACL must track the complete invoke handler",
  );
});

test("Custom Module packages are optional and static", async () => {
  const [manifest, packageJson, tauriConfig] = await Promise.all([
    readFile(new URL("../custom-modules/fixtures/hello-world/kkterm-extension.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  ]);
  assert.equal(JSON.parse(manifest).apiVersion, 2);
  assert.match(packageJson, /package:custom-module-fixture/);
  assert.doesNotMatch(tauriConfig, /\.kkmod|custom-modules[\\/]fixtures|excalidraw/i);
});

test("dynamic Custom Module rail destinations do not become a compile-time id union", async () => {
  const [rail, hook, app] = await Promise.all([
    readFile(new URL("../src/app/ActivityRail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/custom-modules/useCustomModules.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(hook, /`custom:\$\{destination\.moduleId\}:\$\{destination\.contributionId\}`/);
  assert.match(rail, /customModuleDestinations\.map/);
  assert.match(rail, /CustomModuleIcon iconDataUrl=\{destination\.iconDataUrl\}/);
  assert.match(app, /<CustomModuleHost/);
});

test("packaged Custom Module rail icons remain inert, bounded, and monochrome", async () => {
  const [backend, rail, icon, publisher, packaging, skill, contract] = await Promise.all([
    readFile(new URL("../src-tauri/src/custom_modules.rs", import.meta.url), "utf8"),
    readFile(new URL("../src/app/ActivityRail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/custom-modules/CustomModuleIcon.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/publish-custom-module.mjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/CUSTOM_MODULE_PACKAGING.md", import.meta.url), "utf8"),
    readFile(new URL("../.agents/skills/develop-kkmod-modules/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../.agents/skills/develop-kkmod-modules/references/package-contract.md", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(
    backend,
    /trust != "firstParty"/,
    "local packages should expose validated packaged SVG artwork too",
  );
  assert.match(backend, /is_inert_activity_rail_svg/);
  assert.match(backend, /MAX_ACTIVITY_RAIL_ICON_BYTES/);
  assert.match(rail, /CustomModuleIcon/);
  assert.match(icon, /maskImage/);
  assert.match(publisher, /validateCuratedModuleIcons/);
  for (const source of [packaging, skill, contract]) {
    assert.match(source, /monochrome/i);
    assert.match(source, /64 KiB/);
  }
});

test("Custom Module bounds updates cannot reshow an overlay hidden for Settings", async () => {
  const [backend, host, app] = await Promise.all([
    readFile(new URL("../src-tauri/src/custom_modules.rs", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/custom-modules/CustomModuleHost.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  ]);
  const boundsCommand = backend.match(
    /fn update_runtime_view_bounds\([\s\S]*?\n}\n\nfn set_runtime_view_visibility/,
  )?.[0];
  const visibilityCommand = backend.match(
    /fn set_runtime_view_visibility\([\s\S]*?\n}\n\n#\[tauri::command\]/,
  )?.[0];

  assert.ok(boundsCommand, "the Custom Module bounds command should remain discoverable");
  assert.ok(visibilityCommand, "the Custom Module visibility command should remain discoverable");
  assert.match(
    boundsCommand,
    /if state\.visible\s*\{[\s\S]*set_overlay_bounds/,
    "bounds updates should reposition only a currently visible native WebView",
  );
  assert.match(
    visibilityCommand,
    /set_overlay_bounds/,
    "showing a hidden native WebView should restore its last known bounds",
  );
  assert.match(
    backend,
    /set_runtime_view_visibility\(&session, true\)/,
    "initial placement should use the same authoritative visibility transition as later reveals",
  );
  assert.match(app, /blockingOverlayOpen=\{activePage === "settings"\}/);
  assert.match(
    host,
    /blockingOverlayOpen\s*\|\|\s*documentHasCustomModuleBlockingOverlay/,
    "Settings state should hide the native Module directly instead of relying only on DOM geometry",
  );
});

test("Custom Module WebViews stay loaded while users visit another Module", async () => {
  const host = await readFile(
    new URL("../src/modules/custom-modules/CustomModuleHost.tsx", import.meta.url),
    "utf8",
  );
  const startInvoke = host.indexOf('invokeCommand("start_custom_module"');
  const lifecycleStart = host.lastIndexOf("useEffect(() => {", startInvoke);
  const lifecycleEnd = host.indexOf("\n  useEffect(() => {", startInvoke);
  const lifecycleEffect = host.slice(lifecycleStart, lifecycleEnd);
  const boundsCallbackStart = host.indexOf("const pushBounds = useCallback");
  const boundsCallbackEnd = host.indexOf("\n\n  useEffect(() => {", boundsCallbackStart);
  const boundsCallback = host.slice(boundsCallbackStart, boundsCallbackEnd);

  assert.ok(startInvoke >= 0, "the Custom Module start invoke should remain discoverable");
  assert.ok(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart);
  assert.match(host, /const activeRef = useRef\(active\)/);
  assert.match(
    lifecycleEffect,
    /visible: activeRef\.current && !blocked/,
    "a Module that finishes starting in the background must remain hidden",
  );
  assert.match(
    lifecycleEffect,
    /}, \[destination, pushBounds\]\);/,
    "ordinary navigation must not close and recreate the loaded WebView",
  );
  assert.match(
    boundsCallback,
    /}, \[\]\);/,
    "bounds updates must remain stable when active visibility changes",
  );
});

test("Custom Module host and agent guidance preserve the Windows async window boundary", async () => {
  const [architecture, packaging, implementationPlan, skill, runtimeReference] = await Promise.all([
    readFile(new URL("../docs/ARCHITECTURE.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/CUSTOM_MODULE_PACKAGING.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/CUSTOM_MODULES_IMPLEMENTATION_PLAN.md", import.meta.url), "utf8"),
    readFile(new URL("../.agents/skills/develop-kkmod-modules/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../.agents/skills/develop-kkmod-modules/references/runtime-api.md", import.meta.url), "utf8"),
  ]);
  for (const source of [architecture, packaging, implementationPlan, skill, runtimeReference]) {
    assert.match(source, /asynchronous|must be `async`/i);
    assert.match(source, /WebView2/);
    assert.match(source, /deadlock/i);
  }
  assert.match(runtimeReference, /clipboard/);
  assert.match(runtimeReference, /navigator\.clipboard/);
});

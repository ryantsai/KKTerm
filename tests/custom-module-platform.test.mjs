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
  assert.match(backend, /label\.starts_with\("custom-module-"\)/);
  assert.match(backend, /runtime\.session\(label\)/);
  assert.match(backend, /Permissions-Policy/);
  assert.match(backend, /worker-src 'none'/);
  assert.match(backend, /replace\(target, 'localStorage', ephemeralStorage\)/);
  assert.match(backend, /MAX_BRIDGE_PAYLOAD_BYTES/);
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
  assert.equal(JSON.parse(manifest).apiVersion, 1);
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
  assert.match(app, /<CustomModuleHost/);
});

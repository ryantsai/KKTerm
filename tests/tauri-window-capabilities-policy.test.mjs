import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function frontendSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...await frontendSources(target));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      sources.push([target, await readFile(target, "utf8")]);
    }
  }
  return sources;
}

function calledMethods(source, factoryName) {
  const methods = new Set();
  const directCall = new RegExp(`${factoryName}\\(\\)\\.(\\w+)\\(`, "g");
  for (const match of source.matchAll(directCall)) {
    methods.add(match[1]);
  }

  const assignment = new RegExp(`const\\s+(\\w+)\\s*=\\s*${factoryName}\\(\\)\\s*;`, "g");
  for (const match of source.matchAll(assignment)) {
    const aliasCall = new RegExp(`\\b${match[1]}\\.(\\w+)\\(`, "g");
    for (const call of source.matchAll(aliasCall)) {
      methods.add(call[1]);
    }
  }
  return methods;
}

function importedSymbols(source, moduleName) {
  const escapedModule = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(
    `import\\s*\\{([^}]+)\\}\\s*from\\s*["']${escapedModule}["']`,
    "g",
  );
  const symbols = new Set();
  for (const match of source.matchAll(importPattern)) {
    for (const specifier of match[1].split(",")) {
      const normalized = specifier.trim();
      if (normalized && !normalized.startsWith("type ")) {
        symbols.add(normalized.split(/\s+as\s+/)[0]);
      }
    }
  }
  return symbols;
}

test("frontend Tauri window commands have matching main-window capabilities", async () => {
  const capability = JSON.parse(await readFile(
    path.join(root, "src-tauri/capabilities/default.json"),
    "utf8",
  ));
  assert.deepEqual(capability.windows, ["main"]);
  const permissions = new Set(
    capability.permissions.filter((permission) => typeof permission === "string"),
  );
  const sources = await frontendSources(path.join(root, "src"));

  const windowPermissions = {
    close: "core:window:allow-close",
    isMaximized: "core:window:allow-is-maximized",
    minimize: "core:window:allow-minimize",
    setFocus: "core:window:allow-set-focus",
    setFullscreen: "core:window:allow-set-fullscreen",
    setPosition: "core:window:allow-set-position",
    setSize: "core:window:allow-set-size",
    show: "core:window:allow-show",
    toggleMaximize: "core:window:allow-toggle-maximize",
    unminimize: "core:window:allow-unminimize",
  };
  const eventOnlyWindowMethods = new Set(["onFocusChanged", "onResized"]);
  const webviewPermissions = {
    setFocus: "core:webview:allow-set-webview-focus",
  };

  for (const [file, source] of sources) {
    for (const method of calledMethods(source, "getCurrentWindow")) {
      const permission = windowPermissions[method];
      assert.ok(
        permission || eventOnlyWindowMethods.has(method),
        `${path.relative(root, file)} uses unmapped getCurrentWindow().${method}()`,
      );
      if (permission) {
        assert.ok(
          permissions.has(permission),
          `${path.relative(root, file)} requires missing capability ${permission}`,
        );
      }
    }
    for (const method of calledMethods(source, "getCurrentWebview")) {
      const permission = webviewPermissions[method];
      assert.ok(
        permission,
        `${path.relative(root, file)} uses unmapped getCurrentWebview().${method}()`,
      );
      assert.ok(
        permissions.has(permission),
        `${path.relative(root, file)} requires missing capability ${permission}`,
      );
    }
  }
});

test("frontend Tauri plugin commands have matching main-window capabilities", async () => {
  const capability = JSON.parse(await readFile(
    path.join(root, "src-tauri/capabilities/default.json"),
    "utf8",
  ));
  const permissions = new Set(
    capability.permissions
      .filter((permission) => typeof permission === "string")
      .concat(capability.permissions
        .filter((permission) => typeof permission === "object")
        .map((permission) => permission.identifier)),
  );
  const sources = await frontendSources(path.join(root, "src"));
  const auditedModules = new Set([
    "@tauri-apps/api/app",
    "@tauri-apps/api/core",
    "@tauri-apps/api/dpi",
    "@tauri-apps/api/event",
    "@tauri-apps/api/image",
    "@tauri-apps/api/menu",
    "@tauri-apps/api/path",
    "@tauri-apps/api/webview",
    "@tauri-apps/api/window",
    "@tauri-apps/plugin-dialog",
    "@tauri-apps/plugin-fs",
    "@tauri-apps/plugin-opener",
    "@tauri-apps/plugin-process",
    "@tauri-apps/plugin-updater",
  ]);
  const permissionByImport = {
    "@tauri-apps/api/app": {
      getVersion: "core:app:allow-version",
    },
    "@tauri-apps/plugin-dialog": {
      confirm: "dialog:allow-message",
      open: "dialog:allow-open",
      save: "dialog:allow-save",
    },
    "@tauri-apps/plugin-fs": {
      exists: "fs:allow-exists",
      readFile: "fs:allow-read-file",
      writeFile: "fs:allow-write-file",
      writeTextFile: "fs:allow-write-text-file",
    },
    "@tauri-apps/plugin-opener": {
      openUrl: "opener:default",
    },
  };

  for (const [file, source] of sources) {
    for (const match of source.matchAll(/["'](@tauri-apps\/[^"']+)["']/g)) {
      assert.ok(
        auditedModules.has(match[1]),
        `${path.relative(root, file)} uses unaudited Tauri module ${match[1]}`,
      );
    }
    for (const [moduleName, importPermissions] of Object.entries(permissionByImport)) {
      for (const symbol of importedSymbols(source, moduleName)) {
        const permission = importPermissions[symbol];
        assert.ok(
          permission,
          `${path.relative(root, file)} imports unmapped Tauri API ${moduleName}#${symbol}`,
        );
        assert.ok(
          permissions.has(permission),
          `${path.relative(root, file)} requires missing capability ${permission}`,
        );
      }
    }
  }

  const macosCapability = JSON.parse(await readFile(
    path.join(root, "src-tauri/capabilities/macos-updater.json"),
    "utf8",
  ));
  const macosPermissions = new Set(macosCapability.permissions);
  assert.ok(macosPermissions.has("updater:default"));
  assert.ok(macosPermissions.has("process:allow-restart"));
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScriptModule(path) {
  const source = await readFile(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      verbatimModuleSyntax: true,
    },
  });
  return import(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled.outputText)}`
  );
}

test("official-script provenance stays separate from management providers", async () => {
  const { isOfficialScriptInstall } = await importTypeScriptModule(
    new URL("../src/modules/installer/types.ts", import.meta.url),
  );

  assert.equal(isOfficialScriptInstall({ installSource: "officialScript" }), true);
  assert.equal(isOfficialScriptInstall({ installProvider: "winget" }), false);
});

test("official-script installs expose safe updates but hide WinGet uninstall", async () => {
  const dialogSource = await readFile(
    new URL("../src/modules/installer/InstallerToolDialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    dialogSource,
    /supportsLatestVersion = recipeSupportsManagedLatestVersion\(\s*recipe,\s*detected,/,
    "latest checks and updates should use provenance-aware support",
  );
  assert.match(
    dialogSource,
    /!officialScript \? \(\s*<Btn[\s\S]*installer\.actions\.uninstall/,
    "uninstall must not route a standalone copy through the WinGet recipe",
  );
});

test("backend routes standalone uv updates by receipt and still blocks uninstall", async () => {
  const [detectSource, installSource, uninstallSource, latestSource] = await Promise.all([
    readFile(
      new URL("../src-tauri/src/installer/detect.rs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src-tauri/src/installer/install.rs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src-tauri/src/installer/uninstall.rs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src-tauri/src/installer/latest_version.rs", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    installSource,
    /update_astral_standalone_uv\(&detected, cancel, emit\)/,
    "official updates must bypass the catalog provider",
  );
  assert.match(
    installSource,
    /astral_standalone_uv_executable_with_validator\(detected, standalone_uv_executable\)/,
    "the update target must revalidate Astral's executable and receipt",
  );
  assert.match(
    detectSource,
    /xdg_config_home[\s\S]*\.or_else\(\|\| local_app_data/,
    "receipt lookup must use LOCALAPPDATA only when XDG_CONFIG_HOME is unset",
  );
  assert.match(
    installSource,
    /run_streamed\(\s*&executable\.to_string_lossy\(\),\s*&\["self"\.into\(\), "update"\.into\(\)\]/,
    "the exact receipt-backed executable must run uv self update",
  );
  assert.match(
    uninstallSource,
    /recipe\.id == "uv" && detect_one\(recipe\)\.is_official_script_install\(\)/,
  );
  assert.match(
    latestSource,
    /child\.id == "uv" && detect_one\(child\)\.is_official_script_install\(\)[\s\S]*return github_latest\("astral-sh\/uv"\)/,
    "latest checks must follow the same Astral channel used by self update",
  );
});

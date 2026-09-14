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
  const encoded = encodeURIComponent(transpiled.outputText);
  return import(`data:text/javascript;charset=utf-8,${encoded}`);
}

test("installer latest-version UI only treats versioned providers as supported", async () => {
  const { recipeSupportsLatestVersion, latestVersionWebUrlForRecipe } =
    await importTypeScriptModule(
    new URL("../src/modules/installer/latestSupport.ts", import.meta.url),
  );
  const antigravity = {
    id: "antigravity-cli",
    name: "Antigravity CLI",
    descriptionEn: "",
    provider: {
      kind: "downloadInstaller",
      url: "https://antigravity.google/cli/install.cmd",
      fileName: "antigravity-cli-install.cmd",
    },
  };
  const codexDesktop = {
    id: "codex-desktop",
    name: "Codex Desktop",
    descriptionEn: "",
    homepage: "https://openai.com/codex/",
    provider: {
      kind: "downloadInstaller",
      url: "https://get.microsoft.com/installer/download/9PLM9XGG6VKS?cid=website_cta_psi",
      fileName: "CodexInstaller.exe",
    },
  };
  const hermesDesktop = {
    id: "hermes-desktop",
    name: "Hermes Desktop",
    descriptionEn: "",
    provider: {
      kind: "downloadInstaller",
      url: "https://hermes-assets.nousresearch.com/Hermes-Setup.exe",
      fileName: "Hermes-Setup.exe",
    },
  };
  const nvmWindows = {
    id: "nvm-windows",
    name: "nvm-windows",
    descriptionEn: "",
    provider: {
      kind: "downloadInstaller",
      url: "https://github.com/nvm-windows/nvm/releases/download/v2.0.0/nvm-2.0.0-amd64-setup.exe",
      fileName: "nvm-2.0.0-amd64-setup.exe",
      githubRepo: "nvm-windows/nvm",
      githubAssetPattern: "nvm-*-amd64-setup.exe",
    },
  };

  assert.equal(recipeSupportsLatestVersion(antigravity), false);
  assert.equal(recipeSupportsLatestVersion(codexDesktop), false);
  assert.equal(recipeSupportsLatestVersion(hermesDesktop), false);
  assert.equal(recipeSupportsLatestVersion(nvmWindows), true);
  assert.equal(latestVersionWebUrlForRecipe(nvmWindows), null);
  assert.equal(
    latestVersionWebUrlForRecipe(antigravity),
    "https://antigravity.google/cli/install.cmd",
  );
  assert.equal(
    latestVersionWebUrlForRecipe(codexDesktop),
    "https://get.microsoft.com/installer/download/9PLM9XGG6VKS?cid=website_cta_psi",
  );
  assert.equal(
    latestVersionWebUrlForRecipe(hermesDesktop),
    "https://hermes-assets.nousresearch.com/Hermes-Setup.exe",
  );
  assert.equal(
    recipeSupportsLatestVersion({
      id: "opencode",
      name: "OpenCode CLI",
      descriptionEn: "",
      provider: { kind: "winget", id: "SST.opencode" },
    }),
    true,
  );
  assert.equal(
    recipeSupportsLatestVersion({
      id: "openclaw",
      name: "OpenClaw",
      descriptionEn: "",
      provider: { kind: "npm", pkg: "openclaw" },
    }),
    true,
  );
  assert.equal(
    recipeSupportsLatestVersion({
      id: "bentopdf",
      name: "BentoPDF",
      descriptionEn: "",
      provider: { kind: "npm", pkg: "github:alam00000/bentopdf" },
      releaseNotesUrl: "https://github.com/alam00000/bentopdf/releases",
    }),
    true,
  );
  assert.equal(
    recipeSupportsLatestVersion({
      id: "github-source-without-releases",
      name: "GitHub source without releases",
      descriptionEn: "",
      provider: { kind: "npm", pkg: "github:goodtab/bentopdf" },
    }),
    false,
  );
  assert.equal(
    recipeSupportsLatestVersion({
      id: "openflowkit",
      name: "OpenFlowKit",
      descriptionEn: "",
      provider: { kind: "npm", pkg: "github:Vrun-design/openflowkit" },
      releaseNotesUrl: "https://github.com/Vrun-design/openflowkit",
    }),
    false,
  );
});

test("installer latest-version UI supports one-step bundles only", async () => {
  const { recipeSupportsLatestVersion } = await importTypeScriptModule(
    new URL("../src/modules/installer/latestSupport.ts", import.meta.url),
  );

  assert.equal(
    recipeSupportsLatestVersion({
      id: "node-bundle",
      name: "Node (nvm-windows)",
      descriptionEn: "",
      provider: { kind: "bundle", steps: ["nvm-windows"] },
    }),
    true,
  );
  assert.equal(
    recipeSupportsLatestVersion({
      id: "compound-bundle",
      name: "Compound bundle",
      descriptionEn: "",
      provider: { kind: "bundle", steps: ["a", "b"] },
    }),
    false,
  );
});

test("standalone uv uses its supported source-specific latest check", async () => {
  const { recipeSupportsManagedLatestVersion } = await importTypeScriptModule(
    new URL("../src/modules/installer/latestSupport.ts", import.meta.url),
  );
  const pythonBundle = {
    id: "python-bundle",
    name: "Python (uv)",
    descriptionEn: "",
    provider: { kind: "bundle", steps: ["uv"] },
  };

  assert.equal(recipeSupportsManagedLatestVersion(pythonBundle), true);
  assert.equal(
    recipeSupportsManagedLatestVersion(pythonBundle, {
      installSource: "officialScript",
    }),
    true,
  );
  assert.equal(
    recipeSupportsManagedLatestVersion(
      {
        id: "uv",
        name: "uv",
        descriptionEn: "",
        provider: { kind: "winget", id: "astral-sh.uv" },
      },
      { installSource: "officialScript" },
    ),
    true,
  );
  assert.equal(
    recipeSupportsManagedLatestVersion(
      {
        id: "other-tool",
        name: "Other tool",
        descriptionEn: "",
        provider: { kind: "winget", id: "Example.Other" },
      },
      { installSource: "officialScript" },
    ),
    false,
  );
});

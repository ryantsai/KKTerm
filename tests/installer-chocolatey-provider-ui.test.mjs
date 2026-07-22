import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dialogSource = await readFile(
  new URL("../src/modules/installer/InstallerToolDialog.tsx", import.meta.url),
  "utf8",
);
const dagSource = await readFile(
  new URL("../src/modules/installer/dag.ts", import.meta.url),
  "utf8",
);
const installSource = await readFile(
  new URL("../src-tauri/src/installer/install.rs", import.meta.url),
  "utf8",
);
const detectSource = await readFile(
  new URL("../src-tauri/src/installer/detect.rs", import.meta.url),
  "utf8",
);
const latestVersionSource = await readFile(
  new URL("../src-tauri/src/installer/latest_version.rs", import.meta.url),
  "utf8",
);
const catalog = JSON.parse(
  await readFile(new URL("../installer/catalog.v1.json", import.meta.url), "utf8"),
);

test("Chocolatey provider selection opens Chocolatey install dialog when missing", () => {
  assert.match(
    dialogSource,
    /selectedProvider\.kind === "chocolatey"[\s\S]*!detected\["chocolatey"\]\?\.installed[\s\S]*openInfoDialog\("chocolatey"\)/,
    "Chocolatey-backed installs should route to the Chocolatey recipe when choco is missing.",
  );
});

test("provider selector offers Chocolatey when a recipe declares a Chocolatey provider", () => {
  assert.match(
    dialogSource,
    /canChooseChocolatey[\s\S]*recipe\.chocolateyProvider\?\.kind === "chocolatey"/,
    "InstallerToolDialog should detect recipes with Chocolatey alternate providers.",
  );
  assert.match(
    dialogSource,
    /<option value="chocolatey">[\s\S]*providerSummary\(recipe\.chocolateyProvider!\)/,
    "InstallerToolDialog should render a Chocolatey option in the provider selector.",
  );
});

test("Chocolatey does not offer itself as a recursive bootstrap provider", () => {
  assert.match(
    dialogSource,
    /canChooseChocolatey\s*=\s*recipe\.id !== "chocolatey"/,
    "Chocolatey's own provider selector should offer WinGet or the official script, not Chocolatey itself.",
  );
});

test("not-installed Chocolatey dialog states the admin + machine-wide requirement", () => {
  assert.match(
    dialogSource,
    /selectedProvider\.kind === "chocolatey"[\s\S]*installer\.dialog\.adminRequiredChocolatey/,
    "The not-installed dialog should show the admin/UAC hint when the selected provider is Chocolatey.",
  );
});

test("Chocolatey update is gated by an admin confirmation before elevating", () => {
  assert.match(
    dialogSource,
    /function startUpdate\(\)[\s\S]*usesChocolatey[\s\S]*setUpdateConfirm\(true\)/,
    "startUpdate should require confirmation for Chocolatey tools instead of elevating silently.",
  );
  assert.match(
    dialogSource,
    /updateConfirm \?[\s\S]*installer\.confirm\.adminChocolateyFooter/,
    "The update confirmation should carry the Chocolatey admin footer.",
  );
  assert.doesNotMatch(
    dialogSource,
    /updateConfirm \?[\s\S]*body=\{t\("installer\.dialog\.adminRequiredChocolatey"\)\}[\s\S]*footer=\{t\("installer\.confirm\.adminChocolateyFooter"\)\}/,
    "The update confirmation should not render duplicate Chocolatey UAC descriptions in both body and footer.",
  );
});

test("Chocolatey uninstall confirmation carries the admin footer", () => {
  assert.match(
    dialogSource,
    /footer=\{\s*usesChocolatey\s*\?\s*t\("installer\.confirm\.adminChocolateyFooter"\)/,
    "The uninstall confirmation footer should show the Chocolatey admin notice when the op runs through choco.",
  );
});

test("Chocolatey provider predicate uses the detected provider for this tool", () => {
  assert.match(
    dialogSource,
    /function detectedProviderForRecipe\([\s\S]*detected\?\.installProvider === "chocolatey"[\s\S]*recipe\.chocolateyProvider/,
    "Installed tool dialogs should resolve the displayed/managed provider from the tool's detected provider.",
  );
  assert.doesNotMatch(
    dialogSource,
    /function recipeUsesChocolateyProvider\([\s\S]*detected\["chocolatey"\]\?\.installed[\s\S]*function recipeSupportsScope/,
    "A Chocolatey manager install alone must not make unrelated installed tools warn that their update uses Chocolatey.",
  );
});

test("detected state includes the install provider used for this tool", () => {
  assert.match(
    detectSource,
    /install_provider: None/,
    "Rust DetectedState should carry an installProvider field with a default for older cache entries.",
  );
  assert.match(
    detectSource,
    /with_install_provider\(Some\("chocolatey"\)\)/,
    "Chocolatey alternate-provider detection should mark that tool as Chocolatey-managed.",
  );
});

test("Chocolatey-backed plans depend on Chocolatey instead of the recipe's winget provider", () => {
  assert.match(
    dagSource,
    /selectedProviderForOptions\(recipe, options\)\.kind === "chocolatey"[\s\S]*"chocolatey"/,
    "Chocolatey provider plans should add Chocolatey as the manager prerequisite.",
  );
  assert.match(
    dagSource,
    /id !== targetRecipeId && detected\[id\]\?\.installed[\s\S]*order\.push\(recipe\)/,
    "Already-installed prerequisites should satisfy their own dependency chain.",
  );
  assert.match(
    dagSource,
    /case "bundle":[\s\S]*estimateUacPromptsFor\(\s*stepRecipe,\s*options,/,
    "Bundle UAC estimates should honor the selected provider passed to bundle steps.",
  );
});

test("uv exposes a Chocolatey provider for Python bundle step installs", () => {
  const uv = catalog.recipes.find((recipe) => recipe.id === "uv");
  assert.ok(uv, "catalog should include uv");
  assert.deepEqual(uv.chocolateyProvider, { kind: "chocolatey", id: "uv" });
  assert.ok(
    uv.options.includes("provider"),
    "uv should show and accept provider selection so the Python bundle can forward Chocolatey.",
  );
});

test("Chocolatey-installed alternate providers update through choco", () => {
  assert.match(
    installSource,
    /if let Some\(provider @ Provider::Chocolatey \{ id \}\) = recipe\.chocolatey_provider\.as_ref\(\) \{[\s\S]*detect_chocolatey_package\(id\)\.installed[\s\S]*return provider;/,
    "Rust provider selection should fall back to Chocolatey when that package is installed.",
  );
  assert.match(
    installSource,
    /let verb = if already_installed \{[\s\S]*"upgrade"[\s\S]*\} else \{[\s\S]*"install"[\s\S]*\};/,
    "Chocolatey-backed updates should use choco upgrade instead of winget upgrade.",
  );
});

test("WinGet updates use full recipe detection before choosing the command verb", () => {
  assert.match(
    installSource,
    /fn install_winget\([\s\S]*recipe: &Recipe[\s\S]*detect_winget\(recipe\)\.installed[\s\S]*let verb = if already_installed/,
    "WinGet must retain AppX and other recipe aliases when deciding between install and upgrade.",
  );
  assert.doesNotMatch(
    installSource,
    /detect_winget_recipe_by_id\(winget_id\)\.installed/,
    "ID-only detection loses AppX package-family hints such as Claude Desktop's official MSIX identity.",
  );
});

test("GitHub-release fallback installs keep using the managed provider", () => {
  assert.match(
    installSource,
    /Provider::GithubRelease \{ \.\. \}\) = recipe\.download_provider\.as_ref\(\) \{[\s\S]*github_release_marker_path\(&recipe\.id\)\.exists\(\)[\s\S]*return provider;/,
    "Rust install selection should keep using a GitHub-release download provider once KKTerm has written its marker.",
  );
  assert.match(
    installSource,
    /fn default_winget_scope_for_recipe\([\s\S]*detect_one\(recipe\)\.install_scope/,
    "WinGet updates should inherit the detected install scope instead of always defaulting to user scope.",
  );
  assert.match(
    latestVersionSource,
    /Provider::GithubRelease \{ \.\. \}\) = recipe\.download_provider\.as_ref\(\) \{[\s\S]*github_release_marker_path\(&recipe\.id\)\.exists\(\)[\s\S]*return provider;/,
    "Latest-version checks should use the GitHub-release provider for managed fallback installs.",
  );
});

import { resolveInstallPlan } from "./dag";
import type { Catalog, Recipe } from "./types";

function wingetRecipe(id: string, wingetId: string): Recipe {
  return {
    id,
    name: id,
    descriptionEn: id,
    category: "utilities",
    icon: "Package",
    provider: { kind: "winget", id: wingetId },
    options: ["scope"],
  };
}

const catalog: Catalog = {
  schemaVersion: 1,
  generatedAt: "2026-05-31",
  recipes: [
    wingetRecipe("git", "Git.Git"),
    wingetRecipe("nvm-windows", "CoreyButler.NVMforWindows"),
    {
      id: "node-bundle",
      name: "Node (nvm-windows)",
      descriptionEn: "Node (nvm-windows)",
      category: "runtime",
      icon: "Boxes",
      provider: { kind: "bundle", steps: ["nvm-windows"] },
    },
    wingetRecipe("ripgrep", "BurntSushi.ripgrep.MSVC"),
    {
      id: "antigravity-cli",
      name: "Antigravity CLI",
      descriptionEn: "Antigravity CLI",
      category: "ai-agent",
      icon: "Bot",
      provider: {
        kind: "downloadInstaller",
        url: "https://antigravity.google/cli/install.cmd",
        fileName: "antigravity-cli-install.cmd",
      },
    },
  ],
};

const gitPlan = resolveInstallPlan("git", catalog, {}, { scope: "user" });
if (gitPlan.uacPromptEstimate !== 1) {
  throw new Error(
    `Git for Windows should warn about self-elevation in user scope; got ${gitPlan.uacPromptEstimate}`,
  );
}

const nvmPlan = resolveInstallPlan("nvm-windows", catalog, {}, { scope: "user" });
if (nvmPlan.uacPromptEstimate !== 1) {
  throw new Error(
    `nvm-windows should warn about self-elevation in user scope; got ${nvmPlan.uacPromptEstimate}`,
  );
}

const nodeBundlePlan = resolveInstallPlan("node-bundle", catalog, {}, {});
if (nodeBundlePlan.uacPromptEstimate !== 1) {
  throw new Error(
    `Node bundle should inherit the nvm-windows self-elevation warning; got ${nodeBundlePlan.uacPromptEstimate}`,
  );
}

const ripgrepPlan = resolveInstallPlan("ripgrep", catalog, {}, { scope: "user" });
if (ripgrepPlan.uacPromptEstimate !== 0) {
  throw new Error(
    `Ordinary user-scope winget installs should not warn about UAC; got ${ripgrepPlan.uacPromptEstimate}`,
  );
}

const antigravityPlan = resolveInstallPlan("antigravity-cli", catalog, {}, {});
if (antigravityPlan.uacPromptEstimate !== 0) {
  throw new Error(
    `Antigravity CLI's user-local command installer should not warn about UAC; got ${antigravityPlan.uacPromptEstimate}`,
  );
}

const downloadableWingetRecipe: Recipe = {
  id: "downloadable-winget-app",
  name: "Downloadable winget app",
  descriptionEn: "Downloadable winget app",
  category: "utilities",
  icon: "Package",
  needs: ["winget"],
  provider: { kind: "winget", id: "Example.App" },
  downloadProvider: {
    kind: "downloadInstaller",
    url: "https://example.test/app.exe",
    fileName: "app.exe",
  },
  options: ["provider"],
};

const catalogWithDownloadProvider: Catalog = {
  schemaVersion: 1,
  generatedAt: "2026-05-31",
  recipes: [
    {
      id: "winget",
      name: "winget",
      descriptionEn: "winget",
      category: "essentials",
      icon: "Package",
      provider: {
        kind: "downloadInstaller",
        url: "https://example.test/winget.msixbundle",
        fileName: "winget.msixbundle",
      },
    },
    downloadableWingetRecipe,
  ],
};

const defaultProviderPlan = resolveInstallPlan(
  "downloadable-winget-app",
  catalogWithDownloadProvider,
  {},
  { provider: "default" },
);
if (!defaultProviderPlan.actionable.some((step) => step.recipe.id === "winget")) {
  throw new Error(
    "Default provider installs should still include winget as a prerequisite.",
  );
}

const downloadProviderPlan = resolveInstallPlan(
  "downloadable-winget-app",
  catalogWithDownloadProvider,
  {},
  { provider: "download" },
);
if (downloadProviderPlan.actionable.some((step) => step.recipe.id === "winget")) {
  throw new Error(
    "Download provider installs should not include winget as a prerequisite.",
  );
}

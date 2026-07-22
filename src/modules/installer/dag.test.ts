import { resolveInstallPlan } from "./dag";
import type { Catalog, Recipe } from "./types";

function wingetRecipe(id: string, wingetId: string): Recipe {
  return {
    id,
    name: id,
    section: "internal",
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
      section: "internal",
      descriptionEn: "Node (nvm-windows)",
      category: "runtime",
      icon: "Boxes",
      provider: { kind: "bundle", steps: ["nvm-windows"] },
    },
    wingetRecipe("ripgrep", "BurntSushi.ripgrep.MSVC"),
    {
      id: "antigravity-cli",
      name: "Antigravity CLI",
      section: "internal",
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
  section: "internal",
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


const githubReleaseDownloadableWingetRecipe: Recipe = {
  id: "github-release-downloadable-winget-app",
  name: "GitHub release downloadable winget app",
  section: "internal",
  descriptionEn: "GitHub release downloadable winget app",
  category: "utilities",
  icon: "Package",
  needs: ["winget"],
  provider: { kind: "winget", id: "Example.GithubReleaseApp" },
  downloadProvider: {
    kind: "githubRelease",
    repo: "example/app",
    assetPattern: "app-*.zip",
    layout: "zip",
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
      section: "internal",
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
    githubReleaseDownloadableWingetRecipe,
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

const githubReleaseDownloadProviderPlan = resolveInstallPlan(
  "github-release-downloadable-winget-app",
  catalogWithDownloadProvider,
  {},
  { provider: "download" },
);
if (
  githubReleaseDownloadProviderPlan.actionable.some(
    (step) => step.recipe.id === "winget",
  )
) {
  throw new Error(
    "GitHub-release download provider installs should not include winget as a prerequisite.",
  );
}

const npmBackedWingetRecipe: Recipe = {
  id: "npm-backed-winget-app",
  name: "npm-backed winget app",
  section: "internal",
  descriptionEn: "npm-backed winget app",
  category: "utilities",
  icon: "Package",
  needs: ["winget"],
  provider: { kind: "winget", id: "Example.App" },
  npmProvider: { kind: "npm", pkg: "@example/app" },
  options: ["provider", "version"],
};

const catalogWithNpmProvider: Catalog = {
  schemaVersion: 1,
  recipes: [
    {
      id: "winget",
      name: "winget",
      section: "internal",
      descriptionEn: "winget",
      provider: {
        kind: "downloadInstaller",
        url: "https://example.test/winget.msixbundle",
        fileName: "winget.msixbundle",
      },
    },
    {
      id: "node-bundle",
      name: "Node",
      section: "internal",
      descriptionEn: "Node",
      provider: { kind: "bundle", steps: [] },
    },
    npmBackedWingetRecipe,
  ],
};

const defaultNpmBackedPlan = resolveInstallPlan(
  "npm-backed-winget-app",
  catalogWithNpmProvider,
  {},
  { provider: "default" },
);
if (
  !defaultNpmBackedPlan.actionable.some((step) => step.recipe.id === "winget") ||
  defaultNpmBackedPlan.actionable.some((step) => step.recipe.id === "node-bundle")
) {
  throw new Error("The default provider should require winget, not Node.");
}

const npmProviderPlan = resolveInstallPlan(
  "npm-backed-winget-app",
  catalogWithNpmProvider,
  {},
  { provider: "npm" },
);
if (
  !npmProviderPlan.actionable.some((step) => step.recipe.id === "node-bundle") ||
  npmProviderPlan.actionable.some((step) => step.recipe.id === "winget")
) {
  throw new Error("The npm provider should require Node instead of winget.");
}

const chocolateyBackedWingetRecipe: Recipe = {
  id: "choco-backed-winget-app",
  name: "Chocolatey-backed winget app",
  section: "internal",
  descriptionEn: "Chocolatey-backed winget app",
  category: "utilities",
  icon: "Package",
  needs: ["winget"],
  provider: { kind: "winget", id: "Example.App" },
  chocolateyProvider: { kind: "chocolatey", id: "example-app" },
  options: ["provider"],
};

const catalogWithChocolateyProvider: Catalog = {
  schemaVersion: 1,
  generatedAt: "2026-06-26",
  recipes: [
    {
      id: "winget",
      name: "winget",
      section: "internal",
      descriptionEn: "winget",
      category: "essentials",
      icon: "Package",
      provider: {
        kind: "downloadInstaller",
        url: "https://example.test/winget.msixbundle",
        fileName: "winget.msixbundle",
      },
    },
    {
      id: "chocolatey",
      name: "Chocolatey",
      section: "internal",
      descriptionEn: "Chocolatey",
      category: "windows-power-user",
      icon: "Package",
      needs: ["winget"],
      provider: { kind: "winget", id: "Chocolatey.Chocolatey" },
      downloadProvider: {
        kind: "downloadInstaller",
        url: "https://community.chocolatey.org/install.ps1",
        fileName: "chocolatey-install.ps1",
      },
      options: ["provider"],
    },
    chocolateyBackedWingetRecipe,
  ],
};

const directChocolateyPlan = resolveInstallPlan(
  "chocolatey",
  catalogWithChocolateyProvider,
  {},
  { provider: "download" },
);
if (directChocolateyPlan.actionable.some((step) => step.recipe.id === "winget")) {
  throw new Error(
    "Chocolatey's direct installer should not require winget.",
  );
}

const chocolateyProviderPlan = resolveInstallPlan(
  "choco-backed-winget-app",
  catalogWithChocolateyProvider,
  {},
  { provider: "chocolatey" },
);
if (
  !chocolateyProviderPlan.actionable.some(
    (step) => step.recipe.id === "chocolatey",
  )
) {
  throw new Error(
    "Chocolatey provider installs should include Chocolatey as a prerequisite when missing.",
  );
}

const installedChocolateyProviderPlan = resolveInstallPlan(
  "choco-backed-winget-app",
  catalogWithChocolateyProvider,
  {
    chocolatey: {
      installed: true,
      installedVersion: "2.7.3",
      partialCount: null,
    },
  },
  { provider: "chocolatey" },
);
if (
  installedChocolateyProviderPlan.actionable.some(
    (step) => step.recipe.id === "winget" || step.recipe.id === "chocolatey",
  )
) {
  throw new Error(
    "Installed Chocolatey should satisfy the Chocolatey provider prerequisite without pulling winget.",
  );
}

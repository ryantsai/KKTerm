import type { DetectedState, Provider, Recipe } from "./types";

export function providerSupportsLatestVersion(provider: Provider): boolean {
  switch (provider.kind) {
    case "winget":
    case "chocolatey":
    case "uvPip":
    case "githubRelease":
      return true;
    case "npm":
      return !provider.pkg.startsWith("github:");
    case "bundle":
      return provider.steps.length === 1;
    case "downloadInstaller":
      return Boolean(provider.githubRepo && provider.githubAssetPattern);
    case "windowsFeature":
    case "wslDistro":
      return false;
  }
}

export function recipeSupportsLatestVersion(recipe: Recipe): boolean {
  if (
    recipe.provider.kind === "npm" &&
    recipe.provider.pkg.startsWith("github:")
  ) {
    return githubReleasesRepoFromUrl(recipe.releaseNotesUrl) !== null;
  }
  return providerSupportsLatestVersion(recipe.provider);
}

export function recipeSupportsManagedLatestVersion(
  recipe: Recipe,
  detected?: DetectedState | null,
): boolean {
  // Receipt-backed uv is the one source-specific exception: the backend checks
  // Astral's release channel and runs the exact binary's `uv self update`.
  // Keep every other unmanaged source away from the catalog provider route.
  const supportsOfficialUvUpdate =
    recipe.id === "uv" ||
    (recipe.provider.kind === "bundle" &&
      recipe.provider.steps.length === 1 &&
      recipe.provider.steps[0] === "uv");
  return (
    (detected?.installSource !== "officialScript" ||
      supportsOfficialUvUpdate) &&
    recipeSupportsLatestVersion(recipe)
  );
}

export function latestVersionWebUrlForRecipe(recipe: Recipe): string | null {
  if (recipeSupportsLatestVersion(recipe)) return null;
  if (recipe.provider.kind === "downloadInstaller") {
    return recipe.provider.url;
  }
  return null;
}

function githubReleasesRepoFromUrl(url?: string): string | null {
  const match = url?.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases(?:\/|$)/,
  );
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

// Dependency graph helpers for the Installer Helper Module.
//
// All functions are pure and operate on the cached catalog + detection map.
// The catalog has already passed cycle detection in the Rust loader
// (ADR 0007 §"Recipe shape"), so recursion is safe without a depth limit.
//
// Bundles are first-class members of the graph: a bundle is "installed"
// iff every step is installed (see Rust detect.rs). The DAG walker treats
// bundles as single nodes for dependency purposes — leaves are looked up
// only inside `expandStepsForInstall`.

import type { Catalog, DetectedState, InstallOptions, Recipe } from "./types";

/// One scheduled install. The order of an `InstallPlan.steps` array is the
/// order the user will see prerequisites confirmed in the dialog, and the
/// order the Rust side dispatches them.
export interface PlanStep {
  recipe: Recipe;
  isPrerequisite: boolean;
}

export interface InstallPlan {
  /// In dependency-first order. The last element is the user-clicked recipe.
  steps: PlanStep[];
  /// Subset of `steps` that are NOT yet installed and will actually run.
  /// Already-installed prereqs are kept in `steps` for display ("already
  /// installed — skip"), but `actionable` is what gets passed to commands.
  actionable: PlanStep[];
  /// Estimated maximum UAC prompts across the whole plan.
  uacPromptEstimate: number;
}

/// Resolve transitive `needs` for `targetRecipeId`, returning a deterministic
/// install plan. Already-installed prereqs are detected via `detected` and
/// excluded from `actionable`. Bundles are NOT expanded into their step
/// recipes — the Rust side handles step iteration. We only expand them for
/// detection purposes.
export function resolveInstallPlan(
  targetRecipeId: string,
  catalog: Catalog,
  detected: Record<string, DetectedState>,
  options?: InstallOptions,
): InstallPlan {
  const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
  const order: Recipe[] = [];
  const seen = new Set<string>();

  function visit(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    const recipe = byId.get(id);
    if (!recipe) return;
    const recipeOptions = id === targetRecipeId ? options : undefined;
    for (const need of effectiveNeedsFor(recipe, recipeOptions)) {
      visit(need);
    }
    order.push(recipe);
  }

  visit(targetRecipeId);

  const steps: PlanStep[] = order.map((recipe) => ({
    recipe,
    isPrerequisite: recipe.id !== targetRecipeId,
  }));

  const actionable = steps.filter(
    (step) =>
      step.recipe.id === targetRecipeId || !detected[step.recipe.id]?.installed,
  );

  const actionableIds = new Set(actionable.map((step) => step.recipe.id));
  const uacPromptEstimate = actionable.reduce(
    (sum, step) =>
      sum +
      estimateUacPromptsFor(
        step.recipe,
        step.recipe.id === targetRecipeId ? options : undefined,
        byId,
        detected,
        actionableIds,
      ),
    0,
  );

  return { steps, actionable, uacPromptEstimate };
}

function effectiveNeedsFor(recipe: Recipe, options?: InstallOptions): string[] {
  const needs = recipe.needs ?? [];
  if (
    options?.provider === "download" &&
    recipe.provider.kind === "winget" &&
    recipe.downloadProvider?.kind === "downloadInstaller"
  ) {
    return needs.filter((need) => need !== "winget");
  }
  return needs;
}

/// Reverse-DAG: for `targetRecipeId`, find every catalog recipe whose
/// `needs` includes this id AND whose detected state is `installed`.
/// Bundles that include this id as a step are returned only when the
/// bundle's own detection says "installed".
///
/// Used by uninstall to warn the user about breaking dependents.
export function findInstalledDependents(
  targetRecipeId: string,
  catalog: Catalog,
  detected: Record<string, DetectedState>,
): Recipe[] {
  const dependents: Recipe[] = [];
  for (const recipe of catalog.recipes) {
    if (recipe.id === targetRecipeId) continue;
    const dependsOn =
      (recipe.needs ?? []).includes(targetRecipeId) ||
      (recipe.provider.kind === "bundle" &&
        recipe.provider.steps.includes(targetRecipeId));
    if (!dependsOn) continue;
    if (detected[recipe.id]?.installed) {
      dependents.push(recipe);
    }
  }
  return dependents;
}

/// Per-recipe UAC heuristic. Returns the number of UAC prompts a single
/// install of this recipe is expected to trigger.
///
///   * winget with explicit scope=machine → 1
///   * winget with scope=user → 0 for most packages, but some installers
///     (Git for Windows, nvm-windows, Docker Desktop, system MSIs) still
///     self-elevate. Known self-elevating winget ids count as 1.
///   * windows-feature → 1 (DISM always requires admin)
///   * github-release MSI/EXE → 1 if the installer self-elevates; 0 for
///     zip-extract.
///   * bundle → sum not-yet-installed bundle steps that are not already
///     direct actionable plan steps.
///   * npm → 0.
function estimateUacPromptsFor(
  recipe: Recipe,
  options?: InstallOptions,
  byId?: Map<string, Recipe>,
  detected?: Record<string, DetectedState>,
  directlyActionableIds?: Set<string>,
): number {
  const provider =
    options?.provider === "download" &&
    recipe.downloadProvider?.kind === "downloadInstaller"
      ? recipe.downloadProvider
      : recipe.provider;

  switch (provider.kind) {
    case "winget": {
      if (options?.scope === "machine") return 1;
      return isKnownSelfElevatingWingetRecipe(recipe) ? 1 : 0;
    }
    case "windowsFeature":
      return 1;
    case "wslDistro":
      return 0;
    case "githubRelease":
      return provider.layout === "zip" ? 0 : 1;
    case "npm":
      return 0;
    case "uvPip":
      return 0;
    case "downloadInstaller":
      if (recipe.id === "antigravity-cli") return 0;
      return 1;
    case "bundle":
      return provider.steps.reduce((sum, stepId) => {
        if (directlyActionableIds?.has(stepId)) return sum;
        if (detected?.[stepId]?.installed) return sum;
        const stepRecipe = byId?.get(stepId);
        return stepRecipe
          ? sum +
              estimateUacPromptsFor(
                stepRecipe,
                undefined,
                byId,
                detected,
                directlyActionableIds,
              )
          : sum;
      }, 0);
  }
}

/// Known winget packages whose current upstream manifests declare a user
/// scope but still self-elevate their installer. Keep this conservative:
/// over-estimates are acceptable for the "up to N prompts" warning, while
/// under-estimates make the per-user option look more UAC-free than it is.
export function isKnownSelfElevatingWingetRecipe(recipe: Recipe): boolean {
  if (recipe.provider.kind !== "winget") return false;
  const id = recipe.provider.id.toLowerCase();
  const selfElevating = [
    "coreybutler.nvmforwindows",
    "docker.dockerdesktop",
    "git.git",
    "oracle.virtualbox",
    "vmware.workstationpro",
  ];
  return selfElevating.some((needle) => id.includes(needle));
}

/// Returns true iff the recipe represents WSL (the windows-feature whose
/// install triggers the reboot-gating UX described in ADR 0007 §"Execution
/// constraints").
export function isWslFeature(recipe: Recipe): boolean {
  return (
    recipe.provider.kind === "windowsFeature" &&
    recipe.provider.feature
      .toLowerCase()
      .includes("microsoft-windows-subsystem-linux")
  );
}

/// Returns true iff the recipe depends transitively on WSL.
export function recipeNeedsWsl(recipe: Recipe, catalog: Catalog): boolean {
  const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
  const seen = new Set<string>();
  function check(id: string): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    const r = byId.get(id);
    if (!r) return false;
    if (isWslFeature(r)) return true;
    return (r.needs ?? []).some(check);
  }
  return (recipe.needs ?? []).some(check);
}

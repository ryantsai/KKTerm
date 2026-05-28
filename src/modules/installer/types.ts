// TypeScript mirror of the Rust types in src-tauri/src/installer/.
// Any change here must be matched in the Rust side. See ADR 0007.

export type ProviderKind =
  | "winget"
  | "npm"
  | "githubRelease"
  | "windowsFeature"
  | "bundle";

export type GithubReleaseLayout = "zip" | "exeInstaller" | "msi";

export type RecipeOption = "scope" | "version" | "location" | "addToPath";

export type Provider =
  | { kind: "winget"; id: string }
  | { kind: "npm"; pkg: string }
  | {
      kind: "githubRelease";
      repo: string;
      assetPattern: string;
      layout: GithubReleaseLayout;
    }
  | { kind: "windowsFeature"; feature: string; reboot?: boolean }
  | { kind: "bundle"; steps: string[] };

export interface Recipe {
  id: string;
  name: string;
  descriptionEn: string;
  descriptionLocales?: Record<string, string>;
  needs?: string[];
  icon?: string;
  category?: string;
  provider: Provider;
  options?: RecipeOption[];
}

export interface Catalog {
  schemaVersion: number;
  generatedAt?: string;
  recipes: Recipe[];
}

export interface DetectedState {
  installed: boolean;
  installedVersion: string | null;
  partialCount: [number, number] | null;
}

export interface ToolState {
  toolId: string;
  pinned: boolean;
  latestVersionSeen: string | null;
  lastCheckAt: number | null;
}

export interface InstallOptions {
  scope?: "user" | "machine";
  version?: string;
  location?: string;
  addToPath?: boolean;
}

export type ProgressEvent =
  | { kind: "step"; toolId: string; message: string }
  | { kind: "stdout"; toolId: string; line: string }
  | { kind: "stderr"; toolId: string; line: string }
  | { kind: "progress"; toolId: string; ratio: number }
  | {
      kind: "completed";
      toolId: string;
      installedVersion: string | null;
    }
  | { kind: "failed"; toolId: string; message: string }
  | { kind: "cancelled"; toolId: string };

export const PROGRESS_EVENT_NAME = "installer://progress";

/// Localized display name lookup with safe English fallback.
export function localizedDescription(recipe: Recipe, localeId: string): string {
  return (
    recipe.descriptionLocales?.[localeId] ??
    recipe.descriptionEn ??
    ""
  );
}

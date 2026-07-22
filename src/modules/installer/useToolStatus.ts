// Shared status / version derivation for one Install Helper tool. Extracted
// from ToolRow so the Gallery tile, the List row, and the sidebar rail counts
// all agree on a single source of truth.
//
// `deriveToolStatus` is a pure function over store slices so callers that need
// the status of *many* recipes at once (the sidebar counts) can compute it in a
// loop without violating the rules of hooks. `useToolStatus` is the per-recipe
// hook that reads the store and forwards to it.

import { useInstallerStore } from "./state";
import { recipeSupportsManagedLatestVersion } from "./latestSupport";
import { isInstallerUpdateAvailable } from "./versionCompare";
import {
  type DetectedState,
  type Recipe,
  type ToolState,
} from "./types";

export type StatusTone =
  | "installed"
  | "update"
  | "busy"
  | "failed"
  | "partial"
  | "none";

export interface ToolStatus {
  isInstalled: boolean;
  installedVersion: string | null | undefined;
  partial: [number, number] | null | undefined;
  latestSeen: string | null | undefined;
  latestError: string | null | undefined;
  runtimeVersion: string | null | undefined;
  supportsLatestVersion: boolean;
  hasUpdate: boolean;
  busy: boolean;
  operation: "install" | "uninstall" | null;
  retrieving: boolean;
  statusTone: StatusTone;
}

export interface ToolStatusInputs {
  detected?: DetectedState;
  toolState?: ToolState;
  operation: "install" | "uninstall" | null;
  latestError: string | null | undefined;
  lastFailed: boolean;
  scanning: boolean;
  /// Whether *this* tool's latest-version lookup is currently in flight.
  /// Scoped per-tool (not the store's global `checking` flag) so a check
  /// targeting one tool does not flip every card into the retrieving state.
  checking: boolean;
}

export function deriveToolStatus(
  recipe: Recipe,
  inputs: ToolStatusInputs,
): ToolStatus {
  const isInstalled = inputs.detected?.installed ?? false;
  const installedVersion = inputs.detected?.installedVersion;
  const partial = inputs.detected?.partialCount;
  const supportsLatestVersion = recipeSupportsManagedLatestVersion(
    recipe,
    inputs.detected,
  );
  // Ignore cached WinGet values for an externally managed copy. Otherwise a
  // previous detection pass can leave a misleading latest/error value visible
  // even though KKTerm has intentionally disabled that management channel.
  const latestSeen = supportsLatestVersion
    ? inputs.toolState?.latestVersionSeen
    : null;
  const hasUpdate =
    supportsLatestVersion &&
    isInstalled &&
    isInstallerUpdateAvailable(latestSeen, installedVersion);
  const busy = inputs.operation !== null;
  const retrieving = !busy && (inputs.scanning || inputs.checking);

  const statusTone: StatusTone = busy
    ? "busy"
    : inputs.lastFailed
      ? "failed"
      : hasUpdate
        ? "update"
        : isInstalled
          ? "installed"
          : partial
            ? "partial"
            : "none";

  return {
    isInstalled,
    installedVersion,
    partial,
    latestSeen,
    latestError: supportsLatestVersion ? inputs.latestError : null,
    runtimeVersion: inputs.detected?.runtimeVersion,
    supportsLatestVersion,
    hasUpdate,
    busy,
    operation: inputs.operation,
    retrieving,
    statusTone,
  };
}

export function useToolStatus(recipe: Recipe): ToolStatus {
  const detected = useInstallerStore((s) => s.detected[recipe.id]);
  const toolState = useInstallerStore((s) => s.toolState[recipe.id]);
  const inFlight = useInstallerStore((s) => s.inFlight[recipe.id]);
  const lastStatus = useInstallerStore((s) => s.lastStatus[recipe.id]);
  const latestError = useInstallerStore((s) => s.checkError[recipe.id]);
  const scanning = useInstallerStore((s) => s.scanning);
  const checking = useInstallerStore((s) => s.checkingToolIds.has(recipe.id));

  return deriveToolStatus(recipe, {
    detected,
    toolState,
    operation: inFlight?.operation ?? null,
    latestError,
    lastFailed: lastStatus?.kind === "failed",
    scanning,
    checking,
  });
}

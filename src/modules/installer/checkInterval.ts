// Shared definition of the Install Helper auto update-check interval.
//
// The Install Helper does not re-fetch the latest available versions on
// every Module entry. Instead it refreshes at most once per interval: when the
// Module becomes active it compares the last completed check-attempt timestamp
// against this interval and only re-checks when the interval has elapsed. The
// chosen interval is persisted as `installerCheckIntervalSeconds` in General
// Settings.
//
// Valid options must stay in sync with the Rust validation in
// `src-tauri/src/storage.rs` (`validate_general_settings`).

export const INSTALLER_CHECK_INTERVAL_OPTIONS = [
  3600, // 1 hour
  86400, // 1 day (default)
  604800, // 1 week
  2592000, // 1 month (30 days)
] as const;

export const DEFAULT_INSTALLER_CHECK_INTERVAL_SECONDS = 86400;

// Clamp an arbitrary stored value to a known option, falling back to the
// default when the value is missing or not one of the supported choices.
export function resolveInstallerCheckIntervalSeconds(
  value: number | undefined,
): number {
  return value !== undefined &&
    (INSTALLER_CHECK_INTERVAL_OPTIONS as readonly number[]).includes(value)
    ? value
    : DEFAULT_INSTALLER_CHECK_INTERVAL_SECONDS;
}

export function shouldRunInstallerAutomaticCheck({
  lastCheckAt,
  intervalSeconds,
  nowSeconds = Date.now() / 1000,
}: {
  lastCheckAt: number | null;
  intervalSeconds: number;
  nowSeconds?: number;
}): boolean {
  return (
    lastCheckAt === null || nowSeconds - lastCheckAt >= intervalSeconds
  );
}

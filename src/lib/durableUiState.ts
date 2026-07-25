// Durable frontend UI state.
//
// Historically the workspace kept a handful of *durable* user-authored things
// in `localStorage` — Quick Commands, Child Connection Tabs, Notes widget
// content, file-browser favorites, remembered CLI account labels, and IT Ops
// room layout. `localStorage` is the untracked tier: it is not in the SQLite
// backup/export and is not cleared by "Reset All Settings", so that data was
// lost on reinstall and orphaned on delete.
//
// This module makes SQLite the durable source of truth while keeping the
// existing *synchronous* read sites working: `localStorage` is now a fast cache
// mirror, and every write also writes through to SQLite (debounced). At startup
// `hydrateDurableUiState()` reconciles the two — pushing every cached value to
// the database (legacy import + catching any missed flush) and pulling database
// rows the cache lacks (restore-on-reinstall). The `localStorage` key and the
// database key are identical, so the two tiers stay aligned.

import { invokeCommand, isTauriRuntime } from "./tauri";

// Namespaces this module owns. A key is "durable" when it equals one of these
// or begins with one (the per-id families end in a separator). Keep in sync
// with the reset flow in GeneralSettings and the constants that produce them.
export const DURABLE_UI_STATE_PREFIXES = [
  "kkterm.quickCommands.",
  "kkterm.quickCommandBundles.v1",
  "kkterm.quickCommandBundleSelection.",
  "kkterm.workspace.childConnections.v1",
  "kkterm.dashboard.notes.",
  "kkterm.fileBrowserFavorites.v1",
  "kkterm.cliAccountLabels.v1",
  "kkterm.installerLauncherRecentPaths.v1",
  "kkterm.installerLauncherOptions.v1",
  "kkterm.installerGuiLauncherPaths.v1",
  "kkterm.itopsFreePlacement",
  "kkterm.itopsRackFacing",
  "kkterm.itopsRoomObjects",
] as const;

const DB_FLUSH_DELAY_MS = 400;
const pendingFlushes = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; value: string }
>();

function isDurableKey(key: string): boolean {
  return DURABLE_UI_STATE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Read a durable value synchronously from the cache. */
export function readDurableUiState(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function flushToDatabase(key: string, value: string) {
  if (!isTauriRuntime()) {
    return;
  }
  const existing = pendingFlushes.get(key);
  if (existing) {
    clearTimeout(existing.timer);
  }
  const timer = setTimeout(() => {
    pendingFlushes.delete(key);
    void invokeCommand("set_durable_ui_state", { key, value }).catch(() => {
      // The cache still holds the value; startup hydration re-syncs it.
    });
  }, DB_FLUSH_DELAY_MS);
  pendingFlushes.set(
    key,
    { timer, value },
  );
}

/** Persist every queued write before a database snapshot/export reads it. */
export async function flushDurableUiState(): Promise<void> {
  if (!isTauriRuntime() || pendingFlushes.size === 0) {
    return;
  }
  const pending = [...pendingFlushes.entries()];
  for (const [key, { timer }] of pending) {
    clearTimeout(timer);
    pendingFlushes.delete(key);
  }
  await Promise.all(
    pending.map(([key, { value }]) =>
      invokeCommand("set_durable_ui_state", { key, value }),
    ),
  );
}

/** Replace one cache namespace from SQLite after an in-process database import. */
export async function reloadDurableUiStatePrefix(prefix: string): Promise<void> {
  if (typeof window === "undefined" || !isTauriRuntime()) {
    return;
  }
  for (const [key, pending] of pendingFlushes) {
    if (key.startsWith(prefix)) {
      clearTimeout(pending.timer);
      pendingFlushes.delete(key);
    }
  }
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(prefix)) {
      window.localStorage.removeItem(key);
    }
  }
  const records = await invokeCommand("list_durable_ui_state", { prefix });
  for (const record of records) {
    if (record.key.startsWith(prefix)) {
      window.localStorage.setItem(record.key, record.value);
    }
  }
}

/** Write a durable value: update the cache now, write through to SQLite soon. */
export function writeDurableUiState(key: string, value: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Cache may be unavailable (private mode, quota); the DB write still runs.
    }
  }
  flushToDatabase(key, value);
}

/** Remove one durable entry from both tiers. */
export function removeDurableUiState(key: string): void {
  const pending = pendingFlushes.get(key);
  if (pending) {
    clearTimeout(pending.timer);
    pendingFlushes.delete(key);
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  if (isTauriRuntime()) {
    void invokeCommand("delete_durable_ui_state", { key }).catch(() => {});
  }
}

/** Remove every durable entry whose key starts with `prefix`, from both tiers.
 *  Backs per-connection cleanup on delete and the Settings reset. */
export async function clearDurableUiStateByPrefix(prefix: string): Promise<void> {
  for (const [key, pending] of pendingFlushes) {
    if (key.startsWith(prefix)) {
      clearTimeout(pending.timer);
      pendingFlushes.delete(key);
    }
  }
  if (typeof window !== "undefined") {
    try {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key && key.startsWith(prefix)) {
          window.localStorage.removeItem(key);
        }
      }
    } catch {
      // ignore
    }
  }
  if (isTauriRuntime()) {
    await invokeCommand("delete_durable_ui_state_by_prefix", { prefix }).catch(() => {});
  }
}

/** Clear every durable UI-state namespace from both tiers. Used by the Settings
 *  "Reset All Settings" flow so durable frontend data is wiped alongside the
 *  database-backed settings, instead of surviving as orphaned local state. */
export async function resetDurableUiState(): Promise<void> {
  await Promise.all(
    DURABLE_UI_STATE_PREFIXES.map((prefix) => clearDurableUiStateByPrefix(prefix)),
  );
}

function cachedDurableKeys(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const keys: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && isDurableKey(key)) {
        keys.push(key);
      }
    }
  } catch {
    return [];
  }
  return keys;
}

/**
 * Reconcile the cache and the database once at startup.
 *
 * Local-wins merge: every cached durable value is pushed to SQLite (this both
 * imports legacy `localStorage`-only data and flushes anything a previous
 * session left unsynced), and any database row the cache is missing is pulled
 * into the cache (restoring data after a reinstall or database import). The
 * cache the user was just editing always wins when a key exists in both, so a
 * stale database row never clobbers a newer local edit.
 */
export async function hydrateDurableUiState(): Promise<void> {
  if (typeof window === "undefined" || !isTauriRuntime()) {
    return;
  }
  let records: { key: string; value: string }[];
  try {
    records = await invokeCommand("list_durable_ui_state", { prefix: "" });
  } catch {
    // Database unavailable (locked secret store, older backend): keep the cache.
    return;
  }
  const databaseValues = new Map<string, string>();
  for (const record of records) {
    // Preserve the previous first-match behavior if malformed input ever
    // contains duplicate keys: the first database row remains authoritative.
    if (!databaseValues.has(record.key)) {
      databaseValues.set(record.key, record.value);
    }
  }

  // Pull database rows the cache lacks.
  for (const record of records) {
    if (!isDurableKey(record.key)) {
      continue;
    }
    try {
      if (window.localStorage.getItem(record.key) === null) {
        window.localStorage.setItem(record.key, record.value);
      }
    } catch {
      // ignore
    }
  }

  // Push every cached durable value to the database (local wins).
  await Promise.all(
    cachedDurableKeys().map((key) => {
      const value = window.localStorage.getItem(key);
      if (value === null) {
        return Promise.resolve();
      }
      if (databaseValues.has(key) && databaseValues.get(key) === value) {
        return Promise.resolve();
      }
      return invokeCommand("set_durable_ui_state", { key, value }).catch(() => {});
    }),
  );
}

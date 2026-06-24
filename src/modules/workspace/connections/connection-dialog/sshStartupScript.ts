// Per-Connection preference for whether the SSH startup script should run again
// when KKTerm re-attaches to an already-running tmux session (off by default).
//
// The script body itself is a durable Connection field (`localStartupScript`).
// This single behavioural flag is niche and frontend-only — it only affects how
// the startup input is injected on the client — so it lives in localStorage keyed
// by Connection id rather than in the Connection record.
const STORAGE_KEY_PREFIX = "kkterm.sshStartupScriptApplyToExistingTmux.v1.";

function storageKey(connectionId: string) {
  return `${STORAGE_KEY_PREFIX}${connectionId}`;
}

export function readSshApplyStartupToExistingTmux(connectionId: string | undefined): boolean {
  if (!connectionId) {
    return false;
  }
  try {
    return localStorage.getItem(storageKey(connectionId)) === "true";
  } catch {
    return false;
  }
}

export function writeSshApplyStartupToExistingTmux(connectionId: string | undefined, value: boolean) {
  if (!connectionId) {
    return;
  }
  try {
    if (value) {
      localStorage.setItem(storageKey(connectionId), "true");
    } else {
      localStorage.removeItem(storageKey(connectionId));
    }
  } catch {
    // The startup script still runs on fresh sessions when storage is unavailable;
    // we just cannot persist the apply-on-attach override.
  }
}

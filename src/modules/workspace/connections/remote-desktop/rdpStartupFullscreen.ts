export type RdpFullscreenEntryOutcome = "applied" | "skipped";

export function isRdpStartupActivationCurrent(
  capturedGeneration: number,
  state: { appForeground: boolean; activationGeneration: number },
) {
  return state.appForeground && state.activationGeneration === capturedGeneration;
}

/**
 * Delays between full-screen display re-assertions, measured from entry.
 * The Display Control channel is not ready when `Connected = 1` arrives (ActiveX
 * rejects the update with 0x80020009, or the server drops it while the call
 * returns success), so a slow logon can outlast any settle anchored to connect
 * time. Entry therefore backs off over about half a minute instead.
 */
export const RDP_FULLSCREEN_SETTLE_DELAYS_MS = [1000, 2000, 3000, 5000, 8000, 12000] as const;

interface FullscreenDisplaySettle {
  /** False once the Session this settle was started for is gone. */
  isCurrent: () => boolean;
  /** False while the surface is hidden or covered; the pass is skipped, not the schedule. */
  canReassert: () => boolean;
  reassert: () => Promise<unknown>;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/**
 * Re-send the monitor-sized display after full-screen entry. A failed pass never
 * ends the schedule, because a rejected update is exactly what a not-yet-ready
 * channel produces. The native side skips the call once the control confirms
 * the size, so passes after that are cheap and cannot flicker the desktop.
 * Returns a function that stops the remaining passes.
 */
export function startRdpFullscreenDisplaySettle({
  isCurrent,
  canReassert,
  reassert,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: FullscreenDisplaySettle) {
  let stopped = false;
  let timer: unknown = null;
  const arm = (pass: number) => {
    const delay = RDP_FULLSCREEN_SETTLE_DELAYS_MS[pass];
    if (stopped || delay === undefined) return;
    timer = schedule(() => run(pass), delay);
  };
  const run = (pass: number) => {
    timer = null;
    if (stopped || !isCurrent()) return;
    if (!canReassert()) {
      arm(pass + 1);
      return;
    }
    void Promise.resolve()
      .then(reassert)
      .catch(() => undefined)
      .finally(() => arm(pass + 1));
  };
  arm(0);
  return () => {
    stopped = true;
    if (timer !== null) cancel(timer);
    timer = null;
  };
}

interface StartupFullscreenAttempt {
  isEligible: () => boolean;
  enter: () => Promise<RdpFullscreenEntryOutcome>;
  canRetry: () => Promise<boolean>;
  finish: () => void;
  onError: (error: unknown) => void;
}

/** Keep launch intent until entry is acknowledged, without overlapping requests. */
export function createRdpStartupFullscreenAttempt() {
  let inFlight = false;
  return async ({ isEligible, enter, canRetry, finish, onError }: StartupFullscreenAttempt) => {
    if (inFlight || !isEligible()) return;
    inFlight = true;
    try {
      const outcome = await enter();
      if (outcome === "applied" || !(await canRetry())) finish();
    } catch (error) {
      finish();
      onError(error);
    } finally {
      inFlight = false;
    }
  };
}

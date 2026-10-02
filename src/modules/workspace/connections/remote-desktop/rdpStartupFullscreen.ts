export type RdpFullscreenEntryOutcome = "applied" | "skipped";

export function isRdpStartupActivationCurrent(
  capturedGeneration: number,
  state: { appForeground: boolean; activationGeneration: number },
) {
  return state.appForeground && state.activationGeneration === capturedGeneration;
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

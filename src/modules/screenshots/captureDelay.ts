export const CAPTURE_DELAYS = [0, 3, 5, 15, 30, 60] as const;

const DELAY_STORAGE_KEY = "kkterm.screenshotsCaptureDelay.v1";

/** Only owns Esc while waiting; the native picker owns cancellation afterwards. */
export function waitForCaptureDelay(delaySeconds: number): Promise<void> {
  if (delaySeconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown, true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cleanup();
      reject(new Error("capture canceled"));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delaySeconds * 1000);
    window.addEventListener("keydown", onKeyDown, true);
  });
}

export function readCaptureDelay() {
  try {
    const parsed = Number(localStorage.getItem(DELAY_STORAGE_KEY));
    return CAPTURE_DELAYS.includes(parsed as (typeof CAPTURE_DELAYS)[number]) ? parsed : 0;
  } catch {
    return 0;
  }
}

export function writeCaptureDelay(delaySeconds: number) {
  try {
    localStorage.setItem(DELAY_STORAGE_KEY, String(delaySeconds));
  } catch {
    // Module preferences are best-effort.
  }
}

export const CAPTURE_DELAYS = [0, 3, 5, 15, 30, 60] as const;

const DELAY_STORAGE_KEY = "kkterm.screenshotsCaptureDelay.v1";

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

export type ShutdownTimerStatus = {
  phase: "scheduled" | "warning";
  scheduledForUnixMs: number;
  shutdownAtUnixMs: number;
};

export const shutdownTimerDelaysMinutes = [15, 30, 60, 120, 240, 480, 1_440] as const;

export function shutdownTimerTargetUnixMs(status: ShutdownTimerStatus) {
  return status.phase === "warning"
    ? status.shutdownAtUnixMs
    : status.scheduledForUnixMs;
}

export function formatShutdownTimerRemaining(
  status: ShutdownTimerStatus,
  nowUnixMs = Date.now(),
) {
  const remainingSeconds = Math.max(
    0,
    Math.ceil((shutdownTimerTargetUnixMs(status) - nowUnixMs) / 1_000),
  );
  const hours = Math.floor(remainingSeconds / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  if (hours > 0) {
    return `${hours}:${padTime(minutes)}:${padTime(seconds)}`;
  }
  return `${padTime(minutes)}:${padTime(seconds)}`;
}

export function formatShutdownTimerDuration(minutes: number, locale: string) {
  const useHours = minutes >= 60 && minutes % 60 === 0;
  const value = useHours ? minutes / 60 : minutes;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: useHours ? "hour" : "minute",
    unitDisplay: "long",
  }).format(value);
}

function padTime(value: number) {
  return String(value).padStart(2, "0");
}

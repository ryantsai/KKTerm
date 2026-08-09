const NICE_SCALES = [0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export type VideoTimelineLayout = {
  scale: number;
  scaleCount: number;
  scaleWidth: number;
  startLeft: number;
  timelineEnd: number;
};

export function videoTimelineLayout(
  mediaDuration: number,
  availableWidth: number,
): VideoTimelineLayout {
  const duration = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : 1;
  const width = Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : 0;
  const startLeft = 8;
  const targetScale = duration / 9;
  const scale = NICE_SCALES.find((candidate) => candidate >= targetScale)
    ?? NICE_SCALES[NICE_SCALES.length - 1];
  const scaleCount = Math.max(1, Math.ceil(duration / scale));
  return {
    scale,
    scaleCount,
    scaleWidth: Math.max(48, (width - startLeft) / scaleCount),
    startLeft,
    timelineEnd: scale * scaleCount,
  };
}

export function videoRulerLabel(seconds: number) {
  if (seconds < 60) {
    return Number.isInteger(seconds) ? `${seconds}` : seconds.toFixed(1);
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.round(seconds % 60).toString().padStart(2, "0")}`;
}

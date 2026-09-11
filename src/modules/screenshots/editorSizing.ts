export function fitImageDimensions(
  imageWidth: number,
  imageHeight: number,
  stageWidth: number,
  stageHeight: number,
  padding: number,
) {
  const availableWidth = Math.max(1, stageWidth - padding * 2);
  const availableHeight = Math.max(1, stageHeight - padding * 2);
  const scale = Math.min(1, availableWidth / imageWidth, availableHeight / imageHeight);
  return {
    width: Math.max(1, Math.floor(imageWidth * scale)),
    height: Math.max(1, Math.floor(imageHeight * scale)),
  };
}

export type ImageRect = { x: number; y: number; width: number; height: number };

export function cropImagePlacement(crop: ImageRect, imageWidth: number, imageHeight: number) {
  const left = Math.max(0, crop.x);
  const top = Math.max(0, crop.y);
  const right = Math.min(imageWidth, crop.x + crop.width);
  const bottom = Math.min(imageHeight, crop.y + crop.height);
  if (right <= left || bottom <= top) {
    return null;
  }
  const width = right - left;
  const height = bottom - top;
  return {
    source: { x: left, y: top, width, height },
    destination: { x: left - crop.x, y: top - crop.y, width, height },
  };
}

// Pointer position translated into the image's own pixel space, so the editor
// cursor readout stays at 1x image coordinates at every zoom level.
export function cursorImagePoint(
  offsetX: number,
  offsetY: number,
  displayedWidth: number,
  displayedHeight: number,
  imageWidth: number,
  imageHeight: number,
) {
  const x = Math.floor((offsetX / Math.max(1, displayedWidth)) * imageWidth);
  const y = Math.floor((offsetY / Math.max(1, displayedHeight)) * imageHeight);
  return {
    x: Math.min(imageWidth - 1, Math.max(0, x)),
    y: Math.min(imageHeight - 1, Math.max(0, y)),
  };
}

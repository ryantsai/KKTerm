import type { ImageRect } from "./editorSizing";

export type PixelColor = { red: number; green: number; blue: number; alpha: number };

type PixelSource = Pick<CanvasRenderingContext2D, "getImageData"> & {
  canvas: { width: number; height: number };
};

// Read the source image, not the editor canvas containing annotation previews.
// Crops can extend past the source; that padding is transparent, not checkerboard.
export function sourcePixelColor(
  source: PixelSource,
  point: { x: number; y: number },
  crop: ImageRect | null,
): PixelColor | null {
  const width = crop?.width ?? source.canvas.width;
  const height = crop?.height ?? source.canvas.height;
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y)
    || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
    return null;
  }
  const x = point.x + (crop?.x ?? 0);
  const y = point.y + (crop?.y ?? 0);
  if (x < 0 || y < 0 || x >= source.canvas.width || y >= source.canvas.height) {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }
  try {
    const [red, green, blue, alpha] = source.getImageData(x, y, 1, 1).data;
    return { red, green, blue, alpha };
  } catch {
    // A failed readback must not interrupt drawing or keep a stale color visible.
    return null;
  }
}

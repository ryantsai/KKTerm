/** Longest edge kept for an image embedded in a note. Notes hold screenshots of
 *  consoles and rack labels, so this preserves readable detail while keeping a
 *  pasted 4K capture from dominating the database. */
export const NOTE_ASSET_MAX_EDGE = 1600;

/** Image types stored as-is. Everything else is re-encoded to PNG so the
 *  backend only ever receives a type it accepts. */
const PASSTHROUGH_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image could not be decoded"));
    image.src = url;
  });
}

/** Downscale an image to `NOTE_ASSET_MAX_EDGE` when it is larger, returning the
 *  bytes to store. Images already within bounds pass through untouched so a
 *  crisp screenshot is not needlessly re-encoded. Animated GIFs always pass
 *  through, because canvas re-encoding would flatten them to one frame. */
export async function downscaleImageFile(
  file: File,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const type = PASSTHROUGH_TYPES.has(file.type) ? file.type : "image/png";

  if (file.type === "image/gif") {
    return { bytes: buffer, mimeType: "image/gif" };
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width <= NOTE_ASSET_MAX_EDGE && height <= NOTE_ASSET_MAX_EDGE && PASSTHROUGH_TYPES.has(file.type)) {
      return { bytes: buffer, mimeType: type };
    }
    const scale = Math.min(NOTE_ASSET_MAX_EDGE / width, NOTE_ASSET_MAX_EDGE / height, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("image canvas is unavailable");
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const outputType = type === "image/jpeg" ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, 0.92),
    );
    if (!blob) {
      throw new Error("image could not be encoded");
    }
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: outputType,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

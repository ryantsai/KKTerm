import { startDrag } from "@crabnebula/tauri-plugin-drag";
import type { StoredScreenshot } from "../../lib/tauri";

const FALLBACK_DRAG_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6WQAAAABJRU5ErkJggg==";

export function screenshotDragItems(
  screenshots: StoredScreenshot[],
  lead: StoredScreenshot,
  selectedIds: ReadonlySet<string>,
) {
  if (!selectedIds.has(lead.id)) {
    return [lead];
  }
  return screenshots.filter((screenshot) => selectedIds.has(screenshot.id));
}

export function startScreenshotDrag(items: StoredScreenshot[], lead: StoredScreenshot) {
  const icon = lead.thumbnailPath
    ?? (lead.mediaType === "image" ? lead.path : FALLBACK_DRAG_ICON);
  return startDrag({
    item: items.map((item) => item.path),
    icon,
    mode: "copy",
  });
}

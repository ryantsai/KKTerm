const NATIVE_BLOCKING_OVERLAY_SELECTOR = [
  ".sftp-context-menu",
  ".sftp-properties-popover",
  ".screenshot-region-overlay",
  ".assistant-image-preview-backdrop",
  ".transfer-conflict-backdrop",
  ".connection-dialog-backdrop",
  ".app-launcher-dialog-backdrop",
  ".settings-page",
  ".tutorial-overlay",
  ".dw-catalog-backdrop",
  ".dw-customize",
].join(", ");

const WEBVIEW_BLOCKING_OVERLAY_SELECTOR = [
  ".connection-dialog-backdrop",
  ".dw-catalog-backdrop",
  ".screenshot-region-overlay",
].join(", ");

export function documentHasRdpBlockingOverlay(surface: Element | null) {
  return documentHasNativeBlockingOverlay(surface);
}

export function documentHasWebviewBlockingOverlay(surface: Element | null) {
  return documentHasNativeBlockingOverlay(surface, WEBVIEW_BLOCKING_OVERLAY_SELECTOR);
}

function documentHasNativeBlockingOverlay(
  surface: Element | null,
  selector = NATIVE_BLOCKING_OVERLAY_SELECTOR,
) {
  const surfaceRect = visibleRect(surface);
  if (!surfaceRect) {
    return false;
  }
  return Array.from(document.querySelectorAll(selector)).some((overlay) => {
    const overlayRect = visibleRect(overlay);
    return Boolean(overlayRect && rectsIntersect(surfaceRect, overlayRect));
  });
}

function visibleRect(element: Element | null) {
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return rect;
}

function rectsIntersect(first: DOMRect, second: DOMRect) {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}

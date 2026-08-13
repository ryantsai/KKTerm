// DOM UI cannot reliably out-z-order the separate native windows used by URL
// Connections and Windows RDP. Both runtimes therefore watch the same set of
// potentially intersecting overlays, then apply their own suppression action:
// URL captures a snapshot and hides its WebviewWindow; RDP captures a snapshot
// and parks only its ActiveX HWND.
const INTERSECTING_NATIVE_SURFACE_OVERLAY_SELECTOR = [
  ".assistant-image-preview-backdrop",
  ".connection-dialog-backdrop",
  ".kk-dlg-backdrop",
  ".app-launcher-dialog-backdrop",
  ".app-launcher-menu",
  ".ai-coding-add-menu",
  ".settings-backdrop",
  ".settings-page",
  // The status notice popup is anchored to the top title-bar band and can
  // overlap the top edge of either native Session surface.
  ".status-popup",
  ".tutorial-overlay",
  ".dw-catalog-backdrop",
  ".dw-customize",
  ".dw-customize-dismiss-layer",
  ".dashboard-tab-gradient-popover",
  ".dw-bg-popover",
  ".terminal-actions-menu",
  ".terminal-bg-popover",
  ".tmux-session-menu-portal",
  ".sftp-protocol-menu",
  ".sftp-recent-menu",
  ".sftp-viewopts-menu",
  ".sftp-bg-popover",
  ".fv-menu",
  ".fv-bg-popover",
  ".git-adv-backdrop",
  ".screenshot-region-overlay",
  ".tree-drag-preview",
  ".dock-overlay",
].join(", ");

export function documentHasRdpBlockingOverlay(surface: Element | null) {
  return documentHasNativeBlockingOverlay(
    surface,
    INTERSECTING_NATIVE_SURFACE_OVERLAY_SELECTOR,
  );
}

export function documentHasWebviewBlockingOverlay(surface: Element | null) {
  return documentHasNativeBlockingOverlay(
    surface,
    INTERSECTING_NATIVE_SURFACE_OVERLAY_SELECTOR,
  );
}

export function documentHasCustomModuleBlockingOverlay(surface: Element | null) {
  return documentHasNativeBlockingOverlay(
    surface,
    INTERSECTING_NATIVE_SURFACE_OVERLAY_SELECTOR,
  );
}

function documentHasNativeBlockingOverlay(
  surface: Element | null,
  selector: string,
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

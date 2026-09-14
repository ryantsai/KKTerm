// Command chrome operates on the current content without becoming its keyboard
// focus owner. Keep this shared by DOM mouse handling and terminal focus repair.
const chromeSurfaceSelector = [
  ".app-titlebar", ".module-header", ".tab-strip", ".sidebar-actions",
  ".tree-folder-controls", ".connection-search-row",
  ".assistant-topbar", ".status-bar-actions", ".workspace-toolbar",
  ".assistant-chat-composer", ".assistant-tasks > header",
  ".terminal-pane > header", ".terminal-search-bar", ".quick-command-bar",
  ".sftp-pane-head", ".sftp-col-head", ".fv-toolbar", ".fv-findbar", ".note-search-bar",
  ".git-titlebar", ".git-toolbar", ".diff-sbs-toolbar",
  ".screenshots-library-toolbar", ".manual-page-header",
  ".it-drill-toolbar", ".it-hosts-toolbar", ".it-task-toolbar",
  ".nm-gallery-toolbar", ".nm-note-format-toolbar",
  ".app-launcher-widget-toolbar", ".app-launcher-sort-header",
  ".ai-coding-usage-toolbar", ".dw-source-toolbar", ".dw-qr-toolbar",
  ".dw-hash-topbar", ".markdown-code-toolbar", ".terminal-recordings-toolbar",
  ".settings-header-actions", ".syntax-profile-toolbar",
  ".system-cleaner-browser-toolbar", ".system-cleaner-browser-columns",
  '[role="toolbar"]', '[data-preserve-content-focus="true"]',
].join(", ");

const chromeButtonSelector = [
  ".rail-button", ".status-bar-action", ".status-bar-ai-coding",
  ".dashboard-widget-icon-button", ".assistant-toolbar-button",
  ".connection-search-clear", ".settings-search-clear",
].join(", ");

export function isContentFocusPreservingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // Nested forms, popup choices and editing surfaces retain their own focus.
  if (target.closest(
    'input, textarea, select, label, [contenteditable]:not([contenteditable="false"]), '
    + '[role="menu"], [role="listbox"], [data-preserve-content-focus="false"]',
  )) return false;
  const button = target.closest("button");
  if (!button || button.matches(':disabled, [aria-disabled="true"]')) return false;
  const surface = button.closest(chromeSurfaceSelector);
  // A dialog nested in a header is not part of the header's command chrome.
  const dialog = button.closest('[role="dialog"], .dialog-backdrop, .kk-dlg-backdrop');
  if (dialog && (!surface || !dialog.contains(surface))) return false;
  return Boolean(surface || button.matches(chromeButtonSelector));
}

export function preserveContentFocusOnMouseDown(event: MouseEvent) {
  // Use mousedown rather than pointerdown: native drag, touch scrolling and
  // pointer-based controls must keep receiving their normal pointer sequence.
  if (event.button === 0 && isContentFocusPreservingTarget(event.target)) {
    const button = (event.target as Element).closest("button")!;
    if (button.closest('[draggable="true"]')) {
      // Cancelling mousedown (or refocusing during its default) cancels HTML
      // dragstart. Return focus on release, before click actions open new UI.
      const previous = document.activeElement;
      const cleanup = () => {
        document.removeEventListener("mouseup", restore, true);
        document.removeEventListener("dragend", restore, true);
        document.removeEventListener("pointercancel", restore, true);
        window.removeEventListener("blur", cleanup);
      };
      const restore = () => {
        cleanup();
        if (document.activeElement !== button) return;
        if (previous instanceof HTMLElement && previous.isConnected
          && previous !== document.body && previous !== button) {
          previous.focus({ preventScroll: true });
        } else if (previous !== button) {
          button.blur();
        }
      };
      document.addEventListener("mouseup", restore, true);
      document.addEventListener("dragend", restore, true);
      document.addEventListener("pointercancel", restore, true);
      window.addEventListener("blur", cleanup, { once: true });
      return;
    }
    event.preventDefault();
  }
}

export function installChromeFocusPolicy() {
  document.addEventListener("mousedown", preserveContentFocusOnMouseDown, true);
  return () => document.removeEventListener("mousedown", preserveContentFocusOnMouseDown, true);
}

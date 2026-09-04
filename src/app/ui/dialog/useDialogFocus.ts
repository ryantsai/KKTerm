import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";

const openDialogs: HTMLElement[] = [];
const focusableSelector = "button, input, select, textarea, a[href], [tabindex], [contenteditable=true]";

function tabStops(dialog: HTMLElement) {
  const candidates = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.tabIndex >= 0
      && !element.matches(":disabled")
      && !element.closest("[inert]")
      && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== "hidden");
  return candidates.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name) return true;
    const group = candidates.filter((candidate): candidate is HTMLInputElement =>
      candidate instanceof HTMLInputElement && candidate.type === "radio"
      && candidate.name === element.name && candidate.form === element.form);
    return element === (group.find((candidate) => candidate.checked) ?? group[0]);
  }).sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}

/** Keep keyboard navigation in the top dialog without changing native-surface
 * visibility or making portaled Status Bar notices inert. */
export function useDialogFocus<T extends HTMLElement>(onEscape?: () => void) {
  const ref = useRef<T>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [opener] = useState(() => typeof document !== "undefined"
    && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const dismiss = useEffectEvent(() => onEscape?.());
  const dismissible = Boolean(onEscape);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    openDialogs.push(dialog);
    if (!dialog.contains(document.activeElement)) {
      const previous = lastFocusedRef.current;
      const target = previous && dialog.contains(previous) && !previous.matches(":disabled")
        ? previous : tabStops(dialog)[0] ?? dialog;
      target.focus({ preventScroll: true });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1] !== dialog || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Legacy subdialogs and custom portaled popovers own their key handling.
      // Do not let a parent dismiss while the user interacts with that overlay.
      if (target && !dialog!.contains(target) && target.closest(
        '[role="dialog"], [role="menu"], [role="listbox"], .dialog-backdrop, .kk-dlg-backdrop, .status-popup',
      )) return;
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      } else if (event.key === "Tab") {
        const stops = tabStops(dialog!);
        const first = stops[0];
        const last = stops[stops.length - 1];
        const active = document.activeElement;
        if (!first || !dialog!.contains(active)
          || (event.shiftKey ? active === first || active === dialog : active === last || active === dialog)) {
          event.preventDefault();
          (event.shiftKey ? last ?? dialog! : first ?? dialog!).focus({ preventScroll: true });
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Strict Mode replays layout effects without repeating React's autofocus.
      // Preserve that choice, especially the safe Cancel action in confirmations.
      if (document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)) {
        lastFocusedRef.current = document.activeElement;
      }
      const wasTopDialog = openDialogs[openDialogs.length - 1] === dialog;
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      if (wasTopDialog && opener?.isConnected && !opener.matches(":disabled")) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [dismissible, opener]);

  return ref;
}

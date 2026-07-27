import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The single viewer shell (`FileViewerWorkspace`) owns one toolbar and one
 * status footer; the active viewer fills three slots in them — toolbar **center**
 * (per-mode controls), toolbar **right** (per-mode actions) and **footer**
 * (per-mode status segments). Rather than lifting React nodes up through state
 * (which loops as the viewer re-renders on its own interaction state), the shell
 * exposes the slot DOM elements through this context and each viewer renders into
 * them with portals via `<ChromePortals>`. Portals re-render naturally with the
 * viewer's own state, so zoom %, filters, sort, etc. stay live with no extra
 * wiring.
 */
export interface ChromeSlots {
  center: HTMLElement | null;
  right: HTMLElement | null;
  subbar: HTMLElement | null;
  footer: HTMLElement | null;
}

const ChromeSlotsContext = createContext<ChromeSlots>({
  center: null,
  right: null,
  subbar: null,
  footer: null,
});

export const ChromeSlotsProvider = ChromeSlotsContext.Provider;

export function useChromeSlots(): ChromeSlots {
  return useContext(ChromeSlotsContext);
}

/**
 * Renders a viewer's toolbar/footer content into the shell slots. Drop it next to
 * the viewer body; slots that are null (not yet mounted, or unused) render
 * nothing.
 */
export function ChromePortals({
  center,
  right,
  subbar,
  footer,
}: {
  center?: ReactNode;
  right?: ReactNode;
  subbar?: ReactNode;
  footer?: ReactNode;
}) {
  const slots = useChromeSlots();
  return (
    <>
      {center != null && slots.center ? createPortal(center, slots.center) : null}
      {right != null && slots.right ? createPortal(right, slots.right) : null}
      {subbar != null && slots.subbar ? createPortal(subbar, slots.subbar) : null}
      {footer != null && slots.footer ? createPortal(footer, slots.footer) : null}
    </>
  );
}

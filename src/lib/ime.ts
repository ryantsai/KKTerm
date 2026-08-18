import { useCallback, useRef } from "react";
import { isMacPlatform } from "./platform";

export const IME_COMPOSITION_END_GRACE_MS = 100;

export type ImeKeyboardEvent = Pick<
  KeyboardEvent,
  "isComposing" | "key" | "keyCode"
>;

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export function isImeComposingEvent(
  event: Pick<KeyboardEvent, "isComposing" | "key" | "keyCode">,
) {
  return event.isComposing || event.keyCode === 229 || event.key === "Process";
}

export function isImeEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  const element = target.closest("input, textarea, [contenteditable], [role='textbox']");
  if (!element) {
    return false;
  }
  if (element.tagName === "INPUT") {
    return !NON_TEXT_INPUT_TYPES.has((element as HTMLInputElement).type.toLowerCase());
  }
  return element.tagName === "TEXTAREA"
    || element.hasAttribute("contenteditable")
    || element.getAttribute("role") === "textbox";
}

/**
 * App actions must not consume Enter/Escape while an IME owns the key. On
 * Windows Chromium also reports IME-handled keydowns as the legacy Process
 * key (keyCode 229). macOS WebKit can report compositionend just before the
 * keydown that confirms the candidate, so retain a short grace period there.
 */
export function shouldSuppressImeAction(
  event: ImeKeyboardEvent,
  compositionActive = false,
  compositionEndedAt = 0,
  now = Date.now(),
  isMac = isMacPlatform(),
) {
  if (event.key !== "Enter" && event.key !== "Escape") {
    return false;
  }

  const timeSinceCompositionEnd = now - compositionEndedAt;
  const followsMacCompositionEnd =
    isMac &&
    compositionEndedAt > 0 &&
    timeSinceCompositionEnd >= 0 &&
    timeSinceCompositionEnd < IME_COMPOSITION_END_GRACE_MS;

  return compositionActive || isImeComposingEvent(event) || followsMacCompositionEnd;
}

export function useImeCompositionGuard() {
  const compositionActiveRef = useRef(false);
  const compositionActionHandledRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const suppressedSubmitRef = useRef(false);
  const suppressedSubmitTokenRef = useRef(0);

  const clearSuppressedSubmit = useCallback(() => {
    suppressedSubmitRef.current = false;
    suppressedSubmitTokenRef.current += 1;
  }, []);

  const markSuppressedSubmit = useCallback(() => {
    suppressedSubmitRef.current = true;
    const token = ++suppressedSubmitTokenRef.current;
    queueMicrotask(() => {
      if (suppressedSubmitTokenRef.current === token) {
        suppressedSubmitRef.current = false;
      }
    });
  }, []);

  const onCompositionStart = useCallback(() => {
    compositionActiveRef.current = true;
    compositionActionHandledRef.current = false;
    compositionEndedAtRef.current = 0;
    clearSuppressedSubmit();
  }, [clearSuppressedSubmit]);

  const onCompositionEnd = useCallback(() => {
    compositionActiveRef.current = false;
    compositionEndedAtRef.current = compositionActionHandledRef.current ? 0 : Date.now();
    compositionActionHandledRef.current = false;
  }, []);

  const shouldSuppressAction = useCallback((event: ImeKeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== "Escape") {
      if (!compositionActiveRef.current) {
        compositionEndedAtRef.current = 0;
      }
      clearSuppressedSubmit();
      return false;
    }

    const suppress = shouldSuppressImeAction(
      event,
      compositionActiveRef.current,
      compositionEndedAtRef.current,
    );
    if (suppress) {
      if (event.key === "Enter") {
        markSuppressedSubmit();
      } else {
        clearSuppressedSubmit();
      }
      if (
        compositionActiveRef.current ||
        isImeComposingEvent(event)
      ) {
        compositionActionHandledRef.current = true;
      }
      compositionEndedAtRef.current = 0;
    }
    return suppress;
  }, [clearSuppressedSubmit, markSuppressedSubmit]);

  const consumeSuppressedSubmit = useCallback(() => {
    const suppressed = suppressedSubmitRef.current;
    clearSuppressedSubmit();
    return suppressed;
  }, [clearSuppressedSubmit]);

  return {
    consumeSuppressedSubmit,
    onCompositionEnd,
    onCompositionStart,
    shouldSuppressAction,
  };
}

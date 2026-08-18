import { useCallback, useRef } from "react";
import { isMacPlatform } from "./platform";

export const IME_COMPOSITION_END_GRACE_MS = 100;

export type ImeKeyboardEvent = Pick<
  KeyboardEvent,
  "isComposing" | "key" | "keyCode"
>;

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

  return compositionActive || event.isComposing || event.keyCode === 229 || followsMacCompositionEnd;
}

export function useImeCompositionGuard() {
  const compositionActiveRef = useRef(false);
  const compositionActionHandledRef = useRef(false);
  const compositionEndedAtRef = useRef(0);

  const onCompositionStart = useCallback(() => {
    compositionActiveRef.current = true;
    compositionActionHandledRef.current = false;
    compositionEndedAtRef.current = 0;
  }, []);

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
      return false;
    }

    const suppress = shouldSuppressImeAction(
      event,
      compositionActiveRef.current,
      compositionEndedAtRef.current,
    );
    if (suppress) {
      if (
        compositionActiveRef.current ||
        event.isComposing ||
        event.keyCode === 229
      ) {
        compositionActionHandledRef.current = true;
      }
      compositionEndedAtRef.current = 0;
    }
    return suppress;
  }, []);

  return { onCompositionEnd, onCompositionStart, shouldSuppressAction };
}

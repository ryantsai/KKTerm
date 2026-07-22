import { isMacPlatform } from "../../../../lib/platform";

type TerminalKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "isComposing" | "key" | "metaKey" | "type"
>;

/**
 * xterm can finalize a composition early when a composing keydown does not use
 * the conventional keyCode 229. WebKit then fires compositionend and xterm
 * sends the same composition again. Let the composition lifecycle own all
 * composing keydowns on macOS instead of guessing which key switches the IME.
 */
export function shouldSuppressMacImeCompositionKey(
  event: TerminalKeyboardEvent,
  compositionActive = false,
  isMac = isMacPlatform(),
) {
  return isMac && event.type === "keydown" && (compositionActive || event.isComposing);
}

/**
 * Keep the physical text typed during a macOS composition. This is only a
 * validation signal: IMEs are free to turn it into entirely different text.
 */
export function appendMacImeRawKey(
  current: string,
  event: TerminalKeyboardEvent,
  compositionActive: boolean,
  isMac = isMacPlatform(),
) {
  if (!compositionActive) {
    return current;
  }
  return current + macImeRawKey(event, isMac);
}

export function macImeRawKey(event: TerminalKeyboardEvent, isMac = isMacPlatform()) {
  if (
    !isMac ||
    event.type !== "keydown" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.key.length !== 1
  ) {
    return "";
  }
  return event.key;
}

/**
 * UI Events defines compositionend.data as the final committed value. WebKit's
 * Apple Pinyin integration can add visual syllable whitespace to that value
 * when the input source is switched. Use the physical text only when it proves
 * that whitespace is the sole difference; otherwise preserve the IME commit.
 */
export function resolveMacImeCompositionCommit(
  xtermData: string,
  compositionEndData?: string,
  rawInput = "",
) {
  const committed = compositionEndData ?? xtermData;
  const withoutWhitespace = (value: string) => value.replace(/\s/gu, "");
  if (
    rawInput.length > 0 &&
    rawInput !== committed &&
    withoutWhitespace(rawInput) === withoutWhitespace(committed)
  ) {
    return rawInput;
  }
  return committed;
}

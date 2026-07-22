import { isMacPlatform } from "../../../../lib/platform";

type TerminalKeyboardEvent = Pick<KeyboardEvent, "code" | "key">;

/**
 * WKWebView can report the macOS Caps Lock input-source switch with keyCode 0.
 * xterm 6 only recognizes keyCode 20 while composing, so letting that event
 * through makes xterm finalize the pending IME text and then send it again on
 * compositionend. Stop the non-printing switch key before xterm handles it.
 */
export function shouldSuppressMacImeSwitchKey(
  event: TerminalKeyboardEvent,
  isMac = isMacPlatform(),
) {
  return isMac && (event.code === "CapsLock" || event.key === "CapsLock");
}

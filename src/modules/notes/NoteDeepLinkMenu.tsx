import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { NoteDeepLinkChoice } from "./noteDeepLinkChoices";
import type { NoteDeepLinkSuggestionState } from "./noteDeepLinkSuggestion";

/** Height budget used to decide whether the menu opens below or above the
 *  caret. Matches `max-height` on `.note-deep-link-menu` in notes.css. */
const MENU_MAX_HEIGHT = 240;
const MENU_WIDTH = 300;
const CARET_GAP = 6;

/** The `@` trigger menu. Rendered inside the note editor (not portaled) so it
 *  inherits the editor Sheet's stacking context and the native-surface
 *  suppression already registered for `.kk-dlg-backdrop`. Positioned against
 *  the caret rect the suggestion plugin reports, flipping above the caret when
 *  there is no room below. */
export function NoteDeepLinkMenu({
  state,
  onPick,
}: {
  state: NoteDeepLinkSuggestionState;
  onPick: (choice: NoteDeepLinkChoice) => void;
}) {
  const { t } = useTranslation();
  const activeRef = useRef<HTMLButtonElement>(null);

  // Arrow-key navigation happens in the editor, so the menu scrolls itself to
  // follow the highlight.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.activeIndex, state.items]);

  if (!state.open || !state.rect) {
    return null;
  }

  const spaceBelow = window.innerHeight - state.rect.bottom;
  const openUpwards = spaceBelow < MENU_MAX_HEIGHT && state.rect.top > spaceBelow;
  const top = openUpwards ? undefined : state.rect.bottom + CARET_GAP;
  const bottom = openUpwards ? window.innerHeight - state.rect.top + CARET_GAP : undefined;
  // Keep the menu inside the window when the caret sits near the right edge.
  const left = Math.min(state.rect.left, window.innerWidth - MENU_WIDTH - CARET_GAP);

  return (
    <div
      className="note-deep-link-menu"
      role="listbox"
      aria-label={t("notes.deepLink.menuLabel")}
      style={{ top, bottom, left: Math.max(CARET_GAP, left), width: MENU_WIDTH }}
    >
      {state.items.length === 0 ? (
        <p className="note-deep-link-empty">{t("notes.deepLink.noResults")}</p>
      ) : (
        state.items.map((choice, index) => (
          <button
            className={`note-deep-link-option${index === state.activeIndex ? " is-active" : ""}`}
            key={choice.key}
            ref={index === state.activeIndex ? activeRef : undefined}
            role="option"
            aria-selected={index === state.activeIndex}
            // Selecting with the mouse must not steal focus from the editor,
            // or the suggestion range is lost before the insert runs.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(choice);
            }}
            type="button"
          >
            <span className="note-deep-link-option-label">{choice.label}</span>
            <span className="note-deep-link-option-detail">{choice.detail}</span>
          </button>
        ))
      )}
    </div>
  );
}

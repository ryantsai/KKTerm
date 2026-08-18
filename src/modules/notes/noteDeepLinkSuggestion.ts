import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import type { NoteDeepLinkChoice } from "./noteDeepLinkChoices";
import { noteDeepLinkAttributes } from "./noteDeepLinkNode";

/** What the React layer needs in order to draw the `@` menu. `rect` is the
 *  caret position the menu anchors to; `null` means the menu is closed. */
export interface NoteDeepLinkSuggestionState {
  open: boolean;
  query: string;
  items: NoteDeepLinkChoice[];
  activeIndex: number;
  rect: DOMRect | null;
}

export const CLOSED_SUGGESTION_STATE: NoteDeepLinkSuggestionState = {
  open: false,
  query: "",
  items: [],
  activeIndex: 0,
  rect: null,
};

interface NoteDeepLinkSuggestionOptions {
  /** Reads the live choice list. A getter rather than a value so the editor is
   *  never rebuilt when Connections or Sites load. */
  getChoices: () => NoteDeepLinkChoice[];
  /** Ranks choices for the typed query; shared with the toolbar picker. */
  filter: (choices: NoteDeepLinkChoice[], query: string) => NoteDeepLinkChoice[];
  /** Pushes menu state into React. */
  onStateChange: (state: NoteDeepLinkSuggestionState) => void;
  /** Reads the index the user has moved to with the arrow keys. */
  getActiveIndex: () => number;
  setActiveIndex: (index: number) => void;
}

/**
 * `@` trigger for note Deep Links.
 *
 * Built on `@tiptap/suggestion` rather than hand-rolled trigger detection: it
 * tracks the query range across edits and, critically, suppresses matching
 * during IME composition, which a naive `@`-watcher gets wrong for the CJK
 * locales KKTerm ships.
 *
 * Rendering is deliberately not tippy/floating-ui. The menu is a plain
 * absolutely-positioned element inside the note editor, so it inherits the
 * editor Sheet's stacking and the `.kk-dlg-backdrop` native-surface
 * suppression already registered in `modules/workspace/nativeOverlay.ts`.
 */
export const NoteDeepLinkSuggestion = Extension.create<NoteDeepLinkSuggestionOptions>({
  name: "noteDeepLinkSuggestion",

  addOptions() {
    return {
      getChoices: () => [],
      filter: (choices) => choices,
      onStateChange: () => {},
      getActiveIndex: () => 0,
      setActiveIndex: () => {},
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    const suggestion: Omit<SuggestionOptions<NoteDeepLinkChoice>, "editor"> = {
      char: "@",
      // The plugin's default `allowedPrefixes` of [" "] means `@` only triggers
      // at the start of a word, so an email address typed into a note stays
      // plain text. Keeping the query space-free ends it at the next word,
      // which matches how the chip reads inline.
      allowSpaces: false,

      items: ({ query }) => options.filter(options.getChoices(), query),

      command: ({ editor, range, props }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: "noteDeepLink",
              attrs: noteDeepLinkAttributes(props.link, props.label),
            },
            // A trailing space lets the user keep typing straight after the
            // chip instead of landing inside it.
            { type: "text", text: " " },
          ])
          .run();
      },

      render: () => {
        // `onKeyDown` receives only the event and range, so the latest item
        // list and command are held here for the keyboard handler to use.
        let latest: SuggestionProps<NoteDeepLinkChoice> | null = null;

        const publish = (activeIndex: number) => {
          if (!latest) return;
          options.setActiveIndex(activeIndex);
          options.onStateChange({
            open: true,
            query: latest.query,
            items: latest.items,
            activeIndex,
            rect: latest.clientRect?.() ?? null,
          });
        };

        return {
          onStart: (props) => {
            latest = props;
            publish(0);
          },
          onUpdate: (props) => {
            latest = props;
            // Keep the highlight inside the new result set as the query narrows.
            publish(Math.min(options.getActiveIndex(), Math.max(props.items.length - 1, 0)));
          },
          onKeyDown: ({ event }) => {
            if (event.key === "Escape") {
              options.onStateChange(CLOSED_SUGGESTION_STATE);
              return true;
            }
            const count = latest?.items.length ?? 0;
            if (!latest || count === 0) {
              return false;
            }
            if (event.key === "ArrowDown") {
              publish((options.getActiveIndex() + 1) % count);
              return true;
            }
            if (event.key === "ArrowUp") {
              publish((options.getActiveIndex() - 1 + count) % count);
              return true;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              const item = latest.items[options.getActiveIndex()];
              if (!item) return false;
              latest.command(item);
              return true;
            }
            return false;
          },
          onExit: () => {
            latest = null;
            options.onStateChange(CLOSED_SUGGESTION_STATE);
          },
        };
      },
    };

    return [Suggestion({ editor: this.editor, ...suggestion })];
  },
});

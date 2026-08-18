import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** In-note find/replace. Tiptap ships no maintained search extension — the
 *  community v2 package was never ported — so the note editor owns this small
 *  decoration plugin instead of taking an unmaintained dependency. */

export interface NoteSearchMatch {
  from: number;
  to: number;
}

export interface NoteSearchState {
  term: string;
  caseSensitive: boolean;
  matches: NoteSearchMatch[];
  activeIndex: number;
  decorations: DecorationSet;
}

export const noteSearchPluginKey = new PluginKey<NoteSearchState>("noteSearch");

interface SetSearchMeta {
  term: string;
  caseSensitive: boolean;
  activeIndex?: number;
}

function findMatches(
  doc: ProseMirrorNode,
  term: string,
  caseSensitive: boolean,
): NoteSearchMatch[] {
  if (!term) return [];
  const matches: NoteSearchMatch[] = [];
  const needle = caseSensitive ? term : term.toLowerCase();
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const haystack = caseSensitive ? node.text : node.text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      matches.push({
        from: position + index,
        to: position + index + term.length,
      });
      index = haystack.indexOf(needle, index + needle.length);
    }
  });
  return matches;
}

function buildDecorations(
  doc: ProseMirrorNode,
  matches: NoteSearchMatch[],
  activeIndex: number,
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class:
          index === activeIndex ? "note-search-hit note-search-hit-active" : "note-search-hit",
      }),
    ),
  );
}

/** Read the current search state — match count and position for the UI. */
export function readNoteSearchState(state: EditorState): NoteSearchState | undefined {
  return noteSearchPluginKey.getState(state);
}

const EMPTY_STATE: Omit<NoteSearchState, "decorations"> = {
  term: "",
  caseSensitive: false,
  matches: [],
  activeIndex: 0,
};

export const NoteSearch = Extension.create({
  name: "noteSearch",

  addProseMirrorPlugins() {
    return [
      new Plugin<NoteSearchState>({
        key: noteSearchPluginKey,
        state: {
          init: () => ({ ...EMPTY_STATE, decorations: DecorationSet.empty }),
          apply(transaction, previous, _oldState, newState) {
            const meta = transaction.getMeta(noteSearchPluginKey) as
              | SetSearchMeta
              | undefined;
            // Re-scan when the query changes or the document did; otherwise
            // just map existing decorations so typing stays cheap.
            if (!meta && !transaction.docChanged) {
              return previous;
            }
            const term = meta ? meta.term : previous.term;
            const caseSensitive = meta ? meta.caseSensitive : previous.caseSensitive;
            const matches = findMatches(newState.doc, term, caseSensitive);
            const requestedIndex = meta?.activeIndex ?? previous.activeIndex;
            const activeIndex =
              matches.length === 0
                ? 0
                : ((requestedIndex % matches.length) + matches.length) % matches.length;
            return {
              term,
              caseSensitive,
              matches,
              activeIndex,
              decorations: buildDecorations(newState.doc, matches, activeIndex),
            };
          },
        },
        props: {
          decorations(state) {
            return noteSearchPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/** Apply a search term. Pass an empty term to clear the highlight. */
export function applyNoteSearch(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  term: string,
  caseSensitive: boolean,
) {
  const transaction = state.tr.setMeta(noteSearchPluginKey, {
    term,
    caseSensitive,
    activeIndex: 0,
  } satisfies SetSearchMeta);
  dispatch(transaction);
}

/** Step to the next or previous match, wrapping at the ends. */
export function stepNoteSearch(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  delta: number,
) {
  const current = noteSearchPluginKey.getState(state);
  if (!current || current.matches.length === 0) return;
  const transaction = state.tr.setMeta(noteSearchPluginKey, {
    term: current.term,
    caseSensitive: current.caseSensitive,
    activeIndex: current.activeIndex + delta,
  } satisfies SetSearchMeta);
  dispatch(transaction);
}

/** Replace the active match, leaving the search active on what remains. */
export function replaceActiveNoteMatch(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  replacement: string,
) {
  const current = noteSearchPluginKey.getState(state);
  if (!current || current.matches.length === 0) return;
  const match = current.matches[current.activeIndex];
  if (!match) return;
  const transaction = state.tr.insertText(replacement, match.from, match.to);
  transaction.setMeta(noteSearchPluginKey, {
    term: current.term,
    caseSensitive: current.caseSensitive,
    activeIndex: current.activeIndex,
  } satisfies SetSearchMeta);
  dispatch(transaction);
}

/** Replace every match in one undoable step, back to front so earlier
 *  positions stay valid as the document shrinks or grows. */
export function replaceAllNoteMatches(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  replacement: string,
) {
  const current = noteSearchPluginKey.getState(state);
  if (!current || current.matches.length === 0) return;
  const transaction = state.tr;
  [...current.matches]
    .sort((left, right) => right.from - left.from)
    .forEach((match) => {
      transaction.insertText(replacement, match.from, match.to);
    });
  transaction.setMeta(noteSearchPluginKey, {
    term: current.term,
    caseSensitive: current.caseSensitive,
    activeIndex: 0,
  } satisfies SetSearchMeta);
  dispatch(transaction);
}

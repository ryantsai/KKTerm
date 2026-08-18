import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp, X } from "../../lib/reicon";
import { technicalInputProps } from "../../lib/inputBehavior";
import {
  applyNoteSearch,
  readNoteSearchState,
  replaceActiveNoteMatch,
  replaceAllNoteMatches,
  stepNoteSearch,
} from "./noteSearch";

/** In-note find/replace bar. Mirrors the terminal search bar's shape so the
 *  two search affordances in the app feel the same. */
export function NoteSearchBar({
  editor,
  readOnly,
  onClose,
}: {
  editor: Editor;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [, setTransactionRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The Editor instance is stable; subscribe explicitly so match counts and
  // the active position follow search and document transactions.
  useEffect(() => {
    const refresh = () => setTransactionRevision((revision) => revision + 1);
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
    };
  }, [editor]);

  // Re-run the query whenever the term or case mode changes; clearing the term
  // removes the highlight without closing the bar.
  useEffect(() => {
    applyNoteSearch(editor.state, editor.view.dispatch, term, caseSensitive);
  }, [editor, term, caseSensitive]);

  // Leaving the bar must not leave stale highlights behind in the note.
  useEffect(
    () => () => {
      applyNoteSearch(editor.state, editor.view.dispatch, "", false);
    },
    [editor],
  );

  const search = readNoteSearchState(editor.state);
  const total = search?.matches.length ?? 0;
  const position = total === 0 ? 0 : (search?.activeIndex ?? 0) + 1;

  function step(delta: number) {
    stepNoteSearch(editor.state, editor.view.dispatch, delta);
  }

  return (
    <div className="note-search-bar" role="search">
      <input
        className="kk-inp note-search-input"
        ref={inputRef}
        value={term}
        placeholder={t("notes.search.placeholder")}
        aria-label={t("notes.search.placeholder")}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        {...technicalInputProps}
      />
      <span className="note-search-count">
        {t("notes.search.matchCount", { position, total })}
      </span>
      <button
        className="note-tool"
        aria-label={t("notes.search.previous")}
        disabled={total === 0}
        onClick={() => step(-1)}
        title={t("notes.search.previous")}
        type="button"
      >
        <ChevronUp size={13} />
      </button>
      <button
        className="note-tool"
        aria-label={t("notes.search.next")}
        disabled={total === 0}
        onClick={() => step(1)}
        title={t("notes.search.next")}
        type="button"
      >
        <ChevronDown size={13} />
      </button>
      <button
        className={`note-tool note-search-case${caseSensitive ? " is-active" : ""}`}
        aria-label={t("notes.search.caseSensitive")}
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive((previous) => !previous)}
        title={t("notes.search.caseSensitive")}
        type="button"
      >
        Aa
      </button>
      {!readOnly ? (
        <>
          <input
            className="kk-inp note-search-input"
            value={replacement}
            placeholder={t("notes.search.replacePlaceholder")}
            aria-label={t("notes.search.replacePlaceholder")}
            onChange={(event) => setReplacement(event.target.value)}
            {...technicalInputProps}
          />
          <button
            className="kk-btn note-search-action"
            disabled={total === 0}
            onClick={() =>
              replaceActiveNoteMatch(editor.state, editor.view.dispatch, replacement)
            }
            type="button"
          >
            {t("notes.search.replace")}
          </button>
          <button
            className="kk-btn note-search-action"
            disabled={total === 0}
            onClick={() =>
              replaceAllNoteMatches(editor.state, editor.view.dispatch, replacement)
            }
            type="button"
          >
            {t("notes.search.replaceAll")}
          </button>
        </>
      ) : null}
      <button
        className="note-tool"
        aria-label={t("common.close")}
        onClick={onClose}
        title={t("common.close")}
        type="button"
      >
        <X size={13} />
      </button>
    </div>
  );
}

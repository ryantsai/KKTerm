import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Code2,
  Copy,
  Eye,
  List,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Search,
  WrapText,
  X,
} from "../../../../../lib/reicon";
import { readFromClipboard, writeToClipboard } from "../../../../../lib/clipboard";
import { Compartment, EditorState, type Text } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightWhitespace,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  indentWithTab,
  redo,
  redoDepth,
  toggleComment,
  undo,
  undoDepth,
} from "@codemirror/commands";
import {
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  setSearchQuery,
} from "@codemirror/search";
import { codeFolding, foldAll, unfoldAll } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { fileExtension } from "../fileViewerModel";
import { ChromePortals } from "../chrome/FileViewerChromeContext";
import { Chip, FootSeg, IconButton } from "../chrome/controls";

interface EditorMetrics {
  canRedo: boolean;
  canUndo: boolean;
  column: number;
  line: number;
  selected: number;
}

interface SearchSummary {
  current: number;
  total: number;
}

const EMPTY_METRICS: EditorMetrics = {
  canRedo: false,
  canUndo: false,
  column: 1,
  line: 1,
  selected: 0,
};

/** Keep result counting bounded even for dense multi-megabyte documents. */
const SEARCH_RESULT_LIMIT = 10_000;

function isDarkSurface(host: HTMLElement): boolean {
  const value = getComputedStyle(host).getPropertyValue("--surface").trim();
  const hex = value.startsWith("#") ? value.slice(1) : "";
  let r = 255;
  let g = 255;
  let b = 255;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length >= 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    const match = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (match) {
      r = Number(match[1]);
      g = Number(match[2]);
      b = Number(match[3]);
    }
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

function editorMetrics(state: EditorState): EditorMetrics {
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.head);
  return {
    canRedo: redoDepth(state) > 0,
    canUndo: undoDepth(state) > 0,
    column: selection.head - line.from + 1,
    line: line.number,
    selected: Math.abs(selection.to - selection.from),
  };
}

function countSearchResults(
  doc: Text,
  query: SearchQuery,
  selectionFrom: number,
  selectionTo: number,
): SearchSummary {
  if (!query.valid) {
    return { current: 0, total: 0 };
  }
  let current = 0;
  let total = 0;
  const cursor = query.getCursor(doc);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total += 1;
    if (next.value.from === selectionFrom && next.value.to === selectionTo) {
      current = total;
    }
    if (total >= SEARCH_RESULT_LIMIT) {
      break;
    }
  }
  return { current, total };
}

/**
 * Compact CodeMirror editor chrome. Document Connections deliberately omit New
 * and Open: files enter through Add Connection or the file browser. The editor
 * commands remain one-click actions, while search/replace gets its own strip
 * only while the Search toggle is active.
 */
export function TextCodeViewer({
  initialText,
  editable = false,
  language,
  filePath = "",
  softWrap,
  dirty = false,
  saving = false,
  onChange,
  onCompare,
  onSave,
  onSoftWrapChange,
}: {
  initialText: string;
  editable?: boolean;
  language?: "markdown";
  filePath?: string;
  softWrap: boolean;
  dirty?: boolean;
  saving?: boolean;
  onChange?: (text: string) => void;
  onCompare?: () => void;
  onSave?: () => void;
  onSoftWrapChange?: (softWrap: boolean) => void;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wrapCompartment = useRef(new Compartment());
  const lineNumbersCompartment = useRef(new Compartment());
  const whitespaceCompartment = useRef(new Compartment());
  const [wrap, setWrap] = useState(softWrap);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [searchSummary, setSearchSummary] = useState<SearchSummary>({
    current: 0,
    total: 0,
  });

  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onSoftWrapChangeRef = useRef(onSoftWrapChange);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onSoftWrapChangeRef.current = onSoftWrapChange;

  const refreshSearchSummary = useCallback((view: EditorView) => {
    const selection = view.state.selection.main;
    setSearchSummary(
      countSearchResults(
        view.state.doc,
        getSearchQuery(view.state),
        selection.from,
        selection.to,
      ),
    );
  }, []);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return true;
  }, []);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }
    const extensions = [
      lineNumbersCompartment.current.of(lineNumbers()),
      whitespaceCompartment.current.of([]),
      highlightActiveLine(),
      highlightSelectionMatches(),
      history(),
      search(),
      codeFolding(),
      wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            onSaveRef.current?.();
            return true;
          },
        },
        { key: "Mod-f", preventDefault: true, run: openSearch },
        ...searchKeymap.filter((binding) => binding.key !== "Mod-f"),
        ...historyKeymap,
        ...defaultKeymap,
        indentWithTab,
      ]),
      EditorState.readOnly.of(!editable),
      EditorView.editable.of(editable),
      EditorView.updateListener.of((update) => {
        setMetrics(editorMetrics(update.state));
        if (update.docChanged) {
          onChangeRef.current?.(update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) {
          refreshSearchSummary(update.view);
        }
      }),
    ];
    if (isDarkSurface(hostRef.current)) {
      extensions.push(oneDark);
    }
    if (language === "markdown") {
      extensions.push(markdown());
    }
    const view = new EditorView({
      state: EditorState.create({ doc: initialText, extensions }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    setMetrics(editorMetrics(view.state));
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The parent remounts the editor on file/reload changes. Keeping a single
    // CodeMirror instance preserves history and caret position while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineNumbersCompartment.current.reconfigure(
        showLineNumbers ? lineNumbers() : [],
      ),
    });
  }, [showLineNumbers]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: whitespaceCompartment.current.reconfigure(
        showWhitespace ? highlightWhitespace() : [],
      ),
    });
  }, [showWhitespace]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const query = new SearchQuery({
      search: searchValue,
      replace: replaceValue,
      caseSensitive,
      wholeWord,
      regexp,
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
    refreshSearchSummary(view);
  }, [
    caseSensitive,
    refreshSearchSummary,
    regexp,
    replaceValue,
    searchValue,
    wholeWord,
  ]);

  const runCommand = useCallback(
    (command: (target: EditorView) => boolean) => {
      const view = viewRef.current;
      if (!view) {
        return;
      }
      command(view);
      view.focus();
      refreshSearchSummary(view);
    },
    [refreshSearchSummary],
  );

  const copySelection = useCallback(async () => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const selection = view.state.selection.main;
    if (selection.empty) {
      return;
    }
    await writeToClipboard(view.state.sliceDoc(selection.from, selection.to));
    view.focus();
  }, []);

  const cutSelection = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !editable) {
      return;
    }
    const selection = view.state.selection.main;
    if (selection.empty) {
      return;
    }
    await writeToClipboard(view.state.sliceDoc(selection.from, selection.to));
    view.dispatch({ changes: { from: selection.from, to: selection.to } });
    view.focus();
  }, [editable]);

  const paste = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !editable) {
      return;
    }
    const text = await readFromClipboard();
    if (!text) {
      return;
    }
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
    });
    view.focus();
  }, [editable]);

  const languageLabel =
    language === "markdown"
      ? "Markdown"
      : (fileExtension(filePath) || "").toUpperCase() || null;
  const searchResultLabel =
    searchValue && searchSummary.total > 0
      ? t("workspace.fileViewer.searchResult", {
          current: searchSummary.current || 1,
          total: searchSummary.total,
        })
      : t("workspace.fileViewer.noSearchResults");

  return (
    <>
      <ChromePortals
        center={
          <>
            {languageLabel ? <Chip>{languageLabel}</Chip> : null}
            <span className="fv-tool-separator" />
            {editable ? (
              <IconButton
                icon={Save}
                title={saving ? t("workspace.fileViewer.saving") : t("workspace.fileViewer.save")}
                disabled={!dirty || saving}
                onClick={onSave}
              />
            ) : null}
            <IconButton
              icon={RotateCcw}
              title={t("screenshots.editor.undo")}
              disabled={!editable || !metrics.canUndo}
              onClick={() => runCommand(undo)}
            />
            <IconButton
              icon={RotateCw}
              title={t("workspace.fileViewer.redo")}
              disabled={!editable || !metrics.canRedo}
              onClick={() => runCommand(redo)}
            />
            <span className="fv-tool-separator" />
            <IconButton
              icon={Scissors}
              title={t("common.cut")}
              disabled={!editable || metrics.selected === 0}
              onClick={() => void cutSelection()}
            />
            <IconButton
              icon={Copy}
              title={t("common.copy")}
              disabled={metrics.selected === 0}
              onClick={() => void copySelection()}
            />
            <IconButton
              icon={ClipboardPaste}
              title={t("common.paste")}
              disabled={!editable}
              onClick={() => void paste()}
            />
            <span className="fv-tool-separator" />
            <IconButton
              icon={Search}
              title={t("workspace.fileViewer.find")}
              on={searchOpen}
              pressed={searchOpen}
              onClick={() => {
                if (searchOpen) {
                  setSearchOpen(false);
                  viewRef.current?.focus();
                } else {
                  openSearch();
                }
              }}
            />
            <IconButton
              icon={WrapText}
              title={t("workspace.fileViewer.softWrap")}
              size={16}
              on={wrap}
              pressed={wrap}
              onClick={() =>
                setWrap((value) => {
                  const next = !value;
                  onSoftWrapChangeRef.current?.(next);
                  return next;
                })
              }
            />
            <IconButton
              icon={List}
              title={t("workspace.fileViewer.lineNumbers")}
              on={showLineNumbers}
              pressed={showLineNumbers}
              onClick={() => setShowLineNumbers((value) => !value)}
            />
            <IconButton
              icon={Eye}
              title={t("workspace.fileViewer.showWhitespace")}
              on={showWhitespace}
              pressed={showWhitespace}
              onClick={() => setShowWhitespace((value) => !value)}
            />
            {language === "markdown" ? (
              <>
                <IconButton
                  icon={ChevronUp}
                  title={t("workspace.fileViewer.foldAll")}
                  onClick={() => runCommand(foldAll)}
                />
                <IconButton
                  icon={ChevronDown}
                  title={t("workspace.fileViewer.unfoldAll")}
                  onClick={() => runCommand(unfoldAll)}
                />
              </>
            ) : null}
            {editable ? (
              <>
                <span className="fv-tool-separator" />
                <IconButton
                  icon={ArrowRight}
                  title={t("workspace.fileViewer.indent")}
                  onClick={() => runCommand(indentMore)}
                />
                <IconButton
                  icon={ArrowLeft}
                  title={t("workspace.fileViewer.outdent")}
                  onClick={() => runCommand(indentLess)}
                />
                {language === "markdown" ? (
                  <IconButton
                    icon={Code2}
                    title={t("workspace.fileViewer.toggleComment")}
                    onClick={() => runCommand(toggleComment)}
                  />
                ) : null}
              </>
            ) : null}
            <span className="fv-tool-separator" />
            <IconButton
              icon={ArrowLeftRight}
              title={t("workspace.fileViewer.compareWithFile")}
              onClick={onCompare}
            />
          </>
        }
        subbar={
          searchOpen ? (
            <div
              className="fv-findbar"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchOpen(false);
                  viewRef.current?.focus();
                }
              }}
            >
              <Search size={14} />
              <input
                ref={searchInputRef}
                className="fv-find-input"
                value={searchValue}
                placeholder={t("workspace.fileViewer.findPlaceholder")}
                aria-label={t("workspace.fileViewer.findPlaceholder")}
                onChange={(event) => setSearchValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    runCommand(event.shiftKey ? findPrevious : findNext);
                  }
                }}
              />
              <span className="fv-find-count">{searchResultLabel}</span>
              <IconButton
                icon={ChevronUp}
                title={t("workspace.fileViewer.previousMatch")}
                disabled={!searchValue || searchSummary.total === 0}
                onClick={() => runCommand(findPrevious)}
              />
              <IconButton
                icon={ChevronDown}
                title={t("workspace.fileViewer.nextMatch")}
                disabled={!searchValue || searchSummary.total === 0}
                onClick={() => runCommand(findNext)}
              />
              <button
                type="button"
                className={caseSensitive ? "fv-find-toggle on" : "fv-find-toggle"}
                title={t("workspace.fileViewer.matchCase")}
                aria-label={t("workspace.fileViewer.matchCase")}
                aria-pressed={caseSensitive}
                onClick={() => setCaseSensitive((value) => !value)}
              >
                Aa
              </button>
              <button
                type="button"
                className={wholeWord ? "fv-find-toggle on" : "fv-find-toggle"}
                title={t("workspace.fileViewer.wholeWord")}
                aria-label={t("workspace.fileViewer.wholeWord")}
                aria-pressed={wholeWord}
                onClick={() => setWholeWord((value) => !value)}
              >
                ab
              </button>
              <button
                type="button"
                className={regexp ? "fv-find-toggle on" : "fv-find-toggle"}
                title={t("workspace.fileViewer.regularExpression")}
                aria-label={t("workspace.fileViewer.regularExpression")}
                aria-pressed={regexp}
                onClick={() => setRegexp((value) => !value)}
              >
                .*
              </button>
              <span className="fv-tool-separator" />
              <input
                className="fv-find-input"
                value={replaceValue}
                placeholder={t("workspace.fileViewer.replacePlaceholder")}
                aria-label={t("workspace.fileViewer.replacePlaceholder")}
                disabled={!editable}
                onChange={(event) => setReplaceValue(event.currentTarget.value)}
              />
              <button
                type="button"
                className="fv-find-action"
                disabled={!editable || !searchValue || searchSummary.total === 0}
                onClick={() => runCommand(replaceNext)}
              >
                {t("workspace.fileViewer.replace")}
              </button>
              <button
                type="button"
                className="fv-find-action"
                disabled={!editable || !searchValue || searchSummary.total === 0}
                onClick={() => runCommand(replaceAll)}
              >
                {t("workspace.fileViewer.replaceAll")}
              </button>
              <div className="fv-tb-spacer" />
              <IconButton
                icon={X}
                title={t("common.close")}
                onClick={() => {
                  setSearchOpen(false);
                  viewRef.current?.focus();
                }}
              />
            </div>
          ) : null
        }
        footer={
          <>
            <FootSeg mono>
              {t("workspace.fileViewer.lineColumn", {
                line: metrics.line,
                column: metrics.column,
              })}
            </FootSeg>
            {metrics.selected > 0 ? (
              <FootSeg>
                {t("workspace.fileViewer.selectionCount", { count: metrics.selected })}
              </FootSeg>
            ) : null}
            {languageLabel ? <FootSeg>{languageLabel}</FootSeg> : null}
          </>
        }
      />
      <div className="file-viewer-codemirror" ref={hostRef} />
    </>
  );
}

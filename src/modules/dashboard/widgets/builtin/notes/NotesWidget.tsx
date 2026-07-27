import { Minus, Plus } from "../../../../../lib/reicon";
import DOMPurify from "dompurify";
import { marked } from "marked";
import TurndownService from "turndown";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { readFromClipboard, writeToClipboard } from "../../../../../lib/clipboard";
import { showNativeContextMenu } from "../../../../../lib/nativeContextMenu";
import type { BuiltInWidgetBodyProps } from "../../../registry/builtInRegistry";
import { useDurableWidgetConfig } from "../../widgetLocalStorage";

type NotesColor = "yellow" | "pink" | "blue" | "green" | "orange" | "purple" | "white";
type NotesFont = "handwriting" | "marker" | "system" | "serif" | "mono";
type NotesFoldCorner = "topRight" | "topLeft" | "bottomRight" | "bottomLeft";

interface NotesConfig {
  pages: string[];
  color: NotesColor;
  font: NotesFont;
}

interface NotesWidgetSettings {
  rotationDegrees: number;
  foldSizePx: number;
  foldDepth: number;
  /* Width/height ratio of the dog-ear; values off 1 make the crease sit at a
     slight angle so randomly created notes don't all fold at a perfect 45°. */
  foldAspect: number;
  foldCorner: NotesFoldCorner;
  markdownEnabled: boolean;
}

const DEFAULT_CONFIG: NotesConfig = {
  pages: [""],
  color: "yellow",
  font: "handwriting",
};

const DEFAULT_SETTINGS: NotesWidgetSettings = {
  rotationDegrees: -0.6,
  foldSizePx: 22,
  foldDepth: 0.5,
  foldAspect: 1,
  foldCorner: "topRight",
  markdownEnabled: true,
};

const DELETE_ANIMATION_MS = 220;

const COLOR_VALUES: NotesColor[] = ["yellow", "pink", "blue", "green", "orange", "purple", "white"];
const FONT_VALUES: NotesFont[] = ["handwriting", "marker", "system", "serif", "mono"];
const FOLD_CORNER_VALUES: NotesFoldCorner[] = ["topRight", "topLeft", "bottomRight", "bottomLeft"];
const DEFAULT_FORMAT_STATE = {
  bold: false,
  italic: false,
  bulletedList: false,
  numberedList: false,
  block: "p",
  table: false,
  canDeleteTableRow: false,
  canDeleteTableColumn: false,
};

function storageKey(instanceId: string) {
  return `kkterm.dashboard.notes.${instanceId}.v1`;
}

function normalizeNotesConfig(value: unknown): NotesConfig {
  if (!value || typeof value !== "object") {
    return DEFAULT_CONFIG;
  }
  const candidate = value as Partial<NotesConfig> & { text?: unknown; pages?: unknown };
  const pages = Array.isArray(candidate.pages)
    ? candidate.pages.filter((page): page is string => typeof page === "string")
    : (typeof candidate.text === "string" ? [candidate.text] : []);
  return {
    pages: pages.length > 0 ? pages : [""],
    color:
      typeof candidate.color === "string" && COLOR_VALUES.includes(candidate.color as NotesColor)
        ? (candidate.color as NotesColor)
        : "yellow",
    font:
      typeof candidate.font === "string" && FONT_VALUES.includes(candidate.font as NotesFont)
        ? (candidate.font as NotesFont)
        : "handwriting",
  };
}

export function randomNotesRotationDegrees() {
  return Math.round(((Math.random() * 2.4) - 1.2) * 10) / 10;
}

export function randomNotesSettings(): NotesWidgetSettings {
  return {
    rotationDegrees: randomNotesRotationDegrees(),
    foldSizePx: Math.round(18 + Math.random() * 16),
    foldDepth: Math.round((0.3 + Math.random() * 0.5) * 100) / 100,
    foldAspect: Math.round((0.82 + Math.random() * 0.4) * 100) / 100,
    foldCorner: FOLD_CORNER_VALUES[Math.floor(Math.random() * FOLD_CORNER_VALUES.length)] ?? "topRight",
    markdownEnabled: true,
  };
}

export function parseNotesSettingsJson(settingsValuesJson: string): NotesWidgetSettings {
  try {
    const parsed = JSON.parse(settingsValuesJson) as Partial<NotesWidgetSettings>;
    const rotationDegrees = typeof parsed.rotationDegrees === "number"
      ? Math.max(-3, Math.min(3, parsed.rotationDegrees))
      : DEFAULT_SETTINGS.rotationDegrees;
    const foldSizePx = typeof parsed.foldSizePx === "number"
      ? Math.max(14, Math.min(42, parsed.foldSizePx))
      : DEFAULT_SETTINGS.foldSizePx;
    const foldDepth = typeof parsed.foldDepth === "number"
      ? Math.max(0, Math.min(1, parsed.foldDepth))
      : DEFAULT_SETTINGS.foldDepth;
    const foldAspect = typeof parsed.foldAspect === "number"
      ? Math.max(0.7, Math.min(1.4, parsed.foldAspect))
      : DEFAULT_SETTINGS.foldAspect;
    const foldCorner =
      typeof parsed.foldCorner === "string" && FOLD_CORNER_VALUES.includes(parsed.foldCorner as NotesFoldCorner)
        ? (parsed.foldCorner as NotesFoldCorner)
        : DEFAULT_SETTINGS.foldCorner;
    const markdownEnabled =
      typeof parsed.markdownEnabled === "boolean" ? parsed.markdownEnabled : DEFAULT_SETTINGS.markdownEnabled;
    return { rotationDegrees, foldSizePx, foldDepth, foldAspect, foldCorner, markdownEnabled };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function renderMarkdown(markdown: string) {
  const html = marked.parse(markdown, { async: false, breaks: true }) as string;
  return DOMPurify.sanitize(html);
}

const markdownSerializer = new TurndownService({ bulletListMarker: "-" });
markdownSerializer.addRule("gfmTable", {
  filter: "table",
  replacement: (_content, node) => {
    const table = node as HTMLTableElement;
    const rows = Array.from(table.rows);
    if (rows.length === 0) {
      return "";
    }
    const columnCount = Math.max(...rows.map((row) => row.cells.length), 1);
    const serializeCell = (cell: HTMLTableCellElement | undefined) => {
      if (!cell) {
        return " ";
      }
      return markdownSerializer
        .turndown(cell.innerHTML)
        .replace(/\|/g, "\\|")
        .replace(/\r?\n+/g, "<br>")
        .trim() || " ";
    };
    const serializeRow = (row: HTMLTableRowElement | undefined) =>
      `| ${Array.from({ length: columnCount }, (_, index) => serializeCell(row?.cells[index])).join(" | ")} |`;
    const lines = [
      serializeRow(rows[0]),
      `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`,
      ...rows.slice(1).map(serializeRow),
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  },
});

export function NotesBody({ instance }: BuiltInWidgetBodyProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useDurableWidgetConfig(
    storageKey(instance.id),
    DEFAULT_CONFIG,
    normalizeNotesConfig,
  );
  const settings = useMemo(
    () => parseNotesSettingsJson(instance.settingsValuesJson),
    [instance.settingsValuesJson],
  );
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownEditorRef = useRef<HTMLDivElement | null>(null);
  const markdownSelectionRef = useRef<Range | null>(null);
  const activeTableCellRef = useRef<HTMLTableCellElement | null>(null);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [tearingPageIndex, setTearingPageIndex] = useState<number | null>(null);
  const [formatState, setFormatState] = useState(DEFAULT_FORMAT_STATE);
  const activePage = config.pages[activePageIndex] ?? "";
  const renderedMarkdown = useMemo(() => renderMarkdown(activePage), [activePage]);

  useEffect(() => {
    const editor = markdownEditorRef.current;
    if (editor && document.activeElement !== editor && editor.innerHTML !== renderedMarkdown) {
      editor.innerHTML = renderedMarkdown;
    }
  }, [activePageIndex, renderedMarkdown, settings.markdownEnabled]);

  useEffect(() => {
    if (activePageIndex >= config.pages.length) {
      setActivePageIndex(Math.max(0, config.pages.length - 1));
    }
  }, [activePageIndex, config.pages.length]);

  useEffect(() => {
    markdownSelectionRef.current = null;
    activeTableCellRef.current = null;
    setFormatState(DEFAULT_FORMAT_STATE);
  }, [activePageIndex, settings.markdownEnabled]);

  function updateActivePage(text: string) {
    const pages = [...config.pages];
    pages[activePageIndex] = text;
    setConfig({ ...config, pages });
  }

  function addPage() {
    const pages = [...config.pages, ""];
    setConfig({ ...config, pages });
    setActivePageIndex(pages.length - 1);
  }

  function deletePage() {
    if (config.pages.length <= 1 || tearingPageIndex !== null) {
      return;
    }
    const pageToDelete = activePageIndex;
    setTearingPageIndex(pageToDelete);
    window.setTimeout(() => {
      setConfig({
        ...config,
        pages: config.pages.filter((_, index) => index !== pageToDelete),
      });
      setActivePageIndex(Math.max(0, pageToDelete - 1));
      setTearingPageIndex(null);
    }, DELETE_ANIMATION_MS);
  }

  function selectedTextFromNotesSurface() {
    const textArea = textAreaRef.current;
    if (textArea && document.activeElement === textArea && textArea.selectionStart !== textArea.selectionEnd) {
      return textArea.value.slice(textArea.selectionStart, textArea.selectionEnd);
    }
    return window.getSelection()?.toString() ?? "";
  }

  function insertTextIntoNote(textArea: HTMLTextAreaElement, text: string) {
    const selectionStart = textArea.selectionStart;
    const selectionEnd = textArea.selectionEnd;
    const nextPage = `${textArea.value.slice(0, selectionStart)}${text}${textArea.value.slice(selectionEnd)}`;
    const nextCaret = selectionStart + text.length;
    updateActivePage(nextPage);
    window.requestAnimationFrame(() => {
      textAreaRef.current?.focus();
      textAreaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function deleteNoteSelection(textArea: HTMLTextAreaElement) {
    insertTextIntoNote(textArea, "");
  }

  function syncMarkdownEditor() {
    const editor = markdownEditorRef.current;
    if (editor) {
      updateActivePage(markdownSerializer.turndown(editor.innerHTML));
    }
  }

  function captureMarkdownSelection() {
    const editor = markdownEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }
    markdownSelectionRef.current = range.cloneRange();
    const selectionElement = range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
    const tableCell = selectionElement?.closest<HTMLTableCellElement>("th, td") ?? null;
    const table = tableCell?.closest("table") ?? null;
    activeTableCellRef.current = tableCell && editor.contains(tableCell) ? tableCell : null;
    const block = String(document.queryCommandValue("formatBlock")).replace(/[<>]/g, "").toLowerCase();
    setFormatState({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      bulletedList: document.queryCommandState("insertUnorderedList"),
      numberedList: document.queryCommandState("insertOrderedList"),
      block: block || "p",
      table: Boolean(tableCell),
      canDeleteTableRow: tableCell?.tagName === "TD",
      canDeleteTableColumn: (table?.rows[0]?.cells.length ?? 0) > 1,
    });
  }

  function restoreMarkdownSelection() {
    const editor = markdownEditorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    const savedRange = markdownSelectionRef.current;
    const range = savedRange && editor.contains(savedRange.commonAncestorContainer)
      ? savedRange
      : document.createRange();
    if (!savedRange || range !== savedRange) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function applyMarkdownFormat(command: string, value?: string) {
    restoreMarkdownSelection();
    document.execCommand(command, false, value);
    syncMarkdownEditor();
    captureMarkdownSelection();
  }

  function applyMarkdownBlock(block: "h1" | "h2" | "blockquote") {
    applyMarkdownFormat("formatBlock", formatState.block === block ? "p" : block);
  }

  function applyMarkdownList(command: "insertUnorderedList" | "insertOrderedList") {
    restoreMarkdownSelection();
    document.execCommand(command);
    const editor = markdownEditorRef.current;
    editor?.querySelectorAll("h1 > ul, h1 > ol, h2 > ul, h2 > ol, blockquote > ul, blockquote > ol, p > ul, p > ol")
      .forEach((list) => {
        const wrapper = list.parentElement;
        if (wrapper?.childNodes.length === 1) {
          wrapper.replaceWith(list);
        }
      });
    syncMarkdownEditor();
    captureMarkdownSelection();
  }

  function focusMarkdownTableCell(cell: HTMLTableCellElement | null) {
    const editor = markdownEditorRef.current;
    if (!editor || !cell || !editor.contains(cell)) {
      return;
    }
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    markdownSelectionRef.current = range.cloneRange();
    activeTableCellRef.current = cell;
    captureMarkdownSelection();
  }

  function finishMarkdownTableEdit(cell: HTMLTableCellElement | null) {
    syncMarkdownEditor();
    window.requestAnimationFrame(() => focusMarkdownTableCell(cell));
  }

  function insertMarkdownTable() {
    const editor = markdownEditorRef.current;
    if (!editor) {
      return;
    }
    restoreMarkdownSelection();
    const table = document.createElement("table");
    const headerRow = table.createTHead().insertRow();
    for (let index = 0; index < 2; index += 1) {
      headerRow.appendChild(document.createElement("th")).appendChild(document.createElement("br"));
    }
    const body = table.createTBody();
    for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
      const row = body.insertRow();
      for (let columnIndex = 0; columnIndex < 2; columnIndex += 1) {
        row.insertCell().appendChild(document.createElement("br"));
      }
    }
    const trailingParagraph = document.createElement("p");
    trailingParagraph.appendChild(document.createElement("br"));
    const savedRange = markdownSelectionRef.current;
    const selectionElement = savedRange?.startContainer instanceof Element
      ? savedRange.startContainer
      : savedRange?.startContainer.parentElement;
    const containingBlock = selectionElement?.closest("p, h1, h2, blockquote, ul, ol, table");
    if (containingBlock && containingBlock.parentElement === editor) {
      containingBlock.after(table, trailingParagraph);
    } else if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
      savedRange.deleteContents();
      savedRange.insertNode(table);
      table.after(trailingParagraph);
    } else {
      editor.append(table, trailingParagraph);
    }
    finishMarkdownTableEdit(headerRow.cells[0]);
  }

  function addMarkdownTableRow() {
    const cell = activeTableCellRef.current;
    const table = cell?.closest("table");
    if (!cell || !table) {
      return;
    }
    const body = table.tBodies[0] ?? table.createTBody();
    const activeRow = cell.parentElement as HTMLTableRowElement;
    const row = body.insertRow(cell.tagName === "TD" ? activeRow.sectionRowIndex + 1 : 0);
    const columnCount = table.rows[0]?.cells.length ?? 1;
    for (let index = 0; index < columnCount; index += 1) {
      row.insertCell().appendChild(document.createElement("br"));
    }
    finishMarkdownTableEdit(row.cells[Math.min(cell.cellIndex, columnCount - 1)]);
  }

  function deleteMarkdownTableRow() {
    const cell = activeTableCellRef.current;
    const row = cell?.parentElement as HTMLTableRowElement | null;
    const table = cell?.closest("table");
    if (!cell || !row || !table || cell.tagName !== "TD") {
      return;
    }
    const nextRow = row.nextElementSibling as HTMLTableRowElement | null;
    const previousRow = row.previousElementSibling as HTMLTableRowElement | null;
    const targetRow = nextRow ?? previousRow ?? table.tHead?.rows[0] ?? null;
    const targetIndex = Math.min(cell.cellIndex, Math.max((targetRow?.cells.length ?? 1) - 1, 0));
    row.remove();
    finishMarkdownTableEdit(targetRow?.cells[targetIndex] ?? null);
  }

  function addMarkdownTableColumn() {
    const cell = activeTableCellRef.current;
    const table = cell?.closest("table");
    if (!cell || !table) {
      return;
    }
    const insertAt = cell.cellIndex + 1;
    let targetCell: HTMLTableCellElement | null = null;
    for (const row of Array.from(table.rows)) {
      const nextCell = row.insertCell(insertAt);
      if (row.parentElement?.tagName === "THEAD") {
        const headerCell = document.createElement("th");
        headerCell.appendChild(document.createElement("br"));
        nextCell.replaceWith(headerCell);
        if (row === cell.parentElement) {
          targetCell = headerCell;
        }
      } else {
        nextCell.appendChild(document.createElement("br"));
        if (row === cell.parentElement) {
          targetCell = nextCell;
        }
      }
    }
    finishMarkdownTableEdit(targetCell);
  }

  function deleteMarkdownTableColumn() {
    const cell = activeTableCellRef.current;
    const table = cell?.closest("table");
    if (!cell || !table || table.rows[0].cells.length <= 1) {
      return;
    }
    const deleteAt = cell.cellIndex;
    const activeRow = cell.parentElement;
    let targetCell: HTMLTableCellElement | null = null;
    for (const row of Array.from(table.rows)) {
      row.deleteCell(deleteAt);
      if (row === activeRow) {
        targetCell = row.cells[Math.min(deleteAt, row.cells.length - 1)] ?? null;
      }
    }
    finishMarkdownTableEdit(targetCell);
  }

  function deleteMarkdownTable() {
    const editor = markdownEditorRef.current;
    const table = activeTableCellRef.current?.closest("table");
    if (!editor || !table) {
      return;
    }
    const focusTarget = table.nextElementSibling ?? table.previousElementSibling;
    table.remove();
    if (!editor.textContent?.trim()) {
      editor.replaceChildren();
    }
    activeTableCellRef.current = null;
    syncMarkdownEditor();
    window.requestAnimationFrame(() => {
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(focusTarget ?? editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      captureMarkdownSelection();
    });
  }

  async function handleNotesContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const textArea = event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget : null;
    const markdownEditor = event.currentTarget === markdownEditorRef.current ? markdownEditorRef.current : null;
    const selectedText = selectedTextFromNotesSurface();
    const hasSelection = selectedText.length > 0;

    if (!textArea && !hasSelection) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    await showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("common.cut"),
          disabled: (!textArea && !markdownEditor) || !hasSelection,
          action: () => {
            if ((!textArea && !markdownEditor) || !selectedText) {
              return;
            }
            void writeToClipboard(selectedText);
            if (textArea) {
              deleteNoteSelection(textArea);
            } else {
              document.execCommand("delete");
              syncMarkdownEditor();
            }
          },
        },
        {
          kind: "item",
          label: t("common.copy"),
          disabled: !hasSelection,
          action: () => {
            if (selectedText) {
              void writeToClipboard(selectedText);
            }
          },
        },
        {
          kind: "item",
          label: t("common.paste"),
          disabled: !textArea && !markdownEditor,
          action: () => {
            if (!textArea && !markdownEditor) {
              return;
            }
            void readFromClipboard().then((text) => {
              if (textArea && text) {
                insertTextIntoNote(textArea, text);
              } else if (textArea) {
                textArea.focus();
              } else if (markdownEditor && text) {
                markdownEditor.focus();
                document.execCommand("insertText", false, text);
                syncMarkdownEditor();
              } else {
                markdownEditor?.focus();
              }
            });
          },
        },
      ],
      { x: event.clientX, y: event.clientY },
    );
  }

  return (
    <div
      className={`dw-notes dw-notes--color-${config.color} dw-notes--font-${config.font} dw-notes--fold-${settings.foldCorner}${tearingPageIndex === activePageIndex ? " is-tearing" : ""}`}
      style={{
        "--note-rotation": `${settings.rotationDegrees}deg`,
        "--note-fold-size": `${settings.foldSizePx}px`,
        "--note-fold-size-x": `${Math.round(settings.foldSizePx * settings.foldAspect)}px`,
        "--note-fold-size-y": `${Math.round(settings.foldSizePx / settings.foldAspect)}px`,
        "--note-fold-depth": settings.foldDepth,
        "--note-fold-depth-alpha": String(0.08 + settings.foldDepth * 0.18),
        "--note-fold-shadow-offset": `${settings.foldDepth * 5}px`,
        "--note-fold-shadow-blur": `${settings.foldDepth * 7}px`,
      } as CSSProperties}
    >
      {!settings.markdownEnabled ? (
        <div className="dw-notes-page-actions" role="toolbar" aria-label={t("dashboard.notesPagesToolbarLabel")}>
          <button
            type="button"
            className="secondary-button dw-notes-page-button"
            aria-label={t("dashboard.notesAddPage")}
            title={t("dashboard.notesAddPage")}
            onClick={addPage}
          >
            <Plus size={14} />
          </button>
          {config.pages.length > 1 ? (
            <button
              type="button"
              className="secondary-button dw-notes-page-button"
              aria-label={t("dashboard.notesDeletePage")}
              title={t("dashboard.notesDeletePage")}
              onClick={deletePage}
            >
              <Minus size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
      {settings.markdownEnabled ? (
        <>
          <div className="dw-notes-format-toolbar" role="toolbar" aria-label={t("itops.networkMap.noteFormattingLabel")}>
            <div className="dw-notes-format-actions">
              <button
                type="button"
                className={`dw-notes-format-button${formatState.block === "h1" ? " is-active" : ""}`}
                aria-pressed={formatState.block === "h1"}
                aria-label={t("itops.networkMap.noteFormatHeading1")}
                title={t("itops.networkMap.noteFormatHeading1")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMarkdownBlock("h1")}
              >
                H1
              </button>
              <button
                type="button"
                className={`dw-notes-format-button${formatState.block === "h2" ? " is-active" : ""}`}
                aria-pressed={formatState.block === "h2"}
                aria-label={t("itops.networkMap.noteFormatHeading2")}
                title={t("itops.networkMap.noteFormatHeading2")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMarkdownBlock("h2")}
              >
                H2
              </button>
              <span className="dw-notes-format-divider" aria-hidden="true" />
              <button
                type="button"
                className={`dw-notes-format-button is-bold${formatState.bold ? " is-active" : ""}`}
                aria-pressed={formatState.bold}
                aria-label={t("screenshots.editor.bold")}
                title={t("screenshots.editor.bold")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMarkdownFormat("bold")}
              >
                B
              </button>
              <button
                type="button"
                className={`dw-notes-format-button is-italic${formatState.italic ? " is-active" : ""}`}
                aria-pressed={formatState.italic}
                aria-label={t("screenshots.editor.italic")}
                title={t("screenshots.editor.italic")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMarkdownFormat("italic")}
              >
                I
              </button>
              <span className="dw-notes-format-divider" aria-hidden="true" />
              <button
                type="button"
                className={`dw-notes-format-button${formatState.bulletedList ? " is-active" : ""}`}
                aria-pressed={formatState.bulletedList}
                aria-label={t("itops.networkMap.noteFormatBulletedList")}
                title={t("itops.networkMap.noteFormatBulletedList")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMarkdownList("insertUnorderedList")}
              >
                •
              </button>
              <button
                type="button"
                className={`dw-notes-format-button${formatState.numberedList ? " is-active" : ""}`}
                aria-pressed={formatState.numberedList}
                aria-label={t("itops.networkMap.noteFormatNumberedList")}
                title={t("itops.networkMap.noteFormatNumberedList")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMarkdownList("insertOrderedList")}
              >
                1.
              </button>
              <button
                type="button"
                className={`dw-notes-format-button${formatState.block === "blockquote" ? " is-active" : ""}`}
                aria-pressed={formatState.block === "blockquote"}
                aria-label={t("itops.networkMap.noteFormatQuote")}
                title={t("itops.networkMap.noteFormatQuote")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMarkdownBlock("blockquote")}
              >
                “
              </button>
              <span className="dw-notes-format-divider" aria-hidden="true" />
              <button
                type="button"
                className={`dw-notes-format-button${formatState.table ? " is-active" : ""}`}
                aria-pressed={formatState.table}
                aria-label={t("dashboard.notesInsertTable")}
                title={t("dashboard.notesInsertTable")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={insertMarkdownTable}
              >
                ▦
              </button>
              {formatState.table ? (
                <>
                  <button
                    type="button"
                    className="dw-notes-format-button dw-notes-format-button--table"
                    aria-label={t("dashboard.notesAddTableRow")}
                    title={t("dashboard.notesAddTableRow")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={addMarkdownTableRow}
                  >
                    +R
                  </button>
                  <button
                    type="button"
                    className="dw-notes-format-button dw-notes-format-button--table"
                    aria-label={t("dashboard.notesDeleteTableRow")}
                    title={t("dashboard.notesDeleteTableRow")}
                    disabled={!formatState.canDeleteTableRow}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={deleteMarkdownTableRow}
                  >
                    −R
                  </button>
                  <button
                    type="button"
                    className="dw-notes-format-button dw-notes-format-button--table"
                    aria-label={t("dashboard.notesAddTableColumn")}
                    title={t("dashboard.notesAddTableColumn")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={addMarkdownTableColumn}
                  >
                    +C
                  </button>
                  <button
                    type="button"
                    className="dw-notes-format-button dw-notes-format-button--table"
                    aria-label={t("dashboard.notesDeleteTableColumn")}
                    title={t("dashboard.notesDeleteTableColumn")}
                    disabled={!formatState.canDeleteTableColumn}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={deleteMarkdownTableColumn}
                  >
                    −C
                  </button>
                  <button
                    type="button"
                    className="dw-notes-format-button dw-notes-format-button--table is-danger"
                    aria-label={t("dashboard.notesDeleteTable")}
                    title={t("dashboard.notesDeleteTable")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={deleteMarkdownTable}
                  >
                    ×T
                  </button>
                </>
              ) : null}
            </div>
            <div
              className="dw-notes-page-actions dw-notes-page-actions--inline"
              role="group"
              aria-label={t("dashboard.notesPagesToolbarLabel")}
            >
              <button
                type="button"
                className="secondary-button dw-notes-page-button"
                aria-label={t("dashboard.notesAddPage")}
                title={t("dashboard.notesAddPage")}
                onClick={addPage}
              >
                <Plus size={14} />
              </button>
              {config.pages.length > 1 ? (
                <button
                  type="button"
                  className="secondary-button dw-notes-page-button"
                  aria-label={t("dashboard.notesDeletePage")}
                  title={t("dashboard.notesDeletePage")}
                  onClick={deletePage}
                >
                  <Minus size={14} />
                </button>
              ) : null}
            </div>
          </div>
          <div
            key={activePageIndex}
            ref={markdownEditorRef}
            className="dw-notes-markdown"
            aria-label={t("dashboard.notesAriaLabel")}
            data-placeholder={t("dashboard.notesPlaceholder")}
            contentEditable
            suppressContentEditableWarning
            onInput={() => {
              syncMarkdownEditor();
              captureMarkdownSelection();
            }}
            onFocus={captureMarkdownSelection}
            onKeyUp={captureMarkdownSelection}
            onMouseUp={captureMarkdownSelection}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) {
                event.preventDefault();
              }
            }}
            onContextMenu={handleNotesContextMenu}
          />
        </>
      ) : (
        <textarea
          ref={textAreaRef}
          className="dw-notes-text"
          value={activePage}
          onChange={(e) => updateActivePage(e.target.value)}
          placeholder={t("dashboard.notesPlaceholder")}
          aria-label={t("dashboard.notesAriaLabel")}
          spellCheck={false}
          onContextMenu={handleNotesContextMenu}
        />
      )}
      <div className="dw-notes-toolbar" role="toolbar" aria-label={t("dashboard.notesToolbarLabel")}>
        <div className="dw-notes-colors" role="radiogroup" aria-label={t("dashboard.notesBackgroundColor")}>
          {COLOR_VALUES.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={config.color === color}
              aria-label={t(`dashboard.notesColor.${color}`)}
              title={t(`dashboard.notesColor.${color}`)}
              className={`dw-notes-swatch dw-notes-swatch--${color}${config.color === color ? " is-active" : ""}`}
              onClick={() => setConfig({ ...config, color })}
            />
          ))}
        </div>
        {config.pages.length > 1 ? (
          <button
            type="button"
            className="dw-notes-page-indicator"
            aria-label={t("dashboard.notesPageIndicator", { page: activePageIndex + 1, total: config.pages.length })}
            title={t("dashboard.notesPageIndicator", { page: activePageIndex + 1, total: config.pages.length })}
            onClick={() => setActivePageIndex((activePageIndex + 1) % config.pages.length)}
          >
            {`<${activePageIndex + 1}>`}
          </button>
        ) : null}
        <select
          className="dw-notes-font-select"
          value={config.font}
          onChange={(e) => setConfig({ ...config, font: e.target.value as NotesFont })}
          aria-label={t("dashboard.notesFont")}
          title={t("dashboard.notesFont")}
        >
          {FONT_VALUES.map((font) => (
            <option key={font} value={font}>
              {t(`dashboard.notesFontOption.${font}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

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
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [tearingPageIndex, setTearingPageIndex] = useState<number | null>(null);
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
      {settings.markdownEnabled ? (
        <div
          key={activePageIndex}
          ref={markdownEditorRef}
          className="dw-notes-markdown"
          aria-label={t("dashboard.notesAriaLabel")}
          data-placeholder={t("dashboard.notesPlaceholder")}
          contentEditable
          suppressContentEditableWarning
          onInput={syncMarkdownEditor}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) {
              event.preventDefault();
            }
          }}
          onContextMenu={handleNotesContextMenu}
        />
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

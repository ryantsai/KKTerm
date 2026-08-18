import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import {
  Code, ImagePlus, Link, List, ListChecks, Minus, Palette, RotateCcw, RotateCw,
  Search, TableProperties, Waypoints,
} from "../../lib/reicon";

interface NoteToolbarProps {
  editor: Editor;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onInsertImage: () => void;
  onInsertLink: () => void;
  onInsertDeepLink: () => void;
  readOnly: boolean;
}

/** One formatting control. Text-formatting controls render a typographic glyph
 *  rather than an icon, matching the Notes widget and Screenshot editor; the
 *  Reicon set carries no bold/italic/heading glyphs. `onMouseDown` is
 *  suppressed so clicking a control never drops the editor's selection. */
function ToolButton({
  active,
  disabled,
  label,
  glyphClass,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  glyphClass?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`note-tool${glyphClass ? ` ${glyphClass}` : ""}${active ? " is-active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="note-tool-divider" aria-hidden="true" />;
}

export function NoteToolbar({
  editor,
  searchOpen,
  onToggleSearch,
  onInsertImage,
  onInsertLink,
  onInsertDeepLink,
  readOnly,
}: NoteToolbarProps) {
  const { t } = useTranslation();
  const size = 13;
  // Tiptap v3 does not re-render useEditor consumers on transactions by
  // default. The toolbar needs live selection/undo state for its controls.
  useEditorState({ editor, selector: ({ transactionNumber }) => transactionNumber });

  return (
    <div className="note-toolbar" role="toolbar" aria-label={t("notes.toolbar.label")}>
      <ToolButton
        disabled={readOnly || !editor.can().undo()}
        label={t("notes.toolbar.undo")}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <RotateCcw size={size} />
      </ToolButton>
      <ToolButton
        disabled={readOnly || !editor.can().redo()}
        label={t("notes.toolbar.redo")}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <RotateCw size={size} />
      </ToolButton>

      <Divider />

      <ToolButton
        active={editor.isActive("heading", { level: 1 })}
        disabled={readOnly}
        label={t("notes.toolbar.heading1")}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        H1
      </ToolButton>
      <ToolButton
        active={editor.isActive("heading", { level: 2 })}
        disabled={readOnly}
        label={t("notes.toolbar.heading2")}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolButton>
      <ToolButton
        active={editor.isActive("heading", { level: 3 })}
        disabled={readOnly}
        label={t("notes.toolbar.heading3")}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolButton>

      <Divider />

      <ToolButton
        active={editor.isActive("bold")}
        disabled={readOnly}
        glyphClass="is-bold"
        label={t("notes.toolbar.bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </ToolButton>
      <ToolButton
        active={editor.isActive("italic")}
        disabled={readOnly}
        glyphClass="is-italic"
        label={t("notes.toolbar.italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        I
      </ToolButton>
      <ToolButton
        active={editor.isActive("underline")}
        disabled={readOnly}
        glyphClass="is-underline"
        label={t("notes.toolbar.underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        U
      </ToolButton>
      <ToolButton
        active={editor.isActive("strike")}
        disabled={readOnly}
        glyphClass="is-strike"
        label={t("notes.toolbar.strikethrough")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        S
      </ToolButton>
      <ToolButton
        active={editor.isActive("highlight")}
        disabled={readOnly}
        label={t("notes.toolbar.highlight")}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <Palette size={size} />
      </ToolButton>
      <ToolButton
        active={editor.isActive("code")}
        disabled={readOnly}
        label={t("notes.toolbar.inlineCode")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={size} />
      </ToolButton>

      <Divider />

      <ToolButton
        active={editor.isActive("bulletList")}
        disabled={readOnly}
        label={t("notes.toolbar.bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={size} />
      </ToolButton>
      <ToolButton
        active={editor.isActive("orderedList")}
        disabled={readOnly}
        glyphClass="is-ordered"
        label={t("notes.toolbar.orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </ToolButton>
      <ToolButton
        active={editor.isActive("taskList")}
        disabled={readOnly}
        label={t("notes.toolbar.taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListChecks size={size} />
      </ToolButton>
      <ToolButton
        active={editor.isActive("blockquote")}
        disabled={readOnly}
        glyphClass="is-quote"
        label={t("notes.toolbar.blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        &ldquo;
      </ToolButton>
      <ToolButton
        active={editor.isActive("codeBlock")}
        disabled={readOnly}
        glyphClass="is-code-block"
        label={t("notes.toolbar.codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        {"{ }"}
      </ToolButton>

      <Divider />

      <ToolButton
        disabled={readOnly}
        label={t("notes.toolbar.horizontalRule")}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={size} />
      </ToolButton>
      <ToolButton
        disabled={readOnly}
        label={t("notes.toolbar.insertTable")}
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <TableProperties size={size} />
      </ToolButton>
      <ToolButton
        disabled={readOnly}
        label={t("notes.toolbar.insertImage")}
        onClick={onInsertImage}
      >
        <ImagePlus size={size} />
      </ToolButton>
      <ToolButton
        active={editor.isActive("link")}
        disabled={readOnly}
        label={t("notes.toolbar.insertLink")}
        onClick={onInsertLink}
      >
        <Link size={size} />
      </ToolButton>
      <ToolButton
        disabled={readOnly}
        label={t("notes.toolbar.insertDeepLink")}
        onClick={onInsertDeepLink}
      >
        <Waypoints size={size} />
      </ToolButton>

      <span className="note-tool-spacer" />

      <ToolButton
        active={searchOpen}
        label={t("notes.toolbar.search")}
        onClick={onToggleSearch}
      >
        <Search size={size} />
      </ToolButton>
    </div>
  );
}

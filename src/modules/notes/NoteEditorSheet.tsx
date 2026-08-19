import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { getMarkRange } from "@tiptap/core";
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { NoteImageView } from "./NoteImageView";
import CodeBlock from "@tiptap/extension-code-block";
import { NoteCodeBlockSendContext, NoteCodeBlockView } from "./NoteCodeBlockView";
import type { NoteCodeBlockSendTarget } from "./NoteCodeBlockView";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { FileText } from "../../lib/reicon";
import { Actions, Btn, ConfirmSheet, DialogShell, Sheet } from "../../app/ui/dialog";
import { useWorkspaceStore } from "../../store";
import { ConnectionGlyph } from "../workspace/connections/ConnectionGlyph";
import { getPaneRenderer, writeInputToPane } from "../workspace/paneRegistry";
import type { Connection, ConnectionType } from "../../types";
import { invokeCommand, openExternalUrl, saveMarkdownFile } from "../../lib/tauri";
import { NoteToolbar } from "./NoteToolbar";
import { NoteLinkPopover } from "./NoteLinkPopover";
import type { NoteLinkPopoverState } from "./NoteLinkPopover";
import { NoteSearchBar } from "./NoteSearchBar";
import { NoteDeepLinkPicker } from "./NoteDeepLinkPicker";
import { NoteDeepLinkMenu } from "./NoteDeepLinkMenu";
import { filterNoteDeepLinkChoices, useNoteDeepLinkChoices } from "./noteDeepLinkChoices";
import type { NoteDeepLinkChoice } from "./noteDeepLinkChoices";
import { CLOSED_SUGGESTION_STATE, NoteDeepLinkSuggestion } from "./noteDeepLinkSuggestion";
import type { NoteDeepLinkSuggestionState } from "./noteDeepLinkSuggestion";
import { NoteSearch } from "./noteSearch";
import { NoteDeepLinkNode, noteDeepLinkAttributes } from "./noteDeepLinkNode";
import { NOTE_ASSET_ATTRIBUTE, collectNoteAssetIds, dehydrateNoteAssets, hydrateNoteAssets, isNoteHtmlEmpty, sanitizeNoteHtml } from "./noteHtml";
import { createNoteMaskId, NOTE_MASK_ATTRIBUTE, NOTE_MASK_ID_ATTRIBUTE, NOTE_MASK_REVEALED_ATTRIBUTE, NoteMask } from "./noteMask";
import { deleteConnectionNote, getConnectionNote, pruneNoteAssets, putNoteAsset, saveConnectionNote } from "./noteCommands";
import { navigateNoteDeepLink, parseNoteDeepLink } from "./noteDeepLink";
import type { NoteDeepLink } from "./noteDeepLink";
import { downscaleImageFile } from "./noteImages";
import { noteHtmlToMarkdown, noteMarkdownFilename } from "./noteMarkdown";
import { showNativeContextMenu } from "../../lib/nativeContextMenu";
import type { NativeContextMenuItem } from "../../lib/nativeContextMenu";

const NOTE_EDITOR_SHEET_SIZE_KEY = "kkterm.notes.editorSheetSize.v1";
const NOTE_EDITOR_SHEET_DEFAULT_WIDTH = 860;
const NOTE_EDITOR_SHEET_DEFAULT_HEIGHT = 620;
const NOTE_EDITOR_SHEET_MIN_WIDTH = 560;
const NOTE_EDITOR_SHEET_MIN_HEIGHT = 380;

/** The Sheet's last dragged size, remembered across notes and app restarts. */
function loadNoteEditorSheetSize(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: NOTE_EDITOR_SHEET_DEFAULT_WIDTH, height: NOTE_EDITOR_SHEET_DEFAULT_HEIGHT };
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NOTE_EDITOR_SHEET_SIZE_KEY) ?? "null") as
      | { width?: number; height?: number }
      | null;
    const width =
      typeof parsed?.width === "number" && Number.isFinite(parsed.width)
        ? parsed.width
        : NOTE_EDITOR_SHEET_DEFAULT_WIDTH;
    const height =
      typeof parsed?.height === "number" && Number.isFinite(parsed.height)
        ? parsed.height
        : NOTE_EDITOR_SHEET_DEFAULT_HEIGHT;
    return { width, height };
  } catch {
    return { width: NOTE_EDITOR_SHEET_DEFAULT_WIDTH, height: NOTE_EDITOR_SHEET_DEFAULT_HEIGHT };
  }
}

function persistNoteEditorSheetSize(size: { width: number; height: number }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTE_EDITOR_SHEET_SIZE_KEY, JSON.stringify(size));
  } catch {
    // Storage may be unavailable (private mode, quota); fail silently.
  }
}

function isTerminalConnectionType(type: ConnectionType) {
  return type === "local" || type === "ssh" || type === "telnet" || type === "serial";
}

function normalizeNoteWebUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

interface NoteEditorSheetProps {
  connectionId: string;
  connectionName: string;
  onClose: () => void;
  /** Told whether the Connection owns a note after the sheet closes, so pane
   *  toolbars can update their post-it icon without refetching. */
  onBoundChange: (connectionId: string, bound: boolean) => void;
  showWorkspace: () => void;
  showItOps: () => void;
}

export function NoteEditorSheet({
  connectionId,
  connectionName,
  onClose,
  onBoundChange,
  showWorkspace,
  showItOps,
}: NoteEditorSheetProps) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [loading, setLoading] = useState(true);
  const [bound, setBound] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUploadCount, setImageUploadCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkPopover, setLinkPopover] = useState<NoteLinkPopoverState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Reaches the ancestor `.note-editor-sheet` Sheet via `.closest()` to seed its
  // remembered size, the same way the resize handle finds it (no Sheet API change).
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  // Object URLs minted while hydrating images; revoked when the sheet unmounts.
  const objectUrlsRef = useRef<string[]>([]);
  const originalAssetIdsRef = useRef<string[]>([]);
  const pendingImageUploadsRef = useRef<Set<Promise<void>>>(new Set());
  const pendingDeepLinkRef = useRef<{ link: NoteDeepLink; label: string } | null>(null);
  const revealedNoteMaskIdsRef = useRef<Set<string>>(new Set());
  const closingRef = useRef(false);
  // Resolved once per open; NoteEditorSheet only receives an id/name pair, so
  // the header icon and the code-block Terminal gate both need this fetch.
  const [connectionInfo, setConnectionInfo] = useState<Connection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invokeCommand("itops_get_connection", { id: connectionId })
      .then((connection) => {
        if (!cancelled) setConnectionInfo(connection ?? null);
      })
      .catch(() => {
        if (!cancelled) setConnectionInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  const sendCodeBlockToTerminal = useCallback(
    (text: string) => {
      const code = text.replace(/\r\n/g, "\n");
      if (!code.trim()) return;
      const tab = useWorkspaceStore
        .getState()
        .tabs.find((entry) => entry.kind === "terminal" && entry.connection?.id === connectionId);
      const paneId =
        tab?.focusedPaneId ??
        tab?.panes.find((pane) => pane.kind === undefined || pane.kind === "terminal")?.id;
      // Mirrors QuickCommandBar's payload: `\r` is the PTY's Enter, one per
      // line, so a multi-line block runs each line in turn.
      const payload = code.includes("\n")
        ? code
            .split("\n")
            .map((line) => `${line}\r`)
            .join("")
        : `${code}\r`;
      if (!paneId || !writeInputToPane(paneId, payload)) {
        showStatusBarNotice(t("notes.notice.sendToTerminalUnavailable"), { tone: "warning" });
        return;
      }
      getPaneRenderer(paneId)?.focus();
    },
    [connectionId, showStatusBarNotice, t],
  );

  const codeBlockSendTarget = useMemo<NoteCodeBlockSendTarget | null>(() => {
    if (!connectionInfo || !isTerminalConnectionType(connectionInfo.type)) return null;
    return { onSend: sendCodeBlockToTerminal };
  }, [connectionInfo, sendCodeBlockToTerminal]);

  const deepLinkChoices = useNoteDeepLinkChoices();
  const [suggestion, setSuggestion] = useState<NoteDeepLinkSuggestionState>(
    CLOSED_SUGGESTION_STATE,
  );
  // The `@` extension reads these through refs so the editor is built once and
  // never torn down when Connections, Workspaces, or Sites finish loading.
  const deepLinkChoicesRef = useRef<NoteDeepLinkChoice[]>([]);
  const suggestionIndexRef = useRef(0);
  const taskTranslateRef = useRef(t);
  deepLinkChoicesRef.current = deepLinkChoices;
  taskTranslateRef.current = t;

  const extensions = useMemo(
    () => [
      StarterKit.configure({ link: false, codeBlock: false }),
      Link.configure({ openOnClick: false, autolink: false }),
      TaskItem.configure({
        nested: true,
        a11y: {
          checkboxLabel: () => taskTranslateRef.current("notes.task.checkboxLabel"),
        },
      }),
      TaskList,
      TextStyle,
      Color,
      NoteMask,
      CodeBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(NoteCodeBlockView);
        },
      }),
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            // Carries the out-of-line asset id so the stored HTML never
            // embeds image bytes.
            [NOTE_ASSET_ATTRIBUTE]: {
              default: null,
              parseHTML: (element) => element.getAttribute(NOTE_ASSET_ATTRIBUTE),
              renderHTML: (attributes) => {
                const id = attributes[NOTE_ASSET_ATTRIBUTE];
                return id ? { [NOTE_ASSET_ATTRIBUTE]: id } : {};
              },
            },
            // Set by the drag-to-resize handle; `width` is already
            // sanitizer-allowlisted, so it round-trips through save/load.
            width: {
              default: null,
              parseHTML: (element) => {
                const value = element.getAttribute("width");
                return value ? Number(value) : null;
              },
              renderHTML: (attributes) =>
                typeof attributes.width === "number" ? { width: String(attributes.width) } : {},
            },
          };
        },
        addNodeView() {
          return ReactNodeViewRenderer(NoteImageView);
        },
      }).configure({ inline: false, allowBase64: false }),
      Highlight,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TableKit.configure({ table: { resizable: true } }),
      NoteDeepLinkNode,
      NoteDeepLinkSuggestion.configure({
        getChoices: () => deepLinkChoicesRef.current,
        filter: filterNoteDeepLinkChoices,
        onStateChange: setSuggestion,
        getActiveIndex: () => suggestionIndexRef.current,
        setActiveIndex: (index) => {
          suggestionIndexRef.current = index;
        },
      }),
      NoteSearch,
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content: "",
    editable: false,
    onUpdate: () => setDirty(true),
    editorProps: {
      attributes: {
        class: "note-editor-surface",
        "aria-label": t("notes.editor.contentLabel"),
      },
    },
  });
  const empty =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) =>
        currentEditor ? isNoteHtmlEmpty(currentEditor.getHTML()) : true,
    }) ?? true;

  // Load the Connection's note. A Connection with no note opens on a blank
  // editor and only binds once the user saves.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    setLoading(true);
    revealedNoteMaskIdsRef.current.clear();
    editor.setEditable(false);
    void getConnectionNote(connectionId)
      .then(async (note) => {
        if (cancelled) return;
        if (!note) {
          setBound(false);
          originalAssetIdsRef.current = [];
          editor.commands.setContent("", { emitUpdate: false });
        } else {
          setBound(true);
          const sanitizedHtml = sanitizeNoteHtml(note.contentHtml);
          originalAssetIdsRef.current = collectNoteAssetIds(sanitizedHtml);
          const { html, objectUrls } = await hydrateNoteAssets(sanitizedHtml, connectionId);
          if (cancelled) {
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
            return;
          }
          objectUrlsRef.current.push(...objectUrls);
          editor.commands.setContent(html, { emitUpdate: false });
        }
        // Loading content marks the editor updated; the note is not user-dirty
        // until they actually type.
        setDirty(false);
        setLoading(false);
        editor.setEditable(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoading(false);
        showStatusBarNotice(
          t("notes.notice.loadFailed", { error: String(error) }),
          { tone: "error" },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [editor, connectionId, showStatusBarNotice, t]);

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    },
    [],
  );

  // Seed the Sheet's remembered size once on mount; the resize handle updates
  // these same CSS custom properties (and localStorage) as the user drags.
  useEffect(() => {
    const dialog = editorWrapperRef.current?.closest<HTMLElement>(".note-editor-sheet");
    if (!dialog) return;
    const size = loadNoteEditorSheetSize();
    dialog.style.setProperty("--note-editor-sheet-width", `${size.width}px`);
    dialog.style.setProperty("--note-editor-sheet-height", `${size.height}px`);
  }, []);

  const storeImage = useCallback(
    (file: File) => {
      if (!editor || closingRef.current) return Promise.resolve();
      setImageUploadCount((count) => count + 1);
      const operation = (async () => {
        try {
          const { bytes, mimeType } = await downscaleImageFile(file);
          const assetId = await putNoteAsset(connectionId, mimeType, bytes);
          if (closingRef.current || editor.isDestroyed) return;
          const blob = new Blob([bytes as BlobPart], { type: mimeType });
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.push(url);
          editor
            .chain()
            .focus()
            .setImage({ src: url, [NOTE_ASSET_ATTRIBUTE]: assetId } as never)
            .run();
          setDirty(true);
        } catch (error) {
          if (!closingRef.current) {
            showStatusBarNotice(
              t("notes.notice.imageFailed", { error: String(error) }),
              { tone: "error" },
            );
          }
        }
      })();
      pendingImageUploadsRef.current.add(operation);
      void operation.finally(() => {
        pendingImageUploadsRef.current.delete(operation);
        setImageUploadCount((count) => Math.max(0, count - 1));
      });
      return operation;
    },
    [editor, connectionId, showStatusBarNotice, t],
  );

  // Pasting or dropping an image stores it as an asset rather than leaving a
  // multi-megabyte data URI inside the note HTML.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    function imageFilesFrom(transfer: DataTransfer | null): File[] {
      if (!transfer) return [];
      return [...transfer.files].filter((file) => file.type.startsWith("image/"));
    }
    function onPaste(event: ClipboardEvent) {
      const files = imageFilesFrom(event.clipboardData);
      if (files.length > 0) {
        event.preventDefault();
        files.forEach((file) => void storeImage(file));
        return;
      }
      const html = event.clipboardData?.getData("text/html");
      if (html) {
        event.preventDefault();
        editor.chain().focus().insertContent(sanitizeNoteHtml(html)).run();
      }
    }
    function onDrop(event: DragEvent) {
      const files = imageFilesFrom(event.dataTransfer);
      if (files.length > 0) {
        event.preventDefault();
        files.forEach((file) => void storeImage(file));
        return;
      }
      const html = event.dataTransfer?.getData("text/html");
      if (html) {
        event.preventDefault();
        editor.chain().focus().insertContent(sanitizeNoteHtml(html)).run();
      }
    }
    dom.addEventListener("paste", onPaste);
    dom.addEventListener("drop", onDrop);
    return () => {
      dom.removeEventListener("paste", onPaste);
      dom.removeEventListener("drop", onDrop);
    };
  }, [editor, storeImage]);

  // Clicking a Deep Link chip follows it and closes the note, so the user lands
  // on the target rather than behind a modal.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    // A chip whose target was renamed or deleted can never navigate again;
    // leaving it a permanently dead-looking colored pill is worse than
    // flattening it to the plain text it displays, so it self-heals in place.
    function unwrapDeadDeepLinkChip(chip: HTMLElement) {
      if (editor.isDestroyed) return;
      let pos: number;
      try {
        pos = editor.view.posAtDOM(chip, 0);
      } catch {
        return;
      }
      let node = editor.state.doc.nodeAt(pos);
      if (node?.type.name !== "noteDeepLink" && pos > 0) {
        node = editor.state.doc.nodeAt(pos - 1);
        if (node?.type.name === "noteDeepLink") pos -= 1;
      }
      if (!node || node.type.name !== "noteDeepLink") return;
      const label = typeof node.attrs.label === "string" ? node.attrs.label : "";
      editor
        .chain()
        .insertContentAt(
          { from: pos, to: pos + node.nodeSize },
          label ? [{ type: "text", text: label }] : [],
        )
        .run();
      setDirty(true);
    }

    function onClick(event: MouseEvent) {
      const chip = (event.target as HTMLElement | null)?.closest?.(".note-deep-link");
      if (!chip) return;
      const link = parseNoteDeepLink(chip.getAttribute("data-note-deep-link"));
      if (!link) return;
      event.preventDefault();
      if (dirty || pendingImageUploadsRef.current.size > 0) {
        const targetLabel =
          chip.getAttribute("data-note-label")?.trim() ||
          chip.textContent?.trim() ||
          t("notes.deepLink.linkedItem");
        pendingDeepLinkRef.current = { link, label: targetLabel };
        setConfirmDiscard(true);
        return;
      }
      void navigateNoteDeepLink(link, showWorkspace, showItOps).then((navigated) => {
        if (!navigated) {
          showStatusBarNotice(t("notes.notice.deepLinkUnavailable"), { tone: "warning" });
          unwrapDeadDeepLinkChip(chip as HTMLElement);
          return;
        }
        onClose();
      });
    }
    dom.addEventListener("click", onClick);
    return () => dom.removeEventListener("click", onClick);
  }, [editor, showWorkspace, showItOps, showStatusBarNotice, onClose, dirty, t]);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const revealLabel = t("notes.mask.reveal");

    const syncNoteMasks = () => {
      dom.querySelectorAll<HTMLElement>(`[${NOTE_MASK_ATTRIBUTE}="true"]`).forEach((element) => {
        const maskId = element.getAttribute(NOTE_MASK_ID_ATTRIBUTE) ?? createNoteMaskId();
        element.setAttribute(NOTE_MASK_ID_ATTRIBUTE, maskId);
        const revealed = revealedNoteMaskIdsRef.current.has(maskId);
        if (revealed) {
          element.setAttribute(NOTE_MASK_REVEALED_ATTRIBUTE, "true");
          element.removeAttribute("role");
          element.removeAttribute("tabindex");
          element.removeAttribute("aria-label");
          element.removeAttribute("title");
          return;
        }
        element.removeAttribute(NOTE_MASK_REVEALED_ATTRIBUTE);
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        element.setAttribute("aria-label", revealLabel);
        element.setAttribute("title", revealLabel);
      });
    };

    const maskFromTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement
        ? target.closest<HTMLElement>(`[${NOTE_MASK_ATTRIBUTE}="true"]`)
        : null;

    const revealMask = (element: HTMLElement) => {
      const maskId = element.getAttribute(NOTE_MASK_ID_ATTRIBUTE);
      if (!maskId || revealedNoteMaskIdsRef.current.has(maskId)) return;
      revealedNoteMaskIdsRef.current.add(maskId);
      syncNoteMasks();
      if (
        typeof window === "undefined" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        typeof element.animate !== "function"
      ) {
        return;
      }
      element.animate(
        [
          { opacity: 0.28, filter: "blur(3px)" },
          { opacity: 1, filter: "blur(0)" },
        ],
        {
          duration: 360,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          fill: "both",
        },
      );
    };

    const onClick = (event: MouseEvent) => {
      const mask = maskFromTarget(event.target);
      if (!mask || mask.getAttribute(NOTE_MASK_REVEALED_ATTRIBUTE) === "true") return;
      event.preventDefault();
      event.stopPropagation();
      revealMask(mask);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const mask = maskFromTarget(event.target);
      if (!mask || mask.getAttribute(NOTE_MASK_REVEALED_ATTRIBUTE) === "true") return;
      event.preventDefault();
      event.stopPropagation();
      revealMask(mask);
    };

    editor.on("transaction", syncNoteMasks);
    dom.addEventListener("click", onClick);
    dom.addEventListener("keydown", onKeyDown);
    syncNoteMasks();
    return () => {
      editor.off("transaction", syncNoteMasks);
      dom.removeEventListener("click", onClick);
      dom.removeEventListener("keydown", onKeyDown);
    };
  }, [editor, t]);

  function toggleNoteMask() {
    if (!editor) return;
    if (editor.state.selection.empty) {
      showStatusBarNotice(t("notes.notice.selectTextForMask"), { tone: "info" });
      return;
    }
    const chain = editor.chain().focus();
    const applied = editor.isActive("noteMask")
      ? chain.unsetMark("noteMask").run()
      : chain.setMark("noteMask", { id: createNoteMaskId() }).run();
    if (applied) setDirty(true);
  }

  async function handleSave() {
    if (!editor) return;
    setSaving(true);
    try {
      const html = sanitizeNoteHtml(dehydrateNoteAssets(editor.getHTML()));
      await saveConnectionNote(connectionId, html);
      await pruneNoteAssets(connectionId, collectNoteAssetIds(html)).catch(() => 0);
      setBound(true);
      setDirty(false);
      onBoundChange(connectionId, true);
      showStatusBarNotice(t("notes.notice.saved", { name: connectionName }), {
        tone: "success",
      });
      onClose();
    } catch (error) {
      showStatusBarNotice(t("notes.notice.saveFailed", { error: String(error) }), {
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  // Export writes what is currently in the editor, saved or not, so an
  // operator can hand off a note they are still drafting. Images stay in the
  // app data directory; the Markdown carries their path as a reference.
  async function handleExportMarkdown() {
    if (!editor) return;
    try {
      const markdown = noteHtmlToMarkdown(sanitizeNoteHtml(dehydrateNoteAssets(editor.getHTML())));
      const path = await saveMarkdownFile(noteMarkdownFilename(connectionName), markdown, {
        title: t("notes.export.dialogTitle"),
        filterName: t("notes.export.filterName"),
      });
      if (!path) return;
      showStatusBarNotice(t("notes.notice.exported", { path }), { tone: "success" });
    } catch (error) {
      showStatusBarNotice(t("notes.notice.exportFailed", { error: String(error) }), {
        tone: "error",
      });
    }
  }

  async function handleDelete() {
    setConfirmDelete(false);
    try {
      closingRef.current = true;
      await Promise.allSettled([...pendingImageUploadsRef.current]);
      await deleteConnectionNote(connectionId);
      onBoundChange(connectionId, false);
      showStatusBarNotice(t("notes.notice.deleted", { name: connectionName }), {
        tone: "success",
      });
      onClose();
    } catch (error) {
      closingRef.current = false;
      showStatusBarNotice(t("notes.notice.deleteFailed", { error: String(error) }), {
        tone: "error",
      });
    }
  }

  function requestClose() {
    setLinkPopover(null);
    pendingDeepLinkRef.current = null;
    if (dirty || pendingImageUploadsRef.current.size > 0) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  async function discardAndClose() {
    const pendingDeepLink = pendingDeepLinkRef.current;
    pendingDeepLinkRef.current = null;
    if (pendingDeepLink) {
      const navigated = await navigateNoteDeepLink(pendingDeepLink.link, showWorkspace, showItOps);
      if (!navigated) {
        setConfirmDiscard(false);
        showStatusBarNotice(t("notes.notice.deepLinkUnavailable"), { tone: "warning" });
        return;
      }
    }
    closingRef.current = true;
    setConfirmDiscard(false);
    await Promise.allSettled([...pendingImageUploadsRef.current]);
    await pruneNoteAssets(connectionId, originalAssetIdsRef.current).catch(() => 0);
    onClose();
  }

  // Mouse selection in the `@` menu bypasses the suggestion plugin's keyboard
  // handler, so it replaces the tracked query range itself. The range runs from
  // the `@` back-searched from the caret through the caret.
  function pickSuggestion(choice: NoteDeepLinkChoice) {
    if (!editor) return;
    const { state } = editor;
    const to = state.selection.from;
    const from = to - suggestion.query.length - 1;
    if (from < 0) return;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from, to },
        [
          {
            type: "noteDeepLink",
            attrs: noteDeepLinkAttributes(choice.link, choice.label),
          },
          { type: "text", text: " " },
        ],
      )
      .run();
    setSuggestion(CLOSED_SUGGESTION_STATE);
    setDirty(true);
  }

  function linkRangeAtPosition(position: number) {
    if (!editor) return null;
    const markType = editor.state.schema.marks.link;
    if (!markType) return null;
    const maxPosition = editor.state.doc.content.size;
    for (const candidate of [position, position + 1, position - 1]) {
      const clamped = Math.max(0, Math.min(candidate, maxPosition));
      const range = getMarkRange(editor.state.doc.resolve(clamped), markType);
      if (range) return range;
    }
    return null;
  }

  function linkRangeAtElement(element: HTMLAnchorElement) {
    if (!editor) return null;
    const nodes: Node[] = [element];
    if (element.firstChild) nodes.push(element.firstChild);
    for (const node of nodes) {
      try {
        const range = linkRangeAtPosition(editor.view.posAtDOM(node, 0));
        if (range) return range;
      } catch {
        // A stale DOM node can disappear between the event and the position
        // lookup. The click simply falls back to the editor's normal behavior.
      }
    }
    return null;
  }

  function linkHrefAtRange(range: { from: number; to: number }) {
    if (!editor) return "";
    const markType = editor.state.schema.marks.link;
    if (!markType) return "";
    const maxPosition = editor.state.doc.content.size;
    for (const candidate of [range.from, range.from + 1, range.to - 1]) {
      const clamped = Math.max(0, Math.min(candidate, maxPosition));
      const mark = editor.state.doc
        .resolve(clamped)
        .marks()
        .find((item) => item.type === markType);
      if (typeof mark?.attrs.href === "string") return mark.attrs.href;
    }
    return "";
  }

  function openNoteLink(href: string) {
    const normalizedHref = normalizeNoteWebUrl(href);
    if (!normalizedHref) return;
    void openExternalUrl(normalizedHref);
  }

  function clampLinkPopoverPosition(left: number, top: number) {
    if (typeof window === "undefined") return { left, top };
    const margin = 8;
    const width = Math.min(360, Math.max(0, window.innerWidth - margin * 2));
    const height = 220;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const nextLeft = Math.min(Math.max(margin, left), maxLeft);
    const nextTop =
      top + height <= window.innerHeight - margin
        ? Math.max(margin, top)
        : Math.max(margin, top - height - margin);
    return { left: nextLeft, top: nextTop };
  }

  function selectionLinkPopoverPosition(range: { from: number; to: number }) {
    if (!editor) return { left: 8, top: 8 };
    try {
      const start = editor.view.coordsAtPos(range.from);
      const end = editor.view.coordsAtPos(range.to);
      return clampLinkPopoverPosition(
        Math.min(start.left, end.left),
        Math.max(start.bottom, end.bottom) + 8,
      );
    } catch {
      return clampLinkPopoverPosition(8, 8);
    }
  }

  function openLinkEditor(
    range: { from: number; to: number },
    href = "",
    existing = false,
    position?: { left: number; top: number },
  ) {
    if (!editor) return;
    const text = editor.state.doc.textBetween(range.from, range.to, " ");
    if (!text.trim()) {
      showStatusBarNotice(t("notes.notice.selectTextForLink"), { tone: "info" });
      return;
    }
    setLinkPopover({
      from: range.from,
      to: range.to,
      text,
      href,
      existing,
      position: position
        ? clampLinkPopoverPosition(position.left, position.top)
        : selectionLinkPopoverPosition(range),
    });
  }

  function insertLink() {
    if (!editor) return;
    const selection = editor.state.selection;
    let range = { from: selection.from, to: selection.to };
    let href: string;
    if (selection.empty) {
      const markType = editor.state.schema.marks.link;
      const linkedRange = markType ? getMarkRange(selection.$from, markType) : undefined;
      if (!linkedRange) {
        showStatusBarNotice(t("notes.notice.selectTextForLink"), { tone: "info" });
        return;
      }
      range = linkedRange;
      href = linkHrefAtRange(range);
    } else {
      href = editor.getAttributes("link").href ?? linkHrefAtRange(range);
      if (!href) {
        const selectedText = editor.state.doc.textBetween(range.from, range.to, " ");
        if (normalizeNoteWebUrl(selectedText)) href = selectedText;
      }
    }
    openLinkEditor(range, href, Boolean(href));
  }

  function applyNoteLink(text: string, href: string) {
    if (!editor || !linkPopover) return false;
    const normalizedHref = normalizeNoteWebUrl(href);
    if (!normalizedHref) {
      showStatusBarNotice(t("notes.notice.invalidLinkUrl"), { tone: "info" });
      return false;
    }
    const linkText = text.trim();
    if (!linkText) {
      showStatusBarNotice(t("notes.notice.selectTextForLink"), { tone: "info" });
      return false;
    }

    const command = editor.chain().focus().setTextSelection({
      from: linkPopover.from,
      to: linkPopover.to,
    });
    const applied =
      linkText === linkPopover.text
        ? command.setLink({ href: normalizedHref }).run()
        : command
            .insertContentAt(
              { from: linkPopover.from, to: linkPopover.to },
              {
                type: "text",
                text: linkText,
                marks: [{ type: "link", attrs: { href: normalizedHref } }],
              },
            )
            .run();
    if (applied) setDirty(true);
    return applied;
  }

  function removeNoteLink() {
    if (!editor || !linkPopover) return;
    const removed = editor
      .chain()
      .focus()
      .setTextSelection({ from: linkPopover.from, to: linkPopover.to })
      .unsetLink()
      .run();
    if (removed) setDirty(true);
  }

  function linkAnchorFromEvent(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    return target?.closest<HTMLAnchorElement>("a[href]") ?? null;
  }

  function handleNoteLinkClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!editor || loading) return;
    const anchor = linkAnchorFromEvent(event);
    if (!anchor) return;
    const range = linkRangeAtElement(anchor);
    if (!range) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      openNoteLink(anchor.getAttribute("href") ?? "");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    editor.chain().focus().setTextSelection(range).run();
    const rect = anchor.getBoundingClientRect();
    openLinkEditor(range, anchor.getAttribute("href") ?? "", true, {
      left: rect.left,
      top: rect.bottom + 8,
    });
  }

  function handleNoteLinkContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!editor || loading) return;
    const anchor = linkAnchorFromEvent(event);
    if (anchor) {
      const range = linkRangeAtElement(anchor);
      if (!range) return;
      event.preventDefault();
      event.stopPropagation();
      editor.chain().focus().setTextSelection(range).run();
      const href = normalizeNoteWebUrl(anchor.getAttribute("href") ?? "");
      const contextPosition = { x: event.clientX, y: event.clientY };
      const editLink = () =>
        openLinkEditor(range, href ?? anchor.getAttribute("href") ?? "", true, {
          left: contextPosition.x,
          top: contextPosition.y + 8,
        });
      if (!href) {
        editLink();
        return;
      }
      const items: NativeContextMenuItem[] = [
        {
          kind: "item",
          label: t("webview.openExternally"),
          action: () => openNoteLink(href),
        },
        { kind: "separator" },
        {
          kind: "item",
          label: t("common.edit"),
          action: editLink,
        },
      ];
      void showNativeContextMenu(items, contextPosition).then((shown) => {
        if (!shown) editLink();
      });
      return;
    }
    handleTableContextMenu(event);
  }

  // The table toolbar button only inserts a fixed 3x3 grid; row/column editing
  // and table removal live here as a right-click menu on the cell, matching
  // how every other native-feeling context menu in the app is built.
  function handleTableContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!editor || loading) return;
    const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>("td, th");
    if (!cell) return;
    event.preventDefault();
    const pos = editor.view.posAtDOM(cell, 0);
    editor.chain().focus().setTextSelection(pos).run();
    // Reuses the Dashboard Notes widget's table-editing vocabulary
    // (`dashboard.notes*`) rather than minting a parallel set of strings.
    const items: NativeContextMenuItem[] = [
      {
        kind: "item",
        label: t("dashboard.notesAddTableRow"),
        action: () => editor.chain().focus().addRowAfter().run(),
      },
      {
        kind: "item",
        label: t("dashboard.notesDeleteTableRow"),
        action: () => editor.chain().focus().deleteRow().run(),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: t("dashboard.notesAddTableColumn"),
        action: () => editor.chain().focus().addColumnAfter().run(),
      },
      {
        kind: "item",
        label: t("dashboard.notesDeleteTableColumn"),
        action: () => editor.chain().focus().deleteColumn().run(),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: t("dashboard.notesDeleteTable"),
        action: () => editor.chain().focus().deleteTable().run(),
      },
    ];
    void showNativeContextMenu(items, { x: event.clientX, y: event.clientY });
  }

  const canSave =
    Boolean(editor) && !loading && !saving && imageUploadCount === 0 && (dirty || !bound);
  return (
    <>
      <DialogShell onBackdrop={requestClose}>
        <Sheet
          width={860}
          height={620}
          className="note-editor-sheet"
          ariaLabel={t("notes.editor.title", { name: connectionName })}
          eyebrow={
            <span className="note-editor-eyebrow">
              <FileText size={12} />
              {t("notes.editor.eyebrow")}
            </span>
          }
          title={
            <span className="note-editor-title-content">
              {connectionInfo ? (
                <ConnectionGlyph
                  iconBackgroundColor={connectionInfo.iconBackgroundColor}
                  iconColor={connectionInfo.iconColor}
                  iconDataUrl={connectionInfo.iconDataUrl}
                  localShell={connectionInfo.localShell}
                  size={14}
                  type={connectionInfo.type}
                />
              ) : null}
              {connectionName}
            </span>
          }
          rule
          footer={
            <>
              <Actions
                extraLeft={
                  bound ? (
                    <Btn kind="danger" onClick={() => setConfirmDelete(true)}>
                      {t("notes.editor.delete")}
                    </Btn>
                  ) : null
                }
                cancel={<Btn onClick={requestClose}>{t("common.cancel")}</Btn>}
                primary={
                  <Btn
                    kind="primary"
                    disabled={!canSave || (empty && !bound)}
                    onClick={() => void handleSave()}
                  >
                    {t("common.save")}
                  </Btn>
                }
              />
              <NoteEditorSheetResizeHandle label={t("notes.editor.resizeDialog")} />
            </>
          }
        >
          {editor ? (
            <div className="note-editor" ref={editorWrapperRef}>
              <NoteToolbar
                editor={editor}
                readOnly={loading}
                searchOpen={searchOpen}
                onToggleSearch={() => setSearchOpen((previous) => !previous)}
                onInsertImage={() => fileInputRef.current?.click()}
                onInsertLink={insertLink}
                onToggleMask={toggleNoteMask}
                onInsertDeepLink={() => setPickerOpen(true)}
                onExportMarkdown={() => void handleExportMarkdown()}
                canExport={!loading && !empty}
              />
              {searchOpen ? (
                <NoteSearchBar
                  editor={editor}
                  readOnly={loading}
                  onClose={() => setSearchOpen(false)}
                />
              ) : null}
              <NoteCodeBlockSendContext.Provider value={codeBlockSendTarget}>
                <EditorContent
                  className="note-editor-content"
                  editor={editor}
                  onClick={handleNoteLinkClick}
                  onContextMenu={handleNoteLinkContextMenu}
                />
              </NoteCodeBlockSendContext.Provider>
              <NoteDeepLinkMenu onPick={pickSuggestion} state={suggestion} />
              <NoteLinkPopover
                state={linkPopover}
                onCancel={() => setLinkPopover(null)}
                onApply={applyNoteLink}
                onRemove={removeNoteLink}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void storeImage(file);
                }}
              />
            </div>
          ) : null}
        </Sheet>
      </DialogShell>

      {pickerOpen ? (
        <NoteDeepLinkPicker
          onCancel={() => setPickerOpen(false)}
          onPick={(link, label) => {
            setPickerOpen(false);
            editor
              ?.chain()
              .focus()
              .insertContent({
                type: "noteDeepLink",
                attrs: noteDeepLinkAttributes(link, label),
              })
              .run();
            setDirty(true);
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmSheet
          tone="danger"
          zClassName="kk-qc-subdialog"
          title={t("notes.confirmDelete.title")}
          message={t("notes.confirmDelete.message", { name: connectionName })}
          confirmLabel={t("notes.editor.delete")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}

      {confirmDiscard ? (
        <ConfirmSheet
          tone="warn"
          zClassName="kk-qc-subdialog"
          title={t(pendingDeepLinkRef.current ? "notes.confirmDeepLink.title" : "notes.confirmDiscard.title")}
          message={
            pendingDeepLinkRef.current
              ? t("notes.confirmDeepLink.message", { target: pendingDeepLinkRef.current.label })
              : t("notes.confirmDiscard.message")
          }
          confirmLabel={t(pendingDeepLinkRef.current ? "notes.confirmDeepLink.confirm" : "notes.confirmDiscard.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => void discardAndClose()}
          onCancel={() => {
            pendingDeepLinkRef.current = null;
            setConfirmDiscard(false);
          }}
        />
      ) : null}
    </>
  );
}

/** Bottom-right corner drag handle for the note editor Sheet, mirroring
 *  `TerminalRecordingsDialogResizeHandle`'s pointer-captured resize (writing
 *  CSS custom properties the Sheet's own `!important` sizing rule reads), plus
 *  localStorage persistence so the dragged size survives across notes and app
 *  restarts. */
function NoteEditorSheetResizeHandle({ label }: { label: string }) {
  const dragStart = useRef<
    | {
        height: number;
        pointerId: number;
        startX: number;
        startY: number;
        width: number;
      }
    | undefined
  >(undefined);

  function dialogFor(target: HTMLElement) {
    return target.closest<HTMLElement>(".note-editor-sheet");
  }

  function resizeDialog(dialog: HTMLElement, width: number, height: number) {
    const maxWidth = Math.max(320, window.innerWidth - 24);
    const maxHeight = Math.max(320, window.innerHeight - 24);
    const minWidth = Math.min(NOTE_EDITOR_SHEET_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(NOTE_EDITOR_SHEET_MIN_HEIGHT, maxHeight);
    const nextWidth = Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, Math.round(height)));
    dialog.style.setProperty("--note-editor-sheet-width", `${nextWidth}px`);
    dialog.style.setProperty("--note-editor-sheet-height", `${nextHeight}px`);
    persistNoteEditorSheetSize({ width: nextWidth, height: nextHeight });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const dialog = dialogFor(event.currentTarget);
    if (!dialog) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = dialog.getBoundingClientRect();
    dragStart.current = {
      height: bounds.height,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = dragStart.current;
    const dialog = dialogFor(event.currentTarget);
    if (!start || start.pointerId !== event.pointerId || !dialog) {
      return;
    }
    resizeDialog(
      dialog,
      start.width + event.clientX - start.startX,
      start.height + event.clientY - start.startY,
    );
  }

  function finishPointerResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragStart.current?.pointerId !== event.pointerId) {
      return;
    }
    dragStart.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleResizeKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    const dialog = dialogFor(event.currentTarget);
    if (!dialog) {
      return;
    }
    event.preventDefault();
    const bounds = dialog.getBoundingClientRect();
    const step = event.shiftKey ? 64 : 24;
    resizeDialog(
      dialog,
      bounds.width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
      bounds.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
    );
  }

  return (
    <button
      aria-label={label}
      className="note-editor-sheet-resizer"
      onKeyDown={handleResizeKey}
      onPointerCancel={finishPointerResize}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerResize}
      title={label}
      type="button"
    />
  );
}

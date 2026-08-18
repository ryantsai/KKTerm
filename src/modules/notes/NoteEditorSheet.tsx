import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { Actions, Btn, ConfirmSheet, DialogShell, Sheet } from "../../app/ui/dialog";
import { useWorkspaceStore } from "../../store";
import { NoteToolbar } from "./NoteToolbar";
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
import { deleteConnectionNote, getConnectionNote, pruneNoteAssets, putNoteAsset, saveConnectionNote } from "./noteCommands";
import { navigateNoteDeepLink, parseNoteDeepLink } from "./noteDeepLink";
import type { NoteDeepLink } from "./noteDeepLink";
import { downscaleImageFile } from "./noteImages";

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Object URLs minted while hydrating images; revoked when the sheet unmounts.
  const objectUrlsRef = useRef<string[]>([]);
  const originalAssetIdsRef = useRef<string[]>([]);
  const pendingImageUploadsRef = useRef<Set<Promise<void>>>(new Set());
  const pendingDeepLinkRef = useRef<NoteDeepLink | null>(null);
  const closingRef = useRef(false);

  const deepLinkChoices = useNoteDeepLinkChoices();
  const [suggestion, setSuggestion] = useState<NoteDeepLinkSuggestionState>(
    CLOSED_SUGGESTION_STATE,
  );
  // The `@` extension reads these through refs so the editor is built once and
  // never torn down when Connections, Workspaces, or Sites finish loading.
  const deepLinkChoicesRef = useRef<NoteDeepLinkChoice[]>([]);
  const suggestionIndexRef = useRef(0);
  deepLinkChoicesRef.current = deepLinkChoices;

  const extensions = useMemo(
    () => [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: false }),
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
          };
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
    editor.setEditable(false);
    void getConnectionNote(connectionId)
      .then(async (note) => {
        if (cancelled) return;
        if (!note) {
          setBound(false);
          originalAssetIdsRef.current = [];
          editor.commands.setContent("");
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
          editor.commands.setContent(html);
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
    function onClick(event: MouseEvent) {
      const chip = (event.target as HTMLElement | null)?.closest?.(".note-deep-link");
      if (!chip) return;
      const link = parseNoteDeepLink(chip.getAttribute("data-note-deep-link"));
      if (!link) return;
      event.preventDefault();
      if (dirty || pendingImageUploadsRef.current.size > 0) {
        pendingDeepLinkRef.current = link;
        setConfirmDiscard(true);
        return;
      }
      void navigateNoteDeepLink(link, showWorkspace, showItOps).then((navigated) => {
        if (!navigated) {
          showStatusBarNotice(t("notes.notice.deepLinkUnavailable"), { tone: "warning" });
          return;
        }
        onClose();
      });
    }
    dom.addEventListener("click", onClick);
    return () => dom.removeEventListener("click", onClick);
  }, [editor, showWorkspace, showItOps, showStatusBarNotice, onClose, dirty, t]);

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
      const navigated = await navigateNoteDeepLink(pendingDeepLink, showWorkspace, showItOps);
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

  function insertLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href ?? "";
    // The note editor is app-owned UI, so the URL prompt is a dialog field
    // rather than window.prompt (AGENTS.md forbids native prompts).
    const selectionEmpty = editor.state.selection.empty;
    if (selectionEmpty && !previous) {
      showStatusBarNotice(t("notes.notice.selectTextForLink"), { tone: "info" });
      return;
    }
    if (previous) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const text = editor.state.doc.textBetween(
      editor.state.selection.from,
      editor.state.selection.to,
    );
    // A selected URL links to itself; anything else needs an explicit target,
    // which the Deep Link picker covers for in-app destinations.
    if (!/^https?:\/\//i.test(text)) {
      showStatusBarNotice(t("notes.notice.selectUrlForLink"), { tone: "info" });
      return;
    }
    editor.chain().focus().setLink({ href: text }).run();
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
          title={t("notes.editor.title", { name: connectionName })}
          footer={
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
          }
        >
          {editor ? (
            <div className="note-editor">
              <NoteToolbar
                editor={editor}
                readOnly={loading}
                searchOpen={searchOpen}
                onToggleSearch={() => setSearchOpen((previous) => !previous)}
                onInsertImage={() => fileInputRef.current?.click()}
                onInsertLink={insertLink}
                onInsertDeepLink={() => setPickerOpen(true)}
              />
              {searchOpen ? (
                <NoteSearchBar
                  editor={editor}
                  readOnly={loading}
                  onClose={() => setSearchOpen(false)}
                />
              ) : null}
              <EditorContent className="note-editor-content" editor={editor} />
              <NoteDeepLinkMenu onPick={pickSuggestion} state={suggestion} />
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
          title={t("notes.confirmDiscard.title")}
          message={t("notes.confirmDiscard.message")}
          confirmLabel={t("notes.confirmDiscard.confirm")}
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

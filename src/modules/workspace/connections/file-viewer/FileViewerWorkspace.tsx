import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Lock, Menu, RefreshCw, X } from "../../../../lib/reicon";
import type { CSSProperties } from "react";
import type { WorkspaceTab } from "../../../../types";
import type { DashboardBackground } from "../../../dashboard/types";
import {
  confirmNativeDialog,
  invokeCommand,
  isTauriRuntime,
  openFilesystemPath,
  selectFileViewPath,
  type FileViewProbe,
} from "../../../../lib/tauri";
import { useWorkspaceStore } from "../../../../store";
import { menuButtonAria } from "../../../../lib/aria";
import {
  availableViewerKinds,
  detectViewerKind,
  fileBaseName,
  isEditableText,
  isUnsupportedViewerKind,
  viewerLoadsText,
  viewerUsesExternalDependency,
  type ViewerKind,
} from "./fileViewerModel";
import {
  AUTO_ENCODING,
  ENCODING_OPTIONS,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  loadDocumentSoftWrap,
  loadDocumentTextSettings,
  persistDocumentSoftWrap,
  persistDocumentTextSettings,
  type DocumentTextSettings,
} from "./fileViewerTextSettings";
import { FileGlyph } from "./chrome/FileGlyph";
import { fileTypeMeta } from "./chrome/fileViewerFileType";
import { ChromeSlotsProvider } from "./chrome/FileViewerChromeContext";
import { FootSeg, IconButton, Segmented } from "./chrome/controls";
import { TextCodeViewer } from "./viewers/TextCodeViewer";
import { MarkdownViewer } from "./viewers/MarkdownViewer";
import { CsvViewer } from "./viewers/CsvViewer";
import { JsonViewer } from "./viewers/JsonViewer";
import { ImageViewer } from "./viewers/ImageViewer";
import { LogViewer } from "./viewers/LogViewer";
import { HexViewer } from "./viewers/HexViewer";
import { LargeTextViewer } from "./viewers/LargeTextViewer";
import { PdfDependencyGate } from "./viewers/PdfDependencyGate";
import { FileViewerBackgroundPopover } from "./FileViewerBackgroundLayer";

/** Per-kind read caps (bytes). Text-shaped viewers and images differ widely. */
const TEXT_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const HEX_MAX_BYTES = 1 * 1024 * 1024;

/** Error-message prefix the backend uses for a save conflict (mtime changed). */
const FILE_VIEW_CONFLICT = "FILE_VIEW_CONFLICT";

const MARKDOWN_PATH = /\.(md|markdown|mdown|mkd|mdx)$/i;

function maxBytesForKind(kind: ViewerKind): number {
  if (kind === "image") {
    return IMAGE_MAX_BYTES;
  }
  if (kind === "hex") {
    return HEX_MAX_BYTES;
  }
  return TEXT_MAX_BYTES;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

interface LoadedContent {
  kind: ViewerKind;
  text?: string;
  base64?: string;
  magic?: string | null;
  truncated: boolean;
  mtimeMs?: number;
  /** `encoding_rs` label the text was decoded with (text-loaded kinds only). */
  encoding?: string;
}

export function FileViewerWorkspace({
  embeddedDialog = false,
  isActive,
  tab,
  onClose,
}: {
  embeddedDialog?: boolean;
  isActive: boolean;
  tab: WorkspaceTab;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const filePath = tab.connection?.localStartupDirectory?.trim() ?? "";
  const connectionId = tab.connection?.id;
  const documentStatusSlot = useWorkspaceStore((state) => state.documentStatusSlot);
  const markConnectionSessionStarted = useWorkspaceStore(
    (state) => state.markConnectionSessionStarted,
  );
  const markConnectionSessionEnded = useWorkspaceStore(
    (state) => state.markConnectionSessionEnded,
  );
  const updateOpenConnectionTerminalAppearance = useWorkspaceStore(
    (state) => state.updateOpenConnectionTerminalAppearance,
  );
  const showStatusBarProgress = useWorkspaceStore((state) => state.showStatusBarProgress);
  const updateStatusBarProgress = useWorkspaceStore((state) => state.updateStatusBarProgress);
  const clearStatusBarNotice = useWorkspaceStore((state) => state.clearStatusBarNotice);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const openCompareView = useWorkspaceStore((state) => state.openCompareView);
  const [probe, setProbe] = useState<FileViewProbe | null>(null);
  const [override, setOverride] = useState<ViewerKind | null>(null);
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  // Per-connection text presentation. Font + decode encoding are durable
  // browser preferences; soft wrap is session-scoped so the pressed state
  // survives tab churn without changing the saved Connection.
  const [textSettings, setTextSettings] = useState<DocumentTextSettings>(() =>
    loadDocumentTextSettings(connectionId),
  );
  const [softWrap, setSoftWrap] = useState(() => loadDocumentSoftWrap(connectionId));
  const { encoding } = textSettings;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [backgroundMenuOpen, setBackgroundMenuOpen] = useState(false);
  const backgroundMenuRef = useRef<HTMLDivElement | null>(null);
  const [backgroundPopoverOpen, setBackgroundPopoverOpen] = useState(false);

  // Editing state (Phase 3). `editedText` mirrors the uncontrolled editor's
  // current value so saves and the dirty indicator have it without re-rendering
  // the editor on each keystroke.
  const [editedText, setEditedText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Shell-owned slot elements the active viewer fills with portals (per-mode
  // toolbar controls + footer status). See FileViewerChromeContext.
  const [centerSlot, setCenterSlot] = useState<HTMLElement | null>(null);
  const [rightSlot, setRightSlot] = useState<HTMLElement | null>(null);
  const [subbarSlot, setSubbarSlot] = useState<HTMLElement | null>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);

  const load = useCallback(
    async (forcedKind: ViewerKind | null) => {
      if (!filePath) {
        setError(t("workspace.fileViewer.noFile"));
        return;
      }
      setLoading(true);
      setError("");
      setEditedText(null);
      const progressId = showStatusBarProgress(t("workspace.fileViewer.loading"), { progress: 5 });
      try {
        const probed = await invokeCommand("probe_file_view", {
          request: { path: filePath },
        });
        updateStatusBarProgress(progressId, 20);
        setProbe(probed);
        const kind =
          forcedKind ??
          detectViewerKind({ path: filePath, magic: probed.magic, isText: probed.isText });
        if (isUnsupportedViewerKind(kind)) {
          setContent({ kind, magic: probed.magic, truncated: false });
          updateStatusBarProgress(progressId, 100);
          return;
        }
        if (viewerUsesExternalDependency(kind)) {
          // The dependency-backed viewer (PDF) loads its own content through the
          // external tool; no direct read here.
          setContent({ kind, magic: probed.magic, truncated: false });
          updateStatusBarProgress(progressId, 100);
          return;
        }
        const maxBytes = maxBytesForKind(kind);
        if (viewerLoadsText(kind)) {
          updateStatusBarProgress(progressId, 35);
          const result = await invokeCommand("read_file_view_text", {
            request: {
              path: filePath,
              maxBytes,
              encoding: encoding === AUTO_ENCODING ? undefined : encoding,
            },
          });
          updateStatusBarProgress(progressId, 85);
          setContent({
            kind,
            text: result.text,
            magic: probed.magic,
            truncated: result.truncated,
            mtimeMs: result.mtimeMs,
            encoding: result.detectedEncoding,
          });
        } else {
          if (kind === "image" && probed.totalSize > IMAGE_MAX_BYTES) {
            setContent(null);
            setError(t("workspace.fileViewer.imageTooLarge"));
            updateStatusBarProgress(progressId, 100);
            return;
          }
          updateStatusBarProgress(progressId, 35);
          const result = await invokeCommand("read_file_view_bytes", {
            request: { path: filePath, offset: 0, length: maxBytes },
          });
          updateStatusBarProgress(progressId, 85);
          setContent({
            kind,
            base64: result.base64,
            magic: probed.magic,
            truncated: !result.eof,
          });
        }
        updateStatusBarProgress(progressId, 100);
      } catch (loadError) {
        setContent(null);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        updateStatusBarProgress(progressId, 100);
      } finally {
        window.setTimeout(() => clearStatusBarNotice(progressId), 700);
        setLoading(false);
      }
    },
    [filePath, t, encoding, showStatusBarProgress, updateStatusBarProgress, clearStatusBarNotice],
  );

  useEffect(() => {
    void load(override);
    // Reload when the file, the chosen viewer override, the decode encoding, or
    // an explicit reload changes. `load` is stable per filePath + encoding.
  }, [load, override, reloadToken]);

  // A Document has no network session, but it should still register as a live
  // connection (green dot in the rail / connection tree) the moment the file
  // opens, and release it when the tab closes — mirroring the File Explorer.
  useEffect(() => {
    if (!connectionId || embeddedDialog) {
      return;
    }
    markConnectionSessionStarted(connectionId);
    return () => markConnectionSessionEnded(connectionId);
  }, [connectionId, embeddedDialog, markConnectionSessionEnded, markConnectionSessionStarted]);

  const kinds = probe
    ? availableViewerKinds({ path: filePath, magic: probe.magic, isText: probe.isText })
    : [];
  const activeKind = content?.kind ?? override ?? (kinds[0] as ViewerKind | undefined);

  const baseline = content?.text ?? "";
  const dirty = editedText !== null && editedText !== baseline;
  const editable = content
    ? isEditableText({
        kind: content.kind,
        truncated: content.truncated,
        text: baseline,
        encoding: content.encoding,
      })
    : false;

  // Close the Font/Encoding menu on an outside pointer press.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  // Close the image/PDF view-options menu on an outside pointer press.
  useEffect(() => {
    if (!backgroundMenuOpen) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (backgroundMenuRef.current && target && !backgroundMenuRef.current.contains(target)) {
        setBackgroundMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [backgroundMenuOpen]);

  function updateSettings(patch: Partial<DocumentTextSettings>) {
    setTextSettings((current) => {
      const next = { ...current, ...patch };
      persistDocumentTextSettings(connectionId, next);
      return next;
    });
  }

  async function confirmDiscardIfDirty(): Promise<boolean> {
    if (!dirty) {
      return true;
    }
    return (await confirmNativeDialog(t("workspace.fileViewer.discardConfirm"))) === true;
  }

  // Changing the encoding reloads the file (via `load`'s deps), which discards
  // unsaved edits — confirm first when dirty.
  async function requestEncoding(value: string) {
    if (value === encoding) {
      return;
    }
    if (await confirmDiscardIfDirty()) {
      updateSettings({ encoding: value });
    }
  }

  async function requestMode(kind: ViewerKind) {
    if (kind === activeKind) {
      return;
    }
    if (await confirmDiscardIfDirty()) {
      setOverride(kind);
    }
  }

  async function requestReload() {
    if (await confirmDiscardIfDirty()) {
      setReloadToken((token) => token + 1);
    }
  }

  async function writeOnce(force: boolean): Promise<boolean> {
    const result = await invokeCommand("write_file_view", {
      request: {
        path: filePath,
        content: editedText ?? baseline,
        expectedMtimeMs: content?.mtimeMs,
        force,
      },
    });
    setContent((current) =>
      current
        ? { ...current, text: editedText ?? baseline, mtimeMs: result.mtimeMs, truncated: false }
        : current,
    );
    setEditedText(null);
    return true;
  }

  async function save() {
    if (!editable || !dirty || saving) {
      return;
    }
    setSaving(true);
    try {
      await writeOnce(false);
    } catch (firstError) {
      const message = firstError instanceof Error ? firstError.message : String(firstError);
      if (message.includes(FILE_VIEW_CONFLICT)) {
        const overwrite = await confirmNativeDialog(t("workspace.fileViewer.saveConflictConfirm"));
        if (overwrite === true) {
          try {
            await writeOnce(true);
          } catch (forcedError) {
            showStatusBarNotice(
              forcedError instanceof Error ? forcedError.message : String(forcedError),
              { tone: "error" },
            );
          }
        }
      } else {
        showStatusBarNotice(message, { tone: "error" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function compareWithFile() {
    const selectedPath = await selectFileViewPath({
      title: t("compare.title"),
      defaultPath: filePath,
    });
    if (!selectedPath || selectedPath === filePath) {
      return;
    }
    openCompareView(
      {
        localPath: filePath,
        label: fileBaseName(filePath),
        origin: filePath,
      },
      {
        localPath: selectedPath,
        label: fileBaseName(selectedPath),
        origin: selectedPath,
      },
    );
  }

  function saveBackground(nextBackground: DashboardBackground | null) {
    if (!connectionId || !tab.connection) {
      return;
    }
    const terminalOpacity = tab.connection.terminalOpacity ?? 50;
    updateOpenConnectionTerminalAppearance(connectionId, {
      terminalOpacity,
      terminalBackground: nextBackground,
    });
    if (!isTauriRuntime()) {
      return;
    }
    void invokeCommand("update_connection_terminal_appearance", {
      connectionId,
      terminalOpacity,
      terminalBackground: nextBackground,
    })
      .then((updated) => {
        if (updated) {
          updateOpenConnectionTerminalAppearance(connectionId, {
            terminalOpacity: updated.terminalOpacity ?? terminalOpacity,
            terminalBackground: updated.terminalBackground ?? null,
          });
        }
      })
      .catch((backgroundError) => {
        console.warn("file viewer background update failed.", backgroundError);
      });
  }

  const tint = fileTypeMeta(filePath).tint;
  const kindLabel = activeKind ? t(`workspace.fileViewer.kind.${activeKind}`) : "";

  // Font + Encoding menu and font variables only apply to text-loaded viewers.
  const showTextMenu = !!activeKind && viewerLoadsText(activeKind);
  const showBackgroundMenu = activeKind === "image" || activeKind === "pdf";
  const viewerBackground = tab.connection?.terminalBackground ?? null;
  const encodingLabel =
    encoding === AUTO_ENCODING
      ? content?.encoding
        ? t("workspace.fileViewer.encodingDetected", { label: content.encoding.toUpperCase() })
        : t("workspace.fileViewer.encodingAuto")
      : (ENCODING_OPTIONS.find((option) => option.value === encoding)?.label ??
        encoding.toUpperCase());
  const fontVarStyle: CSSProperties = {};
  if (textSettings.fontFamily) {
    (fontVarStyle as Record<string, string>)["--fv-font-family"] = textSettings.fontFamily;
  }
  if (textSettings.fontSize > 0) {
    (fontVarStyle as Record<string, string>)["--fv-font-size"] = `${textSettings.fontSize}px`;
  }

  return (
    <div
      className={isActive ? "file-viewer-workspace active" : "file-viewer-workspace"}
      style={fontVarStyle}
    >
      <div className="fv-toolbar">
        {!embeddedDialog ? (
          <div className="fv-file">
            <span className="glyph">
              <FileGlyph path={filePath} size={26} />
            </span>
            <span className="name" title={filePath}>
              {fileBaseName(filePath) || t("connections.fileView")}
            </span>
            {dirty ? (
              <span className="fv-dirty" title={t("workspace.fileViewer.unsaved")} aria-hidden="true" />
            ) : null}
          </div>
        ) : dirty ? (
          <span className="fv-dirty" title={t("workspace.fileViewer.unsaved")} aria-hidden="true" />
        ) : null}
        {kindLabel ? (
          <span className="fv-pill">
            <span className="swatch" style={{ background: tint }} />
            {kindLabel}
          </span>
        ) : null}
        <div className="fv-tb-center" ref={setCenterSlot} />
        <div className="fv-tb-spacer" />
        <div className="fv-tb-right" ref={setRightSlot} />
        {kinds.length > 1 ? (
          <Segmented
            value={activeKind as ViewerKind}
            options={kinds.map((kind) => ({
              value: kind,
              label: t(`workspace.fileViewer.kind.${kind}`),
            }))}
            onChange={(kind) => void requestMode(kind)}
          />
        ) : null}
        <IconButton icon={RefreshCw} title={t("common.refresh")} onClick={() => void requestReload()} />
        {showBackgroundMenu ? (
          <div className="fv-menu-wrapper" ref={backgroundMenuRef}>
            <button
              type="button"
              className={backgroundMenuOpen ? "fv-ibtn on" : "fv-ibtn"}
              title={t("workspace.fileViewer.viewOptions")}
              aria-label={t("workspace.fileViewer.viewOptions")}
              {...menuButtonAria(backgroundMenuOpen)}
              onClick={() => setBackgroundMenuOpen((open) => !open)}
            >
              <Menu size={17} />
            </button>
            {backgroundMenuOpen ? (
              <div className="fv-menu fv-view-menu" role="menu">
                <button
                  className="fv-menu-item"
                  onClick={() => {
                    setBackgroundMenuOpen(false);
                    setBackgroundPopoverOpen(true);
                  }}
                  role="menuitem"
                  type="button"
                >
                  {t("workspace.fileViewer.background")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {showTextMenu ? (
          <div className="fv-menu-wrapper" ref={menuRef}>
            <button
              type="button"
              className={menuOpen ? "fv-ibtn on" : "fv-ibtn"}
              title={t("workspace.fileViewer.textMenu")}
              aria-label={t("workspace.fileViewer.textMenu")}
              {...menuButtonAria(menuOpen)}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Menu size={17} />
            </button>
            {menuOpen ? (
              <div className="fv-menu" role="menu">
                <label className="fv-menu-row">
                  <span className="fv-menu-label">{t("workspace.fileViewer.font")}</span>
                  <select
                    className="fv-menu-select"
                    value={textSettings.fontFamily}
                    onChange={(event) => updateSettings({ fontFamily: event.currentTarget.value })}
                  >
                    {FONT_FAMILY_OPTIONS.map((option) => (
                      <option key={option.value || "default"} value={option.value}>
                        {option.value === ""
                          ? t("workspace.fileViewer.fontDefault")
                          : option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fv-menu-row">
                  <span className="fv-menu-label">{t("workspace.fileViewer.fontSize")}</span>
                  <select
                    className="fv-menu-select"
                    value={textSettings.fontSize}
                    onChange={(event) =>
                      updateSettings({ fontSize: Number(event.currentTarget.value) })
                    }
                  >
                    {FONT_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size === 0 ? t("workspace.fileViewer.fontSizeDefault") : `${size} px`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fv-menu-row">
                  <span className="fv-menu-label">{t("workspace.fileViewer.encoding")}</span>
                  <select
                    className="fv-menu-select"
                    value={encoding}
                    onChange={(event) => void requestEncoding(event.currentTarget.value)}
                  >
                    <option value={AUTO_ENCODING}>
                      {content?.encoding
                        ? t("workspace.fileViewer.encodingDetected", {
                            label: content.encoding.toUpperCase(),
                          })
                        : t("workspace.fileViewer.encodingAuto")}
                    </option>
                    {ENCODING_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
        {onClose ? <IconButton icon={X} title={t("common.close")} onClick={onClose} /> : null}
      </div>
      {backgroundPopoverOpen ? (
        <FileViewerBackgroundPopover
          background={viewerBackground}
          onBackgroundChange={saveBackground}
          onClose={() => setBackgroundPopoverOpen(false)}
        />
      ) : null}

      {content?.truncated && content.kind !== "text" ? (
        <div className="file-viewer-notice">{t("workspace.fileViewer.truncated")}</div>
      ) : null}
      <div className="fv-subbar-slot" ref={setSubbarSlot} />

      <div className="fv-body">
        <ChromeSlotsProvider
          value={{
            center: centerSlot,
            right: rightSlot,
            subbar: subbarSlot,
            footer: footerSlot,
          }}
        >
          {loading ? (
            <div className="file-viewer-status">{t("workspace.fileViewer.loading")}</div>
          ) : error ? (
            <div className="file-viewer-status file-viewer-status-error">{error}</div>
          ) : content ? (
            <FileViewerContent
              content={content}
              editable={editable}
              editorKey={`${filePath}:${reloadToken}:${activeKind}`}
              filePath={filePath}
              background={viewerBackground}
              isActive={isActive}
              softWrap={softWrap}
              dirty={dirty}
              saving={saving}
              onEditChange={setEditedText}
              onCompare={() => void compareWithFile()}
              onChooseKind={(kind) => void requestMode(kind)}
              onSave={() => void save()}
              onSoftWrapChange={(next) => {
                setSoftWrap(next);
                persistDocumentSoftWrap(connectionId, next);
              }}
            />
          ) : null}
        </ChromeSlotsProvider>
      </div>

      {/* The Document's status is shown in the app's global Status Bar (the single
          status surface), not a per-Document footer. Only the active tab portals
          into the shared slot; the per-mode footer segments keep filling
          `footerSlot` via the chrome portals, now nested inside the global bar. */}
      {isActive && content && !loading && !error && documentStatusSlot
        ? createPortal(
            <div className="status-bar-document-status">
              {kindLabel ? <FootSeg>{kindLabel}</FootSeg> : null}
              {probe ? <FootSeg>{formatBytes(probe.totalSize)}</FootSeg> : null}
              {showTextMenu && encodingLabel ? <FootSeg>{encodingLabel}</FootSeg> : null}
              <span className="fv-footer-slot" ref={setFooterSlot} />
              {editable ? (
                dirty ? (
                  <span className="badge warn">
                    <span className="fv-dot" />
                    {t("workspace.fileViewer.unsaved")}
                  </span>
                ) : (
                  <span className="badge">
                    <Check size={12} />
                    {t("workspace.fileViewer.saved")}
                  </span>
                )
              ) : (
                <span className="badge ro">
                  <Lock size={12} />
                  {t("workspace.fileViewer.readOnly")}
                </span>
              )}
            </div>,
            documentStatusSlot,
          )
        : null}
    </div>
  );
}

function FileViewerContent({
  content,
  editable,
  editorKey,
  filePath,
  background,
  isActive,
  softWrap,
  dirty,
  saving,
  onEditChange,
  onCompare,
  onChooseKind,
  onSave,
  onSoftWrapChange,
}: {
  content: LoadedContent;
  editable: boolean;
  editorKey: string;
  filePath: string;
  background: DashboardBackground | null;
  isActive: boolean;
  softWrap: boolean;
  dirty: boolean;
  saving: boolean;
  onEditChange: (text: string) => void;
  onCompare: () => void;
  onChooseKind: (kind: ViewerKind) => void;
  onSave: () => void;
  onSoftWrapChange: (softWrap: boolean) => void;
}) {
  switch (content.kind) {
    case "markdown":
      return <MarkdownViewer text={content.text ?? ""} />;
    case "csv":
      return (
        <CsvViewer
          delimiter={filePath.toLowerCase().endsWith(".tsv") ? "\t" : undefined}
          text={content.text ?? ""}
        />
      );
    case "json":
      return <JsonViewer text={content.text ?? ""} />;
    case "image":
      return (
        <ImageViewer
          active={isActive}
          background={background}
          base64={content.base64 ?? ""}
          magic={content.magic}
          path={filePath}
        />
      );
    case "pdf":
      return (
        <PdfDependencyGate
          background={background}
          filePath={filePath}
          isActive={isActive}
        />
      );
    case "log":
      return (
        <LogViewer
          encoding={content.encoding}
          filePath={filePath}
          isActive={isActive}
          maxBytes={TEXT_MAX_BYTES}
          text={content.text ?? ""}
        />
      );
    case "hex":
      return <HexViewer base64={content.base64 ?? ""} />;
    case "unsupported":
      return (
        <UnsupportedFileChoice
          filePath={filePath}
          onOpenExternal={() => void openFilesystemPath(filePath)}
          onOpenHex={() => onChooseKind("hex")}
          onOpenText={() => onChooseKind("text")}
        />
      );
    case "text":
    default:
      if (content.truncated) {
        return (
          <LargeTextViewer
            encoding={content.encoding}
            filePath={filePath}
            text={content.text ?? ""}
          />
        );
      }
      return (
        <TextCodeViewer
          editable={editable}
          filePath={filePath}
          initialText={content.text ?? ""}
          key={editorKey}
          language={MARKDOWN_PATH.test(filePath) ? "markdown" : undefined}
          softWrap={softWrap}
          dirty={dirty}
          saving={saving}
          onChange={onEditChange}
          onCompare={onCompare}
          onSave={onSave}
          onSoftWrapChange={onSoftWrapChange}
        />
      );
  }
}

function UnsupportedFileChoice({
  filePath,
  onOpenExternal,
  onOpenHex,
  onOpenText,
}: {
  filePath: string;
  onOpenExternal: () => void;
  onOpenHex: () => void;
  onOpenText: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fv-unsupported">
      <div className="fv-unsupported-card">
        <FileGlyph path={filePath} size={44} />
        <h3>{t("workspace.fileViewer.unsupportedTitle")}</h3>
        <p>{t("workspace.fileViewer.unsupportedBody", { name: fileBaseName(filePath) })}</p>
        <div className="fv-unsupported-actions">
          <button className="toolbar-button" onClick={onOpenText} type="button">
            {t("workspace.fileViewer.openAsText")}
          </button>
          <button className="toolbar-button" onClick={onOpenHex} type="button">
            {t("workspace.fileViewer.openAsBinary")}
          </button>
          <button className="approve-button" onClick={onOpenExternal} type="button">
            {t("workspace.fileViewer.openExternalEditor")}
          </button>
        </div>
      </div>
    </div>
  );
}

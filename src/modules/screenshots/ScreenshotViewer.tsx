import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "../../lib/reicon";
import { Btn, DialogShell } from "../../app/ui/dialog";
import { invokeCommand, type FullScreenshot, type StoredScreenshot } from "../../lib/tauri";
import { formatScreenshotBytes } from "./LibraryView";

export function ScreenshotViewer({
  screenshot,
  hasPrevious,
  hasNext,
  onNavigate,
  onCopy,
  onOpenExternal,
  onReveal,
  onDelete,
  onClose,
}: {
  screenshot: StoredScreenshot;
  hasPrevious: boolean;
  hasNext: boolean;
  onNavigate: (direction: -1 | 1) => void;
  onCopy: () => void;
  onOpenExternal: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [full, setFull] = useState<FullScreenshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    setFull(null);
    setLoadError(null);
    invokeCommand("read_screenshot", { id: screenshot.id })
      .then((loaded) => {
        if (!disposed) {
          setFull(loaded);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      disposed = true;
    };
  }, [screenshot.id]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [screenshot.id]);

  return (
    <DialogShell onBackdrop={onClose}>
      <div
        ref={dialogRef}
        className="screenshots-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={screenshot.fileName}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowLeft" && hasPrevious) {
            event.preventDefault();
            onNavigate(-1);
          } else if (event.key === "ArrowRight" && hasNext) {
            event.preventDefault();
            onNavigate(1);
          }
        }}
      >
        <header className="screenshots-viewer__head">
          <span className="screenshots-viewer__name">{screenshot.fileName}</span>
          <span className="screenshots-viewer__dims">
            {screenshot.width}×{screenshot.height} ·{" "}
            {formatScreenshotBytes(screenshot.fileSizeBytes)}
          </span>
        </header>
        <div className="screenshots-viewer__stage">
          <button
            type="button"
            className="screenshots-viewer__nav"
            aria-label={t("common.back")}
            disabled={!hasPrevious}
            onClick={() => onNavigate(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          {full ? (
            <img alt={screenshot.fileName} src={full.dataUrl} />
          ) : loadError ? (
            <p className="screenshots-viewer__error">{loadError}</p>
          ) : (
            <img
              alt={screenshot.fileName}
              className="screenshots-viewer__placeholder"
              src={screenshot.thumbnailDataUrl}
            />
          )}
          <button
            type="button"
            className="screenshots-viewer__nav"
            aria-label={t("common.forward")}
            disabled={!hasNext}
            onClick={() => onNavigate(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <footer className="screenshots-viewer__foot">
          <Btn sm icon="copy" onClick={onCopy}>
            {t("screenshots.menu.copy")}
          </Btn>
          <Btn sm onClick={onOpenExternal}>
            {t("screenshots.menu.openExternal")}
          </Btn>
          <Btn sm onClick={onReveal}>
            {t("screenshots.menu.reveal")}
          </Btn>
          <Btn sm kind="danger" icon="trash" onClick={onDelete}>
            {t("common.delete")}
          </Btn>
          <span className="kk-spacer" />
          <Btn onClick={onClose}>{t("common.close")}</Btn>
        </footer>
      </div>
    </DialogShell>
  );
}

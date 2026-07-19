import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { StoredScreenshot } from "../../lib/tauri";

export type ScreenshotsViewMode = "thumbnails" | "list" | "details";

export function formatScreenshotBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function screenshotKindKey(kind: StoredScreenshot["kind"]) {
  return `screenshots.kind.${kind}`;
}

function formatCapturedAt(capturedAt: number) {
  const date = new Date(capturedAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export function LibraryView({
  screenshots,
  viewMode,
  onOpen,
  onItemMenu,
}: {
  screenshots: StoredScreenshot[];
  viewMode: ScreenshotsViewMode;
  onOpen: (screenshot: StoredScreenshot) => void;
  onItemMenu: (screenshot: StoredScreenshot, x: number, y: number) => void;
}) {
  const { t } = useTranslation();

  function handleContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    screenshot: StoredScreenshot,
  ) {
    event.preventDefault();
    onItemMenu(screenshot, event.clientX, event.clientY);
  }

  if (viewMode === "details") {
    return (
      <table className="screenshots-details" data-tutorial-id="screenshots.library">
        <thead>
          <tr>
            <th className="screenshots-details__thumb-col" aria-hidden="true" />
            <th>{t("screenshots.details.name")}</th>
            <th>{t("screenshots.details.kind")}</th>
            <th>{t("screenshots.details.dimensions")}</th>
            <th>{t("screenshots.details.size")}</th>
            <th>{t("screenshots.details.date")}</th>
          </tr>
        </thead>
        <tbody>
          {screenshots.map((screenshot) => (
            <tr
              key={screenshot.id}
              onClick={() => onOpen(screenshot)}
              onContextMenu={(event) => handleContextMenu(event, screenshot)}
            >
              <td className="screenshots-details__thumb-col">
                <img alt="" src={screenshot.thumbnailDataUrl} loading="lazy" />
              </td>
              <td className="screenshots-details__name">{screenshot.fileName}</td>
              <td>{t(screenshotKindKey(screenshot.kind))}</td>
              <td className="screenshots-details__mono">
                {screenshot.width}×{screenshot.height}
              </td>
              <td className="screenshots-details__mono">
                {formatScreenshotBytes(screenshot.fileSizeBytes)}
              </td>
              <td>{formatCapturedAt(screenshot.capturedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (viewMode === "list") {
    return (
      <ul className="screenshots-list" data-tutorial-id="screenshots.library">
        {screenshots.map((screenshot) => (
          <li key={screenshot.id}>
            <button
              type="button"
              className="screenshots-list__row"
              onClick={() => onOpen(screenshot)}
              onContextMenu={(event) => handleContextMenu(event, screenshot)}
            >
              <img alt="" src={screenshot.thumbnailDataUrl} loading="lazy" />
              <span className="screenshots-list__name">{screenshot.fileName}</span>
              <span className="screenshots-list__meta">
                {t(screenshotKindKey(screenshot.kind))}
              </span>
              <span className="screenshots-list__meta">
                {formatCapturedAt(screenshot.capturedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="screenshots-grid" data-tutorial-id="screenshots.library">
      {screenshots.map((screenshot) => (
        <button
          key={screenshot.id}
          type="button"
          className="screenshots-card"
          onClick={() => onOpen(screenshot)}
          onContextMenu={(event) => handleContextMenu(event, screenshot)}
        >
          <span className="screenshots-card__frame">
            <img alt={screenshot.fileName} src={screenshot.thumbnailDataUrl} loading="lazy" />
          </span>
          <span className="screenshots-card__name">{screenshot.fileName}</span>
          <span className="screenshots-card__meta">
            {formatCapturedAt(screenshot.capturedAt)}
          </span>
        </button>
      ))}
    </div>
  );
}

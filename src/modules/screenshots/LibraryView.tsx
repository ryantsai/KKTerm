import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Check } from "../../lib/reicon";
import type { StoredScreenshot } from "../../lib/tauri";
import {
  groupScreenshots,
  screenshotFileType,
  type ScreenshotGroupBy,
} from "./libraryModel";

export type ScreenshotsViewMode = "thumbnails" | "details";

export type ScreenshotSelectionModifiers = {
  additive: boolean;
  range: boolean;
};

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

function formatCapturedAt(capturedAt: number) {
  const date = new Date(capturedAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function modifiers(event: ReactMouseEvent | ReactKeyboardEvent): ScreenshotSelectionModifiers {
  return {
    additive: event.ctrlKey || event.metaKey,
    range: event.shiftKey,
  };
}

export function LibraryView({
  screenshots,
  viewMode,
  groupBy,
  selectedIds,
  onSelect,
  onOpen,
  onItemMenu,
}: {
  screenshots: StoredScreenshot[];
  viewMode: ScreenshotsViewMode;
  groupBy: ScreenshotGroupBy;
  selectedIds: ReadonlySet<string>;
  onSelect: (
    screenshot: StoredScreenshot,
    index: number,
    modifiers: ScreenshotSelectionModifiers,
  ) => void;
  onOpen: (screenshot: StoredScreenshot) => void;
  onItemMenu: (screenshot: StoredScreenshot, x: number, y: number) => void;
}) {
  const { t } = useTranslation();
  const groups = groupScreenshots(screenshots, groupBy);
  const indexes = new Map(screenshots.map((screenshot, index) => [screenshot.id, index]));

  function handleContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    screenshot: StoredScreenshot,
  ) {
    event.preventDefault();
    onItemMenu(screenshot, event.clientX, event.clientY);
  }

  function handleKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    screenshot: StoredScreenshot,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(screenshot);
    } else if (event.key === " ") {
      event.preventDefault();
      onSelect(screenshot, indexes.get(screenshot.id) ?? 0, modifiers(event));
    }
  }

  if (viewMode === "details") {
    return (
      <table className="screenshots-details" data-tutorial-id="screenshots.library">
        <thead>
          <tr>
            <th className="screenshots-details__thumb-col" aria-hidden="true" />
            <th>{t("screenshots.details.name")}</th>
            <th>{t("screenshots.details.type")}</th>
            <th>{t("screenshots.details.dimensions")}</th>
            <th>{t("screenshots.details.size")}</th>
            <th>{t("screenshots.details.date")}</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            {groupBy !== "none" ? (
              <tr className="screenshots-group-row">
                <th colSpan={6}>
                  {group.label}
                  <span>{group.screenshots.length}</span>
                </th>
              </tr>
            ) : null}
            {group.screenshots.map((screenshot) => {
              const selected = selectedIds.has(screenshot.id);
              const index = indexes.get(screenshot.id) ?? 0;
              return (
                <tr
                  key={screenshot.id}
                  className={selected ? "selected" : ""}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={(event) => onSelect(screenshot, index, modifiers(event))}
                  onDoubleClick={() => onOpen(screenshot)}
                  onKeyDown={(event) => handleKeyDown(event, screenshot)}
                  onContextMenu={(event) => handleContextMenu(event, screenshot)}
                >
                  <td className="screenshots-details__thumb-col">
                    <span className="screenshots-detail-thumb">
                      <img alt="" src={screenshot.thumbnailDataUrl} loading="lazy" />
                      {selected ? <Check size={12} aria-hidden="true" /> : null}
                    </span>
                  </td>
                  <td className="screenshots-details__name">
                    <span>{screenshot.fileName}</span>
                    {screenshot.hasDraft ? (
                      <span className="screenshots-draft-badge">{t("screenshots.draft")}</span>
                    ) : null}
                  </td>
                  <td>{screenshotFileType(screenshot)}</td>
                  <td className="screenshots-details__mono">
                    {screenshot.width}×{screenshot.height}
                  </td>
                  <td className="screenshots-details__mono">
                    {formatScreenshotBytes(screenshot.fileSizeBytes)}
                  </td>
                  <td>{formatCapturedAt(screenshot.capturedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    );
  }

  return (
    <div className="screenshots-groups" data-tutorial-id="screenshots.library">
      {groups.map((group) => (
        <section className="screenshots-group" key={group.key}>
          {groupBy !== "none" ? (
            <h2 className="screenshots-group__heading">
              <span>{group.label}</span>
              <span>{group.screenshots.length}</span>
            </h2>
          ) : null}
          <div className="screenshots-grid">
            {group.screenshots.map((screenshot) => {
              const selected = selectedIds.has(screenshot.id);
              const index = indexes.get(screenshot.id) ?? 0;
              return (
                <button
                  key={screenshot.id}
                  type="button"
                  className={`screenshots-card${selected ? " selected" : ""}`}
                  aria-pressed={selected}
                  onClick={(event) => onSelect(screenshot, index, modifiers(event))}
                  onDoubleClick={() => onOpen(screenshot)}
                  onContextMenu={(event) => handleContextMenu(event, screenshot)}
                >
                  <span className="screenshots-card__frame">
                    <img
                      alt={screenshot.fileName}
                      src={screenshot.thumbnailDataUrl}
                      loading="lazy"
                    />
                    <span className="screenshots-card__check" aria-hidden="true">
                      <Check size={13} />
                    </span>
                    {screenshot.hasDraft ? (
                      <span className="screenshots-draft-badge">{t("screenshots.draft")}</span>
                    ) : null}
                  </span>
                  <span className="screenshots-card__name">{screenshot.fileName}</span>
                  <span className="screenshots-card__meta">
                    {formatCapturedAt(screenshot.capturedAt)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

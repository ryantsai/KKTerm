import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Hash, X } from "../../../../../lib/reicon";
import { invokeCommand, type FileViewTextIndex } from "../../../../../lib/tauri";
import { useWorkspaceStore } from "../../../../../store";
import { ChromePortals } from "../chrome/FileViewerChromeContext";
import { FootSeg, IconButton } from "../chrome/controls";
import {
  LARGE_TEXT_LINE_HEIGHT,
  largeTextVirtualWindow,
  splitLargeTextPage,
} from "../largeTextViewerModel";

const PAGE_CACHE_LIMIT = 12;

interface LoadedPage {
  lines: string[];
}

/**
 * Complete read-only large-text viewer. A sparse backend line index maps the
 * virtual scrollbar to exact file byte ranges; only nearby pages and visible
 * DOM rows are retained, so a 100 MB+ file never crosses the bridge whole.
 */
export function LargeTextViewer({
  encoding,
  filePath,
  text,
}: {
  encoding?: string;
  filePath: string;
  text: string;
}) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef(0);
  const centerPageRef = useRef(0);
  const loadingPagesRef = useRef(new Set<number>());
  const pagesRef = useRef(new Map<number, LoadedPage>());
  const failedPagesRef = useRef(new Set<number>());
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const [index, setIndex] = useState<FileViewTextIndex | null>(null);
  const [pages, setPages] = useState<Map<number, LoadedPage>>(() => new Map());
  const [goToOpen, setGoToOpen] = useState(false);
  const [goToValue, setGoToValue] = useState("");

  const previewLines = useMemo(() => text.split(/\r\n|\n|\r/), [text]);
  // A truncated prefix may end halfway through its final line. Keep only lines
  // terminated within the prefix as authoritative preview data.
  const previewCompleteLineCount = Math.max(0, previewLines.length - 1);
  const totalLines = index?.totalLines ?? previewLines.length;
  const virtualWindow = largeTextVirtualWindow({
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    totalLines,
  });

  const updateViewport = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) {
      return;
    }
    setViewport({ scrollTop: node.scrollTop, height: node.clientHeight });
  }, []);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) {
      return;
    }
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(node);
    return () => observer.disconnect();
  }, [updateViewport]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    loadingPagesRef.current.clear();
    failedPagesRef.current.clear();
    pagesRef.current = new Map();
    setPages(new Map());
    setIndex(null);

    void invokeCommand("index_file_view_text", {
      request: { path: filePath, encoding },
    })
      .then((result) => {
        if (generationRef.current === generation) {
          setIndex(result);
          window.requestAnimationFrame(updateViewport);
        }
      })
      .catch(() => {
        if (generationRef.current === generation) {
          showStatusBarNotice(t("workspace.fileViewer.largeTextLoadFailed"), {
            tone: "error",
          });
        }
      });

    return () => {
      if (generationRef.current === generation) {
        generationRef.current += 1;
      }
    };
  }, [encoding, filePath, showStatusBarNotice, t, updateViewport]);

  const loadPage = useCallback(
    async (pageIndex: number) => {
      if (
        !index ||
        pagesRef.current.has(pageIndex) ||
        loadingPagesRef.current.has(pageIndex)
      ) {
        return;
      }
      const startOffset = index.checkpointOffsets[pageIndex];
      if (startOffset === undefined) {
        return;
      }
      const endOffset = index.checkpointOffsets[pageIndex + 1] ?? index.totalSize;
      const startLine = pageIndex * index.lineStride;
      const expectedLineCount = Math.min(index.lineStride, index.totalLines - startLine);
      const generation = generationRef.current;
      loadingPagesRef.current.add(pageIndex);
      try {
        const result = await invokeCommand("read_file_view_text_page", {
          request: { path: filePath, startOffset, endOffset, encoding },
        });
        if (generationRef.current !== generation) {
          return;
        }
        const next = new Map(pagesRef.current);
        next.set(pageIndex, {
          lines: splitLargeTextPage(result.text, expectedLineCount),
        });
        if (next.size > PAGE_CACHE_LIMIT) {
          const candidates = [...next.keys()].sort(
            (left, right) =>
              Math.abs(right - centerPageRef.current) -
              Math.abs(left - centerPageRef.current),
          );
          while (next.size > PAGE_CACHE_LIMIT) {
            const candidate = candidates.shift();
            if (candidate === undefined) {
              break;
            }
            next.delete(candidate);
          }
        }
        pagesRef.current = next;
        setPages(next);
      } catch {
        if (
          generationRef.current === generation &&
          !failedPagesRef.current.has(pageIndex)
        ) {
          failedPagesRef.current.add(pageIndex);
          showStatusBarNotice(t("workspace.fileViewer.largeTextLoadFailed"), {
            tone: "error",
          });
        }
      } finally {
        loadingPagesRef.current.delete(pageIndex);
      }
    },
    [encoding, filePath, index, showStatusBarNotice, t],
  );

  useEffect(() => {
    if (!index || virtualWindow.end <= virtualWindow.start) {
      return;
    }
    const firstPage = Math.floor(virtualWindow.start / index.lineStride);
    const lastPage = Math.floor((virtualWindow.end - 1) / index.lineStride);
    const centerPage = Math.floor((firstPage + lastPage) / 2);
    centerPageRef.current = centerPage;
    for (let pageIndex = firstPage; pageIndex <= lastPage; pageIndex += 1) {
      const pageEndLine = Math.min(
        index.totalLines,
        (pageIndex + 1) * index.lineStride,
      );
      if (pageEndLine <= previewCompleteLineCount) {
        continue;
      }
      void loadPage(pageIndex);
    }
  }, [index, loadPage, previewCompleteLineCount, virtualWindow.end, virtualWindow.start]);

  const visibleLineNumbers = useMemo(
    () =>
      Array.from(
        { length: Math.max(0, virtualWindow.end - virtualWindow.start) },
        (_, index) => virtualWindow.start + index,
      ),
    [virtualWindow.end, virtualWindow.start],
  );

  const goToLine = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !index) {
      return;
    }
    const requestedLine = Number.parseInt(goToValue, 10);
    if (!Number.isFinite(requestedLine)) {
      return;
    }
    const line = Math.max(1, Math.min(index.totalLines, requestedLine));
    scroller.scrollTop = (line - 1) * LARGE_TEXT_LINE_HEIGHT;
    updateViewport();
  }, [goToValue, index, updateViewport]);

  return (
    <div className="fv-large-text-pane">
      <ChromePortals
        center={
          <IconButton
            icon={Hash}
            title={t("workspace.fileViewer.goToLine")}
            disabled={!index}
            on={goToOpen}
            pressed={goToOpen}
            onClick={() => setGoToOpen((open) => !open)}
          />
        }
        subbar={
          goToOpen ? (
            <form
              className="fv-findbar fv-goto-bar"
              onSubmit={(event) => {
                event.preventDefault();
                goToLine();
              }}
            >
              <Hash size={14} />
              <label htmlFor="fv-large-text-line-input">
                {t("workspace.fileViewer.goToLine")}
              </label>
              <input
                id="fv-large-text-line-input"
                className="fv-find-input"
                inputMode="numeric"
                min={1}
                max={index?.totalLines}
                type="number"
                value={goToValue}
                placeholder={t("workspace.fileViewer.lineNumberPlaceholder")}
                onChange={(event) => setGoToValue(event.currentTarget.value)}
              />
              <button className="fv-find-action" type="submit" disabled={!index}>
                {t("workspace.fileViewer.go")}
              </button>
              <div className="fv-tb-spacer" />
              <IconButton
                icon={X}
                title={t("common.close")}
                onClick={() => setGoToOpen(false)}
              />
            </form>
          ) : null
        }
        footer={
          <>
            <FootSeg>
              {t("workspace.fileViewer.lineCountOf", {
                count: Math.min(totalLines, virtualWindow.start + 1),
                total: totalLines,
              })}
            </FootSeg>
            <FootSeg>
              {index
                ? t("workspace.fileViewer.largeFileIndexed")
                : t("workspace.fileViewer.indexingLargeFile")}
            </FootSeg>
          </>
        }
      />
      <div
        className="fv-large-text-scroll"
        ref={(node) => {
          scrollerRef.current = node;
          if (node) {
            window.requestAnimationFrame(updateViewport);
          }
        }}
        onScroll={updateViewport}
      >
        <div
          className="fv-large-text-spacer"
          style={{ height: virtualWindow.totalHeight }}
        >
          <div
            className="fv-large-text-window"
            style={{ transform: `translateY(${virtualWindow.top}px)` }}
          >
            {visibleLineNumbers.map((zeroBasedLine) => {
              const pageIndex = index
                ? Math.floor(zeroBasedLine / index.lineStride)
                : 0;
              const page = pages.get(pageIndex);
              const line =
                zeroBasedLine < previewCompleteLineCount
                  ? previewLines[zeroBasedLine]
                  : page?.lines[zeroBasedLine - pageIndex * (index?.lineStride ?? 1)];
              const lineNumber = zeroBasedLine + 1;
              return (
                <div
                  className={`fv-large-text-line${line === undefined ? " loading" : ""}`}
                  key={lineNumber}
                  style={{ height: LARGE_TEXT_LINE_HEIGHT }}
                >
                  <span className="fv-large-text-ln">{lineNumber}</span>
                  <span className="fv-large-text-code">
                    {line === undefined ? "…" : line || "\u00a0"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

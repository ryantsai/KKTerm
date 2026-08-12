import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Hash, Search, X } from "../../../../../lib/reicon";
import {
  invokeCommand,
  type FileViewTextIndex,
  type FileViewTextSearchMatch,
} from "../../../../../lib/tauri";
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
  isActive,
  text,
}: {
  encoding?: string;
  filePath: string;
  isActive: boolean;
  text: string;
}) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchGenerationRef = useRef(0);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchMatch, setSearchMatch] = useState<FileViewTextSearchMatch | null>(null);
  const [searchedSignature, setSearchedSignature] = useState<string | null>(null);

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
    searchGenerationRef.current += 1;
    pagesRef.current = new Map();
    setPages(new Map());
    setIndex(null);
    setSearchMatch(null);
    setSearchedSignature(null);
    setSearching(false);

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

  const openSearch = useCallback(() => {
    setGoToOpen(false);
    setSearchOpen(true);
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "f") {
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const root = rootRef.current;
      const owner = root?.closest(".file-viewer-workspace");
      const focusedOwner = document.activeElement?.closest(".file-viewer-workspace");
      if (!root || !owner || (focusedOwner && focusedOwner !== owner)) {
        return;
      }
      const editableTarget = target?.closest("input, textarea, [contenteditable='true']");
      if (editableTarget && !owner.contains(editableTarget)) {
        return;
      }
      if (!focusedOwner) {
        const activeLargeViewers = document.querySelectorAll(
          ".file-viewer-workspace.active .fv-large-text-pane",
        );
        if (activeLargeViewers.length !== 1 || activeLargeViewers[0] !== root) {
          return;
        }
      }

      event.preventDefault();
      event.stopPropagation();
      openSearch();
    };
    document.addEventListener("keydown", handleFindShortcut, true);
    return () => document.removeEventListener("keydown", handleFindShortcut, true);
  }, [isActive, openSearch]);

  const runSearch = useCallback(
    async (backwards: boolean) => {
      if (!index || !searchValue || searching) {
        return;
      }
      const signature = `${matchCase ? "case" : "fold"}\u0000${searchValue}`;
      const continuing = searchedSignature === signature && searchMatch !== null;
      const cursorLine = continuing ? searchMatch.line : virtualWindow.start;
      const cursorColumn = continuing
        ? backwards
          ? searchMatch.startColumn
          : searchMatch.endColumn
        : backwards
          ? Number.MAX_SAFE_INTEGER
          : 0;
      const generation = searchGenerationRef.current + 1;
      searchGenerationRef.current = generation;
      setSearching(true);
      try {
        const result = await invokeCommand("search_file_view_text", {
          request: {
            path: filePath,
            query: searchValue,
            checkpointOffsets: index.checkpointOffsets,
            totalSize: index.totalSize,
            totalLines: index.totalLines,
            lineStride: index.lineStride,
            expectedMtimeMs: index.mtimeMs,
            cursorLine,
            cursorColumn,
            backwards,
            matchCase,
            encoding,
          },
        });
        if (searchGenerationRef.current !== generation) {
          return;
        }
        setSearchMatch(result);
        setSearchedSignature(signature);
        if (result) {
          const scroller = scrollerRef.current;
          if (scroller) {
            scroller.scrollTop = result.line * LARGE_TEXT_LINE_HEIGHT;
            updateViewport();
          }
        }
      } catch {
        if (searchGenerationRef.current === generation) {
          showStatusBarNotice(t("workspace.fileViewer.largeTextLoadFailed"), {
            tone: "error",
          });
        }
      } finally {
        if (searchGenerationRef.current === generation) {
          setSearching(false);
        }
      }
    }, [
      encoding,
      filePath,
      index,
      matchCase,
      searchedSignature,
      searching,
      searchMatch,
      searchValue,
      showStatusBarNotice,
      t,
      updateViewport,
      virtualWindow.start,
    ],
  );

  const searchStatus = searching
    ? t("workspace.fileViewer.loading")
    : searchedSignature && searchMatch
      ? t("workspace.fileViewer.lineColumn", {
          line: searchMatch.line + 1,
          column: searchMatch.startColumn + 1,
        })
      : searchedSignature
        ? t("workspace.fileViewer.noSearchResults")
        : "";

  return (
    <div className="fv-large-text-pane" ref={rootRef}>
      <ChromePortals
        center={
          <>
            <IconButton
              icon={Search}
              title={t("workspace.fileViewer.find")}
              disabled={!index}
              on={searchOpen}
              pressed={searchOpen}
              onClick={() => {
                if (searchOpen) {
                  setSearchOpen(false);
                  scrollerRef.current?.focus();
                } else {
                  openSearch();
                }
              }}
            />
            <IconButton
              icon={Hash}
              title={t("workspace.fileViewer.goToLine")}
              disabled={!index}
              on={goToOpen}
              pressed={goToOpen}
              onClick={() => {
                setSearchOpen(false);
                setGoToOpen((open) => !open);
              }}
            />
          </>
        }
        subbar={
          searchOpen ? (
            <div
              className="fv-findbar"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchOpen(false);
                  scrollerRef.current?.focus();
                }
              }}
            >
              <Search size={14} />
              <input
                ref={searchInputRef}
                className="fv-find-input"
                value={searchValue}
                placeholder={t("workspace.fileViewer.findPlaceholder")}
                aria-label={t("workspace.fileViewer.findPlaceholder")}
                onChange={(event) => {
                  setSearchValue(event.currentTarget.value);
                  setSearchMatch(null);
                  setSearchedSignature(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runSearch(event.shiftKey);
                  }
                }}
              />
              <span className="fv-find-count">{searchStatus}</span>
              <IconButton
                icon={ChevronUp}
                title={t("workspace.fileViewer.previousMatch")}
                disabled={!searchValue || !index || searching}
                onClick={() => void runSearch(true)}
              />
              <IconButton
                icon={ChevronDown}
                title={t("workspace.fileViewer.nextMatch")}
                disabled={!searchValue || !index || searching}
                onClick={() => void runSearch(false)}
              />
              <button
                type="button"
                className={matchCase ? "fv-find-toggle on" : "fv-find-toggle"}
                title={t("workspace.fileViewer.matchCase")}
                aria-label={t("workspace.fileViewer.matchCase")}
                aria-pressed={matchCase}
                onClick={() => {
                  setMatchCase((value) => !value);
                  setSearchMatch(null);
                  setSearchedSignature(null);
                }}
              >
                Aa
              </button>
              <div className="fv-tb-spacer" />
              <IconButton
                icon={X}
                title={t("common.close")}
                onClick={() => {
                  setSearchOpen(false);
                  scrollerRef.current?.focus();
                }}
              />
            </div>
          ) : goToOpen ? (
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
        tabIndex={0}
        ref={(node) => {
          scrollerRef.current = node;
          if (node) {
            window.requestAnimationFrame(updateViewport);
          }
        }}
        onPointerDown={() => scrollerRef.current?.focus({ preventScroll: true })}
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
                    {line === undefined ? (
                      "…"
                    ) : searchMatch?.line === zeroBasedLine ? (
                      <>
                        {line.slice(0, searchMatch.startColumn)}
                        <mark className="fv-large-text-match">
                          {line.slice(searchMatch.startColumn, searchMatch.endColumn)}
                        </mark>
                        {line.slice(searchMatch.endColumn)}
                      </>
                    ) : (
                      line || "\u00a0"
                    )}
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

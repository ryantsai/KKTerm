import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LARGE_TEXT_LINE_HEIGHT,
  largeTextVirtualWindow,
  splitLargeTextPage,
} from "../src/modules/workspace/connections/file-viewer/largeTextViewerModel";

test("large text virtual window reaches the complete file with a bounded scroll height", () => {
  const totalLines = 10_000_000;
  const viewportHeight = 600;
  const top = largeTextVirtualWindow({ scrollTop: 0, viewportHeight, totalLines });
  const bottom = largeTextVirtualWindow({
    scrollTop: Number.MAX_SAFE_INTEGER,
    viewportHeight,
    totalLines,
  });

  assert.equal(top.start, 0);
  assert.ok(top.totalHeight < totalLines * LARGE_TEXT_LINE_HEIGHT);
  assert.equal(bottom.end, totalLines);
  assert.ok(bottom.start < bottom.end);
});

test("large text page splitting preserves a trailing empty final line when expected", () => {
  assert.deepEqual(splitLargeTextPage("one\ntwo\n", 2), ["one", "two"]);
  assert.deepEqual(splitLargeTextPage("one\ntwo\n", 3), ["one", "two", ""]);
});

test("large text viewer indexes the file and lazily reads bounded pages", async () => {
  const source = await readFile(
    new URL(
      "../src/modules/workspace/connections/file-viewer/viewers/LargeTextViewer.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /invokeCommand\("index_file_view_text"/);
  assert.match(source, /invokeCommand\("read_file_view_text_page"/);
  assert.match(source, /const PAGE_CACHE_LIMIT = 12/);
  assert.match(source, /indexingLargeFile/);
  assert.match(source, /largeFileIndexed/);
  assert.match(source, /scroller\.scrollTop = \(line - 1\) \* LARGE_TEXT_LINE_HEIGHT/);
  assert.doesNotMatch(source, /read_file_view_text"/);
});

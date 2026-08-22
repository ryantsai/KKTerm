import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheControlForKey,
  contentTypeForKey,
  parseReleaseObjectPath,
  parseSingleRange,
  shouldReturnPartialContent,
} from "../cloudflare/release-worker/src/response.ts";

test("maps only safe public release paths to private R2 keys", () => {
  assert.equal(parseReleaseObjectPath("/releases/latest.json"), "releases/latest.json");
  assert.equal(parseReleaseObjectPath("/releases/latest-tauri.json"), "releases/latest-tauri.json");
  assert.equal(
    parseReleaseObjectPath("/releases/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe"),
    "releases/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe",
  );
  assert.equal(parseReleaseObjectPath("/releases/../secret"), null);
  assert.equal(parseReleaseObjectPath("/releases/v0.1.93/folder/file"), null);
  assert.equal(parseReleaseObjectPath("/other"), null);
});

test("uses partial-content status only for an explicit Range request", () => {
  assert.equal(shouldReturnPartialContent(null, { offset: 0, length: 100 }), false);
  assert.equal(shouldReturnPartialContent("bytes=0-0", { offset: 0, length: 1 }), true);
});

test("assigns metadata and installer response headers", () => {
  assert.equal(contentTypeForKey("releases/latest.json"), "application/json; charset=utf-8");
  assert.equal(contentTypeForKey("releases/latest-tauri.json"), "application/json; charset=utf-8");
  assert.equal(contentTypeForKey("releases/v0.1.93/app.exe"), "application/vnd.microsoft.portable-executable");
  assert.equal(contentTypeForKey("releases/v0.1.93/app.zip"), "application/zip");
  assert.equal(contentTypeForKey("releases/v0.1.93/app.sha256"), "text/plain; charset=utf-8");
  assert.equal(cacheControlForKey("releases/latest.json"), "public, max-age=300, must-revalidate");
  assert.equal(cacheControlForKey("releases/latest-tauri.json"), "public, max-age=300, must-revalidate");
  assert.equal(cacheControlForKey("releases/v0.1.93/app.exe"), "public, max-age=31536000, immutable");
});

test("parses a single bounded byte range", () => {
  assert.deepEqual(parseSingleRange("bytes=0-99", 1000), { offset: 0, length: 100 });
  assert.deepEqual(parseSingleRange("bytes=900-", 1000), { offset: 900, length: 100 });
  assert.deepEqual(parseSingleRange("bytes=-50", 1000), { offset: 950, length: 50 });
  assert.equal(parseSingleRange("bytes=1000-1001", 1000), null);
  assert.equal(parseSingleRange("bytes=0-1,5-6", 1000), null);
});

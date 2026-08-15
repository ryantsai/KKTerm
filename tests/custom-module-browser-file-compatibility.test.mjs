import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backendUrl = new URL("../src-tauri/src/custom_modules.rs", import.meta.url);

test("Custom Module browser downloads use the permission-bound save bridge", async () => {
  const backend = await readFile(backendUrl, "utf8");

  assert.match(backend, /const nativeAnchorClick = HTMLAnchorElement\.prototype\.click/);
  assert.match(backend, /replace\(HTMLAnchorElement\.prototype, 'click'/);
  assert.match(backend, /interceptBrowserDownload\(this\)/);
  assert.match(backend, /anchor\.matches\('a\[download\]'/);
  assert.match(backend, /url\.protocol === 'data:'/);
  assert.match(backend, /url\.protocol === 'blob:'/);
  assert.match(backend, /url\.origin === location\.origin/);
  assert.match(backend, /invoke\('files\.beginSave'/);
  assert.match(backend, /invoke\('files\.write'/);
  assert.match(backend, /invoke\('files\.commit'/);
  assert.match(backend, /invoke\('files\.close'/);
  assert.match(backend, /Math\.min\(saveTarget\.maxChunkBytes, 1024 \* 1024\)/);
  assert.match(backend, /dispatchFileError\('kktermDownloadError', error\)/);
  assert.match(
    backend,
    /\.on_download\(\|_, _\| false\)/,
    "the native WebView downloader must not bypass files.save or its extension policy",
  );
});

test("Custom Module CSP permits local blob:/data: reads for mediated downloads", async () => {
  const backend = await readFile(backendUrl, "utf8");

  const csp = backend.match(
    /"Content-Security-Policy",\s*\n\s*"([^"]*)"/s,
    "the CSP header must be a single literal string",
  )?.[1];
  assert.ok(csp, "the Content-Security-Policy header must exist");
  assert.match(
    csp,
    /connect-src 'self' blob: data:/,
    "the save bridge reads blob:/data: exports with fetch(), which connect-src controls; 'self' alone blocks the read and discards the save",
  );
  assert.doesNotMatch(
    csp,
    /https?:|:\/\/|\*/,
    "the CSP must not permit remote connect targets; only local blob:/data: reads are added",
  );
});

test("Custom Module browser file compatibility reaches same-package frames", async () => {
  const backend = await readFile(backendUrl, "utf8");

  assert.match(backend, /\.initialization_script_for_all_frames\(initialization_script\(/);
  assert.doesNotMatch(backend, /\.initialization_script\(initialization_script\(/);
});

test("Custom Module browser file inputs and drops follow effective file grants", async () => {
  const backend = await readFile(backendUrl, "utf8");

  assert.match(
    backend,
    /effective_permissions\s*\.files\s*\.as_ref\(\)\s*\.is_some_and\(\|files\| files\.open\)/,
  );
  assert.match(backend, /builder = builder\.disable_drag_drop_handler\(\)/);
  assert.match(backend, /input\[type=["']file["']\]/);
  assert.match(backend, /file\.name\.split\('\.'\)\.pop\(\)/);
  assert.match(backend, /document\.addEventListener\('drop'/);
  assert.match(backend, /filesOpenAllowed/);
  assert.match(backend, /allowedFileExtensions/);
});

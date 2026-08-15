// Assembles the packaged Squoosh dist/ tree for the KKTerm Custom Module.
//
// Run against an already-built Squoosh checkout (npm run build there first).
// Pass the checkout path as argv[2], or set SQUOOSH_SRC.
//
// Three upstream assumptions do not hold inside a KKMod WebView:
//
//   1. Service workers. `navigator.serviceWorker` is undefined, so the PWA
//      shell, its precache manifest and the share target are all dead weight.
//   2. Cross-origin isolation. Squoosh ships a _headers file asking for
//      COOP/COEP so it can use threaded WASM. The kkmodule protocol sends
//      neither, so `crossOriginIsolated` is false and every *_mt codec is
//      unreachable. Squoosh feature-detects and falls back to single-threaded
//      builds on its own, so this costs encode speed, not functionality.
//   3. Root-absolute asset URLs. Squoosh emits "/c/<hashed>" everywhere. The
//      kkmodule handler resolves a request path against the PACKAGE ROOT
//      (route.root.join(path)), while these files live under dist/, so "/c/..."
//      would 404.
//
// The path rewrite differs by file type, and getting it backwards silently
// breaks either images or codecs:
//
//   - index.html sits at dist/, and the contract requires relative refs there,
//     so "/c/x" -> "./c/x".
//   - JS under dist/c/ mixes DOM strings (resolved against the DOCUMENT) with
//     new URL(..., import.meta.url) and fetch() (resolved against the MODULE).
//     A single relative form cannot be right for both, so these become
//     "/dist/c/x": root-absolute ignores the base entirely and lands correctly
//     for every caller. The validator only parses HTML, so this stays clean.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const squooshRoot = process.argv[2] || process.env.SQUOOSH_SRC;
if (!squooshRoot) {
  console.error("usage: node scripts/build-dist.mjs <squoosh-checkout>");
  process.exit(1);
}
const buildDir = path.join(squooshRoot, "build");
const distDir = path.join(moduleRoot, "dist");

if (!fs.existsSync(path.join(buildDir, "index.html"))) {
  console.error(`no build found at ${buildDir} -- run "npm run build" in the Squoosh checkout`);
  process.exit(1);
}

// PWA and host-config artefacts that cannot function in a Module.
//   _headers/_redirects : Netlify directives, meaningless to the kkmodule handler
//   manifest.json       : PWA install manifest; a Module is not installable
//   sw.js/serviceworker : never registered, and serviceworker.js alone carries
//                         94 of the root-absolute refs
const DROP = new Set([
  "_headers",
  "_redirects",
  "manifest.json",
  "sw.js",
  "serviceworker.js",
]);

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (DROP.has(entry.name)) continue;
    // sw-bridge.*.js at the build root is the copied PWA shim; the real chunk
    // the app imports lives under c/.
    if (/^sw-bridge\.[0-9a-f]+\.js(\.map)?$/.test(entry.name)) continue;
    if (entry.name.endsWith(".map")) continue; // source maps: bulk, no runtime value
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
copyTree(buildDir, distDir);
fs.copyFileSync(path.join(moduleRoot, "public", "icon.svg"), path.join(distDir, "icon.svg"));
fs.copyFileSync(
  path.join(moduleRoot, "src", "kkterm-runtime.js"),
  path.join(distDir, "kkterm-runtime.js"),
);

// --- Rewrite JS: "/c/x" -> "/dist/c/x" -------------------------------------

let jsRewrites = 0;
function rewriteJs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteJs(full);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const before = fs.readFileSync(full, "utf8");
    const after = before.replaceAll(/(?<!\/dist)\/c\//g, "/dist/c/");
    if (before !== after) {
      jsRewrites += before.split("/c/").length - 1;
      fs.writeFileSync(full, after, "utf8");
    }
  }
}
rewriteJs(distDir);

// --- Rewrite and harden index.html -----------------------------------------

const indexPath = path.join(distDir, "index.html");
let html = fs.readFileSync(indexPath, "utf8");

html = html.replaceAll('"/c/', '"./c/');
// The PWA manifest and the canonical/social tags point at squoosh.app; neither
// is reachable or meaningful from inside a Module.
html = html.replace(/<link[^>]*\brel="manifest"[^>]*>\s*/gi, "");
html = html.replace(/<link[^>]*\brel="canonical"[^>]*>\s*/gi, "");
html = html.replace(/<meta[^>]*\b(?:property|name)="(?:og|twitter):[^"]*"[^>]*>\s*/gi, "");
// href="/" is a link back to the site root, which does not exist here.
html = html.replaceAll('href="/"', 'href="./index.html"');

// Externalise inline scripts: the CSP is script-src 'self' 'wasm-unsafe-eval'
// with no 'unsafe-inline'.
const inlineScript = /<script(?![^>]*\btype\s*=\s*"(?:application\/json|text\/plain)")([^>]*)>([\s\S]*?)<\/script>/g;
const externalised = [];
html = html.replace(inlineScript, (match, attrs, body) => {
  if (/\bsrc\s*=/.test(attrs)) {
    return match.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
  }
  if (!body.trim()) return match;
  const name = `inline-${createHash("sha256").update(body).digest("hex").slice(0, 16)}.js`;
  fs.writeFileSync(path.join(distDir, name), body, "utf8");
  externalised.push(name);
  const kept = attrs.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "").trim();
  return `<script src="./${name}"${kept ? " " + kept : ""}></script>`;
});

// Signal host readiness independently from Squoosh's upstream bundle. Insert
// the adapter after externalising the upstream application script so this also
// works from a pristine build. Removing an existing tag keeps rebuilds safe.
const runtimeTag = '<script src="./kkterm-runtime.js"></script>';
html = html.replaceAll(runtimeTag, "");
html = html.replace(/<script src="\.\/inline-/, `${runtimeTag}<script src="./inline-`);

fs.writeFileSync(indexPath, html, "utf8");

// --- Verify ----------------------------------------------------------------

const problems = [];
const finalHtml = fs.readFileSync(indexPath, "utf8");

for (const [, attrs, body] of finalHtml.matchAll(inlineScript)) {
  if (!/\bsrc\s*=/.test(attrs) && body.trim()) {
    problems.push("executable inline <script> survived externalisation");
  }
}
if (/\son[a-z]+\s*=\s*(?:"|')/i.test(finalHtml)) {
  problems.push("inline event handler attribute survived (blocked by CSP)");
}
for (const [, ref] of finalHtml.matchAll(/(?:\bsrc|\bdata|\bposter|<(?:link|base|image|use)[^>]*\bhref)\s*=\s*"([^"]+)"/g)) {
  if (/^(?:https?:|data:|blob:|#|\.\/)/.test(ref)) continue;
  problems.push(`non-relative local reference in HTML: ${ref}`);
}
if (/(?:^|[^.])\/c\//.test(finalHtml)) {
  problems.push("root-absolute /c/ reference survived in HTML");
}
if (!finalHtml.includes(`${runtimeTag}<script src="./inline-`)) {
  problems.push("KKTerm runtime adapter is missing or loads after the Squoosh application");
}

// Every rewritten JS target must actually exist on disk.
const missing = new Set();
for (const entry of fs.readdirSync(path.join(distDir, "c"))) missing.add(entry);
for (const file of fs.readdirSync(distDir, { recursive: true })) {
  if (typeof file !== "string" || !file.endsWith(".js")) continue;
  const text = fs.readFileSync(path.join(distDir, file), "utf8");
  for (const [, ref] of text.matchAll(/\/dist\/c\/([A-Za-z0-9_.-]+)/g)) {
    if (!fs.existsSync(path.join(distDir, "c", ref))) {
      problems.push(`JS references missing asset: c/${ref} (from ${file})`);
    }
  }
}
if (fs.existsSync(path.join(distDir, "serviceworker.js"))) {
  problems.push("serviceworker.js was not dropped");
}

if (problems.length) {
  console.error("\nPackaged Squoosh failed verification:");
  for (const p of [...new Set(problems)].slice(0, 20)) console.error(`  - ${p}`);
  process.exit(1);
}

function measure(dir) {
  let count = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = measure(full);
      count += sub.count;
      bytes += sub.bytes;
    } else {
      count += 1;
      bytes += fs.statSync(full).size;
    }
  }
  return { count, bytes };
}
const { count, bytes } = measure(distDir);
console.log(`\ndist/ ok — ${count} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`rewrote ${jsRewrites} JS asset refs; externalised ${externalised.length} inline script(s)`);

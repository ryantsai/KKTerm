// Builds the packaged TiddlyWiki dist/ tree for the KKTerm Custom Module.
//
// The KKMod WebView serves packages under a CSP of
//   script-src 'self' 'wasm-unsafe-eval'
// with no 'unsafe-inline'. TiddlyWiki's saved-wiki format leans on inline
// <script> blocks and at least one inline event handler, so every executable
// inline fragment has to become an external file before the wiki will boot.
//
// Getting this wrong is not loud: the browser-storage plugin injects its
// boot-time preload hook as raw markup, so a blocked inline script leaves a
// wiki that starts normally but silently never restores saved tiddlers.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const editionDir = path.join(moduleRoot, "src", "edition");
const buildDir = path.join(moduleRoot, "build");
const distDir = path.join(moduleRoot, "dist");

function run(command, args) {
  execFileSync(command, args, { cwd: moduleRoot, stdio: "inherit" });
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

// --- 1. Build the wiki with an external core -------------------------------

resetDir(buildDir);
run("npx", ["tiddlywiki", editionDir, "--output", buildDir, "--build", "index"]);

// --- 2. Externalise every executable inline script -------------------------

const indexPath = path.join(buildDir, "index.html");
let html = fs.readFileSync(indexPath, "utf8");

const externalised = [];
// A <script> carrying a non-JavaScript type (TiddlyWiki's tiddler store uses
// application/json) is inert data, not something the browser executes, so CSP
// leaves it alone and it must stay inline for boot to find it.
const inlineScript = /<script(?![^>]*\btype\s*=\s*"(?:application\/json|text\/plain)")([^>]*)>([\s\S]*?)<\/script>/g;

html = html.replace(inlineScript, (match, attrs, body) => {
  if (/\bsrc\s*=/.test(attrs)) {
    // Already external. Strip inline event handlers, which CSP also blocks.
    return match.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
  }
  if (!body.trim()) {
    return match;
  }
  const name = `inline-${createHash("sha256").update(body).digest("hex").slice(0, 16)}.js`;
  fs.writeFileSync(path.join(buildDir, name), body, "utf8");
  externalised.push(name);
  const kept = attrs.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "").trim();
  // Classic external scripts execute in document order, so the boot sequence
  // (rawmarkup -> core) survives the rewrite.
  return `<script src="./${name}"${kept ? " " + kept : ""}></script>`;
});

fs.writeFileSync(indexPath, html, "utf8");

// --- 3. Assemble dist/ ------------------------------------------------------

resetDir(distDir);
for (const entry of fs.readdirSync(buildDir)) {
  fs.copyFileSync(path.join(buildDir, entry), path.join(distDir, entry));
}
fs.copyFileSync(path.join(moduleRoot, "public", "icon.svg"), path.join(distDir, "icon.svg"));

// Core is referenced bare ("tiddlywikicore-x.y.z.js"); the contract wants every
// local reference to resolve relatively from dist/.
let dist = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
dist = dist.replace(/<script src="(tiddlywikicore-[^"]+)"/g, '<script src="./$1"');
// TiddlyWiki always emits a favicon link, but the saved-wiki build never writes
// the file and a Module renders as a panel with no tab chrome to display one.
// Leaving it would ship a permanently broken reference.
dist = dist.replace(/<link[^>]*\brel\s*=\s*"(?:shortcut )?icon"[^>]*>\s*/gi, "");
fs.writeFileSync(path.join(distDir, "index.html"), dist, "utf8");

// --- 4. Verify the packaged HTML -------------------------------------------

const problems = [];
const finalHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf8");

for (const [, attrs, body] of finalHtml.matchAll(inlineScript)) {
  if (!/\bsrc\s*=/.test(attrs) && body.trim()) {
    problems.push("executable inline <script> survived externalisation");
  }
}
if (/\son[a-z]+\s*=\s*(?:"|')/i.test(finalHtml)) {
  problems.push("inline event handler attribute survived (blocked by CSP)");
}
for (const [, ref] of finalHtml.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
  if (/^(?:https?:|data:|blob:|#|\.\/)/.test(ref)) continue;
  problems.push(`non-relative local reference: ${ref}`);
}
for (const name of externalised) {
  if (!fs.existsSync(path.join(distDir, name))) {
    problems.push(`missing externalised script: ${name}`);
  }
}

if (problems.length) {
  console.error("\nPackaged HTML failed verification:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const files = fs.readdirSync(distDir);
const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(distDir, f)).size, 0);
console.log(`\ndist/ ok — ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`externalised ${externalised.length} inline script(s): ${externalised.join(", ")}`);

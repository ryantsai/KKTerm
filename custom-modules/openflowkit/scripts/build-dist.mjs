// Assembles the packaged OpenFlowKit dist/ tree for the KKTerm Custom Module.
//
// Run against an already-built OpenFlowKit checkout (npm run build there first).
// Pass the checkout path as argv[2], or set OPENFLOWKIT_SRC.
//
// OpenFlowKit needs far less reshaping than most web apps: its Vite config
// already sets `base: './'`, so every emitted asset reference is relative and
// the bundle carries no inline <script>. What remains is stripping the PWA
// shell and the links back to the public site.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = process.argv[2] || process.env.OPENFLOWKIT_SRC;
if (!srcRoot) {
  console.error("usage: node scripts/build-dist.mjs <openflowkit-checkout>");
  process.exit(1);
}
const buildDir = path.join(srcRoot, "dist");
const distDir = path.join(moduleRoot, "dist");

if (!fs.existsSync(path.join(buildDir, "index.html"))) {
  console.error(`no build found at ${buildDir} -- run "npm run build" in the OpenFlowKit checkout`);
  process.exit(1);
}

// sw.js is never registered (the guard now reads navigator.serviceWorker's
// value, which the host shims to undefined), and a Module cannot be installed
// as a PWA. sitemap/robots belong to the public site.
const DROP = new Set([
  "sw.js",
  "manifest.webmanifest",
  "sitemap.xml",
  "robots.txt",
  "CNAME",
]);

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (DROP.has(entry.name)) continue;
    if (entry.name.endsWith(".map")) continue;
    // Dotfiles are deployment metadata (.nojekyll for GitHub Pages, and
    // friends). The package validator rejects them as unsupported payload
    // types, and none of them mean anything to the kkmodule handler.
    if (entry.name.startsWith(".")) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
copyTree(buildDir, distDir);
fs.copyFileSync(path.join(moduleRoot, "public", "icon.svg"), path.join(distDir, "icon.svg"));

// --- Harden index.html ------------------------------------------------------

const indexPath = path.join(distDir, "index.html");
let html = fs.readFileSync(indexPath, "utf8");

html = html.replace(/<link[^>]*\brel="manifest"[^>]*>\s*/gi, "");
html = html.replace(/<link[^>]*\brel="canonical"[^>]*>\s*/gi, "");
html = html.replace(/<meta[^>]*\b(?:property|name)="(?:og|twitter):[^"]*"[^>]*>\s*/gi, "");

// Defensive: the CSP is script-src 'self' 'wasm-unsafe-eval' with no
// 'unsafe-inline'. The current build emits none, but a future upstream change
// could introduce one and it must not reach a package silently.
const inlineScript = /<script(?![^>]*\btype\s*=\s*"(?:application\/json|text\/plain|application\/ld\+json)")([^>]*)>([\s\S]*?)<\/script>/g;
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
// ld+json is inert metadata describing the public site, not the Module.
html = html.replace(/<script[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\s*/gi, "");

fs.writeFileSync(indexPath, html, "utf8");

// --- Verify -----------------------------------------------------------------

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
// Every relative asset the document names must exist on disk.
for (const [, ref] of finalHtml.matchAll(/(?:src|href)\s*=\s*"(\.\/[^"]+)"/g)) {
  const target = path.join(distDir, ref.replace(/^\.\//, "").split(/[?#]/)[0]);
  if (!fs.existsSync(target)) problems.push(`index.html references missing asset: ${ref}`);
}
// The AI transport must be inert in this build.
let aiGuardSeen = false;
for (const file of fs.readdirSync(path.join(distDir, "assets"))) {
  if (!file.endsWith(".js")) continue;
  const text = fs.readFileSync(path.join(distDir, "assets", file), "utf8");
  if (text.includes("AI generation is unavailable in the KKTerm Module build")) aiGuardSeen = true;
}
if (!aiGuardSeen) problems.push("AI disable guard is missing from the bundle");
if (fs.existsSync(path.join(distDir, "sw.js"))) problems.push("sw.js was not dropped");
for (const dirent of fs.readdirSync(distDir, { recursive: true })) {
  if (typeof dirent === "string" && /fonts\.googleapis\.com/.test(dirent)) {
    problems.push("remote font reference survived");
  }
}

if (problems.length) {
  console.error("\nPackaged OpenFlowKit failed verification:");
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
console.log(`externalised ${externalised.length} inline script(s)`);

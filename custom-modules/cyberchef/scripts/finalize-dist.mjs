import {createHash} from "node:crypto";
import {cp, mkdir, readdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {extname, relative, resolve} from "node:path";

const moduleRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(process.argv[2] || process.env.CYBERCHEF_SOURCE || "");
if (!process.argv[2] && !process.env.CYBERCHEF_SOURCE) {
    throw new Error("Pass the adapted CyberChef checkout path or set CYBERCHEF_SOURCE.");
}

const upstreamDist = resolve(sourceRoot, "build/prod");
if (!(await stat(upstreamDist)).isDirectory()) {
    throw new Error(`CyberChef production output is missing: ${upstreamDist}`);
}

const targetDist = resolve(moduleRoot, "dist");
await rm(targetDist, {recursive: true, force: true});
await cp(upstreamDist, targetDist, {recursive: true});

const allowedExtensions = new Set([
    ".html", ".css", ".js", ".mjs", ".json", ".map", ".wasm", ".svg",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff",
    ".woff2", ".ttf", ".otf", ".txt", ".md", ".xml", ".webmanifest", ".gz",
    ".bcmap", ".pfb", ".ftl", ".icc", ".whl", ".zip"
]);

async function normalizeBitmapFonts(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            await normalizeBitmapFonts(path);
        } else if (extname(entry.name).toLowerCase() === ".fnt") {
            await rename(path, `${path.slice(0, -4)}.txt`);
        }
    }
}
await normalizeBitmapFonts(targetDist);

async function clean(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            await clean(path);
            if ((await readdir(path)).length === 0) await rm(path, {recursive: true});
            continue;
        }
        const extension = extname(entry.name).toLowerCase();
        const relativePath = relative(targetDist, path).replaceAll("\\", "/");
        const generatedArchive = /^CyberChef_.+\.(?:html|zip)$/i.test(entry.name);
        const redundantGzip = extension === ".gz" && await stat(path.slice(0, -3)).then(() => true, () => false);
        if (
            entry.name === "BundleAnalyzerReport.html" ||
            entry.name === "sha256digest.txt" ||
            entry.name.endsWith(".br") ||
            redundantGzip ||
            generatedArchive ||
            entry.name.startsWith(".") ||
            !allowedExtensions.has(extension)
        ) {
            await rm(path);
            continue;
        }
        if (!/^[A-Za-z0-9/._@-]+$/.test(relativePath)) {
            throw new Error(`CyberChef emitted a non-portable package path: ${relativePath}`);
        }
    }
}
await clean(targetDist);

async function rewriteBitmapFontReferences(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            await rewriteBitmapFontReferences(path);
        } else if (/\.(?:js|mjs)$/i.test(entry.name)) {
            const source = await readFile(path, "utf8");
            const rewritten = source.replace(/(assets\/fonts\/[A-Za-z0-9._-]+)\.fnt\b/g, "$1.txt");
            if (rewritten !== source) await writeFile(path, rewritten, "utf8");
        }
    }
}
await rewriteBitmapFontReferences(targetDist);

const indexPath = resolve(targetDist, "index.html");
let html = await readFile(indexPath, "utf8");
html = html.replace(/<link[^>]*\brel=["'](?:manifest|canonical)["'][^>]*>\s*/gi, "");

const inlineScript = /<script(?![^>]*\btype\s*=\s*["'](?:application\/json|text\/plain|application\/ld\+json)["'])([^>]*)>([\s\S]*?)<\/script>/gi;
const externalised = [];
html = html.replace(inlineScript, (match, attrs, body) => {
    if (/\bsrc\s*=/.test(attrs) || !body.trim()) return match;
    const name = `inline-${createHash("sha256").update(body).digest("hex").slice(0, 16)}.js`;
    externalised.push({name, body});
    const kept = attrs.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "").trim();
    return `<script src="./${name}"${kept ? ` ${kept}` : ""}></script>`;
});
for (const script of externalised) {
    await writeFile(resolve(targetDist, script.name), script.body, "utf8");
}

html = html.replace(
    /\b(src|href|data|poster)=("|')(assets|images|modules)\//gi,
    '$1=$2./$3/'
);
await writeFile(indexPath, html, "utf8");
await cp(resolve(moduleRoot, "public/icon.svg"), resolve(targetDist, "icon.svg"));

const adapterSource = await readFile(resolve(moduleRoot, "src/kkterm-v2-adapter.mjs"), "utf8");
await mkdir(resolve(moduleRoot, "licenses"), {recursive: true});
await writeFile(
    resolve(moduleRoot, "licenses/KKTERM_ADAPTER_SOURCE.txt"),
    `KKTerm CyberChef API v2 adapter source\n========================================\n\n${adapterSource}`,
    "utf8"
);

const browserFiles = [];
async function collect(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) await collect(path);
        else browserFiles.push(path);
    }
}
await collect(targetDist);

const problems = [];
const finalHtml = await readFile(indexPath, "utf8");
for (const [, attrs, body] of finalHtml.matchAll(inlineScript)) {
    if (!/\bsrc\s*=/.test(attrs) && body.trim()) problems.push("executable inline script survived");
}
if (/\son[a-z]+\s*=\s*(?:"|')/i.test(finalHtml)) problems.push("inline event handler survived");
if (/<(?:object|embed)\b/i.test(finalHtml)) problems.push("object/embed element survived");
if (/<(?:script|iframe)[^>]+(?:src|href)=["']https?:/i.test(finalHtml)) {
    problems.push("remote executable/frame reference survived");
}
if (/<link[^>]+href=["']https?:/i.test(finalHtml)) problems.push("remote stylesheet reference survived");

for (const [, ref] of finalHtml.matchAll(/(?:\bsrc|\bhref|\bdata|\bposter)\s*=\s*["']([^"']+)["']/gi)) {
    if (/^(?:https?:|data:|blob:|#)/i.test(ref)) continue;
    const cleanRef = ref.replace(/^\.\//, "").split(/[?#]/)[0];
    if (!cleanRef || !(await stat(resolve(targetDist, cleanRef)).then(value => value.isFile(), () => false))) {
        problems.push(`index.html references missing packaged asset: ${ref}`);
    }
}

let combinedJavaScript = "";
for (const path of browserFiles.filter(path => /\.(?:js|mjs)$/i.test(path))) {
    combinedJavaScript += `\n${await readFile(path, "utf8")}`;
}
for (const marker of ["HTTP request", "DNS over HTTPS", "tile.openstreetmap.org", "unpkg.com/leaflet"] ) {
    if (combinedJavaScript.includes(marker)) problems.push(`disabled network operation survived: ${marker}`);
}
if (!combinedJavaScript.includes("KKTerm host API v2 is unavailable.")) problems.push("KKTerm adapter marker is missing");
if (/\bwindow\.(?:alert|confirm|prompt)\s*\(/.test(combinedJavaScript)) {
    problems.push("browser-native alert/confirm/prompt survived");
}
if (/\beval\s*\(/.test(combinedJavaScript)) problems.push("eval call survived the CSP adaptation");
if (/new\s+Worker\([^)]{0,500}(?:createObjectURL|blob:)/i.test(combinedJavaScript)) {
    problems.push("blob-backed Worker construction survived");
}
if (/serviceWorker\s*\.\s*register|new\s+SharedWorker\s*\(/.test(combinedJavaScript)) {
    problems.push("unsupported worker registration survived");
}

if (problems.length) {
    throw new Error(`Packaged CyberChef failed verification:\n- ${[...new Set(problems)].join("\n- ")}`);
}

const bytes = (await Promise.all(browserFiles.map(path => stat(path)))).reduce((total, value) => total + value.size, 0);
console.log(`Prepared CyberChef dist/ — ${browserFiles.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`Externalised ${externalised.length} inline script(s).`);

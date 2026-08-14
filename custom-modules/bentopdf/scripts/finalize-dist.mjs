import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const moduleRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(process.argv[2] || process.env.BENTOPDF_SOURCE || '');
if (!process.argv[2] && !process.env.BENTOPDF_SOURCE) {
  throw new Error('Pass the BentoPDF checkout path or set BENTOPDF_SOURCE.');
}

const upstreamDist = resolve(sourceRoot, 'dist');
if (!(await stat(upstreamDist)).isDirectory()) {
  throw new Error(`BentoPDF dist directory is missing: ${upstreamDist}`);
}

const targetDist = resolve(moduleRoot, 'dist');
await rm(targetDist, { recursive: true, force: true });
await cp(upstreamDist, targetDist, { recursive: true });

for (const relative of [
  'kkmod-runtime/pymupdf/build_scripts',
  'kkmod-runtime/pymupdf/types',
  'kkmod-runtime/pymupdf/LICENSE',
  'kkmod-runtime/pymupdf/README.md',
  'kkmod-runtime/pymupdf/package.json',
  'kkmod-runtime/ocr/core/LICENSE',
  'kkmod-runtime/ocr/core/README.md',
  'kkmod-runtime/ocr/core/package.json',
]) {
  await rm(resolve(targetDist, relative), { recursive: true, force: true });
}

const embedPdfFonts = {
  jp: 'fonts-jp',
  kr: 'fonts-kr',
  sc: 'fonts-sc',
  tc: 'fonts-tc',
  arabic: 'fonts-arabic',
  hebrew: 'fonts-hebrew',
  latin: 'fonts-latin',
};
for (const [key, packageName] of Object.entries(embedPdfFonts)) {
  await cp(
    resolve(sourceRoot, `node_modules/@embedpdf/${packageName}/fonts`),
    resolve(targetDist, `kkmod-runtime/embedpdf-fonts/${key}`),
    { recursive: true }
  );
}

const workerCandidates = (await readdir(resolve(targetDist, 'assets')))
  .filter((name) => name.startsWith('worker-engine-') && name.endsWith('.js'));
if (workerCandidates.length !== 1) {
  throw new Error(`Expected one EmbedPDF worker bundle; found ${workerCandidates.length}.`);
}
const workerPath = resolve(targetDist, 'assets', workerCandidates[0]);
let workerSource = await readFile(workerPath, 'utf8');
const embedPdfFontRoutes = {
  jp: 'fonts-jp',
  kr: 'fonts-kr',
  sc: 'fonts-sc',
  tc: 'fonts-tc',
  arabic: 'fonts-arabic',
  hebrew: 'fonts-hebrew',
  latin: 'fonts-latin',
};
for (const [key, packageName] of Object.entries(embedPdfFontRoutes)) {
  const before =
    `https://cdn.jsdelivr.net/npm/@embedpdf/${packageName}@\\` +
    '${version}/fonts';
  const after = `/dist/kkmod-runtime/embedpdf-fonts/${key}`;
  if (!workerSource.includes(before)) {
    throw new Error(`EmbedPDF font URL adaptation target is missing for ${packageName}.`);
  }
  workerSource = workerSource.replace(before, after);
}
await writeFile(workerPath, workerSource, 'utf8');

const runtimeExtensions = new Set([
  '.html', '.css', '.js', '.mjs', '.json', '.map', '.wasm', '.svg', '.png',
  '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2',
  '.ttf', '.otf', '.txt', '.md', '.xml', '.webmanifest', '.gz', '.bcmap',
  '.pfb', '.ftl', '.icc', '.whl', '.zip',
]);

async function clean(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await clean(path);
      if ((await readdir(path)).length === 0) await rm(path, { recursive: true });
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (entry.name === 'sw.js' || extension === '.br' || !runtimeExtensions.has(extension)) {
      await rm(path);
    }
  }
}
await clean(targetDist);

await cp(resolve(moduleRoot, 'public/icon.svg'), resolve(targetDist, 'icon.svg'));

const sourceText = await readFile(resolve(moduleRoot, 'src/kkterm-v2-adapter.ts'), 'utf8');
await mkdir(resolve(moduleRoot, 'licenses'), { recursive: true });
await writeFile(
  resolve(moduleRoot, 'licenses/KKTERM_ADAPTER_SOURCE.txt'),
  `KKTerm BentoPDF API v2 adapter source\n======================================\n\n${sourceText}`,
  'utf8'
);

console.log(`Prepared the KKMod payload in ${targetDist}`);

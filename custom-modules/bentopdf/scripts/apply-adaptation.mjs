import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const moduleRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(process.argv[2] || process.env.BENTOPDF_SOURCE || '');

if (!process.argv[2] && !process.env.BENTOPDF_SOURCE) {
  throw new Error('Pass the BentoPDF checkout path or set BENTOPDF_SOURCE.');
}

const packagePath = resolve(sourceRoot, 'package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
if (packageJson.name !== 'bento-pdf' || packageJson.version !== '2.8.7') {
  throw new Error('Expected the immutable BentoPDF v2.8.7 source tree.');
}

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8');
  const matches = source.split(before).length - 1;
  if (matches === 0 && source.includes(after)) {
    return;
  }
  if (matches !== 1) {
    throw new Error(`Expected exactly one adaptation target in ${path}; found ${matches}.`);
  }
  await writeFile(path, source.replace(before, after), 'utf8');
}

async function replaceEvery(path, before, after, expectedMatches) {
  const source = await readFile(path, 'utf8');
  const matches = source.split(before).length - 1;
  if (matches === 0 && source.split(after).length - 1 === expectedMatches) {
    return;
  }
  if (matches !== expectedMatches) {
    throw new Error(
      `Expected ${expectedMatches} adaptation targets in ${path}; found ${matches}.`
    );
  }
  await writeFile(path, source.replaceAll(before, after), 'utf8');
}

async function ensureImport(path, statement, anchor) {
  const source = await readFile(path, 'utf8');
  const escaped = statement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutDuplicates = source.replace(new RegExp(`${escaped}\\s*`, 'g'), '');
  const matches = withoutDuplicates.split(anchor).length - 1;
  if (matches !== 1) {
    throw new Error(`Expected one import anchor in ${path}; found ${matches}.`);
  }
  await writeFile(
    path,
    withoutDuplicates.replace(anchor, `${statement}\n\n${anchor}`),
    'utf8'
  );
}

async function insertBeforeOnce(path, marker, insertion, sentinel) {
  const source = await readFile(path, 'utf8');
  if (source.includes(sentinel)) return;
  const matches = source.split(marker).length - 1;
  if (matches !== 1) {
    throw new Error(`Expected one insertion marker in ${path}; found ${matches}.`);
  }
  await writeFile(path, source.replace(marker, `${insertion}${marker}`), 'utf8');
}

async function insertAfterOnce(path, marker, insertion, sentinel) {
  const source = await readFile(path, 'utf8');
  if (source.includes(sentinel)) return;
  const matches = source.split(marker).length - 1;
  if (matches !== 1) {
    throw new Error(`Expected one insertion marker in ${path}; found ${matches}.`);
  }
  await writeFile(path, source.replace(marker, `${marker}${insertion}`), 'utf8');
}

const mainPath = resolve(sourceRoot, 'src/js/main.ts');
await ensureImport(
  mainPath,
  "import './kkterm-v2-adapter.js';",
  "import { categories } from './config/tools.js';"
);
await replaceOnce(
  mainPath,
  "  if (githubStarsElements.some((el) => el) && !__SIMPLE_MODE__) {",
  `  const isKktermModule = Boolean(
    (window as Window & { KKTerm?: { apiVersion?: number } }).KKTerm
  );
  if (githubStarsElements.some((el) => el) && !__SIMPLE_MODE__ && !isKktermModule) {`
);

await replaceOnce(
  resolve(sourceRoot, 'index.html'),
  '    <script type="module" src="src/js/sw-register.ts"></script>\n',
  ''
);

await replaceOnce(
  resolve(sourceRoot, 'src/js/utils/wasm-provider.ts'),
  `const CDN_DEFAULTS: Record<WasmPackage, string> = {
  pymupdf: 'https://cdn.jsdelivr.net/npm/@bentopdf/pymupdf-wasm@0.11.16/',
  ghostscript: 'https://cdn.jsdelivr.net/npm/@bentopdf/gs-wasm@0.1.1/assets/',
  cpdf: 'https://cdn.jsdelivr.net/npm/coherentpdf@2.5.5/dist/',
};`,
  `const CDN_DEFAULTS: Record<WasmPackage, string> = {
  pymupdf: './kkmod-runtime/pymupdf/',
  ghostscript: './kkmod-runtime/gs/',
  cpdf: './kkmod-runtime/cpdf/',
};`
);

await replaceOnce(
  resolve(sourceRoot, 'src/js/i18n/language-switcher.ts'),
  'export const injectLanguageSwitcher = (): void => {',
  `export const injectLanguageSwitcher = (): void => {
  if ((window as Window & { KKTerm?: { apiVersion?: number } }).KKTerm?.apiVersion === 2) return;`
);

await replaceOnce(
  resolve(sourceRoot, 'src/js/i18n/i18n.ts'),
  'export const rewriteLinks = (): void => {',
  `export const rewriteLinks = (): void => {
  if ((window as Window & { KKTerm?: { apiVersion?: number } }).KKTerm?.apiVersion === 2) return;`
);

await insertAfterOnce(
  resolve(sourceRoot, 'src/js/i18n/i18n.ts'),
  '  if (initialized) return i18next;',
  `

  const kktermContextReady = (
    window as Window & { KKTermBentoContextReady?: Promise<void> }
  ).KKTermBentoContextReady;
  if (kktermContextReady) await kktermContextReady;

`,
  'if (kktermContextReady) await kktermContextReady;'
);

await replaceEvery(
  resolve(sourceRoot, 'vite.config.ts'),
  "process.env.BASE_URL || '/'",
  "process.env.BASE_URL || './'",
  4
);

await copyFile(
  resolve(moduleRoot, 'src/kkterm-v2-adapter.ts'),
  resolve(sourceRoot, 'src/js/kkterm-v2-adapter.ts')
);
await copyFile(
  resolve(moduleRoot, 'src/kkterm-locale.ts'),
  resolve(sourceRoot, 'src/js/kkterm-locale.ts')
);

packageJson.dependencies.dompurify = '3.4.13';
packageJson.dependencies.mermaid = '11.16.1';
packageJson.overrides = {
  ...packageJson.overrides,
  'brace-expansion': '2.1.4',
  nanoid: '3.3.18',
  postcss: '8.5.26',
};
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

console.log(`Applied the KKTerm API v2 adaptation to ${sourceRoot}`);

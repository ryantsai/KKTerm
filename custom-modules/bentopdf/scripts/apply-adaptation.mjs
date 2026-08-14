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

const mainPath = resolve(sourceRoot, 'src/js/main.ts');
await replaceOnce(
  mainPath,
  "import { categories } from './config/tools.js';",
  "import './kkterm-v2-adapter.js';\n\nimport { categories } from './config/tools.js';"
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

await copyFile(
  resolve(moduleRoot, 'src/kkterm-v2-adapter.ts'),
  resolve(sourceRoot, 'src/js/kkterm-v2-adapter.ts')
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

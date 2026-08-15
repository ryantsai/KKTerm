import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(process.argv[2] || process.env.OPENFLOWKIT_SRC || '');
if (!sourceRoot || !fs.existsSync(path.join(sourceRoot, 'src', 'index.tsx'))) {
  console.error('usage: node scripts/apply-adaptation.mjs <openflowkit-checkout>');
  process.exit(1);
}

function copy(localName, upstreamRelative) {
  fs.copyFileSync(path.join(moduleRoot, 'src', localName), path.join(sourceRoot, upstreamRelative));
}

copy('aiService.ts', 'src/services/aiService.ts');
copy('AISettings.tsx', 'src/components/SettingsModal/AISettings.tsx');
copy('readiness.ts', 'src/hooks/ai-generation/readiness.ts');
copy('kktermRuntime.ts', 'src/kktermRuntime.ts');

const cssPath = path.join(sourceRoot, 'src/index.css');
let css = fs.readFileSync(cssPath, 'utf8');
css = css.replace(/^@import url\('https:\/\/fonts\.googleapis\.com\/[^\n]+\n/m, '');
fs.writeFileSync(cssPath, css, 'utf8');

const serviceWorkerPath = path.join(sourceRoot, 'src/services/offline/registerAppShellServiceWorker.ts');
let serviceWorker = fs.readFileSync(serviceWorkerPath, 'utf8');
serviceWorker = serviceWorker.replace("&& 'serviceWorker' in navigator", '&& Boolean(navigator.serviceWorker)');
fs.writeFileSync(serviceWorkerPath, serviceWorker, 'utf8');

const indexPath = path.join(sourceRoot, 'src/index.tsx');
let index = fs.readFileSync(indexPath, 'utf8');
if (!index.includes("from './kktermRuntime'")) {
  index = index.replace(
    "import './index.css';",
    "import { initializeKKTermRuntime } from './kktermRuntime';\nimport './index.css';",
  );
}
if (!index.includes('initializeKKTermRuntime();')) {
  index = index.replace('initializeAnalytics();', 'initializeKKTermRuntime();\ninitializeAnalytics();');
}
index = index.replace(
  'setIsReady(true);',
  "setIsReady(true);\n          window.requestAnimationFrame(() => { void window.KKTerm.ready(); });",
);
fs.writeFileSync(indexPath, index, 'utf8');

console.log(`Applied KKTerm host-AI adaptation to ${sourceRoot}`);

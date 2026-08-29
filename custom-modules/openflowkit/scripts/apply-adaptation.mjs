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
copy('SidebarFooter.tsx', 'src/components/home/SidebarFooter.tsx');
copy('LanguageSelector.tsx', 'src/components/LanguageSelector.tsx');

const generalSettingsPath = path.join(sourceRoot, 'src/components/SettingsModal/GeneralSettings.tsx');
let generalSettings = fs.readFileSync(generalSettingsPath, 'utf8').replaceAll('\r\n', '\n');
generalSettings = generalSettings.replace(
  "import { Globe, Moon, Sun, Zap } from 'lucide-react';",
  "import { Moon, Sun, Zap } from 'lucide-react';",
);
generalSettings = generalSettings.replace(
  "import { LanguageSelector } from '@/components/LanguageSelector';\n",
  '',
);
const languageHeading = "{t('settings.language', 'Language')}";
const languageHeadingIndex = generalSettings.indexOf(languageHeading);
const languageBlockStart = generalSettings.lastIndexOf('\n      <div>', languageHeadingIndex);
const languageBlockTail = '\n      </div>\n    </div>\n  );';
const languageBlockEnd = generalSettings.indexOf(languageBlockTail, languageHeadingIndex);
if (languageHeadingIndex < 0 || languageBlockStart < 0 || languageBlockEnd < 0) {
  throw new Error('OpenFlowKit GeneralSettings language block did not match the pinned upstream source');
}
generalSettings = generalSettings.slice(0, languageBlockStart)
  + generalSettings.slice(languageBlockEnd + '\n      </div>'.length);
if (generalSettings.includes('LanguageSelector') || generalSettings.includes(languageHeading)) {
  throw new Error('OpenFlowKit independent language settings survived adaptation');
}
fs.writeFileSync(generalSettingsPath, generalSettings, 'utf8');

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
index = index.replace(
  'setIsReady(true);',
  "setIsReady(true);\n          window.requestAnimationFrame(() => { void window.KKTerm.ready(); });",
);
if (!index.includes('initializeKKTermRuntime().then')) {
  const bootstrapIndex = index.indexOf('initializeAnalytics();');
  if (bootstrapIndex < 0) {
    throw new Error('OpenFlowKit bootstrap anchor did not match the pinned upstream source');
  }
  const prefix = index.slice(0, bootstrapIndex);
  const bootstrap = index.slice(bootstrapIndex)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  index = `${prefix}void initializeKKTermRuntime().then(() => {\n${bootstrap}\n});\n`;
}
fs.writeFileSync(indexPath, index, 'utf8');

console.log(`Applied KKTerm host-AI adaptation to ${sourceRoot}`);

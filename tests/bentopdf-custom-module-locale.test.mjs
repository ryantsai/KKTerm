import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import { resolveBentoLocale } from '../custom-modules/bentopdf/src/kkterm-locale.ts';

const root = resolve(import.meta.dirname, '..');
const supported = [
  'en', 'ar', 'be', 'ru', 'fr', 'de', 'es', 'zh', 'zh-TW', 'vi', 'tr',
  'id', 'it', 'pt', 'nl', 'da', 'sv', 'ko', 'ja', 'uk', 'sk',
];

test('BentoPDF maps every KKTerm UI locale to an available translation', () => {
  const expected = {
    en: 'en',
    fr: 'fr',
    it: 'it',
    de: 'de',
    es: 'es',
    'es-MX': 'es',
    'pt-BR': 'pt',
    'zh-TW': 'zh-TW',
    'zh-CN': 'zh',
    ja: 'ja',
    ko: 'ko',
    th: 'en',
    id: 'id',
    vi: 'vi',
  };

  for (const [hostLocale, bentoLocale] of Object.entries(expected)) {
    assert.equal(resolveBentoLocale(hostLocale, supported), bentoLocale);
  }
});

test('BentoPDF locale matching handles variants and falls back to English', () => {
  assert.equal(resolveBentoLocale('zh_Hant', supported), 'zh-TW');
  assert.equal(resolveBentoLocale('zh-HK', supported), 'zh-TW');
  assert.equal(resolveBentoLocale('fr-CA', supported), 'fr');
  assert.equal(resolveBentoLocale('unknown', supported), 'en');
  assert.equal(resolveBentoLocale(undefined, supported), 'en');
});

test('BentoPDF adapter follows host context and disables independent locale navigation', async () => {
  const adapter = await readFile(
    resolve(root, 'custom-modules/bentopdf/src/kkterm-v2-adapter.ts'),
    'utf8'
  );
  const adaptation = await readFile(
    resolve(root, 'custom-modules/bentopdf/scripts/apply-adaptation.mjs'),
    'utf8'
  );

  assert.match(adapter, /window\.KKTerm\?\.context/);
  assert.match(adapter, /localStorage\.setItem\('i18nextLng', bentoLocale\)/);
  assert.match(adapter, /await i18next\.changeLanguage\(bentoLocale\)/);
  assert.match(adapter, /window\.KKTermBentoContextReady = contextReady/);
  assert.match(adaptation, /if \(kktermContextReady\) await kktermContextReady/);
  assert.match(adaptation, /injectLanguageSwitcher[\s\S]*KKTerm[\s\S]*apiVersion === 2/);
  assert.match(adaptation, /rewriteLinks[\s\S]*KKTerm[\s\S]*apiVersion === 2/);
});

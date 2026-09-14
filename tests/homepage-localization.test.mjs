import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { detectLanguage, languages } from '../www/js/homepage-language.js';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const english = JSON.parse(await read('src/i18n/locales/en.json')).homepage;
const html = await read('www/index.html');

test('homepage supports exactly the app locales with complete, synchronized translations', async () => {
  const files = (await readdir(new URL('../src/i18n/locales/', import.meta.url)))
    .filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5));
  assert.deepEqual(Object.keys(languages).sort(), files.sort());
  for (const locale of files) {
    const source = JSON.parse(await read(`src/i18n/locales/${locale}.json`)).homepage;
    const shipped = JSON.parse(await read(`www/locales/${locale}.json`));
    assert.deepEqual(shipped, source, `${locale}: run scripts/sync-homepage-locales.mjs`);
    assert.deepEqual(Object.keys(shipped), Object.keys(english), locale);
    for (const [key, value] of Object.entries(shipped)) {
      assert.equal(typeof value, 'string', `${locale}.${key}`);
      assert.ok(value.trim(), `${locale}.${key} is empty`);
      assert.deepEqual(value.match(/\{\{[^}]+\}\}/g) || [], english[key].match(/\{\{[^}]+\}\}/g) || [], `${locale}.${key}`);
      assert.ok(!/<\/?[a-z][^>]*>/i.test(value), `${locale}.${key} must be plain text`);
    }
  }
});

test('browser preferences respect order, regional matches, scripts, and English fallback', () => {
  for (const [preferences, expected] of [
    [['fr-CA', 'en-US'], 'fr'], [['nl-NL', 'ja-JP'], 'ja'],
    [['en-GB', 'de-DE'], 'en'], [['es-MX'], 'es-MX'], [['es-ES'], 'es'],
    [['es-MX-u-nu-latn'], 'es-MX'], [['pt-PT'], 'pt-BR'],
    [['zh-TW'], 'zh-TW'], [['zh-HK'], 'zh-TW'], [['zh-MO'], 'zh-TW'],
    [['zh-Hant-CN'], 'zh-TW'], [['zh-Hans-TW'], 'zh-CN'],
    [['zh-SG'], 'zh-CN'], [['zh'], 'zh-CN'], [['ZH_hant'], 'zh-TW'],
    [['ko-KR'], 'ko'], [['th-TH'], 'th'], [['vi-VN'], 'vi'],
    [['id-ID'], 'id'], [['ar', 'nl'], 'en'], [[], 'en'],
  ]) assert.equal(detectLanguage(preferences), expected, String(preferences));
});

test('homepage bindings exist, store links replace downloads, and GitHub appears only in the header', () => {
  for (const [, key] of html.matchAll(/data-i18n(?:-aria-label|-alt|-content)?="([^"]+)"/g)) {
    assert.ok(Object.hasOwn(english, key), key);
  }
  const github = [...html.matchAll(/<a\b[^>]*href="https:\/\/github\.com\/[^\"]*"[^>]*>/g)];
  assert.equal(github.length, 1);
  assert.ok(github[0].index > html.indexOf('<header'));
  assert.ok(github[0].index < html.indexOf('</header>'));
  assert.match(github[0][0], /class="nav-icon-link"/);
  assert.equal((html.match(/href="https:\/\/apps\.microsoft\.com\/detail\/9nvqc5cnwwjk"/g) || []).length, 3);
  assert.equal((html.match(/href="https:\/\/apps\.apple\.com\/app\/kkterm\/id6806710046\?mt=12"/g) || []).length, 3);
  assert.ok(!html.includes('/releases/latest'));
  assert.match(html, /<title data-i18n="pageTitle">[^<]+<\/title>/);
});

test('Taiwan homepage uses Taiwan terminology', async () => {
  const text = await read('www/locales/zh-TW.json');
  for (const forbidden of ['連接到', '終端"', '窗口', '保存', '默認', '數據', '信息', '軟件', '網絡', '鼠標', '內存', '服務器', '用戶', '遠程', '屏幕', '菜單', '搜索', '接口', '文件夾', '加載', '它们']) {
    assert.ok(!text.includes(forbidden), `Taiwan terminology: ${forbidden}`);
  }
});

test('language loading tolerates blocked storage, failed requests, and rapid selection changes', async () => {
  const pending = new Map();
  const element = (attributes = {}) => ({
    value: 'en', textContent: '',
    getAttribute: (name) => attributes[name],
    setAttribute: (name, value) => { attributes[name] = value; },
    append() {}, addEventListener() {},
  });
  const select = element();
  const heading = element({ 'data-i18n': 'heroTitle' });
  const menu = element({ 'aria-expanded': 'false' });
  const root = { lang: 'en' };
  const source = (await read('www/js/homepage.js')).replace(/^import .*;\n/, '');
  const { switchLanguage } = vm.runInNewContext(`${source}\n({ switchLanguage });`, {
    languages, detectLanguage, navigator: { languages: ['fr-CA'] },
    localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
    MutationObserver: class { observe() {} },
    document: {
      documentElement: root,
      getElementById: (id) => id === 'languageSelect' ? select : menu,
      createElement: () => element(),
      querySelectorAll: (selector) => selector === '[data-i18n]' ? [heading] : [],
    },
    fetch: (url) => new Promise((resolve, reject) => pending.set(url, { resolve, reject })),
  });
  const response = (heroTitle) => ({ ok: true, json: async () => ({ heroTitle, menuOpen: 'Menu' }) });
  // Browser detection still runs when persistent storage is unavailable.
  assert.ok(pending.has('/locales/fr.json'));
  const newer = switchLanguage('de', true);
  pending.get('/locales/de.json').resolve(response('Deutsch'));
  await newer;
  pending.get('/locales/fr.json').resolve(response('Français'));
  await new Promise(setImmediate);
  assert.equal(root.lang, 'de');
  assert.equal(heading.textContent, 'Deutsch');
  // A missing file must not blank the current page or leave the selector lying.
  const failed = switchLanguage('ja', true);
  pending.get('/locales/ja.json').reject(new Error('offline'));
  await failed;
  assert.equal(select.value, 'de');
  assert.equal(heading.textContent, 'Deutsch');
});

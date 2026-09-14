import { languages, detectLanguage } from './homepage-language.js';

const selector = document.getElementById('languageSelect');
const storageKey = 'kkterm.homepage.language';
let request = 0;
let activeLanguage = 'en';
let messages = {};
const cache = new Map();

for (const [locale, label] of Object.entries(languages)) {
  const option = document.createElement('option');
  option.value = locale;
  option.lang = locale;
  option.textContent = label;
  selector.append(option);
}

function updateMenuLabel() {
  const toggle = document.getElementById('menuToggle');
  const key = toggle.getAttribute('aria-expanded') === 'true' ? 'menuClose' : 'menuOpen';
  toggle.setAttribute('aria-label', messages[key] || (key === 'menuClose' ? 'Close menu' : 'Open menu'));
}

async function switchLanguage(locale, persist = false) {
  const current = ++request;
  try {
    if (!cache.has(locale)) {
      const response = await fetch(`/locales/${locale}.json`);
      if (!response.ok) throw new Error('Locale unavailable');
      cache.set(locale, await response.json());
    }
    if (current !== request) return;
    messages = cache.get(locale);
    for (const attribute of ['text', 'aria-label', 'alt', 'content']) {
      const binding = attribute === 'text' ? 'data-i18n' : `data-i18n-${attribute}`;
      document.querySelectorAll(`[${binding}]`).forEach((element) => {
        const value = messages[element.getAttribute(binding)];
        if (typeof value !== 'string') return;
        const translated = value.replaceAll('{{year}}', String(new Date().getFullYear()));
        if (attribute === 'text') element.textContent = translated;
        else element.setAttribute(attribute, translated);
      });
    }
    document.documentElement.lang = locale;
    activeLanguage = locale;
    selector.value = locale;
    updateMenuLabel();
    if (persist) {
      try { localStorage.setItem(storageKey, locale); } catch { /* Storage can be disabled. */ }
    }
  } catch {
    if (current !== request) return;
    selector.value = activeLanguage;
    // Keep the readable current page and allow the visitor to retry.
  }
}

new MutationObserver(updateMenuLabel).observe(document.getElementById('menuToggle'), {
  attributes: true, attributeFilter: ['aria-expanded'],
});
selector.addEventListener('change', () => switchLanguage(selector.value, true));
let saved;
try { saved = localStorage.getItem(storageKey); } catch { /* Use browser preferences. */ }
switchLanguage(Object.hasOwn(languages, saved) ? saved : detectLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]));

export const languages = {
  en: 'English', fr: 'Français', it: 'Italiano', de: 'Deutsch',
  es: 'Español', 'es-MX': 'Español (México)', 'pt-BR': 'Português (Brasil)',
  'zh-TW': '繁體中文', 'zh-CN': '简体中文', ja: '日本語', ko: '한국어',
  th: 'ไทย', id: 'Bahasa Indonesia', vi: 'Tiếng Việt',
};

export function detectLanguage(preferences) {
  for (const preference of preferences) {
    const tag = String(preference).toLowerCase().replaceAll('_', '-');
    const exact = Object.keys(languages).find((locale) => locale.toLowerCase() === tag);
    if (exact) return exact;
    const parts = tag.split('-');
    if (parts[0] === 'zh') {
      if (parts.includes('hant')) return 'zh-TW';
      if (parts.includes('hans')) return 'zh-CN';
      return parts.some((part) => ['tw', 'hk', 'mo'].includes(part)) ? 'zh-TW' : 'zh-CN';
    }
    if (parts[0] === 'es' && parts.includes('mx')) return 'es-MX';
    if (parts[0] === 'pt') return 'pt-BR';
    if (Object.hasOwn(languages, parts[0])) return parts[0];
  }
  return 'en';
}

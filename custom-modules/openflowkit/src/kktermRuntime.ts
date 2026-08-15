import i18n from '@/i18n/config';

type HostContext = { theme?: string; locale?: string };

const SUPPORTED_LOCALES = new Set(['en', 'tr', 'de', 'fr', 'es', 'zh', 'ja']);

function moduleLocale(hostLocale?: string): string {
  const normalized = String(hostLocale || 'en').replace('_', '-');
  if (normalized.toLowerCase() === 'zh-tw') return 'en';
  if (normalized.toLowerCase() === 'zh-cn') return 'zh';
  const base = normalized.split('-')[0].toLowerCase();
  return SUPPORTED_LOCALES.has(base) ? base : 'en';
}

function applyContext(context: HostContext): void {
  const theme = context.theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('openflowkit-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  void i18n.changeLanguage(moduleLocale(context.locale));
}

export function initializeKKTermRuntime(): void {
  applyContext(window.KKTerm.context);
  window.KKTerm.on('contextChanged', (detail) => applyContext(detail as HostContext));
}

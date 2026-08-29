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

async function applyContext(context: HostContext): Promise<void> {
  const theme = context.theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('openflowkit-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  await i18n.changeLanguage(moduleLocale(context.locale));
}

export async function initializeKKTermRuntime(): Promise<void> {
  const context = await window.KKTerm.getContext();
  await applyContext(context);
  window.KKTerm.on('contextChanged', (detail) => {
    void applyContext(detail as HostContext);
  });
}

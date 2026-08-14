const localeAliases: Readonly<Record<string, string>> = {
  'zh-cn': 'zh',
  'zh-sg': 'zh',
  'zh-hans': 'zh',
  'zh-tw': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
  'zh-hant': 'zh-TW',
  'pt-br': 'pt',
};

export function resolveBentoLocale(
  hostLocale: string | undefined,
  supportedLocales: readonly string[]
): string {
  const supportedByLowercase = new Map(
    supportedLocales.map((locale) => [locale.toLowerCase(), locale])
  );
  const normalized = hostLocale?.trim().replaceAll('_', '-') ?? '';
  const lowercase = normalized.toLowerCase();

  const alias = localeAliases[lowercase];
  if (alias) {
    const supportedAlias = supportedByLowercase.get(alias.toLowerCase());
    if (supportedAlias) return supportedAlias;
  }

  const exact = supportedByLowercase.get(lowercase);
  if (exact) return exact;

  const base = supportedByLowercase.get(lowercase.split('-')[0]);
  return base ?? supportedByLowercase.get('en') ?? 'en';
}

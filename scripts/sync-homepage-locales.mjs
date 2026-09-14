import { readFile, writeFile } from 'node:fs/promises';
import { languages } from '../www/js/homepage-language.js';

// Ship only homepage copy to the static website, not the desktop app dictionary.
for (const locale of Object.keys(languages)) {
  const source = JSON.parse(await readFile(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'));
  await writeFile(new URL(`../www/locales/${locale}.json`, import.meta.url), `${JSON.stringify(source.homepage, null, 2)}\n`);
}

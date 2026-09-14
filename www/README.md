# KKTerm homepage

`index.html` is the static English fallback. `js/homepage.js` loads one of the
14 app languages from `locales/` and translates text, accessible names, image
descriptions, and metadata without inserting HTML from translations.

The header selector remembers an explicit choice in `kkterm.homepage.language`.
On first visit, browser language preferences are checked in order. Regional
variants map to supported locales, including Traditional Chinese for Taiwan,
Hong Kong, Macao, and Hant; Simplified Chinese for Hans; and Mexican Spanish.
Unsupported languages fall back to English. Blocked storage and failed locale
requests leave the page usable. The desktop language preference is separate.

English copy lives under `homepage` in `src/i18n/locales/en.json`. Follow
`docs/localization_todo/README.md` for changes. After editing app locale files,
run `node scripts/sync-homepage-locales.mjs` to update the website dictionaries.
Keep the English HTML fallback in sync. The homepage does not translate the
separate support, privacy, or legal pages, or text embedded in screenshots.

Validate with `node --test tests/homepage-localization.test.mjs` and
`pnpm run i18n:check`. Preview using `python -m http.server 4173 --directory www`.
The Cloudflare configuration is `cloudflare/release-worker/wrangler.jsonc`;
the existing Deploy Landing Site workflow publishes these static assets.
Homepage download buttons go to Microsoft Store and Mac App Store. The sole
GitHub link stays in the top-right header on desktop and mobile.

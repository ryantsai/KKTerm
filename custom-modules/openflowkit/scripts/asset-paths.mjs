const ASSET_EXTENSION = '(?:avif|bmp|gif|ico|jpe?g|json|otf|png|svg|ttf|wasm|webp|woff2?)';
const QUOTED_ROOT_ASSET = new RegExp(
  "([\"'`])(\\/(?!\\/)[^\"'`\\s?#]+?\\." + ASSET_EXTENSION + "(?:[?#][^\"'`]*)?)\\1",
  'gi',
);
const CSS_ROOT_ASSET = new RegExp(
  `(url\\(\\s*)(\\/(?!\\/)[^)'"\\s?#]+?\\.${ASSET_EXTENSION}(?:[?#][^)'"\\s]*)?)(\\s*\\))`,
  'gi',
);

export function findRootAbsolutePackagedAssetUrls(source, isPackagedAsset = () => true) {
  const urls = [];
  for (const match of source.matchAll(QUOTED_ROOT_ASSET)) {
    if (isPackagedAsset(match[2])) urls.push(match[2]);
  }
  for (const match of source.matchAll(CSS_ROOT_ASSET)) {
    if (isPackagedAsset(match[2])) urls.push(match[2]);
  }
  return [...new Set(urls)];
}

export function rewriteRootAbsolutePackagedAssetUrls(source, isPackagedAsset = () => true) {
  const quoted = source.replace(QUOTED_ROOT_ASSET, (match, quote, url) => (
    isPackagedAsset(url) ? `${quote}.${url}${quote}` : match
  ));
  return quoted.replace(CSS_ROOT_ASSET, (match, prefix, url, suffix) => (
    isPackagedAsset(url) ? `${prefix}.${url}${suffix}` : match
  ));
}

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findRootAbsolutePackagedAssetUrls,
  rewriteRootAbsolutePackagedAssetUrls,
} from '../custom-modules/openflowkit/scripts/asset-paths.mjs';

test('OpenFlowKit rewrites packaged image URLs without changing app routes or remote URLs', () => {
  const source = [
    'const logo = "/favicon.svg";',
    "const flag = '/flags/us.svg';",
    'const route = "/docs/en/prompting-agents";',
    'const remote = "https://example.com/logo.svg";',
  ].join('\n');

  const rewritten = rewriteRootAbsolutePackagedAssetUrls(source);

  assert.match(rewritten, /"\.\/favicon\.svg"/);
  assert.match(rewritten, /'\.\/flags\/us\.svg'/);
  assert.match(rewritten, /"\/docs\/en\/prompting-agents"/);
  assert.match(rewritten, /"https:\/\/example\.com\/logo\.svg"/);
  assert.deepEqual(findRootAbsolutePackagedAssetUrls(rewritten), []);
});

test('OpenFlowKit reports every root-absolute packaged asset URL in a compiled bundle', () => {
  assert.deepEqual(
    findRootAbsolutePackagedAssetUrls('a="/favicon.svg";b=`/flags/tw.svg`;c="./ok.svg"'),
    ['/favicon.svg', '/flags/tw.svg'],
  );
});

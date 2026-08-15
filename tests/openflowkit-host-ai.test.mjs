import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OpenFlowKit uses KKTerm host AI and routes provider settings to the host', async () => {
  const [manifestText, service, settings, readiness, runtime, adaptation, build] = await Promise.all([
    readFile(new URL('../custom-modules/openflowkit/kkterm-extension.json', import.meta.url), 'utf8'),
    readFile(new URL('../custom-modules/openflowkit/src/aiService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../custom-modules/openflowkit/src/AISettings.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../custom-modules/openflowkit/src/readiness.ts', import.meta.url), 'utf8'),
    readFile(new URL('../custom-modules/openflowkit/src/kktermRuntime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../custom-modules/openflowkit/scripts/apply-adaptation.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../custom-modules/openflowkit/scripts/build-dist.mjs', import.meta.url), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.version, '0.2.0');
  assert.equal(manifest.permissions.hostAi, true);
  assert.equal(manifest.permissions.networkFetch, undefined);
  assert.match(service, /window\.KKTerm\.ai\.open\(request\)/);
  assert.match(service, /window\.KKTerm\.ai\.read\(token\)/);
  assert.match(service, /window\.KKTerm\.ai\.cancel\(token\)/);
  assert.doesNotMatch(service, /fetch\(/);
  assert.doesNotMatch(service, /Authorization|x-api-key/);
  assert.match(settings, /window\.KKTerm\.ai\.openSettings\(\)/);
  assert.match(settings, /Provider credentials remain in KKTerm/);
  assert.match(readiness, /canGenerate: true/);
  assert.match(runtime, /window\.KKTerm\.on\('contextChanged'/);
  assert.match(runtime, /zh-tw'\) return 'en'/);
  assert.match(adaptation, /setIsReady\(true\);/);
  assert.match(adaptation, /window\.KKTerm\.ready\(\)/);
  assert.match(build, /KKTerm host-AI adapter is missing/);
});

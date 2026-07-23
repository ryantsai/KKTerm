import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScriptModule(path) {
  const source = await readFile(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      verbatimModuleSyntax: true,
    },
  });
  return import(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled.outputText)}`
  );
}

test("Install Helper automatic checks stay throttled across app relaunches", async () => {
  const { shouldRunInstallerAutomaticCheck } = await importTypeScriptModule(
    new URL("../src/modules/installer/checkInterval.ts", import.meta.url),
  );
  const checkedAt = Date.UTC(2026, 6, 24, 8) / 1000;

  assert.equal(
    shouldRunInstallerAutomaticCheck({
      lastCheckAt: checkedAt,
      intervalSeconds: 3600,
      nowSeconds: checkedAt + 5 * 60,
    }),
    false,
    "a fresh persisted timestamp must suppress the relaunch sweep",
  );
  assert.equal(
    shouldRunInstallerAutomaticCheck({
      lastCheckAt: checkedAt,
      intervalSeconds: 3600,
      nowSeconds: checkedAt + 3600,
    }),
    true,
    "the automatic sweep should resume when the interval expires",
  );
  assert.equal(
    shouldRunInstallerAutomaticCheck({
      lastCheckAt: null,
      intervalSeconds: 3600,
      nowSeconds: checkedAt,
    }),
    true,
    "first use should still run an automatic sweep",
  );
});

test("Install Helper gates detection before starting its relaunch sweep", async () => {
  const source = await readFile(
    new URL("../src/modules/installer/InstallerPage.tsx", import.meta.url),
    "utf8",
  );
  const activationEffect = source.slice(
    source.indexOf("const activationHandled"),
    source.indexOf("async function handleRefresh"),
  );
  const intervalDecision = activationEffect.indexOf(
    "shouldRunInstallerAutomaticCheck",
  );
  const detectionStart = activationEffect.indexOf(
    'invokeCommand("installer_detect_all_streaming")',
  );

  assert.notEqual(intervalDecision, -1);
  assert.notEqual(detectionStart, -1);
  assert.ok(
    intervalDecision < detectionStart,
    "the persisted interval decision must happen before automatic detection",
  );
});

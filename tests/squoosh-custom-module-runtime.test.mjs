import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeUrl = new URL("../custom-modules/squoosh/src/kkterm-runtime.js", import.meta.url);
const buildUrl = new URL("../custom-modules/squoosh/scripts/build-dist.mjs", import.meta.url);

test("Squoosh signals readiness through a packaged lifecycle adapter", async () => {
  const [runtime, build] = await Promise.all([
    readFile(runtimeUrl, "utf8"),
    readFile(buildUrl, "utf8"),
  ]);

  assert.match(runtime, /host\.getContext\(\)/);
  assert.match(runtime, /host\.getCapabilities\(\)/);
  assert.match(runtime, /host\.ready\(\)/);
  for (const event of [
    "contextChanged",
    "visibilityChanged",
    "focusChanged",
    "suspending",
    "closing",
  ]) {
    assert.match(runtime, new RegExp(`host\\.on\\(["']${event}["']`));
  }
  assert.match(build, /src["'], ["']kkterm-runtime\.js/);
  assert.match(build, /<script src="\.\/kkterm-runtime\.js"><\/script>/);
  assert.match(build, /html = html\.replace\(inlineScript,[\s\S]*html = html\.replaceAll\(runtimeTag, ""\)/);
  assert.match(build, /\(\?<!\\\/dist\)\\\/c\\\//);
});

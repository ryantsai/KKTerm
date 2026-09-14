import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("terminal outside-pointer repair cannot override command chrome focus", async () => {
  const source = await readFile(new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("function handleExternalPointerDown"), source.indexOf('document.addEventListener("pointerdown", handleExternalPointerDown'));
  assert.match(handler, /isContentFocusPreservingTarget\(target\)\)\s*\{\s*return;/);
  assert.ok(handler.indexOf("isContentFocusPreservingTarget") < handler.indexOf("renderer.blur()"));
});

test("all app-window routes install and clean up the shared pointer focus policy", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(source, /const removeChromeFocusPolicy = installChromeFocusPolicy\(\)/);
  assert.match(source, /import\.meta\.hot\?\.dispose\(removeChromeFocusPolicy\)/);
});

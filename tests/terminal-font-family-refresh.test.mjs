import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mounted terminal renderers refresh family metrics after settings or custom fonts change", async () => {
  const [rendererSource, workspaceSource] = await Promise.all([
    readFile(new URL("../src/modules/workspace/connections/terminal/renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(rendererSource, /setFontFamily: \(family: string\) => void;/);
  assert.match(
    rendererSource,
    /setFontFamily\(family: string\)[\s\S]*terminal\.options\.fontFamily = family;[\s\S]*scheduleTerminalFontAtlasRefresh\("font-family-change"\)/,
  );
  assert.doesNotMatch(
    rendererSource.match(/setFontFamily\(family: string\)[\s\S]*?\n  \}/)?.[0] ?? "",
    /clearTextureAtlas\(\)/,
  );
  assert.match(rendererSource, /this\.terminal\.open\(element\);[\s\S]*this\.enableWebglWhenFontsReady\(\);/);
  assert.match(
    rendererSource,
    /await document\.fonts\.load\(`\$\{size\}px \$\{family\}`\);[\s\S]*await document\.fonts\.ready;/,
  );
  assert.match(
    rendererSource,
    /releaseFontAtlas\(\)[\s\S]*this\.disposeWebglAddon\(\);[\s\S]*restoreFontAtlas\(wasWebglEnabled: boolean\)/,
  );
  assert.match(
    workspaceSource,
    /terminalRendererRef\.current\?\.setFontFamily\(terminalSettings\.fontFamily\);[\s\S]*fitAndResizeRef\.current\(\);[\s\S]*\[terminalSettings\.fontFamily\]/,
  );
  assert.match(workspaceSource, /CUSTOM_FONTS_LOADED_EVENT/);
  assert.match(workspaceSource, /scheduleTerminalFontAtlasRefresh\("custom-fonts-loaded"\)/);
  assert.match(workspaceSource, /logTerminalFontAtlasState\("tab-activated"\)/);
});

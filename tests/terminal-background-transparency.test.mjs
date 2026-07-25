import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = await readFile(
  new URL("../src/modules/workspace/connections/terminal/renderer.ts", import.meta.url),
  "utf8",
);
const terminalWorkspace = await readFile(
  new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
  "utf8",
);
const terminalCss = await readFile(
  new URL("../src/modules/workspace/connections/terminal/terminal.css", import.meta.url),
  "utf8",
);
const englishLocale = await readFile(
  new URL("../src/i18n/locales/en.json", import.meta.url),
  "utf8",
);

test("terminal renderer allows connection background transparency", () => {
  assert.match(
    rendererSource,
    /allowTransparency:\s*true/,
    "xterm must opt in before Terminal.open so rgba theme backgrounds reveal pane backgrounds",
  );
  assert.match(
    rendererSource,
    /background:\s*schemeBackgroundColor\(scheme,\s*backgroundOpacity\)/,
    "terminal opacity should continue to drive the xterm rgba theme background",
  );
});

test("terminal xterm viewport does not mask connection backgrounds", () => {
  assert.match(
    terminalCss,
    /\.xterm-host\s+\.xterm\s+\.xterm-viewport\s*\{[\s\S]*background-color:\s*transparent;/,
    "xterm's packaged black viewport background must stay transparent in KKTerm panes",
  );
});

test("terminal padding ring matches xterm opacity without double-compositing the content", () => {
  assert.match(
    terminalCss,
    /\.xterm-host\s*\{[^}]*background:\s*transparent;/,
    "the host must stay transparent so xterm content is not composited over the same RGBA layer twice",
  );
  assert.match(
    terminalCss,
    /\.xterm-host::before\s*\{[^}]*border:\s*8px solid var\(--terminal-surface-background/,
    "a non-overlapping ring should paint the xterm padding with the same RGBA terminal surface",
  );
  assert.match(
    rendererSource,
    /"--terminal-surface-background",\s*schemeBackgroundColor\(this\.colorScheme,\s*opacity\)/,
    "the padding ring must follow the same opacity as the xterm theme background",
  );
});

test("terminal appearance menu presents transparency while storing opacity", () => {
  assert.match(englishLocale, /"opacity":\s*"Transparency"/);
  assert.match(englishLocale, /"opacityValue":\s*"\{\{value\}\}% transparency"/);
  assert.match(
    terminalWorkspace,
    /const terminalTransparency = 100 - terminalOpacity;/,
    "the UI slider should show user-facing transparency, not the persisted opacity value",
  );
  assert.match(
    terminalWorkspace,
    /void saveTerminalAppearance\(100 - Number\(value\)\);/,
    "the transparency slider must invert the value before saving terminalOpacity",
  );
  assert.match(
    terminalWorkspace,
    /pane\.childConnectionId[\s\S]*updateOpenTerminalPaneAppearance\(tabId,\s*pane\.id,\s*appearance\)/,
    "Child Connection Tabs should save terminal opacity as child pane appearance instead of rewriting the parent Connection",
  );
});

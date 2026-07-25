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
    /background:\s*schemeBackgroundColor\(scheme,\s*0\)/,
    "xterm's canvas must stay transparent so the host is the only opacity layer",
  );
});

test("terminal xterm viewport does not mask connection backgrounds", () => {
  assert.match(
    terminalCss,
    /\.xterm-host\s+\.xterm\s+\.xterm-viewport\s*\{[\s\S]*background-color:\s*transparent;/,
    "xterm's packaged black viewport background must stay transparent in KKTerm panes",
  );
});

test("terminal host owns one edge-to-edge opacity layer", () => {
  assert.match(
    terminalCss,
    /\.xterm-host\s*\{[^}]*background:\s*var\(--terminal-surface-background/,
    "the host must paint the text inset and unused row space with the terminal surface background",
  );
  assert.doesNotMatch(
    terminalCss,
    /\.xterm-host::before\s*\{/,
    "a fixed padding ring cannot cover xterm's variable unused row space",
  );
  assert.match(
    rendererSource,
    /"--terminal-surface-background",\s*schemeBackgroundColor\(this\.colorScheme,\s*opacity\)/,
    "the full-size host background must follow the configured terminal opacity",
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
    /targetPane\.childConnectionId[\s\S]*updateOpenTerminalPaneAppearance\(tabId,\s*targetPane\.id,\s*appearance\)/,
    "Child Connection Tabs, including a shared-background owner, should save appearance on the target child Pane instead of rewriting the parent Connection",
  );
});

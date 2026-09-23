import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile("src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", "utf8");

test("terminal pane toolbar renders the connection glyph before the title", () => {
  assert.match(source, /import \{ ConnectionGlyph \} from "\.\.\/ConnectionGlyph";/);
  assert.match(source, /<span\s+className="terminal-pane-title"/);
  assert.match(source, /<ConnectionGlyph[\s\S]*className="terminal-pane-connection-icon"[\s\S]*iconBackgroundColor=\{pane\.connection\.iconBackgroundColor\}[\s\S]*iconDataUrl=\{pane\.connection\.iconDataUrl\}[\s\S]*localShell=\{pane\.connection\.localShell\}[\s\S]*size=\{18\}[\s\S]*type=\{pane\.connection\.type\}/);
});

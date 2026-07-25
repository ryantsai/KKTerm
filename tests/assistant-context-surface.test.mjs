import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(
  new URL("../src/ai/AssistantPanel.tsx", import.meta.url),
  "utf8",
);
const assistantCss = await readFile(
  new URL("../src/ai/assistant.css", import.meta.url),
  "utf8",
);
const assistantManual = await readFile(
  new URL("../docs/manual/13-ai-assistant.md", import.meta.url),
  "utf8",
);

test("assistant context rail reveals changed context with compact hierarchy", () => {
  assert.match(panelSource, /className="assistant-context-icon"/);
  assert.match(panelSource, /className="assistant-context-title-text"/);
  assert.match(panelSource, /className="assistant-context-detail-text"/);
  assert.match(
    assistantCss,
    /\.active-session-hint \{[\s\S]*?min-height: 44px;[\s\S]*?box-shadow: inset 2px 0 0/,
  );
});

test("assistant composer context uses compact token-based attachment shelves", () => {
  assert.match(panelSource, /className="assistant-selection-context-heading"/);
  assert.match(
    assistantCss,
    /\.assistant-screenshot-context \{[\s\S]*?grid-template-columns: 72px minmax\(0, 1fr\)/,
  );
  assert.match(
    assistantCss,
    /\.assistant-attachment-preview-grid \{[\s\S]*?display: flex;[\s\S]*?overflow-x: auto;/,
  );
  assert.match(
    assistantCss,
    /\.assistant-attachment-remove \{[\s\S]*?color: var\(--terminal-fg\);/,
  );
  assert.match(assistantManual, /compact context rail/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const kineticSource = await readFile(
  new URL("../src/ai/AssistantKineticText.tsx", import.meta.url),
  "utf8",
);
const workPanelSource = await readFile(
  new URL("../src/ai/AssistantWorkPanel.tsx", import.meta.url),
  "utf8",
);
const panelSource = await readFile(
  new URL("../src/ai/AssistantPanel.tsx", import.meta.url),
  "utf8",
);
const assistantCss = await readFile(
  new URL("../src/ai/assistant.css", import.meta.url),
  "utf8",
);
const componentryLicense = await readFile(
  new URL("../docs/licenses/componentry-mit.txt", import.meta.url),
  "utf8",
);

test("assistant progress states use the accessible Componentry-derived kinetic text", () => {
  assert.match(kineticSource, /Adapted from Componentry's Kinetic Text Reveal/);
  assert.match(kineticSource, /useReducedMotion/);
  assert.match(kineticSource, /aria-label=\{text\}/);
  assert.match(kineticSource, /aria-hidden="true"/);
  assert.match(workPanelSource, /<AssistantKineticText[\s\S]*tone="skill"/);
  assert.match(workPanelSource, /<AssistantKineticText[\s\S]*tone="tool"/);
  assert.match(panelSource, /<AssistantKineticText active text=\{t\("ai\.preparingResponse"\)\}/);
  assert.match(componentryLicense, /Kinetic Text Reveal/);
});

test("assistant kinetic status motion has an explicit reduced-motion fallback", () => {
  assert.match(assistantCss, /@keyframes assistant-status-text-sweep/);
  assert.match(assistantCss, /@keyframes assistant-waiting-dot/);
  assert.match(
    assistantCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.assistant-kinetic-text/,
  );
  assert.match(
    assistantCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.assistant-waiting-dots/,
  );
});

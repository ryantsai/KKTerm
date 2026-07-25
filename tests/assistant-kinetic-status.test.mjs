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
  assert.match(kineticSource, /Componentry's Kinetic Text Reveal and Text Repel/);
  assert.match(kineticSource, /useReducedMotion/);
  assert.match(kineticSource, /aria-label=\{text\}/);
  assert.match(kineticSource, /aria-hidden="true"/);
  assert.match(kineticSource, /useSpring/);
  assert.match(kineticSource, /data-text-repel=\{shouldRepel \? true : undefined\}/);
  assert.match(workPanelSource, /repel=\{Boolean\(message\.isStreaming\)/);
  assert.match(workPanelSource, /<AssistantKineticText[\s\S]*tone="skill"/);
  assert.match(workPanelSource, /<AssistantKineticText[\s\S]*tone="tool"/);
  assert.match(panelSource, /<AssistantKineticText active repel text=\{t\("ai\.preparingResponse"\)\}/);
  assert.match(componentryLicense, /Kinetic Text Reveal, and Text Repel/);
});

test("assistant waiting phrase cycles always select a different phrase", () => {
  assert.match(
    workPanelSource,
    /setWaitingPhrase\(\(currentPhrase\) => randomAssistantWaitingPhrase\(currentPhrase\)\)/,
  );
  assert.match(workPanelSource, /phrases\.filter\(\(phrase\) => phrase !== previousPhrase\)/);
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
  assert.match(kineticSource, /const shouldRepel = repel && !shouldReduceMotion/);
});

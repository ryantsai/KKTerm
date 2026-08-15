import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ASSISTANT_COMPOSER_MAC_IME_ENTER_GRACE_MS,
  shouldSuppressAssistantComposerEnter,
} from "../src/ai/assistantComposer.ts";

const enterEvent = (overrides: Partial<KeyboardEvent> = {}) =>
  ({
    isComposing: false,
    key: "Enter",
    keyCode: 13,
    ...overrides,
  }) as KeyboardEvent;

test("Assistant composer keeps IME candidate confirmation from submitting", () => {
  assert.equal(shouldSuppressAssistantComposerEnter(enterEvent({ isComposing: true })), true);
  assert.equal(shouldSuppressAssistantComposerEnter(enterEvent(), true), true);
  assert.equal(shouldSuppressAssistantComposerEnter(enterEvent({ keyCode: 229 })), true);
  assert.equal(shouldSuppressAssistantComposerEnter(enterEvent()), false);
  assert.equal(
    shouldSuppressAssistantComposerEnter(enterEvent({ key: "a" })),
    false,
  );
});

test("Assistant composer covers macOS WebKit's reversed composition event order", () => {
  const compositionEndedAt = 1_000;
  assert.equal(
    shouldSuppressAssistantComposerEnter(
      enterEvent(),
      false,
      compositionEndedAt,
      compositionEndedAt + ASSISTANT_COMPOSER_MAC_IME_ENTER_GRACE_MS - 1,
      true,
    ),
    true,
  );
  assert.equal(
    shouldSuppressAssistantComposerEnter(
      enterEvent(),
      false,
      compositionEndedAt,
      compositionEndedAt + ASSISTANT_COMPOSER_MAC_IME_ENTER_GRACE_MS,
      true,
    ),
    false,
  );
  assert.equal(
    shouldSuppressAssistantComposerEnter(
      enterEvent(),
      false,
      compositionEndedAt,
      compositionEndedAt + 1,
      false,
    ),
    false,
  );
});

test("Assistant composer wires composition lifecycle events to the Enter guard", async () => {
  const source = await readFile(new URL("../src/ai/AssistantPanel.tsx", import.meta.url), "utf8");
  const textarea = source.match(/<textarea[\s\S]*?\/>/)?.[0] ?? "";

  assert.match(source, /shouldSuppressAssistantComposerEnter\(\s*event\.nativeEvent/);
  assert.match(textarea, /onCompositionStart=\{handleComposerCompositionStart\}/);
  assert.match(textarea, /onCompositionEnd=\{handleComposerCompositionEnd\}/);
});

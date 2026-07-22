import assert from "node:assert/strict";
import test from "node:test";

import {
  appendMacImeRawKey,
  macImeRawKey,
  resolveMacImeCompositionCommit,
  shouldSuppressMacImeCompositionKey,
} from "../src/modules/workspace/connections/terminal/imeInput.ts";

const printableKey = (key: string) => ({
  altKey: false,
  ctrlKey: false,
  isComposing: true,
  key,
  metaKey: false,
  type: "keydown",
});

test("macOS composing keydowns are kept out of xterm key handling", () => {
  assert.equal(
    shouldSuppressMacImeCompositionKey(
      printableKey("n"),
      false,
      true,
    ),
    true,
  );
  assert.equal(
    shouldSuppressMacImeCompositionKey(
      { ...printableKey("n"), isComposing: false },
      true,
      true,
    ),
    true,
  );
});

test("the IME workaround leaves non-composing keys and other platforms unchanged", () => {
  assert.equal(
    shouldSuppressMacImeCompositionKey(
      { ...printableKey("n"), type: "keyup" },
      true,
      true,
    ),
    false,
  );
  assert.equal(
    shouldSuppressMacImeCompositionKey(
      printableKey("n"),
      true,
      false,
    ),
    false,
  );
  assert.equal(
    shouldSuppressMacImeCompositionKey(
      { ...printableKey("n"), isComposing: false },
      false,
      true,
    ),
    false,
  );
});

test("macOS composition input records unmodified printable keys", () => {
  assert.equal(macImeRawKey(printableKey("n"), true), "n");
  assert.equal(appendMacImeRawKey("niha", printableKey("o"), true, true), "nihao");
  assert.equal(
    appendMacImeRawKey("ni", { ...printableKey("h"), metaKey: true }, true, true),
    "ni",
  );
  assert.equal(appendMacImeRawKey("ni", printableKey("h"), false, true), "ni");
  assert.equal(appendMacImeRawKey("ni", printableKey("h"), true, false), "ni");
});

test("macOS composition commits remove only IME-inserted whitespace", () => {
  assert.equal(resolveMacImeCompositionCommit("ni hao", "ni hao", "nihao"), "nihao");
  assert.equal(resolveMacImeCompositionCommit("ni hao", "ni hao", "ni hao"), "ni hao");
  assert.equal(resolveMacImeCompositionCommit("stale text", "你好", "nihao"), "你好");
  assert.equal(resolveMacImeCompositionCommit("Hello", "Hello", "hello"), "Hello");
  assert.equal(resolveMacImeCompositionCommit("stale text", ""), "");
  assert.equal(resolveMacImeCompositionCommit("fallback text"), "fallback text");
});

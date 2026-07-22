import assert from "node:assert/strict";
import test from "node:test";

import { shouldSuppressMacImeSwitchKey } from "../src/modules/workspace/connections/terminal/imeInput.ts";

test("macOS Caps Lock input-source switches are kept out of xterm composition handling", () => {
  assert.equal(
    shouldSuppressMacImeSwitchKey({ code: "CapsLock", key: "CapsLock" }, true),
    true,
  );
  assert.equal(
    shouldSuppressMacImeSwitchKey({ code: "CapsLock", key: "Unidentified" }, true),
    true,
  );
});

test("the IME workaround leaves other keys and platforms unchanged", () => {
  assert.equal(shouldSuppressMacImeSwitchKey({ code: "KeyA", key: "a" }, true), false);
  assert.equal(
    shouldSuppressMacImeSwitchKey({ code: "CapsLock", key: "CapsLock" }, false),
    false,
  );
});

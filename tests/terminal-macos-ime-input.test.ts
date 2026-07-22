import assert from "node:assert/strict";
import test from "node:test";

import { shouldSuppressMacImeSwitchKey } from "../src/modules/workspace/connections/terminal/imeInput.ts";

test("macOS Caps Lock input-source switches are kept out of xterm composition handling", () => {
  assert.equal(
    shouldSuppressMacImeSwitchKey(
      { code: "CapsLock", key: "CapsLock", keyCode: 20, type: "keydown" },
      false,
      true,
    ),
    true,
  );
  assert.equal(
    shouldSuppressMacImeSwitchKey(
      { code: "CapsLock", key: "Unidentified", keyCode: 20, type: "keydown" },
      false,
      true,
    ),
    true,
  );
  assert.equal(
    shouldSuppressMacImeSwitchKey(
      { code: "", key: "Unidentified", keyCode: 0, type: "keydown" },
      true,
      true,
    ),
    true,
  );
});

test("the IME workaround leaves other keys and platforms unchanged", () => {
  assert.equal(
    shouldSuppressMacImeSwitchKey(
      { code: "KeyA", key: "a", keyCode: 0, type: "keydown" },
      true,
      true,
    ),
    false,
  );
  assert.equal(
    shouldSuppressMacImeSwitchKey(
      { code: "", key: "Unidentified", keyCode: 0, type: "keydown" },
      false,
      true,
    ),
    false,
  );
  assert.equal(
    shouldSuppressMacImeSwitchKey(
      { code: "CapsLock", key: "CapsLock", keyCode: 20, type: "keydown" },
      true,
      false,
    ),
    false,
  );
});

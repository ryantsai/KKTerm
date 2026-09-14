import assert from "node:assert/strict";
import test from "node:test";
import { waitForCaptureDelay } from "../src/modules/screenshots/captureDelay";

test("Esc cancels a pending capture without starting it later", async (t) => {
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  t.after(() => Reflect.deleteProperty(globalThis, "window"));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const remove = t.mock.method(events, "removeEventListener");
  let started = false;
  const capture = waitForCaptureDelay(3).then(() => { started = true; });
  const rejection = assert.rejects(capture, /capture canceled/);
  const escape = new Event("keydown", { cancelable: true });
  Object.defineProperty(escape, "key", { value: "Escape" });
  events.dispatchEvent(escape);
  await rejection;
  assert.equal(escape.defaultPrevented, true);
  assert.equal(remove.mock.callCount(), 1);
  t.mock.timers.tick(5000);
  assert.equal(started, false);
});

test("capture starts after its delay and removes the Esc listener", async (t) => {
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  t.after(() => Reflect.deleteProperty(globalThis, "window"));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const remove = t.mock.method(events, "removeEventListener");
  let started = false;
  const capture = waitForCaptureDelay(3).then(() => { started = true; });
  const otherKey = new Event("keydown", { cancelable: true });
  Object.defineProperty(otherKey, "key", { value: "Enter" });
  events.dispatchEvent(otherKey);
  assert.equal(otherKey.defaultPrevented, false);
  t.mock.timers.tick(2999);
  await Promise.resolve();
  assert.equal(started, false);
  t.mock.timers.tick(1);
  await capture;
  assert.equal(started, true);
  assert.equal(remove.mock.callCount(), 1);
});

test("instant capture does not install an Esc listener", async () => {
  // There is deliberately no window in this test.
  await waitForCaptureDelay(0);
});

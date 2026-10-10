import assert from "node:assert/strict";
import test from "node:test";
import {
  RDP_FULLSCREEN_SETTLE_DELAYS_MS,
  startRdpFullscreenDisplaySettle,
} from "../src/modules/workspace/connections/remote-desktop/rdpStartupFullscreen";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeTimers() {
  let nextHandle = 1;
  const pending = new Map<number, { callback: () => void; delayMs: number }>();
  const delays: number[] = [];
  return {
    schedule: (callback: () => void, delayMs: number) => {
      const handle = nextHandle++;
      pending.set(handle, { callback, delayMs });
      delays.push(delayMs);
      return handle;
    },
    cancel: (handle: unknown) => { pending.delete(handle as number); },
    pending: () => pending.size,
    delays,
    async fire() {
      const [handle, timer] = [...pending.entries()][0];
      pending.delete(handle);
      timer.callback();
      await flush();
    },
  };
}

function settle(overrides: {
  isCurrent?: () => boolean;
  canReassert?: () => boolean;
  reassert?: () => Promise<unknown>;
} = {}) {
  const timers = fakeTimers();
  let calls = 0;
  const stop = startRdpFullscreenDisplaySettle({
    isCurrent: overrides.isCurrent ?? (() => true),
    canReassert: overrides.canReassert ?? (() => true),
    reassert: async () => { calls += 1; await overrides.reassert?.(); },
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  return { timers, stop, calls: () => calls };
}

test("the schedule backs off and outlasts the connect-time settle window", () => {
  const delays = RDP_FULLSCREEN_SETTLE_DELAYS_MS;
  assert.ok(delays[0] <= 1000, "the first re-assertion must follow entry quickly");
  for (let index = 1; index < delays.length; index += 1) {
    assert.ok(delays[index] >= delays[index - 1], "delays must not shrink");
  }
  const total = delays.reduce((sum, delay) => sum + delay, 0);
  // The connect-time settle gives up after roughly four seconds of accepted passes.
  assert.ok(total >= 25_000, `expected a horizon of at least 25s, got ${total}ms`);
});

test("every scheduled pass re-asserts once, in order, then the schedule ends", async () => {
  const session = settle();
  for (let pass = 0; pass < RDP_FULLSCREEN_SETTLE_DELAYS_MS.length; pass += 1) {
    assert.equal(session.timers.pending(), 1);
    await session.timers.fire();
    assert.equal(session.calls(), pass + 1);
  }
  assert.equal(session.timers.pending(), 0);
  assert.deepEqual(session.timers.delays, [...RDP_FULLSCREEN_SETTLE_DELAYS_MS]);
});

test("a rejected pass does not end the schedule", async () => {
  const session = settle({ reassert: async () => { throw new Error("server ignored the update"); } });
  await session.timers.fire();
  await session.timers.fire();
  assert.equal(session.calls(), 2);
  assert.equal(session.timers.pending(), 1);
});

test("a hidden or covered surface skips the pass without abandoning the schedule", async () => {
  let ready = false;
  const session = settle({ canReassert: () => ready });
  await session.timers.fire();
  assert.equal(session.calls(), 0);
  assert.equal(session.timers.pending(), 1);
  ready = true;
  await session.timers.fire();
  assert.equal(session.calls(), 1);
});

test("a finished Session ends the schedule without another native call", async () => {
  let current = true;
  const session = settle({ isCurrent: () => current });
  await session.timers.fire();
  current = false;
  await session.timers.fire();
  assert.equal(session.calls(), 1);
  assert.equal(session.timers.pending(), 0);
});

test("stopping cancels the pending pass and a late reply cannot re-arm it", async () => {
  let release!: () => void;
  const session = settle({ reassert: () => new Promise<void>((resolve) => { release = resolve; }) });
  session.timers.fire();
  await flush();
  session.stop();
  release();
  await flush();
  assert.equal(session.calls(), 1);
  assert.equal(session.timers.pending(), 0);

  const idle = settle();
  idle.stop();
  assert.equal(idle.timers.pending(), 0);
  assert.equal(idle.calls(), 0);
});

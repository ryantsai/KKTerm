import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalStartupState } from "../src/modules/workspace/connections/terminal/terminalStartupState";

test("X11 rejection replaces optimistic status regardless of startup response order", () => {
  for (const readyFirst of [false, true]) {
    const updates: string[] = [];
    const state = createTerminalStartupState("active", (status) => updates.push(status));
    const ready = { sessionId: "active", x11ForwardingStatus: "rejected" as const };
    if (readyFirst) state.ready(ready);
    state.started({ sessionId: "active" }, "enabled");
    if (!readyFirst) state.ready(ready);
    assert.equal(updates.at(-1), "rejected");
    assert.equal(updates.filter((status) => status === "rejected").length, 1);
  }
});

test("closed, unmounted, and replaced Sessions cannot update the current Pane", () => {
  const updates: string[] = [];
  const old = createTerminalStartupState("old", (status) => updates.push(status));
  old.end();
  old.ready({ sessionId: "old", x11ForwardingStatus: "rejected" });
  old.started({ sessionId: "old", x11ForwardingStatus: "enabled" }, "disabled");
  const current = createTerminalStartupState("new", (status) => updates.push(status));
  current.ready({ sessionId: "old", x11ForwardingStatus: "rejected" });
  current.started({ sessionId: "old" }, "enabled");
  assert.deepEqual(updates, []);
  current.ready({ sessionId: "new", x11ForwardingStatus: "enabled" });
  current.ready({ sessionId: "new", x11ForwardingStatus: "rejected" });
  assert.deepEqual(updates, ["enabled", "rejected"]);
});

test("synchronous startup still applies the returned X11 status", () => {
  const updates: string[] = [];
  const state = createTerminalStartupState("sync", (status) => updates.push(status));
  state.started({ sessionId: "sync", x11ForwardingStatus: "rejected" }, "enabled");
  assert.deepEqual(updates, ["rejected"]);
});

test("startup scripts and forwards wait for both the input handle and SSH readiness", async () => {
  for (const readyFirst of [false, true]) {
    const actions: string[] = [];
    const state = createTerminalStartupState("prompt", () => {});
    const postLogin = state.waitUntilReady().then((result) => {
      if (result && state.claimPostLoginActions()) actions.push("startup script", "port forwards", "OS detection");
    });
    assert.equal(state.claimPostLoginActions(), false);
    const ready = { sessionId: "prompt", terminalReadyMs: 0, x11ForwardingStatus: "rejected" as const };
    if (readyFirst) state.ready(ready);
    else state.started({ sessionId: "prompt", startupPending: true }, "enabled");
    // A returned input handle must leave the post-login work pending, however
    // long the user takes to enter a passphrase. An early event also needs IPC.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(actions, []);
    assert.equal(state.claimPostLoginActions(), false);
    if (readyFirst) state.started({ sessionId: "prompt", startupPending: true }, "enabled");
    else state.ready(ready);
    await postLogin;
    assert.deepEqual(actions, ["startup script", "port forwards", "OS detection"]);
    state.ready(ready);
    state.started({ sessionId: "prompt", startupPending: true }, "enabled");
    assert.equal(state.claimPostLoginActions(), false, "resume events must not repeat post-login work");
    assert.deepEqual(await state.waitUntilReady(), ready);
  }
});

test("synchronous and system SSH starts do not wait for a native readiness event", async () => {
  for (const result of [{ sessionId: "sync", startupPending: false, terminalReadyMs: 0 }, { sessionId: "sync" }]) {
    const state = createTerminalStartupState("sync", () => {});
    state.started(result, "disabled");
    assert.deepEqual(await state.waitUntilReady(), result);
    assert.equal(state.claimPostLoginActions(), true);
  }
});

test("failed or closed Sessions release pending work without running it", async () => {
  for (const readyBeforeClose of [false, true]) {
    const state = createTerminalStartupState("closed", () => {});
    state.started({ sessionId: "closed", startupPending: true }, "enabled");
    const actions: string[] = [];
    const postLogin = state.waitUntilReady().then((result) => {
      if (result && state.claimPostLoginActions()) actions.push("startup script");
    });
    if (readyBeforeClose) state.ready({ sessionId: "closed" });
    state.end();
    state.ready({ sessionId: "closed" });
    await postLogin;
    assert.deepEqual(actions, []);
  }
});

test("Pane moves retain readiness and only the current renderer runs post-login work", async () => {
  const updates: string[] = [];
  const state = createTerminalStartupState("moving", (status) => updates.push(`old:${status}`));
  state.started({ sessionId: "moving", startupPending: true }, "enabled");
  let oldDisposed = false;
  const actions: string[] = [];
  const oldMount = state.waitUntilReady().then((result) => {
    if (!oldDisposed && result && state.claimPostLoginActions()) actions.push("old");
  });
  oldDisposed = true;
  state.detach();
  state.ready({ sessionId: "moving", x11ForwardingStatus: "rejected" });
  state.attach((status) => updates.push(`new:${status}`));
  const newMount = state.waitUntilReady().then((result) => {
    if (result && state.claimPostLoginActions()) actions.push("new");
  });
  await Promise.all([oldMount, newMount]);
  assert.deepEqual(updates, ["old:enabled", "new:rejected"]);
  assert.deepEqual(actions, ["new"]);
  assert.equal(state.claimPostLoginActions(), false, "later renderer moves must not replay scripts");
});

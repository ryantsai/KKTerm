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

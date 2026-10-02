import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { defaultRdpSettings } from "../src/app-defaults";
import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "../src/store";
import {
  createRdpStartupFullscreenAttempt,
  isRdpStartupActivationCurrent,
  type RdpFullscreenEntryOutcome,
} from "../src/modules/workspace/connections/remote-desktop/rdpStartupFullscreen";

beforeEach(() => {
  useWorkspaceStore.setState({
    tabs: [], activeTabId: "", activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    activeSessionCounts: {},
    rdpSettings: { ...defaultRdpSettings, openInFullscreen: true },
  });
});

function launch() {
  useWorkspaceStore.getState().openConnection({
    id: "retry-rdp", type: "rdp", name: "RDP", host: "example.test", user: "operator", status: "idle",
  });
  const tab = useWorkspaceStore.getState().tabs[0];
  const paneId = tab.focusedPaneId!;
  const attempt = createRdpStartupFullscreenAttempt();
  const environment = { overlay: false, connected: true, visible: true, appForeground: true, activationGeneration: 7 };
  const errors: unknown[] = [];
  let calls = 0;
  let outcome: RdpFullscreenEntryOutcome = "applied";
  let entry: () => Promise<RdpFullscreenEntryOutcome> = async () => outcome;
  const pending = () => useWorkspaceStore.getState().hasRdpStartupFullscreen(paneId);
  const cancel = () => { useWorkspaceStore.getState().consumeRdpStartupFullscreen(paneId); };
  return {
    tab, paneId, environment, errors, pending, cancel,
    calls: () => calls,
    outcome: (next: RdpFullscreenEntryOutcome) => { outcome = next; },
    entry: (next: typeof entry) => { entry = next; },
    run: () => attempt({
      isEligible: () => pending() && !environment.overlay && environment.connected && environment.visible,
      enter: async () => { calls += 1; return entry(); },
      canRetry: async () => pending() && isRdpStartupActivationCurrent(7, environment),
      finish: cancel,
      onError: (error) => { errors.push(error); },
    }),
  };
}

test("a blocking overlay defers a ready launch until it clears, then opens exactly once", async () => {
  const session = launch();
  session.environment.overlay = true;
  await session.run();
  assert.equal(session.calls(), 0);
  assert.equal(session.pending(), true);
  session.environment.overlay = false;
  await session.run();
  await session.run();
  assert.equal(session.calls(), 1);
  assert.equal(session.pending(), false);
});

test("native skipped is not acknowledged as applied and retries within the same activation", async () => {
  const session = launch();
  session.outcome("skipped");
  await session.run();
  assert.equal(session.pending(), true);
  session.outcome("applied");
  await session.run();
  await session.run();
  assert.equal(session.calls(), 2);
  assert.equal(session.pending(), false);
});

test("entry is single-flight and its intent remains pending until native acknowledgement", async () => {
  const session = launch();
  let complete!: (outcome: RdpFullscreenEntryOutcome) => void;
  session.entry(() => new Promise((resolve) => { complete = resolve; }));
  const first = session.run();
  await session.run();
  assert.equal(session.calls(), 1);
  assert.equal(session.pending(), true);
  complete("applied");
  await first;
  assert.equal(session.pending(), false);
});

test("a displayable login prompt and an unrevealed surface retain pending intent", async () => {
  const session = launch();
  session.environment.connected = false;
  await session.run();
  session.environment.connected = true;
  session.environment.visible = false;
  await session.run();
  assert.equal(session.calls(), 0);
  assert.equal(session.pending(), true);
  session.environment.visible = true;
  await session.run();
  assert.equal(session.calls(), 1);
});

test("focus moving into KKTerm's owned RDP overlay preserves the activation", async () => {
  const session = launch();
  // A main-window blur does not imply process deactivation: the native snapshot
  // still reports KKTerm foreground with the same activation generation.
  assert.equal(isRdpStartupActivationCurrent(7, session.environment), true);
  session.outcome("skipped");
  await session.run();
  assert.equal(session.pending(), true);
  session.outcome("applied");
  await session.run();
  assert.equal(session.calls(), 2);
});

for (const returnedToApp of [false, true]) {
  test(`native skip after external deactivation cancels even if already returned: ${returnedToApp}`, async () => {
    const session = launch();
    session.outcome("skipped");
    session.environment.appForeground = returnedToApp;
    session.environment.activationGeneration = returnedToApp ? 9 : 8;
    await session.run();
    assert.equal(session.pending(), false);
    session.environment.appForeground = true;
    session.outcome("applied");
    await session.run();
    assert.equal(session.calls(), 1);
  });
}

test("navigation away while an overlay defers entry cannot re-arm on tab reactivation", async () => {
  const session = launch();
  session.environment.overlay = true;
  await session.run();
  useWorkspaceStore.getState().openConnection({
    id: "other", type: "rdp", name: "Other", host: "other.test", user: "operator", status: "idle",
  });
  useWorkspaceStore.getState().activateTab(session.tab.id);
  session.environment.overlay = false;
  await session.run();
  assert.equal(session.pending(), false);
  assert.equal(session.calls(), 0);
});

for (const action of ["manual entry", "reconnect"]) {
  test(`${action} cancels a pending attempt without re-arming after a late skipped reply`, async () => {
    const session = launch();
    let complete!: (outcome: RdpFullscreenEntryOutcome) => void;
    session.entry(() => new Promise((resolve) => { complete = resolve; }));
    const pendingReply = session.run();
    session.cancel();
    complete("skipped");
    await pendingReply;
    await session.run();
    assert.equal(session.pending(), false);
    assert.equal(session.calls(), 1);
  });
}

test("an entry error is surfaced once and cannot cause an automatic retry loop", async () => {
  const session = launch();
  const error = new Error("native entry failed");
  session.entry(async () => { throw error; });
  await session.run();
  await session.run();
  assert.equal(session.pending(), false);
  assert.equal(session.calls(), 1);
  assert.deepEqual(session.errors, [error]);
});

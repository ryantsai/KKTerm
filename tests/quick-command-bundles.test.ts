import assert from "node:assert/strict";
import test from "node:test";
import type { QuickCommand, QuickCommandBundle } from "../src/types";

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage },
});

const {
  quickCommandTargetForConnection,
  quickCommandsForConnectionState,
  useWorkspaceStore,
} = await import("../src/store");

const BUNDLES_KEY = "kkterm.quickCommandBundles.v1";
const SELECTION_PREFIX = "kkterm.quickCommandBundleSelection.";

function command(id: string, label = id): QuickCommand {
  return {
    id,
    label,
    command: `echo ${label}`,
    iconName: "Terminal",
    accentName: "default",
    sendEnter: true,
    confirm: false,
  };
}

function resetStore() {
  localStorage.clear();
  useWorkspaceStore.setState({
    quickCommandsByConnection: {},
    quickCommandBundles: [],
    quickCommandBundlesLoaded: false,
    quickCommandBundleByConnection: {},
  });
}

test("a selected bundle is shared by every Connection that uses it", () => {
  resetStore();
  const bundle: QuickCommandBundle = {
    id: "bundle-1",
    name: "Shared",
    commands: [command("first")],
  };
  localStorage.setItem(BUNDLES_KEY, JSON.stringify([bundle]));
  localStorage.setItem(`${SELECTION_PREFIX}connection-a`, bundle.id);
  localStorage.setItem(`${SELECTION_PREFIX}connection-b`, bundle.id);

  const store = useWorkspaceStore.getState();
  store.ensureQuickCommandsLoaded("connection-a");
  store.ensureQuickCommandsLoaded("connection-b");
  store.addQuickCommand(
    quickCommandTargetForConnection(useWorkspaceStore.getState(), "connection-a"),
    command("second"),
  );

  const state = useWorkspaceStore.getState();
  assert.deepEqual(
    quickCommandsForConnectionState(state, "connection-a").map((entry) => entry.id),
    ["first", "second"],
  );
  assert.deepEqual(
    quickCommandsForConnectionState(state, "connection-b").map((entry) => entry.id),
    ["first", "second"],
  );
  assert.deepEqual(state.quickCommandsByConnection["connection-a"], []);
  assert.deepEqual(state.quickCommandsByConnection["connection-b"], []);
});

test("an invalid stored bundle selection self-heals to this Connection", () => {
  resetStore();
  localStorage.setItem(`${SELECTION_PREFIX}connection-a`, "deleted-bundle");

  useWorkspaceStore.getState().ensureQuickCommandsLoaded("connection-a");

  const state = useWorkspaceStore.getState();
  assert.equal(state.quickCommandBundleByConnection["connection-a"], undefined);
  assert.deepEqual(quickCommandTargetForConnection(state, "connection-a"), {
    kind: "connection",
    connectionId: "connection-a",
  });
  assert.equal(localStorage.getItem(`${SELECTION_PREFIX}connection-a`), null);
});

test("deleting a bundle falls loaded Connections back to their own commands", () => {
  resetStore();
  const bundle: QuickCommandBundle = {
    id: "bundle-1",
    name: "Shared",
    commands: [command("shared")],
  };
  localStorage.setItem(BUNDLES_KEY, JSON.stringify([bundle]));
  localStorage.setItem(`${SELECTION_PREFIX}connection-a`, bundle.id);
  localStorage.setItem("kkterm.quickCommands.connection-a", JSON.stringify([command("own")]));

  const store = useWorkspaceStore.getState();
  store.ensureQuickCommandsLoaded("connection-a");
  store.deleteQuickCommandBundle(bundle.id);

  const state = useWorkspaceStore.getState();
  assert.equal(state.quickCommandBundleByConnection["connection-a"], undefined);
  assert.deepEqual(
    quickCommandsForConnectionState(state, "connection-a").map((entry) => entry.id),
    ["own"],
  );
  assert.equal(localStorage.getItem(`${SELECTION_PREFIX}connection-a`), null);
});

test("resetting durable settings also clears the live Quick Command state", () => {
  resetStore();
  useWorkspaceStore.setState({
    quickCommandsByConnection: { "connection-a": [command("own")] },
    quickCommandBundles: [{
      id: "bundle-1",
      name: "Shared",
      commands: [command("shared")],
    }],
    quickCommandBundlesLoaded: true,
    quickCommandBundleByConnection: { "connection-a": "bundle-1" },
  });

  useWorkspaceStore.getState().resetQuickCommandState();

  const state = useWorkspaceStore.getState();
  assert.deepEqual(state.quickCommandsByConnection, {});
  assert.deepEqual(state.quickCommandBundles, []);
  assert.deepEqual(state.quickCommandBundleByConnection, {});
  assert.equal(state.quickCommandBundlesLoaded, true);
});

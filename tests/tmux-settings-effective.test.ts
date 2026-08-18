import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "../src/types";

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

const { connectionUsesTmux, useWorkspaceStore } = await import("../src/store");

const inheritedPb60Connection: Connection = {
  id: "pb60-repro",
  name: "pb60",
  host: "pb60",
  user: "ryan",
  port: 22,
  type: "ssh",
  status: "idle",
  sshSocksProxyInheritDefaults: true,
  useTmuxSessions: true,
};

function resetStore() {
  localStorage.clear();
  useWorkspaceStore.setState({
    tabs: [],
    activeTabId: undefined,
    sshSettings: {
      ...useWorkspaceStore.getState().sshSettings,
      defaultUseTmuxSessions: false,
    },
  });
}

test("inherited SSH Connections use the current Settings tmux default", () => {
  assert.equal(connectionUsesTmux(inheritedPb60Connection, false), false);
  assert.equal(connectionUsesTmux(inheritedPb60Connection, true), true);
  assert.equal(
    connectionUsesTmux(
      { ...inheritedPb60Connection, sshSocksProxyInheritDefaults: undefined },
      false,
    ),
    false,
  );
});

test("explicit SSH tmux overrides still win when the global default is off", () => {
  assert.equal(
    connectionUsesTmux(
      {
        ...inheritedPb60Connection,
        sshSocksProxyInheritDefaults: false,
        useTmuxSessions: true,
      },
      false,
    ),
    true,
  );
});

test("opening pb60 with the tmux default off does not allocate a tmux Pane", () => {
  resetStore();
  useWorkspaceStore.getState().openConnection(inheritedPb60Connection);

  const pane = useWorkspaceStore.getState().tabs[0]?.panes[0];
  assert.equal(pane?.tmuxSessionId, undefined);
});

test("changing the inherited tmux default updates open Panes for the next reconnect", () => {
  resetStore();
  useWorkspaceStore.getState().openConnection(inheritedPb60Connection);

  const disabledSettings = useWorkspaceStore.getState().sshSettings;
  useWorkspaceStore.getState().setSshSettings({
    ...disabledSettings,
    defaultUseTmuxSessions: true,
  });

  const enabledPane = useWorkspaceStore.getState().tabs[0]?.panes[0];
  assert.ok(enabledPane?.tmuxSessionId);

  useWorkspaceStore.getState().setSshSettings({
    ...disabledSettings,
    defaultUseTmuxSessions: false,
  });

  const disabledPane = useWorkspaceStore.getState().tabs[0]?.panes[0];
  assert.equal(disabledPane?.tmuxSessionId, undefined);
});

test("disabled inherited tmux ignores a stale Child Connection Tab session id", () => {
  resetStore();
  useWorkspaceStore.getState().openConnectionInNewTab(inheritedPb60Connection, {
    childConnectionId: "pb60-child",
    tmuxSessionId: "kkterm-stale001",
  });

  const pane = useWorkspaceStore.getState().tabs[0]?.panes[0];
  assert.equal(pane?.tmuxSessionId, undefined);
});

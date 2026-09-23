import assert from "node:assert/strict";
import test from "node:test";
import { connectionToolbarTitle, terminalHostDisplayName, terminalHostTooltip } from "../src/modules/workspace/connections/utils.tsx";
import { SavedPasswordPromptDetector } from "../src/modules/workspace/connections/terminal/savedPasswordPrompt";
import {
  filterTerminalPasswordChoices,
  terminalPasswordChoices,
} from "../src/modules/workspace/connections/terminal/terminalPasswordChoices";
import type { ConnectionTree, StoredCredentialSummary } from "../src/types";

test("terminal title shortens FQDNs, preserves IPs, and keeps the full address in its tooltip", () => {
  assert.equal(terminalHostDisplayName("db01.example.com"), "db01");
  assert.equal(terminalHostDisplayName("192.0.2.12"), "192.0.2.12");
  assert.equal(terminalHostDisplayName("2001:db8::1"), "2001:db8::1");
  assert.equal(terminalHostDisplayName("db01"), "db01");
  assert.equal(terminalHostDisplayName("db01."), "db01");
  assert.equal(terminalHostTooltip({ host: "db01.example.com", port: 2222 } as never), "db01.example.com:2222");
  assert.equal(terminalHostTooltip({ host: "2001:db8::1", port: 22 } as never), "[2001:db8::1]:22");
  assert.equal(terminalHostTooltip({ type: "ssh", host: "db01.example.com" } as never, 2200), "db01.example.com:2200");
  assert.equal(terminalHostTooltip({ type: "rdp", host: "desktop.example.com" } as never), "desktop.example.com:3389");
  assert.equal(connectionToolbarTitle({ type: "rdp", host: "desktop.example.com", port: 3389 } as never), "desktop");
  assert.equal(connectionToolbarTitle({ type: "vnc", host: "192.0.2.12", port: 5901 } as never), "192.0.2.12");
});

test("saved password offer requires a user-entered sudo or su command and a subsequent prompt", () => {
  const detector = new SavedPasswordPromptDetector();
  assert.equal(detector.observeOutput("Password:", 100), false);
  detector.observeInput("sudo su -\r", 100);
  assert.equal(detector.observeOutput("\x1b[0m[sudo] pass", 101), false);
  assert.equal(detector.observeOutput("word for ops: ", 102), true);
  assert.equal(detector.observeOutput("Password: ", 103), false, "the same prompt is offered once");
  detector.reset();
  detector.observeInput("su -\r", 200);
  assert.equal(detector.observeOutput("Password: ", 201), true);
  detector.reset();
  detector.observeInput("\x1b[200~sudo -v\x1b[201~\r", 250);
  assert.equal(detector.observeOutput("[sudo] password for ops: ", 251), true);
  detector.reset();
  detector.observeInput("sudo -v\r", 300);
  assert.equal(detector.observeOutput("Password:", 30_301), false, "expired commands cannot unlock a later prompt");
});

test("picker includes only terminal Connections with stored passwords and searches names and hosts", () => {
  const tree = {
    connections: [
      { id: "other", name: "Bastion", host: "bastion.example.com", user: "ops", type: "ssh", passwordCredentialId: "shared" },
      { id: "current", name: "Database", host: "10.1.2.3", user: "ops", type: "ssh", passwordCredentialId: "shared" },
      { id: "rdp", name: "Desktop", host: "desktop.example.com", user: "ops", type: "rdp", passwordCredentialId: "rdp-secret" },
      { id: "missing", name: "No password", host: "missing.example.com", user: "ops", type: "telnet" },
    ],
    folders: [],
  } as ConnectionTree;
  const credentials = [
    { kind: "connectionPassword", ownerId: "shared", exists: true },
    { kind: "connectionPassword", ownerId: "rdp-secret", exists: true },
  ] as StoredCredentialSummary[];
  const choices = terminalPasswordChoices(tree, credentials, "current");
  assert.deepEqual(choices.map(({ id }) => id), ["current", "other"]);
  assert.deepEqual(filterTerminalPasswordChoices(choices, "bastion").map(({ id }) => id), ["other"]);
  assert.deepEqual(filterTerminalPasswordChoices(choices, "10.1.2.3").map(({ id }) => id), ["current"]);
});

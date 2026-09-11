import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("private-key prompts publish an input handle and bypass the human-input startup deadline", async () => {
  const source = await readFile(new URL("../src-tauri/src/ssh.rs", import.meta.url), "utf8");
  assert.match(source, /let returns_before_ready = terminal_auth_needs_input\(&request.auth\);/);
  assert.match(source, /if returns_before_ready \{\s*Ok\(terminal\)/);
  assert.match(source, /run_terminal_startup\(startup, &budget, cancel_startup\)\.await\?/);
  assert.match(source, /startup_budget\.wait_for_input\(read_terminal_prompt_input/);
  const earlyReturn = source.indexOf("if returns_before_ready {");
  assert.ok(earlyReturn < source.indexOf("terminal.wait_until_ready(ready_rx, SSH_STARTUP_TIMEOUT)"));
});

test("post-login actions use the readiness gate and transfer with the live Pane", async () => {
  const source = await readFile(new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url), "utf8");
  const actions = source.slice(source.indexOf("const finishSshStartup = async () => {"), source.indexOf("const dataDisposable ="));
  assert.match(actions, /await startupState\.waitUntilReady\(\)/);
  assert.match(actions, /disposed \|\| sessionEnded \|\| !startupState\.claimPostLoginActions\(\)/);
  for (const call of ["startEnabledSshPortForwardings(", "writeInputToSession(sshStartupInput)", "maybeAutoDetectOsIcon(connection, result.sessionId)"]) {
    assert.ok(actions.includes(call), `${call} must wait for SSH readiness`);
    assert.equal(source.split(call).length, 2, `${call} must not also run on the early response`);
  }
  assert.match(source, /preservedRuntime\?\.startupState \?\?/);
  assert.match(source, /preservedRuntime\?\.readyListener \?\?/);
  assert.match(source, /preserveTerminalPaneRuntime\(pane\.id, \{[\s\S]*?startupState,\s*readyListener,/);
});

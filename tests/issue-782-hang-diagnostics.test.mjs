import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sshSource = await readFile(new URL("../src-tauri/src/ssh.rs", import.meta.url), "utf8");
const sessionsSource = await readFile(new URL("../src-tauri/src/sessions.rs", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url), "utf8");
const terminalSource = await readFile(new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url), "utf8");

function assertOrdered(source, steps) {
  let previous = -1;
  for (const step of steps) {
    const index = source.indexOf(step, previous + 1);
    assert.ok(index > previous, `${step} must follow the previous diagnostic boundary`);
    previous = index;
  }
}

test("SSH agent and startup teardown probes bracket the potentially blocking calls", () => {
  const agent = sshSource.slice(sshSource.indexOf("async fn authenticate_with_agent("), sshSource.indexOf("type DynamicAgentClient"));
  assertOrdered(agent, [
    "[DEBUG-782] agent.connect.begin",
    "connect_ssh_agents().await?",
    "[DEBUG-782] agent.connect.end",
    "[DEBUG-782] agent.identities.begin",
    "request_agent_identities(agent).await",
    "[DEBUG-782] agent.identities.end",
  ]);
  assert.match(agent, /\[DEBUG-782\] agent\.identities\.error/);
  const windowsAgents = sshSource.slice(sshSource.indexOf("#[cfg(windows)]\nasync fn connect_ssh_agents()"), sshSource.indexOf("#[cfg(not(any(unix, windows)))]"));
  assertOrdered(windowsAgents, [
    "[DEBUG-782] agent.named_pipe.begin",
    "AgentClient::connect_named_pipe(",
    "[DEBUG-782] agent.named_pipe.end",
    "[DEBUG-782] agent.pageant.begin",
    "AgentClient::connect_pageant().await",
    "[DEBUG-782] agent.pageant.end",
  ]);

  const worker = sshSource.slice(sshSource.indexOf("let worker = thread::spawn(move || {"), sshSource.indexOf("let terminal = NativeSshTerminal"));
  assertOrdered(worker, [
    "[DEBUG-782] worker.error_output.begin",
    "emit_terminal_output(",
    "[DEBUG-782] worker.error_output.end",
    "[DEBUG-782] worker.ended_event.begin",
    "emit_terminal_session_ended(",
    "[DEBUG-782] worker.ended_event.end",
  ]);

  const close = sshSource.slice(sshSource.indexOf("pub fn close(mut self)"), sshSource.indexOf("fn run_native_terminal_thread("));
  assertOrdered(close, [
    "[DEBUG-782] terminal.close.join.begin",
    "worker.join()",
    "[DEBUG-782] terminal.close.join.end",
  ]);
  assert.match(close, /"elapsedMs": join_started\.elapsed\(\)\.as_millis\(\)/);
});

test("fallback and frontend probes distinguish a stalled command from completed backend cleanup", () => {
  assertOrdered(sessionsSource, [
    "[DEBUG-782] fallback.notice.begin",
    "[fallback: starting interactive ssh",
    "[DEBUG-782] fallback.notice.end",
    "[DEBUG-782] fallback.pty.begin",
    ".openpty(pty_size_for(&request))",
    ".spawn_command(command)",
    "[DEBUG-782] fallback.pty.end",
    "[DEBUG-782] fallback.session_registered",
  ]);
  assert.match(sidebarSource, /\[DEBUG-782\] connection\.row_click[\s\S]*?clickCount: event\.detail/);
  assert.match(sidebarSource, /\[DEBUG-782\] connection\.row_double_click/);
  assertOrdered(terminalSource, [
    "[DEBUG-782] terminal.start_command.begin",
    "invokeCommand(\"start_terminal_session\"",
    "[DEBUG-782] terminal.start_command.end",
  ]);
});

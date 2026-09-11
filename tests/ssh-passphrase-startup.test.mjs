import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("private-key prompts publish an input handle and bypass the human-input startup deadline", async () => {
  const source = await readFile(new URL("../src-tauri/src/ssh.rs", import.meta.url), "utf8");
  assert.match(source, /let returns_before_ready = terminal_auth_needs_input\(&request.auth\);/);
  assert.match(source, /if returns_before_ready \{\s*return Ok\(NativeSshTerminal/);
  assert.match(source, /run_terminal_startup\(startup, &budget, cancel_startup\)\.await\?/);
  assert.match(source, /startup_budget\.wait_for_input\(read_terminal_prompt_input/);
  const earlyReturn = source.indexOf("if returns_before_ready {");
  assert.ok(earlyReturn < source.indexOf(".recv_timeout(Duration::from_secs(15))"));
});

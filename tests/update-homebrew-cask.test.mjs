import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/update-homebrew-cask.sh", import.meta.url));
const hasZsh = process.platform !== "win32" && spawnSync("zsh", ["--version"]).status === 0;
const shellTest = (name, run) => test(name, { skip: !hasZsh && "Requires zsh; runs in macOS CI" }, run);
const publishArgs = ["--version", "1.2.3", "--sha256", "a".repeat(64)];

// No network or real credentials: brew and git are executable spies. The brew
// spy models the relevant 6.0.22 environment filter and brew.sh SSH hook.
const commandSpy = `#!${process.execPath}
const { appendFileSync, mkdirSync, readlinkSync, statSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { basename, dirname, join } = require("node:path");
const kind = basename(process.argv[1]);
const args = process.argv.slice(2);
const action = args[0] === "-C" ? args[2] : args[0];
const config = process.env.HOMEBREW_SSH_CONFIG_PATH;
const event = { kind, args, action, config: config ?? null,
  sshCommand: process.env.GIT_SSH_COMMAND ?? null,
  terminalPrompt: process.env.GIT_TERMINAL_PROMPT ?? null };
if (config) {
  event.configMode = statSync(config).mode & 0o777;
  event.directoryMode = statSync(dirname(config)).mode & 0o777;
  event.keyTarget = readlinkSync(join(dirname(config), "identity"));
}
if (kind === "git" && config && ["clone", "push", "ls-remote"].includes(action)) {
  const ssh = spawnSync("/bin/sh", ["-c", "exec $GIT_SSH_COMMAND -G github.com"],
    { env: process.env, encoding: "utf8" });
  if (ssh.status !== 0) throw new Error(ssh.stderr);
  event.sshOptions = ssh.stdout;
}
appendFileSync(process.env.HOMEBREW_TEST_LOG, JSON.stringify(event) + "\\n");
if (process.env.HOMEBREW_TEST_FAIL === action) process.exit(33);
if (kind === "brew") {
  if (action === "tap") {
    const env = { ...process.env };
    delete env.GIT_SSH_COMMAND;
    if (env.HOMEBREW_SSH_CONFIG_PATH) {
      env.GIT_SSH_COMMAND = "ssh -F" + env.HOMEBREW_SSH_CONFIG_PATH;
    }
    const clone = spawnSync(join(dirname(process.argv[1]), "git"), ["clone", args[2]],
      { env, encoding: "utf8" });
    if (clone.status !== 0) process.exit(clone.status ?? 1);
    mkdirSync(process.env.HOMEBREW_TEST_TAP_DIR, { recursive: true });
  }
  if (action === "--repository") console.log(process.env.HOMEBREW_TEST_TAP_DIR);
  if (action === "untap" && process.env.HOMEBREW_TEST_UNTAP_FAIL) process.exit(34);
} else if (action === "diff") {
  process.exit(process.env.HOMEBREW_TEST_NO_DIFF ? 0 : 1);
} else if (action === "push" && process.env.HOMEBREW_TEST_SIGNAL) {
  process.kill(process.ppid, "SIGTERM");
}
`;

function runScript(t, { args = publishArgs, key = true, fail = "", noDiff = false, signal = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kkterm-homebrew-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const keyPath = join(root, "keys with spaces", 'deploy "key" %n ${UNSET}');
  const logPath = join(root, "commands.jsonl");
  const tapDir = join(root, "tap");
  mkdirSync(bin);
  mkdirSync(dirname(keyPath));
  writeFileSync(keyPath, "Test fixture only; no private key.\n", { mode: 0o644 });
  writeFileSync(logPath, "");
  for (const name of ["brew", "git"]) {
    writeFileSync(join(bin, name), commandSpy, { mode: 0o755 });
  }
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: process.env.HOME,
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
    HOMEBREW_TEST_LOG: logPath,
    HOMEBREW_TEST_TAP_DIR: tapDir,
    HOMEBREW_TEST_FAIL: fail,
    HOMEBREW_TEST_UNTAP_FAIL: fail ? "1" : "",
    HOMEBREW_TEST_NO_DIFF: noDiff ? "1" : "",
    HOMEBREW_TEST_SIGNAL: signal ? "1" : "",
  };
  if (key) env.HOMEBREW_TAP_SSH_KEY_PATH = key === "missing" ? `${keyPath}-missing` : keyPath;
  const result = spawnSync("zsh", [script, ...args], { env, encoding: "utf8", timeout: 20_000 });
  assert.ifError(result.error);
  const events = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  // Verify cleanup on success and every failure path, including failed untap.
  const configs = new Set(events.map((event) => event.config).filter(Boolean));
  for (const config of configs) {
    t.after(() => rmSync(dirname(config), { recursive: true, force: true }));
    assert.equal(existsSync(dirname(config)), false, "temporary SSH directory must be removed");
  }
  assert.equal(existsSync(keyPath), true, "the caller's key file must be retained");
  return { result, events, keyPath, tapDir };
}

function assertSshIdentity(event, keyPath) {
  assert.equal(event.keyTarget, keyPath);
  assert.equal(event.configMode, 0o600);
  assert.equal(event.directoryMode, 0o700);
  assert.match(event.config, /^\/tmp\/kkterm-homebrew-ssh\.[A-Za-z0-9]+\/config$/);
  assert.match(event.sshOptions, /^identitiesonly yes$/m);
  assert.match(event.sshOptions, /^batchmode yes$/m);
  assert.match(event.sshOptions, /^stricthostkeychecking accept-new$/m);
  assert.equal(
    event.sshOptions.split("\n").filter((line) => line.startsWith("identityfile ")).join("\n"),
    `identityfile ${join(dirname(event.config), "identity")}`,
  );
}

shellTest("Homebrew filtering retains the selected key for clone and direct push", (t) => {
  const { result, events, keyPath, tapDir } = runScript(t);
  assert.equal(result.status, 0, result.stderr);
  const clone = events.find((event) => event.action === "clone");
  const push = events.find((event) => event.action === "push");
  assert.deepEqual(clone.args, ["clone", "git@github.com:ryantsai/homebrew-tap.git"]);
  assert.deepEqual(push.args, ["-C", tapDir, "push", "origin", "HEAD:main"]);
  assertSshIdentity(clone, keyPath);
  assertSshIdentity(push, keyPath);
  assert.equal(clone.config, push.config);
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  assert.match(readFileSync(join(tapDir, "Casks/kkterm.rb"), "utf8"), /version "1\.2\.3"/);
  const styleIndex = events.findIndex((event) => event.action === "style");
  const auditIndex = events.findIndex((event) => event.action === "audit");
  assert.ok(styleIndex !== -1 && auditIndex > styleIndex && events.indexOf(push) > auditIndex);
  assert.equal(events.at(-1).action, "untap");
});

for (const fail of ["clone", "style", "audit", "push"]) {
  shellTest(`Homebrew ${fail} failure cleans the SSH config even when untap fails`, (t) => {
    const { result, events } = runScript(t, { fail });
    assert.equal(result.status, 33, result.stderr);
    assert.equal(events.at(-1).action, "untap");
    if (fail !== "push") assert.equal(events.some((event) => event.action === "push"), false);
  });
}

shellTest("unchanged cask exits without committing or pushing and cleans the config", (t) => {
  const { result, events } = runScript(t, { noDiff: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already matches/);
  assert.equal(events.some((event) => ["commit", "push"].includes(event.action)), false);
});

shellTest("TERM cleans the temporary tap and SSH config", (t) => {
  const { result, events } = runScript(t, { signal: true });
  assert.equal(result.status, 143, result.stderr);
  assert.equal(events.at(-1).action, "untap");
});

shellTest("no deploy key keeps HTTPS and existing direct git credentials", (t) => {
  const { result, events } = runScript(t, { key: false });
  assert.equal(result.status, 0, result.stderr);
  const clone = events.find((event) => event.action === "clone");
  assert.equal(clone.args[1], "https://github.com/ryantsai/homebrew-tap.git");
  assert.equal(clone.sshCommand, null, "brew should filter the inherited SSH command");
  assert.equal(events.find((event) => event.action === "push").sshCommand, "ssh -o BatchMode=yes");
  assert.equal(events.every((event) => event.config === null), true);
});

shellTest("dry run renders the cask without git, brew, or key access", (t) => {
  const { result, events } = runScript(t, { key: "missing", args: [...publishArgs, "--dry-run"] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cask "kkterm" do/);
  assert.deepEqual(events, []);
});

shellTest("missing key fails before tap, commit, or push", (t) => {
  const { result, events } = runScript(t, { key: "missing" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not point to a file/);
  assert.deepEqual(events, []);
});

shellTest("access preflight uses the same SSH identity without cloning or publishing", (t) => {
  const { result, events, keyPath, tapDir } = runScript(t, {
    args: ["--check-access", "--tap-repo", "example/tap"],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].args, ["ls-remote", "git@github.com:example/tap.git", "HEAD"]);
  assert.equal(events[0].terminalPrompt, "0");
  assertSshIdentity(events[0], keyPath);
  assert.equal(existsSync(tapDir), false);
});

shellTest("failed access preflight stops without tapping or publishing and cleans the config", (t) => {
  const { result, events } = runScript(t, { args: ["--check-access"], fail: "ls-remote" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot read Homebrew tap/);
  assert.deepEqual(events.map((event) => event.action), ["ls-remote"]);
});

shellTest("HTTPS access preflight is noninteractive and preserves existing credentials", (t) => {
  const { result, events } = runScript(t, { args: ["--check-access"], key: false });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(events[0].args, ["ls-remote", "https://github.com/ryantsai/homebrew-tap.git", "HEAD"]);
  assert.equal(events[0].terminalPrompt, "0");
  assert.equal(events[0].sshCommand, "ssh -o BatchMode=yes");
  assert.equal(events.length, 1);
});

shellTest("access preflight cannot be combined with dry run", (t) => {
  const { result, events } = runScript(t, { args: ["--check-access", "--dry-run"] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot be combined/);
  assert.deepEqual(events, []);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const stepName = "      - name: Write Homebrew tap deploy key\n        run: |\n";
const stepStart = workflow.indexOf(stepName);
assert.ok(stepStart !== -1, "the deploy-key step must exist");
const lines = workflow.slice(stepStart + stepName.length).split("\n");
const stepEnd = lines.findIndex((line) => line.trim() && !line.startsWith("          "));
const step = lines.slice(0, stepEnd === -1 ? undefined : stepEnd)
  .map((line) => line.slice(10)).join("\n");
assert.ok(stepStart < workflow.indexOf("      - name: Build, notarize, and publish macOS assets"),
  "key validation must run before the macOS build");

const hasTools = process.platform !== "win32"
  && spawnSync("bash", ["--version"]).status === 0
  && !spawnSync("ssh-keygen", ["-?"]).error;

test("Homebrew deploy-key materialization validates synthetic keys offline", {
  skip: !hasTools && "Requires bash and ssh-keygen; runs in macOS/Linux CI",
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "kkterm-key-materialization-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  function generate(name, { type = "ed25519", passphrase = "", args = [] } = {}) {
    const path = join(root, name);
    const result = spawnSync("ssh-keygen", ["-q", "-t", type, "-N", passphrase, ...args, "-f", path],
      { encoding: "utf8", timeout: 20_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, "synthetic key generation must succeed");
    return readFileSync(path, "utf8");
  }

  const privateKey = generate("synthetic-ed25519");
  const pemKey = generate("synthetic-rsa", { type: "rsa", args: ["-b", "2048", "-m", "PEM"] });
  const encryptedKey = generate("synthetic-encrypted", { passphrase: "synthetic-test-passphrase" });
  const publicKey = readFileSync(join(root, "synthetic-ed25519.pub"), "utf8");
  const cases = [
    ["accepts LF", privateKey, true],
    ["adds a missing final newline", privateKey.trimEnd(), true],
    ["normalizes CRLF", privateKey.replaceAll("\n", "\r\n"), true],
    ["normalizes CRLF with no final newline", privateKey.trimEnd().replaceAll("\n", "\r\n"), true],
    ["accepts an unencrypted RSA PEM key", pemKey, true],
    ["rejects malformed input", "invalid synthetic key", false],
    ["rejects a public key", publicKey, false],
    ["rejects a passphrase-protected key", encryptedKey, false],
    ["rejects literal escaped newlines", privateKey.replaceAll("\n", "\\n"), false],
    ["rejects an empty secret", "", false],
  ];

  for (const [name, secret, valid] of cases) {
    await t.test(name, () => {
      const runnerTemp = mkdtempSync(join(root, "runner-"));
      const githubEnv = join(runnerTemp, "github-env");
      const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", step], {
        env: { PATH: process.env.PATH, RUNNER_TEMP: runnerTemp, GITHUB_ENV: githubEnv,
          HOMEBREW_TAP_SSH_KEY: secret },
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.ifError(result.error);
      assert.equal(result.stderr, "", "the step must not expose parser output");
      if (valid) {
        assert.equal(result.status, 0, "valid synthetic input must pass");
        const keyPath = join(runnerTemp, "homebrew-tap-deploy-key");
        const written = readFileSync(keyPath);
        assert.equal(written.at(-1), 10, "the key must end with LF");
        assert.equal(written.includes(13), false, "the key must contain no CR bytes");
        assert.equal(statSync(keyPath).mode & 0o777, 0o600);
        assert.equal(readFileSync(githubEnv, "utf8"), `HOMEBREW_TAP_SSH_KEY_PATH=${keyPath}\n`);
        assert.equal(result.stdout, "", "valid input must not print key material");
      } else {
        assert.notEqual(result.status, 0, "invalid synthetic input must fail");
        assert.equal(existsSync(githubEnv), false, "a rejected key must not reach later steps");
        if (secret) assert.equal(result.stdout,
          "::error::HOMEBREW_TAP_SSH_KEY must contain a valid SSH private key with no passphrase.\n");
        else assert.equal(result.stdout, "");
      }
    });
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release mirror workflow supports every publication and recovery entry point", async () => {
  const source = await readFile(new URL("../.github/workflows/mirror-release.yml", import.meta.url), "utf8");
  assert.match(source, /workflow_call:/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /release:\s*\n\s*types:\s*\[published\]/);
  assert.match(source, /schedule:/);
  assert.match(source, /cancel-in-progress:\s*false/);
  assert.match(source, /CLOUDFLARE_API_TOKEN/);
  assert.match(source, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(source, /sync-cloudflare-release\.mjs/);
});

test("all platform release producers trigger mirror reconciliation", async () => {
  const [windows, macos, linux, releaseWorkflow] = await Promise.all([
    readFile(new URL("../scripts/release-github.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/release-github-macos.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/release-github-linux.sh", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  ]);
  for (const source of [windows, macos, linux]) {
    assert.match(source, /mirror-release\.yml/);
    assert.match(source, /tag/);
  }
  assert.match(releaseWorkflow, /actions:\s*write/);
});

test("main release workflow orchestrates all platform release jobs in order", async () => {
  const source = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(source, /runs-on:\s*windows-2025/);
  assert.match(source, /runs-on:\s*macos/);
  assert.match(source, /runs-on:\s*ubuntu-24\.04/);
  assert.match(source, /scripts\/release-github-both-arch\.ps1/);
  assert.match(source, /scripts\/release-github-macos\.sh/);
  assert.match(source, /scripts\/release-github-linux\.sh/);
  assert.match(source, /release-macos:[\s\S]*needs:\s*release/);
  assert.match(source, /release-linux:[\s\S]*needs:\s*\[release,\s*release-macos\]/);
  assert.match(source, /release-linux:[\s\S]*--tag "\$\{\{\s*needs\.release\.outputs\.tag\s*\}\}"/);
  assert.match(source, /mirror-final:[\s\S]*needs:\s*\[release,\s*release-linux\]/);
  assert.match(source, /mirror-final:[\s\S]*tag:\s*\$\{\{\s*needs\.release\.outputs\.tag\s*\}\}/);
  assert.match(source, /release-macos:[\s\S]*timeout-minutes:\s*180/);
  assert.doesNotMatch(source, /base64\s+--decode/);
  assert.match(source, /security list-keychains/);
  assert.match(source, /HOMEBREW_TAP_SSH_KEY/);
  assert.match(source, /HOMEBREW_TAP_SSH_KEY_PATH/);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleaseNotesPrompt,
  composeFallbackReleaseNotes,
  extractPrNumbers,
  prependDirectDownloads,
  prependChangelogEntry,
} from "../scripts/generate-release-notes.mjs";

const sampleContext = {
  project: "KKTerm",
  version: "v0.1.32",
  repo: "ryantsai/KKTerm",
  previousTag: "v0.1.31",
  target: "HEAD",
  compareUrl: "https://github.com/ryantsai/KKTerm/compare/v0.1.31...v0.1.32",
  githubGeneratedNotes: "## What's Changed\n* Add terminal recording controls by @ryan in #132",
  commits: [
    {
      sha: "da94b9e",
      subject: "feat(terminal): implement recording controls in terminal pane",
      body: "",
      files: ["src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", "src/modules/workspace/connections/terminal/terminal.css"],
    },
    {
      sha: "4ca8a56",
      subject: "feat(ai-coding-usage): implement background refresh for AI coding usage providers",
      body: "",
      files: ["src/modules/dashboard/widgets/builtin/ai-coding-usage/refreshPolicy.ts"],
    },
  ],
};

test("extractPrNumbers collects PR numbers from commit text and GitHub generated notes", () => {
  const commits = [
    { subject: "fix(terminal): handle disconnect (#42)", body: "" },
    { subject: "Merge pull request #57 from branch", body: "closes #100" },
  ];
  const notes = "* Some change by @user in https://github.com/ryantsai/KKTerm/pull/99\n* Another in #57";
  const prNumbers = extractPrNumbers(commits, notes);
  assert.ok(prNumbers.includes(42));
  assert.ok(prNumbers.includes(57));
  assert.ok(prNumbers.includes(99));
  assert.equal(prNumbers.filter((n) => n === 57).length, 1, "deduplicates PR numbers");
});

test("buildReleaseNotesPrompt instructs AI to credit linked issue reporters", () => {
  const contextWithReporters = {
    ...sampleContext,
    linkedIssueReporters: [{ number: 130, title: "Terminal flickers", reporter: "alice", prNumber: 132 }],
  };
  const prompt = buildReleaseNotesPrompt(contextWithReporters);
  assert.match(prompt, /linkedIssueReporters/);
  assert.match(prompt, /alice/);
});

test("buildReleaseNotesPrompt feeds bounded release context and KKTerm terminology to AI", () => {
  const prompt = buildReleaseNotesPrompt(sampleContext);

  assert.match(prompt, /Use only the supplied release context/);
  assert.match(prompt, /Connection, Session, Tab, Pane, Dashboard Widget Instance/);
  assert.match(prompt, /v0\.1\.31/);
  assert.match(prompt, /da94b9e/);
  assert.match(prompt, /GitHub generated notes/);
  assert.match(prompt, /Markdown only/);
  assert.match(prompt, /light IT humor/);
  assert.match(prompt, /English release notes first/);
  assert.match(prompt, /Traditional Chinese \(Taiwan\) version below/);
  assert.match(prompt, /same light humor and tone/);
});

test("composeFallbackReleaseNotes creates a publishable markdown changelog without AI", () => {
  const notes = composeFallbackReleaseNotes(sampleContext);

  assert.match(notes, /^# KKTerm v0\.1\.32/m);
  assert.match(notes, /## Highlights/);
  assert.match(notes, /## Changes/);
  assert.match(notes, /terminal recording controls/);
  assert.match(notes, /da94b9e/);
  assert.match(notes, /Compare: https:\/\/github\.com\/ryantsai\/KKTerm\/compare\/v0\.1\.31\.\.\.v0\.1\.32/);
});

test("prependDirectDownloads places Windows release links before generated notes", () => {
  const notes = prependDirectDownloads(sampleContext, "# KKTerm v0.1.32\n\n## Highlights\n\n- New release.\n");

  assert.match(notes, /^## Direct Downloads\n\* 💻 \[Download for Windows \(64-bit\)\]/);
  assert.match(
    notes,
    /https:\/\/github\.com\/ryantsai\/KKTerm\/releases\/download\/v0\.1\.32\/kkterm-0\.1\.32-windows-x64-setup\.exe/,
  );
  assert.match(
    notes,
    /https:\/\/github\.com\/ryantsai\/KKTerm\/releases\/download\/v0\.1\.32\/kkterm-0\.1\.32-windows-arm64-setup\.exe/,
  );
  assert.match(notes, /kkterm-0\.1\.32-windows-x64-portable\.zip/);
  assert.match(notes, /kkterm-0\.1\.32-windows-arm64-portable\.zip/);
  assert.ok(notes.indexOf("## Direct Downloads") < notes.indexOf("# KKTerm v0.1.32"));
});

test("prependChangelogEntry inserts newest release below the changelog header", () => {
  const current = "# Changelog\n\nAll notable changes to KKTerm are documented here.\n\n## v0.1.31\n\n- Previous.\n";
  const entry = "# KKTerm v0.1.32\n\n## Highlights\n\n- New release.\n";

  const updated = prependChangelogEntry(current, entry);

  assert.match(updated, /^# Changelog\n\nAll notable changes to KKTerm are documented here\.\n\n## v0\.1\.32/m);
  assert.ok(updated.indexOf("## v0.1.32") < updated.indexOf("## v0.1.31"));
  assert.doesNotMatch(updated, /# KKTerm v0\.1\.32/);
});

test("prependChangelogEntry normalizes release heading after direct downloads", () => {
  const current = "# Changelog\n\nAll notable changes to KKTerm are documented here.\n\n## v0.1.31\n\n- Previous.\n";
  const entry = prependDirectDownloads(sampleContext, "# KKTerm v0.1.32\n\n## Highlights\n\n- New release.\n");

  const updated = prependChangelogEntry(current, entry);

  assert.match(updated, /^# Changelog\n\nAll notable changes to KKTerm are documented here\.\n\n## Direct Downloads/m);
  assert.match(updated, /## v0\.1\.32/);
  assert.doesNotMatch(updated, /# KKTerm v0\.1\.32/);
});

test("release model defaults and overrides use the official Nano replacement", async () => {
  const { resolveReleaseNotesModel, generateAiReleaseNotes } = await import("../scripts/generate-release-notes.mjs");
  assert.equal(resolveReleaseNotesModel(), "gpt-6-luna");
  assert.equal(resolveReleaseNotesModel(undefined, "env-model"), "env-model");
  assert.equal(resolveReleaseNotesModel("cli-model", "env-model"), "cli-model");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gpt-6-luna");
      assert.equal(body.store, false);
      assert.match(body.input, /Traditional Chinese/);
      return { ok: true, json: async () => ({ output: [{ content: [{ text: "Release notes" }] }] }) };
    };
    assert.equal(await generateAiReleaseNotes(sampleContext, resolveReleaseNotesModel(), "test-key"), "Release notes\n");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("release entry points no longer pin deprecated Nano or defeat local overrides", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of [".github/workflows/release.yml", ".env.example", "docs/RELEASE.md"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /gpt-6-luna/);
    assert.doesNotMatch(source, /gpt-5\.4-nano/);
  }
  const wrapper = await readFile(new URL("../scripts/release-github.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(wrapper, /gpt-5\.4-nano/);
  assert.doesNotMatch(wrapper, /"--model"/);
});

test("API failure still writes deterministic release notes and changelog", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const dir = await mkdtemp(join(tmpdir(), "kkterm-release-notes-"));
  try {
    const run = promisify(execFile);
    // A no-tag, no-PR fixture prevents gh calls regardless of the CI checkout.
    await run("git", ["init", dir]);
    await run("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Release fixture"]);
    const mockPath = join(dir, "mock-fetch.mjs");
    const requestPath = join(dir, "request.json");
    await writeFile(mockPath, `import { writeFileSync } from 'node:fs';
      globalThis.fetch = async (url, options) => {
        writeFileSync(${JSON.stringify(requestPath)}, options.body);
        return { ok: false, json: async () => ({ error: { message: 'test API failure' } }) };
      };`);
    const output = join(dir, "notes.md");
    const releaseFile = join(dir, "version.md");
    const changelog = join(dir, "changelog.md");
    const env = { ...process.env, OPENAI_API_KEY: "test-key" };
    delete env.OPENAI_RELEASE_NOTES_MODEL;
    const { stderr } = await promisify(execFile)(process.execPath, [
      "--import", pathToFileURL(mockPath).href,
      fileURLToPath(new URL("../scripts/generate-release-notes.mjs", import.meta.url)),
      "--version", "vtest", "--repo", "fixture/offline", "--output", output,
      "--release-file", releaseFile, "--changelog", changelog,
    ], { cwd: dir, env });
    assert.match(stderr, /AI release notes failed; using deterministic fallback/);
    assert.equal(JSON.parse(await readFile(requestPath, "utf8")).model, "gpt-6-luna");
    const notes = await readFile(output, "utf8");
    assert.match(notes, /# KKTerm vtest/);
    assert.match(notes, /## Changes/);
    assert.equal(await readFile(releaseFile, "utf8"), notes);
    assert.match(await readFile(changelog, "utf8"), /## vtest/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

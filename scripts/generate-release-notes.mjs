import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const DEFAULT_MODEL = "gpt-6-luna";
const MAX_BODY_CHARS = 1200;

export function resolveReleaseNotesModel(cliModel, envModel) {
  return cliModel ?? envModel ?? DEFAULT_MODEL;
}

export function buildReleaseNotesPrompt(context) {
  return [
    `Write KKTerm release notes for ${context.version}.`,
    "",
    "Rules:",
    "- Use only the supplied release context.",
    "- Do not invent features, fixes, platforms, performance claims, or compatibility changes.",
    "- Preserve PR numbers, contributor mentions, links, and short SHAs when present.",
    "- Credit issue reporters from linkedIssueReporters: mention them alongside the fix even when the reporter and PR author are the same person.",
    "- Use KKTerm domain language where relevant: Connection, Session, Tab, Pane, Dashboard Widget Instance.",
    "- Prefer user-facing impact over implementation details.",
    "- Use light IT humor when it fits, such as small sysadmin, terminal, network, or release-engineering jokes.",
    "- Keep jokes brief and never let them replace factual release details.",
    "- Write the English release notes first, then add a Traditional Chinese (Taiwan) version below them.",
    "- Keep the Traditional Chinese (Taiwan) version factually equivalent to the English version, including the same light humor and tone.",
    "- Put purely internal build, tooling, test, or version changes under Internal.",
    "- Output Markdown only.",
    "",
    "Expected sections:",
    "- Highlights",
    "- New",
    "- Improved",
    "- Fixed",
    "- Internal",
    "",
    "Omit empty sections. Keep the notes concise.",
    "The githubGeneratedNotes field contains GitHub generated notes when that API is available.",
    "",
    "Release context JSON:",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

export function composeFallbackReleaseNotes(context) {
  const lines = [
    `# KKTerm ${context.version}`,
    "",
    "## Highlights",
    "",
  ];

  if (context.githubGeneratedNotes?.trim()) {
    lines.push(cleanGeneratedNotes(context.githubGeneratedNotes), "");
  } else if (context.commits.length > 0) {
    const highlighted = context.commits.slice(0, 5);
    for (const commit of highlighted) {
      lines.push(`- ${humanizeCommitSubject(commit.subject)} (${commit.sha})`);
    }
    lines.push("");
  } else {
    lines.push("- Maintenance release.", "");
  }

  lines.push("## Changes", "");
  if (context.commits.length > 0) {
    for (const commit of context.commits) {
      lines.push(`- ${commit.subject} (${commit.sha})`);
    }
  } else {
    lines.push("- No commits were found in the selected release range.");
  }

  if (context.compareUrl) {
    lines.push("", `Compare: ${context.compareUrl}`);
  }

  return `${lines.join("\n").trim()}\n`;
}

export function prependDirectDownloads(context, releaseNotes) {
  const repo = context.repo?.trim();
  if (!repo) {
    return releaseNotes;
  }

  const tagName = context.version;
  const assetVersion = tagName.replace(/^v/i, "");
  const releaseBaseUrl = `https://github.com/${repo}/releases/download/${tagName}`;
  const downloads = [
    "## Direct Downloads",
    `* 💻 [Download for Windows (64-bit)](${releaseBaseUrl}/kkterm-${assetVersion}-windows-x64-setup.exe)`,
    `* 💻 [Download for Windows (ARM64)](${releaseBaseUrl}/kkterm-${assetVersion}-windows-arm64-setup.exe)`,
    `* 📦 [Portable for Windows (64-bit)](${releaseBaseUrl}/kkterm-${assetVersion}-windows-x64-portable.zip)`,
    `* 📦 [Portable for Windows (ARM64)](${releaseBaseUrl}/kkterm-${assetVersion}-windows-arm64-portable.zip)`,
    "",
    releaseNotes.trim(),
    "",
  ];

  return downloads.join("\n");
}

export function prependChangelogEntry(currentChangelog, releaseNotes) {
  const entry = releaseNotes
    .replace(/^# KKTerm ([^\n]+)\n+/m, "## $1\n\n")
    .trim();

  if (!currentChangelog.trim()) {
    return ["# Changelog", "", "All notable changes to KKTerm are documented here.", "", entry, ""].join("\n");
  }

  const normalized = currentChangelog.replace(/\s*$/, "\n");
  const firstReleaseHeading = normalized.search(/^## /m);
  if (firstReleaseHeading === -1) {
    return `${normalized.trim()}\n\n${entry}\n`;
  }

  return `${normalized.slice(0, firstReleaseHeading).replace(/\s*$/, "\n\n")}${entry}\n\n${normalized.slice(
    firstReleaseHeading,
  )}`;
}

export function extractOpenAiText(response) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const parts = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function main() {
  await loadLocalEnv();

  const options = parseArgs(process.argv.slice(2));
  const version = requiredOption(options, "version");
  const previousTag = options.previousTag ?? (await latestTag());
  const target = options.target ?? "HEAD";
  const outputPath = options.output ?? path.join("artifacts", `release-notes-${version}.md`);
  const releaseFilePath = options.releaseFile ?? path.join("docs", "releases", `${version}.md`);
  const changelogPath = options.changelog ?? "CHANGELOG.md";
  const model = resolveReleaseNotesModel(options.model, process.env.OPENAI_RELEASE_NOTES_MODEL);
  const repo = options.repo ?? (await resolveRepo());
  const compareUrl = repo && previousTag ? `https://github.com/${repo}/compare/${previousTag}...${version}` : "";

  const commits = previousTag ? await collectCommits(previousTag, target) : await collectRecentCommits(target);
  const githubGeneratedNotes = repo && previousTag ? await generateGitHubNotes(repo, version, previousTag, target) : "";
  const linkedIssueReporters = await collectLinkedIssueReporters(repo, commits, githubGeneratedNotes);
  const context = {
    project: "KKTerm",
    version,
    repo,
    previousTag,
    target,
    compareUrl,
    githubGeneratedNotes,
    linkedIssueReporters,
    commits,
  };

  let releaseNotes = "";
  if (!options.skipAi && process.env.OPENAI_API_KEY) {
    try {
      releaseNotes = await generateAiReleaseNotes(context, model, process.env.OPENAI_API_KEY);
    } catch (error) {
      console.warn(`AI release notes failed; using deterministic fallback. ${error.message}`);
    }
  }

  if (!releaseNotes.trim()) {
    releaseNotes = composeFallbackReleaseNotes(context);
  }
  releaseNotes = prependDirectDownloads(context, releaseNotes);

  await writeTextFile(outputPath, releaseNotes);
  await writeTextFile(releaseFilePath, releaseNotes);

  const currentChangelog = await readOptionalFile(changelogPath);
  await writeTextFile(changelogPath, prependChangelogEntry(currentChangelog, releaseNotes));

  console.log(`Release notes written to ${outputPath}`);
  console.log(`Version notes written to ${releaseFilePath}`);
  console.log(`Changelog updated at ${changelogPath}`);
}

export async function generateAiReleaseNotes(context, model, apiKey) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: buildReleaseNotesPrompt(context),
      store: false,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  const text = extractOpenAiText(body).trim();
  if (!text) {
    throw new Error("OpenAI response did not contain text output.");
  }
  return `${text}\n`;
}

async function collectCommits(previousTag, target) {
  const range = `${previousTag}..${target}`;
  const { stdout } = await execGit(["log", "--format=%H%x1f%s%x1f%b%x1e", range]);
  return parseCommits(stdout);
}

async function collectRecentCommits(target) {
  const { stdout } = await execGit(["log", "--format=%H%x1f%s%x1f%b%x1e", "-n", "25", target]);
  return parseCommits(stdout);
}

async function parseCommits(stdout) {
  const records = stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean);

  const commits = [];
  for (const record of records) {
    const [fullSha, subject, body = ""] = record.split("\x1f");
    const sha = fullSha.slice(0, 7);
    commits.push({
      sha,
      subject: subject.trim(),
      body: trimBody(body),
      files: await filesForCommit(fullSha),
    });
  }
  return commits;
}

async function filesForCommit(sha) {
  try {
    const { stdout } = await execGit(["diff-tree", "--no-commit-id", "--name-only", "-r", sha]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function extractPrNumbers(commits, githubGeneratedNotes) {
  const prNumbers = new Set();
  for (const commit of commits) {
    for (const match of `${commit.subject}\n${commit.body}`.matchAll(/#(\d+)/g)) {
      prNumbers.add(Number(match[1]));
    }
  }
  for (const match of githubGeneratedNotes.matchAll(/\/pull\/(\d+)| in #(\d+)/g)) {
    prNumbers.add(Number(match[1] ?? match[2]));
  }
  return [...prNumbers];
}

async function fetchPrLinkedIssues(repo, prNumber) {
  try {
    const { stdout } = await execFile("gh", ["api", `repos/${repo}/pulls/${prNumber}`, "--jq", ".body"]);
    const body = stdout.trim();
    const issues = new Set();
    for (const match of body.matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) {
      issues.add(Number(match[1]));
    }
    return [...issues];
  } catch {
    return [];
  }
}

async function fetchIssueReporter(repo, issueNumber) {
  try {
    const { stdout } = await execFile("gh", [
      "api", `repos/${repo}/issues/${issueNumber}`,
      "--jq", `{number: .number, title: .title, reporter: .user.login}`,
    ]);
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

export async function collectLinkedIssueReporters(repo, commits, githubGeneratedNotes) {
  if (!repo) return [];
  const prNumbers = extractPrNumbers(commits, githubGeneratedNotes);
  const seen = new Set();
  const reporters = [];
  for (const prNumber of prNumbers) {
    const issueNumbers = await fetchPrLinkedIssues(repo, prNumber);
    for (const issueNumber of issueNumbers) {
      if (seen.has(issueNumber)) continue;
      seen.add(issueNumber);
      const info = await fetchIssueReporter(repo, issueNumber);
      if (info) reporters.push({ ...info, prNumber });
    }
  }
  return reporters;
}

async function generateGitHubNotes(repo, version, previousTag, target) {
  try {
    const { stdout } = await execFile("gh", [
      "api",
      "-X",
      "POST",
      `repos/${repo}/releases/generate-notes`,
      "-f",
      `tag_name=${version}`,
      "-f",
      `target_commitish=${target}`,
      "-f",
      `previous_tag_name=${previousTag}`,
      "--jq",
      ".body",
    ]);
    return stdout.trim();
  } catch (error) {
    console.warn(`GitHub generated notes unavailable; continuing without them. ${error.message}`);
    return "";
  }
}

async function resolveRepo() {
  try {
    const { stdout } = await execFile("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
    return stdout.trim();
  } catch {
    const remote = await execGit(["remote", "get-url", "origin"]).then((result) => result.stdout.trim(), () => "");
    const match = remote.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/i);
    return match?.[1] ?? "";
  }
}

async function latestTag() {
  const { stdout } = await execGit(["tag", "--sort=-creatordate"]);
  return stdout.split(/\r?\n/).find(Boolean)?.trim() ?? "";
}

async function execGit(args) {
  return execFile("git", args, { maxBuffer: 1024 * 1024 * 12 });
}

async function writeTextFile(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function loadLocalEnv() {
  for (const envFile of [".env.local", ".env"]) {
    const content = await readOptionalFile(envFile);
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) {
        continue;
      }
      process.env[match[1]] = unquoteEnvValue(match[2].trim());
    }
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--skip-ai") {
      options.skipAi = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requiredOption(options, name) {
  const value = options[name];
  if (!value) {
    throw new Error(`Missing required option --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return value;
}

function cleanGeneratedNotes(notes) {
  return notes
    .replace(/^# .+$/gm, "")
    .replace(/^## What's Changed$/gim, "")
    .trim();
}

function humanizeCommitSubject(subject) {
  return subject.replace(/^(feat|fix|chore|docs|test|refactor|perf|style|build|ci)(\([^)]+\))?:\s*/i, "");
}

function trimBody(body) {
  const trimmed = body.trim();
  if (trimmed.length <= MAX_BODY_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_BODY_CHARS).trim()}...`;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

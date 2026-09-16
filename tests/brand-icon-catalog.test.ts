import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAND_ICON_ENTRIES,
  brandIconIdFromRef,
  brandIconRefForId,
  isKnownBrandIconId,
} from "../src/lib/brandIcons";
import { buildIconSearchGroups, iconSearchGroupsMatch } from "../src/lib/iconSearchAliases";

const INSTALLER_ARTWORK_ICON_IDS = [
  "installer-default",
  "7zip",
  "audacity",
  "claude-code",
  "antigravity",
  "astral",
  "bentopdf",
  "bruno",
  "claude-code-installer",
  "codex",
  "cursor",
  "ditto",
  "docker",
  "everything",
  "excalidraw",
  "ffmpeg",
  "firefox",
  "google-chrome",
  "acrobat-reader",
  "flowise",
  "git",
  "github-cli",
  "herdr",
  "hermes-agent",
  "keepassxc",
  "langflow",
  "wsl",
  "n8n",
  "nodejs",
  "notepadpp",
  "obs-studio",
  "obsidian",
  "ollama",
  "oh-my-posh",
  "openflowkit",
  "open-webui",
  "openclaw",
  "opencode",
  "powershell",
  "psmux",
  "powertoys",
  "python",
  "rust",
  "rustdesk",
  "scrcpy",
  "sharex",
  "sysinternals-suite",
  "t3-code",
  "tailscale",
  "vscode",
  "vlc",
] as const;

test("brand icon references round-trip only known ids", () => {
  assert.equal(brandIconRefForId("openai-codex"), "brand:openai-codex");
  assert.equal(brandIconIdFromRef("brand:openai-codex"), "openai-codex");
  assert.equal(brandIconIdFromRef("brand:not-real"), null);
  assert.equal(brandIconIdFromRef("os:ubuntu"), null);
  assert.equal(brandIconIdFromRef(null), null);
});

test("connection brand icon picker includes AI coding tools and terminal logos", () => {
  const ids = new Set(BRAND_ICON_ENTRIES.map((entry) => entry.id));

  for (const id of [
    "openai-codex",
    "claude-code",
    "opencode",
    "cursor",
    "github-copilot",
    "windsurf",
    "bash",
    "zsh",
    "fish",
    "powershell",
    "windows-terminal",
    "tmux",
  ]) {
    assert.ok(ids.has(id), `${id} should be available in the brand icon catalog`);
    assert.equal(isKnownBrandIconId(id), true);
  }
});

test("connection brand icon picker includes every distinct Install Helper artwork", () => {
  const ids = BRAND_ICON_ENTRIES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "brand icon ids should be unique");

  for (const id of INSTALLER_ARTWORK_ICON_IDS) {
    assert.ok(ids.includes(id), `${id} should be available in the brand icon catalog`);
    assert.equal(isKnownBrandIconId(id), true);
    assert.equal(brandIconIdFromRef(brandIconRefForId(id)), id);
  }
});

test("Install Helper artwork is searchable in English and the active local language", () => {
  function matchingBrandIds(query: string, language: string) {
    const groups = buildIconSearchGroups(query, language);
    return BRAND_ICON_ENTRIES
      .filter((entry) => (
        iconSearchGroupsMatch([entry.label, ...entry.keywords].join(" ").toLowerCase(), groups)
      ))
      .map((entry) => entry.id);
  }

  assert.ok(matchingBrandIds("code", "zh-TW").includes("vscode"));
  assert.ok(matchingBrandIds("程式碼", "zh-TW").includes("vscode"));
  assert.ok(matchingBrandIds("terminal", "zh-TW").includes("powershell"));
  assert.ok(matchingBrandIds("終端機", "zh-TW").includes("powershell"));
});

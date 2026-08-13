// Launch classification for installed Install Helper tools. The tile-level
// Run button picks its behavior from `launchKindForRecipe`:
//   * "gui"   — start the installed program through the automatic backend
//               allow-list or an explicitly selected per-tool fallback
//               (`installer_launch_app`).
//   * "cli"   — open the mini launcher dialog and then a terminal through
//               `installer_open_terminal_launcher`.
//   * "webUi" — open the managed web-app Run dialog.
//   * "suite" — open a dedicated searchable Run dialog (Sysinternals,
//               Coreutils), kept separate from installation details.
// Recipes not listed here get no Run button. The CLI command map mirrors the
// Rust `terminal_launch_affordance` entries in
// src-tauri/src/installer/commands.rs — keep both sides in sync.

import { readDurableUiState, writeDurableUiState } from "../../lib/durableUiState";

export type LaunchKind = "gui" | "cli" | "webUi" | "suite";

/// Directory-scoped coding agents: their mini launcher remembers the project
/// folders they were opened in and can open a terminal at a chosen folder.
const CODING_AGENT_CLI_RECIPES = new Set<string>([
  "antigravity-cli",
  "claude-code-cli",
  "codex-cli",
  "cursor-cli",
  "kimi-code-cli",
  "grok-build",
  "opencode",
  "pi",
  "oh-my-pi",
]);

/// Durable store for remembered launch folders: one JSON object mapping
/// tool id → most-recent-first folder list. Registered in
/// `DURABLE_UI_STATE_PREFIXES` so it survives reinstalls and is wiped by
/// Settings → Reset All Settings.
const RECENT_LAUNCH_FOLDERS_KEY = "kkterm.installerLauncherRecentPaths.v1";
const CODING_AGENT_LAUNCH_OPTIONS_KEY = "kkterm.installerLauncherOptions.v1";
const GUI_LAUNCHER_PATHS_KEY = "kkterm.installerGuiLauncherPaths.v1";
const MAX_RECENT_LAUNCH_FOLDERS = 20;

export interface CodingAgentLaunchSettings {
  preset: string;
  arguments: string;
}

export interface CodingAgentLaunchOption {
  value: string;
}

const CODING_AGENT_LAUNCH_OPTIONS: Record<string, CodingAgentLaunchOption[]> = {
  "antigravity-cli": [
    { value: "--sandbox=true" },
    { value: "--dangerously-skip-permissions" },
    { value: "--sandbox=false" },
  ],
  "claude-code-cli": [
    { value: "--permission-mode plan" },
    { value: "--permission-mode auto" },
    { value: "--permission-mode acceptEdits" },
    { value: "--dangerously-skip-permissions" },
    { value: "--continue" },
  ],
  "codex-cli": [
    { value: "--sandbox workspace-write --ask-for-approval on-request" },
    { value: "--sandbox workspace-write --ask-for-approval never" },
    { value: "--dangerously-bypass-approvals-and-sandbox" },
    { value: "--search" },
  ],
  "cursor-cli": [
    { value: "--mode=ask" },
    { value: "--mode=plan" },
    { value: "--sandbox=enabled" },
    { value: "--auto-review" },
    { value: "--continue" },
  ],
  "kimi-code-cli": [
    { value: "--auto" },
    { value: "--yolo" },
    { value: "--plan" },
    { value: "--continue" },
  ],
  "grok-build": [
    { value: "--permission-mode auto" },
    { value: "--permission-mode acceptEdits" },
    { value: "--always-approve" },
    { value: "--minimal" },
    { value: "--continue" },
  ],
  opencode: [
    { value: "--auto" },
    { value: "--continue" },
    { value: "--pure" },
  ],
  pi: [],
  "oh-my-pi": [],
};

const CODING_AGENT_COMMAND_REFERENCE_URLS: Record<string, string> = {
  "antigravity-cli": "https://antigravity.google/docs/cli-reference",
  "claude-code-cli": "https://code.claude.com/docs/en/cli-usage",
  "codex-cli": "https://developers.openai.com/codex/cli/reference/",
  "cursor-cli": "https://docs.cursor.com/en/cli/reference/parameters",
  "kimi-code-cli":
    "https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html",
  "grok-build": "https://docs.x.ai/build/cli/reference",
  opencode: "https://opencode.ai/docs/cli/",
  pi: "https://pi.dev/docs/latest/usage",
  "oh-my-pi": "https://omp.sh/docs",
};

export function cliLauncherUsesProjectFolders(recipeId: string): boolean {
  return CODING_AGENT_CLI_RECIPES.has(recipeId);
}

export function codingAgentLaunchOptionsForRecipe(
  recipeId: string,
): CodingAgentLaunchOption[] | null {
  return CODING_AGENT_LAUNCH_OPTIONS[recipeId] ?? null;
}

export function codingAgentCommandReferenceUrlForRecipe(
  recipeId: string,
): string | null {
  return CODING_AGENT_COMMAND_REFERENCE_URLS[recipeId] ?? null;
}

function readAllCodingAgentLaunchSettings(): Record<
  string,
  CodingAgentLaunchSettings
> {
  try {
    const raw = readDurableUiState(CODING_AGENT_LAUNCH_OPTIONS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, CodingAgentLaunchSettings> = {};
    for (const [toolId, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        continue;
      }
      const candidate = value as Partial<CodingAgentLaunchSettings>;
      result[toolId] = {
        preset: typeof candidate.preset === "string" ? candidate.preset : "",
        arguments:
          typeof candidate.arguments === "string" ? candidate.arguments : "",
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function readCodingAgentLaunchSettings(
  recipeId: string,
): CodingAgentLaunchSettings {
  return (
    readAllCodingAgentLaunchSettings()[recipeId] ?? { preset: "", arguments: "" }
  );
}

export function writeCodingAgentLaunchSettings(
  recipeId: string,
  settings: CodingAgentLaunchSettings,
): void {
  const all = readAllCodingAgentLaunchSettings();
  all[recipeId] = settings;
  writeDurableUiState(CODING_AGENT_LAUNCH_OPTIONS_KEY, JSON.stringify(all));
}

function readAllGuiLauncherPaths(): Record<string, string> {
  try {
    const raw = readDurableUiState(GUI_LAUNCHER_PATHS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function readGuiLauncherPath(recipeId: string): string | null {
  return readAllGuiLauncherPaths()[recipeId] ?? null;
}

export function writeGuiLauncherPath(recipeId: string, path: string): void {
  const all = readAllGuiLauncherPaths();
  all[recipeId] = path;
  writeDurableUiState(GUI_LAUNCHER_PATHS_KEY, JSON.stringify(all));
}

export function removeGuiLauncherPath(recipeId: string): void {
  const all = readAllGuiLauncherPaths();
  if (!(recipeId in all)) return;
  delete all[recipeId];
  writeDurableUiState(GUI_LAUNCHER_PATHS_KEY, JSON.stringify(all));
}

function readAllRecentLaunchFolders(): Record<string, string[]> {
  try {
    const raw = readDurableUiState(RECENT_LAUNCH_FOLDERS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string[]> = {};
    for (const [toolId, folders] of Object.entries(parsed)) {
      if (Array.isArray(folders)) {
        result[toolId] = folders.filter(
          (folder): folder is string => typeof folder === "string",
        );
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function readRecentLaunchFolders(recipeId: string): string[] {
  return readAllRecentLaunchFolders()[recipeId] ?? [];
}

/// Record a folder the tool was just opened in. Moves it to the front,
/// deduplicates case-insensitively (Windows paths), caps the list, and
/// returns the updated list for immediate rendering.
export function rememberLaunchFolder(recipeId: string, folder: string): string[] {
  const trimmed = folder.trim();
  if (!trimmed) return readRecentLaunchFolders(recipeId);
  const all = readAllRecentLaunchFolders();
  const previous = all[recipeId] ?? [];
  const next = [
    trimmed,
    ...previous.filter(
      (candidate) => candidate.toLowerCase() !== trimmed.toLowerCase(),
    ),
  ].slice(0, MAX_RECENT_LAUNCH_FOLDERS);
  all[recipeId] = next;
  writeDurableUiState(RECENT_LAUNCH_FOLDERS_KEY, JSON.stringify(all));
  return next;
}

/// Installed GUI apps the backend can start directly. Mirrors the Rust
/// `gui_launch_affordance` allow-list.
const GUI_LAUNCH_RECIPES = new Set<string>([
  "vscode",
  "cursor",
  "notepadpp",
  "docker-desktop",
  "comfyui",
  "lmstudio",
  "bruno",
  "claude-desktop",
  "codex-desktop",
  "powertoys",
  "powershell-7",
  "everything",
  "ditto",
  "keepassxc",
  "7zip",
  "sharex",
  "tailscale",
  "rustdesk",
  "google-chrome",
  "firefox",
  "acrobat-reader",
  "obsidian",
  "drawio",
  "krita",
  "inkscape",
  "blender",
  "pencil",
  "vlc",
  "obs-studio",
  "xnview-mp",
  "audacity",
  "vcxsrv",
]);

/// Managed web apps whose installed dialog owns the run/stop/open/service
/// controls. Mirrors `webUiAffordanceForRecipe` in InstallerToolDialog.
const WEB_UI_LAUNCH_RECIPES = new Set<string>([
  "n8n",
  "ollama",
  "flowise",
  "open-webui",
  "langflow",
  "excalidraw",
  "bentopdf",
  "openflowkit",
]);

/// Multi-command tool suites whose dedicated Run dialog owns the searchable
/// quick-launch list. Mirrors the Rust `quick_launch_affordance` entries.
const SUITE_LAUNCH_RECIPES = new Set<string>(["sysinternals-suite", "coreutils"]);

/// Base commands for every command-line launcher. Coding agents deliberately
/// have no sample list; their launcher exposes curated options instead.
const CLI_LAUNCH_COMMANDS: Record<string, string> = {
  git: "git",
  winget: "winget",
  chocolatey: "choco",
  "node-bundle": "node",
  "python-bundle": "python",
  wsl: "wsl",
  nssm: "nssm",
  "oh-my-posh": "oh-my-posh",
  "antigravity-cli": "agy",
  "claude-code-cli": "claude",
  "codex-cli": "codex",
  "cursor-cli": "agent",
  "kimi-code-cli": "kimi",
  "grok-build": "grok",
  opencode: "opencode",
  pi: "pi",
  "oh-my-pi": "omp",
  rustup: "rustup",
  bun: "bun",
  ripgrep: "rg",
  jq: "jq",
  fzf: "fzf",
  ffmpeg: "ffmpeg",
  scrcpy: "scrcpy",
  psmux: "psmux",
  "hermes-agent": "hermes",
  openclaw: "openclaw",
};

/// Sample usage lines for non-agent command-line tools, shown in the mini
/// launcher dialog and echoed by the spawned terminal.
const CLI_LAUNCH_SAMPLES: Record<string, string[]> = {
  git: [
    "git clone <url>  —  copy a remote repository",
    "git status  —  show changed files",
    "git log --oneline -20  —  recent commits",
  ],
  winget: [
    "winget search <name>  —  find a package",
    "winget install <id>  —  install a package",
    "winget upgrade --all  —  update everything",
  ],
  chocolatey: [
    "choco search <name>  —  find a package",
    "choco install <id>  —  install a package (admin)",
    "choco upgrade all  —  update everything (admin)",
  ],
  "node-bundle": [
    "node --version  —  check the active Node runtime",
    "npm install <package>  —  add a package to a project",
    "nvm list  —  show installed Node versions",
  ],
  "python-bundle": [
    "python --version  —  check the active Python runtime",
    "uv venv  —  create a virtual environment",
    "uv pip install <package>  —  install into the environment",
  ],
  wsl: [
    "wsl  —  open the default Linux distribution",
    "wsl --list --verbose  —  show installed distributions",
    "wsl --update  —  update the WSL kernel",
  ],
  nssm: [
    "nssm install <service>  —  register a service (admin)",
    "nssm status <service>  —  check a service",
  ],
  "oh-my-posh": [
    "oh-my-posh init pwsh | Invoke-Expression  —  try it in this session",
    "oh-my-posh font install  —  install a Nerd Font",
  ],
  rustup: [
    "rustup show  —  show the active toolchain",
    "rustup update  —  update Rust",
    "cargo new <name>  —  create a project",
  ],
  bun: [
    "bun init  —  create a project",
    "bun install  —  install dependencies",
    "bun run <script>  —  run a package script",
  ],
  ripgrep: [
    'rg "pattern"  —  search the current directory',
    'rg -i "error" -g "*.log"  —  case-insensitive search in .log files',
    "rg --files  —  list searchable files",
  ],
  jq: [
    "jq . data.json  —  pretty-print JSON",
    'Get-Content data.json | jq ".items[0]"  —  pick a field from piped JSON',
  ],
  fzf: [
    "fzf  —  fuzzy-pick a file from the current directory",
    "Get-ChildItem -Recurse -Name | fzf  —  fuzzy-filter any list",
  ],
  ffmpeg: [
    "ffmpeg -i input.mp4 output.mp3  —  convert media",
    "ffprobe input.mp4  —  inspect a media file",
  ],
  scrcpy: [
    "scrcpy  —  mirror a USB-connected Android device",
    "scrcpy --tcpip=<ip>  —  connect over Wi-Fi",
  ],
  psmux: [
    "psmux  —  start a terminal multiplexer session",
    "psmux --help  —  list commands and flags",
  ],
  "hermes-agent": [
    "hermes setup  —  configure providers and accounts",
    "hermes postinstall  —  optional dependencies",
    "hermes doctor  —  health check",
    "hermes  —  start chatting",
  ],
  openclaw: [
    "openclaw onboard --install-daemon  —  setup and managed startup",
    "openclaw doctor  —  check configuration",
    "openclaw gateway status  —  verify gateway",
  ],
};

export function launchKindForRecipe(recipeId: string): LaunchKind | null {
  if (GUI_LAUNCH_RECIPES.has(recipeId)) return "gui";
  if (recipeId in CLI_LAUNCH_COMMANDS) return "cli";
  if (WEB_UI_LAUNCH_RECIPES.has(recipeId)) return "webUi";
  if (SUITE_LAUNCH_RECIPES.has(recipeId)) return "suite";
  return null;
}

export function cliLaunchSamplesForRecipe(recipeId: string): string[] | null {
  return CLI_LAUNCH_SAMPLES[recipeId] ?? null;
}

export function cliLaunchCommandForRecipe(recipeId: string): string | null {
  return CLI_LAUNCH_COMMANDS[recipeId] ?? null;
}

/// Whether a suite's quick-launch terminal opens elevated (Sysinternals) or
/// as a normal prompt (Coreutils). Drives the terminal button label.
export function suiteTerminalIsElevated(recipeId: string): boolean {
  return recipeId === "sysinternals-suite";
}

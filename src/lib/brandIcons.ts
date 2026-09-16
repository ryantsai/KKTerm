export const BRAND_ICON_REF_PREFIX = "brand:";
const BRAND_ICON_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

export type BrandIconEntry = {
  id: string;
  label: string;
  keywords: string[];
};

export const BRAND_ICON_ENTRIES: BrandIconEntry[] = [
  {
    id: "openai-codex",
    label: "OpenAI Codex",
    keywords: ["openai", "codex", "ai", "agent", "coding", "cli"],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    keywords: ["claude", "anthropic", "ai", "agent", "coding", "cli"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    keywords: ["opencode", "ai", "agent", "coding", "cli"],
  },
  {
    id: "kimi-code-cli",
    label: "Kimi Code CLI",
    keywords: ["kimi", "moonshot", "ai", "agent", "coding", "cli"],
  },
  {
    id: "grok-build",
    label: "Grok Build",
    keywords: ["grok", "xai", "x.ai", "ai", "agent", "coding", "cli"],
  },
  {
    id: "cursor",
    label: "Cursor",
    keywords: ["cursor", "ai", "ide", "editor", "coding"],
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    keywords: ["github", "copilot", "ai", "coding", "assistant"],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    keywords: ["windsurf", "codeium", "ai", "ide", "editor", "coding"],
  },
  {
    id: "codeium",
    label: "Codeium",
    keywords: ["codeium", "ai", "coding", "assistant"],
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    keywords: ["gemini", "google", "ai", "agent", "coding", "cli"],
  },
  {
    id: "antigravity",
    label: "Google Antigravity",
    keywords: ["antigravity", "google", "ai", "agent", "coding", "ide"],
  },
  {
    id: "visual-studio-code",
    label: "Visual Studio Code",
    keywords: ["vscode", "vs code", "visual studio code", "editor", "coding"],
  },
  {
    id: "bash",
    label: "GNU Bash",
    keywords: ["bash", "gnu", "shell", "terminal", "linux"],
  },
  {
    id: "zsh",
    label: "Zsh",
    keywords: ["zsh", "z shell", "shell", "terminal", "unix", "macos"],
  },
  {
    id: "fish",
    label: "fish shell",
    keywords: ["fish", "shell", "terminal", "unix", "linux", "macos"],
  },
  {
    id: "powershell",
    label: "PowerShell",
    keywords: ["powershell", "pwsh", "shell", "terminal", "microsoft", "windows"],
  },
  {
    id: "psmux",
    label: "psmux",
    keywords: ["psmux", "pmux", "tmux", "terminal", "multiplexer", "powershell", "windows"],
  },
  {
    id: "windows-terminal",
    label: "Windows Terminal",
    keywords: ["windows terminal", "terminal", "console", "microsoft", "windows"],
  },
  {
    id: "wsl",
    label: "WSL",
    keywords: ["wsl", "windows subsystem linux", "linux", "shell", "terminal"],
  },
  {
    id: "iterm2",
    label: "iTerm2",
    keywords: ["iterm", "iterm2", "terminal", "macos"],
  },
  {
    id: "wezterm",
    label: "WezTerm",
    keywords: ["wezterm", "terminal", "shell"],
  },
  {
    id: "alacritty",
    label: "Alacritty",
    keywords: ["alacritty", "terminal", "shell"],
  },
  {
    id: "tmux",
    label: "tmux",
    keywords: ["tmux", "terminal", "multiplexer", "shell"],
  },
  {
    id: "installer-default",
    label: "winget / NSSM / ripgrep / jq / fzf / Coreutils",
    keywords: ["package", "box", "module", "installer", "tool", "utility"],
  },
  {
    id: "7zip",
    label: "7-Zip",
    keywords: ["7zip", "7 zip", "archive", "compression", "file", "package"],
  },
  {
    id: "audacity",
    label: "Audacity",
    keywords: ["audacity", "audio", "recording", "editor", "media"],
  },
  {
    id: "astral",
    label: "Astral",
    keywords: ["astral", "uv", "python", "package", "developer"],
  },
  {
    id: "bentopdf",
    label: "BentoPDF",
    keywords: ["bentopdf", "bento pdf", "pdf", "document", "file"],
  },
  {
    id: "blender",
    label: "Blender",
    keywords: ["blender", "3d", "modeling", "animation", "render", "vfx", "design"],
  },
  {
    id: "bruno",
    label: "Bruno",
    keywords: ["bruno", "api", "network", "developer"],
  },
  {
    id: "bun",
    label: "Bun",
    keywords: ["bun", "javascript", "runtime", "package", "developer"],
  },
  {
    id: "claude-code-installer",
    label: "Claude Code",
    keywords: ["claude", "anthropic", "ai", "assistant", "code", "developer", "cli"],
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    keywords: ["openai", "codex", "ai", "assistant", "code", "developer", "cli"],
  },
  {
    id: "comfyui",
    label: "ComfyUI",
    keywords: ["comfyui", "comfy", "stable diffusion", "diffusion", "ai", "image", "workflow"],
  },
  {
    id: "ditto",
    label: "Ditto",
    keywords: ["ditto", "clipboard", "copy", "document", "edit", "utility"],
  },
  {
    id: "docker",
    label: "Docker",
    keywords: ["docker", "container", "package", "developer"],
  },
  {
    id: "drawio",
    label: "Draw.IO",
    keywords: ["drawio", "draw.io", "diagrams.net", "diagram", "flowchart", "design"],
  },
  {
    id: "everything",
    label: "Everything",
    keywords: ["everything", "voidtools", "search", "file", "utility"],
  },
  {
    id: "excalidraw",
    label: "Excalidraw",
    keywords: ["excalidraw", "diagram", "drawing", "whiteboard", "document"],
  },
  {
    id: "ffmpeg",
    label: "FFmpeg",
    keywords: ["ffmpeg", "video", "audio", "media", "command", "cli"],
  },
  {
    id: "firefox",
    label: "Mozilla Firefox",
    keywords: ["firefox", "mozilla", "browser", "web", "internet"],
  },
  {
    id: "google-chrome",
    label: "Google Chrome",
    keywords: ["chrome", "google", "browser", "web", "internet"],
  },
  {
    id: "acrobat-reader",
    label: "Adobe Acrobat Reader",
    keywords: ["acrobat", "adobe", "reader", "pdf", "document"],
  },
  {
    id: "flowise",
    label: "Flowise",
    keywords: ["flowise", "ai", "assistant", "workflow", "developer"],
  },
  {
    id: "git",
    label: "Git",
    keywords: ["git", "source control", "version control", "code", "developer"],
  },
  {
    id: "github-cli",
    label: "GitHub CLI",
    keywords: ["github", "gh", "git", "code", "developer", "command", "cli"],
  },
  {
    id: "herdr",
    label: "Herdr",
    keywords: ["herdr", "terminal", "runtime", "agent", "coding", "session"],
  },
  {
    id: "hermes-agent",
    label: "Hermes Agent",
    keywords: ["hermes", "agent", "ai", "assistant", "bot"],
  },
  {
    id: "hermes-desktop",
    label: "Hermes Desktop",
    keywords: ["hermes", "desktop", "agent", "ai", "assistant", "bot"],
  },
  {
    id: "inkscape",
    label: "Inkscape",
    keywords: ["inkscape", "svg", "vector", "design", "drawing"],
  },
  {
    id: "keepassxc",
    label: "KeePassXC",
    keywords: ["keepassxc", "keepass", "password", "vault", "security", "utility"],
  },
  {
    id: "krita",
    label: "Krita",
    keywords: ["krita", "painting", "drawing", "illustration", "design"],
  },
  {
    id: "langflow",
    label: "Langflow",
    keywords: ["langflow", "ai", "assistant", "workflow", "developer"],
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    keywords: ["lmstudio", "lm studio", "ai", "llm", "local", "model", "assistant"],
  },
  {
    id: "n8n",
    label: "n8n",
    keywords: ["n8n", "automation", "workflow", "network"],
  },
  {
    id: "nodejs",
    label: "Node.js",
    keywords: ["node", "nodejs", "node.js", "javascript", "code", "developer"],
  },
  {
    id: "notepadpp",
    label: "Notepad++",
    keywords: ["notepad", "notepad++", "editor", "code", "document", "file"],
  },
  {
    id: "obs-studio",
    label: "OBS Studio",
    keywords: ["obs", "obs studio", "video", "recording", "streaming", "multimedia"],
  },
  {
    id: "obsidian",
    label: "Obsidian",
    keywords: ["obsidian", "notes", "markdown", "knowledge", "document"],
  },
  {
    id: "ollama",
    label: "Ollama",
    keywords: ["ollama", "ai", "assistant", "model", "local"],
  },
  {
    id: "oh-my-posh",
    label: "Oh My Posh",
    keywords: ["oh my posh", "oh-my-posh", "prompt", "terminal", "shell"],
  },
  {
    id: "openflowkit",
    label: "OpenFlowKit",
    keywords: ["openflowkit", "open flow kit", "workflow", "developer"],
  },
  {
    id: "open-webui",
    label: "Open WebUI",
    keywords: ["open webui", "open-webui", "ai", "assistant", "web", "ollama"],
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    keywords: ["openclaw", "ai", "assistant", "agent", "bot"],
  },
  {
    id: "powertoys",
    label: "Microsoft PowerToys",
    keywords: ["powertoys", "power toys", "microsoft", "windows", "utility"],
  },
  {
    id: "python",
    label: "Python",
    keywords: ["python", "code", "developer", "script"],
  },
  {
    id: "rust",
    label: "Rust",
    keywords: ["rust", "rustup", "cargo", "code", "developer"],
  },
  {
    id: "rustdesk",
    label: "RustDesk",
    keywords: ["rustdesk", "remote desktop", "network"],
  },
  {
    id: "scrcpy",
    label: "scrcpy",
    keywords: ["scrcpy", "android", "mirror", "screen", "device", "utility"],
  },
  {
    id: "sharex",
    label: "ShareX",
    keywords: ["sharex", "screenshot", "capture", "image", "utility"],
  },
  {
    id: "sysinternals-suite",
    label: "Sysinternals Suite",
    keywords: ["sysinternals", "microsoft", "windows", "system", "utility"],
  },
  {
    id: "t3-code",
    label: "T3 Code",
    keywords: ["t3", "t3 code", "t3code", "agent", "coding", "desktop"],
  },
  {
    id: "tailscale",
    label: "Tailscale",
    keywords: ["tailscale", "vpn", "network", "cloud"],
  },
  {
    id: "vscode",
    label: "Visual Studio Code",
    keywords: ["vscode", "vs code", "visual studio code", "editor", "code", "developer", "microsoft"],
  },
  {
    id: "vlc",
    label: "VLC media player",
    keywords: ["vlc", "video", "audio", "media", "player", "streaming", "multimedia"],
  },
];

const BRAND_ICON_IDS = new Set(BRAND_ICON_ENTRIES.map((entry) => entry.id));

export function isKnownBrandIconId(id: string): boolean {
  return BRAND_ICON_IDS.has(id);
}

export function brandIconRefForId(id: string): string {
  return `${BRAND_ICON_REF_PREFIX}${id}`;
}

export function brandIconIdFromRef(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.startsWith(BRAND_ICON_REF_PREFIX)) {
    return null;
  }
  const id = value.slice(BRAND_ICON_REF_PREFIX.length);
  return BRAND_ICON_ID_PATTERN.test(id) && BRAND_ICON_IDS.has(id) ? id : null;
}

export function isBrandIconRef(value: string | null | undefined): boolean {
  return brandIconIdFromRef(value) !== null;
}

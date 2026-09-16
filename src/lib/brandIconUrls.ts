import { brandIconIdFromRef, isKnownBrandIconId } from "./brandIcons";
import defaultIcon from "../assets/installer-icons/default.svg?url";
import sevenZipIcon from "../assets/installer-icons/7zip.svg?url";
import acrobatReaderIcon from "../assets/installer-icons/acrobat-reader.svg?url";
import anthropicIcon from "../assets/installer-icons/anthropic.svg?url";
import antigravityIcon from "../assets/installer-icons/antigravity.svg?url";
import audacityIcon from "../assets/installer-icons/audacity.svg?url";
import astralIcon from "../assets/installer-icons/astral.svg?url";
import bentoPdfIcon from "../assets/installer-icons/bentopdf.svg?url";
import blenderIcon from "../assets/installer-icons/blender.svg?url";
import brunoIcon from "../assets/installer-icons/bruno.svg?url";
import bunIcon from "../assets/installer-icons/bun.svg?url";
import claudeCodeIcon from "../assets/installer-icons/claude-code.svg?url";
import codexIcon from "../assets/installer-icons/codex.svg?url";
import comfyuiIcon from "../assets/installer-icons/comfyui.svg?url";
import cursorIcon from "../assets/installer-icons/cursor.svg?url";
import dittoIcon from "../assets/installer-icons/ditto.png?url";
import dockerIcon from "../assets/installer-icons/docker.svg?url";
import drawioIcon from "../assets/installer-icons/drawio.svg?url";
import everythingIcon from "../assets/installer-icons/everything.png?url";
import excalidrawIcon from "../assets/installer-icons/excalidraw.svg?url";
import ffmpegIcon from "../assets/installer-icons/ffmpeg.svg?url";
import firefoxIcon from "../assets/installer-icons/firefox.svg?url";
import flowiseIcon from "../assets/installer-icons/flowise.png?url";
import geminiIcon from "../assets/installer-icons/gemini.svg?url";
import gitIcon from "../assets/installer-icons/git.svg?url";
import githubIcon from "../assets/installer-icons/github.svg?url";
import googleChromeIcon from "../assets/installer-icons/google-chrome.svg?url";
import grokIcon from "../assets/installer-icons/grok.svg?url";
import herdrIcon from "../assets/installer-icons/herdr.svg?url";
import hermesAgentIcon from "../assets/installer-icons/hermes-agent.svg?url";
import inkscapeIcon from "../assets/installer-icons/inkscape.svg?url";
import keepassxcIcon from "../assets/installer-icons/keepassxc.svg?url";
import kimiIcon from "../assets/installer-icons/kimi.svg?url";
import kritaIcon from "../assets/installer-icons/krita.svg?url";
import langflowIcon from "../assets/installer-icons/langflow.svg?url";
import linuxIcon from "../assets/installer-icons/linux.svg?url";
import lmstudioIcon from "../assets/installer-icons/lmstudio.svg?url";
import n8nIcon from "../assets/installer-icons/n8n.svg?url";
import nodejsIcon from "../assets/installer-icons/nodedotjs.svg?url";
import notepadppIcon from "../assets/installer-icons/notepadpp.svg?url";
import obsStudioIcon from "../assets/installer-icons/obs-studio.svg?url";
import obsidianIcon from "../assets/installer-icons/obsidian.svg?url";
import ohMyPoshIcon from "../assets/installer-icons/oh-my-posh.svg?url";
import ollamaIcon from "../assets/installer-icons/ollama.svg?url";
import openClawIcon from "../assets/installer-icons/openclaw.png?url";
import openFlowKitIcon from "../assets/installer-icons/openflowkit.svg?url";
import openWebuiIcon from "../assets/installer-icons/open-webui.png?url";
import openaiIcon from "../assets/installer-icons/openai.svg?url";
import opencodeIcon from "../assets/installer-icons/opencode.svg?url";
import powershellIcon from "../assets/installer-icons/powershell.svg?url";
import psmuxIcon from "../assets/installer-icons/psmux.svg?url";
import powerToysIcon from "../assets/installer-icons/powertoys.png?url";
import pythonIcon from "../assets/installer-icons/python.svg?url";
import rustIcon from "../assets/installer-icons/rust.svg?url";
import rustDeskIcon from "../assets/installer-icons/rustdesk.svg?url";
import scrcpyIcon from "../assets/installer-icons/scrcpy.svg?url";
import shareXIcon from "../assets/installer-icons/sharex.svg?url";
import sysinternalsSuiteIcon from "../assets/installer-icons/sysinternals-suite.png?url";
import t3CodeIcon from "../assets/installer-icons/t3-code.svg?url";
import tailscaleIcon from "../assets/installer-icons/tailscale.svg?url";
import vlcIcon from "../assets/installer-icons/vlc.svg?url";
import vscodeIcon from "../assets/installer-icons/vscode.png?url";
import alacrittyIcon from "../assets/connection-icons/tools/alacritty.svg?url";
import bashIcon from "../assets/connection-icons/tools/gnubash.svg?url";
import codeiumIcon from "../assets/connection-icons/tools/codeium.svg?url";
import fishIcon from "../assets/connection-icons/tools/fishshell.svg?url";
import githubCopilotIcon from "../assets/connection-icons/tools/githubcopilot.svg?url";
import iterm2Icon from "../assets/connection-icons/tools/iterm2.svg?url";
import tmuxIcon from "../assets/connection-icons/tools/tmux.svg?url";
import visualStudioCodeIcon from "../assets/connection-icons/tools/visualstudiocode.svg?url";
import weztermIcon from "../assets/connection-icons/tools/wezterm.svg?url";
import windsurfIcon from "../assets/connection-icons/tools/windsurf.svg?url";
import windowsTerminalIcon from "../assets/connection-icons/tools/windowsterminal.svg?url";
import zshIcon from "../assets/connection-icons/tools/zsh.svg?url";

const brandIconUrlById: Record<string, string> = {
  "installer-default": defaultIcon,
  "7zip": sevenZipIcon,
  "openai-codex": openaiIcon,
  "claude-code": anthropicIcon,
  "claude-code-installer": claudeCodeIcon,
  codex: codexIcon,
  comfyui: comfyuiIcon,
  opencode: opencodeIcon,
  cursor: cursorIcon,
  audacity: audacityIcon,
  astral: astralIcon,
  bentopdf: bentoPdfIcon,
  blender: blenderIcon,
  bruno: brunoIcon,
  bun: bunIcon,
  ditto: dittoIcon,
  docker: dockerIcon,
  drawio: drawioIcon,
  everything: everythingIcon,
  excalidraw: excalidrawIcon,
  ffmpeg: ffmpegIcon,
  firefox: firefoxIcon,
  "google-chrome": googleChromeIcon,
  "acrobat-reader": acrobatReaderIcon,
  flowise: flowiseIcon,
  git: gitIcon,
  "github-cli": githubIcon,
  "grok-build": grokIcon,
  herdr: herdrIcon,
  "hermes-agent": hermesAgentIcon,
  "hermes-desktop": hermesAgentIcon,
  inkscape: inkscapeIcon,
  keepassxc: keepassxcIcon,
  "kimi-code-cli": kimiIcon,
  krita: kritaIcon,
  langflow: langflowIcon,
  lmstudio: lmstudioIcon,
  n8n: n8nIcon,
  nodejs: nodejsIcon,
  notepadpp: notepadppIcon,
  "obs-studio": obsStudioIcon,
  obsidian: obsidianIcon,
  ollama: ollamaIcon,
  "oh-my-posh": ohMyPoshIcon,
  openflowkit: openFlowKitIcon,
  "open-webui": openWebuiIcon,
  openclaw: openClawIcon,
  powertoys: powerToysIcon,
  python: pythonIcon,
  rust: rustIcon,
  rustdesk: rustDeskIcon,
  scrcpy: scrcpyIcon,
  sharex: shareXIcon,
  "sysinternals-suite": sysinternalsSuiteIcon,
  "t3-code": t3CodeIcon,
  tailscale: tailscaleIcon,
  vlc: vlcIcon,
  vscode: vscodeIcon,
  "github-copilot": githubCopilotIcon,
  windsurf: windsurfIcon,
  codeium: codeiumIcon,
  "gemini-cli": geminiIcon,
  antigravity: antigravityIcon,
  "visual-studio-code": visualStudioCodeIcon,
  bash: bashIcon,
  zsh: zshIcon,
  fish: fishIcon,
  powershell: powershellIcon,
  psmux: psmuxIcon,
  "windows-terminal": windowsTerminalIcon,
  wsl: linuxIcon,
  iterm2: iterm2Icon,
  wezterm: weztermIcon,
  alacritty: alacrittyIcon,
  tmux: tmuxIcon,
};

export function brandIconUrlForId(id: string): string | null {
  return isKnownBrandIconId(id) ? brandIconUrlById[id] ?? null : null;
}

export function brandIconRefToUrl(value: string | null | undefined): string | null {
  const id = brandIconIdFromRef(value);
  return id ? brandIconUrlForId(id) : null;
}

// Maps each catalog recipe id to a bundled icon URL. Unknown ids fall
// back to a generic package icon. The SVG files in src/assets/installer-icons
// are mostly vendor brand marks from Simple Icons plus a few compact
// official/repository PNG/SVG assets. See that folder's README for source and
// license notes. We use Vite's `?url` import so each asset is fingerprinted
// and served by the renderer like any other static file.
//
// When a new recipe is added to installer/catalog.v1.json, add an import and
// recipe-id entry here, or point the recipe id at an existing asset.

import defaultIcon from "../../assets/installer-icons/default.svg?url";
import sevenZip from "../../assets/installer-icons/7zip.svg?url";
import acrobatReader from "../../assets/installer-icons/acrobat-reader.svg?url";
import anthropic from "../../assets/installer-icons/anthropic.svg?url";
import antigravity from "../../assets/installer-icons/antigravity.svg?url";
import astral from "../../assets/installer-icons/astral.svg?url";
import audacity from "../../assets/installer-icons/audacity.svg?url";
import bentopdf from "../../assets/installer-icons/bentopdf.svg?url";
import blender from "../../assets/installer-icons/blender.svg?url";
import bruno from "../../assets/installer-icons/bruno.svg?url";
import bun from "../../assets/installer-icons/bun.svg?url";
import claudeCode from "../../assets/installer-icons/claude-code.svg?url";
import codex from "../../assets/installer-icons/codex.svg?url";
import comfyui from "../../assets/installer-icons/comfyui.svg?url";
import cursor from "../../assets/installer-icons/cursor.svg?url";
import ditto from "../../assets/installer-icons/ditto.png?url";
import docker from "../../assets/installer-icons/docker.svg?url";
import drawio from "../../assets/installer-icons/drawio.svg?url";
import everything from "../../assets/installer-icons/everything.png?url";
import excalidraw from "../../assets/installer-icons/excalidraw.svg?url";
import ffmpeg from "../../assets/installer-icons/ffmpeg.svg?url";
import firefox from "../../assets/installer-icons/firefox.svg?url";
import flowise from "../../assets/installer-icons/flowise.png?url";
import git from "../../assets/installer-icons/git.svg?url";
import github from "../../assets/installer-icons/github.svg?url";
import googleChrome from "../../assets/installer-icons/google-chrome.svg?url";
import grok from "../../assets/installer-icons/grok.svg?url";
import hermesAgent from "../../assets/installer-icons/hermes-agent.svg?url";
import inkscape from "../../assets/installer-icons/inkscape.svg?url";
import keepassxc from "../../assets/installer-icons/keepassxc.svg?url";
import kimi from "../../assets/installer-icons/kimi.svg?url";
import krita from "../../assets/installer-icons/krita.svg?url";
import langflow from "../../assets/installer-icons/langflow.svg?url";
import linux from "../../assets/installer-icons/linux.svg?url";
import lmstudio from "../../assets/installer-icons/lmstudio.svg?url";
import n8n from "../../assets/installer-icons/n8n.svg?url";
import nodedotjs from "../../assets/installer-icons/nodedotjs.svg?url";
import notepadpp from "../../assets/installer-icons/notepadpp.svg?url";
import obsStudio from "../../assets/installer-icons/obs-studio.svg?url";
import obsidian from "../../assets/installer-icons/obsidian.svg?url";
import ollama from "../../assets/installer-icons/ollama.svg?url";
import ohMyPosh from "../../assets/installer-icons/oh-my-posh.svg?url";
import openflowkit from "../../assets/installer-icons/openflowkit.svg?url";
import openWebui from "../../assets/installer-icons/open-webui.png?url";
import openclaw from "../../assets/installer-icons/openclaw.png?url";
import opencode from "../../assets/installer-icons/opencode.svg?url";
import powershell from "../../assets/installer-icons/powershell.svg?url";
import psmux from "../../assets/installer-icons/psmux.svg?url";
import powertoys from "../../assets/installer-icons/powertoys.png?url";
import python from "../../assets/installer-icons/python.svg?url";
import rust from "../../assets/installer-icons/rust.svg?url";
import rustdesk from "../../assets/installer-icons/rustdesk.svg?url";
import scrcpy from "../../assets/installer-icons/scrcpy.svg?url";
import sharex from "../../assets/installer-icons/sharex.svg?url";
import sysinternalsSuite from "../../assets/installer-icons/sysinternals-suite.png?url";
import tailscale from "../../assets/installer-icons/tailscale.svg?url";
import vlc from "../../assets/installer-icons/vlc.svg?url";
import vscode from "../../assets/installer-icons/vscode.png?url";

const RECIPE_ICON_URLS: Record<string, string> = {
  git,
  "github-cli": github,
  winget: defaultIcon,
  vscode,
  cursor,
  notepadpp,
  "obs-studio": obsStudio,
  obsidian,
  audacity,
  "nvm-windows": nodedotjs,
  "node-bundle": nodedotjs,
  uv: astral,
  "python-bundle": python,
  wsl: linux,
  "docker-desktop": docker,
  nssm: defaultIcon,
  "oh-my-posh": ohMyPosh,
  "claude-code-cli": claudeCode,
  "codex-cli": codex,
  "cursor-cli": cursor,
  "antigravity-cli": antigravity,
  "kimi-code-cli": kimi,
  "grok-build": grok,
  ollama,
  n8n,
  "open-webui": openWebui,
  flowise,
  langflow,
  comfyui,
  lmstudio,
  bruno,
  ripgrep: defaultIcon,
  jq: defaultIcon,
  fzf: defaultIcon,
  coreutils: defaultIcon,
  opencode,
  rustup: rust,
  bun,
  "codex-desktop": codex,
  "claude-desktop": anthropic,
  "hermes-agent": hermesAgent,
  "hermes-desktop": hermesAgent,
  "powershell-7": powershell,
  psmux,
  powertoys,
  "sysinternals-suite": sysinternalsSuite,
  everything,
  ditto,
  tailscale,
  vlc,
  rustdesk,
  scrcpy,
  "7zip": sevenZip,
  "google-chrome": googleChrome,
  firefox,
  "acrobat-reader": acrobatReader,
  sharex,
  ffmpeg,
  excalidraw,
  drawio,
  krita,
  inkscape,
  keepassxc,
  blender,
  bentopdf,
  openflowkit,
  openclaw,
  pi: defaultIcon,
  "oh-my-pi": defaultIcon,
};

export function iconUrlForRecipe(recipeId: string): string {
  return RECIPE_ICON_URLS[recipeId] ?? defaultIcon;
}

export const FALLBACK_ICON_URL = defaultIcon;
